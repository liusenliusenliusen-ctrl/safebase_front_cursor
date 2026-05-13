-- E2EE core: user crypto salt + encrypted diaries + chat sessions/messages
-- 使用 Supabase Auth (auth.users)。RLS 以 auth.uid() 为准。

-- 用户级 KDF salt + 验证包（用于校验主密码是否正确）
create table if not exists public.user_crypto (
  user_id uuid primary key references auth.users (id) on delete cascade,
  salt text not null,
  verifier_ciphertext text,
  verifier_iv text,
  verifier_salt text,
  created_at timestamptz not null default now()
);

alter table public.user_crypto enable row level security;

create policy user_crypto_select on public.user_crypto
  for select using (auth.uid() = user_id);

create policy user_crypto_insert on public.user_crypto
  for insert with check (auth.uid() = user_id);

create policy user_crypto_update on public.user_crypto
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy user_crypto_delete on public.user_crypto
  for delete using (auth.uid() = user_id);

-- 日记：仅存密文与 iv、salt（行级 salt）
create table if not exists public.diaries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  encrypted_content text not null,
  iv text not null,
  salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diaries_user_id_created_at_idx
  on public.diaries (user_id, created_at desc);

alter table public.diaries enable row level security;

create policy diaries_all on public.diaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 对话会话
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_id_idx on public.chat_sessions (user_id);

alter table public.chat_sessions enable row level security;

create policy chat_sessions_all on public.chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 对话消息（密文）
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  encrypted_content text not null,
  iv text not null,
  salt text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on public.chat_messages (session_id, created_at asc);

alter table public.chat_messages enable row level security;

create policy chat_messages_all on public.chat_messages
  for all using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- Realtime：新消息 INSERT 推送
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then null;
end $$;

-- updated_at 维护
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists diaries_set_updated_at on public.diaries;
create trigger diaries_set_updated_at
  before update on public.diaries
  for each row execute function public.set_updated_at();

drop trigger if exists chat_sessions_set_updated_at on public.chat_sessions;
create trigger chat_sessions_set_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();
