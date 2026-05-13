-- 与旧 FastAPI 对齐：画像 profiles、摘要 summaries、锚点 anchors
-- 用户主键统一为 auth.users(id)（uuid），不再使用自建 public.users 表。

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- 表结构（与 app/models.py 一致；Message 已由 chat_messages 替代，此处不建 messages）
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid not null primary key references auth.users (id) on delete cascade,
  content text not null default '# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录',
  updated_at timestamptz not null default now()
);

create table if not exists public.summaries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('daily', 'weekly', 'monthly', 'yearly')),
  content text not null,
  summary_date date not null,
  embedding vector(2048),
  created_at timestamptz not null default now(),
  constraint uq_summary_user_type_date unique (user_id, type, summary_date)
);

create index if not exists summaries_user_id_idx on public.summaries (user_id);
create index if not exists summaries_user_date_idx on public.summaries (user_id, summary_date desc);

create table if not exists public.anchors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_name text not null,
  initial_thought text,
  current_thought text,
  evolution_history jsonb not null default '[]'::jsonb,
  embedding vector(2048),
  updated_at timestamptz not null default now()
);

create index if not exists anchors_user_id_idx on public.anchors (user_id);

-- ---------------------------------------------------------------------------
-- RLS：仅本人可访问
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.summaries enable row level security;
alter table public.anchors enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_delete on public.profiles
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists summaries_select on public.summaries;
drop policy if exists summaries_insert on public.summaries;
drop policy if exists summaries_update on public.summaries;
drop policy if exists summaries_delete on public.summaries;

create policy summaries_select on public.summaries
  for select to authenticated using (user_id = (select auth.uid()));
create policy summaries_insert on public.summaries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy summaries_update on public.summaries
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy summaries_delete on public.summaries
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists anchors_select on public.anchors;
drop policy if exists anchors_insert on public.anchors;
drop policy if exists anchors_update on public.anchors;
drop policy if exists anchors_delete on public.anchors;

create policy anchors_select on public.anchors
  for select to authenticated using (user_id = (select auth.uid()));
create policy anchors_insert on public.anchors
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy anchors_update on public.anchors
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy anchors_delete on public.anchors
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 权限
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, public;
revoke all on public.summaries from anon, public;
revoke all on public.anchors from anon, public;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.summaries to authenticated;
grant select, insert, update, delete on public.anchors to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 扩展 DML 审计触发器（覆盖 profiles / summaries / anchors）
-- ---------------------------------------------------------------------------

create or replace function private.audit_row_dml()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_subject uuid;
  v_pk text;
  v_op text := tg_op;
  v_table text := tg_table_name;
  v_detail jsonb := '{}'::jsonb;
begin
  if v_table = 'diaries' then
    if tg_op = 'DELETE' then
      v_subject := old.user_id;
      v_pk := old.id::text;
    else
      v_subject := new.user_id;
      v_pk := new.id::text;
    end if;
  elsif v_table = 'chat_sessions' then
    if tg_op = 'DELETE' then
      v_subject := old.user_id;
      v_pk := old.id::text;
    else
      v_subject := new.user_id;
      v_pk := new.id::text;
    end if;
  elsif v_table = 'chat_messages' then
    if tg_op = 'DELETE' then
      select s.user_id into v_subject
      from public.chat_sessions s
      where s.id = old.session_id;
      v_pk := old.id::text;
    else
      select s.user_id into v_subject
      from public.chat_sessions s
      where s.id = new.session_id;
      v_pk := new.id::text;
    end if;
  elsif v_table = 'profiles' then
    if tg_op = 'DELETE' then
      v_subject := old.user_id;
      v_pk := old.user_id::text;
    else
      v_subject := new.user_id;
      v_pk := new.user_id::text;
    end if;
  elsif v_table = 'summaries' then
    if tg_op = 'DELETE' then
      v_subject := old.user_id;
      v_pk := old.id::text;
    else
      v_subject := new.user_id;
      v_pk := new.id::text;
    end if;
  elsif v_table = 'anchors' then
    if tg_op = 'DELETE' then
      v_subject := old.user_id;
      v_pk := old.id::text;
    else
      v_subject := new.user_id;
      v_pk := new.id::text;
    end if;
  else
    return coalesce(new, old);
  end if;

  if v_subject is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and v_table = 'diaries' then
    v_detail := jsonb_build_object(
      'title_changed', old.title is distinct from new.title,
      'content_changed', old.content is distinct from new.content
    );
  elsif tg_op = 'UPDATE' and v_table = 'chat_messages' then
    v_detail := jsonb_build_object(
      'content_changed', old.content is distinct from new.content,
      'role', new.role
    );
  elsif tg_op = 'UPDATE' and v_table = 'chat_sessions' then
    v_detail := jsonb_build_object(
      'title_changed', old.title is distinct from new.title
    );
  elsif tg_op = 'UPDATE' and v_table = 'profiles' then
    v_detail := jsonb_build_object(
      'content_changed', old.content is distinct from new.content
    );
  elsif tg_op = 'UPDATE' and v_table = 'summaries' then
    v_detail := jsonb_build_object(
      'content_changed', old.content is distinct from new.content,
      'type', new.type,
      'summary_date', new.summary_date
    );
  elsif tg_op = 'UPDATE' and v_table = 'anchors' then
    v_detail := jsonb_build_object(
      'event_name_changed', old.event_name is distinct from new.event_name,
      'current_thought_changed', old.current_thought is distinct from new.current_thought
    );
  end if;

  insert into public.data_access_audit (
    actor_id, subject_user_id, op, schema_name, table_name, row_pk, detail
  ) values (
    v_actor,
    v_subject,
    case v_op
      when 'INSERT' then 'INSERT'
      when 'UPDATE' then 'UPDATE'
      when 'DELETE' then 'DELETE'
    end,
    'public',
    v_table,
    v_pk,
    v_detail
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists profiles_audit_dml on public.profiles;
create trigger profiles_audit_dml
  after insert or update or delete on public.profiles
  for each row execute function private.audit_row_dml();

drop trigger if exists summaries_audit_dml on public.summaries;
create trigger summaries_audit_dml
  after insert or update or delete on public.summaries
  for each row execute function private.audit_row_dml();

drop trigger if exists anchors_audit_dml on public.anchors;
create trigger anchors_audit_dml
  after insert or update or delete on public.anchors
  for each row execute function private.audit_row_dml();

-- ---------------------------------------------------------------------------
-- updated_at：profiles / anchors（summaries 模型无 updated_at 字段）
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists anchors_set_updated_at on public.anchors;
create trigger anchors_set_updated_at
  before update on public.anchors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- delete_my_data：一并删除画像/摘要/锚点
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.chat_sessions where user_id = v_uid;
  delete from public.diaries where user_id = v_uid;
  delete from public.summaries where user_id = v_uid;
  delete from public.anchors where user_id = v_uid;
  delete from public.profiles where user_id = v_uid;
  delete from public.data_access_audit
  where subject_user_id = v_uid or actor_id = v_uid;
end;
$$;
