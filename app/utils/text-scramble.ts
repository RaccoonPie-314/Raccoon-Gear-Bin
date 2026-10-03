import { hasKhmerText } from './locale-script'

/**
 * The decode ("scramble") text morph: random glyphs cycle in place and settle left-to-right into the
 * target string. Pure functions, no DOM and no clock — the caller owns `requestAnimationFrame`,
 * because only it knows which node is being painted (today that is `app/plugins/locale-decode.client.ts`).
 *
 * It runs on **grapheme clusters**, never codepoints, and that is the whole reason this file exists.
 * `ខ្មែរ` is five codepoints in two clusters; a coeng (្) is a *joining* mark, so cutting the string
 * apart at codepoint width can leave a mark with nothing to attach to, which renders as a broken
 * dotted box, and can strand a vowel sign on a consonant it was never meant for. `Intl.Segmenter`
 * answers with real clusters, so every glyph this file emits is a standalone syllable.
 *
 * The pools are wider than the target's own alphabet on purpose: Greek, Cyrillic, Devanagari, CJK,
 * kana and Hangul noise is what makes the cycle read as "decoding" rather than as "a different word in
 * the same language". Three rules bound the choice, and all of them are load-bearing, not taste:
 *
 * 1. **Every entry is one whole cluster.** A combining mark on its own would paint exactly the broken
 *    box the segmenter exists to prevent, so every set is made of standalone characters.
 * 2. **A script joins the pool only on a machine that can draw it.** The theme bundles Noto Sans Khmer
 *    and answers Latin with the *system* UI font, so Latin, Greek, Cyrillic and the typographic marks
 *    are safe everywhere this site runs; Hanzi, kana, Hangul and Devanagari depend on what the device
 *    ships, and on a bare Linux runner they are tofu. `probeNoise()` measures that once instead of
 *    guessing. It is also why no scramble library is installed: none of them can make a glyph exist on
 *    a machine that has no face for it, and none of them segment Khmer.
 * 3. **No positional scripts.** Arabic and its neighbours change shape by context, so a random one is
 *    a fragment rather than a letter. Devanagari and Khmer are the other joining scripts here, and
 *    wide Latin letter-spacing pulls their marks apart — which is the defect `hasKhmerText` exists to
 *    catch — so they are offered only when the target is itself Khmer, the one case this storefront
 *    guarantees is untracked.
 */

/** Base consonants and numerals only — each one is a complete cluster with no joining requirement. */
const KHMER_GLYPHS = 'កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសអហឡ០១៣៤៥៧៨៩'
const DEVANAGARI_GLYPHS = 'अआइईउऊकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह०१३४५७८९'

/** Everything that survives tracking: no marks above or below, no contextual forms, no joining. */
const SPACING_SAFE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&@*+=/<>'
  + '[]{}?!~^_§¤¶¬†‡•◊∆«»'
  + 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω'
  + 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯабвгдежзийклмнопрстуфхцчшщэюя'

/** Optional scripts, each probed as a unit: usable only when the device can draw all of its samples. */
const OPTIONAL_SCRIPTS = [
  'अआइईकखगघचछजझ',
  '中文漢字字',
  'カタカナガポヰヱ',
  '한글가나다라마',
]

const NOT_CHARACTER = '\uFFFF'
/** The stack the page itself paints with, at the size its smallest label uses. */
const PROBE_FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
let probed: string | null = null

/**
 * Which optional scripts this browser can actually draw. `measureText` answers it rather than a UA
 * sniff: a codepoint with no face in the stack renders as the font's .notdef box, so a candidate is
 * usable when its advance differs from a guaranteed noncharacter's. Ten samples per script and every
 * one has to differ, because a real glyph can coincidentally be exactly box-width.
 */
function probeNoise (): string {
  if (probed === null) {
    let joined = SPACING_SAFE_GLYPHS
    const ctx = typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = PROBE_FONT
      const box = ctx.measureText(NOT_CHARACTER).width
      for (const script of OPTIONAL_SCRIPTS) {
        if ([...script].every(ch => Math.abs(ctx.measureText(ch).width - box) > 0.01)) joined += script
      }
    }
    // Server-side or a context that refuses to measure: the always-safe sets only, never a guess.
    probed = joined
  }
  return probed
}

const poolFor = (target: string): string => {
  const noise = probeNoise()
  return hasKhmerText(target) ? KHMER_GLYPHS + DEVANAGARI_GLYPHS + noise : noise
}

/**
 * The clock, owned here so no caller invents a second one. One full cycle for the first cluster plus
 * one step per cluster after, so a two-letter label and a four-cluster heading feel like the same
 * gesture rather than the longer one dragging: 220ms for two clusters, 300ms for four. A page-wide
 * decode runs every one of those cycles *concurrently*, which is what keeps the ceiling under the
 * sub-300ms UI budget rather than summing dozens of them.
 */
export const SCRAMBLE_STEP_MS = 40
const SCRAMBLE_FIRST_MS = 180

export function scrambleDuration(parts: string[]): number {
  return SCRAMBLE_FIRST_MS + SCRAMBLE_STEP_MS * Math.max(parts.length - 1, 0)
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('km', { granularity: 'grapheme' })
  : null

export function textClusters(value: string): string[] {
  // No Segmenter (an old engine, or a non-browser host): codepoints are the best available answer, and
  // a Latin label is identical either way. Only a Khmer run would be wrong, and the pool above only
  // offers Khmer glyphs to a target that already contains them.
  if (!segmenter) return [...value]
  const out: string[] = []
  for (const part of segmenter.segment(value)) out.push(part.segment)
  return out
}

/**
 * The frame at `progress` (0 → 1): clusters below the reveal line are final, the rest are random.
 * `progress >= 1` returns the target itself, so a caller that overshoots still ends on the real word —
 * and a caller that never reaches 1 leaves noise on screen, which is why the decode always writes the
 * settled value last.
 */
export function scrambleFrame(parts: string[], progress: number): string {
  const target = parts.join('')
  if (!(progress < 1)) return target
  const pool = poolFor(target)
  const settled = Math.floor(progress * parts.length)
  return parts.map((part, index) => {
    // Spaces (and anything already settled) are never replaced: swapping one for a glyph changes the
    // width of the word and re-lays out whatever sits beside it.
    if (index < settled || !/\S/.test(part)) return part
    return pool[Math.floor(Math.random() * pool.length)] ?? part
  }).join('')
}
