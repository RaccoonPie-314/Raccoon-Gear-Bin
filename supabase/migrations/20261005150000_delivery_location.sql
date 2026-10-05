-- Delivery location link (owner request): the address a buyer types and the map pin the
-- geolocation button grabs are two different things, both required (the shop calls the phone,
-- the courier follows the pin). Spec: specs/ecommerce/SPEC-orders.md.
--
-- `create_order` is the money path and stays the only write door: the new `delivery_location`
-- column rides inside the existing `p_delivery` jsonb, so the RPC's signature is unchanged and
-- `create or replace` (not drop-and-recreate) does the migration — and the same missing/invalid
-- answer (`INVALID_DELIVERY`) covers the missing pin. The pin is a URL and is validated as one
-- (an `http(s)://` prefix), because a location the shop cannot open is not a location.
-- `anonymize_customer` clears it like every other piece of delivery PII.
--
-- The Telegram builder gains one `Pin:` line, anchored like the item links (HTML mode is live),
-- only when the order has one — pre-existing orders may not.

alter table public.orders add column if not exists delivery_location text;

-- Same function, one new required input and one new snapshot column. Everything else — the
-- locks, the pricing, the item pass — is byte-for-byte the previous migration's body on purpose.
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

  insert into public.orders (user_id, status, delivery_name, delivery_phone, delivery_address, delivery_location, delivery_note, subtotal, total, payment_status)
  values (v_user, 'pending', v_name, v_phone, v_address, v_location, v_note, round(v_subtotal, 2), round(v_subtotal, 2), 'unpaid')
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

-- The deletion runbook now also clears the pin: a map link IS an address.
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
     set delivery_name = null, delivery_phone = null, delivery_address = null, delivery_location = null, delivery_note = null
   where user_id = p_user_id
     and (delivery_name is not null or delivery_phone is not null or delivery_address is not null or delivery_location is not null or delivery_note is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The push gains the pin between the address and the note, anchored like the item links — and
-- only when the order has one (orders placed before this migration do not).
create or replace function public.order_telegram_text(p_order public.orders, p_items jsonb)
returns text
language sql immutable
as $$
  select concat(
    'New order #', upper(substring(p_order.id::text, 1, 8)),
    ' — ', p_order.currency, ' ', to_char(p_order.total, 'FM999,999,990.00'),
    E'\nUser: ', public.order_telegram_escape(coalesce(p_order.delivery_name, '(no name)')),
    E'\nPhone: ', public.order_telegram_escape(coalesce(p_order.delivery_phone, '-')),
    E'\nLocation: ', public.order_telegram_escape(coalesce(p_order.delivery_address, '(no address)')),
    case when p_order.delivery_location is not null
         then E'\nPin: <a href="' || public.order_telegram_escape(p_order.delivery_location) || '">'
              || public.order_telegram_escape(p_order.delivery_location) || '</a>'
         else '' end,
    case when p_order.delivery_note is not null
         then E'\nNote: ' || public.order_telegram_escape(p_order.delivery_note) else '' end,
    E'\nItems:\n', coalesce(
      (select string_agg(
         E'- ' || case when it ->> 'product_id' is not null
                       then '<a href="https://raccoon-gear-bin.alsorandomkay.workers.dev/products/' || (it ->> 'product_id') || '">'
                       else '' end
         || public.order_telegram_escape(format(
              '%s× %s [%s] — %s %s',
              it ->> 'quantity', it ->> 'name', it ->> 'sku',
              p_order.currency, to_char((it ->> 'line_total')::numeric, 'FM999,999,990.00')
            ))
         || case when it ->> 'product_id' is not null then '</a>' else '' end,
         E'\n')
       from jsonb_array_elements(p_items) as it),
      '(none)')
  );
$$;

-- Self-check, exact-equality on purpose: pins the Pin line's anchor and its position between
-- the address and the note.
do $$
declare
  o public.orders;
  txt text;
begin
  o.id := 'a1b2c3d4-0000-0000-0000-000000000000'::uuid;
  o.currency := 'USD';
  o.total := 133.44;
  o.delivery_name := 'Test Buyer';
  o.delivery_phone := '012345678';
  o.delivery_address := 'Street 271';
  o.delivery_location := 'https://maps.google.com/?q=1.5,2.5';
  o.delivery_note := null;

  txt := public.order_telegram_text(
    o,
    '[{"quantity": 2, "name": "Widget", "sku": "W-1", "line_total": 99.98, "product_id": "11111111-1111-1111-1111-111111111111"},
      {"quantity": 1, "name": "Gadget", "sku": "G-2", "line_total": 33.46, "product_id": null}]'::jsonb
  );
  if txt <> E'New order #A1B2C3D4 — USD 133.44\nUser: Test Buyer\nPhone: 012345678\nLocation: Street 271\nPin: <a href="https://maps.google.com/?q=1.5,2.5">https://maps.google.com/?q=1.5,2.5</a>\nItems:\n- <a href="https://raccoon-gear-bin.alsorandomkay.workers.dev/products/11111111-1111-1111-1111-111111111111">2× Widget [W-1] — USD 99.98</a>\n- 1× Gadget [G-2] — USD 33.46' then
    raise exception 'order_telegram_text fixture answered %', txt;
  end if;

  -- A pre-migration order (no pin) must not grow a dangling Pin line.
  o.delivery_location := null;
  txt := public.order_telegram_text(o, '[]'::jsonb);
  if txt like '%Pin:%' or txt not like E'%Items:\n(none)' then
    raise exception 'order_telegram_text legacy fixture answered %', txt;
  end if;
end;
$$;
