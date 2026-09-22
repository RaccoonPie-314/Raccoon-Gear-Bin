export interface CatalogImage {
  id: string
  storagePath: string
  altText: string | null
  url: string
}

export interface CatalogProduct {
  id: string
  categoryId: string
  categoryName: string
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
}
