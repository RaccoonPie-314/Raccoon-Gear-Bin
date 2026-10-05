-- Orders and checkout (phase 3, module `orders`). Spec: specs/ecommerce/SPEC-orders.md.
--
-- The money path: `create_order` is the only order write path. It locks the product rows, charges
-- `effective_unit_price` — the SQL half of the rule `app/utils/product-pricing.ts` displays —
-- snapshots what it charged and decrements stock/caps in the same transaction. Client-side writes
-- to these tables are denied by the absence of INSERT/UPDATE/DELETE policies; the RPCs are the only
-- doors, and every status change re-checks the admin allowlist inside the function.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: account deletion detaches the row (`on delete set null`) and anonymization
  -- nulls the PII columns; create_order still refuses to write an order without them.
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'delivered', 'cancelled')),
  delivery_name text,
  delivery_phone text,
  delivery_address text,
  delivery_note text,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  total numeric(10,2) not null check (total >= 0),
  -- v1: no fees, so the two are equal; a later shipping-fee migration relaxes this by name.
  constraint orders_total_matches_v1 check (total = subtotal),
  currency text not null default 'USD',
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),   -- only 'unpaid' is reachable until phase 4
  confirmed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- The product may be deleted later; the snapshot columns survive (`set null`, not cascade).
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

create index if not exists idx_orders_user_created on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_order_items_order on public.order_items(order_id);

create trigger set_updated_at_orders
before update on public.orders
for each row
execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------------------------
-- The SQL half of the written pricing rule (`app/utils/product-pricing.ts` — the same inputs, the
-- same output): the promo applies iff `promo_price < price` AND its unit cap is unexhausted AND its
-- window is open at `p_at`. The fixtures below are the same expectations the TS side's
-- `bun test` holds (tests/unit/cart-totals.test.ts); both must answer identically.

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

-- Self-check: runs on every `supabase db reset` (and on push), so a drifted rule fails the
-- migration itself. The fixtures are built field-by-field — no inserts, no foreign keys involved.
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
-- create_order: the only order write path. Codes are machine-readable, raised as P0001 in
-- `CODE` / `CODE:<productId>` / `CODE:<productId>:<n>` shapes — the client maps the prefix to a
-- translated message and fills the numbers, so no copy lives in SQL.

create or replace function public.create_order(p_items jsonb, p_delivery jsonb, p_locale text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_locale text := coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'en');
  v_name text := btrim(coalesce(p_delivery ->> 'name', ''));
  v_phone text := btrim(coalesce(p_delivery ->> 'phone', ''));
  v_address text := btrim(coalesce(p_delivery ->> 'address', ''));
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
     or (v_note is not null and length(v_note) > 300) then
    raise exception 'INVALID_DELIVERY' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'CART_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- Aggregate duplicate product ids first: sum quantities per id, validating each entry's shape.
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

  -- Pass 1: lock each product in uuid order (deadlock-safe), validate, price, snapshot.
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

    -- The snapshot name follows the locale fallback the storefront uses: asked locale → en → first stored.
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

  insert into public.orders (user_id, status, delivery_name, delivery_phone, delivery_address, delivery_note, subtotal, total, payment_status)
  values (v_user, 'pending', v_name, v_phone, v_address, v_note, round(v_subtotal, 2), round(v_subtotal, 2), 'unpaid')
  returning id into v_order_id;

  -- Pass 2: items + stock movement, riding the same locks.
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

-- ---------------------------------------------------------------------------------------------
-- set_order_status: the only status write path, admin-gated inside. `pending → confirmed |
-- cancelled`, `confirmed → delivered | cancelled`; terminal states stay terminal. Cancelling
-- restores what placement took: stock for every line, the unit cap for lines charged the promo
-- price (the cap is a unit count, not a window — restoring it stays correct after the window closes).

create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_line record;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
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
    update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- anonymize_customer: the deletion runbook's mechanism (SPEC-compliance). Run BEFORE deleting the
-- auth user — after the delete, `user_id` is null and the rows are unfindable.

create or replace function public.anonymize_customer(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  update public.orders
     set delivery_name = null, delivery_phone = null, delivery_address = null, delivery_note = null
   where user_id = p_user_id
     and (delivery_name is not null or delivery_phone is not null or delivery_address is not null or delivery_note is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- RLS: reads only, for owners and admins. No INSERT/UPDATE/DELETE policies exist at all — that
-- absence is the write model (Postgres denies by default when RLS is enabled).

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "Users can read their own orders"
on public.orders for select
using (
  user_id = auth.uid()
  or exists (select 1 from public.admin_users au where au.user_id = auth.uid())
);

create policy "Users can read their own order items"
on public.order_items for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (o.user_id = auth.uid() or exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  )
);

-- ---------------------------------------------------------------------------------------------
-- Execute grants: Postgres grants EXECUTE to PUBLIC by default, so the revokes are part of the
-- contract, not decoration. The in-function checks handle authorization; this is who may knock.

revoke all on function public.create_order(jsonb, jsonb, text) from public, anon;
grant execute on function public.create_order(jsonb, jsonb, text) to authenticated;

revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;

revoke all on function public.anonymize_customer(uuid) from public, anon;
grant execute on function public.anonymize_customer(uuid) to authenticated;
