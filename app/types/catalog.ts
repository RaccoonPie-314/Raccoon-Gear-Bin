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
  price: number
  currency: string
  stockQuantity: number
  status: 'draft' | 'published' | 'archived'
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
