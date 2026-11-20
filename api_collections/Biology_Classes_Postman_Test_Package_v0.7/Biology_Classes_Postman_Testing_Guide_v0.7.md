# Postman local testing guide — BIOLOGY CLASSES backend v0.7.0

## Import
1. Open Postman.
2. Import `Biology_Classes_Localhost_Postman_Collection_v0.7.json`.
3. Import `Biology_Classes_Localhost_8080.postman_environment.json`.
4. Select the **BIOLOGY CLASSES - Localhost 8080** environment.

## Important: backend port
The backend code defaults to port **3000**, not 8080. To use the requested `http://localhost:8080`, set `PORT=8080` in the backend `.env` before starting it. Alternatively, change the environment variable `baseUrl` to `http://localhost:3000`.

The API prefix is `/api/v1`, already included in each request.

## Suggested test order
1. `Liveness` — confirms the API process responds.
2. `Readiness - database` — confirms PostgreSQL is reachable.
3. `Register teacher application` — use a unique email and strong password.
4. Admin login / MFA enrollment or verification:
   - Set `loginEmail` and `loginPassword` to the local Admin credentials.
   - First Admin login returns `setupToken` if MFA has not been enrolled. Run `Start Admin MFA setup`, add the returned secret/otpauth URI to an authenticator app, then enter its current code in `adminTotpCode` and run `Confirm Admin MFA setup`.
   - Sign in again. Once MFA is enabled, Admin login returns `challengeToken`; run `Verify Admin MFA login` with a fresh code.
   - Admin protected endpoints require the MFA-completed `accessToken`.
5. Use Admin `List pending teacher applications`, copy the application UUID into `teacherApplicationId`, then approve/reject.
6. Sign in as a teacher or student using `Login`; access and refresh tokens are saved automatically.
7. Test notification inbox, send and mark-read endpoints using valid local user/batch/recipient IDs.

## Token handling
- Login, MFA verification and refresh requests save returned tokens to collection variables.
- Refresh rotates the refresh token. Always use the newly saved token; do not replay an old one.
- Tokens, Admin MFA secrets and authenticator codes are credentials. Do not share exports containing real values or commit them to source control.
- `Logout current session` and `Logout all sessions` clear the local Postman access/refresh variables after the request.

## Scope and limitations
This collection reflects only routes actually present in backend v0.7.0:
- Health/readiness
- Teacher registration
- Login, Admin MFA setup/verification, refresh and logout
- Admin teacher-application review
- Admin/Teacher notification creation and notification inbox/read status

It does **not** test course/material/flipbook, quiz/exam, live-class, payment, attendance, reports, or app-branding APIs because those modules/routes are not yet implemented in this backend package. No live email/SMS/push delivery is claimed. The collection has not been run against a live localhost server; it is generated from the source routes and DTOs.
