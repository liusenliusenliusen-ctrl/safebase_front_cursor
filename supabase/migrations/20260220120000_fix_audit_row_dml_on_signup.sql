-- 修复 20260211140000 中 audit_row_dml 写错列名（operation → op，补 schema_name）
-- 否则注册时 handle_new_user_profile 插入 profiles 触发审计失败 → Auth「Database error saving new user」

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

-- 注册触发器：确保 Auth 服务角色可执行
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, content)
  values (
    new.id,
    '# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

grant execute on function public.handle_new_user_profile() to service_role;
grant execute on function public.handle_new_user_profile() to supabase_auth_admin;
