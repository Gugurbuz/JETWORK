# Supabase setup

This folder contains the database baseline inferred from the current JetWork frontend.

## What the baseline creates

The migrations create the tables currently used by the app:

- `users` and `roles` for auth profile and onboarding data.
- `projects` and `workspaces` for the project tree.
- `messages`, `documents`, `document_versions`, and `raw_responses` for chat, generated analysis content, version history, and AI raw output storage.
- `shared_analyses` for share links.
- `settings` for prompt and AI configuration.

The baseline also enables row level security and adds policies around workspace membership. Workspace membership is determined by the workspace owner or by an email entry in the workspace `collaborators` JSON array.

## Apply locally

From a machine with the Supabase CLI configured:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

For a new local Supabase instance:

```sh
supabase start
supabase db reset
```

## Required secrets

The Edge Function under `supabase/functions/analyze` expects a Gemini API key. Set it as a Supabase secret before deploying the function:

```sh
supabase secrets set GEMINI_API_KEY=<your-gemini-api-key>
supabase functions deploy analyze
```

The frontend also needs the public Supabase URL and anon key through the Vite environment variables documented in the root `.env.example`.

## Username login

The frontend supports signing in with either email or username. Username sign-in uses the `lookup_email_for_username` RPC, which returns only the matching email address and avoids granting anonymous clients direct `users` table reads.

## Security notes

This is a functional baseline, not the final authorization model.

- `shared_analyses` can be read by any authenticated user who has a share id. This matches the current share-link flow, but a production version should add expiry, owner controls, or signed access tokens.
- `settings` can currently be managed by any authenticated user because the app does not yet model administrators. Once admin roles are added, this policy should be restricted.
- Workspace collaborators are stored as JSON email entries today. A normalized membership table would make access rules easier to audit and safer to evolve.

## Realtime

The initial migration adds realtime publication entries for `projects`, `workspaces`, `messages`, and `documents`, which are the tables currently subscribed to by the app.
