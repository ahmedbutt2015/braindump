-- Migration 003: pgvector embeddings for semantic task retrieval
--
-- Replaces the "newest 15 tasks" context window with cosine-similarity
-- search so the AI always sees the most *relevant* tasks for a dump,
-- not just the most recent ones.
--
-- Run in Supabase SQL Editor before deploying the embedding feature.

-- pgvector is pre-installed on all Supabase projects
create extension if not exists vector;

-- 384-dim column matches BAAI/bge-small-en-v1.5 output
alter table tasks add column if not exists embedding vector(384);

-- HNSW index with cosine distance ops
-- m=16 connections per layer, ef_construction=64 build-time search depth
-- Better recall than IVFFlat with no dataset-size tuning required
create index if not exists tasks_embedding_hnsw
  on tasks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- RPC 1: vector cosine similarity search (requires embedding column to be populated).
-- Used in production where api-inference.huggingface.co is reachable.
create or replace function match_tasks(
  query_embedding  vector(384),
  user_id_param    uuid,
  match_count      int default 15
)
returns table (
  id          uuid,
  title       text,
  description text,
  subtasks    jsonb,
  similarity  float
)
language sql stable
as $$
  select
    id,
    title,
    description,
    subtasks,
    1 - (embedding <=> query_embedding) as similarity
  from tasks
  where user_id   = user_id_param
    and status    = 'pending'
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- RPC 2: keyword full-text search fallback.
-- Works everywhere with no external API — used when embeddings are unavailable.
-- plainto_tsquery turns the dump into keyword tokens; ts_rank scores overlap.
-- The WHERE clause with @@ filters to tasks that share at least one keyword,
-- so unrelated tasks don't crowd out the truly relevant ones.
create or replace function match_tasks_fts(
  query_text     text,
  user_id_param  uuid,
  match_count    int default 15
)
returns table (
  id          uuid,
  title       text,
  description text,
  subtasks    jsonb,
  rank        real
)
language sql stable
as $$
  select
    id,
    title,
    description,
    subtasks,
    ts_rank(
      to_tsvector('english', title || ' ' || coalesce(description, '')),
      plainto_tsquery('english', query_text)
    ) as rank
  from tasks
  where user_id = user_id_param
    and status  = 'pending'
    and to_tsvector('english', title || ' ' || coalesce(description, ''))
        @@ plainto_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;
