---
name: Auth system design
description: Two-tier bearer-token auth for admin (SESSION_SECRET) and member (DB password). How tokens flow from login to API.
---

## Auth tiers

| Tier | Route | Password source | sessionStorage key |
|------|-------|----------------|-------------------|
| Admin | /admin | `SESSION_SECRET` env var | `gr_admin_token` |
| Member | /member | `member_password` in xauusd_settings DB | `gr_member_token` |

Admin token also satisfies member-level checks (admin can do everything member can).

## Backend

- `POST /api/auth/login` — `{ role: "admin"|"member", password }` → `{ ok, token, role }` or 401
- `requireAdmin` — in both `routes/admin.ts` and `routes/xauusd.ts` (duplicated intentionally for file isolation)
- `requireMember` — only in `routes/xauusd.ts`, checks admin token first then member token via async DB lookup

### Protected routes
- Admin: `GET /admin/system`, `POST /xauusd/settings/deepseek-key`, `POST /xauusd/settings/timeframe`, `POST /xauusd/settings/whatsapp`, `POST /xauusd/settings/whatsapp/test`, `DELETE /xauusd/brain/:id`, `POST /admin/member-password`
- Member: `POST /xauusd/chat`

## Frontend

- `src/lib/auth.ts` — `getAdminToken()`, `getMemberToken()`, `getAuthToken()`, `authFetch()`, `logout()`
- `src/pages/login.tsx` — unified login, pre-selects role via `?role=` param, redirects via `?redirect=`
- `src/pages/member.tsx` — full ChatGPT-style page, layout has its own sidebar (no Layout wrapper)
- `src/pages/admin.tsx` — protected panel with settings + member password management
- `src/App.tsx` — /login and /member render WITHOUT the Layout wrapper; / and /admin use Layout

## Security note
Token = raw password (credential reuse pattern). Acceptable for self-hosted single-admin app.
If upgrading: issue random opaque session token server-side, store with TTL, return that instead.

**Why:** Follows same pattern as existing `requireAdmin` which already used SESSION_SECRET as bearer.
**How to apply:** When adding new sensitive backend routes, apply `requireAdmin` or `requireMember` before the handler. When adding new frontend pages that need auth, check `getAdminToken()` / `isMember()` and redirect to `/login?role=X&redirect=/target`.
