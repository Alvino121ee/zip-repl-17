---
name: Agent System Architecture
description: How the 3 specialized AI agents work — shared DeepSeek API, per-agent DB config, few-shot training, session memory
---

## Architecture

- **1 DeepSeek API key** shared by 3 agents (fundamental, technical, screening)
- Agent configs stored in `agent_configs` table (`agentId`, `systemPrompt`, `trainingExamples` as JSON)
- Conversation memory stored in `agent_memories` table (per `agentId` + `sessionId`)

## Key files

- `lib/db/src/schema/agents.ts` — DB schema for both tables
- `artifacts/api-server/src/lib/agent-engine.ts` — core engine: loads config → injects few-shot → appends memory → calls DeepSeek → saves reply
- `artifacts/api-server/src/routes/agents.ts` — REST routes under `/api/agents/`
- `artifacts/saham-radar/src/pages/agents.tsx` — frontend with chat UI + training editor per agent

## Message construction order

1. System prompt (from DB, optionally with injected market context data)
2. Few-shot training examples (from DB, as alternating user/assistant turns)
3. Session memory (last 20 messages from DB)
4. Current user message

## Session isolation

- Frontend generates session ID via `sessionStorage` (per browser tab)
- Backend REQUIRES `sessionId` — no "default" fallback (returns 400 if missing)
- Memory trimmed to 40 messages per session automatically

## Context data per agent type

- `fundamental`: top 10 stocks with PE, PB, ROE, D/E, dividend yield
- `technical`: top 10 stocks with RSI, MA20/50/200, support, resistance, trend score
- `screening`: top 20 stocks by total score with sector, label, price change

## API contracts (important)

Raw function calls (used in useMutation mutationFn):
- `chatWithAgent(agentId, { message, sessionId })` — NOT `{ data: { ... } }`
- `updateAgentConfig(agentId, { systemPrompt, trainingExamples })` — NOT `{ data: { ... } }`
- `clearAgentMemory(agentId, { sessionId })` — second arg is query params
- `getAgentMemory(agentId, { sessionId })` — second arg is query params

**Why:** Orval generates two shapes — the raw function takes direct params, the hook's `mutate({ data: ... })` shape is only for the `useMutation` variable wrapper.

## Training system

- `trainingExamples` is a JSON array of `{ input: string; output: string }`
- Editable from the web UI — each agent has "Tabel Pelatihan & System Prompt" panel
- Changes take effect immediately (no server restart needed)
- PUT /api/agents/:agentId/config to update

## Seeding

- `ensureAgentsExist()` called on first request to `/api/agents` — seeds 3 default agents if DB is empty
- Flag `seeded` prevents re-checking on every request
