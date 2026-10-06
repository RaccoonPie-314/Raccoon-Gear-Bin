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
  window.location.href = checkoutUrl
}
