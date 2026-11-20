const fs = require('fs');
const path = require('path');
let ts;
try {
  ts = require('typescript');
} catch {
  const { execFileSync } = require('child_process');
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  ts = require(require('path').join(globalRoot, 'typescript'));
}

const root = path.resolve(__dirname, '..');
const errors = [];
const checks = [];

function pass(name) { checks.push({ name, result: 'PASS' }); }
function fail(name, detail) { errors.push({ name, detail }); checks.push({ name, result: 'FAIL' }); }

for (const file of ['package.json', 'tsconfig.json', 'nest-cli.json']) {
  try { JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); pass(`${file} parses as JSON`); }
  catch (e) { fail(`${file} parses as JSON`, e.message); }
}

const tsFiles = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.isFile() && full.endsWith('.ts')) tsFiles.push(full);
  }
}
walk(path.join(root, 'src'));
tsFiles.push(path.join(root, 'prisma', 'seed.ts'));

let syntaxErrors = 0;
for (const file of tsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true
    },
    reportDiagnostics: true
  });
  const diagnostics = out.diagnostics || [];
  const parseErrors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
  if (parseErrors.length) {
    syntaxErrors += parseErrors.length;
    fail(`TypeScript syntax: ${path.relative(root, file)}`,
      parseErrors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\\n')).join('; '));
  }
}
if (!syntaxErrors) pass(`TypeScript syntax transpilation (${tsFiles.length} files)`);

const missingImports = [];
for (const file of tsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const importPattern = /(?:from\s*|import\s*)['\"](\.[^'\"]+)['\"]/g;
  let match;
  while ((match = importPattern.exec(source))) {
    const base = path.resolve(path.dirname(file), match[1]);
    const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    if (!candidates.some(candidate => fs.existsSync(candidate))) {
      missingImports.push(`${path.relative(root, file)} -> ${match[1]}`);
    }
  }
}
if (!missingImports.length) pass('All relative TypeScript imports resolve');
else fail('All relative TypeScript imports resolve', missingImports.join('; '));

const schemaText = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
let depth = 0, balanced = true;
for (const c of schemaText) {
  if (c === '{') depth++;
  if (c === '}') depth--;
  if (depth < 0) balanced = false;
}
if (balanced && depth === 0) pass('Prisma schema braces balanced');
else fail('Prisma schema braces balanced', `final depth=${depth}`);

const seedText = fs.readFileSync(path.join(root, 'prisma', 'seed.ts'), 'utf8');
const seedHasExistingAccountRefusal =
  /if\s*\(existing\)\s*\{[\s\S]*?isAlreadyAdmin[\s\S]*?existing\.status\s*!==\s*'ACTIVE'[\s\S]*?throw new Error\([\s\S]*?never promote or reactivate/i.test(seedText);
const seedDoesNotAttachAdminRoleToExistingUser =
  !/userRole\.upsert\([\s\S]*?userId_roleId[\s\S]*?roleId:\s*adminRole\.id/.test(seedText);
if (seedHasExistingAccountRefusal && seedDoesNotAttachAdminRoleToExistingUser) {
  pass('Bootstrap Admin refuses to promote or reactivate existing accounts');
} else {
  fail('Bootstrap Admin refuses to promote or reactivate existing accounts',
    'Seed must refuse existing non-Admin/inactive accounts and must not attach ADMIN role to an existing user.');
}

const verifyScript = fs.readFileSync(path.join(root, 'scripts', 'verify-full.sh'), 'utf8');
if (/NODE_ENV.*production[\s\S]*?Refusing to run development verification/i.test(verifyScript)) {
  pass('Full verification script blocks production development migrations');
} else {
  fail('Full verification script blocks production development migrations',
    'verify-full.sh must refuse NODE_ENV=production before running migrate dev.');
}

const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
if (/^MFA_ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARACTERS$/m.test(envExample)) pass('MFA encryption key example is a valid standalone environment entry');
else fail('MFA encryption key example is a valid standalone environment entry', 'MFA_ENCRYPTION_KEY example is missing or malformed.');
const productionMigrationGate = fs.readFileSync(path.join(root, 'scripts', 'check-production-migrations.cjs'), 'utf8');
if (/no committed Prisma migration SQL was found/.test(productionMigrationGate)
  && /process\.exit\(2\)/.test(productionMigrationGate)
  && /check-production-migrations\.cjs && prisma migrate deploy/.test(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))) {
  pass('Production migration deployment fails closed without committed SQL');
} else fail('Production migration deployment fails closed without committed SQL', 'Production migration guard or package script is missing.');

const migrationGenerator = fs.readFileSync(path.join(root, 'scripts', 'prepare-initial-migration.sh'), 'utf8');
if (/prisma migrate diff/.test(migrationGenerator)
  && /--from-empty/.test(migrationGenerator)
  && migrationGenerator.includes('--to-schema-datamodel prisma/schema.prisma')
  && /Refusing to overwrite/.test(migrationGenerator)) {
  pass('Initial migration is generated from Prisma schema without overwriting existing history');
} else {
  fail('Initial migration is generated from Prisma schema without overwriting existing history',
    'Migration generator must use Prisma migrate diff and refuse existing migration history.');
}
const ciWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'backend-ci.yml'), 'utf8');
if (/postgres:16/.test(ciWorkflow) && /prisma migrate deploy/.test(ciWorkflow)
  && /npm run build/.test(ciWorkflow) && /test:mfa-crypto/.test(ciWorkflow)) {
  pass('Automated CI pipeline provisions PostgreSQL and runs migration, build and security checks');
} else {
  fail('Automated CI pipeline provisions PostgreSQL and runs migration, build and security checks',
    'CI workflow is missing required database/build/security stages.');
}

const mainSource = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
if (/if \(isProduction\)/.test(mainSource)
  && /MFA_ENCRYPTION_KEY/.test(mainSource)
  && /64 hexadecimal characters/.test(mainSource)) {
  pass('Production startup fails closed when mandatory MFA encryption key is missing');
} else {
  fail('Production startup fails closed when mandatory MFA encryption key is missing',
    'Production bootstrap must validate MFA_ENCRYPTION_KEY before listening.');
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const authServiceText = fs.readFileSync(path.join(root, 'src', 'auth', 'auth.service.ts'), 'utf8');
const jwtStrategyText = fs.readFileSync(path.join(root, 'src', 'auth', 'jwt.strategy.ts'), 'utf8');
const mfaUtilText = fs.readFileSync(path.join(root, 'src', 'auth', 'mfa.util.ts'), 'utf8');
const sessionServiceText = authServiceText;
const sessionStrategyText = jwtStrategyText;
const sessionControllerText = fs.readFileSync(path.join(root, 'src', 'auth', 'auth.controller.ts'), 'utf8');
const sessionSchemaPresent = /model\s+UserSession\s*\{/.test(schemaText)
  && /refreshTokenHash\s+String\s+@unique/.test(schemaText)
  && /revokedAt\s+DateTime\?/.test(schemaText);
if (sessionSchemaPresent) pass('Server-side revocable session model present');
else fail('Server-side revocable session model present', 'UserSession model fields missing.');
if (/createHash\('sha256'\)/.test(sessionServiceText) && /randomBytes\(48\)/.test(sessionServiceText)) {
  pass('Refresh tokens are high-entropy and stored as hashes');
} else fail('Refresh tokens are high-entropy and stored as hashes', 'Refresh token generation/hash safeguards missing.');
if (/refreshTokenHash:\s*nextHash/.test(sessionServiceText) && /AUTH_REFRESH_REUSE_DETECTED/.test(sessionServiceText)) {
  pass('Refresh-token rotation and reuse auditing present');
} else fail('Refresh-token rotation and reuse auditing present', 'Rotation/reuse safeguards missing.');
if (/userSession\.findUnique/.test(sessionStrategyText) && /session\.revokedAt/.test(sessionStrategyText)
  && /session\.expiresAt/.test(sessionStrategyText)) {
  pass('Every access token is checked against active server-side session');
} else fail('Every access token is checked against active server-side session', 'Access-token session validation missing.');
if (/session\/refresh/.test(sessionControllerText) && /session\/logout-all/.test(sessionControllerText)) {
  pass('Refresh and logout-all endpoints present');
} else fail('Refresh and logout-all endpoints present', 'Session endpoints missing.');
if (packageJson.scripts?.['test:session-security']) pass('Session security regression test command declared');
else fail('Session security regression test command declared', 'test:session-security script missing.');

const mfaSchemaFields = /mfaEnabled\s+Boolean\s+@default\(false\)/.test(schemaText)
  && /mfaSecretEnc\s+String\?/.test(schemaText)
  && /mfaPendingSecretEnc\s+String\?/.test(schemaText)
  && /mfaLastUsedStep\s+BigInt\?/.test(schemaText);
if (mfaSchemaFields) pass('Admin MFA persistence fields present');
else fail('Admin MFA persistence fields present', 'Required encrypted-secret, enabled-state and replay-counter fields are missing.');
if (/AES-256-GCM|aes-256-gcm/.test(mfaUtilText) && /MFA_ENCRYPTION_KEY/.test(authServiceText)) {
  pass('MFA secret encryption and external key configuration present');
} else fail('MFA secret encryption and external key configuration present', 'MFA encryption/key checks missing.');
if (/admin_mfa_setup/.test(authServiceText) && /mfaSetupOnly/.test(jwtStrategyText)
  && /roles:\s*\[\]/.test(jwtStrategyText)) {
  pass('Admin MFA setup token is role-restricted');
} else fail('Admin MFA setup token is role-restricted', 'Restricted setup token handling is incomplete.');
if (/admin_mfa_challenge/.test(authServiceText) && /amr/.test(jwtStrategyText)
  && /payload\.amr\?\.includes\('mfa'\)/.test(jwtStrategyText)) {
  pass('Admin protected APIs require MFA-authenticated access tokens');
} else fail('Admin protected APIs require MFA-authenticated access tokens', 'Admin MFA claim enforcement is missing.');
if (/mfaLastUsedStep/.test(authServiceText) && /updateMany/.test(authServiceText)) {
  pass('TOTP replay protection uses atomic database update');
} else fail('TOTP replay protection uses atomic database update', 'Atomic replay counter check is missing.');
if (packageJson.scripts?.['test:mfa-crypto']) pass('MFA cryptographic regression test command declared');
else fail('MFA cryptographic regression test command declared', 'test:mfa-crypto script missing.');

if (packageJson.dependencies?.['@nestjs/throttler'] || packageJson.devDependencies?.['@nestjs/throttler']) pass('API rate-limiter dependency declared');
else fail('API rate-limiter dependency declared', '@nestjs/throttler is missing');
if (/tokenVersion\s+Int\s+@default\(0\)/.test(schemaText)) pass('User session version field present');
else fail('User session version field present', 'tokenVersion field is missing');

for (const model of [
  'User','Role','UserRole','TeacherApplication','Subject','AcademicSession','ClassLevel','Batch',
  'TeacherBatchAssignment','StudentBatchEnrollment','UserSession','Notification','NotificationRecipient',
  'NotificationPreference','DeviceToken','NotificationJob','NotificationDeliveryLog','AuditLog'
]) {
  if (new RegExp('model\\s+' + model + '\\s*\\{').test(schemaText)) pass(`Prisma model present: ${model}`);
  else fail(`Prisma model present: ${model}`, 'Model declaration not found');
}

if (errors.length) {
  console.error(JSON.stringify({ checks, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
