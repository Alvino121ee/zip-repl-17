---
name: Orval Codegen Command
description: How to regenerate the TypeScript API client after changing openapi.yaml
---

## Command

```bash
pnpm --filter @workspace/api-spec run codegen
```

This runs `orval --config ./orval.config.ts && pnpm -w run typecheck:libs`.

**Why:** The codegen config is in `lib/api-spec/`, not in `lib/api-client-react/`. The script lives in `@workspace/api-spec` package. Running it on the wrong package gives "None of the selected packages has a generate script".

## Output locations

- `lib/api-client-react/src/generated/api.ts` — hooks + raw functions
- `lib/api-client-react/src/generated/api.schemas.ts` — TypeScript types
- `lib/api-zod/src/generated/api.ts` — Zod validators

## After codegen

Restart the affected workflow if the API server also changed. Vite dev server for the web app picks up the new generated files automatically via HMR.
