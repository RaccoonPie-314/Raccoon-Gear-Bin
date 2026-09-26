export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ProductCategory =
  | 'controllers'
  | 'keyboards'
  | 'mice'
  | 'headphones'
  | 'earphones'

export type ProductStatus = 'draft' | 'published' | 'archived'

export type AdminRole = 'admin' | 'super_admin'

// Every row shape below must be a `type` literal, not an `interface`. Supabase's
// GenericSchema requires `Row extends Record<string, unknown>`, and TypeScript only gives
// object *type literals* an implicit index signature — interfaces do not get one, so the
// constraint silently fails and every query result resolves to `never`.
export type CategoryRow = {
  id: string
  slug: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CategoryTranslationRow = {
  id: string
  category_id: string
  locale: string
  name: string
  created_at: string
  updated_at: string
}

export type ProductRow = {
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

export type ProductTranslationRow = {
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

export type ProductImageRow = {
  id: string
  product_id: string
  storage_path: string
  alt_text: string | null
  sort_order: number
  is_primary: boolean
  created_at: string
  updated_at: string
}

export type AdminUserRow = {
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
        Relationships: [
          {
            foreignKeyName: 'category_translations_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          }
        ]
      }
      products: {
        Row: ProductRow
        Insert: Partial<Omit<ProductRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProductRow, 'category_id' | 'slug' | 'sku' | 'price'>
        Update: Partial<Omit<ProductRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: [
          {
            foreignKeyName: 'products_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          }
        ]
      }
      product_translations: {
        Row: ProductTranslationRow
        Insert: Partial<Omit<ProductTranslationRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProductTranslationRow, 'product_id' | 'locale' | 'name' | 'short_description' | 'description'>
        Update: Partial<Omit<ProductTranslationRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: [
          {
            foreignKeyName: 'product_translations_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          }
        ]
      }
      product_images: {
        Row: ProductImageRow
        Insert: Partial<Omit<ProductImageRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProductImageRow, 'product_id' | 'storage_path'>
        Update: Partial<Omit<ProductImageRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: [
          {
            foreignKeyName: 'product_images_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          }
        ]
      }
      admin_users: {
        Row: AdminUserRow
        Insert: Partial<Omit<AdminUserRow, 'id' | 'created_at' | 'updated_at'>> & Pick<AdminUserRow, 'user_id'>
        Update: Partial<Omit<AdminUserRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
    }
    // Must stay `{ [_ in never]: never }`, never `Record<string, never>`: a string index
    // makes `keyof Views` resolve to `string`, so Supabase's view overload for `from()`
    // matches every table name and types the relation as `never` — silently collapsing
    // every query result to `null`. Generated schemas use the never-key form for exactly
    // this reason.
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
