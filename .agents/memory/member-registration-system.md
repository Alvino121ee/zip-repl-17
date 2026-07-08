---
name: Member Registration System
description: Email+password member registration with SMTP email verification (6-digit OTP)
---

# Member Registration System

## Architecture
- New `membersTable` in DB: id, email, passwordHash, emailVerified, verificationCode, verificationExpiry, sessionToken, sessionExpiry, createdAt, updatedAt
- SMTP email sending via nodemailer (`lib/email-smtp.ts`), config stored in DB via `getSmtpSettings()`/`setSmtpSettings()`
- Session token: random 32-byte hex, stored in members table, 30-day server-side expiry. Stored as `gr_member_token` in sessionStorage.
- Member email stored in `gr_member_email` sessionStorage key.

## Auth Routes (POST /auth/...)
- `/login` — email+password for member, password-only for admin. Legacy member_password fallback when no email provided.
- `/register` — creates member, sends 6-digit OTP via SMTP
- `/verify-email` — verifies OTP, creates session token, auto-activates
- `/resend-verification` — resends OTP
- `/logout` — clears session token from DB

## Rate Limiting
- `/login`: 20 req/15min per IP
- `/verify-email`: 10 req/15min per IP
- `/resend-verification`: 2 req/1min per IP
- `/register`: 10 req/1hr per IP

## Backward Compatibility
- `requireMember` middleware checks in order: admin token → old `member_password` → new session token (backend fallback still exists)
- The member login UI no longer exposes a legacy "Akses lama (tanpa email)" toggle (removed 2026-07-08) — email+password is the only front-end path now, though the backend fallback remains for any pre-existing token holders
- The `/api/admin/member-password` route and the `member.hasPassword` field on `getSettingsSummary()`/`/api/admin/system` were already gone from the backend before this — a leftover "Akses Member" admin UI card still referenced `data.member.hasPassword`, causing a crash. Removed that dead card (2026-07-08); real member management is the existing `/api/admin/members` list + `MembersPanel`.

## Admin Panel
- Members list at `GET /api/admin/members` — shows email, verified status, join date
- Delete member at `DELETE /api/admin/members/:id`
- SMTP settings at `GET/POST /api/admin/settings/smtp`
- SMTP test at `POST /api/admin/settings/smtp/test`

## Key Notes
- TLS cert validation: `rejectUnauthorized: process.env.NODE_ENV === "production"` (disabled in dev for self-signed certs)
- `pnpm --filter @workspace/db run push` must be run after schema changes
- SMTP settings stored in `xauusd_settings` table with keys: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from

**Why:** Single shared member_password was insecure and didn't scale; individual email+password accounts needed.
**How to apply:** When adding new member-facing features, check `emailVerified` status before granting access.
