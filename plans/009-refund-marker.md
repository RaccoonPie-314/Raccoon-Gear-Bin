# 009 — The refund marker gets its handle (SPEC-payments criterion 5)

Status: **applied, uncommitted.** Module `payments`, spec
[SPEC-payments.md](../specs/ecommerce/SPEC-payments.md) → amendment 2026-10-07. Fault found while
writing the `doc-truth` pass of plans/007: `mark_payment_refunded` was live in the schema, typed, and
called by nothing, so a refund left no trace in our tables and criterion 5 was unmet.

## What it is

Four pieces, each mirroring something already in the tree:

| Piece | Shape |
|---|---|
| `POST /api/orders/[id]/refund` | A near-copy of `status.post.ts`: `requireUser` + `userTx` + the RPC, P0001 → 400 with the RPC's own machine code (`NOT_ADMIN`), everything else → 500 |
| `canRefund(paymentStatus)` in `app/utils/order-status.ts` | The one-element rule (`paid` only), beside the transition table it deliberately is not part of — money is a separate axis from fulfilment |
| Desk button + a note, in the shared confirm dialog | Rendered **beside** the transitions row (`v-if="canRefund(...)"`), because a terminal order renders no transitions and still needs this |
| Stub route + `payment_status` mutation | The harness's first mutable *order*, so the desk's reload can be read back rather than only the request asserted |

The button lives in the desk's expanded row; the confirm dialog is now one dialog for both arms
(cancel and refund) with per-arm copy, instead of a second near-identical block — the two drift apart
otherwise.

## Why cancel and refund are separate (the design decision)

`ORDER_TRANSITIONS` is fulfilment: pending → confirmed → delivered, or cancelled. Money is not part of
it, and the SPEC makes the case explicit — *"paid then cancelled: money is returned manually; the DB
keeps `paid` on the payment and `cancelled` on the order — the refund marker is the admin's explicit
act."* So a paid-and-cancelled order must still offer the refund, which is exactly what the fixture
now is. Folding it into the transition table would have made the two states mutually exclusive, which
is precisely what the SPEC forbids.

The RPC is left alone: it is already the boundary (`security definer`, re-checks `admin_users`,
guards both updates on `status = 'paid'` so a double-click is a no-op). Nothing in this slice touches
`db/migrations/**` or `supabase/migrations/**`.

## Verification

- `bun run test` **53 pass / 0 fail** (one new: the `canRefund` table, with the SQL guard cited).
- `--only=admin` **103/103** (six new), then the full suite **once** before the claim.
- **Sabotage, both levels:** with `canRefund` loosened to `!== 'refunded'`, the unit suite reports
  `1 fail` *and* the harness reports `FAIL an unpaid order offers no refund marker` (102/103). The
  money-safety rule — never offer a refund where there is nothing to refund — is pinned, not asserted.

## Left alone on purpose

- **The money itself.** The refund happens in the ABA merchant portal; the marker records it. No
  refund API integration — that is the recorded v1 decision, and criterion 5 only asks for the marker.
- **`payments.refund_note`** is written by the RPC and has no reader yet: the desk shows the order's
  payment status and the cancellation note, and a refund note would need its own row in the detail.
  Deliberately not added — the note is stored for the record, which is what the RPC is for.
