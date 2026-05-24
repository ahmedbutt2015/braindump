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

**AI (task extraction):** `app/api/extract-tasks/route.ts` calls Hugging Face directly via `fetch`. Model: `deepseek-ai/DeepSeek-V3-0324` via the HF router (`router.huggingface.co/v1/chat/completions`). Pipeline:
1. Fetch last 5 brain dumps + last 15 pending tasks (with subtasks) for context
2. POST to HF with a system prompt that demands raw JSON — no markdown
3. Strip any accidental code fences, `JSON.parse` + Zod validate
4. Apply enrichments (append context to existing task descriptions) and subtask additions
5. Save dump + new tasks + api_log to Supabase

Response shape: `{ tasks[], enrichments[], subtask_additions[], summary }`. All three arrays are applied separately so new dumps can update existing tasks without duplicating them.

Uses `HUGGINGFACE_API_TOKEN`. Cold-start handling: HF free tier returns `{ error: "...loading..." }` with status 503. The route returns `{ modelLoading: true, retryAfter: N }` and the dashboard shows a warning toast.

**Voice:** On `main`. Two-tier:
- `components/capture-zone.tsx` — primary UI; uses Web Speech API via `hooks/use-speech-recognition.ts`; falls back to MediaRecorder → `POST /api/transcribe` → HF Whisper-large-v3
- `components/voice-input-button.tsx` — secondary standalone button (wired in capture-zone)
- `app/api/transcribe/route.ts` — sends audio to `openai/whisper-large-v3` on HF; handles cold-start retry

**Rate limiting:** `lib/rate-limit.ts` — DB-backed for dumps (20/hour, counts rows in `brain_dumps`), in-memory for transcription (30/hour per user).

## Key Files

| File | Purpose |
|------|---------|
| `app/api/extract-tasks/route.ts` | Core AI pipeline: dump → tasks + enrichments + subtask_additions |
| `app/api/transcribe/route.ts` | Voice → text via HF Whisper |
| `app/api/tasks/[id]/route.ts` | PATCH (full field set) + DELETE for individual tasks |
| `app/dashboard/page.tsx` | Server component: auth check + SSR data fetch, wrapped in ErrorBoundary |
| `app/dashboard/dashboard-content.tsx` | Client shell: SWR, capture, task/inbox/notes/search views |
| `components/capture-zone.tsx` | Full voice+text capture UI with mascot, mobile overlay, result screen |
| `components/task-list.tsx` | Task rows with status cycling, delete, open-detail |
| `components/task-detail-panel.tsx` | Slide-in panel: edit title, priority, status, due date, schedule, description, subtasks, notes |
| `components/error-boundary.tsx` | React class error boundary wrapping the dashboard |
| `lib/rate-limit.ts` | Rate limiting: DB-backed (dumps), in-memory (transcribe) |
| `lib/huggingface.ts` | Token resolution + error serialization helpers |
| `lib/supabase/server.ts` | Supabase client for server-side code |
| `lib/supabase/client.ts` | Supabase singleton for client-side code |
| `middleware.ts` | Session refresh on every request |
| `supabase/migrations/001_task_enhancements.sql` | Adds subtasks, notes, schedule_type, scheduled_date, tags columns + api_logs table |
| `supabase/migrations/002_updated_at_trigger_and_rls.sql` | updated_at trigger, RLS policies, query indexes |

## Database Tables

```
brain_dumps : id, user_id, content, created_at
tasks       : id, user_id, brain_dump_id, title, description,
              priority (low/medium/high), status (pending/in_progress/completed),
              due_date, subtasks (jsonb), notes, schedule_type, scheduled_date,
              tags (text[]), created_at, updated_at
api_logs    : id, user_id, brain_dump_id, endpoint, model, content_length,
              tasks_extracted, enrichments_applied, duration_ms, success, error_message, created_at
```

RLS is enabled on all three tables via migration 002. `updated_at` is kept accurate by a DB trigger (also migration 002).

**IMPORTANT — run both migrations in the Supabase SQL editor before shipping:**
1. `supabase/migrations/001_task_enhancements.sql`
2. `supabase/migrations/002_updated_at_trigger_and_rls.sql`

## Data Flow

1. User speaks or types → `CaptureZone` calls `onSubmit(content)`
2. `DashboardContent.handleDumpSubmit` POSTs to `/api/extract-tasks`
3. API route fetches context, calls DeepSeek-V3, saves dump + tasks + applies enrichments + logs to Supabase
4. Returns `{ tasksExtracted, enrichmentsApplied, subtaskAdditions, summary, extractedTasks, transcript }`
5. Client calls `mutate('tasks')` and `mutate('dumps')` to revalidate SWR caches
6. Task list and recent dumps sidebar re-render with fresh data; toast shows the summary

## What's Done vs. What's Left

### Done ✓

| Feature | Where |
|---------|-------|
| Voice input (Web Speech API + Whisper fallback) | `components/capture-zone.tsx`, `app/api/transcribe/route.ts` |
| Smart task linking — enrichments + subtask_additions | `app/api/extract-tasks/route.ts` |
| Rate limiting (dumps: 20/hr DB-backed; transcribe: 30/hr in-memory) | `lib/rate-limit.ts` |
| Toast notifications — all errors/success use sonner | `app/dashboard/dashboard-content.tsx` |
| Task editing — full panel (title, priority, status, due date, schedule, subtasks, notes) | `components/task-detail-panel.tsx` |
| First-time onboarding tutorial card (dismissible, localStorage) | `app/dashboard/dashboard-content.tsx` |
| Landing page with hero, feature strip, CTA | `app/page.tsx` |
| Mobile UX — full mobile overlay flow for capture + result | `components/capture-zone.tsx` |
| Search — ⌘K shortcut, keyword highlight across tasks + notes | `app/dashboard/dashboard-content.tsx` |
| Error boundary on dashboard | `components/error-boundary.tsx` |
| DB migrations run in Supabase | `supabase/migrations/001_*`, `002_*` |
| PATCH endpoint accepts all task-detail-panel fields | `app/api/tasks/[id]/route.ts` |
| Dump → task link UI — source note in task panel, task list per note | `components/task-detail-panel.tsx`, `app/dashboard/dashboard-content.tsx` |
| Delete a dump — trash icon on each note, optimistic removal of dump + linked tasks | `app/dashboard/dashboard-content.tsx`, `app/api/brain-dumps/[id]/route.ts` |
| Task filtering + sorting — filter by priority/status, sort by newest/due date/priority | `app/dashboard/dashboard-content.tsx` (`TaskFilterBar`, `applyFilter`) |
| Settings page — change email + password via Supabase auth, sign-out card | `app/dashboard/dashboard-content.tsx` (`SettingsPageView`) |
| Dump pagination — SWR key `['dumps', limit]`, starts at 20, Load More increments by 20 | `app/dashboard/dashboard-content.tsx` |
| Vitest test suite — 24 tests: rate-limit, Zod schemas, dedup logic, utility functions | `__tests__/` |

### Still Missing ✗

Nothing from the original ship plan is unbuilt. The app is feature-complete for a first public launch.

Possible next improvements (not blockers):

| Feature | Why | Effort |
|---------|-----|--------|
| **E2E tests (Playwright)** | Unit tests cover logic; no browser-level test covers the full dump → task flow | Large |
| **Bulk task actions** | No way to mark multiple tasks done at once — annoying at scale | Medium |
| **Task due-date reminders** | No notifications when a task is overdue | Large (needs cron + email) |
| **Export (CSV / JSON)** | Can't get your data out of the app | Small |

### Known Bugs Fixed

| Bug | Status |
|-----|--------|
| `alert()` for error feedback | Fixed — sonner toasts throughout |
| No error boundary on dashboard | Fixed — `components/error-boundary.tsx` |
| No rate limiting on extract-tasks | Fixed — `lib/rate-limit.ts` (DB-backed) |
| No rate limiting on transcribe | Fixed — `lib/rate-limit.ts` (in-memory) |
| No `updated_at` DB trigger | Fixed — migration 002 |
| RLS not verified | Fixed — migration 002 |
| Voice on separate branch | Fixed — merged to main |
| Smart task linking not built | Fixed — enrichments + subtask_additions live |
| PATCH endpoint missing extended fields | Fixed — subtasks, notes, schedule_type, scheduled_date, tags now accepted |
| Dump → task link UI missing | Fixed — source note in task panel; tasks listed per note in Notes view |

## What This App Is (for context when writing copy or prompts)

This is NOT a note-taking app. It is NOT a task manager. It is a second brain with memory.

The key pitch: most productivity apps make you organize as you go. BrainDump lets you dump everything raw and the AI organises it — but more importantly, it remembers. When you dump something new, the AI already knows everything you've dumped before and connects the dots automatically.

Landing page copy (approved):
> "Your thoughts don't disappear here. Most apps make you organize as you go. BrainDump lets you dump everything raw — text or voice — and the AI does the organizing. But what's different: it remembers. Every dump, every task, every connection you've ever made lives in context. So when you mention someone you met, or an idea you had, the AI already knows what's open, what's related, and what needs updating. It's not a note app. It's not a task manager. It's a second brain that actually reads what you put in it."

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
- **AI:** Hugging Face `deepseek-ai/DeepSeek-V3-0324` via `router.huggingface.co` for task extraction + `openai/whisper-large-v3` for voice — both via direct `fetch` to HF API, free tier, one shared `HUGGINGFACE_API_TOKEN`
- **Voice:** Web Speech API (browser-native, zero cost) → HF Whisper-large-v3 fallback (free tier, ~20s cold start on first use)
- **Hosting:** Vercel — frontend + serverless functions deploy together

## Environment Variables Needed

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
HUGGINGFACE_API_TOKEN   # covers both task extraction (DeepSeek-V3) and voice transcription (Whisper)
```
