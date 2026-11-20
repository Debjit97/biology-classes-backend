#!/usr/bin/env bash
set -Eeuo pipefail

MIGRATIONS_DIR="prisma/migrations"
MIGRATION_NAME="20261120120000_initial_schema"
TARGET_DIR="${MIGRATIONS_DIR}/${MIGRATION_NAME}"
TARGET_SQL="${TARGET_DIR}/migration.sql"

if [[ ! -f "prisma/schema.prisma" ]]; then
  echo "ERROR: Run this script from the backend project root." >&2
  exit 2
fi

if find "${MIGRATIONS_DIR}" -mindepth 2 -maxdepth 2 -name migration.sql -print -quit 2>/dev/null | grep -q .; then
  echo "ERROR: A Prisma migration already exists. Refusing to generate a second baseline automatically." >&2
  echo "Review the existing migration history and use a deliberate follow-up migration instead." >&2
  exit 2
fi

if [[ -e "${TARGET_DIR}" ]]; then
  echo "ERROR: ${TARGET_DIR} already exists. Refusing to overwrite it." >&2
  exit 2
fi

mkdir -p "${TARGET_DIR}"
TMP_SQL="$(mktemp)"
cleanup() {
  rm -f "${TMP_SQL}"
  if [[ ! -s "${TARGET_SQL}" ]]; then
    rmdir "${TARGET_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Generating initial SQL from prisma/schema.prisma using the installed Prisma CLI..."
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "${TMP_SQL}"

if [[ ! -s "${TMP_SQL}" ]]; then
  echo "ERROR: Prisma generated an empty migration. No migration was installed." >&2
  rmdir "${TARGET_DIR}" 2>/dev/null || true
  exit 2
fi

mv "${TMP_SQL}" "${TARGET_SQL}"
printf 'provider = "postgresql"\n' > "${MIGRATIONS_DIR}/migration_lock.toml"

echo "PASS: Initial migration generated at ${TARGET_SQL}"
echo "IMPORTANT: Review the SQL and apply it only to a new/disposable database before production."
