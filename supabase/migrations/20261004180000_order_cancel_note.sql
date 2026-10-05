-- ---------------------------------------------------------------------------------------------
-- Order cancellation notes (owner request, 2026-10-04): when the desk cancels an order, the
-- canceller can leave a reason/note; the buyer reads it on their order detail. Optional free text.
--
-- A NEW file because 20261004050806_orders_and_checkout.sql is already pushed — pushed migrations
-- are never edited.

alter table public.orders add column if not exists cancel_note text;

-- ---------------------------------------------------------------------------------------------
-- set_order_status gains `p_note`. A signature change cannot ride `create or replace` — that
-- would leave the old two-argument overload in place and every existing two-argument call would
-- turn ambiguous ("function is not unique") — so the old function is dropped first and its grant
-- re-issued for the new signature. Defaulted, so an old-shaped two-argument call still resolves.
--
-- The note is written only by the cancel branch, and an all-whitespace note stores as null.

drop function if exists public.set_order_status(uuid, text);

create function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
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
    update public.orders
       set status = 'cancelled',
           cancelled_at = now(),
           cancel_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_order_id;
  end if;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The note is free text and can hold personal detail, so the deletion runbook clears it with the
-- rest of the contact fields. `create or replace` — the signature is unchanged.

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
     set delivery_name = null, delivery_phone = null, delivery_address = null, delivery_note = null, cancel_note = null
   where user_id = p_user_id
     and (delivery_name is not null or delivery_phone is not null or delivery_address is not null or delivery_note is not null or cancel_note is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
