# BIOLOGY CLASSES by J.C. SIR — Phase 2 Backend Starter v0.2

This package extends the Phase 2 backend foundation with the Notification & Communication Centre.

## Included
- NestJS + TypeScript backend scaffold
- PostgreSQL / Prisma schema
- Argon2id password hashing, stronger teacher-registration password rules and short-lived JWT access-token foundation
- Per-route and global API rate limits (in-process; production multi-instance deployments must also enforce gateway/Redis-backed limits)
- JWT issuer/audience/algorithm validation and database-backed account/role/session-version checks on every authenticated request
- Strict CORS allowlist, production secret/origin startup checks, Helmet security headers, strict DTO validation
- Database readiness endpoint at `/api/v1/health/ready` and graceful shutdown hooks
- Teacher self-registration as PENDING
- Admin-only teacher application review with transactional, race-safe decisions and session invalidation
- Role guard with deny-by-default behavior
- Notification data model:
  - notifications
  - notification recipients
  - delivery logs
  - notification preferences
  - registered device tokens
- Admin custom notification endpoint
- Teacher custom notification endpoint restricted to assigned batches and their enrolled students
- In-app notification inbox and read-status endpoint
- Internal event hooks for new content and verified payment events
- PostgreSQL outbox records for asynchronous channel delivery

## Security hardening completed in this revision
- Authentication now reads current account status and roles from PostgreSQL on each request; disabling an account or incrementing its token version invalidates existing access tokens immediately.
- JWTs are restricted to HS256 and validated against configured issuer and audience.
- Teacher registration and login have stricter rate limits; a global API rate limit is also enabled. The built-in limiter is per-process, so production deployments with multiple API instances must add a shared Redis/API-gateway rate limiter.
- Teacher approval/rejection is performed transactionally with a conditional state transition to prevent concurrent double review.\n- Bootstrap Admin creation refuses to promote or reactivate an existing account; an existing account must already be an active Admin.
- Teacher registration enforces a stronger password policy and handles concurrent duplicate-email attempts safely.
- Notification recipients must be active students for teacher-to-individual delivery; audience/target combinations are checked, and deep links are restricted to relative in-app paths.
- UUID route parameters are validated.
- Production startup refuses missing/placeholder JWT secrets and refuses an empty CORS allowlist.
- A database readiness endpoint is available separately from liveness.

## Not yet connected
This is a development scaffold, not a production service. Actual email, SMS, Android/iOS push delivery, payment gateway webhooks, queue workers, MFA, refresh-token rotation, production Admin bootstrap, monitoring and deployment still need implementation/configuration and testing. No real notification is sent by this starter.

## Local setup
1. Install Node.js 20+ and Docker Desktop.
2. Copy `.env.example` to `.env`; change all placeholder secrets.
3. Run `docker compose up -d db`.
4. Run `npm install`.
5. Run `npx prisma generate`.
6. Run `npx prisma migrate dev --name phase2_foundation`.
7. Seed required roles through a controlled local bootstrap script.
8. Run `npm run start:dev`.

Base path: `/api/v1`

## Important production requirements
- Configure provider adapters for email, India-compliant SMS (including applicable DLT/template requirements), and Firebase/APNs push.
- Verify payment gateway webhook signatures server-side before calling `notifyPaymentConfirmed`.
- Do not treat a client payment-success redirect as proof of payment.
- Implement Admin MFA, refresh-token rotation/session management, email/phone verification, account recovery and production-grade shared rate limiting.
- Add complete API integration/authorization tests, delivery workers, provider retries/dead-letter handling and delivery reconciliation.
- Enforce consent/preferences and applicable transactional-message rules.
- Never commit `.env` or production credentials.
- Perform automated tests, security review and independent penetration testing before launch.

## Verification performed in the authoring environment
- Node.js and npm are present.
- A Node-only static audit checks JSON configuration, TypeScript syntax transpilation and required schema declarations.
- Full dependency installation was attempted but cannot complete because the npm registry is unreachable from this environment and the packages are not cached.
- Therefore a full NestJS type-check/build, Prisma CLI validation/migration and database-backed integration tests remain **not verified**.
- Run `npm run static:audit` locally. Then run `npm install`, `npx prisma validate`, `npx prisma generate`, migrations, `npm run build`, and integration tests in an environment with registry access and PostgreSQL.

## One-command full verification
In a machine with npm registry access and a reachable PostgreSQL database, configure `.env` and run:

```bash
npm run verify:full
```

This is a development-only script: it refuses NODE_ENV=production, installs dependencies, runs the static audit, validates/generates Prisma, compiles NestJS and applies a development migration. It does not replace endpoint-level integration tests or security testing.

For a clean local database, start it with `docker compose up -d db` before running migrations. Set `POSTGRES_PASSWORD` in `.env` to match `DATABASE_URL`.

## Admin multi-factor authentication (MFA)

Admin accounts are required to enroll an authenticator app before accessing protected Admin APIs. Admin password login before enrollment returns a restricted setup token. That token is accepted only by `/api/v1/auth/mfa/setup` and `/api/v1/auth/mfa/setup/confirm`; it does not grant application roles. After enrollment, Admin login requires a second-step TOTP challenge at `/api/v1/auth/mfa/login/verify`.

Configure `MFA_ENCRYPTION_KEY` as exactly 64 hexadecimal characters (32 random bytes) in the secrets manager. Do not commit the real value to source control or send it through chat. MFA secrets are encrypted using AES-256-GCM. TOTP replay is blocked using an atomic database counter update. Keep server clocks synchronized.

This is a newly added security flow and still requires the integration tests in `test/admin-mfa-security-checklist.md`, Prisma migration generation/application, compilation and independent security review before production use.


Run `npm run test:mfa-crypto` for dependency-free RFC 6238 and AES-256-GCM regression tests. The full `npm run verify:full` script runs this test before attempting package installation. Generate a reviewed Prisma migration for the new MFA fields before deploying this version.


## Release 0.4.0 hardening notes

- Adds mandatory authenticator-based MFA for Admin accounts.
- Uses restricted setup and challenge tokens; setup tokens carry no application roles.
- Encrypts TOTP secrets with AES-256-GCM and a separately configured 32-byte key.
- Rejects Admin access tokens without an MFA authentication claim.
- Prevents reuse of a TOTP time-step with an atomic database counter update.
- Adds dependency-free RFC 6238/AES-GCM crypto regression tests and a permission regression matrix.

## Server-side session management (release 0.5 preparation)

- Access tokens are short-lived and include a server-side session identifier.
- Every protected request verifies the session exists, belongs to the user, is not revoked and has not expired.
- Refresh tokens are opaque random secrets; only SHA-256 hashes are stored in PostgreSQL.
- Refresh tokens rotate on use. Reuse of an older token revokes the affected session and creates an audit event.
- `POST /api/v1/auth/session/logout` revokes the current session.
- `POST /api/v1/auth/session/logout-all` increments the account token version and revokes all sessions.
- `POST /api/v1/auth/session/refresh` rotates the refresh token and returns a new access token.

Refresh tokens are credentials. Store them only in platform-appropriate secure storage (Android Keystore/iOS Keychain for mobile; secure, HttpOnly, SameSite cookies are preferred for browser clients, with CSRF protections if cookie transport is adopted). Do not place refresh tokens in localStorage or logs.

The migration under `prisma/migrations/20261120_session_management` adds the session table. Review and apply it only after generating/validating the Prisma client and testing on a disposable database. Existing access tokens issued before this session change will no longer authenticate; users must sign in again after deployment.

## Release 0.6.0 — deployment safety gate

- Added a fail-closed check to `npm run prisma:deploy`: production migration deployment is blocked until at least one committed Prisma migration SQL file exists.
- Corrected `.env.example` formatting for the MFA encryption key entry.
- Added `prisma/migrations/README.md` with the safe initial migration-generation and review process.

Current known limitation: this source package still has no committed baseline migration SQL. Do not deploy it to production. Generate and review the baseline migration using Prisma CLI and a disposable PostgreSQL database first. `npm run check:production-migrations` currently exits with code 2 by design until that migration is committed.

## Automated backend verification (release 0.7.0)

A GitHub Actions workflow is included at `.github/workflows/backend-ci.yml`. When this repository is pushed to GitHub or a pull request is opened, it provisions a disposable PostgreSQL 16 service and runs dependency installation, static checks, MFA crypto tests, session checks, Prisma schema validation/client generation, migration generation/application, migration status and NestJS compilation.

The initial migration generator is `npm run prisma:migration:initial`. It asks the installed Prisma CLI to derive SQL from the actual `prisma/schema.prisma` using `prisma migrate diff --from-empty`. It refuses to overwrite an existing migration history. Review the generated SQL before committing it. The generator must run with a working Prisma CLI and does not prove the migration is safe for an existing production database.

`npm run verify:full` now expects a NEW, EMPTY, disposable development database. It generates the initial migration and applies it there. Never point this script at production or a database containing real student data.

The GitHub Actions workflow is prepared but has not been executed from this workspace. It will run only after the project is pushed to a GitHub repository. A successful CI run is necessary but not sufficient for production: endpoint-level role tests, live-provider tests, load testing, privacy review and independent penetration testing remain required.

Production startup now fails closed unless `MFA_ENCRYPTION_KEY` is present as exactly 64 hexadecimal characters. Generate a unique 32-byte value using a cryptographically secure random generator and store it in your deployment secrets manager. Never reuse the CI example key in production.
