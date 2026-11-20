# Migration status — release 0.6.0

No baseline migration SQL is committed in this starter yet. This is intentional: Prisma CLI and a PostgreSQL instance were unavailable in the authoring environment, so generating SQL by hand would risk shipping an incorrect schema migration.

Before production deployment, in a development environment with dependencies installed and a disposable PostgreSQL database running:

1. Set `DATABASE_URL` to that development database.
2. Run `npx prisma validate`.
3. Run `npx prisma migrate dev --name phase2_foundation` to generate the baseline migration from the complete Prisma schema.
4. Review the generated SQL and test it against a fresh empty database.
5. Commit the generated `prisma/migrations/<timestamp>_phase2_foundation/migration.sql` and `migration_lock.toml`.
6. Verify a second empty database can be created using `npx prisma migrate deploy`.

Do not run `migrate dev` in production. The `npm run prisma:deploy` command deliberately refuses to run if no committed migration SQL is present.
