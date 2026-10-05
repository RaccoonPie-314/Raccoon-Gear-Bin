-- Order push, second pass (owner request): the notification moves from a compact paragraph to
-- labeled lines with a link per item. Spec: specs/ecommerce/SPEC-orders.md.
--
-- The previous migration is pushed and never edited, so this one `create or replace`s the two
-- functions it introduced: the text builder gains the labels, the item line totals and the
-- product links, and the trigger's item payload grows `line_total` + `product_id` to feed it.
-- The deferred-constraint-trigger contract, the Vault secrets and the exception wrapping are
-- untouched. `create or replace` retains the functions' ACLs, so the revokes still stand.

-- The deployed Workers URL (wrangler: raccoon-gear-bin on the alsorandomkay account), pinned
-- here because the message links must point at the live storefront. When a custom domain lands,
-- one small migration replaces this function with the new base.
create or replace function public.order_telegram_text(p_order public.orders, p_items jsonb)
returns text
language sql immutable
as $$
  select concat(
    'New order #', upper(substring(p_order.id::text, 1, 8)),
    ' — ', p_order.currency, ' ', to_char(p_order.total, 'FM999,999,990.00'),
    E'\nUser: ', coalesce(p_order.delivery_name, '(no name)'),
    E'\nPhone: ', coalesce(p_order.delivery_phone, '-'),
    E'\nLocation: ', coalesce(p_order.delivery_address, '(no address)'),
    case when p_order.delivery_note is not null then E'\nNote: ' || p_order.delivery_note else '' end,
    E'\nItems:\n', coalesce(
      (select string_agg(
         E'- ' || format(
           '%s× %s [%s] — %s %s',
           it ->> 'quantity', it ->> 'name', it ->> 'sku',
           p_order.currency, to_char((it ->> 'line_total')::numeric, 'FM999,999,990.00')
         )
         -- The product may have been deleted since (product_id nulls on delete); then the item
         -- still lists, it just has nowhere to link.
         || case when it ->> 'product_id' is not null
                 then E'\n  https://raccoon-gear-bin.alsorandomkay.workers.dev/products/' || (it ->> 'product_id')
                 else '' end,
         E'\n')
       from jsonb_array_elements(p_items) as it),
      '(none)')
  );
$$;

-- Self-check: runs on every `supabase db reset` (and on push), so a drifted format fails the
-- migration itself. Record fixtures, no inserts — the effective_unit_price precedent.
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
  o.delivery_note := null;

  txt := public.order_telegram_text(
    o,
    '[{"quantity": 2, "name": "Widget", "sku": "W-1", "line_total": 99.98, "product_id": "11111111-1111-1111-1111-111111111111"},
      {"quantity": 1, "name": "Gadget", "sku": "G-2", "line_total": 33.46, "product_id": null}]'::jsonb
  );
  if txt <> E'New order #A1B2C3D4 — USD 133.44\nUser: Test Buyer\nPhone: 012345678\nLocation: Street 271\nItems:\n- 2× Widget [W-1] — USD 99.98\n  https://raccoon-gear-bin.alsorandomkay.workers.dev/products/11111111-1111-1111-1111-111111111111\n- 1× Gadget [G-2] — USD 33.46' then
    raise exception 'order_telegram_text fixture answered %', txt;
  end if;

  o.delivery_note := 'Leave at the gate';
  txt := public.order_telegram_text(o, '[]'::jsonb);
  if txt not like E'%Location: Street 271\nNote: Leave at the gate\nItems:\n(none)' then
    raise exception 'order_telegram_text note fixture answered %', txt;
  end if;
end;
$$;

-- Same trigger function, richer item payload for the builder above. Everything else — the Vault
-- lookup, the inert-when-unset rule, the exception wrap that protects the commit, the 4000-char
-- clip — is byte-for-byte the previous migration's body on purpose.
create or replace function public.notify_telegram_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_chat text;
  v_text text;
begin
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'telegram_bot_token';
  select s.decrypted_secret into v_chat from vault.decrypted_secrets s where s.name = 'telegram_chat_id';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    return new;
  end if;

  v_text := public.order_telegram_text(new, (
    select coalesce(jsonb_agg(jsonb_build_object(
             'quantity', oi.quantity, 'name', oi.name_snapshot, 'sku', oi.sku_snapshot,
             'line_total', oi.line_total, 'product_id', oi.product_id
           ) order by oi.created_at, oi.id), '[]'::jsonb)
    from public.order_items oi
    where oi.order_id = new.id
  ));

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object('chat_id', v_chat, 'text', left(v_text, 4000)),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Load-bearing: at commit this handler is what keeps a push failure from aborting the order.
  raise warning 'order telegram push skipped: %', sqlerrm;
  return new;
end;
$$;
