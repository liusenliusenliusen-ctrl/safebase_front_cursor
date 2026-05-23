-- 日记向量检索 + Edge stream-chat 用 RPC（与 FastAPI RAG 对齐，并包含 diaries）

alter table public.diaries
  add column if not exists embedding vector(2048);

do $$
begin
  create index diaries_embedding_hnsw_idx
    on public.diaries using hnsw (embedding vector_l2_ops)
    with (m = 16, ef_construction = 64)
    where embedding is not null;
exception
  when others then
    raise notice 'diaries HNSW index skipped: %', sqlerrm;
end $$;

-- 近期主站聊天（chat_messages + chat_sessions）
create or replace function public.get_recent_chat_messages(msg_limit int default 30)
returns table (role text, content text)
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select cm.role, cm.content, cm.created_at
    from public.chat_messages cm
    inner join public.chat_sessions cs on cs.id = cm.session_id
    where cs.user_id = auth.uid()
    order by cm.created_at desc
    limit greatest(1, least(msg_limit, 100))
  )
  select recent.role, recent.content
  from recent
  order by recent.created_at asc;
$$;

-- 日摘要向量检索
create or replace function public.match_summaries_daily(
  query_embedding vector(2048),
  match_count int default 2
)
returns table (summary_date date, content text)
language sql
stable
security invoker
set search_path = public
as $$
  select s.summary_date, s.content
  from public.summaries s
  where s.user_id = auth.uid()
    and s.type = 'daily'
    and s.embedding is not null
  order by s.embedding <-> query_embedding
  limit greatest(0, least(match_count, 10));
$$;

-- 锚点向量检索
create or replace function public.match_anchors(
  query_embedding vector(2048),
  match_count int default 1
)
returns table (
  event_name text,
  initial_thought text,
  current_thought text
)
language sql
stable
security invoker
set search_path = public
as $$
  select a.event_name, a.initial_thought, a.current_thought
  from public.anchors a
  where a.user_id = auth.uid()
    and a.embedding is not null
  order by a.embedding <-> query_embedding
  limit greatest(0, least(match_count, 10));
$$;

-- 日记向量检索
create or replace function public.match_diaries(
  query_embedding vector(2048),
  match_count int default 2
)
returns table (id bigint, title text, content text, updated_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select d.id, d.title, d.content, d.updated_at
  from public.diaries d
  where d.user_id = auth.uid()
    and d.embedding is not null
  order by d.embedding <-> query_embedding
  limit greatest(0, least(match_count, 10));
$$;

grant execute on function public.get_recent_chat_messages(int) to authenticated;
grant execute on function public.match_summaries_daily(vector, int) to authenticated;
grant execute on function public.match_anchors(vector, int) to authenticated;
grant execute on function public.match_diaries(vector, int) to authenticated;
