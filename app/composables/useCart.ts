import type { CartLine } from '~/utils/cart-totals'
import { CART_MAX_QUANTITY, parseCartLines, serializeCartLines } from '~/utils/cart-totals'

/**
 * The cart's state and persistence (specs/ecommerce/SPEC-cart.md). It owns the lines and nothing
 * else: prices, caps and availability are questions for `cartTotals` + `getProductPricing` at
 * render time, and no price ever touches storage.
 *
 * Per-device, deliberately: a signed-out cart lives under `…:guest`, a signed-in one under the
 * account's uuid, and a sign-in merges the guest lines in once. Cross-device sync is a deferred
 * decision in the spec, not an oversight here.
 */

const STORAGE_PREFIX = 'raccoon-cart:v1:'
const storageKey = (scope: string) => `${STORAGE_PREFIX}${scope}`

// Binding — the initial load and the sign-in merge watcher — happens once per page session no
// matter how many components call `useCart` (masthead, cart page, checkout).
let bound = false

export const useCart = () => {
  const { user } = useUser()
  const items = useState<CartLine[]>('cart:items', () => [])

  // Clerk's user id once the SDK holds a session; `guest` before that and when signed out. The
  // key is the account id either way, so a cart follows the same human across the auth flip.
  const scope = () => user.value?.id || 'guest'

  const load = () => {
    if (!import.meta.client) return
    items.value = parseCartLines(window.localStorage.getItem(storageKey(scope())))
  }

  const persist = () => {
    if (!import.meta.client) return
    window.localStorage.setItem(storageKey(scope()), serializeCartLines(items.value))
  }

  // Quantities sum, the cap clamps, the guest key goes — idempotent because the guest key is read
  // once and deleted.
  const mergeGuestCart = (userId: string) => {
    const guest = parseCartLines(window.localStorage.getItem(storageKey('guest')))
    if (!guest.length) return
    const merged = new Map<string, number>()
    for (const line of [...parseCartLines(window.localStorage.getItem(storageKey(userId))), ...guest]) {
      merged.set(line.productId, Math.min((merged.get(line.productId) ?? 0) + line.quantity, CART_MAX_QUANTITY))
    }
    window.localStorage.setItem(storageKey(userId), serializeCartLines([...merged].map(([productId, quantity]) => ({ productId, quantity }))))
    window.localStorage.removeItem(storageKey('guest'))
  }

  if (import.meta.client && !bound) {
    bound = true
    let current = scope()
    // A sign-in that happened before the cart ever bound — the session cookie outlives full page
    // loads, and the auth pages never touch the cart — left the guest lines in the guest key.
    // Fold them in at bind time; after binding, the watcher handles the live transition. (The
    // harness caught the gap: signup left the guest key intact because no useCart ever ran.)
    if (current !== 'guest') mergeGuestCart(current)
    load()
    // The transition watcher lives in a DETACHED scope, never the caller's: `useCart` is called
    // during whichever page first renders a cart surface, and a component-scoped watcher dies when
    // that page unmounts — the first client-side navigation killed it, `bound` then blocked every
    // later call from re-registering, and the cart silently stopped following sign-in/out: items
    // stayed on screen into the next account (carried across accounts, owner's report) and the
    // guest key was only ever consumed by a full reload. The harness only saw full page loads,
    // which re-bind, so it never caught this; the walk in it now signs in client-side on purpose.
    effectScope(true).run(() => {
      watch(user, () => {
        const next = scope()
        if (next === current) return
        if (current === 'guest' && next !== 'guest') mergeGuestCart(next)
        current = next
        load()
      })
    })
  }

  const count = computed(() => items.value.reduce((sum, line) => sum + line.quantity, 0))

  const addLine = (productId: string, quantity: number = 1) => {
    const safe = Math.min(Math.max(1, Math.floor(quantity) || 1), CART_MAX_QUANTITY)
    const existing = items.value.find(line => line.productId === productId)
    items.value = existing
      ? items.value.map(line => (line.productId === productId
          ? { ...line, quantity: Math.min(line.quantity + safe, CART_MAX_QUANTITY) }
          : line))
      : [...items.value, { productId, quantity: safe }]
    persist()
  }

  const setQuantity = (productId: string, quantity: number) => {
    const safe = Math.min(Math.max(1, Math.floor(quantity) || 1), CART_MAX_QUANTITY)
    items.value = items.value.map(line => (line.productId === productId ? { ...line, quantity: safe } : line))
    persist()
  }

  const removeLine = (productId: string) => {
    items.value = items.value.filter(line => line.productId !== productId)
    persist()
  }

  const clear = () => {
    items.value = []
    persist()
  }

  return { items, count, addLine, setQuantity, removeLine, clear }
}
