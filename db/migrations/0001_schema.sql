-- Schema 0001 — the whole app, ported from the 20 Supabase migrations (2026-09 → 10) for Neon.
-- Specs under specs/ecommerce/** remain the behavioral source of truth; this file is the storage
-- half. Differences vs the source migrations, each deliberate:
--
--   * No `auth` schema exists. User ids are Clerk text ids (`user_…`); the phone-alias flow's
--     identifier is the alias username, never a phone number (Clerk rejects +855 — see plans/005).
--     `auth.uid()` becomes `app.current_user_id()` — claims-per-request, live-proven in P0:
--     `set_config('request.jwt.claims', …)`. The `nullif` is load-bearing: a missing claim must
--     mean "no rows", never a cast error.
--   * No `storage` schema — images live in R2 (`product_images.storage_path` is the key).
--   * No vault/pg_net: the Telegram push is Worker code now, both directions.
--   * Profiles are created by app code (the Clerk signup route), not a trigger on auth.users.
--   * `app_authenticated` is the ONLY role switch: user-scoped routes set claims + `set local
--     role` so the policies below actually apply (the owner connection bypasses RLS and serves
--     system ops: login codes, telegram handshakes, rate limits, profile creation).
--
-- Pushed-files discipline carries over: a file listed in schema_migrations is never edited —
-- changes land as new numbered files.

-- ---------------------------------------------------------------------------------------------
-- Roles + claim helper

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_authenticated') then
    create role app_authenticated nologin noinherit;
  end if;
end $$;

grant app_authenticated to current_user;

create schema if not exists app;

create or replace function app.current_user_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'
$$;

grant usage on schema app to app_authenticated;
grant execute on function app.current_user_id() to app_authenticated;

-- ---------------------------------------------------------------------------------------------
-- Catalog (categories / products / translations / images) — content ids stay uuids, they are not
-- identities. Triggers, indexes and checks are byte-for-byte the source.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_translations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  locale text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, locale)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug text not null unique,
  sku text not null unique,
  price numeric(10,2) not null check (price >= 0),
  currency text not null default 'USD',
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_featured boolean not null default false,
  -- Promotions (20260930120000): one price cut per product, all nullable.
  promo_price numeric(10,2) check (promo_price is null or (promo_price >= 0 and promo_price < price)),
  promo_label text,
  promo_quantity integer check (promo_quantity is null or promo_quantity > 0),
  promo_starts_at timestamptz,
  promo_ends_at timestamptz check (promo_ends_at is null or promo_starts_at is null or promo_ends_at > promo_starts_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_translations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  locale text not null,
  name text not null,
  short_description text not null,
  description text not null,
  specifications jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, locale)
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, storage_path)
);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  id integer primary key default 1 constraint site_settings_single_row check (id = 1),
  phone text not null default '',
  location_url text not null default '',
  location_translations jsonb not null default '[]'::jsonb,
  social_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1)
on conflict (id) do nothing;

comment on column public.site_settings.social_links is
  'Array of { platform, url, enabled, sort_order, contact_enabled }. enabled = shown in the masthead; contact_enabled = offered by Product -> Contact to Order. A missing contact_enabled falls back to enabled.';

create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_status on public.products(status);
create index if not exists idx_products_featured on public.products(is_featured);
create index if not exists idx_product_translations_locale on public.product_translations(locale);
create index if not exists idx_product_images_product_id on public.product_images(product_id);
create index if not exists idx_categories_slug on public.categories(slug);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_categories before update on public.categories
for each row execute function public.handle_updated_at();
create trigger set_updated_at_category_translations before update on public.category_translations
for each row execute function public.handle_updated_at();
create trigger set_updated_at_products before update on public.products
for each row execute function public.handle_updated_at();
create trigger set_updated_at_product_translations before update on public.product_translations
for each row execute function public.handle_updated_at();
create trigger set_updated_at_product_images before update on public.product_images
for each row execute function public.handle_updated_at();
create trigger set_updated_at_admin_users before update on public.admin_users
for each row execute function public.handle_updated_at();
create trigger set_updated_at_site_settings before update on public.site_settings
for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Accounts. `profiles.id` is the Clerk user id; rows are created by the signup routes (owner
-- context), never by a trigger, and `orders` keeps the source's `on delete set null` detach
-- semantics by referencing profiles instead of the (no longer existing) auth.users.

create table if not exists public.profiles (
  id text primary key,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_profiles before update on public.profiles
for each row execute function public.handle_updated_at();

-- identity v2 data (20261005170000 + 20261005190000): the Telegram link map, the deep-link
-- handshake, login codes, and the anonymous-route rate limiter. No RLS on the last three: no
-- client exists at all any more — the Worker's owner-context routes are their only readers and
-- writers, and policies would only get in those routes' way (the claims path never touches them).

create table if not exists public.telegram_links (
  tg_id bigint primary key,
  user_id text not null unique,
  tg_username text,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_login_requests (
  nonce text primary key,
  user_id text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'consumed')),
  tg_id bigint,
  tg_username text,
  tg_first_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.login_codes (
  user_id text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.auth_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

-- ---------------------------------------------------------------------------------------------
-- Orders. The money path: `create_order` stays the only order write path — same bodies as the
-- source, only the identity read changes (`app.current_user_id()` instead of `auth.uid()`).

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id text references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'delivered', 'cancelled')),
  delivery_name text,
  delivery_phone text,
  delivery_address text,
  delivery_location text,
  delivery_note text,
  cancel_note text,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  total numeric(10,2) not null check (total >= 0),
  constraint orders_total_matches_v1 check (total = subtotal),
  currency text not null default 'USD',
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),
  confirmed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name_snapshot text not null,
  sku_snapshot text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  unit_price_original numeric(10,2),
  promo_label_snapshot text,
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'payway' check (provider in ('payway')),
  provider_txn_id text not null unique,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'initiated'
    check (status in ('initiated', 'paid', 'failed', 'cancelled', 'refunded')),
  request_payload jsonb,
  result_payload jsonb,
  paid_at timestamptz,
  refund_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user_created on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_payments_order on public.payments(order_id);

create trigger set_updated_at_orders before update on public.orders
for each row execute function public.handle_updated_at();
create trigger set_updated_at_payments before update on public.payments
for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------------------------
-- effective_unit_price — the SQL half of the written pricing rule (app/utils/product-pricing.ts;
-- the fixtures match tests/unit/cart-totals.test.ts). The self-check runs on every migrate, so a
-- drifted rule fails the migration itself.

create or replace function public.effective_unit_price(p_product public.products, p_at timestamptz)
returns numeric
language sql immutable
as $$
  select case
    when p_product.promo_price is not null
     and p_product.promo_price < p_product.price
     and (p_product.promo_quantity is null or p_product.promo_quantity > 0)
     and (p_product.promo_starts_at is null or p_product.promo_starts_at <= p_at)
     and (p_product.promo_ends_at is null or p_product.promo_ends_at > p_at)
    then p_product.promo_price
    else p_product.price
  end;
$$;

do $$
declare
  p public.products;
begin
  p.id := gen_random_uuid();
  p.category_id := gen_random_uuid();
  p.slug := 'fixture';
  p.sku := 'FIXTURE';
  p.currency := 'USD';
  p.status := 'published';
  p.stock_quantity := 10;
  p.is_featured := false;
  p.created_at := now();
  p.updated_at := now();

  p.price := 100;
  p.promo_price := null; p.promo_quantity := null; p.promo_starts_at := null; p.promo_ends_at := null;
  if public.effective_unit_price(p, now()) <> 100 then
    raise exception 'effective_unit_price fixture "no promo" answered %', public.effective_unit_price(p, now());
  end if;

  p.promo_price := 80; p.promo_quantity := 5; p.promo_starts_at := now() - interval '1 day'; p.promo_ends_at := null;
  if public.effective_unit_price(p, now()) <> 80 then
    raise exception 'effective_unit_price fixture "live promo" answered %', public.effective_unit_price(p, now());
  end if;

  p.promo_ends_at := now() - interval '1 hour';
  if public.effective_unit_price(p, now()) <> 100 then
    raise exception 'effective_unit_price fixture "closed window" answered %', public.effective_unit_price(p, now());
  end if;

  p.promo_ends_at := null; p.promo_quantity := 0;
  if public.effective_unit_price(p, now()) <> 100 then
    raise exception 'effective_unit_price fixture "exhausted cap" answered %', public.effective_unit_price(p, now());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_order — byte-for-byte the source body (20261005150000) except the identity line.

create or replace function public.create_order(p_items jsonb, p_delivery jsonb, p_locale text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user text := app.current_user_id();
  v_now timestamptz := now();
  v_locale text := coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'en');
  v_name text := btrim(coalesce(p_delivery ->> 'name', ''));
  v_phone text := btrim(coalesce(p_delivery ->> 'phone', ''));
  v_address text := btrim(coalesce(p_delivery ->> 'address', ''));
  v_location text := btrim(coalesce(p_delivery ->> 'location', ''));
  v_note text := nullif(btrim(coalesce(p_delivery ->> 'note', '')), '');
  v_map jsonb := '{}'::jsonb;
  v_line record;
  v_product public.products;
  v_pid text;
  v_translation text;
  v_effective numeric;
  v_prepared jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_order_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if v_name = '' or length(v_name) > 100
     or length(v_phone) < 8 or length(v_phone) > 20
     or v_address = '' or length(v_address) > 300
     or v_location = '' or length(v_location) > 300 or v_location !~ '^https?://'
     or (v_note is not null and length(v_note) > 300) then
    raise exception 'INVALID_DELIVERY' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'CART_TOO_LARGE' using errcode = 'P0001';
  end if;

  for v_line in select value from jsonb_array_elements(p_items) as value loop
    v_pid := v_line.value ->> 'productId';
    if v_pid is null or v_pid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    if (v_line.value ->> 'quantity') is null
       or (v_line.value ->> 'quantity') !~ '^[0-9]{1,9}$'
       or (v_line.value ->> 'quantity')::int < 1
       or (v_line.value ->> 'quantity')::int > 999 then
      raise exception 'INVALID_QUANTITY:%', v_pid using errcode = 'P0001';
    end if;
    v_map := jsonb_set(v_map, array[v_pid], to_jsonb(coalesce((v_map ->> v_pid)::int, 0) + (v_line.value ->> 'quantity')::int));
  end loop;

  for v_line in select key::uuid as pid, (v_map ->> key)::int as qty from jsonb_object_keys(v_map) as key order by 1 loop
    select * into v_product from public.products where id = v_line.pid for update;
    if not found or v_product.status <> 'published' then
      raise exception 'PRODUCT_UNAVAILABLE:%', v_line.pid using errcode = 'P0001';
    end if;
    if v_line.qty > v_product.stock_quantity then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_line.pid, v_product.stock_quantity using errcode = 'P0001';
    end if;

    v_effective := public.effective_unit_price(v_product, v_now);

    if v_effective < v_product.price
       and v_product.promo_quantity is not null
       and v_line.qty > v_product.promo_quantity then
      raise exception 'PROMO_LIMIT:%:%', v_line.pid, v_product.promo_quantity using errcode = 'P0001';
    end if;

    v_translation := (
      select coalesce(
        (select t.name from public.product_translations t where t.product_id = v_product.id and t.locale = v_locale limit 1),
        (select t.name from public.product_translations t where t.product_id = v_product.id and t.locale = 'en' limit 1),
        (select t.name from public.product_translations t where t.product_id = v_product.id order by t.locale limit 1),
        v_product.sku
      )
    );

    v_prepared := v_prepared || jsonb_build_object(
      'product_id', v_product.id,
      'quantity', v_line.qty,
      'unit_price', v_effective,
      'unit_price_original', case when v_effective < v_product.price then v_product.price end,
      'promo_label', case when v_effective < v_product.price then v_product.promo_label end,
      'name', v_translation,
      'sku', v_product.sku,
      'promo_capped', (v_effective < v_product.price and v_product.promo_quantity is not null)
    );
    v_subtotal := v_subtotal + round(v_effective * v_line.qty, 2);
  end loop;

  insert into public.orders (user_id, status, delivery_name, delivery_phone, delivery_address, delivery_location, delivery_note, subtotal, total, payment_status)
  values (v_user, 'pending', v_name, v_phone, v_address, v_location, v_note, round(v_subtotal, 2), round(v_subtotal, 2), 'unpaid')
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_prepared) as value loop
    insert into public.order_items
      (order_id, product_id, name_snapshot, sku_snapshot, unit_price, unit_price_original, promo_label_snapshot, quantity, line_total)
    values (
      v_order_id,
      (v_line.value ->> 'product_id')::uuid,
      v_line.value ->> 'name',
      v_line.value ->> 'sku',
      (v_line.value ->> 'unit_price')::numeric,
      (v_line.value ->> 'unit_price_original')::numeric,
      v_line.value ->> 'promo_label',
      (v_line.value ->> 'quantity')::int,
      round((v_line.value ->> 'unit_price')::numeric * (v_line.value ->> 'quantity')::int, 2)
    );
    update public.products
       set stock_quantity = stock_quantity - (v_line.value ->> 'quantity')::int
     where id = (v_line.value ->> 'product_id')::uuid;
    if (v_line.value ->> 'promo_capped')::boolean then
      update public.products
         set promo_quantity = promo_quantity - (v_line.value ->> 'quantity')::int
       where id = (v_line.value ->> 'product_id')::uuid;
    end if;
  end loop;

  return v_order_id;
end;
$$;

-- set_order_status — the source's newest body (20261004180000), identity line aside.

create or replace function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_line record;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    (v_order.status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_order.status = 'confirmed' and p_status in ('delivered', 'cancelled'))
  ) then
    raise exception 'INVALID_TRANSITION:%:%', v_order.status, p_status using errcode = 'P0001';
  end if;

  if p_status = 'confirmed' then
    update public.orders set status = 'confirmed', confirmed_at = now() where id = p_order_id;
  elsif p_status = 'delivered' then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
  else
    for v_line in
      select product_id, quantity, unit_price_original
        from public.order_items
       where order_id = p_order_id
    loop
      if v_line.product_id is not null then
        update public.products
           set stock_quantity = stock_quantity + v_line.quantity
         where id = v_line.product_id;
        if v_line.unit_price_original is not null then
          update public.products
             set promo_quantity = promo_quantity + v_line.quantity
           where id = v_line.product_id
             and promo_quantity is not null;
        end if;
      end if;
    end loop;
    update public.orders
       set status = 'cancelled',
           cancelled_at = now(),
           cancel_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_order_id;
  end if;
end;
$$;

-- anonymize_customer — the source's newest body (20261005150000).

create or replace function public.anonymize_customer(p_user_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  update public.orders
     set delivery_name = null, delivery_phone = null, delivery_address = null, delivery_location = null, delivery_note = null, cancel_note = null
   where user_id = p_user_id
     and (delivery_name is not null or delivery_phone is not null or delivery_address is not null or delivery_location is not null or delivery_note is not null or cancel_note is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- mark_payment_refunded — the source body (20261004130000), identity line aside.

create or replace function public.mark_payment_refunded(p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'refunded', refund_note = nullif(btrim(coalesce(p_note, '')), '')
   where order_id = p_order_id
     and status = 'paid';

  update public.orders
     set payment_status = 'refunded'
   where id = p_order_id
     and payment_status = 'paid';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- RLS. Where the source's policies protected client-facing tables, the same predicates apply —
-- now filtering the `app_authenticated` role (the claims path). Policies that referenced
-- `admin_users` recursively (the source removed that one) stay removed; admin list management is
-- SQL/seed territory, and no screen lists admins.

alter table public.categories enable row level security;
alter table public.category_translations enable row level security;
alter table public.products enable row level security;
alter table public.product_translations enable row level security;
alter table public.product_images enable row level security;
alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.telegram_links enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

create policy "Public catalog categories are viewable by everyone"
on public.categories for select using (is_active = true);
create policy "Public category translations are viewable by everyone"
on public.category_translations for select using (true);
create policy "Public products are viewable by everyone when published"
on public.products for select using (status = 'published');
create policy "Public product translations are viewable by everyone when published"
on public.product_translations for select
using (exists (select 1 from public.products p where p.id = product_translations.product_id and p.status = 'published'));
create policy "Public product images are viewable by everyone when published"
on public.product_images for select
using (exists (select 1 from public.products p where p.id = product_images.product_id and p.status = 'published'));

create policy "Public site settings are viewable by everyone"
on public.site_settings for select using (true);

create policy "Users can read their own admin record"
on public.admin_users for select using (user_id = app.current_user_id());

create policy "Admins can manage categories"
on public.categories for all
using (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
with check (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()));
create policy "Admins can manage category translations"
on public.category_translations for all
using (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
with check (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()));
create policy "Admins can manage products"
on public.products for all
using (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
with check (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()));
create policy "Admins can manage product translations"
on public.product_translations for all
using (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
with check (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()));
create policy "Admins can manage product images"
on public.product_images for all
using (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
with check (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()));
create policy "Admins can manage site settings"
on public.site_settings for all
using (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
with check (exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()));

create policy "Users can read their own profile"
on public.profiles for select using (id = app.current_user_id());
create policy "Users can update their own profile"
on public.profiles for update
using (id = app.current_user_id())
with check (id = app.current_user_id());

create policy "Users can read their own telegram link"
on public.telegram_links for select using (user_id = app.current_user_id());

create policy "Users can read their own orders"
on public.orders for select
using (
  user_id = app.current_user_id()
  or exists (select 1 from public.admin_users au where au.user_id = app.current_user_id())
);
create policy "Users can read their own order items"
on public.order_items for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (o.user_id = app.current_user_id() or exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
  )
);
create policy "Users can read their own payments"
on public.payments for select
using (
  exists (
    select 1 from public.orders o
    where o.id = payments.order_id
      and (o.user_id = app.current_user_id() or exists (select 1 from public.admin_users au where au.user_id = app.current_user_id()))
  )
);

-- ---------------------------------------------------------------------------------------------
-- Grants for the claims path. The owner connection needs none (it owns everything); the role the
-- routes switch into gets exactly what the policies above are meant to filter.

grant usage on schema public to app_authenticated;
grant select on public.categories, public.category_translations, public.products,
  public.product_translations, public.product_images, public.admin_users, public.site_settings
  to app_authenticated;
grant select, update on public.profiles to app_authenticated;
grant select on public.telegram_links to app_authenticated;
grant select on public.orders, public.order_items, public.payments to app_authenticated;
grant execute on function public.create_order(jsonb, jsonb, text) to app_authenticated;
grant execute on function public.set_order_status(uuid, text, text) to app_authenticated;
grant execute on function public.anonymize_customer(text) to app_authenticated;
grant execute on function public.mark_payment_refunded(uuid, text) to app_authenticated;
