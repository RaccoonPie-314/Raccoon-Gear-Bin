import { SCRAMBLE_STEP_MS, scrambleDuration, scrambleFrame, textClusters } from '~/utils/text-scramble'

/**
 * The page-wide locale decode: when the language changes, every text node whose words just changed
 * cycles through random glyphs and settles into the new string.
 *
 * Why a `MutationObserver` rather than an attribute on every translated string: the page's text
 * arrives by two different routes — `t()` messages and the catalog's own re-resolved translations —
 * and annotating both means one `v-scramble` per string, forever, in every file. A changed **text
 * node** is the single fact both routes produce, so watching that is what makes "all of it decodes"
 * true without a rule anyone has to remember, and it can't be forgotten on the next label added.
 *
 * What keeps it affordable and honest:
 *
 * - **Only during a window.** The observer is attached when the locale flips and detached 250ms after
 *   the last text change, so ordinary typing, filtering and re-renders are never animated. The
 *   harness locks that teardown (`an ordinary text change after the settle is not decoded`).
 * - **One write batch per frame, no reads.** Text is the one thing a per-frame write cannot put on the
 *   compositor — every swap invalidates style and layout for that box — so all of the page's nodes are
 *   written inside a single `requestAnimationFrame` callback and the browser coalesces them into one
 *   layout pass. Measured rather than assumed: see the numbers in ARCHITECTURE → Locale switch.
 * - **~25 Hz.** `SCRAMBLE_STEP_MS` gates the writes; 60 new glyphs a second is a flicker, not a cycle.
 * - **Never under `prefers-reduced-motion`.** A decode is a flicker by construction; the plain swap
 *   Vue already performed is the answer for that setting.
 * - **It always ends on the real word.** Each node's settled value is captured from the DOM at
 *   collection time and restored on the last frame *and* on any teardown, so an interrupted or
 *   abandoned decode can't leave noise on screen. The same capture is what lets frame zero be written
 *   immediately, so the translated word is never painted before its own decode starts.
 * - **Text nodes only, `document.body` only.** The head (title, meta) is not watched, and whitespace
 *   or single-cluster strings are skipped — there is nothing to cycle in `All`. Both ways a text node
 *   can change are watched (`characterData` *and* `childList`), because Vue replaces interpolated text
 *   rather than editing it — see the observer.
 *
 * It listens for `i18n:beforeLocaleSwitch` rather than watching `locale`, and that is a bug fix, not a
 * style: the module fires that hook *before* it applies the new locale (and before the re-render it
 * causes), so the observer is already attached when the text changes. A `watch(locale, …)` would race
 * the patch, and calling `useI18n()` from a plugin at all turned out to be fatal — it throws during
 * app initialisation (NUXT_E1005), which takes the whole client down with it.
 *
 * ponytail: the window is closed by quiet, not by a frame count, so a locale switch that lands during
 * a long network stall can push the deadline out by `WATCH_MS` per batch of text changes. Bounded by
 * the fact that a re-render is one microtask deep, not a stream — but if a decode ever looks like it
 * outstayed its welcome, cap the batches rather than the window.
 */
interface Decoding {
  node: Text | Element
  attr?: string
  parts: string[]
  final: string
  start: number
  last: number
}

/** The only attribute this animates: it is the one that is *read off the element by eye*. An
 * accessible name (`aria-label`, `title`) is deliberately left to swap instantly — flickering it
 * would make a screen reader announce noise as the label of a control. */
const DECODED_ATTRIBUTES = ['placeholder'] as const

const textsUnder = (el: Element): Text[] => {
  const out: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) out.push(walker.currentNode as Text)
  return out
}

const write = (entry: Decoding, value: string) => {
  if (entry.attr) (entry.node as Element).setAttribute(entry.attr, value)
  else (entry.node as Text).nodeValue = value
}

const WATCH_MS = 250
/**
 * The absolute deadline, and it is not optional. `WATCH_MS` is a *quiet* timeout, so any stream of
 * text changes keeps re-arming it — and a locale switch that remounts a page (the admin editors, whose
 * routes are not localized) feeds it a refetch, a re-render and then the next client navigation.
 * Without a hard stop the observer outlives the gesture and starts decoding unrelated content on
 * arrival: measured once, a product heading was still cycling minutes after the switch that armed it.
 * Anything that lands after the deadline simply swaps, which is what it did before this existed.
 */
const MAX_WINDOW_MS = 1200
/**
 * How far apart successive nodes start, and how many of them are in the wave before it wraps.
 *
 * Measured on a 4x-throttled phone at 390px, worst main-thread gap during the decode:
 * every node on the same frame → 84ms (16 layouts, 6.25ms each, ~100ms total); 6ms apart → 67ms;
 * 14ms apart → 50ms (44 layouts of 2.27ms, the same ~100ms total). The work does not shrink, it
 * spreads — which is the whole point: a 50ms slice lands inside a frame budget the eye is already
 * forgiving, and the visible result is the page resolving top-to-bottom rather than flinging every
 * word at once. The baseline with no decode at all is a 34ms gap, so ~16ms is the price of the
 * gesture. Raise `STAGGER_MS` if a real device ever shows it; the ceiling is that the wave has to
 * finish inside the ~300ms the whole decode takes, or the tail starts looking like a queue.
 */
const STAGGER_MS = 14
const STAGGER_WRAP = 24
/**
 * What the stagger is now allowed to do: order when each node's clusters start settling, nothing more.
 * It used to also defer each node's first write, and that is what made the page snap to a wall of
 * gibberish and then wait — every node sat frozen on frame zero until its turn came round, up to
 * `STAGGER_MS * STAGGER_WRAP` = 336ms of stillness on the tail of the wave. Every node now changes
 * glyph from the first step, so the wave is a resolve order rather than a start line, and the
 * layout-pass spreading it was bought for is reduced accordingly.
 */

export default defineNuxtPlugin((nuxtApp) => {
  let entries: Decoding[] = []
  let raf = 0
  let observer: MutationObserver | null = null
  let quiet: ReturnType<typeof setTimeout> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    observer?.disconnect()
    observer = null
    if (quiet) clearTimeout(quiet)
    quiet = null
    if (deadline) clearTimeout(deadline)
    deadline = null
    for (const entry of entries) write(entry, entry.final)
    entries = []
  }

  const frame = (now: number) => {
    let running = false
    for (const entry of entries) {
      const elapsed = now - entry.start
      // A node ahead of its turn still cycles. Held at frame zero it would sit on one frozen string of
      // gibberish for up to `STAGGER_MS * index` before anything moved, which reads as "snap to noise,
      // then start" — two events where the gesture is one. `progress` 0 simply means nothing has settled
      // yet; the noise underneath keeps changing at the same rate every other node is running at.
      const progress = elapsed > 0 ? elapsed / scrambleDuration(entry.parts) : 0
      if (progress >= 1) {
        write(entry, entry.final)
        continue
      }
      if (now - entry.last >= SCRAMBLE_STEP_MS) {
        entry.last = now
        write(entry, scrambleFrame(entry.parts, progress))
      }
      running = true
    }
    raf = running ? requestAnimationFrame(frame) : 0
    if (!running) {
      entries = []
      observer?.disconnect()
      observer = null
    }
  }

  // Frame zero, written in the microtask Vue's own patch ran — so before the browser's next paint. A
  // node collected without it holds the word the switch just resolved to until the first frame above
  // fires, which is the flash of translated text this exists to prevent. The stagger that follows is
  // now only about when a node *settles*, never about when it stops being the real word.
  const startEntry = (entry: Decoding) => {
    entries.push(entry)
    write(entry, scrambleFrame(entry.parts, 0))
  }

  const collect = (node: Text) => {
    const value = node.nodeValue ?? ''
    if (!value.trim()) return
    const parts = textClusters(value)
    if (parts.length < 2) return
    startEntry({
      node,
      parts,
      final: value,
      start: performance.now() + STAGGER_MS * (entries.length % STAGGER_WRAP),
      last: 0,
    })
  }

  const collectAttr = (el: Element, attr: string) => {
    const value = el.getAttribute(attr) ?? ''
    if (!value.trim()) return
    const parts = textClusters(value)
    if (parts.length < 2) return
    startEntry({ node: el, attr, parts, final: value, start: performance.now() + STAGGER_MS * (entries.length % STAGGER_WRAP), last: 0 })
  }

  nuxtApp.hook('i18n:beforeLocaleSwitch', ({ initialSetup, newLocale, oldLocale }) => {
    // Hand every node its word back first: the observer created below must not see those writes, and a
    // second switch mid-cycle has to retarget rather than stack two decodes on one node.
    stop()
    if (initialSetup || newLocale === oldLocale) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    observer = new MutationObserver((records) => {
      let found = false
      const seenNodes = new Set<Node>()
      for (const record of records) {
        // Three shapes a "changed string" arrives in, and the middle one was the bug. Vue writes
        // interpolated text with `el.textContent = value`, so the record is `childList` (an added text
        // node) rather than `characterData`; and a component that re-renders a subtree — Reka's select
        // trigger, for instance — hands over a new ELEMENT whose text sits one level down. Collecting
        // only `nodeType === 3` from `addedNodes` skipped the sort control while the labels beside it
        // decoded, which is exactly what "the sort filter is still static" described.
        const nodes: Text[] = []
        if (record.type === 'characterData') {
          nodes.push(record.target as Text)
        } else if (record.type === 'childList') {
          for (const added of record.addedNodes) {
            if (added.nodeType === 3) nodes.push(added as Text)
            else if (added.nodeType === 1) nodes.push(...textsUnder(added as Element))
          }
        }
        for (const node of nodes) {
          if (seenNodes.has(node) || entries.some(entry => entry.node === node && !entry.attr)) continue
          seenNodes.add(node)
          collect(node)
          found = true
        }
        // An attribute is its own record type, and `placeholder` is the one visible string on the page
        // that is not a node at all: the search field's own text never changes, so it never decoded.
        if (record.type === 'attributes') {
          const el = record.target as Element
          const attr = record.attributeName ?? ''
          if (el.nodeType === 1 && (DECODED_ATTRIBUTES as readonly string[]).includes(attr)
            && !entries.some(entry => entry.node === el && entry.attr === attr)) {
            collectAttr(el, attr)
            found = true
          }
        }
      }
      if (!found) return
      // Vue patches the DOM in a microtask after the locale is applied, which is why the work starts
      // here and not above. Every batch restarts the quiet countdown, so a slow re-render (the
      // catalog's computed resolving after the chrome) is still caught.
      if (!raf) raf = requestAnimationFrame(frame)
      if (quiet) clearTimeout(quiet)
      quiet = setTimeout(() => {
        observer?.disconnect()
        observer = null
      }, WATCH_MS)
    })
    deadline = setTimeout(stop, MAX_WINDOW_MS)
    observer.observe(document.body, {
      subtree: true,
      characterData: true,
      childList: true,
      attributes: true,
      attributeFilter: [...DECODED_ATTRIBUTES],
    })
  })
})
