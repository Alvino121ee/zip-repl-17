---
name: Member area ChatGPT-style redesign
description: Layout and auth patterns used for the member chat area redesign (sidebar + multi-panel).
---

- Member area (`member.tsx`) uses a ChatGPT-style layout: collapsible sidebar (new chat, conversation history, panel nav, user/logout footer) + main content that switches between three panels (Chat, Prediksi AI, Sinyal Mentor) via local `Panel` state — not separate routes.
- Conversation history is client-side only (localStorage, capped list), keyed by a `crypto.randomUUID()` id — there is no backend multi-conversation persistence; `/chat` is a single stateless endpoint keyed by `sessionId`.
- **Why:** avoids inventing fake backend persistence; keeps the richer "slides" UI the user wants without backend schema changes.
- **How to apply:** any async mutation whose result must be written back into a specific conversation must bind the conversation id as a mutation *argument* (not read from live component state) — otherwise switching chats mid-request corrupts the wrong conversation's history.
- All member-gated API calls (`/predict`, `/mentor-signal`, `/chat`) must handle `401` identically: clear both member and admin tokens and redirect to `/login/member?redirect=/member`. A shared `forceReauth`/`onAuthError` callback should be passed down to any panel component making its own fetch, not just the main chat mutation.
