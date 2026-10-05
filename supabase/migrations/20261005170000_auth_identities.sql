-- identity v2 — phone signup, Telegram login, login codes (SPEC-identity.md amendment, 2026-10-05).
--
-- Four service-tier tables. All of them have RLS enabled; only `telegram_links` carries a
-- client-facing policy (select-own — the account page shows the connected @username). The other
-- three are reached exclusively through the /api/auth/** routes, which hold the service-role
-- client ({ auth: { persistSession: false } }) — the same confinement the payments module
-- documents. No client write path exists anywhere in this file, on purpose.

-- One Telegram account ↔ one auth user. `tg_id` is the primary key (a Telegram account belongs
-- to exactly one user here); `user_id` is unique (one link per user in v1 — detach/replace is a
-- service-tier act, not a client one).
create table if not exists public.telegram_links (
  tg_id bigint primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  tg_username text,
  created_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

create policy "Users can read their own telegram link"
on public.telegram_links for select
using (user_id = auth.uid());

-- The deep-link login handshake: `nonce` is the bearer of one browser session — created by
-- /api/auth/telegram/start, confirmed by the webhook, consumed by the first poll that mints a
-- session. `user_id` is set only in link mode (connect-to-existing-account). Expired rows are
-- deleted opportunistically by the start route — tiny table, no cron needed.
create table if not exists public.telegram_login_requests (
  nonce text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'consumed')),
  tg_id bigint,
  tg_username text,
  tg_first_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.telegram_login_requests enable row level security;

-- One active login code per user; regenerate replaces (upsert on the primary key). Only the
-- sha256 digest is stored — the plaintext is shown once by /api/auth/code/generate and is not
-- recoverable afterwards. `attempts` is the lock counter (8 failures → regenerate).
create table if not exists public.login_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.login_codes enable row level security;

-- Fixed-window counters for the anonymous-facing auth routes. The admin API does not inherit
-- GoTrue's own rate limits, so this surface carries its own (`<route>:<ip>` keys).
create table if not exists public.auth_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.auth_rate_limits enable row level security;

-- The signup trigger, amended for identity v2: the synthetic addresses phone/Telegram accounts
-- carry (p…/tg…@users.raccoongearbin.invalid — the session-mint path is email-flavored) must
-- derive NO display name, so the /account onboarding that asks for a nickname still triggers.
-- Real emails keep the v1 behaviour byte-for-byte; null emails keep its empty-string result.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    case
      when coalesce(new.email, '') like '%@users.raccoongearbin.invalid' then null
      else split_part(coalesce(new.email, ''), '@', 1)
    end
  );
  return new;
end;
$$;
