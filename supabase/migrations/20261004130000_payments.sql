-- Payments (phase 4, module `payments`). Spec: specs/ecommerce/SPEC-payments.md — including the
-- 2026-10-04 P0 amendment (checkout-sandbox base, the fixed hash order, the browser form-submit
-- flow, the sorted-keys callback signature, check-transaction-2).
--
-- This table is written only by the server tier (service role, server/api/payments/** — the repo's
-- sanctioned exception), so there are no client write policies at all. `mark_payment_refunded` is
-- the one client-callable write, admin-gated inside.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'payway' check (provider in ('payway')),
  -- The tran_id sent to PayWay: ≤20 chars, one per attempt. The unique constraint is also the
  -- lookup index the return/webhook path resolves rows by.
  provider_txn_id text not null unique,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'initiated'
    check (status in ('initiated', 'paid', 'failed', 'cancelled', 'refunded')),
  request_payload jsonb,                          -- what we sent (never secrets)
  result_payload jsonb,                           -- latest provider result, raw
  paid_at timestamptz,
  refund_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_order on public.payments(order_id);

create trigger set_updated_at_payments
before update on public.payments
for each row
execute function public.handle_updated_at();

alter table public.payments enable row level security;

-- Read: the order's owner or an admin — the nested-exists shape order_items uses.
create policy "Users can read their own payments"
on public.payments for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = payments.order_id
      and (o.user_id = auth.uid() or exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  )
);

-- No INSERT/UPDATE/DELETE policies: the server tier's service role is the only writer. The two
-- guards below make the function safe to call twice and safe to call on an unpaid order — the
-- refund money itself moves manually in the ABA portal (v1), this is the DB marker only.
create or replace function public.mark_payment_refunded(p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
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

revoke all on function public.mark_payment_refunded(uuid, text) from public, anon;
grant execute on function public.mark_payment_refunded(uuid, text) to authenticated;
