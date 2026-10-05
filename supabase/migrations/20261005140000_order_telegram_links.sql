-- Order push, third pass (owner request): the product link is embedded in the item line — the
-- name itself is the tappable anchor — instead of a bare URL underneath. Spec:
-- specs/ecommerce/SPEC-orders.md.
--
-- Embedding means HTML `parse_mode`, which means every piece of text that enters the message is
-- now markup-sensitive: a buyer's `<` or `&` in a name/address/note would either fail Telegram's
-- entity parser (400, and the push is lost) or let their text masquerade as markup. So all
-- dynamic text goes through `order_telegram_escape` (`&` first, then `<` `>`), and the 4000-char
-- clip in the trigger moves from a raw offset to a line boundary — every item line is a complete
-- `<a>…</a>`, so a mid-tag cut would be an unclosed tag, which is also a 400.

-- Telegram HTML-style escape. `&` first, so the ampersands of the entities this emits are not
-- re-escaped. The hrefs are built only from our own base URL plus a uuid, so they need nothing.
create or replace function public.order_telegram_escape(p_text text)
returns text
language sql immutable
as $$
  select replace(replace(replace(p_text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- Same builder, item lines wrapped in an anchor when the product still exists. The header's
-- "New order #… — USD …" stays line 1, so the notification preview is unchanged.
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
         -- The product may have been deleted since (product_id nulls on delete); then the item
         -- still lists, it just has nowhere to link.
         || case when it ->> 'product_id' is not null then '</a>' else '' end,
         E'\n')
       from jsonb_array_elements(p_items) as it),
      '(none)')
  );
$$;

-- Self-check, exact-equality on purpose: it pins the escaping on every user field, the anchor
-- markup on a linked item, and the plain line on a deleted-product item in one fixture.
do $$
declare
  o public.orders;
  txt text;
begin
  o.id := 'a1b2c3d4-0000-0000-0000-000000000000'::uuid;
  o.currency := 'USD';
  o.total := 133.44;
  o.delivery_name := 'Tom & Jerry';
  o.delivery_phone := '012345678';
  o.delivery_address := 'Street 271 <near the market>';
  o.delivery_note := 'Use <b> gate 2';

  txt := public.order_telegram_text(
    o,
    '[{"quantity": 2, "name": "Widget & Co", "sku": "W<1>", "line_total": 99.98, "product_id": "11111111-1111-1111-1111-111111111111"},
      {"quantity": 1, "name": "Gadget", "sku": "G-2", "line_total": 33.46, "product_id": null}]'::jsonb
  );
  if txt <> E'New order #A1B2C3D4 — USD 133.44\nUser: Tom &amp; Jerry\nPhone: 012345678\nLocation: Street 271 &lt;near the market&gt;\nNote: Use &lt;b&gt; gate 2\nItems:\n- <a href="https://raccoon-gear-bin.alsorandomkay.workers.dev/products/11111111-1111-1111-1111-111111111111">2× Widget &amp; Co [W&lt;1&gt;] — USD 99.98</a>\n- 1× Gadget [G-2] — USD 33.46' then
    raise exception 'order_telegram_text fixture answered %', txt;
  end if;

  o.delivery_note := null;
  txt := public.order_telegram_text(o, '[]'::jsonb);
  if txt not like E'%Items:\n(none)' or txt like '%Note:%' then
    raise exception 'order_telegram_text no-items fixture answered %', txt;
  end if;
end;
$$;

-- Same trigger function; the body gains `parse_mode` and the line-boundary clip. Everything
-- else — the Vault lookup, the inert-when-unset rule, the exception wrap that protects the
-- commit — is byte-for-byte the previous migration's body on purpose.
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

  -- Telegram rejects bodies over 4096 chars. Cut at the last line boundary inside the budget:
  -- a raw offset can split an <a> tag, and an unclosed tag is itself a 400.
  if length(v_text) > 4000 then
    v_text := regexp_replace(left(v_text, 4000), E'[^\n]*$', '');
  end if;

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object('chat_id', v_chat, 'text', v_text, 'parse_mode', 'HTML'),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Load-bearing: at commit this handler is what keeps a push failure from aborting the order.
  raise warning 'order telegram push skipped: %', sqlerrm;
  return new;
end;
$$;

-- New helper needs its own door closed; `create or replace` retained the other two ACLs.
revoke all on function public.order_telegram_escape(text) from public, anon, authenticated;
