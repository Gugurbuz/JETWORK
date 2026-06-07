# JetWork

JetWork is an AI-assisted business analysis and conceptual design workspace. It combines a realtime project chat, collaborative workspaces, Supabase-backed documents, and Gemini-powered document generation for BA analysis and review workflows.

## What This App Does

- Authenticates users with Supabase Auth.
- Manages projects, workspaces, participants, messages, documents, and document versions in Supabase.
- Streams Gemini responses through the `supabase/functions/gemini-chat` Edge Function.
- Generates and updates BA analysis / conceptual design documents in the right-side document panel.
- Applies a document quality gate before presenting generated analysis output.

## Tech Stack

- React 19
- Vite 6
- TypeScript
- Tailwind CSS 4
- Zustand
- Supabase Auth, Realtime, Database, and Edge Functions
- Google Gemini via `@google/genai`
- Tiptap, marked, bpmn-js, mammoth

## Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- Supabase CLI, if you deploy Edge Functions locally or from the command line
- A Gemini API key

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Fill these values:

```bash
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-supabase-anon-key"
GEMINI_API_KEY="your-gemini-api-key"
ALLOWED_ORIGINS="http://localhost:5173,https://your-app.vercel.app"
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are used by the browser app. `GEMINI_API_KEY` and `ALLOWED_ORIGINS` are used by the Supabase Edge Function and should be configured as Supabase secrets in deployed environments.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the Vite dev server:

```bash
npm run dev
```

Run type checks:

```bash
npm run lint
```

Build for production:

```bash
npm run build
```

## Supabase Edge Function

The Gemini proxy lives at:

```text
supabase/functions/gemini-chat/index.ts
```

Set the Gemini key and allowed browser origins as Supabase secrets before deploying:

```bash
supabase secrets set GEMINI_API_KEY="your-gemini-api-key"
supabase secrets set ALLOWED_ORIGINS="http://localhost:5173,https://your-app.vercel.app"
```

If `ALLOWED_ORIGINS` is omitted, the function keeps permissive CORS behavior. Set it in production to restrict browser calls to known app domains.

Deploy the function:

```bash
supabase functions deploy gemini-chat
```

## Database Notes

The frontend expects these Supabase tables to exist:

- `users`
- `roles`
- `projects`
- `workspaces`
- `messages`
- `documents`
- `document_versions`
- `shared_analyses`
- `settings`
- `raw_responses`

Migration and RLS policy files should be kept under `supabase/migrations` so the database can be reproduced consistently across environments.

## Deployment

The app can be deployed to Vercel as a Vite application. Configure the browser environment variables in Vercel and configure `GEMINI_API_KEY` and `ALLOWED_ORIGINS` as Supabase secrets for the Edge Function.

## Current Product Focus

The current document model makes BA analysis / conceptual design the primary generated section. IT analysis, test, and BPMN/FLOW fields are retained for backward compatibility and may be reintroduced as advanced sections later.
