# Authorization regression matrix — required integration execution

The current controllers use JWT authentication plus explicit role policies. This matrix must be executed against a real test database before production.

| Actor | Operation | Expected |
|---|---|---|
| Unauthenticated | Any protected Admin/Teacher/Student endpoint | 401 |
| Pending Teacher | Login | Rejected as inactive |
| Active Teacher | Review teacher applications | 403 |
| Active Student | Send Teacher notification | 403 |
| Active Teacher | Notify unassigned batch | 403 |
| Active Teacher | Notify assigned batch | Allowed only for assigned recipients |
| Active Teacher | Send PAYMENT or SYSTEM category | 403 |
| Active Student | Read another student's notification | Not returned |
| Active Student | Mark another student's notification read | No cross-user update |
| Active Admin without MFA | Admin API using password-only/setup token | 401/403 |
| Active Admin with MFA | Admin API with valid MFA-authenticated token | Allowed |
| Suspended Admin | Any protected API using previously issued token | 401 |
| Admin after role removal | Any Admin API using previously issued token | 401/403 |

Do not mark this matrix passed from static checks. It requires endpoint-level tests with seeded role/account fixtures and a running PostgreSQL database.
