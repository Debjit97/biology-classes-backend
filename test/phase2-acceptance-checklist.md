# Phase 2 backend acceptance and security checklist

Run these checks in a disposable staging environment before any production use. A passing static audit is not a substitute for these tests.

## Build and database
- [ ] `npm ci` completes from the lockfile (create and commit `package-lock.json` after dependency review).
- [ ] `npx prisma validate` passes.
- [ ] `npx prisma generate` passes.
- [ ] `npm run build` passes with full TypeScript type checking.
- [ ] A clean PostgreSQL database can be migrated from zero using checked-in migration files.
- [ ] A second migration deployment is repeatable and makes no unintended schema changes.
- [ ] Database backup and restore are tested.
- [ ] `/api/v1/health` reports liveness; `/api/v1/health/ready` fails safely when PostgreSQL is unavailable.

## Authentication and account lifecycle
- [ ] Teacher registration normalizes email and creates a PENDING account, teacher profile and PENDING application atomically.
- [ ] Weak passwords are rejected; passwords are stored only as Argon2id hashes.
- [ ] Duplicate registrations return a safe conflict response, including concurrent duplicate attempts.
- [ ] Login fails with the same generic response for wrong password, unknown account and inactive account.
- [ ] Login and registration rate limits are enforced at the API gateway/shared limiter in addition to the in-process limiter.
- [ ] Tokens with wrong signature, algorithm, issuer, audience, expiry, subject or session version are rejected.
- [ ] Suspending/disabling a user or changing their token version invalidates existing tokens on the next request.
- [ ] Removing a role takes effect on the next authenticated request.
- [ ] Admin MFA, refresh-token rotation, logout/session revocation and secure account recovery are implemented before production.

## Authorization / IDOR
- [ ] Student cannot call Admin or Teacher endpoints.
- [ ] Teacher cannot review teacher applications, change roles, or access global settings.
- [ ] Teacher cannot notify an unassigned batch or a student outside assigned active batches.
- [ ] Teacher cannot send PAYMENT or SYSTEM notifications or message all users.
- [ ] Admin-only endpoints reject missing, expired and non-Admin tokens.
- [ ] Every resource lookup is checked for ownership/assignment at the service layer; test guessed UUIDs across users.
- [ ] UUID route parameters and all DTOs reject malformed or unexpected input.

## Teacher application workflow
- [ ] Only one concurrent Admin review can win for a PENDING application.
- [ ] Approval activates the teacher; rejection disables the account.
- [ ] Every decision is recorded in the audit log with actor, action, entity and timestamp.
- [ ] Existing access tokens are invalidated after a decision.

## Notifications
- [ ] Admin can target an individual, batch, all students or all teachers.
- [ ] Teacher can target an individual in an assigned batch or an assigned batch only.
- [ ] Audience and target fields cannot be mixed inconsistently.
- [ ] Deep links cannot be external URLs or protocol-relative redirects.
- [ ] Inbox and mark-read enforce recipient ownership.
- [ ] Channel workers enforce notification preferences/consent and retry idempotently.
- [ ] Provider failures, retries, duplicate delivery and dead-letter recovery are tested.
- [ ] Payment alerts are emitted only after verified, idempotent payment webhooks.

## Deployment and operations
- [ ] Production secrets are generated uniquely, stored in a secrets manager and never committed.
- [ ] Production startup rejects placeholder JWT secrets and empty CORS allowlists.
- [ ] HTTPS/TLS is enforced at the edge; database is private and encrypted at rest.
- [ ] Shared rate limiting is enabled for multi-instance deployments.
- [ ] Audit logs are access-controlled, retained and exported to tamper-resistant storage.
- [ ] Dependency, container, SAST, DAST and independent penetration testing are completed.
- [ ] Monitoring, alerting, incident response and restore drills are documented.

## Current implementation status
Implemented in source: authentication foundation, Argon2id password hashing, teacher pending-registration workflow, database-backed JWT account/role/session-version checks, role guards, transactional teacher review, strict DTO validation, in-process throttling, CORS/security headers, notification authorization rules, audit events and liveness/readiness endpoints.

Not yet implemented or externally verified: MFA, refresh tokens, account recovery and verification, shared/distributed throttling, notification delivery workers/provider integrations, payment webhook module, complete integration/authorization tests, generated/committed Prisma migration history, production deployment and independent security testing.
