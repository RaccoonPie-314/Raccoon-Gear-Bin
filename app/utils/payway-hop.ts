/**
 * The `payway-hop` marker's one reader-side decision. `startPaywayCheckout` arms the cookie as
 * `order:tran` so the buyer's return from the gateway can be answered without a session (the
 * `tran` is the only session-free read on the result page); the legacy order-only shape stays
 * accepted, because a tab that was mid-flight when the `tran` landed is a real buyer, not a stale
 * shape to reject.
 *
 * Returns the query the marker stands for, or null when it is absent or malformed — the guard
 * reads the cookie, this decides what it means, and the shape check is what keeps a client-set
 * cookie from becoming arbitrary query params.
 *
 * A plain function, not a composable: it reads no reactive state and touches no browser API.
 */
export function paywayHopQuery(raw: string | null | undefined): { order: string, tran?: string } | null {
  if (!raw) return null
  const [order = '', tran = ''] = raw.split(':')
  if (!/^[0-9a-f-]{36}$/.test(order)) return null
  // The same accepted tran shape `/api/payments/payway/verify` validates.
  return /^[A-Za-z0-9]{6,20}$/.test(tran) ? { order, tran } : { order }
}
