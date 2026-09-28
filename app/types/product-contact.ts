// View models for the product-page conversion actions. Like catalog.ts and site-info.ts these
// are presentation shapes, not row shapes — but nothing here is read from a table: a channel is
// *resolved* from the public SiteInfo model that `useSiteInfo` already produced, which is why
// this feature adds no data layer and no schema. The stock band the CTA words itself around is
// not repeated here: `ProductStockState` lives beside the rule that decides it, in
// `app/utils/product-stock.ts`.

/**
 * One contact/order channel the shop has actually configured.
 *
 * `href` is the stored value — the phone number as a `tel:` link, or a social link's own URL —
 * **except** where the platform documents a way to carry the message with it (see
 * `app/utils/social-prefill.ts`). That exception is the only assembly that ever happens, and it
 * uses the shop's own configured identity: a username, handle or number is never invented, and a
 * stored profile URL is never rewritten into a compose URL.
 *
 * `prefilled` is what the row is allowed to claim. A row that carries the message says so; a row
 * that does not must point at the explicit Copy action instead, so the UI never implies a paste
 * that did not happen.
 */
export type ProductContactChannel = {
  key: string
  /** Normalisable platform name: `phone`, `telegram`, `whatsapp`, or whatever the shop typed. */
  platform: string
  label: string
  href: string
  value: string
  external: boolean
  prefilled: boolean
}
