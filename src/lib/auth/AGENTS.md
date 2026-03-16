# Auth (`src/lib/auth/`)

Authentication, authorization, and access control. WebAuthn (passkeys) for login, cookie-based sessions, role-based authorization with policy functions, rate limiting, IP bans, and pseudonym generation.

## Files

| File | Role |
|------|------|
| `auth.ts` | Core auth: `SessionUser` type, session CRUD (create/validate/destroy), WebAuthn config, credential storage, cookie management, `isFirstUser()` for setup flow |
| `authorize.ts` | Policy-based authorization: `authorize()` returns `SessionUser \| Response` (gate check for API endpoints), `can()` returns boolean (UI capability check). Defines all `Action` types |
| `rate-limit.ts` | Rate limiting: `checkRateLimit()`, `recordAttempt()`, `cleanupOldAttempts()`. Per-role limits (guest: 10/hr, editor: 50/hr). Uses `uploadAttempts` DB table |
| `ban-service.ts` | `banUser()`, `unbanUser()`, `isIpBanned()`. Guests get IP-banned via `bannedIps` table. Uses `withBatch()` for atomic multi-statement writes |
| `pseudonym.ts` | `generatePseudonym()` — random `cyclist-XXXX` names for anonymous guest accounts |

## Gotchas

- **`authorize()` returns `SessionUser | Response`** — NOT a boolean. Check with `instanceof Response` before using the user. For boolean UI checks, use `can()` instead.
- **Banned users are rejected in `authorize()`** — `user.bannedAt` is checked before the policy function runs.
- **Three roles**: `admin`, `editor`, `guest`. Most actions are open to all roles; admin-only actions include: `set-status`, `revert-commit`, `manage-users`, `delete-media`, `sync-staging`.
- **Session cookies**: `session_token` (httpOnly) and `logged_in` (readable by JS for UI state). 30-day expiry.
- **WebAuthn challenge cookies** expire in 5 minutes and are consumed on use (single-use).
- **Rate limit identifiers** can be multiple per check (e.g., both user ID and IP address).

## Cross-References

- `src/middleware.ts` — validates session tokens, populates `locals.user`
- `src/views/api/auth/` — WebAuthn registration/login endpoints
- `db/schema.ts` — `users`, `sessions`, `credentials`, `uploadAttempts`, `bannedIps` tables
