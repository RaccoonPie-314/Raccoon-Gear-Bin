import type { CatalogCategory } from '~/types/catalog'

/**
 * The glyphs `CategoryIcon.vue` actually draws. `other` is the fallback every category outside the
 * original five wears, so a category the shop adds from the admin is navigable on the same terms as
 * one that shipped with the schema.
 */
export type CategoryIconName = 'all' | 'controllers' | 'keyboards' | 'mice' | 'headphones' | 'earphones' | 'other'

/** Slug → glyph. Matched on the stored slug and never on a translated name, so a Khmer label keeps
 * its icon and a renamed category keeps its glyph. */
const ICON_BY_SLUG: Record<string, CategoryIconName> = {
  controllers: 'controllers',
  keyboards: 'keyboards',
  mice: 'mice',
  headphones: 'headphones',
  earphones: 'earphones'
}

/** A dock entry resolved against the live `categories` rows. */
export interface CategoryItem {
  key: CategoryIconName
  slug: string
  value: string
  name: string
  dbId?: string
}

/**
 * The category model shared by the desktop and mobile docks: which items exist, and which one is
 * selected. The list *is* the shop's own rows in the order it sorted them (`fetchCategories` is
 * `is_active` + `sort_order`), plus the one virtual item that clears the filter. It used to be a
 * hardcoded six, which meant an added category was real — products could be filed under it, the admin
 * select offered it — but nobody could reach it from the storefront.
 *
 * Deliberately free of anything to do with pointers, touch, geometry or animation — those differ per
 * input model and stay inside each component, and both of them iterate `computedItems` and measure
 * whatever arrives rather than assuming a length.
 *
 * `props` is the caller's reactive props object; it is read, never held or mutated.
 */
export const useCategoryItems = (props: { modelValue: string; categories?: CatalogCategory[] }) => {
  const { t } = useI18n()

  const computedItems = computed<CategoryItem[]>(() => [
    { key: 'all', slug: 'all', value: 'all', name: t('all') },
    ...(props.categories || []).map((category) => ({
      key: ICON_BY_SLUG[(category.slug || '').toLowerCase()] || 'other',
      slug: category.slug || category.id,
      value: category.id,
      name: category.name,
      dbId: category.id
    }))
  ])

  const isItemActive = (item: CategoryItem) => {
    const current = props.modelValue
    if (item.key === 'all') {
      return !current || current === 'all'
    }
    return current === item.value || current === item.slug || (Boolean(item.dbId) && current === item.dbId)
  }

  const activeIndex = computed(() => {
    const idx = computedItems.value.findIndex((item) => isItemActive(item))
    return idx !== -1 ? idx : 0
  })

  /**
   * The `modelValue` a tap on `item` should produce. Selecting the active category, or
   * "all", clears the filter back to everything.
   */
  const nextSelection = (item: CategoryItem) => {
    if (item.key === 'all') return 'all'
    return isItemActive(item) ? 'all' : item.value
  }

  return { computedItems, isItemActive, activeIndex, nextSelection }
}
