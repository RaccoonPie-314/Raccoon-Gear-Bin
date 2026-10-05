-- Order push (owner request): every new order is POSTed to the shop's Telegram bot.
-- Spec: specs/ecommerce/SPEC-orders.md.
--
-- Why a deferred CONSTRAINT trigger and not a plain AFTER INSERT one: create_order inserts the
-- orders row in pass 1 and its items in pass 2, so a row trigger on `orders` fires while
-- `order_items` is still empty. Deferred to commit, the trigger sees the finished order. A
-- rollback never fires it, so a failed order is never announced.
-- Why a trigger at all and not a call inside create_order: create_order lives in a pushed
-- migration and is never edited; the push attaches to the write path instead of owning it.
--
-- Secrets: the bot token and the destination chat live in Vault (`telegram_bot_token` /
-- `telegram_chat_id`) — never in this repo, never in the database in plaintext. With either
-- absent the trigger is inert: the feature is switched on by creating the two secrets, and
-- nothing here changes. The whole body is exception-wrapped on purpose — this fires AT COMMIT,
-- where an unhandled error would roll back the buyer's order itself. The order is the money
-- path; the push is decoration. A failed send raises a warning and is visible in
-- net._http_response (kept 6h); there is deliberately no retry — a lost or duplicate push is
-- cheaper than any risk on the order path.

create extension if not exists pg_net with schema extensions;

-- The message body, factored out so its shape is pinned by a fixture below (the
-- effective_unit_price precedent). Plain text only: Telegram markup is avoided so buyer-entered
-- text can never break the message.
create or replace function public.order_telegram_text(p_order public.orders, p_items jsonb)
returns text
language sql immutable
as $$
  select concat(
    'New order #', upper(substring(p_order.id::text, 1, 8)),
    ' — ', p_order.currency, ' ', to_char(p_order.total, 'FM999,999,990.00'),
    E'\n', coalesce(p_order.delivery_name, '(no name)'), ' · ', coalesce(p_order.delivery_phone, '-'),
    E'\n', coalesce(p_order.delivery_address, '(no address)'),
    case when p_order.delivery_note is not null then E'\nNote: ' || p_order.delivery_note else '' end,
    E'\n', coalesce(
      (select string_agg(format('%s× %s [%s]', it ->> 'quantity', it ->> 'name', it ->> 'sku'), E'\n')
         from jsonb_array_elements(p_items) as it),
      '(no items)'
    )
  );
$$;

-- Self-check: runs on every `supabase db reset` (and on push), so a drifted format fails the
-- migration itself. Fixtures are record variables built field-by-field — no inserts involved.
do $$
declare
  o public.orders;
  txt text;
begin
  o.id := 'a1b2c3d4-0000-0000-0000-000000000000'::uuid;
  o.currency := 'USD';
  o.total := 123.45;
  o.delivery_name := 'Test Buyer';
  o.delivery_phone := '012345678';
  o.delivery_address := 'Street 271';
  o.delivery_note := null;

  txt := public.order_telegram_text(
    o,
    '[{"quantity": 2, "name": "Widget", "sku": "W-1"}, {"quantity": 1, "name": "Gadget", "sku": "G-2"}]'::jsonb
  );
  if txt <> E'New order #A1B2C3D4 — USD 123.45\nTest Buyer · 012345678\nStreet 271\n2× Widget [W-1]\n1× Gadget [G-2]' then
    raise exception 'order_telegram_text fixture answered %', txt;
  end if;

  o.delivery_note := 'Leave at the gate';
  txt := public.order_telegram_text(o, '[]'::jsonb);
  if txt not like E'%Note: Leave at the gate\n(no items)' then
    raise exception 'order_telegram_text note fixture answered %', txt;
  end if;
end;
$$;

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
             'quantity', oi.quantity, 'name', oi.name_snapshot, 'sku', oi.sku_snapshot
           ) order by oi.created_at, oi.id), '[]'::jsonb)
    from public.order_items oi
    where oi.order_id = new.id
  ));

  -- Telegram rejects bodies over 4096 chars; clip so the worst case (50 items with long names)
  -- still lands as a readable notification instead of a 400.
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

create constraint trigger notify_telegram_new_order
after insert on public.orders
deferrable initially deferred
for each row
execute function public.notify_telegram_new_order();

-- Postgres grants EXECUTE to PUBLIC by default; the revokes are part of the contract, not
-- decoration. Trigger functions cannot be called directly anyway; this closes the REST door.
revoke all on function public.order_telegram_text(public.orders, jsonb) from public, anon, authenticated;
revoke all on function public.notify_telegram_new_order() from public, anon, authenticated;
