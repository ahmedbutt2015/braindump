/**
 * Embedding helpers using BAAI/bge-small-en-v1.5 via HuggingFace Inference API.
 *
 * BGE models use an asymmetric retrieval format:
 *   - Queries (what we search with): prepend the instruction prefix
 *   - Documents/tasks (what we index): plain text, no prefix
 *
 * Response shapes from the HF feature-extraction pipeline vary by model:
 *   - 1-D  [f, f, ...]              → already a sentence embedding
 *   - 2-D  [[f, f, ...]]            → one sentence embedding wrapped in a batch array
 *   - 3-D  [[[f, ...], ...]]        → token-level embeddings; we mean-pool to get one vector
 * parseEmbedding() handles all three.
 */

const EMBED_MODEL = 'BAAI/bge-small-en-v1.5'
const EMBED_URL = `https://api-inference.huggingface.co/models/${EMBED_MODEL}`
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

function getToken(): string {
  const t = process.env.HUGGINGFACE_API_TOKEN ?? process.env.NEXT_PUBLIC_HUGGINGFACE_API_TOKEN
  if (!t) throw new Error('HUGGINGFACE_API_TOKEN is not set')
  return t
}

function meanPool(tokenEmbeddings: number[][]): number[] {
  const dims = tokenEmbeddings[0].length
  const out = new Array<number>(dims).fill(0)
  for (const tok of tokenEmbeddings) for (let i = 0; i < dims; i++) out[i] += tok[i]
  return out.map(v => v / tokenEmbeddings.length)
}

function parseEmbedding(data: unknown): number[] {
  if (!Array.isArray(data) || data.length === 0)
    throw new Error(`Empty or non-array embedding response: ${JSON.stringify(data).slice(0, 120)}`)

  if (typeof data[0] === 'number') return data as number[]            // 1-D

  if (Array.isArray(data[0])) {
    const inner = data[0] as unknown[]
    if (typeof inner[0] === 'number') return inner as number[]        // 2-D

    if (Array.isArray(inner[0])) {                                    // 3-D token-level
      return meanPool(inner as number[][])
    }
  }

  throw new Error(`Cannot parse embedding shape: ${JSON.stringify(data).slice(0, 120)}`)
}

async function hfFetch(inputs: string | string[], retries = 3): Promise<unknown> {
  const token = getToken()
  let lastError: Error = new Error('Embedding failed')

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
      signal: AbortSignal.timeout(20_000),
    })

    const body = await res.json()

    if (res.status === 503 && typeof body?.error === 'string' && body.error.includes('loading')) {
      const waitMs = Math.min((body.estimated_time ?? 20) * 1000, 30_000)
      if (attempt < retries - 1) {
        console.info(`[embeddings] Model loading — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${retries})`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
    }

    if (!res.ok) {
      lastError = new Error(`HF embed ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      break
    }

    return body
  }

  throw lastError
}

/**
 * Embed a dump or search query.
 * Adds the BGE instruction prefix for better asymmetric retrieval accuracy.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const data = await hfFetch(QUERY_PREFIX + text.substring(0, 512))
  return parseEmbedding(data)
}

/**
 * Embed a task for storage.
 * Plain text (title + description), no instruction prefix.
 */
export async function embedTask(title: string, description: string | null): Promise<number[]> {
  const text = description ? `${title}. ${description.substring(0, 300)}` : title
  const data = await hfFetch(text)
  return parseEmbedding(data)
}

/**
 * Embed multiple tasks in parallel with a concurrency cap.
 * Returns null for any task whose embedding fails (task is still saved, just unembedded).
 */
export async function embedTaskBatch(
  tasks: Array<{ title: string; description: string | null }>,
  concurrency = 4,
): Promise<Array<number[] | null>> {
  const results: Array<number[] | null> = new Array(tasks.length).fill(null)

  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency)
    const embeddings = await Promise.all(
      chunk.map(t =>
        embedTask(t.title, t.description).catch(err => {
          console.warn('[embeddings] Task embed failed (will store without embedding):', err.message)
          return null
        })
      )
    )
    embeddings.forEach((e, j) => { results[i + j] = e })
  }

  return results
}

/** Serialise a float array to the Postgres vector literal format: '[0.1,0.2,...]' */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
