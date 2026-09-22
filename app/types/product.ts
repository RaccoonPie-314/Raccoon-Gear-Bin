import type { ProductCategory, ProductStatus } from './database'

export interface ProductSpecification {
  label: string
  value: string
}

export interface ProductRecord {
  id: string
  categoryId: string
  category: ProductCategory
  slug: string
  sku: string
  price: number
  currency: string
  stockQuantity: number
  status: ProductStatus
  isFeatured: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductTranslationRecord {
  productId: string
  locale: string
  name: string
  shortDescription: string
  description: string
  specifications: ProductSpecification[]
}

export interface ProductImageRecord {
  id: string
  productId: string
  storagePath: string
  altText?: string
  sortOrder: number
  isPrimary: boolean
}
