-- Public site information: one singleton row (phone, location, structured social links).
-- Social links live in a jsonb collection ({ platform, url, enabled, sort_order }) so adding
-- another social platform never requires a schema change.
create table if not exists public.site_settings (
  id integer primary key default 1 constraint site_settings_single_row check (id = 1),
  phone text not null default '',
  location_url text not null default '',
  location_translations jsonb not null default '[]'::jsonb,
  social_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The row is seeded empty so the public site and the admin editor always read/update one
-- known row; the single-row check above is what keeps it a singleton.
insert into public.site_settings (id) values (1)
on conflict (id) do nothing;

create trigger set_updated_at_site_settings
before update on public.site_settings
for each row
execute function public.handle_updated_at();

alter table public.site_settings enable row level security;

create policy "Public site settings are viewable by everyone"
on public.site_settings
for select
using (true);

create policy "Admins can manage site settings"
on public.site_settings
for all
using (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
);
