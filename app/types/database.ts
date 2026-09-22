export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ProductCategory =
  | 'controllers'
  | 'keyboards'
  | 'mice'
  | 'headphones'
  | 'earphones'

export type ProductStatus = 'draft' | 'published' | 'archived'

export type AdminRole = 'admin' | 'super_admin'

export interface CategoryRow {
  id: string
  slug: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CategoryTranslationRow {
  id: string
  category_id: string
  locale: string
  name: string
  created_at: string
  updated_at: string
}

export interface ProductRow {
  id: string
  category_id: string
  slug: string
  sku: string
  price: number
  currency: string
  stock_quantity: number
  status: ProductStatus
  is_featured: boolean
  created_at: string
  updated_at: string
}

export interface ProductTranslationRow {
  id: string
  product_id: string
  locale: string
  name: string
  short_description: string
  description: string
  specifications: Json
  created_at: string
  updated_at: string
}

export interface ProductImageRow {
  id: string
  product_id: string
  storage_path: string
  alt_text: string | null
  sort_order: number
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface AdminUserRow {
  id: string
  user_id: string
  role: AdminRole
  created_at: string
  updated_at: string
}
