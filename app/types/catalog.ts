export interface CatalogImage {
  id: string
  storagePath: string
  altText: string | null
  url: string
}

// A type alias, not an interface: this shape is returned where the `specifications` jsonb
// column type (`Json`) is expected, and TypeScript grants the implicit index signature that
// requires to object *type literals* only. `bun run build` does not type-check, so the wrong
// declaration here fails silently at runtime and loudly only under `tsc`.
export type CatalogSpecification = {
  label: string
  value: string
}

export interface CatalogProduct {
  id: string
  categoryId: string
  /** The stored category name, or `null` when the product has no resolvable category. The view
   * owns the fallback wording, because only a template can translate it in the active locale. */
  categoryName: string | null
  categorySlug?: string
  slug: string
  sku: string
  /** The stored price — the original, not what a running promotion brings it down to. Ask
   * `getProductPricing` (`app/utils/product-pricing.ts`) what a visitor should be charged. */
  price: number
  currency: string
  stockQuantity: number
  status: 'draft' | 'published' | 'archived'
  /** The promotion as it is stored, column for column. Whether it applies *now* is decided by one
   * rule in `app/utils/product-pricing.ts`, not by every view that renders a price. */
  promoPrice: number | null
  promoLabel: string | null
  promoQuantity: number | null
  promoStartsAt: string | null
  promoEndsAt: string | null
  name: string
  shortDescription: string
  description: string
  specifications: string
  images: CatalogImage[]
}

export interface CatalogCategory {
  id: string
  name: string
  slug?: string
}

/**
 * The admin editor's view of a category row: everything the public list resolves away — both
 * locales' names, the sort number and whether the shop has hidden it. A locale with no stored row is
 * simply absent from `names`, which is what the public view's English fallback reads.
 */
export interface CatalogCategoryDraft {
  id: string
  slug: string
  sortOrder: number
  isActive: boolean
  names: Record<string, string>
}
