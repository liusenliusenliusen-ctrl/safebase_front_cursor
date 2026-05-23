-- 主站已使用 public.diaries；移除旧 FastAPI diary_entries 表

drop trigger if exists diary_entries_audit_dml on public.diary_entries;
drop trigger if exists diary_entries_set_updated_at on public.diary_entries;

drop table if exists public.diary_entries cascade;

-- delete_my_data 不再引用 diary_entries（若 20260211140000 已含则无害）
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
  delete from public.user_crypto where user_id = auth.uid();
  delete from public.data_access_audit
  where subject_user_id = auth.uid() or actor_id = auth.uid();
end;
$$;
