# BrainDump — AI-Powered Thought Organizer

## The Pitch (Landing Page Copy)

> **Your thoughts don't disappear here.**
>
> Most apps make you organize as you go. BrainDump lets you dump everything raw — text or voice — and the AI does the organizing. But what's different: it remembers. Every dump, every task, every connection you've ever made lives in context. So when you mention someone you met, or an idea you had, the AI already knows what's open, what's related, and what needs updating.
>
> It's not a note app. It's not a task manager. It's a second brain that actually reads what you put in it.

**Three things it does:**
1. **Dump freely** — text or voice, no structure needed
2. **AI extracts tasks** — with priority, due dates, and context from your history
3. **It links the dots** — new dumps enrich existing tasks instead of creating noise

## What Makes This Different

Most note apps just store what you write. BrainDump is context-aware — when you dump a new thought, the AI already knows your existing pending tasks and recent dumps. So if you mention meeting someone who knows about security jobs, and you already have a task called "Research security job opportunities", the AI will link them — updating or enriching that existing task rather than creating a duplicate. It builds a living picture of your commitments over time.

**Example:** You dump "Met Jake at the networking event, he's a hiring manager at CyberX". The AI sees you already have a pending task "Research security job openings". Instead of creating a duplicate, it enriches the existing one: *"Research security job openings — contact Jake from CyberX (met at networking event)"*.

## Tech Stack

**This is a single full-stack Next.js app — there is no separate backend server.**

| Layer | What | Notes |
|-------|------|-------|
| Frontend | React 19 + Next.js 16 App Router | Server components for SSR, client components for interactivity |
| UI | shadcn/ui + Tailwind CSS v4 | Built on Radix UI primitives |
| Data fetching | SWR | Optimistic updates, auto-revalidation |
| Backend | Next.js API Routes | Same repo, deployed as Vercel serverless functions — no Express, no separate server |
| AI | Hugging Face `mistralai/Mistral-7B-Instruct-v0.3` | Free tier, direct API call, JSON parsed + Zod validated |
| Database | Supabase (PostgreSQL) | Accessed via `@supabase/ssr` |
| Auth | Supabase Auth | JWT-based, cookie refresh on every request via middleware |
| Voice | Web Speech API (browser-native, free) | Falls back to Hugging Face Whisper-large-v3 (free tier, ~20s cold starts) |
| Hosting | Vercel | Frontend + serverless functions in one deploy |

## Database Schema

```sql
brain_dumps
  id          uuid (PK)
  user_id     uuid (FK → auth.users)
  content     text
  created_at  timestamptz

tasks
  id            uuid (PK)
  user_id       uuid (FK → auth.users)
  brain_dump_id uuid (FK → brain_dumps)  -- which dump created this task
  title         text
  description   text
  priority      enum: low | medium | high
  status        enum: pending | in_progress | completed
  due_date      timestamptz
  created_at    timestamptz
  updated_at    timestamptz
```

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
HUGGINGFACE_API_TOKEN=   # required — used for both task extraction (Mistral-7B) and voice transcription (Whisper)
```

For local development, put these in `.env.local` and restart `npm run dev`.
Project or hosting "Settings" values do not automatically appear in a local Next.js dev server unless you pull or copy them into `.env.local`.

## Getting Started

```bash
npm install
npm run dev
```

---

## Ship Order (Recommended Sequence)

| # | What | Why |
|---|------|-----|
| 1 | Merge + wire the voice branch | Biggest UX impact, already ~80% done. Voice is the natural way to dump thoughts quickly |
| 2 | Build smart task linking | This is the core differentiator. Without it the app is just a worse Todoist |
| 3 | Fix Supabase RLS + add rate limiting | Can't go public without these — privacy and cost protection |
| 4 | First-time user onboarding / empty state | Without this, new users are confused and churn immediately |
| 5 | Task editing + dump → task relationship view | Polish and trust — let users fix AI mistakes |
| 6 | Rebuild landing page with futuristic UI | Once the core works, make it look like the pitch |
| 7 | Mobile UX + search | Daily use and scale |

---

## Known Gaps & Issues

### Critical (block shipping)
- **Supabase RLS not verified** — if row-level security is misconfigured, user A can read user B's data. Must be confirmed before going public
- **No rate limiting** on `/api/extract-tasks` or `/api/transcribe` — a single user can exhaust Hugging Face free tier quota with no guardrail
- **Smart task linking not built** — the AI only avoids duplicates today; it does not enrich or update existing tasks when a new dump references them. This is the whole point of the app

### Usability Gaps
- **No first-time user onboarding** — new users land on the dashboard with no guidance; need an empty state that walks through the first dump
- **No task editing** — you can only cycle status or delete. Users can't correct the AI's mistakes (wrong title, wrong priority, wrong description)
- **No dump → task relationship view** — you can see recent dumps in the sidebar but can't click one to see what tasks it created, and can't click a task to see what dump made it
- ~~**`alert()` used for errors**~~ — **fixed**: replaced with `sonner` toast (success shows task count + AI summary; error shows friendly message)
- **Mobile UX is desktop-first** — the killer use case is quick capture on a phone; current layout isn't optimised for one-thumb use
- **No search** — unusable once a user has 30+ dumps and 100+ tasks

### Infrastructure Gaps
- **No `updated_at` trigger in Supabase** — the app writes `updated_at` manually; if any query bypasses the app the column goes stale
- **No error boundary on the dashboard** — an unhandled error kills the whole page
- **Loading skeletons missing** — only a spinner is shown during initial load

---

## Feature Checklist

### Auth
- [x] Login page (`/auth/login`) with email/password
- [x] Sign-up page (`/auth/sign-up`)
- [x] OAuth callback handler (`/auth/callback`)
- [x] Auth middleware — session management + protected routes
- [ ] Password reset flow
- [ ] OAuth providers (Google, GitHub)

### Brain Dump Core
- [x] Brain dump textarea input
- [x] Save dump to `brain_dumps` table
- [x] AI task extraction (GPT-4o-mini) with context from previous 5 dumps
- [x] AI avoids duplicating existing pending tasks
- [x] Tasks saved to `brain_dumps` table linked to the dump
- [ ] **Smart task linking** — when new dump references something already in tasks, update/enrich existing task instead of (or alongside) creating a new one
- [ ] Edit a saved brain dump
- [ ] Delete a brain dump (cascade delete its tasks)

### Tasks
- [x] Task list with status sections (To Do / In Progress / Done)
- [x] Priority badges (low / medium / high)
- [x] Status cycling: pending → in_progress → completed → pending
- [x] Optimistic UI updates via SWR
- [x] Delete task
- [ ] Edit task (title, description, priority, due date)
- [ ] Filter tasks by status or priority
- [ ] Search tasks
- [ ] Task detail view — show which dump created it and related dumps
- [ ] Bulk actions (complete all, delete completed)
- [ ] Due date reminder / notification

### Voice Input
- [x] `VoiceInputButton` component built
- [x] `useSpeechRecognition` hook (Web Speech API)
- [x] `/api/transcribe` endpoint with Hugging Face Whisper-large-v3 fallback
- [x] Merged voice branch into main
- [x] Voice button wired into `BrainDumpInput` — appends transcript to textarea
- [x] HF model-loading auto-retry with countdown display (simulates warm-up wait)
- [x] Safari compatibility — detects `webkitSpeechRecognition`, disables `continuous` natively, simulates it via auto-restart on `onend`

### Context & Memory (core differentiator)
- [ ] Cross-dump reference detection — AI identifies when new dump relates to older tasks/dumps
- [ ] Task enrichment — append context to existing task when new dump mentions it
- [ ] "Related tasks" shown on task cards
- [ ] "Related dumps" shown in sidebar when viewing a task
- [ ] Timeline view — all dumps and tasks in chronological order

### Dashboard UI
- [x] Stats bar (total tasks, pending, completed, dumps count)
- [x] Recent dumps sidebar (last 5)
- [x] Responsive layout (2-col on desktop, stacked on mobile)
- [ ] Click a recent dump to expand and see its extracted tasks
- [ ] Dark/light mode toggle visible in header
- [ ] Empty state illustrations

### Infrastructure
- [ ] Verify Supabase RLS policies on `brain_dumps` and `tasks` (user can only see own data)
- [ ] Add `updated_at` trigger in Supabase for `tasks`
- [ ] Rate limiting on `/api/extract-tasks` and `/api/transcribe`
- [ ] Error boundary on dashboard
- [ ] Loading skeletons instead of spinner for initial data
