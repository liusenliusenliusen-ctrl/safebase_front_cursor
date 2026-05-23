-- 注册时创建默认 profiles（对齐 FastAPI register 写 Profile）
-- RAG 近期对话改读 public.messages（与 FastAPI / Celery 一致）

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

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- 与 FastAPI Message 表一致：最近 N 条记忆对话（非 chat_messages）
create or replace function public.get_recent_memory_messages(msg_limit int default 30)
returns table (role text, content text)
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select m.role, m.content, m.created_at
    from public.messages m
    where m.user_id = auth.uid()
    order by m.created_at desc
    limit greatest(1, least(msg_limit, 100))
  )
  select recent.role, recent.content
  from recent
  order by recent.created_at asc;
$$;

grant execute on function public.get_recent_memory_messages(int) to authenticated;

-- 为已有 auth 用户补建 profiles（一次性）
insert into public.profiles (user_id, content)
select
  u.id,
  '# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录'
from auth.users u
where not exists (
  select 1 from public.profiles p where p.user_id = u.id
);
