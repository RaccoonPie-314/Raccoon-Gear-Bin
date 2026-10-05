import type { Database } from '~/types/database'
import { cartTotals } from '~/utils/cart-totals'
import { locateDeliveryAddress } from '~/utils/geolocation'
import { shake } from '~/utils/motion'

/**
 * The client mirror of `create_order`'s delivery validation — same bounds, one predicate per
 * field so the live red state and the submit-time refusal can never disagree. The RPC stays the
 * authority (its `INVALID_DELIVERY` still answers anything this misses); the mirror exists so the
 * form can turn the field red, hint what is needed, and scroll to and shake the first offender.
 */
const REQUIRED_DELIVERY_FIELDS = ['name', 'phone', 'address', 'location'] as const
type DeliveryField = (typeof REQUIRED_DELIVERY_FIELDS)[number]
type DeliveryValues = Record<DeliveryField, string>

const deliveryFieldValid = (field: DeliveryField, values: DeliveryValues): boolean => {
  const value = values[field]
  switch (field) {
    case 'name': return !!value && value.length <= 100
    case 'phone': return value.length >= 8 && value.length <= 20
    case 'address': return !!value && value.length <= 300
    case 'location': return !!value && value.length <= 300 && /^https?:\/\//.test(value)
  }
}

/**
 * The checkout flow (specs/ecommerce/SPEC-orders.md): fresh product rows → the clamped cart lines
 * → the `create_order` RPC → clear the cart → the success page. The RPC is the authority on price
 * and stock; everything here is display state, profile prefill, and one in-flight guard.
 */
export const useCheckout = () => {
  const supabase = useSupabaseClient<Database>()
  const { locale, t } = useI18n()
  const localePath = useLocalePath()
  const { fetchProducts, products } = useCatalog()
  const { fetchProfile } = useCustomerAuth()
  const { items, clear } = useCart()

  const isLoading = ref(true)
  const loadError = ref(false)
  const isSubmitting = ref(false)
  const errorMessage = ref('')

  const name = ref('')
  const phone = ref('')
  const address = ref('')
  const locationLink = ref('')
  const note = ref('')

  const isLocating = ref(false)
  const locationError = ref('')

  // The live invalid-set: empty until the first submit has shown what is required, then it
  // recomputes as the buyer types — so a field's red and its hint clear the moment it is fixed,
  // without a second round trip or a per-field watcher.
  const validationShown = ref(false)
  const invalidFields = computed<DeliveryField[]>(() => {
    if (!validationShown.value) return []
    const values: DeliveryValues = {
      name: name.value.trim(), phone: phone.value.trim(), address: address.value.trim(), location: locationLink.value.trim()
    }
    return REQUIRED_DELIVERY_FIELDS.filter(field => !deliveryFieldValid(field, values))
  })

  // One geolocation read into the location-link field — the address stays whatever the buyer
  // typed; both are required by `create_order`. Re-asked on every click: the Permissions API is
  // consulted first because the three states want three different moves: a hard `denied` can
  // never be prompted again from script (the browser's anti-nagging rule), so that click guides
  // the user to the address-bar switch instead of failing silently — after they allow it, the
  // next click reads; `prompt` triggers the browser's own ask again; and `granted` reads without
  // a prompt. A denial or a failed fix costs a sentence, never the typed link.
  const locate = async () => {
    if (isLocating.value) return
    locationError.value = ''
    isLocating.value = true
    try {
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null)
      if (permission?.state === 'denied') {
        locationError.value = t('locationBlocked')
        return
      }
      locationLink.value = await locateDeliveryAddress()
    } catch (error) {
      const code = error instanceof Error ? error.message : 'unavailable'
      locationError.value = t(code === 'denied' ? 'locationBlocked' : 'locationFailed')
    } finally {
      isLocating.value = false
    }
  }

  const totals = computed(() => cartTotals(items.value, products.value))

  const load = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      await fetchProducts()
      // The profile prefill is auxiliary: a failed read costs the convenience, not the checkout
      // (the same policy the product page applies to its site-info read).
      const profile = await fetchProfile().catch(() => null)
      if (profile?.display_name) name.value = profile.display_name
      if (profile?.phone) phone.value = profile.phone
    } catch {
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  // Code → message: the one client-side mapping of the RPC's machine codes (the prefix is matched,
  // the trailing `<n>` fills the param). Copy lives here, never in SQL.
  const MESSAGE_BY_CODE: Record<string, string> = {
    AUTH_REQUIRED: 'loginRequired',
    CART_EMPTY: 'cartEmpty',
    CART_TOO_LARGE: 'errUnknown',
    INVALID_DELIVERY: 'errInvalidDelivery',
    PRODUCT_UNAVAILABLE: 'errProductUnavailable',
    INVALID_QUANTITY: 'errInvalidQuantity',
    ORDER_NOT_FOUND: 'errUnknown',
    NOT_ADMIN: 'errUnknown',
    INVALID_TRANSITION: 'errUnknown'
  }

  const messageFor = (raw: string): string => {
    const [code = '', , extra = ''] = raw.split(':')
    if (code === 'INSUFFICIENT_STOCK') return t('errInsufficientStock', { n: extra })
    if (code === 'PROMO_LIMIT') return t('errPromoLimit', { n: extra })
    return t(MESSAGE_BY_CODE[code] ?? 'errUnknown')
  }

  const submit = async (): Promise<boolean> => {
    if (isSubmitting.value) return false
    errorMessage.value = ''
    isSubmitting.value = true

    try {
      // Point at what is missing before spending a round trip: every invalid field turns red
      // with its own hint (the template reads `invalidFields`), and the first one is scrolled
      // to and shaken. The instant scroll under reduced motion is deliberate — the global rule
      // already turns smooth scrolling off there. The RPC's INVALID_DELIVERY remains the
      // authority for anything this mirror misses.
      validationShown.value = true
      const values: DeliveryValues = {
        name: name.value.trim(), phone: phone.value.trim(), address: address.value.trim(), location: locationLink.value.trim()
      }
      const firstInvalid = REQUIRED_DELIVERY_FIELDS.find(field => !deliveryFieldValid(field, values))
      if (firstInvalid) {
        errorMessage.value = t('errInvalidDelivery')
        const field = document.querySelector(`[data-checkout-field="${firstInvalid}"]`)
        field?.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        })
        shake(field)
        return false
      }

      const lines = totals.value.lines
        .filter(view => view.product && view.quantity >= 1)
        .map(view => ({ productId: view.line.productId, quantity: view.quantity }))

      const { data, error } = await supabase.rpc('create_order', {
        p_items: lines,
        p_delivery: {
          name: name.value.trim(),
          phone: phone.value.trim(),
          address: address.value.trim(),
          location: locationLink.value.trim(),
          note: note.value.trim() || null
        },
        p_locale: locale.value
      })

      if (error) {
        errorMessage.value = messageFor(String(error.message || ''))
        return false
      }

      clear()
      await navigateTo(localePath({ path: '/checkout/success', query: { order: String(data) } }))
      return true
    } catch {
      errorMessage.value = t('errUnknown')
      return false
    } finally {
      isSubmitting.value = false
    }
  }

  return { isLoading, loadError, isSubmitting, errorMessage, name, phone, address, locationLink, note, isLocating, locationError, locate, invalidFields, totals, load, submit }
}
