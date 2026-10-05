export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// Categories are rows in `product_categories`, not an enum — so there is no category union here.
export type ProductStatus = 'draft' | 'published' | 'archived'

export type AdminRole = 'admin' | 'super_admin'

export type OrderStatus = 'pending' | 'confirmed' | 'delivered' | 'cancelled'

// Only 'unpaid' is reachable until the payments module (phase 4) writes the other two.
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded'

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

// The five promo columns are what `app/utils/product-pricing.ts` reads to decide whether a product
// is discounted; they mirror `20260930120000_product_promotions.sql`, and `price` stays the original
// price a promotion crosses out rather than being overwritten by it.
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
  promo_price: number | null
  promo_label: string | null
  promo_quantity: number | null
  promo_starts_at: string | null
  promo_ends_at: string | null
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

// Customer profile, 1:1 with `auth.users`. Rows are written by the `on_auth_user_created`
// trigger, never by the client; the client only reads and updates its own row (RLS), which is
// why there is no INSERT policy in `20261004022937_customer_accounts.sql`.
export type ProfileRow = {
  id: string
  display_name: string | null
  phone: string | null
  created_at: string
  updated_at: string
}

// Singleton row (the schema's check constraint keeps id = 1). `location_translations` holds
// [{ locale, label }]; `social_links` holds [{ platform, url, enabled, sort_order }] so new
// platforms never touch the schema. Both are parsed only in useSiteInfo.
export type SiteSettingsRow = {
  id: number
  phone: string
  location_url: string
  location_translations: Json
  social_links: Json
  created_at: string
  updated_at: string
}

// Rows are written only by the `create_order` / `set_order_status` RPCs (there are no client
// INSERT/UPDATE/DELETE policies at all); the columns mirror 20261004050806_orders_and_checkout.sql.
export type OrderRow = {
  id: string
  user_id: string | null
  status: OrderStatus
  delivery_name: string | null
  delivery_phone: string | null
  delivery_address: string | null
  /** The map pin the geolocation button filled — a URL; required since 20261005150000. */
  delivery_location: string | null
  delivery_note: string | null
  subtotal: number
  total: number
  currency: string
  payment_status: PaymentStatus
  confirmed_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancel_note: string | null
  created_at: string
  updated_at: string
}

// The snapshot columns are what an order keeps when the product behind it changes or disappears.
export type OrderItemRow = {
  id: string
  order_id: string
  product_id: string | null
  name_snapshot: string
  sku_snapshot: string
  unit_price: number
  unit_price_original: number | null
  promo_label_snapshot: string | null
  quantity: number
  line_total: number
  created_at: string
}

// One payment attempt. Written only by the payments server tier (service role — no client write
// policies; refunds via `mark_payment_refunded`). Mirrors 20261004130000_payments.sql.
export type PaymentAttemptStatus = 'initiated' | 'paid' | 'failed' | 'cancelled' | 'refunded'

export type PaymentRow = {
  id: string
  order_id: string
  provider: 'payway'
  provider_txn_id: string
  amount: number
  currency: string
  status: PaymentAttemptStatus
  request_payload: Json | null
  result_payload: Json | null
  paid_at: string | null
  refund_note: string | null
  created_at: string
  updated_at: string
}

// ── identity v2 (SPEC-identity.md amendment, 2026-10-05) ──────────────────────────────────────
// All four are service-tier tables. RLS is on everywhere; only `telegram_links` carries a
// client-facing policy (select-own — the account page shows the connected @username). The
// /api/auth/** routes reach the rest with the service-role client, the same confinement the
// payments module documents.

export type TelegramLinkRow = {
  tg_id: number
  user_id: string
  tg_username: string | null
  created_at: string
}

export type TelegramLoginRequestRow = {
  nonce: string
  user_id: string | null
  status: 'pending' | 'confirmed' | 'consumed'
  tg_id: number | null
  tg_username: string | null
  tg_first_name: string | null
  created_at: string
  expires_at: string
}

export type LoginCodeRow = {
  user_id: string
  code_hash: string
  expires_at: string
  attempts: number
  created_at: string
}

export type AuthRateLimitRow = {
  key: string
  window_start: string
  count: number
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
      },
      profiles: {
        Row: ProfileRow
        Insert: Partial<Omit<ProfileRow, 'id' | 'created_at' | 'updated_at'>> & Pick<ProfileRow, 'id'>
        Update: Partial<Omit<ProfileRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      },
      site_settings: {
        Row: SiteSettingsRow
        Insert: Partial<Omit<SiteSettingsRow, 'created_at' | 'updated_at'>>
        Update: Partial<Omit<SiteSettingsRow, 'created_at' | 'updated_at'>>
        Relationships: []
      },
      orders: {
        Row: OrderRow
        Insert: Partial<Omit<OrderRow, 'id' | 'created_at' | 'updated_at'>> & Pick<OrderRow, 'subtotal' | 'total'>
        Update: Partial<Omit<OrderRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      },
      order_items: {
        Row: OrderItemRow
        Insert: Partial<Omit<OrderItemRow, 'id' | 'created_at'>> & Pick<OrderItemRow, 'order_id' | 'name_snapshot' | 'sku_snapshot' | 'unit_price' | 'quantity' | 'line_total'>
        Update: Partial<Omit<OrderItemRow, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_items_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          }
        ]
      },
      payments: {
        Row: PaymentRow
        Insert: Partial<Omit<PaymentRow, 'id' | 'created_at' | 'updated_at'>> & Pick<PaymentRow, 'order_id' | 'provider_txn_id' | 'amount'>
        Update: Partial<Omit<PaymentRow, 'id' | 'created_at' | 'updated_at'>>
        Relationships: [
          {
            foreignKeyName: 'payments_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          }
        ]
      },
      telegram_links: {
        Row: TelegramLinkRow
        Insert: Partial<Omit<TelegramLinkRow, 'created_at'>> & Pick<TelegramLinkRow, 'tg_id' | 'user_id'>
        Update: Partial<Omit<TelegramLinkRow, 'created_at'>>
        Relationships: []
      },
      telegram_login_requests: {
        Row: TelegramLoginRequestRow
        Insert: Partial<Omit<TelegramLoginRequestRow, 'created_at'>> & Pick<TelegramLoginRequestRow, 'nonce' | 'expires_at'>
        Update: Partial<Omit<TelegramLoginRequestRow, 'created_at'>>
        Relationships: []
      },
      login_codes: {
        Row: LoginCodeRow
        Insert: Partial<Omit<LoginCodeRow, 'created_at'>> & Pick<LoginCodeRow, 'user_id' | 'code_hash' | 'expires_at'>
        Update: Partial<Omit<LoginCodeRow, 'created_at'>>
        Relationships: []
      },
      auth_rate_limits: {
        Row: AuthRateLimitRow
        Insert: Partial<AuthRateLimitRow> & Pick<AuthRateLimitRow, 'key'>
        Update: Partial<Omit<AuthRateLimitRow, 'key'>>
        Relationships: []
      },
    }
    // Must stay `{ [_ in never]: never }`, never `Record<string, never>`: a string index
    // makes `keyof Views` resolve to `string`, so Supabase's view overload for `from()`
    // matches every table name and types the relation as `never` — silently collapsing
    // every query result to `null`. Generated schemas use the never-key form for exactly
    // this reason.
    Views: { [_ in never]: never }
    // The write path for orders: the RPCs are the only doors (there are no table-level write
    // policies), and this map is what makes `supabase.rpc(...)` typed rather than `any`.
    Functions: {
      anonymize_customer: {
        Args: { p_user_id: string }
        Returns: number
      }
      create_order: {
        Args: { p_delivery: Json, p_items: Json, p_locale: string }
        Returns: string
      }
      mark_payment_refunded: {
        Args: { p_note: string | null, p_order_id: string }
        Returns: undefined
      }
      set_order_status: {
        Args: { p_note: string | null, p_order_id: string, p_status: string }
        Returns: undefined
      },
      telegram_send_message: {
        Args: { p_chat_id: number, p_text: string }
        Returns: undefined
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
