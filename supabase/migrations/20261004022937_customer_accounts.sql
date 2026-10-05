-- Customer accounts (phase 1, module `identity`). Spec: specs/ecommerce/SPEC-identity.md.
--
-- A profile row is created by a trigger on `auth.users`, never by the client: there is no INSERT
-- policy at all, so no account can exist without a profile and no sign-up-then-insert race is
-- possible. Deletion cascades from the auth user (the runbook in SPEC-compliance.md relies on it).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_profiles
before update on public.profiles
for each row
execute function public.handle_updated_at();

-- `security definer` + empty `search_path`: the function runs as its owner when the auth server
-- inserts a user, and every reference below is fully qualified so nothing resolves by ambient
-- search_path (Supabase's own guidance, kept here as the reason the body looks verbose).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill: the trigger only fires on NEW sign-ups, so every auth user that predates this migration
-- (the shop's own admin account among them) would otherwise have no profile row and an account page
-- that cannot save. Idempotent on purpose — a re-run cannot duplicate a row.
insert into public.profiles (id, display_name)
select id, split_part(coalesce(email, ''), '@', 1)
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
on public.profiles for select
using (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());
