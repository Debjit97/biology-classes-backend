const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

let ts;
try {
  ts = require('typescript');
} catch {
  const { execFileSync } = require('node:child_process');
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  ts = require(path.join(globalRoot, 'typescript'));
}

const sourcePath = path.join(__dirname, '..', 'src', 'auth', 'mfa.util.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, 'MFA utility must transpile without syntax errors');

const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled.outputText, sourcePath);
const {
  generateTotpSecret, buildOtpAuthUri, encryptMfaSecret, decryptMfaSecret, verifyTotp,
} = loaded.exports;

// RFC 6238 SHA-1, six-digit test vectors.
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
assert.equal(verifyTotp(rfcSecret, '287082', 59_000), 1n);
assert.equal(verifyTotp(rfcSecret, '081804', 1_111_111_109_000), 37_037_036n);
assert.equal(verifyTotp(rfcSecret, '000000', 59_000), null);
assert.equal(verifyTotp(rfcSecret, '12x456', 59_000), null);

const generated = generateTotpSecret();
assert.match(generated, /^[A-Z2-7]+$/);
assert.ok(buildOtpAuthUri('admin@example.com', generated).startsWith('otpauth://totp/'));

const key = 'ab'.repeat(32);
const encrypted = encryptMfaSecret(generated, key);
assert.notEqual(encrypted, generated);
assert.equal(decryptMfaSecret(encrypted, key), generated);
assert.throws(() => decryptMfaSecret(encrypted, 'cd'.repeat(32)));
assert.throws(() => decryptMfaSecret(encrypted.slice(0, -2) + 'xx', key));
assert.throws(() => encryptMfaSecret(generated, 'short'));

console.log('PASS: RFC TOTP vectors, invalid-code rejection, secret generation, otpauth URI, AES-256-GCM round-trip and tamper/key rejection.');
