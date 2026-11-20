const fs = require('node:fs');
const path = require('node:path');
const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const entries = fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(migrationsDir, entry.name, 'migration.sql'))
      .filter(file => fs.existsSync(file))
  : [];
if (entries.length === 0) {
  console.error('BLOCKED: no committed Prisma migration SQL was found. Generate and review the initial migration in a development database, commit it, then retry.');
  process.exit(2);
}
console.log(`PASS: found ${entries.length} committed Prisma migration(s).`);
