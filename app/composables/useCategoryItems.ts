import type { CatalogCategory } from '~/types/catalog'

/** Static definition of every navigable category, in dock order. */
interface CategoryItemDef {
  key: CategoryIconName
  slug: string
  labelKey: string
  defaultName: string
}

export type CategoryIconName = 'all' | 'controllers' | 'keyboards' | 'mice' | 'headphones' | 'earphones'

/** A definition resolved against the live category rows and the current locale. */
export interface CategoryItem {
  key: CategoryIconName
  slug: string
  value: string
  name: string
  dbId?: string
}

const CATEGORY_ITEMS: CategoryItemDef[] = [
  { key: 'all', slug: 'all', labelKey: 'all', defaultName: 'All Gear' },
  { key: 'controllers', slug: 'controllers', labelKey: 'controllers', defaultName: 'Controllers' },
  { key: 'keyboards', slug: 'keyboards', labelKey: 'keyboards', defaultName: 'Keyboards' },
  { key: 'mice', slug: 'mice', labelKey: 'mice', defaultName: 'Mice' },
  { key: 'headphones', slug: 'headphones', labelKey: 'headphones', defaultName: 'Headphones' },
  { key: 'earphones', slug: 'earphones', labelKey: 'earphones', defaultName: 'Earphones' }
]

/**
 * The category model shared by the desktop and mobile docks: which items exist, how a
 * definition resolves against the rows loaded from Supabase, and which one is selected.
 *
 * Deliberately free of anything to do with pointers, touch, geometry or animation — those
 * differ per input model and stay inside each component.
 *
 * `props` is the caller's reactive props object; it is read, never held or mutated.
 */
export const useCategoryItems = (props: { modelValue: string; categories?: CatalogCategory[] }) => {
  const { t } = useI18n()

  const computedItems = computed<CategoryItem[]>(() => CATEGORY_ITEMS.map((item) => {
    if (item.key === 'all') {
      return {
        key: 'all' as const,
        slug: 'all',
        value: 'all',
        name: t('all') || item.defaultName
      }
    }

    // Rows are matched loosely so the dock keeps working whether the page identified a
    // category by slug, by uuid, or only by its English display name.
    const matchedDbCat = props.categories?.find((cat) => {
      if (cat.slug && cat.slug.toLowerCase() === item.slug.toLowerCase()) return true
      if (cat.id && cat.id.toLowerCase() === item.slug.toLowerCase()) return true
      if (cat.name && cat.name.toLowerCase() === item.defaultName.toLowerCase()) return true
      return false
    })

    const name = matchedDbCat?.name || (t(item.labelKey) !== item.labelKey ? t(item.labelKey) : item.defaultName)
    const value = matchedDbCat?.id || item.slug

    return {
      key: item.key,
      slug: item.slug,
      value,
      dbId: matchedDbCat?.id,
      name
    }
  }))

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
