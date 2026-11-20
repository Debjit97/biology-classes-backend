#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "Refusing to run development verification/migration commands in production." >&2
  echo "Use the reviewed migration release process (prisma migrate deploy) in production." >&2
  exit 2
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Configure the development database in .env first." >&2
  exit 2
fi

echo "== Run dependency-free MFA cryptographic regression tests =="
node scripts/test-mfa-crypto.cjs

echo "== Run dependency-free session security regression checks =="
node scripts/test-session-security.cjs

echo "== Install project dependencies =="
npm install

echo "== Run static source audit =="
npm run static:audit

echo "== Validate Prisma schema =="
npx prisma validate

echo "== Generate Prisma client =="
npx prisma generate

echo "== Compile NestJS backend =="
npm run build

echo "== Generate initial migration from the reviewed Prisma schema =="
npm run prisma:migration:initial

echo "== Apply migration to the configured DEVELOPMENT database =="
npx prisma migrate deploy

echo "== Confirm migration status =="
npx prisma migrate status

echo "== Verification summary =="
echo "Dependency installation, static audit, Prisma validation/client generation, build and development migration commands completed."
echo "Use a NEW, EMPTY disposable development database for this script. This does not replace endpoint-level integration tests, security tests or independent penetration testing."
