# JetWork AI

JetWork AI is a collaborative business-analysis workspace. It turns project conversations and source material into evidence-aware conceptual analysis documents while preserving human control over high-impact document changes.

## Product Architecture

The web client is React 19, TypeScript, Vite, Zustand, and TipTap. Supabase provides authentication, Postgres persistence, Realtime collaboration, private source storage, and server-side Edge Functions.

The new runtime is protected by `VITE_SINGLE_ASSISTANT_RUNTIME` and uses one simple chat surface:

1. `useMessages` records the user turn and calls the authenticated `openai-assistant` Edge Function.
2. The Edge Function loads the single active prompt version and calls the OpenAI Responses API with `gpt-5.6-sol`.
3. Published, workspace-scoped knowledge is available only through strict read-only tools.
4. Conversation turns, idempotency leases, usage, and tool audit records stay server-side in Supabase.
5. TXT/MD sources are ingested as drafts and become visible to the assistant only after explicit publication.

With the flag disabled, the existing Gemini/BA orchestration remains unchanged as the rollback path. See `docs/SINGLE_ASSISTANT_RUNTIME.md` for the rollout and acceptance gate.

## Prerequisites

- Node.js 22.13 or newer (Node.js 24 is used in CI)
- pnpm 11.9 or newer
- A Supabase project
- Supabase CLI for migrations and Edge Function deployment

## Local Setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm run dev
```

Required browser environment variables:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
```

`OPENAI_API_KEY` and the legacy `GEMINI_API_KEY` are server-side Edge Function secrets. Never expose either through a `VITE_` variable.

```bash
supabase secrets set OPENAI_API_KEY=your-key
supabase functions deploy ingest-knowledge-source
supabase functions deploy openai-assistant

# Legacy rollback runtime only
supabase secrets set GEMINI_API_KEY=your-key
supabase functions deploy gemini-chat
```

## Database

Apply migrations in order:

```bash
supabase db push
```

The current migrations also cover version-pinned knowledge publication and the server-only assistant runtime. Review the target project before applying migrations to an existing production database.

The RLS contract is executable with a local Supabase stack:

```bash
supabase test db supabase/tests/rls_contract.sql
```

All tables exposed through Supabase Data APIs must have Row Level Security enabled and ownership or workspace-membership policies. Enabling RLS without matching policies can block application access, so production policy changes require a reviewed migration and a smoke test with owner and non-member accounts.

## Verification

```bash
pnpm run lint
pnpm test
pnpm run verify:ai-ba-engine
pnpm run verify:ai-turn-decision
pnpm run verify:deep-ba-assistant
pnpm run verify:product-runtime
pnpm run verify:document-quality
pnpm run verify:assistant-runtime
pnpm run build
```

Authenticated browser smoke tests use Playwright and never store credentials in the repository:

```bash
E2E_BASE_URL=https://jetwork.vercel.app \
E2E_USERNAME=your-user \
E2E_PASSWORD=your-password \
pnpm run test:e2e
```

The browser suite covers login, project/workspace creation, AI document generation, canonical Word headings, XSS non-execution, opaque sharing, and revocation. GitHub Actions runs it only when `E2E_USERNAME` and `E2E_PASSWORD` secrets are configured.

GitHub Actions runs the same typecheck, unit tests, behavior regressions, and production build for pull requests and pushes to `main`.

## Deployment

The frontend is deployable to Vercel with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured in the project environment. Database migrations and Edge Functions are deployed separately through Supabase. Keep `VITE_SINGLE_ASSISTANT_RUNTIME=false` until migrations, secrets, both new Edge Functions, and the five golden questions are verified in the target workspace.

Before release, verify:

- Supabase migrations are applied to the intended project.
- `OPENAI_API_KEY` exists only in Supabase Edge Function secrets.
- `ingest-knowledge-source` and `openai-assistant` are deployed with JWT verification enabled.
- `GEMINI_API_KEY` exists only in Supabase Edge Function secrets.
- RLS policies prevent cross-workspace reads and writes.
- The behavior regression suite passes.
- A user can create a workspace, send a message, generate a document, preview a high-impact change, confirm it, and reload persisted memory.

## Repository Map

- `src/services/assistantRuntimeClient.ts`: authenticated SSE client for the new runtime
- `src/services/knowledgeCatalogRepository.ts`: TXT/MD ingestion and publication client
- `supabase/functions/openai-assistant`: Responses API and read-only tool loop
- `supabase/functions/ingest-knowledge-source`: deterministic source ingestion
- `src/services/ai/aiTurnDecision.ts`: legacy turn-level behavior decision contract
- `src/services/singleChatOrchestrator.ts`: active single-chat orchestration
- `src/services/baAgentLoop.ts`: decision-controlled analysis execution
- `src/services/evidenceClaims.ts`: evidence ledger validation
- `src/services/documentPostProcessor.ts`: read-only normalization and quality assessment
- `src/services/projectMemoryRepository.ts`: persistent project memory
- `src/services/pendingOperationRepository.ts`: preview and confirmation persistence
- `supabase/functions/gemini-chat`: legacy server-side Gemini gateway
- `supabase/migrations`: database changes
- `scripts`: deterministic behavior regression scenarios
