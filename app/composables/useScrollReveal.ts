/**
 * The window scroll-direction rule shared by the mobile category dock and (pending
 * migration) `SearchDock`: pinned to the top the bar is always shown; below that,
 * scrolling down hides it and scrolling up brings it back.
 *
 * Exposes state only. What a consumer *does* with `visible` — a translate on the
 * mobile bottom bar, an opacity on the search launcher — stays in the component,
 * because the reactions differ. Nothing here knows about the DOM of any caller.
 */

/** Scroll offset below which the bar is unconditionally visible. */
export const SCROLL_REVEAL_AT = 60

/** Minimum per-frame delta (px) that counts as a deliberate direction change. */
export const SCROLL_DIRECTION_DELTA = 6

const readScrollY = () => window.scrollY || document.documentElement.scrollTop || 0

export const useScrollReveal = () => {
  const visible = ref(true)

  let lastScrollY = 0
  let ticking = false

  const handleScroll = () => {
    if (ticking) return
    ticking = true

    requestAnimationFrame(() => {
      const currentScrollY = readScrollY()

      if (currentScrollY < SCROLL_REVEAL_AT) {
        visible.value = true
      } else {
        const scrollDiff = currentScrollY - lastScrollY
        if (scrollDiff > SCROLL_DIRECTION_DELTA) visible.value = false
        else if (scrollDiff < -SCROLL_DIRECTION_DELTA) visible.value = true
      }

      lastScrollY = Math.max(0, currentScrollY)
      ticking = false
    })
  }

  onMounted(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
  })

  onUnmounted(() => {
    window.removeEventListener('scroll', handleScroll)
  })

  return { visible }
}
