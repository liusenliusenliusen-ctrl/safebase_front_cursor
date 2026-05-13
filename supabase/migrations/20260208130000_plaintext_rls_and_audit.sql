-- =============================================================================
-- 明文存储 + 严格 RLS + 访问审计
-- =============================================================================
-- 【静态加密 / TDE】
--   PostgreSQL 开源版不提供可在 SQL 中一键开启的「表空间 TDE」。
--   - Supabase Cloud：静态加密由云厂商磁盘层完成，见 Dashboard → Project Settings → Security。
--   - 自建 / 本地：请在宿主机或云盘使用 LUKS/bitlocker/云盘「加密存储」，或选用提供 TDE 的托管 PG。
--   本 migration 无法在应用层「打开 TDE」，仅在此说明运维侧要求。
--
-- 【SELECT 审计】
--   Postgres 无 SELECT 触发器。读路径审计通过：
--   1) 应用层在 PostgREST 查询后调用 public.audit_read_access(...)（本仓库前端已接入）；
--   2) 或托管侧启用 pgaudit / 日志外送（需运维配置，此处不强制 CREATE EXTENSION）。
--
-- 【写入审计】
--   以下表在 INSERT/UPDATE/DELETE 时由触发器写入 public.data_access_audit（不落库正文，仅存元数据）。
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to postgres;

-- ---------------------------------------------------------------------------
-- 1. 去掉 E2EE 列，改为明文列（已有密文的历史行将丢失可解读内容；执行前请备份）
-- ---------------------------------------------------------------------------
drop policy if exists user_crypto_select on public.user_crypto;
drop policy if exists user_crypto_insert on public.user_crypto;
drop policy if exists user_crypto_update on public.user_crypto;
drop policy if exists user_crypto_delete on public.user_crypto;
drop table if exists public.user_crypto cascade;

drop policy if exists diaries_all on public.diaries;
alter table public.diaries
  add column if not exists title text not null default '',
  add column if not exists content text not null default '';
alter table public.diaries drop column if exists encrypted_content;
alter table public.diaries drop column if exists iv;
alter table public.diaries drop column if exists salt;

drop policy if exists chat_messages_all on public.chat_messages;
alter table public.chat_messages
  add column if not exists content text not null default '';
alter table public.chat_messages drop column if exists encrypted_content;
alter table public.chat_messages drop column if exists iv;
alter table public.chat_messages drop column if exists salt;

drop policy if exists chat_sessions_all on public.chat_sessions;

-- ---------------------------------------------------------------------------
-- 2. 审计表（仅存元数据，不存消息/日记正文）
-- ---------------------------------------------------------------------------
create table if not exists public.data_access_audit (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  subject_user_id uuid not null references auth.users (id) on delete cascade,
  op text not null check (op in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  schema_name text not null default 'public',
  table_name text not null,
  row_pk text,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists data_access_audit_subject_time_idx
  on public.data_access_audit (subject_user_id, occurred_at desc);
create index if not exists data_access_audit_actor_time_idx
  on public.data_access_audit (actor_id, occurred_at desc);

alter table public.data_access_audit enable row level security;

-- 用户仅能查看：与自己作为数据主体相关、或自己作为操作者相关的审计行
drop policy if exists data_access_audit_select_own on public.data_access_audit;
create policy data_access_audit_select_own on public.data_access_audit
  for select
  to authenticated
  using (
    subject_user_id = (select auth.uid())
    or actor_id = (select auth.uid())
  );

-- 禁止客户端直接 INSERT/UPDATE/DELETE 审计行（仅 SECURITY DEFINER 触发器/RPC 写入）
drop policy if exists data_access_audit_no_client_mutate on public.data_access_audit;
-- 无 insert/update/delete policy => authenticated 不能写

-- ---------------------------------------------------------------------------
-- 3. 触发器：DML 审计
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

revoke all on function private.audit_row_dml() from public;

drop trigger if exists diaries_audit_dml on public.diaries;
create trigger diaries_audit_dml
  after insert or update or delete on public.diaries
  for each row execute function private.audit_row_dml();

drop trigger if exists chat_sessions_audit_dml on public.chat_sessions;
create trigger chat_sessions_audit_dml
  after insert or update or delete on public.chat_sessions
  for each row execute function private.audit_row_dml();

drop trigger if exists chat_messages_audit_dml on public.chat_messages;
create trigger chat_messages_audit_dml
  after insert or update or delete on public.chat_messages
  for each row execute function private.audit_row_dml();

-- ---------------------------------------------------------------------------
-- 4. 读路径审计 RPC（由应用显式调用；无法拦截匿名 PostgREST 直连以外的所有读）
-- ---------------------------------------------------------------------------
create or replace function public.audit_read_access(
  p_subject uuid,
  p_table text,
  p_scope text default 'query',
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_subject is distinct from v_actor then
    raise exception 'subject must equal current user';
  end if;

  insert into public.data_access_audit (
    actor_id, subject_user_id, op, schema_name, table_name, row_pk, detail
  ) values (
    v_actor,
    p_subject,
    'SELECT',
    'public',
    p_table,
    null,
    jsonb_build_object('scope', p_scope) || coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.audit_read_access(uuid, text, text, jsonb) from public;
grant execute on function public.audit_read_access(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 严格 RLS（按操作拆分，最小权限）
-- ---------------------------------------------------------------------------
alter table public.diaries enable row level security;

drop policy if exists diaries_select on public.diaries;
drop policy if exists diaries_insert on public.diaries;
drop policy if exists diaries_update on public.diaries;
drop policy if exists diaries_delete on public.diaries;

create policy diaries_select on public.diaries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy diaries_insert on public.diaries
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy diaries_update on public.diaries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy diaries_delete on public.diaries
  for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.chat_sessions enable row level security;

drop policy if exists chat_sessions_select on public.chat_sessions;
drop policy if exists chat_sessions_insert on public.chat_sessions;
drop policy if exists chat_sessions_update on public.chat_sessions;
drop policy if exists chat_sessions_delete on public.chat_sessions;

create policy chat_sessions_select on public.chat_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy chat_sessions_insert on public.chat_sessions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy chat_sessions_update on public.chat_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy chat_sessions_delete on public.chat_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_update on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;

create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy chat_messages_update on public.chat_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  );

create policy chat_messages_delete on public.chat_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. 表权限：拒绝 anon，仅 authenticated 可操作业务表；审计只读
-- ---------------------------------------------------------------------------
revoke all on public.diaries from anon, public;
revoke all on public.chat_sessions from anon, public;
revoke all on public.chat_messages from anon, public;
revoke all on public.data_access_audit from anon, public;

grant select, insert, update, delete on public.diaries to authenticated;
grant select, insert, update, delete on public.chat_sessions to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;
grant select on public.data_access_audit to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 更新 delete_my_data（含审计清理）
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
  delete from public.data_access_audit
  where subject_user_id = v_uid or actor_id = v_uid;
end;
$$;

revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;

-- 注意：Supabase service_role / 超级用户可绕过 RLS；生产环境须限制谁持有 service_role 密钥。
