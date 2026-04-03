# Auth (`src/lib/auth/`)

Authentication, authorization, and access control.

## Files

| File | Role |
|------|------|
| `auth.ts` | Core auth: `SessionUser` type, session CRUD, WebAuthn config, credential storage, cookie management, `isFirstUser()` |
| `authorize.ts` | Policy-based authorization: `authorize()` returns `SessionUser \| Response`, `can()` returns boolean. Defines all `Action` types |
| `rate-limit.ts` | `checkRateLimit()`, `recordAttempt()`, `cleanupOldAttempts()`. Per-role limits (guest: 10/hr, editor: 50/hr) |
| `ban-service.ts` | `banUser()`, `unbanUser()`, `isIpBanned()`. Uses `withBatch()` for atomic writes |
| `pseudonym.ts` | `generatePseudonym()` — random `cyclist-XXXX` names for anonymous guests |

## Gotchas

- **`authorize()` returns `SessionUser | Response`** — NOT a boolean. Check with `instanceof Response`. For boolean UI checks, use `can()`.
- **Banned users are rejected in `authorize()`** before the policy function runs.
- **Three roles**: `admin`, `editor`, `guest`. Admin-only: `set-status`, `revert-commit`, `manage-users`, `delete-media`, `sync-staging`.
- **Session cookies**: `session_token` (httpOnly) + `logged_in` (JS-readable). 30-day expiry.

## Detailed Context

- [Save pipeline (authorize every endpoint)](../../../_ctx/save-pipeline.md)
