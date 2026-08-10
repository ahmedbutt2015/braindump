# I Built a Second Brain That Actually Remembers — Here's the Architecture That Makes It Work

*From a raw thought dump to an AI that links ideas across every conversation you've ever had*

---

Every productivity tool I've ever used has the same hidden assumption baked into its design: **you already know what to do with your thoughts when you have them.**

Notion wants you to file the page in the right database. Todoist wants you to type a task title, pick a project, set a due date. Obsidian wants you to link the note to the right concept. The tools are good at storage. What they're terrible at is *thinking*—that cognitive overhead between "I had a thought" and "I've turned it into something actionable."

The real problem is worse than friction. It's memory. Even if you capture everything perfectly, your note-taking app has no idea that the person you mentioned in Tuesday's note is the same person you have a pending task about from two weeks ago. It can't connect the dots. You have to.

That's the gap BrainDump is trying to close. And building it taught me more about the limits of language models, vector search, and prompt engineering than any tutorial ever could.

---

## The Pitch in One Paragraph

BrainDump is a thought-dumping app where you write or speak anything on your mind—raw, unstructured, unfiltered—and the AI extracts actionable tasks. That part is table stakes in 2024. The differentiator is **memory across dumps**: when you submit a new dump, the AI already knows everything you've ever dumped before. It doesn't just extract tasks; it *connects* them. If your new dump mentions a person you've already created a task about, it enriches that existing task instead of creating a duplicate.

Real example from our test suite:

> **Dump 1:** "Met Jake Chen at a networking event. He's a hiring manager at CyberX Security."
>
> *AI creates:* "Follow up with Jake Chen about CyberX Security position"
>
> **Dump 3 (two days later):** "Jake messaged me on LinkedIn! CyberX needs someone strong in AWS and zero-trust architecture. He wants my resume by Friday."
>
> *AI does NOT create a new task. Instead, it enriches the existing one:* adds deadline context, technical requirements, and a subtask "Send resume + tailored cover letter."

That's the whole bet. Not smarter task extraction. Smarter *context*.

---

## The Architecture

BrainDump is a single full-stack Next.js 16 app—no separate backend, no microservices. Everything runs as Vercel serverless functions. The database is Supabase (PostgreSQL), the AI is Hugging Face's hosted inference for DeepSeek-V3, and the voice input is the browser's native Web Speech API with Whisper as a fallback.

```
React 19 + Next.js 16 App Router
       ↓ (API routes = serverless functions on Vercel)
POST /api/extract-tasks
       ↓
Supabase PostgreSQL + pgvector
       ↓
Hugging Face: DeepSeek-V3-0324 (tasks) + Whisper-large-v3 (voice) + BGE (embeddings)
```

The interesting engineering is entirely inside `/api/extract-tasks`. Everything else—auth, UI, data fetching—is standard Next.js + SWR plumbing.

---

## The Hard Problem: What Context Do You Feed the Model?

The naive approach—and what most AI task apps do—is to stuff a fixed window of recent data into the prompt: "here are your last 15 tasks, here are your last 5 notes." That works for small datasets. It falls apart the moment you have more than ~20 pending tasks, because the relevant context is no longer guaranteed to be in the most recent window.

Imagine you dumped "Research security job opportunities" six weeks ago. That task is buried under 50 newer tasks. Today you dump "Got an interview at CyberX"—and the model has no idea the security job task even exists. It creates a duplicate. The app's core promise breaks.

This is what I call the **context cliff**: a hard cutoff where older-but-relevant information simply vanishes from the model's view.

The solution is retrieval. Instead of blindly sending the last N tasks, you *search* for the most relevant tasks given the current dump. The question is how.

### Three-Tier Retrieval

I ended up with three retrieval strategies in cascade. Each tier fills gaps left by the previous one:

**Tier 1: Vector cosine similarity (pgvector)**

Embed the incoming dump using `BAAI/bge-small-en-v1.5` (384-dimensional sentence embeddings), then run a cosine similarity search against all existing task embeddings. Tasks semantically related to the dump surface regardless of when they were created.

```sql
-- HNSW index on the embedding column
CREATE INDEX tasks_embedding_hnsw
  ON tasks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RPC called from the API route
CREATE OR REPLACE FUNCTION match_tasks(
  query_embedding  vector(384),
  user_id_param    uuid,
  match_count      int DEFAULT 15
)
RETURNS TABLE (id uuid, title text, description text, subtasks jsonb, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, title, description, subtasks,
         1 - (embedding <=> query_embedding) AS similarity
  FROM tasks
  WHERE user_id = user_id_param
    AND status  = 'pending'
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

I chose HNSW over IVFFlat because HNSW requires no dataset-size tuning—IVFFlat's `lists` parameter needs to be recalibrated as the table grows, and I didn't want to add operational overhead for a free-tier app.

**Tier 2: PostgreSQL full-text search**

Vector search is great in production but requires an external embedding API call that can fail or time out. FTS works everywhere with no external dependency—it's pure PostgreSQL. It's also surprisingly good for the use case: task titles are short and keyword-rich, so when a dump mentions "Jake" or "CyberX" or "resume," keyword overlap reliably surfaces the right tasks.

```sql
CREATE OR REPLACE FUNCTION match_tasks_fts(
  query_text     text,
  user_id_param  uuid,
  match_count    int DEFAULT 15
)
RETURNS TABLE (id uuid, title text, description text, subtasks jsonb, rank real)
LANGUAGE sql STABLE AS $$
  SELECT id, title, description, subtasks,
    ts_rank(
      to_tsvector('english', title || ' ' || COALESCE(description, '')),
      plainto_tsquery('english', query_text)
    ) AS rank
  FROM tasks
  WHERE user_id = user_id_param
    AND status  = 'pending'
    AND to_tsvector('english', title || ' ' || COALESCE(description, ''))
        @@ plainto_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
$$;
```

**Tier 3: Recency**

If tiers 1 and 2 don't fill the 15-task context window, fall back to the most recently created tasks. This guarantees the model always has *something* to work with even for brand-new accounts with no embeddings.

The API route chains them together with deduplication:

```typescript
const existingTasks: TaskContext[] = []
const seen = new Set<string>()
const fill = (rows: TaskContext[]) => {
  for (const t of rows) {
    if (existingTasks.length >= 15) break
    if (!seen.has(t.id)) { existingTasks.push(t); seen.add(t.id) }
  }
}

// Tier 1: semantic
if (dumpEmbedding) {
  const { data: semantic } = await supabase.rpc('match_tasks', {
    query_embedding: toVectorLiteral(dumpEmbedding),
    user_id_param: user.id,
    match_count: 15,
  })
  fill((semantic ?? []) as TaskContext[])
}

// Tier 2: keyword FTS
if (existingTasks.length < 15) {
  const { data: fts } = await supabase.rpc('match_tasks_fts', {
    query_text: content.substring(0, 1000),
    user_id_param: user.id,
    match_count: 15,
  })
  fill((fts ?? []) as TaskContext[])
}

// Tier 3: recency
if (existingTasks.length < 15) {
  const { data: recent } = await supabase
    .from('tasks')
    .select('id, title, description, subtasks')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(15)
  fill((recent ?? []) as TaskContext[])
}
```

The result is a context window that's always *relevant*, not just *recent*—which is a fundamentally different guarantee.

---

## The AI Response Schema

The model doesn't just return a list of tasks. It returns a structured object with three operation types:

```typescript
const ResponseSchema = z.object({
  tasks: z.array(z.object({
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(['low', 'medium', 'high']),
    due_date: z.string().nullable(),
    subtasks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      completed: z.boolean(),
    })),
  })),
  enrichments: z.array(z.object({
    task_id: z.string(),
    additional_context: z.string(),
  })),
  subtask_additions: z.array(z.object({
    task_id: z.string(),
    subtask: z.object({
      id: z.string(),
      title: z.string(),
      completed: z.boolean(),
    }),
  })),
  summary: z.string(),
})
```

- **`tasks[]`** → new rows inserted into the database
- **`enrichments[]`** → `UPDATE` existing task descriptions
- **`subtask_additions[]`** → `PUSH` a new subtask into an existing task's JSONB array

This separation is what enables cross-dump memory. The model explicitly decides: is this new information a brand new task, additional context for an existing task, or a concrete next step under an existing task?

---

## Prompt Engineering: From Rules to Steps

The first version of the system prompt was a list of rules:

```
DECISION RULES:
- If the dump mentions something already in an existing task, prefer ENRICHMENT over creating a new task
- Only create a new task if it is genuinely new work not covered by any existing task
- MATCH EXISTING FIRST before creating anything new
...
```

This approach scored 87% on my story integration test. It failed in a predictable pattern: the model would sometimes *classify* before it had fully *inventoried*—it would decide what to do with item 2 before it had noticed that item 4 was closely related. Items got silently dropped when the model couldn't immediately categorize them.

The fix was changing the *structure* of the prompt, not just the rules. I moved from a rules-based approach to a steps-based approach:

```
STEP 1 — INVENTORY
Read the entire dump and list every distinct actionable item before
deciding what to do with any of them. Do not skip items.

STEP 2 — CLASSIFY each item:
A. ENRICHMENT — this updates or adds context to an existing task
B. SUBTASK — this is a direct sub-step of an existing task (not standalone work)
C. NEW TASK — genuinely new work with no existing task to attach to
D. NOT A TASK — information only, no action required

STEP 3 — OUTPUT
Every item must appear in exactly one of: tasks, enrichments,
subtask_additions, or be explicitly discarded. Nothing may be silently dropped.
```

The key insight: forcing an explicit *inventory* step before any classification means the model sees the full picture before it starts making decisions. It can notice that items 2, 5, and 7 are all related to the same existing task before it commits to creating anything new.

This moved the test score from 87% to 95%.

---

## Testing AI Intelligence: The Story Integration Test

How do you verify that an AI system is actually *intelligent* and not just functional? Unit tests can check that the API responds, that Zod schemas parse, that rate limiting fires. They can't check whether the AI correctly decided to enrich task A instead of creating duplicate task B.

I built a story integration test: an 8-chapter narrative that feeds a realistic job-search scenario to the AI one chapter at a time and evaluates the output of each chapter against specific named checks.

The story:
1. **Ch.1** — User meets Jake Chen (hiring manager at CyberX) at a networking event
2. **Ch.2** — User realizes they need to update their resume, research certifications, practice interviews
3. **Ch.3** — Jake messages on LinkedIn asking for a resume by Friday *(first memory test)*
4. **Ch.4** — User outlines specific resume subtasks and realizes they need a cover letter *(subtask test)*
5. **Ch.5** — Resume sent, interview scheduled *(new task vs subtask boundary test)*
6. **Ch.6** — Parallel tracks: TechCorp follow-up, CloudShield coffee chat, plus personal tasks (grocery shopping, mom's birthday) *(noise isolation test)*
7. **Ch.7** — Extreme dump: 10 items across multiple threads, 2-hour CyberX interview, personal tasks *(stress test)*
8. **Ch.8** — CyberX offer received, TechCorp declined, CloudShield follow-up *(resolution + counter-offer test)*

Each chapter evaluates checks like:

```typescript
hasNewTask('Jake'),            // Ch.1: creates a task mentioning Jake
noNewTask('resume'),           // Ch.3: does NOT duplicate the resume task
enriches('resume'),            // Ch.3: enriches the existing resume task instead
addsSubtask('resume'),         // Ch.4: adds subtasks to the resume task
hasNewTask('interview'),       // Ch.5: creates standalone interview prep task
noNewTask('CyberX'),           // Ch.6: doesn't duplicate the CyberX task
hasNewTask('TechCorp'),        // Ch.6: creates a new task for TechCorp
hasNewTask('birthday'),        // Ch.6: captures the personal task too
demonstratesMemory(),          // Ch.7: ≥1 enrichment or subtask addition
hasNewTask('negoti'),          // Ch.8: creates a negotiation task
```

Final score: **95% — 36/38 checks passed**.

The two failures were both Ch.5: the AI saw "Practice system design interviews" already existed (created in Ch.2) and classified the new CyberX technical interview as an enrichment to the Jake follow-up task rather than a new standalone task. Arguably defensible behavior—it's a genuinely ambiguous case about how much new work constitutes a new task vs a subtask—but I'm counting it as a miss.

What the test proved: the three-tier retrieval actually works. In Chapter 7, the AI correctly enriched the Jake/CyberX task from Chapter 1—six dumps deep, well beyond any recency window—because FTS surfaced it by keyword match. That's the whole point.

---

## The Embedding Asymmetry Trick

One detail worth highlighting: BGE embedding models use **asymmetric retrieval**. Queries and documents are embedded differently.

When you embed a *query* (the brain dump you're about to search with), you prepend an instruction prefix:

```typescript
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

export async function embedQuery(text: string): Promise<number[]> {
  const data = await hfFetch(QUERY_PREFIX + text.substring(0, 512))
  return parseEmbedding(data)
}
```

When you embed a *document* (the task being stored), you use plain text with no prefix:

```typescript
export async function embedTask(title: string, description: string | null): Promise<number[]> {
  const text = description
    ? `${title}. ${description.substring(0, 300)}`
    : title
  const data = await hfFetch(text)
  return parseEmbedding(data)
}
```

This asymmetry is why BGE models outperform symmetric models on retrieval tasks. The instruction prefix shifts the query embedding into a space that maximizes cosine similarity with relevant document embeddings. Skipping it—embedding queries the same way as documents—measurably degrades retrieval quality.

---

## What I Got Wrong (And How I Fixed It)

**1. Silent Supabase insert failures**

When inserting tasks with `.insert([...])` without chaining `.select()`, the Supabase JS client executes the insert but returns no data. Any error that PostgreSQL throws—column type mismatch, constraint violation, anything—is silently swallowed unless you explicitly check `error`. I was passing `JSON.stringify([...])` for a `jsonb` column (a string where the DB expected JSON), and tasks were being dropped with no error message surfacing. Fix: always chain `.select().single()` on inserts, or at minimum destructure `error` and log it.

**2. Context window stuffing vs retrieval**

The first version of the AI pipeline sent "the last 15 pending tasks" regardless of relevance. This worked fine in development with 5-10 tasks but broke down as the test account accumulated more data. The insight was that *recency ≠ relevance*. A task created six weeks ago can be far more relevant to today's dump than a task created yesterday. The three-tier retrieval system was the fix.

**3. Rules-based prompts are fragile**

The original system prompt was a list of 8+ rules with priority ordering. Rules interact in ways that are hard to predict—especially when the model is processing a long dump with 10 items. The steps-based approach (INVENTORY → CLASSIFY → OUTPUT) imposes a linear thinking structure that dramatically reduces dropped items and misclassifications.

**4. HF Inference API variability**

The HuggingFace free inference API returns embeddings in three different shapes depending on the model and request:
- `[f, f, f, ...]` — 1D, already a sentence embedding
- `[[f, f, f, ...]]` — 2D, one embedding wrapped in a batch array
- `[[[f, ...], [f, ...], ...]]` — 3D, token-level embeddings requiring mean pooling

You need to handle all three:

```typescript
function parseEmbedding(data: unknown): number[] {
  if (!Array.isArray(data) || data.length === 0) throw new Error('Empty response')
  if (typeof data[0] === 'number') return data as number[]          // 1D
  if (Array.isArray(data[0])) {
    const inner = data[0] as unknown[]
    if (typeof inner[0] === 'number') return inner as number[]      // 2D
    if (Array.isArray(inner[0])) return meanPool(inner as number[][]) // 3D
  }
  throw new Error('Unknown shape')
}
```

---

## The Numbers

- **AI test score:** 95% (36/38 checks, 8-chapter story with escalating complexity)
- **Story runtime:** ~95 seconds end-to-end (real HF API, real Supabase)
- **Embedding model:** BAAI/bge-small-en-v1.5, 384 dimensions, ~33MB
- **Vector index:** HNSW, m=16, ef_construction=64 — ~99% recall with sub-millisecond query time at small scale
- **Rate limits:** 20 dumps/hour (DB-backed), 30 transcriptions/hour (in-memory)
- **Cold starts:** HF free tier cold-starts in 10–20s; the API handles 503 model-loading responses with exponential backoff and user-facing countdown

---

## What's Next

The app is feature-complete for a first public launch. The retrieval system is the biggest architectural upgrade since the initial build. The remaining gaps are operational:

- **E2E tests** — the story integration test covers AI intelligence but no browser-level test validates the full UI flow
- **Due-date reminders** — scheduled tasks have no notification mechanism; it needs a cron + email pipeline
- **Multi-user isolation at scale** — the HNSW index is currently on the full `tasks` table; at very large scale you'd want per-user partitioning or a different indexing strategy

If you're building something similar and want to talk through the retrieval architecture or the prompt engineering approach, find me in the repo issues.

---

## Stack Summary

| Piece | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 16 App Router | SSR + serverless API in one deploy |
| UI | shadcn/ui + Tailwind v4 | Unstyled primitives, full control |
| AI | DeepSeek-V3 via HF | Best quality on the free tier |
| Embeddings | BAAI/bge-small-en-v1.5 | 384-dim, asymmetric retrieval, fast |
| Vector index | pgvector HNSW | No tuning, ~99% recall, lives in Postgres |
| FTS fallback | PostgreSQL tsvector | Zero external dependencies, always available |
| Database | Supabase | Managed Postgres + auth + RLS |
| Hosting | Vercel | Edge network, zero-config serverless |

---

*BrainDump is open source. The full code—including the story integration test, the three-tier retrieval implementation, and all SQL migrations—is on GitHub.*

*If you found the pgvector + FTS cascade useful, or have thoughts on the prompt engineering approach, leave a comment. I read them all.*
