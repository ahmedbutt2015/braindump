# BrainDump — Claude Context

## What This App Does

A thought-dumping app where users write (or speak) anything on their mind. The AI extracts actionable tasks and — critically — cross-references them with everything the user has previously dumped. It is not a plain note-taker or task manager. The defining feature is **memory across dumps**: if a new dump mentions something already tracked as a task, the AI should connect them, update context, and avoid duplicating work.

Example: user dumps "met Jake at the networking event, he's a hiring manager at CyberX". The AI sees there's already a pending task "Research security job openings". Instead of creating a new task, it enriches the existing one: "Research security job openings — contact Jake from CyberX (met at networking event)".

## Architecture

**Framework:** Next.js 16, App Router. All server components are async, all client components are in `components/` or named `*-content.tsx`.

**Auth:** Supabase Auth via `@supabase/ssr`. Two client factories:
- `lib/supabase/server.ts` — server components and API routes (cookie-based)
- `lib/supabase/client.ts` — client components (singleton)

The middleware at `middleware.ts` calls `lib/supabase/middleware.ts` which refreshes the session cookie on every request. Protected routes redirect to `/auth/login`.

**AI (task extraction):** `app/api/extract-tasks/route.ts` calls Hugging Face directly via `fetch` — no Vercel AI SDK, no OpenAI. Model: `mistralai/Mistral-7B-Instruct-v0.3` via the HF OpenAI-compatible chat completions endpoint (`/v1/chat/completions`). Pipeline:
1. Fetch last 5 brain dumps + last 10 pending tasks for context
2. POST to HF with a system prompt that demands raw JSON output (no markdown)
3. Strip any accidental code fences from the response, then `JSON.parse` + Zod validate
4. Save dump + tasks to Supabase

Uses `HUGGINGFACE_API_TOKEN` — the same token used by the voice transcription route. No OpenAI key needed anywhere.

Cold-start handling: HF free tier returns `{ error: "...loading..." }` with status 503. The route returns `{ modelLoading: true, retryAfter: N }` and the dashboard shows a warning toast with the wait time.

**Voice (not yet on main):** Branch `voice-command-generation` has:
- `components/voice-input-button.tsx` — tries Web Speech API first, falls back to Hugging Face Whisper if browser doesn't support it or mic is denied
- `hooks/use-speech-recognition.ts` — wraps the Web Speech API
- `app/api/transcribe/route.ts` — sends audio to `openai/whisper-large-v3` on Hugging Face; returns `{ modelLoading: true }` if the model is cold (HF free tier)

## Key Files

| File | Purpose |
|------|---------|
| `app/api/extract-tasks/route.ts` | Core AI pipeline: dump → tasks |
| `app/api/transcribe/route.ts` | Voice → text via Hugging Face Whisper (branch only) |
| `app/dashboard/page.tsx` | Server component: auth check + initial SSR data fetch |
| `app/dashboard/dashboard-content.tsx` | Client shell: SWR data, handlers for dump/status/delete |
| `components/brain-dump-input.tsx` | Textarea + submit button (voice button not yet wired in on main) |
| `components/task-list.tsx` | Task sections, status cycling, delete |
| `components/recent-dumps.tsx` | Sidebar with last 5 dumps |
| `lib/supabase/server.ts` | Supabase client for server-side code |
| `lib/supabase/client.ts` | Supabase singleton for client-side code |
| `middleware.ts` | Session refresh on every request |

## Database Tables

```
brain_dumps: id, user_id, content, created_at
tasks: id, user_id, brain_dump_id, title, description, priority (low/medium/high), status (pending/in_progress/completed), due_date, created_at, updated_at
```

RLS: both tables should have row-level security so users only see their own rows. **Verify this is actually configured in Supabase before shipping.**

## Data Flow

1. User types (or speaks) → `BrainDumpInput` calls `onSubmit(content)`
2. `DashboardContent.handleDumpSubmit` POSTs to `/api/extract-tasks`
3. API route fetches context, calls GPT-4o-mini, saves dump + tasks to Supabase
4. Returns `{ tasksExtracted, summary }`
5. Client calls `mutate('tasks')` and `mutate('dumps')` to revalidate SWR caches
6. Task list and recent dumps sidebar re-render with fresh data

## The Core Feature Not Yet Built

The current AI prompt includes existing tasks to avoid duplicates, but it doesn't yet:
- Detect when a new dump is related to an existing task and enrich it
- Link a dump to multiple existing tasks
- Show "related" dumps/tasks in the UI

This is the main differentiator and the most important thing to build next. The prompt engineering for this lives in `app/api/extract-tasks/route.ts` around line 64.

The API route will need a new return shape — alongside `tasks` (new tasks to create), it should also return `enrichments` (existing task IDs + what context to append). The DB call to apply enrichments would be a `UPDATE tasks SET description = ... WHERE id = ...`.

## Known Bugs / Issues to Fix Before Shipping

| Location | Issue | Priority |
|----------|-------|----------|
| `app/dashboard/dashboard-content.tsx:80` | Uses `alert()` for error feedback — replace with `sonner` toast | Low |
| Supabase dashboard | RLS policies on `brain_dumps` and `tasks` not verified — must confirm users can only see their own rows | **Critical** |
| `app/api/extract-tasks/route.ts` | No rate limiting — one user can make unlimited AI calls | **Critical** |
| `app/api/transcribe/route.ts` | No rate limiting on voice transcription endpoint | **Critical** |
| Supabase dashboard | No `updated_at` trigger — app writes it manually but direct DB access bypasses it | Medium |
| `app/dashboard/dashboard-content.tsx` | No error boundary — unhandled error kills the whole page | Medium |

## What This App Is (for context when writing copy or prompts)

This is NOT a note-taking app. It is NOT a task manager. It is a second brain with memory.

The key pitch: most productivity apps make you organize as you go. BrainDump lets you dump everything raw and the AI organises it — but more importantly, it remembers. When you dump something new, the AI already knows everything you've dumped before and connects the dots automatically.

Landing page copy (approved):
> "Your thoughts don't disappear here. Most apps make you organize as you go. BrainDump lets you dump everything raw — text or voice — and the AI does the organizing. But what's different: it remembers. Every dump, every task, every connection you've ever made lives in context. So when you mention someone you met, or an idea you had, the AI already knows what's open, what's related, and what needs updating. It's not a note app. It's not a task manager. It's a second brain that actually reads what you put in it."

## Recommended Ship Order

1. **Merge voice branch** — biggest UX impact, nearly done. Voice is the natural input mode for quick thought capture
2. **Smart task linking** — the core differentiator; without it the app is just a worse Todoist  
3. **RLS verification + rate limiting** — required before any public access
4. **First-time user onboarding** — empty state with guided first dump; new users churn without it
5. **Task editing + dump → task view** — lets users trust and correct the AI
6. **Landing page redesign (futuristic UI)** — once core works, make it look like the pitch
7. **Mobile UX + search** — daily use and scale

## Conventions

- Use `createClient()` from `@/lib/supabase/server` in server components and API routes
- Use `createClient()` from `@/lib/supabase/client` in client components (memoized singleton)
- All Supabase queries should `.eq('user_id', user.id)` — don't rely on RLS alone while building
- SWR keys: `'tasks'` and `'dumps'` — mutate both after any dump submission
- Optimistic updates: call `mutate(key, updater, false)` then revert on error

## Full Tech Stack (Frontend vs Backend)

There is **no separate backend server**. This is a single full-stack Next.js app.

- **Frontend:** React 19, Next.js 16 App Router, shadcn/ui (Radix UI), Tailwind CSS v4, SWR for client data fetching with optimistic updates
- **Backend:** Next.js API Routes in the same repo — deployed as Vercel serverless functions. No Express, no separate process
- **Database:** Supabase (hosted PostgreSQL). Accessed via `@supabase/ssr` — two modes: server (cookie-based) and browser (singleton)
- **Auth:** Supabase Auth. JWT tokens. Middleware refreshes the session cookie on every request
- **AI:** Hugging Face `mistralai/Mistral-7B-Instruct-v0.3` for task extraction + `openai/whisper-large-v3` for voice — both via direct `fetch` to HF API, free tier, one shared `HUGGINGFACE_API_TOKEN`
- **Voice:** Web Speech API (browser-native, zero cost) → Hugging Face Whisper-large-v3 fallback (free tier, ~20s cold start on first use)
- **Hosting:** Vercel — frontend + serverless functions deploy together

## Environment Variables Needed

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
HUGGINGFACE_API_TOKEN   # required — covers both task extraction (Mistral-7B) and voice transcription (Whisper)
```
