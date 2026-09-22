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

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: CategoryRow
        Insert: Partial<Omit<CategoryRow, 'id' | 'created_at' | 'updated_at'>> & Pick<CategoryRow, 'slug'>
        Update: Partial<Omit<CategoryRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      category_translations: {
        Row: CategoryTranslationRow
        Insert: Partial<Omit<CategoryTranslationRow, 'id' | 'created_at' | 'updated_at'>> & Pick<CategoryTranslationRow, 'category_id' | 'locale' | 'name'>
        Update: Partial<Omit<CategoryTranslationRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      products: {
        Row: ProductRow
        Insert: Partial<Omit<ProductRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProductRow, 'category_id' | 'slug' | 'sku' | 'price'>
        Update: Partial<Omit<ProductRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      product_translations: {
        Row: ProductTranslationRow
        Insert: Partial<Omit<ProductTranslationRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProductTranslationRow, 'product_id' | 'locale' | 'name' | 'short_description' | 'description'>
        Update: Partial<Omit<ProductTranslationRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      product_images: {
        Row: ProductImageRow
        Insert: Partial<Omit<ProductImageRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProductImageRow, 'product_id' | 'storage_path'>
        Update: Partial<Omit<ProductImageRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      admin_users: {
        Row: AdminUserRow
        Insert: Partial<Omit<AdminUserRow, 'id' | 'created_at' | 'updated_at'>> & Pick<AdminUserRow, 'user_id'>
        Update: Partial<Omit<AdminUserRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
