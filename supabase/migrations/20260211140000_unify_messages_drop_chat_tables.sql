-- 单会话：仅保留 public.messages；迁移 chat_messages 后删除 chat_sessions / chat_messages

-- 1) 回填：将尚未进入 messages 的 chat 记录按用户合并（去重：同 user/role/content/created_at）
insert into public.messages (user_id, role, content, created_at)
select cs.user_id, cm.role, cm.content, cm.created_at
from public.chat_messages cm
inner join public.chat_sessions cs on cs.id = cm.session_id
where not exists (
  select 1
  from public.messages m
  where m.user_id = cs.user_id
    and m.role = cm.role
    and m.content = cm.content
    and m.created_at = cm.created_at
)
order by cm.created_at asc;

-- 2) Realtime：messages 订阅；移除 chat_messages
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when others then
    raise notice 'realtime add messages: %', sqlerrm;
end $$;

do $$
begin
  alter publication supabase_realtime drop table public.chat_messages;
exception
  when undefined_object then null;
  when others then
    raise notice 'realtime drop chat_messages: %', sqlerrm;
end $$;

-- 3) 审计：去掉已删除的 chat 表分支
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
  elsif v_table = 'messages' then
    if tg_op = 'DELETE' then
      v_subject := old.user_id;
      v_pk := old.id::text;
    else
      v_subject := new.user_id;
      v_pk := new.id::text;
    end if;
  elsif v_table = 'diary_entries' then
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
  elsif tg_op = 'UPDATE' and v_table = 'messages' then
    v_detail := jsonb_build_object(
      'content_changed', old.content is distinct from new.content,
      'role', new.role
    );
  elsif tg_op = 'UPDATE' and v_table = 'profiles' then
    v_detail := jsonb_build_object(
      'content_changed', old.content is distinct from new.content
    );
  elsif tg_op = 'UPDATE' and v_table = 'anchors' then
    v_detail := jsonb_build_object(
      'event_name', new.event_name,
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

drop trigger if exists chat_messages_audit_dml on public.chat_messages;
drop trigger if exists chat_sessions_audit_dml on public.chat_sessions;

-- 4) delete_my_data：删 messages，不再删 chat_sessions
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.messages where user_id = auth.uid();
  delete from public.summaries where user_id = auth.uid();
  delete from public.anchors where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
  delete from public.diaries where user_id = auth.uid();
  delete from public.diary_entries where user_id = auth.uid();
  delete from public.user_crypto where user_id = auth.uid();
  delete from public.data_access_audit
  where subject_user_id = auth.uid() or actor_id = auth.uid();
end;
$$;

-- 5) 删除多会话表
drop table if exists public.chat_messages cascade;
drop table if exists public.chat_sessions cascade;

drop function if exists public.get_recent_chat_messages(int);
