// View models for the product-page conversion actions. Like catalog.ts and site-info.ts these
// are presentation shapes, not row shapes — but nothing here is read from a table: a channel is
// *resolved* from the public SiteInfo model that `useSiteInfo` already produced, which is why
// this feature adds no data layer and no schema. The stock band the CTA words itself around is
// not repeated here: `ProductStockState` lives beside the rule that decides it, in
// `app/utils/product-stock.ts`.

/**
 * One contact/order channel the shop has actually configured. `href` is always the stored value
 * (the phone number as a `tel:` link, or a social link's own URL) — never something assembled
 * from a guess about the platform. `label` is the translated word for the channel and `value`
 * the part worth showing beside it (the number for a phone, empty for a social profile whose URL
 * is already the destination).
 */
export type ProductContactChannel = {
  key: string
  label: string
  href: string
  value: string
  external: boolean
}
