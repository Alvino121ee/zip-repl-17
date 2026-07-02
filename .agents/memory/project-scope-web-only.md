---
name: Web-only project scope
description: Records that the mobile artifact was intentionally removed; project targets web only
---

The `saham-radar-mobile` Expo artifact was removed at the user's request. The project is web-only: the "saham-radar" web app plus "api-server" backend, run either via Replit workflows or locally via `start.sh` (Linux/macOS) / `start.bat` (Windows) at the repo root.

**Why:** User only wants the website; maintaining a parallel Expo mobile app was unnecessary scope.

**How to apply:** Don't recreate a mobile artifact, don't add mobile-specific workflows, and don't reference saham-radar-mobile in scripts or docs unless the user explicitly asks for mobile support again. `start.sh`/`start.bat` are the intended "run everything locally" entry points — keep them in sync if the dev commands or ports change.
