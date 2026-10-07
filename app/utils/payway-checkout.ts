/**
 * The checkout hop (SPEC-payments): the server signs and performs the purchase, and answers
 * `{ checkoutUrl }` — the signed fields never reach the browser. The URL is PayWay's own
 * "Choose way to pay" page, which offers every enabled method (ABA KHQR + card) in one gate;
 * navigating there is the whole job. No deeplink steering of our own: the hosted page handles
 * mobile, and our tab stays put until PayWay redirects it back to the result page.
 */
export const startPaywayCheckout = async (orderId: string): Promise<void> => {
  const { checkoutUrl } = await $fetch<{ checkoutUrl: string }>(
    '/api/payments/payway/create',
    { method: 'POST', body: { orderId } }
  )
  // Back from PayWay hard-loads the guarded /checkout with a stale __session JWT, which bounces
  // the buyer through /login (the defect the post-payment trio already excludes). This marker
  // carries the order id for 10 minutes, so that one return lands on the order's pay-result page.
  document.cookie = `payway-hop=${orderId}; path=/; max-age=600; samesite=lax`
  window.location.href = checkoutUrl
}
