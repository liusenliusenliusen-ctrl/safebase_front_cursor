-- 客户端可调用：删除当前用户在 public 中的加密数据（不删除 auth.users 记录）
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
  delete from public.chat_sessions where user_id = auth.uid();
  delete from public.diaries where user_id = auth.uid();
  delete from public.user_crypto where user_id = auth.uid();
end;
$$;

revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;
