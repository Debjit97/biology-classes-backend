# Admin MFA security verification checklist

These are required integration tests before production release. They require a real test PostgreSQL database and compiled NestJS app.

1. Active Admin with password only receives a restricted MFA setup token, not an access token.
2. Restricted setup token can call only the two MFA setup endpoints; it cannot access Admin, Teacher, Student or notification APIs.
3. Non-Admin user cannot start or confirm Admin MFA enrollment.
4. Admin enrollment secret is encrypted at rest; plaintext secret is returned only once during setup.
5. Incorrect/expired TOTP cannot enable MFA.
6. After successful enrollment, tokenVersion increments and the setup token is rejected.
7. Admin password login after enrollment returns a short-lived MFA challenge, not an access token.
8. Invalid/expired challenge token is rejected.
9. Valid TOTP produces a normal access token with MFA authentication context.
10. The same TOTP time-step cannot be replayed for a second login.
11. Admin access token without MFA authentication context is rejected.
12. Existing pre-MFA Admin tokens are rejected after deployment.
13. Removing Admin role or suspending account invalidates access on the next request.
14. Teacher and Student login paths continue to work without Admin MFA.
15. Missing/invalid MFA_ENCRYPTION_KEY causes MFA setup/verification to fail closed.
16. Audit events are written for enrollment start, enablement and successful login; secrets and OTP codes never appear in logs.

Do not mark this checklist passed based on static source inspection. Execute it as integration tests against the actual service and database.
