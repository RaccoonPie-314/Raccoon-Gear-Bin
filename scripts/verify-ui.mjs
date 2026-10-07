#!/usr/bin/env node
/**
 * scripts/verify-ui.mjs — the repository's UI regression harness.
 *
 * WHY THIS EXISTS
 * `bun run build` compiles but never starts the app (CI has run this harness alongside it since 2026-09-28), so every tuned
 * interaction (category drag, indicator snap, magnification, scroll reveal, the scroll-collapse
 * launcher flight, spotlight morph) and the whole admin write path is otherwise unprotected.
 * Refactors Phases 1-5 were each verified by rebuilding the pre-change tag in a worktree and
 * diffing the measurements; that harness is now committed so the next phase runs one command
 * instead of re-deriving it.
 *
 * WHAT IT DOES
 *   bun run build && bun run verify
 * It serves the existing `.output`, launches headless Chrome over raw CDP, and asserts geometry,
 * animation state and the exact (method, path, query, body) tuple of every Supabase call.
 *
 * SAFETY: it never touches a real project. A browser-level `fetch` stub answers every browser
 * call the app makes — the port-era /api/** routes (catalog, site-info, orders, admin, profile,
 * admin-check) and the legacy storage upload — from scripts/fixtures.json, and a scripted
 * clerk-js (served through CDP Fetch, beside the product photos) makes signed-in state
 * deterministic with no network: the fake keeps its session in one same-origin cookie. No read is
 * needed, no login is real, and no write can reach the database. Server-side (SSR) requests are
 * NOT stubbed — which is why signed-in sections stay inside the SPA, and why a signed-out hard
 * load is expected to bounce on the server guard's own 302.
 *
 * USAGE
 *   bun run verify                 # build first, then all checks
 *   node scripts/verify-ui.mjs     # same, on Node 24 (global WebSocket; no dependencies)
 *   ... --only=guest | --only=admin
 *   ... --only=guest &  ... --only=admin & wait   # the two slices are independent; run them at once
 *   ... --build                    # run `bun run build` first
 *   ... --keep                     # leave Chrome + profile running for debugging
 *   CHROME_PATH=/path/to/chrome    # override the browser binary
 *
 * Exit code is non-zero if any check fails. Run it against two builds to prove a refactor was
 * behaviour-preserving:
 *   git worktree add .verify-base <tag> && (cd .verify-base && bun install && bun run build)
 *   node scripts/verify-ui.mjs --url http://127.0.0.1:PORT/ > before.txt
 *   node scripts/verify-ui.mjs > after.txt    # then diff the PASS/FAIL lines
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_PATH = join(ROOT, 'scripts', 'fixtures.json')
const FIXTURES = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const argv = process.argv.slice(2)
const flag = name => argv.find(a => a.startsWith(`--${name}`))
const ONLY = flag('only=')?.split('=')[1] || 'all'
const URL_OVERRIDE = flag('url=')?.split('=')[1] || null
// One work dir per `--only` slice. The Chrome profile, `chrome.log` and the upload probe all live
// under WORK, and `shutdown` rmSyncs the whole tree — so with a shared dir, whichever slice exits
// first deletes the profile the other is still running on, which surfaces as Chrome refusing to
// start rather than as "you ran two verifies over one scratch dir". Per-slice is also what makes
// running guest and admin concurrently safe, which is the only way to get the wall clock down:
// the run spends it waiting on CDP round-trips, not computing.
const WORK = join(ROOT, '.nuxt', 'verify', ONLY)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ::  ' + JSON.stringify(detail) : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- static: a foreign script pasted into the Khmer block is invisible to every browser check ---
// Thai consonants sat inside `contactAskLowStock` for a long time and rendered as Khmer-shaped
// noise: `/[\u1780-\u17FF]/` still matched the string, the page still looked Khmer, and no computed
// style changed. Only a source scan can catch that class, so it runs here instead of in a review.
const KM_BLOCK = /km: \{([\s\S]*?)\n\s*\}/.exec(readFileSync(join(ROOT, 'i18n.config.ts'), 'utf8'))?.[1] || ''
const KM_VALUES = [...KM_BLOCK.matchAll(/([A-Za-z]+): ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)]
// Khmer script and its own digits, plus the ASCII, Latin terms and typographic marks this file uses
// on purpose (`SKU`, `slug`, `{count}`, `—`, `→`). Anything else is a paste from another script.
const KM_ALLOWED = /[\u1780-\u17FF\u17D0\u17D1\u17D2-\u17E9a-zA-Z0-9{}@.,:;!?()'\-–—…→·= ]/u
const KM_FOREIGN = KM_VALUES.map(([, key, quoted]) => {
  const off = [...quoted.slice(1, -1)].filter(c => !KM_ALLOWED.test(c))
  return off.length ? { key, chars: off.map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ') } : null
}).filter(Boolean)
check('the Khmer block holds Khmer (and its deliberate Latin) only', KM_VALUES.length > 100 && KM_FOREIGN.length === 0, { kmValues: KM_VALUES.length, KM_FOREIGN })

// ---------------------------------------------------------------- utilities
const freePort = () => new Promise((resolve, reject) => {
  const srv = createServer()
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
})

const waitForHttp = async (url, ms = 30000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const res = await fetch(url); if (res.status < 500) return true } catch {}
    await sleep(200)
  }
  return false
}

const chromePath = () => process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(p => existsSync(p))

/** 1x1 transparent PNG, written to disk so the file-upload path is exercised for real. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

// ---------------------------------------------------------------- stub script
// Built as plain lines: no template-literal escaping traps, and every regex is constructed via
// new RegExp with [.] instead of \. so the source stays backslash-free.
const stubSource = [
  '(function () {',
  `  var PRODUCTS = ${JSON.stringify(FIXTURES.products)};`,
  `  var CATEGORIES = ${JSON.stringify(FIXTURES.categories)};`,
  `  var SITE = ${JSON.stringify(FIXTURES.siteSettings)};`,
  '  var FIXED_USER = "00000000-0000-4000-8000-0000000000ad";',
  '  var NEW_ROW_ID = "11111111-2222-4333-8444-555555555555";',
  '  var PROFILE = { id: FIXED_USER, display_name: "Verify User", phone: "+855 12 345 678" };',
  // The order rows the reads answer from. Deliberately newest-first (as the list query would return
  // them): the cancelled row is newer than the pending one, so the admin desk cannot pass the row
  // order check by echoing the server. `__ORDERS_FAIL` is the harness's one-shot switch for the
  // refusal arm — it makes `create_order` answer the RPC's documented machine code shape.
  `  var ORDERS = ${JSON.stringify(FIXTURES.orders)};`,
  '  var ORDER_ID = (ORDERS.filter(function (o) { return o.status === "pending" })[0] || ORDERS[0]).id;',
  '  window.__W = [];',
  // Aliases for the two fixture collections the stub answers from. They are handed out on purpose:
  // a test that needs a *different* shop configuration — no contact channels at all, a product with
  // no photos, a name full of punctuation — mutates these from a document script registered before
  // the app runs, then removes it again. That keeps those cases honest (the app reads them through
  // the same REST stub as everything else) without adding a seventh product row that every card and
  // price count in this file would then have to chase.
  '  window.__PRODUCTS = PRODUCTS;',
  '  window.__CATEGORIES = CATEGORIES;',
  '  window.__SITE = SITE;',
  '  function json(body, status) { return new Response(body === null ? null : JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } }) }',
  '  var orig = window.fetch.bind(window);',
  '  window.fetch = function (input, init) {',
  '    var url = (typeof input === "string") ? input : ((input && input.url) || "");',
  '    var method = String((init && init.method) || ((typeof input === "object") && input.method) || "GET").toUpperCase();',
  // Every port-era route is stubbed: the storefront's /api reads and writes, the desk's /api/admin
  // set, the account's /api/profile and the guard's /api/admin-check all answer from the fixtures,
  // and the legacy storage upload keeps its fake so the editor write flow stays exercisable.
  '    if (!new RegExp("/storage/|/api/(catalog|site-info|orders|admin|profile)").test(url)) return orig(input, init);',
  '    var path = url.replace(new RegExp("^https?://[^/]+"), "");',
  '    var cut = path.indexOf("?");',
  '    var p = cut >= 0 ? path.slice(0, cut) : path;',
  '    var q = cut >= 0 ? path.slice(cut + 1).replace(new RegExp("&?apikey=[^&]*", "g"), "").replace(new RegExp("&?[a-z-]+=\\\\d{10,13}", "g"), "") : "";',
  '    var raw = init && init.body;',
  '    window.__W.push({ method: method, p: p, q: q, body: (typeof raw === "string") ? raw : (raw ? "<bytes>" : null) });',
  // The identity read every auth-aware surface asks (P6/P7). Admin-ness is per browser session,
  // seeded by the admin section itself: the guest walk's shopper must resolve non-admin (the
  // masthead Orders pill switches targets on it, and so does the buyer badge branch), while
  // sessionStorage carries the admin answer across the section's documents — and it only counts
  // while the scripted session is signed in, exactly like the real route's 401 (a stale "admin"
  // branch would re-light admin mode after a sign-out). The fake session itself lives in the
  // scripted clerk-js below, not in this stub.
  '    if (p === "/api/admin-check" && method === "GET") return json({ admin: sessionStorage.getItem("__admin_session") === "1" && document.cookie.indexOf("__harness_clerk") !== -1 }, 200);',
  '    if (new RegExp("^/storage/v1/object").test(p) && method !== "GET") return json({ Key: "ok", Id: NEW_ROW_ID }, 200);',
  // The public reads moved to /api routes in the Neon port (P4): same fixtures, same row shapes,
  // with one object (not an array) for a single-row answer. The write paths below stay PostgREST
  // until their phases land.
  '    if (p === "/api/catalog/products" && method === "GET") { var pid = new RegExp("(?:^|&)id=([0-9a-f-]+)").exec(q); return json(pid ? (PRODUCTS.filter(function (x) { return x.id === pid[1] })[0] || null) : PRODUCTS, 200) }',
  '    if (p === "/api/catalog/categories" && method === "GET") return json(CATEGORIES, 200);',
  '    if (p === "/api/catalog/category-drafts" && method === "GET") return json(CATEGORIES, 200);',
  '    if (p === "/api/site-info" && method === "GET") return json(SITE, 200);',
  // The desk's writes (P7) are one transactional route each: the stub answers success and the
  // checks assert the request payload — the fixtures stay the read truth (only `site_settings` is
  // mutable in-stub so the "public reflects the save" check can read back what the editor wrote).
  '    if (p === "/api/admin/site-info" && method === "POST") { try { Object.assign(SITE, JSON.parse(raw || "{}")); } catch (e) {} return json(null, 204); }',
  '    if (p === "/api/admin/categories" && method === "POST") return json(null, 204);',
  '    if (new RegExp("^/api/admin/categories/[0-9a-f-]+$").test(p) && method === "DELETE") return json(null, 204);',
  '    if (p === "/api/admin/products" && method === "POST") { var pid = ""; try { pid = JSON.parse(raw || "{}").id || "" } catch (e) {} return json({ id: pid || NEW_ROW_ID }, 200); }',
  '    if (new RegExp("^/api/admin/products/[0-9a-f-]+$").test(p) && method === "DELETE") return json(null, 204);',
  // The account's profile row (P6): readable and writable in-stub, mirroring the site-settings
  // pattern, so the account save can read back what it wrote.
  '    if (p === "/api/profile" && method === "GET") { var prof = PROFILE; if (window.__PROFILE_EMPTY) { window.__PROFILE_EMPTY = false; prof = Object.assign({}, PROFILE, { display_name: null }) } return json(prof, 200); }',
  '    if (p === "/api/profile" && method === "PATCH") { try { var patch = JSON.parse(raw || "{}"); if ("displayName" in patch) PROFILE.display_name = patch.displayName; if ("phone" in patch) PROFILE.phone = patch.phone } catch (e) {} return json(PROFILE, 200); }',
  // Orders, port-era (P5): reads run on /api/orders* — the buyer's self-scoped trio
  // (mine/stamps/:id) and the desk's bare list; the two RPCs are the only writes, now
  // POST /api/orders and POST /api/orders/:id/status. `create_order` returns the pending fixture's
  // id unless the one-shot refusal flag is set, when it answers the route's 400 body (the machine
  // code in `message`). `__ORDER_TOUCH` is the buyer-notice one-shot: the next self-scoped read
  // answers with the pending row's `confirmed_at` set — exactly what confirming it does — so the
  // unseen count has one update to report.
  '    var touchOrders = function () { if (window.__ORDER_TOUCH) { window.__ORDER_TOUCH = false; var t = ORDERS.filter(function (x) { return x.id === ORDER_ID })[0]; if (t) t.confirmed_at = "2026-10-04T04:00:00.000Z" } };',
  '    if (p === "/api/orders" && method === "GET") return json(ORDERS, 200);',
  '    if (p === "/api/orders/mine" && method === "GET") { touchOrders(); return json(ORDERS, 200) }',
  '    if (p === "/api/orders/stamps" && method === "GET") { touchOrders(); return json(ORDERS, 200) }',
  '    if (p === "/api/orders/pending" && method === "GET") return json(ORDERS.filter(function (x) { return x.status === "pending" }).length, 200);',
  '    if (new RegExp("^/api/orders/[0-9a-f-]+$").test(p) && method === "GET") { var oid = p.split("/").pop(); return json(ORDERS.filter(function (x) { return x.id === oid })[0] || null, 200) }',
  '    if (p === "/api/orders" && method === "POST") { if (window.__ORDERS_FAIL) { var fail = window.__ORDERS_FAIL; window.__ORDERS_FAIL = null; return json({ statusCode: 400, statusMessage: fail, message: fail }, 400) } return json(ORDER_ID, 200) }',
  '    if (new RegExp("^/api/orders/[0-9a-f-]+/status$").test(p) && method === "POST") return json(null, 204);',
  // The refund marker, and the one order mutation this stub makes: the marker flips the fixture row
  // so the desk's reload can be read back (the same reason `site_settings` above is mutable in-stub).
  // Without it a check could only assert the request, never that the desk re-reads the new state.
  '    if (new RegExp("^/api/orders/[0-9a-f-]+/refund$").test(p) && method === "POST") { var rid = p.split("/")[3]; var ro = ORDERS.filter(function (x) { return x.id === rid })[0]; if (ro) ro.payment_status = "refunded"; return json(null, 200) }',
  '    if (method === "PATCH" || method === "DELETE") return json(null, 204);',
  '    if (method === "POST") return json([], 201);',
  '    return json([], 200);',
  '  };',
  '})()'
].join('\n')

// ---------------------------------------------------------------- scripted clerk-js
// `@clerk/vue` loads clerk-js as a <script> (and the UI bundle beside it) and then builds its
// whole reactive world from three things: the globals the scripts leave behind, one `load()`
// promise, and the payload of `addListener`. So the rig answers every request to the fake
// frontend-API host from CDP Fetch — the same domain the product photos use — with a minimal
// stand-in implementing exactly that surface, the sign-in/sign-up resources the forms call, and
// `setActive`/`signOut` moving one same-origin cookie. The cookie is the session: a fresh document
// (any `nav()` while signed in) re-runs the script and agrees a session exists — the same trick the
// old Supabase stub's auth cookie pulled. Plain lines and no regexes, same as the fetch stub: this
// file keeps its backslash-free discipline.
const FAKE_CLERK = [
  '(function () {',
  '  var COOKIE = "__harness_clerk";',
  '  function signedIn() { return document.cookie.indexOf(COOKIE + "=1") !== -1 }',
  '  function makeUser() { return { id: "00000000-0000-4000-8000-0000000000ad", username: "verify-user", firstName: "Verify", primaryEmailAddress: { emailAddress: "verify@example.test" } } }',
  '  function makeSession() { return { id: "sess_harness", status: "active" } }',
  '  var listeners = [];',
  '  function emit() {',
  '    window.__HARNESS_CLERK = { signedIn: signedIn() };',
  '    var resources = { client: client, session: signedIn() ? makeSession() : null, user: signedIn() ? makeUser() : null, organization: null };',
  '    for (var i = 0; i < listeners.length; i++) listeners[i](resources);',
  '  }',
  '  function setCookie(value) { document.cookie = COOKIE + "=" + value + "; path=/; max-age=" + (value ? 86400 : 0) }',
  '  function refuse(message) { return Promise.reject({ errors: [{ message: message }] }) }',
  '  var client = {',
  '    signIn: { create: function (params) { return String((params || {}).password) === "wrong-password" ? refuse("Password is incorrect.") : Promise.resolve({ status: "complete", createdSessionId: "sess_harness" }) } },',
  '    signUp: { create: function (params) { return String((params || {}).emailAddress || "").indexOf("taken") === 0 ? refuse("That email address is taken.") : Promise.resolve({ status: "complete", createdSessionId: "sess_harness" }) } }',
  '  };',
  '  var clerk = {',
  '    load: function () { return Promise.resolve() },',
  '    addListener: function (cb) { listeners.push(cb); emit(); return function () { var i = listeners.indexOf(cb); if (i !== -1) listeners.splice(i, 1) } },',
  '    setActive: function () { setCookie("1"); emit(); return Promise.resolve() },',
  '    signOut: function () { setCookie(""); emit(); return Promise.resolve() },',
  '    client: client',
  '  };',
  // The UI bundle's own request lands on the same host and must leave this behind, or the loader
  // rejects and the plugin logs a fetch failure before ever reaching `load()`.
  '  window.__internal_ClerkUICtor = window.__internal_ClerkUICtor || function () {};',
  '  window.Clerk = clerk;',
  '})()'
].join('\n')

// ---------------------------------------------------------------- CDP client
// Every CDP response wraps its payload in `result`; forgetting that level is the single easiest
// way to "discover" a missing element that is really a parsing mistake.
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.events = []; this.onEvent = null }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)
      this.ws.onopen = resolve
      this.ws.onerror = e => reject(new Error('websocket failed: ' + (e?.message || e)))
      this.ws.onmessage = ev => {
        const m = JSON.parse(ev.data)
        if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id) }
        if (m.method) { this.events.push(m); this.onEvent?.(m) }
      }
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const i = ++this.id
      this.pending.set(i, msg => (msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result)))
      this.ws.send(JSON.stringify({ id: i, method, params }))
      setTimeout(() => { if (this.pending.has(i)) { this.pending.delete(i); reject(new Error(method + ' timed out')) } }, 25000)
    })
  }

  // One-shot wait for a CDP event. Arm it *before* the action that causes it:
  // `Page.navigate` answers while the previous document is still current, so a
  // readiness poll written after the await can read the old page as loaded. The
  // listener chains to whatever `onEvent` already held (the Fetch photo handler)
  // and restores it when the event lands or the bound expires.
  once(method, ms = 20000) {
    return new Promise((resolve, reject) => {
      const prev = this.onEvent
      const timer = setTimeout(() => { this.onEvent = prev; reject(new Error(method + ' never fired within ' + ms + 'ms')) }, ms)
      this.onEvent = m => {
        if (m.method === method) { clearTimeout(timer); this.onEvent = prev; resolve(m.params); return }
        prev?.(m)
      }
    })
  }

  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }

  async objectId(expression) {
    const r = await this.send('Runtime.evaluate', { expression })
    return r.result?.objectId
  }
}

const boxesExpr = sel => '[...document.querySelectorAll(' + JSON.stringify(sel) + ')].map(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, t: (el.textContent || "").trim() } })'

// ------------------------------------------------------- generated product photos
// The fixture rows point at `product-images` storage paths, and this rig contacts no project, so
// without help every `<img>` on the detail page is a broken image: it still *lays out*, but it has no
// intrinsic size. That is fine for a thumbnail grid and fatal for the lightbox zoom, whose whole job
// is to work out where an `object-contain` picture sits inside its frame. So the rig answers those
// requests itself, cycling three aspect ratios through a photo set — landscape, portrait, square —
// which are precisely the three cases the focal-point maths has to get right.
const PHOTO_SIZES = [[1600, 900], [900, 1600], [1200, 1200]]
// The size a given storage path was served at, from the same trailing number `photoFor` reads, so a
// check can compare the ratio the app derived against the ratio the file declares.
const sizeOfPhoto = path => {
  const name = String(path).split('/').pop()
  const n = Number((/(?:^|-)(\d+)\.\w+$/.exec(name) || [, '0'])[1])
  return PHOTO_SIZES[n % PHOTO_SIZES.length]
}
const photoFor = url => {
  const name = decodeURIComponent(url.split('?')[0].split('/').pop() || '')
  const n = Number((/(?:^|-)(\d+)\.\w+$/.exec(name) || [, '0'])[1])
  const [w, h] = PHOTO_SIZES[n % PHOTO_SIZES.length]
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>`
    + `<rect width='${w}' height='${h}' fill='#e4e4e7'/>`
    + `<rect x='${w * 0.06}' y='${h * 0.06}' width='${w * 0.88}' height='${h * 0.88}' fill='none' stroke='#18181b' stroke-width='${Math.round(Math.min(w, h) / 60)}'/>`
    + `<text x='50%' y='52%' text-anchor='middle' font-family='sans-serif' font-size='${Math.round(Math.min(w, h) / 6)}' fill='#18181b'>${w}x${h}</text></svg>`
}

// ---------------------------------------------------------------- main
mkdirSync(WORK, { recursive: true })
const PNG_PATH = join(WORK, 'upload-probe.png')
writeFileSync(PNG_PATH, PNG)

if (argv.includes('--build')) {
  console.log('building…')
  const status = await new Promise(res => { spawn('bun', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' }).on('exit', code => res(code)) })
  if (status !== 0) { console.error('build failed'); process.exit(2) }
}

if (!URL_OVERRIDE && !existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
  console.error('No .output found. Run `bun run build` first (or pass --build).')
  process.exit(2)
}

const chrome = chromePath()
if (!chrome) { console.error('No Chrome binary found. Set CHROME_PATH.'); process.exit(2) }

let server, browser, cdp, appUrl, chromeOut, cleanupDone = false
const shutdown = async code => {
  if (cleanupDone) return
  cleanupDone = true
  browser?.kill(); server?.kill()
  try { chromeOut?.close() } catch {}
  await sleep(400)
  try { cdp?.ws?.close() } catch {}
  if (!flag('keep')) { try { rmSync(WORK, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }) } catch (e) { console.log('(could not clean ' + WORK + ': ' + e.code + ')') } }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))

const run = async () => {
  // 1. serve the built app (unless pointed at an existing deployment)
  if (URL_OVERRIDE) {
    appUrl = URL_OVERRIDE.endsWith('/') ? URL_OVERRIDE : URL_OVERRIDE + '/'
  } else {
    const port = await freePort()
    appUrl = `http://127.0.0.1:${port}/`
    console.log(`serving .output on ${appUrl}`)
    // The built server reads process env only (nuxt loads `.env` in dev alone), and the Clerk
    // middleware refuses to start without a key pair — so the harness supplies its own keys:
    // syntactically valid PRODUCTION-form pair, which keeps the middleware local and signed-out.
    // Dev-form keys would 307 every document navigation into Clerk's dev-browser handshake — a
    // real network round trip to a real instance, exactly what this rig must not need. The app's
    // own runtime values (DATABASE_URL above all) ride in from `.env` when it exists.
    const dotenv = existsSync(join(ROOT, '.env'))
      ? Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
          .filter(l => /^[A-Z]/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
      : {}
    server = spawn(process.execPath, [join(ROOT, '.output', 'server', 'index.mjs')], {
      cwd: ROOT, env: {
        ...dotenv,
        ...process.env,
        NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.example.invalid$').toString('base64'),
        NUXT_CLERK_SECRET_KEY: 'sk_live_' + Buffer.from('fake-secret$').toString('base64'),
        PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production'
      }, stdio: 'ignore'
    })
    if (!await waitForHttp(appUrl)) throw new Error('preview server never answered on ' + appUrl)
    // Prove the artifact is whole before aiming 300 checks at it. A `.output` written by two builds (or
    // read while one is still running) serves a shell whose entry chunk is no longer on disk: the browser
    // then gets a 500 for `/_nuxt/<hash>.js`, Nuxt paints its error page, and every data-dependent check
    // fails on an empty page while the first `boxesExpr(...)[0]` throws a bare TypeError. That reads like
    // a hundred app regressions and is one missing file, so name it here, once, with the fix.
    const shell = await (await fetch(appUrl)).text()
    const entry = /#entry":"(\/_nuxt\/[^"]+\.js)/.exec(shell)?.[1]
    if (!entry) throw new Error(`The page served at ${appUrl} carries no #entry import — it is not the app. Run \`bun run build\` and let it finish.`)
    const asset = await fetch(new URL(entry, appUrl))
    // Status alone is blind here: an unmatched path answers 200 with the SPA shell, so a missing chunk
    // looks healthy. The content type is the thing that actually distinguishes "the entry" from "a page".
    const type = asset.headers.get('content-type') || ''
    if (!asset.ok || !/javascript|ecmascript/i.test(type)) {
      throw new Error(`.output is torn: the page asks for ${entry} and it answers ${asset.status} ${type || '(no content-type)'}. Re-run \`bun run build\` with no other build or deploy writing to .output, then verify again.`)
    }
  }

  // 2. launch headless Chrome with a private profile on a debug port.
  // A unique profile per run: a previous aborted run can leave a SingletonLock behind, and
  // sharing one then looks exactly like "Chrome refused to start".
  const debugPort = await freePort()
  const profile = join(WORK, `chrome-${debugPort}`)
  mkdirSync(profile, { recursive: true })
  const chromeLog = join(WORK, 'chrome.log')
  chromeOut = createWriteStream(chromeLog)
  browser = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--disable-dev-shm-usage', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  browser.stdout.pipe(chromeOut)
  browser.stderr.pipe(chromeOut)
  if (!await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 20000)) {
    const tail = readFileSync(chromeLog, 'utf8').split('\n').slice(-6).join(' | ')
    const sandboxed = /Operation not permitted|Permission denied/i.test(tail)
    throw new Error('Chrome DevTools endpoint never came up. '
      + (sandboxed ? 'Chrome was blocked by the sandbox this command is running in (Mach/crashpad calls are denied) — run `bun run verify` from a normal terminal. ' : '')
      + `Last Chrome output: ${tail || '(nothing logged)'} — see ${chromeLog}`)
  }

  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
  cdp = new Cdp(webSocketDebuggerUrl)
  await cdp.connect()
  // Product photos come from the rig, not the network. `Fetch` is the only CDP domain that can answer
  // an `<img>` request — the in-browser `fetch` stub cannot — and it is scoped to the one bucket the
  // app builds public URLs from, so nothing else is intercepted. Both storage paths are listed because
  // every catalog URL now carries a `?width=` transform and arrives on `/render/image/`, while an
  // absolute `storage_path` still comes back on `/object/`. `photoFor` cuts the query off first, so
  // the transform never changes which synthetic size a fixture filename asks for.
  // Two families arrive here: the product photos (every storage image URL) and the scripted
  // clerk-js (every request to the fake frontend-API host — the browser bundle and the UI one,
  // both served the same payload; see FAKE_CLERK). `crossOrigin: anonymous` on the clerk scripts
  // means these answers must carry the CORS header, same as the photos.
  cdp.onEvent = async (m) => {
    if (m.method !== 'Fetch.requestPaused') return
    const url = m.params.request.url
    const isClerk = url.indexOf('clerk.example.invalid') !== -1
    const payload = isClerk ? FAKE_CLERK : photoFor(url)
    const type = isClerk ? 'application/javascript; charset=utf-8' : 'image/svg+xml'
    const body = Buffer.from(payload).toString('base64')
    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId: m.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: type }, { name: 'access-control-allow-origin', value: '*' }],
        body
      })
    } catch { /* the request was already dropped; nothing here is load-bearing for a check */ }
  }
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOM.enable')
  // Product photos come from the rig, not the network. `Fetch` is the only CDP domain that can
  // answer an `<img>` request — the in-browser `fetch` stub cannot — and it is scoped to the one
  // bucket the app builds public URLs from plus the fake Clerk host, so nothing else is
  // intercepted. Both storage paths are listed because every catalog URL now carries a `?width=`
  // transform and arrives on `/render/image/`, while an absolute `storage_path` still comes back
  // on `/object/`. `photoFor` cuts the query off first, so the transform never changes which
  // synthetic size a fixture filename asks for.
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/storage/v1/render/image/public/*', requestStage: 'Request' }, { urlPattern: '*/storage/v1/object/public/*', requestStage: 'Request' }, { urlPattern: '*clerk.example.invalid*', requestStage: 'Request' }] })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource })

  // 3. helpers built on the client
  const ev = expr => cdp.ev(expr)
  // Readiness, bounded. This used to be `Page.navigate` + `sleep(2200)`, the
  // pattern docs/rules/TESTING_SPECS.md forbids, and it lost the race anyway — 3 of
  // 5 runs on 2026-09-28 died at the first product-detail check. Now wait for the
  // new document's load event (armed before navigating, see Cdp.once) and for the
  // webfont swap several asserts measure through, then settle for hydration. The
  // caps sum to ~2.4 s, so the worst case is the old sleep and the common case is
  // ~0.7 s. They are not decoration: a page whose Supabase host is unreachable
  // never commits its navigation, and an unbounded wait turned that into a red run.
  const nav = async url => {
    const loaded = cdp.once('Page.loadEventFired', 1200).catch(() => false)
    await cdp.send('Page.navigate', { url })
    await loaded
    await ev('Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]).then(() => true)')
    await sleep(400) // the one guess left: hydration and entry transitions have no observable edge
  }
  const metrics = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  const mouse = (type, x, y, buttons = 0) => cdp.send('Input.dispatchMouseEvent', { type, x, y, buttons, clickCount: 1, button: 'left' })
  const clickAt = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await mouse('mouseReleased', x, y); await sleep(90) }
  const park = async () => { await mouse('mouseMoved', 12, 12); await sleep(450) }
  const waitFor = async (expr, ms = 8000) => {
    // 40 ms, not 150 ms: an `ev()` round trip costs a few milliseconds, so the
    // old tick threw away half its interval per wait — ~250 waits per run. The
    // 8 s bound is deliberate and unchanged: an expired wait is a reported FAIL,
    // never a hang, so a finer tick buys resolution rather than timeout safety.
    const until = Date.now() + ms
    while (Date.now() < until) { try { if (await ev(expr)) return true } catch { return false } await sleep(40) }
    return false
  }
  // contains, not equality ("＋ Add product"); and a modal's footer button sits below its own
  // scroll fold, so scroll it into view before reading the rect.
  const findBox = (sel, text) => '(() => { const el = [...document.querySelectorAll(' + JSON.stringify(sel) + ')].find(b => (b.textContent || "").trim().includes(' + JSON.stringify(text) + ')); if (!el) return null; el.scrollIntoView({ block: "center", inline: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'
  const clickByText = async (sel, text, waitExpr) => {
    let box = null
    const until = Date.now() + 7000
    while (!box && Date.now() < until) { box = await ev(findBox(sel, text)); if (!box) await sleep(40) }
    if (!box) return false
    await sleep(300)
    box = await ev(findBox(sel, text)) || box
    await clickAt(box.x, box.y)
    return waitExpr ? waitFor(waitExpr, 8000) : true
  }
  const setInput = (sel, value) => '(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event("input", { bubbles: true })); return el.value })()'
  // Scroll the target into view before measuring it: rows low on a long form sit below the
  // fold, and Chrome silently drops clicks (and touch points) aimed outside the viewport.
  // Re-measure after the scroll settles — a rect taken mid-smooth-scroll is stale by the
  // time the click lands, and the click hits whichever row slid into those coordinates.
  const clickSelector = async (sel, waitExpr) => {
    if (!await waitFor(`!!document.querySelector(${JSON.stringify(sel)})`)) return false
    const boxExpr = '(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); el.scrollIntoView({ block: "center", inline: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'
    await ev(boxExpr)
    await sleep(300)
    const box = await ev(boxExpr)
    await clickAt(box.x, box.y)
    return waitExpr ? waitFor(waitExpr) : true
  }
  // ---- the two Khmer sweeps, shared by the storefront and the editors -------------------------
  // Both read the *script* of what rendered rather than the route it rendered on, which is the only
  // way to catch a Khmer product or category name printed on the English page (`pickTranslation`
  // falls back current locale → `en` → first available row, so that run sits under the wide branch of
  // every locale-keyed guard) and the Khmer chrome of the admin pages, which no storefront route
  // renders at all. Both are computed-style / canvas reads, never text-width reads (see the font note
  // at the top of this file), so they hold on a runner with a different UI face. Each reports how much
  // Khmer it judged, because a bound that can only ever pass proves nothing. A Khmer cluster carries
  // marks above and below the base, so the second sweep asks the font for its own ink box and compares
  // it to the line box of whichever element clips.
  // Khmer cluster apart (its marks sit above and below the base letter) and a *negative* one crowds them
  // into each other, so the bound is two-sided and absolute: a Khmer run carries NO letter-spacing. Even
  // the 0.08em hairline these eyebrows used to choose was a defect — at an 11px step it lands between
  // every codepoint of a cluster, which is what made បណ្តុំផលិតផល render as
  // "ប ណ្តុំ ផ លិ ត ផ ល". Only the Latin branch may be tracked.
  const latinSpacedKhmer = () => ev('(() => { const bad = []; let seen = 0; for (const el of document.querySelectorAll("body *")) { const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim(); if (!/[\\u1780-\\u17FF]/.test(own)) continue; seen++; const c = getComputedStyle(el); const fs = parseFloat(c.fontSize); const ls = c.letterSpacing === "normal" ? 0 : parseFloat(c.letterSpacing); if (fs > 0 && Math.abs(ls / fs) > 0.005) bad.push({ text: own.slice(0, 18), em: +(ls / fs).toFixed(3) }); } return { bad, seen } })()')
  const clippedInk = () => ev('(() => { const cv = document.createElement("canvas").getContext("2d"); const bad = []; let clipping = 0; for (const el of document.querySelectorAll("body *")) { const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim(); if (!/[\\u1780-\\u17FF]/.test(own)) continue; const c = getComputedStyle(el); if (c.overflowY !== "hidden" && c.overflowX !== "hidden") continue; clipping++; cv.font = c.fontWeight + " " + c.fontSize + " " + c.fontFamily; const m = cv.measureText(own); const ink = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent; const lh = parseFloat(c.lineHeight); if (Number.isFinite(lh) && ink > lh + 0.5) bad.push({ text: own.slice(0, 18), ink: +ink.toFixed(1), lh: +lh.toFixed(1) }); } return { bad, clipping } })()')
  // A caption bounded by `max-w-*` with no `truncate` is not clipped — it overflows its own box, so
  // `scrollWidth - clientWidth` is the read that answers "does this Khmer word fit here at all".
  const captionOverflow = sel => ev('(() => { const out = []; for (const s of document.querySelectorAll(' + JSON.stringify(sel) + ')) { if (!s.getClientRects().length) continue; out.push({ text: (s.textContent || "").trim().slice(0, 18), over: s.scrollWidth - s.clientWidth, box: Math.round(s.clientWidth) }) } return out })()')
  // A `keydown` carrying no `text` produces no `keypress`, and it is the keypress that activates
  // a native button in Blink — without it Enter lands on the control and nothing happens.
  const press = async (code, key, vk, text) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, text: text }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }) }
  const byLabel = (label, value) => '(() => { const dlg = document.querySelector(\'[role="dialog"]\'); if (!dlg) return "NODIALOG"; const lbl = [...dlg.querySelectorAll("label")].find(l => (l.textContent || "").trim().replace(/[*\\s]+$/, "").trim() === ' + JSON.stringify(label) + '); if (!lbl) return "NOLABEL"; const el = dlg.querySelector("#" + (window.CSS ? CSS.escape(lbl.htmlFor) : lbl.htmlFor)) || (lbl.parentElement && lbl.parentElement.querySelector("input, textarea")); if (!el) return "NOFIELD"; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value })()'
  const allW = async () => (await ev('window.__W || []'))
  const writes = async () => (await allW()).filter(w => w.method !== 'GET' && !w.p.startsWith('/auth/'))
  const resetW = () => ev('window.__W = []; true')
  const norm = s => (typeof s === 'string' ? s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>') : s)
  const seqOf = list => list.map(w => `${w.method} ${w.p}${w.q ? '?' + w.q : ''}`)

  // ---- the capabilities the conversion flow depends on -----------------------------------------
  // The clipboard is something the rig has to decide about, and it has to be installed *after* the
  // navigation that re-injected the stub: the app reads `navigator.clipboard` when a row is pressed,
  // not when the page loads. `reject` and `missing` deliberately record nothing, so "the copy
  // happened" and "the copy was attempted" stay distinguishable in the assertions.
  const CLIPBOARD = {
    ok: '{ writeText: function (t) { window.__COPIES.push(String(t)); return Promise.resolve(); } }',
    reject: '{ writeText: function () { return Promise.reject(new Error("NotAllowedError")); } }',
    missing: 'undefined'
  }
  // The one thing the clipboard mock cannot decide for itself: the sheet must never reach for the
  // platform's share API at all, so the rig installs a `navigator.share` that records any call and
  // fails the check that reads it. A share sheet the visitor cannot see is not a UI, and its promise
  // resolving is not evidence that anything was shared (see ARCHITECTURE.md → The conversion flow).
  const SHARE_TRAP = 'function (data) { window.__SHARES.push(data); return Promise.resolve(); }'
  const armClipboard = mode => ev('(() => { window.__COPIES = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: ' + CLIPBOARD[mode] + ' }); return true })()')
  const armShareTrap = () => ev('(() => { window.__SHARES = []; Object.defineProperty(navigator, "share", { configurable: true, value: ' + SHARE_TRAP + ' }); return true })()')
  const shareCalls = async () => await ev('window.__SHARES || []')
  const copies = async () => await ev('window.__COPIES || []')
  // Stop a channel or destination link from actually leaving the page so the click can still be
  // observed. The listener captures on the document and only cancels the default, which leaves the
  // app's own handlers running — the way to ask "did tapping this pretend to copy something?".
  const holdChannelLinks = () => ev('(() => { window.__BLOCKED = 0; document.addEventListener("click", function (e) { var link = e.target && e.target.closest ? e.target.closest("[data-contact-channel], [data-share-destination]") : null; if (link) { e.preventDefault(); window.__BLOCKED++; } }, true); return true })()')
  // A shop or a product that the fixtures do not contain: mutate the stub's own collections before
  // the app boots, run the navigation, then remove the script so no later check inherits it.
  const forNextDocument = async source => (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier
  const stopForNextDocument = identifier => cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {})
  // Both mounts of the conversion UI in one read: the inline block and the teleported sticky bar
  // are the same component twice, so every assertion below asks the same question of each and the
  // answers are what prove the two cannot drift apart.
  const MOUNTS = '(() => { const out = []; for (const el of document.querySelectorAll("[data-product-actions]")) { const cta = el.querySelector("[data-contact-cta]"); const msg = el.querySelector("[data-contact-message]"); const fb = el.querySelector("[data-contact-feedback]"); const panel = el.querySelector("[data-contact-panel]"); const label = el.querySelector("label"); const field = el.querySelector("textarea"); out.push({ where: el.closest("[data-sticky-cta]") ? "sticky" : "inline", visible: el.getClientRects().length > 0, tag: cta ? cta.tagName : null, type: cta ? cta.getAttribute("type") : null, ctaText: cta ? (cta.textContent || "").trim() : null, expanded: cta ? cta.getAttribute("aria-expanded") : null, controls: cta ? cta.getAttribute("aria-controls") : null, panelOpen: !!panel, panelLabel: panel ? panel.getAttribute("aria-label") : null, panelControls: panel ? panel.id : null, panelTabbable: panel ? panel.getAttribute("tabindex") === "0" : false, panelOverflow: panel ? panel.scrollHeight - panel.clientHeight : null, message: msg ? msg.value : null, feedback: fb ? (fb.textContent || "").trim() : null, live: fb ? fb.getAttribute("aria-live") : null, role: fb ? fb.getAttribute("role") : null, labelFor: label ? label.getAttribute("for") : null, fieldId: field ? field.id : null, labelText: label ? (label.textContent || "").trim() : null, shareTag: (el.querySelector("[data-share-cta]") || {}).tagName || null, shareLink: (function () { const l = el.querySelector("[data-share-link]"); return l && l.getClientRects().length > 0 && getComputedStyle(l).visibility !== "hidden" ? l.value : null })(), readonly: el.querySelector("[data-share-link]") ? el.querySelector("[data-share-link]").getAttribute("readonly") !== null : null, channels: [...el.querySelectorAll("[data-contact-channel]")].map(a => { const mark = a.querySelector("svg"); return { href: a.getAttribute("href"), text: (a.textContent || "").trim(), target: a.getAttribute("target"), rel: a.getAttribute("rel"), prefilled: a.getAttribute("data-contact-prefilled") === "true", svgs: a.querySelectorAll("svg").length, paths: a.querySelectorAll("svg path").length, fill: mark ? mark.getAttribute("fill") : null, stroke: mark ? mark.getAttribute("stroke") : null, ink: mark ? (() => { const bb = mark.getBBox(); return [Math.round(bb.width), Math.round(bb.height)] })() : null } }) }) } return out })()'
  const mounts = async () => await ev(MOUNTS)
  // The Share Sheet is teleported to `body` — a fixed panel may not inherit the sticky bar's
  // containing block, whose `backdrop-blur` would otherwise make the bar its viewport — so it is asked
  // about document-wide rather than through a mount. Exactly one mount is painted at a time, so there
  // is never more than one sheet to find.
  const SHEET = '(() => { const s = document.querySelector("[data-share-sheet]"); if (!s) return null; const r = s.getBoundingClientRect(); const c = getComputedStyle(s); const rows = [...s.querySelectorAll("[data-share-destination]")].map(a => { const mark = a.querySelector("svg"); return { platform: a.getAttribute("data-share-destination"), href: a.getAttribute("href"), text: (a.textContent || "").trim(), target: a.getAttribute("target"), rel: a.getAttribute("rel"), prefilled: a.getAttribute("data-share-prefilled") === "true", svgs: a.querySelectorAll("svg").length, fill: mark ? mark.getAttribute("fill") : null } }); const fb = s.querySelector("[data-share-feedback]"); const link = s.querySelector("[data-share-sheet-link]"); return { label: s.getAttribute("aria-label"), text: (s.textContent || "").trim(), position: getComputedStyle(document.querySelector("[data-share-slide]") || s).position, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height), radius: c.borderTopLeftRadius, pb: c.paddingBottom, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth, vh: innerHeight, hasCopyLink: !!s.querySelector("[data-share-copy-link]"), hasCopyMessage: !!s.querySelector("[data-share-copy-message]"), copyLinkText: (s.querySelector("[data-share-copy-link]") || {}).textContent ? (s.querySelector("[data-share-copy-link]").textContent || "").trim() : null, copyMessageText: (s.querySelector("[data-share-copy-message]") || {}).textContent ? (s.querySelector("[data-share-copy-message]").textContent || "").trim() : null, viaText: [...s.querySelectorAll("p")].map(p => (p.textContent || "").trim()).filter(Boolean).join(" | "), hasClose: !!s.querySelector("[data-share-close]"), hasCloseBottom: !!s.querySelector("[data-share-close-bottom]"), link: link ? link.value : null, readonly: link ? link.getAttribute("readonly") !== null : null, feedback: fb ? (fb.textContent || "").trim() : null, live: fb ? fb.getAttribute("aria-live") : null, rows } })()'
  const sheet = async () => await ev(SHEET)
  // The message the page must produce, assembled from the fixture row and the contract in
  // `expectations.conversion` — never read back out of the app.
  const expectedMessage = (row, ask, url) => EXP.conversion.lines
    .map(line => line
      .replace('{name}', row.product_translations[0].name)
      .replace('{currency}', row.currency)
      .replace('{price}', Number(row.price).toFixed(2))
      .replace('{sku}', row.sku)
      .replace('{ask}', ask)
      .replace('{url}', url))
    .join('\n')
  const consoleErrors = []
  cdp.events.length = 0
  const collectErrors = () => {
    for (const m of cdp.events) {
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description || 'exception')
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(a => a.value ?? a.description).join(' '))
    }
    cdp.events.length = 0
  }

  const EXP = FIXTURES.expectations
  const ORDER_ID = FIXTURES.orders.filter(o => o.status === 'pending')[0].id
  const CANCELLED_ORDER_ID = FIXTURES.orders.filter(o => o.status === 'cancelled')[0].id
  // The fixture note the cancelled row carries — what the buyer's detail and the desk must render.
  const CANCELLED_NOTE = FIXTURES.orders.filter(o => o.status === 'cancelled')[0].cancel_note
  // The reason the cancel arm types into the desk's modal; asserted on the RPC body it sends.
  const CANCEL_NOTE = 'Out of stock at the supplier.'
  const REFUND_NOTE = 'Bank transfer reversed.'
  // The fixture row behind a product id, for assertions that have to name what the page was given
  // (message lines, og:image, the CTA's stock band) without reading it back out of the app.
  const row = id => FIXTURES.products.find(p => p.id === id)
  const DIALOG = '[role="dialog"]'
  const ALERT = '[role="alertdialog"]'
  const EDIT_BTN = 'main article button[aria-label="Edit product"]'

  // Masthead geometry in one read. Two levels: the contact line (phone left, location right)
  // above a rule, then the brand row — emblem on the left, and on the right a column holding the
  // utility line over the social group. `rows` and `collide` describe the brand row only, since
  // the contact line is a block above it by construction.
  const MASTHEAD_EXPR = `(() => {
    const h = document.querySelector('header');
    if (!h) return null;
    const bx = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, right: b.right, y: b.top, bottom: b.bottom, w: b.width, h: b.height, cy: b.top + b.height / 2 }; };
    const logoEl = [...h.querySelectorAll('a img')].find(i => i.getBoundingClientRect().height > 0);
    if (!logoEl) return null;
    const row = h.lastElementChild;
    const col = row.querySelector(':scope > div');
    const socialsEl = h.querySelector('[data-site-socials]');
    // A label whose text box is wider than the box that shows it has been squeezed into an ellipsis.
    const clipped = el => { const s = el && el.querySelector('span'); return !!s && s.scrollWidth - s.clientWidth > 1 };
    const phoneEl = h.querySelector('a[data-site-phone]');
    const locationEl = h.querySelector('a[data-site-location]');
    const groups = [bx(logoEl), bx(col)].filter(Boolean);
    const rows = groups.slice().sort((a, b) => a.y - b.y);
    let wrapped = 1;
    for (let i = 1; i < rows.length; i++) if (rows[i].y >= rows[i - 1].y + rows[i - 1].h - 2) wrapped++;
    const clash = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h && a.x < b.right && b.x < a.right;
    let collide = false;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) if (clash(groups[i], groups[j])) collide = true;
    return {
      header: bx(h), logo: groups[0], contact: bx(h.querySelector('[data-site-contact]')),
      phone: bx(phoneEl), location: bx(locationEl), phoneClipped: clipped(phoneEl), locationClipped: clipped(locationEl),
      utils: bx(col && col.firstElementChild), socials: bx(socialsEl),
      rows: wrapped, collide
    };
  })()`
  // The emblem's Tailwind step per viewport: base / sm / md / lg / xl.
  const LOGO_STEP = { 390: 96, 640: 112, 834: 112, 1024: 112, 1280: 128, 1440: 128 }
  // How far the contact pair lifts off each container margin: none until `lg`, where the line is
  // wide enough that pinning the two labels to the extremes stops reading as one pair.
  const CONTACT_INSET = { 390: 0, 640: 0, 834: 0, 1024: 32, 1280: 48, 1440: 48 }
  // Returns the list of things that went wrong, so a failure names itself instead of just
  // re-printing the geometry that already looked right.
  const mastheadFaults = (m, w) => {
    if (!m) return ['no masthead']
    const f = []
    if (Math.abs(m.logo.h - LOGO_STEP[w]) >= 1) f.push(`logo ${m.logo.h} want ${LOGO_STEP[w]}`)
    if (m.rows !== 1) f.push(`${m.rows} rows in the brand row`)
    if (m.collide) f.push('emblem and right column collide')
    if (m.contact && m.contact.bottom > m.logo.top + 1) f.push('contact line is not above the emblem')
    if (m.phone && m.location && m.phone.right > m.location.x) f.push('phone and location overlap')
    if (m.phone && m.location) {
      const left = m.phone.x - m.header.x
      const right = m.header.right - m.location.right
      if (Math.abs(left - right) > 2) f.push(`contact inset is asymmetric (${left.toFixed(1)} / ${right.toFixed(1)})`)
      if (Math.abs(left - CONTACT_INSET[w]) > 2) f.push(`contact inset ${left.toFixed(1)} want ${CONTACT_INSET[w]}`)
      // The pair is spread because each end is pinned to its own margin (the inset checks above) and
      // neither has been squeezed out of the line. Measuring "each stays left/right of the centre"
      // instead made those margins a function of the runner's font: the same markup passes on a macOS
      // UI font and fails under a wider Linux one, with both labels still whole and untruncated.
      if (m.phoneClipped) f.push('the phone number is squeezed into an ellipsis')
      if (m.locationClipped) f.push('the location label is squeezed into an ellipsis')
    }
    if (m.socials && m.utils) {
      if (m.socials.y < m.utils.bottom - 1) f.push('socials share the utility line')
      if (Math.abs(m.socials.right - m.utils.right) > 1.5) f.push('socials not flush with the utility line')
      if (m.utils.x < m.logo.right) f.push('utility line collides with the emblem')
      if (m.socials.x < m.logo.right) f.push('socials collide with the emblem')
    }
    return f
  }

  // ============================== GUEST ==============================
  if (ONLY !== 'admin') {
    await metrics(1440, 900, false)
    await nav(appUrl)
    await cdp.send('Network.clearBrowserCookies')
    await ev('localStorage.clear(); sessionStorage.clear(); true')
    await nav(appUrl)
    collectErrors()

    const cards = await ev(boxesExpr('main article'))
    check('catalog renders every fixture product', cards.length === EXP.cards, { cards: cards.length })
    check('guest sees no admin affordance', !(await ev('!![...document.querySelectorAll("header span")].find(el => /admin\\s*mode/i.test(el.textContent || ""))')) && (await ev(`document.querySelectorAll(${JSON.stringify(EDIT_BTN)}).length`)) === 0)
    check('cards carry an image and a price', (await ev('document.querySelectorAll("main article img").length')) === EXP.cards && (await ev('document.querySelectorAll("main article p.tabular-nums").length')) === EXP.cards)
    // The uncategorized row (fixtures.json, ARCHITECTURE → Known gaps): its `categories` is null, so
    // this is where `?? t('uncategorized')` actually renders instead of only existing in the source.
    // Found by its product link rather than by position — the grid is newest-first and this row is the
    // oldest, so a positional read would keep passing after the order changed, for the wrong reason.
    const uncategorizedLabel = await ev('(() => { const a = document.querySelector(' + JSON.stringify('main article h2 a[href$="/products/aaaaaaaa-0000-4000-8000-000000000007"]') + '); const card = a && a.closest("article"); const p = card && card.querySelector("p.uppercase"); return p ? (p.textContent || "").trim() : null })()')
    check('a product with no category shows the fallback label', uncategorizedLabel === 'Uncategorized', { uncategorizedLabel })

    // The band is now asked of one shared rule (`app/utils/product-stock.ts`) rather than re-derived
    // inside the badge, so all three of its outputs are asserted per card: which band a quantity
    // falls into, the label that band carries, and the colour it is painted in. Matching a
    // `classList` token from position 0 is what keeps `text-zinc-400` from being satisfied by the
    // `dark:text-zinc-500` sitting beside it in the same attribute.
    const bands = await ev('(() => { const out = []; const tok = (el, prefix) => { const found = [...el.classList].find(c => c.indexOf(prefix) === 0); return found || null }; for (const el of document.querySelectorAll("main article [data-stock-status]")) { out.push({ s: el.getAttribute("data-stock-state"), l: el.textContent.trim(), t: tok(el, "text-zinc-"), d: el.firstElementChild ? tok(el.firstElementChild, "bg-zinc-") : null }) } return out })()')
    check('every card renders its stock band with the label and colour it always had', JSON.stringify(bands.map(b => [b.s, b.l, b.t, b.d])) === JSON.stringify(EXP.stockSequence.map(s => [s, EXP.stockBands[s].label, EXP.stockBands[s].text, EXP.stockBands[s].dot])), { bands })

    // site info in the masthead: what the fixture singleton stores is what the header exposes
    const phoneLink = await ev('(() => { const a = document.querySelector("header a[data-site-phone]"); return a ? { href: a.getAttribute("href"), text: (a.textContent || "").trim() } : null })()')
    check('header renders the phone as a tel link', !!phoneLink && phoneLink.href === EXP.siteInfo.phoneHref && phoneLink.text === EXP.siteInfo.phoneText, phoneLink)
    const locationLink = await ev('(() => { const a = document.querySelector("header a[data-site-location]"); return a ? { href: a.getAttribute("href"), text: (a.textContent || "").trim() } : null })()')
    check('header renders the location as a link', !!locationLink && locationLink.href === EXP.siteInfo.locationUrl && locationLink.text === EXP.siteInfo.locationLabel, locationLink)
    const socials = await ev('[...document.querySelectorAll("header a[data-site-social]")].map(a => a.getAttribute("data-platform"))')
    check('enabled social links render icon-only, in stored order', JSON.stringify(socials) === JSON.stringify(EXP.siteInfo.socialOrder), { socials })
    check('disabled social link is not rendered', !(await ev(`document.body.innerHTML.includes(${JSON.stringify(EXP.siteInfo.hiddenSocialUrl)})`)))

    // the masthead's two levels, measured rather than eyeballed
    const mast = await ev(MASTHEAD_EXPR)
    check('masthead is two levels: contact line, then emblem | utilities over socials', !!mast && !!mast.contact && !!mast.socials && !!mast.phone && !!mast.location, mast && { contact: !!mast?.contact, phone: !!mast?.phone, location: !!mast?.location, socials: !!mast?.socials })
    check('masthead keeps its levels apart, aligned and collision-free', mastheadFaults(mast, 1440).length === 0, mastheadFaults(mast, 1440))
    const glyphs = await ev('(() => { const links = [...document.querySelectorAll("header a[data-site-social]")]; return links.map(a => { const s = a.querySelector("svg"); const g = s.getBoundingClientRect(); const ink = s.getBBox(); return { text: (a.textContent || "").trim(), svgs: a.querySelectorAll("svg").length, fill: s.getAttribute("fill"), w: g.width, h: g.height, ink: [Math.round(ink.width), Math.round(ink.height)], cy: g.top + g.height / 2 } }) })()')
    check('social links stay icon-only, one glyph each', glyphs.length > 0 && glyphs.every(g => g.text === '' && g.svgs === 1), glyphs)
    check('social glyphs share a size and one centre line', glyphs.every(g => g.w === glyphs[0].w && g.h === glyphs[0].h && Math.abs(g.cy - glyphs[0].cy) < 1.5), glyphs)
    check('every social glyph is a platform mark, not the globe fallback', glyphs.every(g => g.fill === 'currentColor'), glyphs)
    // A truncated path still yields an element, a fill and a 16px box — youtube shipped as a 1.4px
    // speck that satisfied every one of those. getBBox() answers in viewBox units, so this asks
    // "does it actually paint most of the frame", which is the only check that means "the icon
    // is there" rather than "an icon node exists".
    check('every social glyph paints most of its frame', glyphs.every(g => g.ink[0] >= 12 && g.ink[1] >= 12), glyphs.map(g => g.ink))
    check('tagline is gone from the page', !(await ev('document.body.innerText.includes("Premium gaming gear")')))
    check('the catalog label is the page heading', (await ev('(document.querySelector("main h1") || {}).textContent?.trim()')) === 'Collection Bin')

    const search = (await ev(boxesExpr('[data-search-anchor] input')))[0]
    await clickAt(search.x, search.y)
    await cdp.send('Input.insertText', { text: 'zzzqqq' })
    check('search with no hits shows the empty state', await waitFor(`document.querySelectorAll("main article").length === 0 && document.body.innerText.includes("No products match this view.")`))
    const clearBtn = (await ev(boxesExpr('[data-search-anchor] button'))).find(b => b.x > search.x)
    await clickAt(clearBtn.x, clearBtn.y)
    check('clearing the search restores the grid', await waitFor(`document.querySelectorAll("main article").length === ${EXP.cards}`))

    // The clear control belongs to a box that has something to clear: an empty field renders no ✕ at all
    // (it would sit over the placeholder offering to delete nothing), and a box holding only spaces *is*
    // an empty box. Asserted on the live DOM because the rule is a `v-if` a template edit can delete.
    const anchorClear = '[...document.querySelectorAll(\'[data-search-anchor] [data-search-clear]\')]'
    const anchorInput = 'document.querySelector(\'[data-search-anchor] input\')'
    check('an empty field renders no clear ✕', await waitFor(`${anchorClear}.length === 0`), { found: await ev(`${anchorClear}.length`) })
    await clickAt(search.x, search.y)
    await cdp.send('Input.insertText', { text: '   ' })
    check('a field holding only spaces renders no clear ✕', await waitFor(`${anchorClear}.length === 0`), { value: await ev(`${anchorInput}.value`) })
    await cdp.send('Input.insertText', { text: 'ke' })
    check('text brings the clear ✕ back', await waitFor(`${anchorClear}.length === 1`), { value: await ev(`${anchorInput}.value`) })
    // Let the ✕ pressed by the grid-restore check above finish its own scatter first, so the layer being
    // counted below is this click's and not two overlapping clears.
    await sleep(700)
    // And pressing it lets the letters go rather than deleting them: a mirror of what was typed is on
    // screen the instant the click lands. Read in ONE expression around the click, because the ghosts live
    // ~0.4s and a second round trip can land after they are gone. The field's own value is Vue state and
    // empties on the next microtask, so it is waited for below rather than read here.
    const ghostShot = await ev('(() => { const b = document.querySelector(\'[data-search-anchor] [data-search-clear]\'); if (!b) return null; b.click(); const g = [...document.querySelectorAll(\'[data-clear-ghost] span\')]; const a = g.length ? g[0].getAnimations()[0] : null; const META = new Set([\'offset\', \'easing\', \'computedEasing\', \'composite\', \'computedOffset\']); const keys = a ? [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(p => !META.has(p)))] : []; return { ghosts: g.length, layers: document.querySelectorAll(\'[data-clear-ghost]\').length, keys } })()')
    check('pressing ✕ leaves the letters mid-flight over the field', !!ghostShot && ghostShot.ghosts >= 2 && ghostShot.layers === 1, ghostShot)
    check('the ✕ still empties the field', await waitFor(`${anchorInput}.value === ''`), { value: await ev(`${anchorInput}.value`) })
    // Only the two compositor properties move. This is the per-glyph layer's whole reason to exist: a
    // scatter that touched `left`/`width` would reflow the page once per letter.
    check('the scatter animates only transform and opacity', !!ghostShot && ghostShot.keys.length === 2 && ghostShot.keys.every(k => k === 'transform' || k === 'opacity'), { keys: ghostShot && ghostShot.keys })
    check('the ghost layer removes itself when the last letter has gone', await waitFor('!document.querySelector(\'[data-clear-ghost]\')', 3000) && await waitFor(`document.querySelectorAll("main article").length === ${EXP.cards}`, 3000))
    // Reduced motion: the text simply goes. The scatter is decoration, and a flicker of flying letters is
    // what the preference asks not to be forced on a visitor.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await clickAt(search.x, search.y)
    await cdp.send('Input.insertText', { text: 'ash' })
    const rmShot = await ev('(() => { const b = document.querySelector(\'[data-search-anchor] [data-search-clear]\'); if (!b) return null; b.click(); return { ghosts: document.querySelectorAll(\'[data-clear-ghost] span\').length, layers: document.querySelectorAll(\'[data-clear-ghost]\').length } })()')
    check('under reduced motion no letter is scattered', !!rmShot && rmShot.ghosts === 0 && rmShot.layers === 0, rmShot)
    check('and under reduced motion the field still empties', await waitFor(`${anchorInput}.value === ''`), { value: await ev(`${anchorInput}.value`) })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await sleep(250)

    const dock = await ev(boxesExpr('nav[aria-label="Product categories"] button'))
    const keyboards = dock.find(b => b.t === 'Keyboards')
    await clickAt(keyboards.x, keyboards.y)
    const eyebrows = await ev(`Array.from(new Set((${boxesExpr('main article p.uppercase')}).map(c => c.t)))`)
    check('category click filters to that category only', await waitFor('document.querySelectorAll("main article").length === 2') && JSON.stringify(eyebrows) === '["Keyboards"]', { eyebrows })
    await park()
    check('desktop indicator snapped onto the selection', await waitFor('(() => { const nav = document.querySelector(\'nav[aria-label="Product categories"]\'); const p = nav.firstElementChild.getBoundingClientRect(); const a = nav.querySelector(\'[aria-selected="true"]\').getBoundingClientRect(); return Math.abs(p.top - a.top) < 1.5 && Math.abs(p.height - a.height) < 1.5 })()'))
    const transition = await ev('getComputedStyle(document.querySelector(\'nav[aria-label="Product categories"]\').firstElementChild).transition')
    check('indicator keeps the 260ms tuned curve', transition.includes('0.26s') && transition.includes('cubic-bezier(0.16, 1, 0.3, 1)'), transition.slice(0, 60))
    await clickByText('nav[aria-label="Product categories"] button', 'All categories', 'document.querySelectorAll("main article").length === ' + EXP.cards)

    const pillScale = '[...document.querySelectorAll(\'nav[aria-label="Product categories"] button\')].map(b => +new DOMMatrixReadOnly(getComputedStyle(b.firstElementChild).transform).a.toFixed(3))'
    await mouse('mouseMoved', dock[2].x, dock[2].y)
    await sleep(400)
    const scales = await ev(pillScale)
    check('pointer magnification peaks on the hovered item', scales[2] > 1.1 && scales[2] === Math.max(...scales) && scales[0] === 1, { scales })
    await park()
    check('magnification relaxes when the pointer leaves', await ev(`(${pillScale}).every(s => s === 1)`))
    const src = dock[0]
    await mouse('mousePressed', src.x, src.y, 1)
    await mouse('mouseMoved', src.x, src.y - 14, 1)
    await sleep(90)
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', src.x, src.y + (dock[3].y - src.y) * i / 8, 1); await sleep(45) }
    await mouse('mouseReleased', src.x, dock[3].y)
    await park()
    check('desktop drag selects its target and snaps', await waitFor(`(() => { const nav = document.querySelector(\'nav[aria-label="Product categories"]\'); const sel = (nav.querySelector(\'[aria-selected="true"]\').textContent || "").trim(); const p = nav.firstElementChild.getBoundingClientRect(); const a = nav.querySelector(\'[aria-selected="true"]\').getBoundingClientRect(); return sel === ${JSON.stringify(dock[3].t)} && Math.abs(p.top - a.top) < 1.5 })()`), { want: dock[3].t })
    await clickByText('nav[aria-label="Product categories"] button', 'All categories', 'document.querySelectorAll("main article").length === ' + EXP.cards)

    // ---- categories the shop added ---------------------------------------------------------------
    // The dock used to be a hardcoded six, which made a new category real to the database and to the
    // product editor while nobody could reach it from the storefront. The stub's own category
    // collection is aliased for exactly this case. TWO rows, both with unknown slugs on purpose: they
    // share the one fallback glyph, so this is the first time the list ever holds two items with the
    // same `key` field. It proves both reach the dock and that each one selects on its own; it does
    // NOT prove the keying (measured: the old glyph key passed this too), only that nothing broke.
    const CAT_SEL = 'nav[aria-label="Product categories"]'
    const CAT_BTN = CAT_SEL + ' button'
    const addedCats = 'for (const c of [[8, "monitors", "Monitors"], [9, "speakers", "Speakers"]]) window.__CATEGORIES.push({ id: "ffffffff-0000-4000-8000-00000000000" + c[0], slug: c[1], sort_order: c[0], is_active: true, category_translations: [{ id: "gggggggg-0000-4000-8000-00000000000" + c[0], locale: "en", name: c[2] }] });'
    const newCatScript = await forNextDocument(addedCats)
    await nav(new URL('/', appUrl).href)
    await waitFor('document.querySelectorAll(' + JSON.stringify(CAT_BTN) + ').length === 8')
    const added = await ev('(() => { const btns = [...document.querySelectorAll(' + JSON.stringify(CAT_BTN) + ')]; return { count: btns.length, last: (btns[btns.length - 1].textContent || "").trim(), marks: btns.slice(-2).map(b => { const s = b.querySelector("svg"); const bb = s ? s.getBBox() : null; return bb ? [Math.round(bb.width), Math.round(bb.height)] : null }) } })()')
    // The rail is seven rows tall now, so the eighth row lives behind the scroll: bring it into view
    // the way a visitor would, then aim at it.
    await ev('(() => { const box = document.querySelector("[data-category-nav-scroll]"); box.scrollTop = box.scrollHeight; return true })()')
    await sleep(120)
    const lastAdded = (await ev(boxesExpr(CAT_BTN))).pop()
    await clickAt(lastAdded.x, lastAdded.y)
    // Selecting the *second* added category is the proof the two are separate rows: a shared key makes
    // one of them either vanish or answer for the other.
    const addedSelected = await waitFor('(() => { const sel = document.querySelector(' + JSON.stringify(CAT_SEL + ' [aria-selected="true"]') + '); return !!sel && (sel.textContent || "").trim() === "Speakers" && document.body.innerText.includes("No products match this view.") })()')
    check('two added categories both reach the dock, each with its own mark and its own selection', !!added && added.count === 8 && added.last === 'Speakers' && added.marks.every(m => !!m && m[0] > 12 && m[1] > 12) && addedSelected, { added, addedSelected })
    await clickByText(CAT_SEL + ' button', 'All categories', 'document.querySelectorAll("main article").length === ' + EXP.cards)
    await park()
    await stopForNextDocument(newCatScript)

    // ---- how long a dock the shop can now build has to be -----------------------------------------
    // Eighteen categories put the desktop nav's own bottom at 1204px inside a 900px viewport, and a
    // `top`-only sticky element pins its top forever: everything past the fold was unreachable. So the
    // nav bounds itself, and what proves that is reachability after scrolling it, plus no horizontal
    // overflow at any of the widths the storefront is measured at.
    const manyCats = 'for (let i = 0; i < 12; i++) window.__CATEGORIES.push({ id: "ffffffff-0000-4000-8000-000000000f" + (10 + i), slug: "cat-" + i, sort_order: 20 + i, is_active: true, category_translations: [{ id: "gggggggg-0000-4000-8000-000000000f" + (10 + i), locale: "en", name: "Category " + i }] });'
    const manyScript = await forNextDocument(manyCats)
    await nav(new URL('/', appUrl).href)
    await waitFor('document.querySelectorAll(' + JSON.stringify(CAT_BTN) + ').length === 18')
    const tall = await ev('(() => { const box = document.querySelector("[data-category-nav-scroll]"); const nav = document.querySelector(' + JSON.stringify(CAT_SEL) + '); const btns = [...nav.querySelectorAll("button")]; const last = btns[btns.length - 1]; window.scrollTo({ top: 700, behavior: "instant" }); box.scrollTop = 0; const before = last.getBoundingClientRect(); box.scrollTop = box.scrollHeight; const after = last.getBoundingClientRect(); return { items: btns.length, pinned: Math.round(box.getBoundingClientRect().top), scrolled: box.scrollHeight - box.clientHeight, unreachableBefore: before.bottom > innerHeight, reachableAfter: after.bottom <= innerHeight && after.top >= 0, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    check('a long dock scrolls to its last category instead of pinning it below the fold', !!tall && tall.items === 18 && tall.pinned > 40 && tall.pinned < 120 && tall.scrolled > 100 && tall.unreachableBefore && tall.reachableAfter && tall.overflowX === 0, tall)
    // The rail's scroll box must not become a guillotine: the selection pill scales past its row
    // while an item is hovered or dragged, and at the first and last row that overhang lands on the
    // clip edge. Select the last row, hover it, and measure the pill against the box.
    const lastRow = (await ev(boxesExpr(CAT_BTN))).pop()
    await clickAt(lastRow.x, lastRow.y)
    await waitFor('!!document.querySelector(' + JSON.stringify(CAT_SEL + ' [aria-selected="true"]') + ')')
    await mouse('mouseMoved', lastRow.x, lastRow.y)
    await sleep(150)
    // Held and dragged a little, which is when the pill is at its tallest: the row it mirrors scales,
    // and the clip edge does not move.
    await mouse('mousePressed', lastRow.x, lastRow.y, 1)
    for (const step of [4, 8, 12]) { await mouse('mouseMoved', lastRow.x, lastRow.y - step, 1); await sleep(45) }
    // The cap is expressed in rows, not viewport fractions, and this is the invariant that keeps it
    // honest: at the scroll position the rail rests at, every row crossing the bottom edge must be
    // fully inside the window — a row that is half in is a half-drawn icon.
    const wholeRows = await ev('(() => { const box = document.querySelector("[data-category-nav-scroll]"); const b = box.getBoundingClientRect(); const pad = getComputedStyle(box); const top = b.top + parseFloat(pad.paddingTop); const bottom = b.bottom - parseFloat(pad.paddingBottom); const rows = [...document.querySelector(' + JSON.stringify(CAT_SEL) + ').querySelectorAll("button")].map(r => r.getBoundingClientRect()); const crossing = rows.filter(r => r.top < bottom - 0.5 && r.bottom > top + 0.5); const whole = crossing.filter(r => r.top >= top - 0.5 && r.bottom <= bottom + 0.5); return { crossing: crossing.length, whole: whole.length } })()')
    check('the rail rests on whole rows — no half-drawn icon at its bottom edge', !!wholeRows && wholeRows.crossing === 7 && wholeRows.crossing === wholeRows.whole, wholeRows)
    const pillFit = await ev('(() => { const box = document.querySelector("[data-category-nav-scroll]"); const pill = document.querySelector(' + JSON.stringify(CAT_SEL) + ').firstElementChild; const b = box.getBoundingClientRect(); const r = pill.getBoundingClientRect(); return { clipped: r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5, room: [Math.round(r.top - b.top), Math.round(b.bottom - r.bottom), Math.round(r.left - b.left), Math.round(b.right - r.right)] } })()')
    await mouse('mouseReleased', lastRow.x, lastRow.y - 12)
    await sleep(120)
    check('the selection pill is never cut by the rail scroll box, held or dragging', !!pillFit && !pillFit.clipped, pillFit)

    const narrowFaults = []
    for (const w of [320, 390, 640]) {
      await metrics(w, 844, true)
      await nav(new URL('/', appUrl).href)
      await waitFor('!!document.querySelector(' + JSON.stringify(CAT_SEL) + ')')
      const over = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')
      if (over > 0) narrowFaults.push(w + 'px: ' + over + 'px of horizontal overflow')
    }
    check('eighteen categories do not widen the page at any narrow width', narrowFaults.length === 0, narrowFaults)
    await stopForNextDocument(manyScript)
    await metrics(1440, 900, false)
    await nav(new URL('/', appUrl).href)
    await waitFor('!!document.querySelector(' + JSON.stringify(CAT_SEL) + ')')
    await park()

    const sortTrigger = (await ev('(() => { const el = [...document.querySelectorAll(\'button, [role="combobox"]\')].find(b => (b.textContent || "").includes("Newest")); const r = el.getBoundingClientRect(); return [{ x: r.left + r.width / 2, y: r.top + r.height / 2 }] })()'))[0]
    await clickAt(sortTrigger.x, sortTrigger.y)
    const priceLow = await clickByText('[role="option"], [role="listbox"] [data-slot="item"]', 'Price: low to high', 'true')
    await sleep(700)
    const sortedPrices = await ev(`(${boxesExpr('main article p.tabular-nums')}).map(c => c.t.replace(/^[^ ]+ /, ""))`)
    check('sort price low-to-high orders the grid', priceLow && JSON.stringify(sortedPrices) === JSON.stringify(EXP.priceLowToHigh), { sortedPrices })
    await clickAt(sortTrigger.x, sortTrigger.y)
    await clickByText('[role="option"], [role="listbox"] [data-slot="item"]', 'Newest', 'true')
    await sleep(700)

    await ev('(() => { const a = document.querySelector(\'[data-search-anchor]\'); window.scrollTo({ top: a.getBoundingClientRect().bottom + window.scrollY + 120, behavior: "instant" }); return true })()')
    await sleep(700)
    const launchFilter = 'el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top > 0 && r.top < innerHeight && getComputedStyle(el).pointerEvents === "auto" }'
    const LAUNCH_VISIBLE = '[...document.querySelectorAll(\'button[aria-haspopup="dialog"]\')].filter(' + launchFilter + ').length > 0'
    const launchExpr = '(() => { const el = [...document.querySelectorAll(\'button[aria-haspopup="dialog"]\')].find(' + launchFilter + '); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'
    if (!await waitFor(LAUNCH_VISIBLE)) check('search launcher appears on scroll', false, { scrollY: await ev('window.scrollY'), pageH: await ev('document.documentElement.scrollHeight') })
    else {
      check('search launcher appears on scroll', true)
      const launch = await ev(launchExpr)
      await clickAt(launch.x, launch.y)
      // Live size-morph proof: catch a mid-flight frame where the panel is at an intermediate width
      // (between the ~44px icon and the ~576px field) AND its corner radius tracks half the height —
      // i.e. it is a true pill the whole way, not a scale-FLIP squashed into a rounded rectangle.
      check('spotlight opens with a live morph', await waitFor(`(() => { const p = document.querySelector('[role="dialog"][aria-label="Search products"] [data-search-panel]'); if (!p) return false; const r = p.getBoundingClientRect(); const rad = parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0; return r.width > 60 && r.width < 520 && Math.abs(rad - r.height / 2) <= 3 })()`, 1500))
      const settled = await waitFor('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] [data-search-panel]\'); return !!p && p.getBoundingClientRect().width > 400 })()', 6000)
      const panel = await ev('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] [data-search-panel]\'); if (!p) return null; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()')
      check('spotlight panel settles as a wide field', settled && !!panel && panel.w > 400 && panel.h > 40, panel)
      // The spotlight field never had a clear control at all — its ✕ was always the one that leaves the
      // overlay — so a visitor who mistyped one letter had nothing to press. It has one now, on the same
      // rule as the other two fields (nothing to clear, no control), and clearing must NOT close the
      // search: the visitor is mid-query, not leaving.
      const dlgClear = '[...document.querySelectorAll(\'[role="dialog"][aria-label="Search products"] [data-search-clear]\')]'
      check('the open spotlight shows no clear control while the field is empty', await waitFor(`${dlgClear}.length === 0`), { found: await ev(`${dlgClear}.length`) })
      await cdp.send('Input.insertText', { text: 'ke' })
      check('typing shows the spotlight\'s clear control', await waitFor(`${dlgClear}.length === 1`), { found: await ev(`${dlgClear}.length`) })
      await ev('(() => { const b = document.querySelector(\'[role="dialog"][aria-label="Search products"] [data-search-clear]\'); b && b.click() })()')
      check('clearing the spotlight empties it and keeps the search open', await waitFor(`(() => { const d = document.querySelector('[role="dialog"][aria-label="Search products"]'); const i = d && d.querySelector('input'); return !!i && i.value === '' && !!d.querySelector('[data-search-panel]') })()`, 2000) && await waitFor(`${dlgClear}.length === 0`), { found: await ev(`${dlgClear}.length`) })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
      check('spotlight closes on Escape', await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')'))
      // The clear-control checks above typed a query and emptied it again. While the query was up the grid
      // was filtered, so the page was SHORTER and the browser clamped `scrollY` to that shorter bottom —
      // which scrolls the anchor field back into view and hides the launcher the two blocks below aim at
      // (CI hit exactly this and died on a null probe; a laptop's taller rows never clamp). Re-take the
      // stage's own scroll so they start from the geometry they were written against.
      await ev('(() => { const a = document.querySelector(\'[data-search-anchor]\'); window.scrollTo({ top: a.getBoundingClientRect().bottom + window.scrollY + 120, behavior: "instant" }); return true })()')
      await sleep(700)
      // Reverse-window guard: Escape DURING the expansion (openPlaying true) reverses the panel back
      // to the icon and still completes — the dialog must go away, not hang mid-reverse. (Scroll-lock
      // release is asserted by the early-Escape check below; this one deliberately leaves scroll.)
      {
        const l3 = await ev(launchExpr)
        // Asserted rather than assumed, in this file's own terms: a missing mount must read as a failed
        // check, not as the TypeError that aborts every check after it.
        check('the launcher is on screen for the reverse-window guard', !!l3, { l3 })
        if (l3) {
          await clickAt(l3.x, l3.y)
          await sleep(150)
          await press('Escape', 'Escape', 27)
          const goneR = await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')', 3000)
          check('Escape mid-expansion reverses the panel and still completes (no hang)', goneR, { goneR })
        }
      }
      // Regression guard: Escape landing DURING the opening must release the scroll lock. Click to
      // open, then Escape 25ms later — while the open spring is still running and the panel may not
      // even be mounted. Then a programmatic scrollTo only sticks if unlockScroll ran (while locked,
      // the keepScrollPosition listener snaps it straight back to the locked offset).
      {
        const l2 = await ev(launchExpr)
        check('the launcher is on screen for the scroll-lock guard', !!l2, { l2 })
        if (l2) {
        await clickAt(l2.x, l2.y)
        await sleep(25)
        await press('Escape', 'Escape', 27)
        const gone = await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')', 3000)
        await sleep(200)
        const scrollFree = await ev('(() => { window.scrollTo({ top: 9999, behavior: "instant" }); const y = window.scrollY; window.scrollTo({ top: 0, behavior: "instant" }); return y > 200 })()')
        check('Escape during the opening releases the scroll lock (no permanent freeze)', gone && scrollFree, { gone, scrollFree })
        // The fast Escape could also leave `launcherTaken` stuck true (openOverlay resumed after the
        // instant close and hid the launcher). Re-collapse and confirm the launcher is interactive again.
        await ev('(() => { const a = document.querySelector(\'[data-search-anchor]\'); const top = a.getBoundingClientRect().top + window.scrollY; window.scrollTo({ top: top + a.offsetHeight + 160, behavior: "instant" }); return true })()')
        await sleep(700)
        const launcherBack = await ev('(() => [...document.querySelectorAll(\'button[aria-haspopup="dialog"]\')].some(b => { const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).pointerEvents === "auto" }))()')
        check('Fast Escape does not leave the launcher stuck taken', launcherBack, { launcherBack })
        }
      }
    }
    await ev('window.scrollTo({ top: 0, behavior: "instant" }); true'); await sleep(400)

    // ---- scroll-collapse field<->icon morph (SearchDock) ----
    // Two cooperating pieces (see ARCHITECTURE.md → Interaction invariants): the real field scrubs
    // its OWN width in place off scroll, and ONE launcher button flies as a `position: fixed` rAF
    // box between the field's icon footprint and its sidebar slot — carrying travel, not width.
    // A mid-flight reversal re-aims from the box's live rect instead of teleporting. There is no
    // third collapse element; the LEGACY_PILL_ABSENT assertion below guards that. LAUNCH reads the
    // dialog button's live box + running animations.
    const LAUNCH = '(() => { const el = [...document.querySelectorAll(\'button[aria-haspopup="dialog"]\')].find(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 }); if (!el) return { present: false }; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { present: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, opacity: +cs.opacity, pe: cs.pointerEvents, pos: cs.position, transform: el.style.transform || \'\', anims: el.getAnimations().filter(a => a.playState === \'running\').length } })()'
    // An earlier iteration flew a separate third element for this morph. Nothing in `app/` renders
    // one any more, so this asserts the design stays one field + one launcher.
    const LEGACY_PILL_ABSENT = '!document.querySelector(\'[data-collapse-morph]\')'
    const scrollCollapse = '(() => { const a = document.querySelector(\'[data-search-anchor]\'); const top = a.getBoundingClientRect().top + window.scrollY; window.scrollTo({ top: top + a.offsetHeight + 160, behavior: "instant" }); return true })()'
    const scrollTop = '(() => { window.scrollTo({ top: 0, behavior: "instant" }); return true })()'
    await ev(scrollTop); await sleep(450)

    // The field's width is a function of scroll (in place). FIELD reads the search field's live
    // width, its distance from the top edge, inline width and overflow.
    const FIELD = '(() => { const a = document.querySelector(\'[data-search-anchor]\'); if (!a) return { present: false }; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { present: true, w: Math.round(r.width), top: Math.round(r.top), inlineWidth: a.style.width || \'\', overflow: cs.overflow, visibility: cs.visibility } })()'
    // Hold the field's top at a chosen viewport offset so it rests mid-scrub, fully on screen.
    const holdTop = px => '(() => { const a = document.querySelector(\'[data-search-anchor]\'); const docTop = a.getBoundingClientRect().top + window.scrollY; window.scrollTo({ top: Math.max(0, docTop - ' + px + '), behavior: "instant" }); return true })()'
    await ev(scrollTop); await sleep(450)
    const fieldTop = (await ev(FIELD)).w
    const atTop = await ev(FIELD)
    check('at the top the field is full width with no inline override', atTop.present && atTop.w >= fieldTop - 4 && atTop.inlineWidth === '' && atTop.overflow !== 'hidden', atTop)
    // The field morphs its OWN width in place as it approaches the top edge; the flying box only
    // carries the icon↔circle travel. So held mid-band, the field width is genuinely in-between.
    await ev(holdTop(90)); await sleep(55)
    const mid = await ev(FIELD)
    check('scroll-linked: held mid-band the field width is in-between and still in place', mid.present && mid.w > 60 && mid.w < fieldTop - 20 && Math.abs(mid.top - 90) < 45, mid)
    await ev(scrollCollapse); await sleep(320)
    const collapsed = await ev(FIELD)
    check('scrolled past, the field pins to the icon footprint (clipped)', collapsed.present && collapsed.w < 70 && collapsed.overflow === 'hidden', collapsed)
    check('no third collapse element was reintroduced (no [data-collapse-morph] layer)', await ev(LEGACY_PILL_ABSENT))

    // No horizontal overflow while the morph runs
    await ev(scrollTop); await sleep(450)
    await ev(scrollCollapse); await sleep(60)
    check('no horizontal overflow while the field→icon morph runs', (await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    await sleep(520)

    // Reverse flight: scroll-up flies the launcher back to the field slot while the real field is
    // hidden (so the two never show as a duplicate bar), then the field expands to full width.
    await ev(scrollTop); await sleep(140)
    const upMid = await ev(LAUNCH)
    const upField = await ev(FIELD)
    check('scroll-up flies the launcher back up (fixed drift-free box, not yet clickable)', upMid.present && upMid.pos === 'fixed' && upMid.pe === 'none' && upMid.opacity > 0.9 && !(upMid.x < 80 && upMid.y < 80), upMid)
    check('the real field is hidden while the icon flies back up (no duplicate bar)', upField.present && upField.visibility === 'hidden', upField)
    // Poll across the whole flight + hand-off: the top field must NEVER be visible while the sidebar
    // icon is still painted on screen (the "appears before it arrives / two icons" regression). It
    // may only appear once the flying launcher has already been released (opacity ~0).
    const BOTH = '(() => { const a = document.querySelector(\'[data-search-anchor]\'); const fv = a ? getComputedStyle(a).visibility : \'none\'; const el = [...document.querySelectorAll(\'button[aria-haspopup="dialog"]\')].find(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 }); const op = el ? +getComputedStyle(el).opacity : 0; return { fv, op } })()'
    let bothSeen = null
    for (let i = 0; i < 14 && !bothSeen; i++) {
      const s = await ev(BOTH)
      if (s.fv === 'visible' && s.op > 0.5) bothSeen = s
      await sleep(70)
    }
    check('the top field never appears while the sidebar icon is still visible (one at a time)', bothSeen === null, bothSeen)
    const restored = await ev(FIELD)
    check('returning to the top expands the field to full width, visible and unclipped', restored.present && restored.visibility === 'visible' && restored.w >= fieldTop - 4 && restored.inlineWidth === '' && restored.overflow !== 'hidden', restored)

    // Interruption (the reported "interrupt the fly-up by scrolling down quickly" bug): collapse and
    // let it settle, start the fly-up, then reverse mid-flight. The launcher must keep flying from
    // where it is (a continuous fixed box — never teleporting back to the sidebar), the field stays
    // hidden, and it settles cleanly as the collapsed circle. Then return home for the next check.
    await ev(scrollCollapse); await sleep(700)
    await ev(scrollTop); await sleep(150)
    const intMid = await ev(LAUNCH)
    await ev(scrollCollapse); await sleep(70)
    const intRev = await ev(LAUNCH)
    const intField = await ev(FIELD)
    check('interrupting the fly-up re-aims from the live box (continuous fixed, field hidden)', intMid.pos === 'fixed' && intRev.present && intRev.pos === 'fixed' && intRev.pe === 'none' && intField.visibility === 'hidden', { intMid, intRev, intVis: intField.visibility })
    await sleep(700)
    const intSettle = await ev(LAUNCH)
    check('an interrupted fly-up settles cleanly to the collapsed sidebar circle', intSettle.present && intSettle.pe === 'auto' && intSettle.w >= 40 && intSettle.w <= 50, intSettle)
    await ev(scrollTop); await sleep(900)

    // Scroll-idle settle: stop mid-band and the field width glides to the nearer endpoint rather
    // than resting half-open.
    await ev(holdTop(150)); await sleep(60)
    const preSettle = await ev(FIELD)
    await sleep(460)
    const settled = await ev(FIELD)
    check('stopping mid-scrub settles to an endpoint (not left half-open)', settled.present && settled.w >= fieldTop - 4 && Math.abs(settled.w - preSettle.w) >= 4, { preSettle, settled })
    await ev(scrollTop); await sleep(200)

    // Rapid reversals leave no stuck width, clip, or hidden field.
    await ev(scrollCollapse); await sleep(40)
    await ev(holdTop(90)); await sleep(40)
    await ev(scrollCollapse); await sleep(40)
    await ev(scrollTop); await sleep(1050)
    const rev = await ev(FIELD)
    check('rapid reversals resolve cleanly (full width, visible, no leftover clip)', rev.present && rev.visibility === 'visible' && rev.w >= fieldTop - 4 && rev.overflow !== 'hidden', rev)

    // The desktop sidebar icon plays a pill→circle ARRIVAL cue when the field collapses (the
    // visual link that "the search became this icon"), then rests as the interactive circle. The
    // whole time, no more than one interactive search control exists and no pill layer appears.
    await ev(scrollTop); await sleep(450)
    const restPos = await ev(LAUNCH)
    await ev(scrollCollapse); await sleep(60)
    const flyMid = await ev(LAUNCH)
    const dupMid = await ev('(() => { const inputs = [...document.querySelectorAll(\'[data-search-anchor] input\')].filter(i => i.getBoundingClientRect().width > 0 && getComputedStyle(i).pointerEvents !== \'none\').length; const pill = !!document.querySelector(\'[data-collapse-morph]\'); const btns = [...document.querySelectorAll(\'button[aria-haspopup="dialog"]\')].filter(b => b.getBoundingClientRect().width > 0 && getComputedStyle(b).pointerEvents === \'auto\').length; return { inputs, pill, btns } })()')
    check('collapse flies the sidebar icon from the field (fixed drift-free box, not a fade)', flyMid.present && flyMid.pos === 'fixed' && flyMid.pe === 'none' && flyMid.opacity > 0.5 && !(flyMid.x < 80 && flyMid.y < 80) && (Math.abs(flyMid.y - restPos.y) > 30 || Math.abs(flyMid.x - restPos.x) > 30), flyMid)
    check('never more than one interactive search control (input + launcher, no pill layer)', dupMid.pill === false && dupMid.inputs + dupMid.btns <= 1, dupMid)
    await sleep(650)
    const flyEnd = await ev(LAUNCH)
    check('the flight lands as the interactive sidebar circle (pointer-events restored, 44px)', flyEnd.present && flyEnd.pe === 'auto' && flyEnd.w >= 40 && flyEnd.w <= 50, flyEnd)

    // The overlay morph still works after the collapse morph has owned the launcher
    await sleep(520)
    const launch2 = await ev(LAUNCH)
    if (!launch2.present) check('launcher present for the overlay check', false)
    else {
      await clickAt(launch2.x, launch2.y)
      const opened = await waitFor('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] [data-search-panel]\'); return !!p && p.getBoundingClientRect().width > 400 })()', 6000)
      // The user-visible symptom: the field must actually be painted and focused, not just mounted at
      // resting width — assert the input has size, reached full opacity, and taken focus.
      const inputLive = await waitFor('(() => { const i = document.querySelector(\'[role="dialog"][aria-label="Search products"] input\'); if (!i) return false; const r = i.getBoundingClientRect(); return r.width > 0 && +getComputedStyle(i).opacity > 0.9 && document.activeElement === i })()', 4000)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
      const closed = await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')')
      const restClean = await ev(LAUNCH)
      check('launcher→overlay morph stays intact after a collapse', opened && inputLive && closed && restClean.anims === 0, { opened, inputLive, closed })
    }

    // Reported bug: run the flight more than once (down → up → down), THEN click the sidebar icon.
    // The overlay must still expand to the full field with a visible input — not mount stuck at the
    // collapsed scale, where the field is a ~44px box on top of the icon and typed letters go nowhere.
    await ev(scrollTop); await sleep(200)
    await ev(scrollCollapse); await sleep(520)
    await ev(scrollTop); await sleep(520)
    await ev(scrollCollapse); await sleep(700)
    const launchR = await ev(LAUNCH)
    if (!launchR.present) {
      check('re-collapse: sidebar launcher present', false, launchR)
    }
    else {
      await clickAt(launchR.x, launchR.y)
      const expanded = await waitFor('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] [data-search-panel]\'); return !!p && p.getBoundingClientRect().width > 500 })()', 5000)
      const liveInput = await waitFor('(() => { const i = document.querySelector(\'[role="dialog"][aria-label="Search products"] input\'); if (!i) return false; const r = i.getBoundingClientRect(); return r.width > 200 && +getComputedStyle(i).opacity > 0.9 })()', 3000)
      const stuckPanelW = await ev('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] [data-search-panel]\'); return p ? Math.round(p.getBoundingClientRect().width) : -1 })()')
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
      await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')')
      check('a second flight then click still expands the field to full width (not stuck on the icon)', expanded && liveInput, { expanded, liveInput, stuckPanelW })
    }
    await ev(scrollTop); await sleep(400)

    // Desktop stable, mobile restrained: no cross-screen travelling pill
    await metrics(390, 844, true)
    await ev(scrollTop); await sleep(500)
    await ev(scrollCollapse); await sleep(80)
    const mobileCollapse = await ev(LAUNCH)
    check('mobile collapse does not expand a travelling pill (stays the icon reveal)', mobileCollapse.present && mobileCollapse.w < 60, mobileCollapse)
    await ev(scrollTop); await sleep(50)
    const mobileRestore = await ev(LAUNCH)
    check('mobile restore stays local (bounded pill, never a full-width flight)', mobileRestore.present && mobileRestore.w < 200, mobileRestore)
    await metrics(1440, 900, false)
    await ev(scrollTop); await sleep(450)

    // The brand-row wrap rule is only measurable at a font. `system-ui` is not the face the layout
    // was tuned on, and the CI runner resolves it wider (DejaVu-class): the utility line's two
    // text children then push past the 390 budget, opening the flex-wrap valve the header
    // documents as THE reflow answer — correct behavior reported as a red check. Pinning the
    // measurement to the Arial-metric pair (Arial on macOS, Liberation Sans — its metric twin —
    // on the runner) keeps the Latin widths runner-stable; the Khmer families stay last in the
    // chain so the switcher still renders in the bundled face. Measured on the tuned face: the
    // pin moves the English col 236.2 → 235.8, inside the slack that keeps @390 one row.
    // `body` is the pin's host: it re-declares the family below `html`, so an html-level
    // override measures nothing.
    const MEASURE_STACK = "Arial, 'Liberation Sans', 'Helvetica Neue', 'Noto Sans Khmer', 'Khmer OS System', sans-serif"
    await ev(`document.body.style.fontFamily = ${JSON.stringify(MEASURE_STACK)}; true`)
    for (const [w, h] of [[1440, 900], [1024, 900], [834, 1112], [640, 960], [390, 844]]) {
      await metrics(w, h, w < 500)
      await sleep(600)
      check(`no horizontal overflow @${w}`, (await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
      const m = await ev(MASTHEAD_EXPR)
      const faults = mastheadFaults(m, w)
      // A red run has to say what it measured, not only which rule it broke: this line's geometry is
      // the one part of the masthead that font metrics move, so the numbers belong in the failure.
      check(`masthead reflows without losing its hierarchy @${w}`, faults.length === 0, faults.length ? { faults, contact: m.contact && { x: +m.contact.x.toFixed(1), w: +m.contact.w.toFixed(1) }, phone: m.phone && { x: +m.phone.x.toFixed(1), w: +m.phone.w.toFixed(1), clipped: m.phoneClipped }, location: m.location && { x: +m.location.x.toFixed(1), w: +m.location.w.toFixed(1), clipped: m.locationClipped }, gap: +(m.location.x - m.phone.right).toFixed(1) } : [])
    }
    // The control for that rule: a squeeze the probe must see. Without it, "nothing is ellipsised"
    // could pass simply because the measurement never returns true, and the spread-pair rule would be
    // guarding nothing.
    await metrics(390, 844, true)
    await sleep(400)
    const squeeze = await ev('(() => { const s = document.querySelector(\'[data-site-location] span\'); if (!s) return null; s.style.maxWidth = "40px"; const m = ' + MASTHEAD_EXPR + '; const out = { location: m.locationClipped, phone: m.phoneClipped }; s.style.maxWidth = ""; return out })()')
    check('the masthead clip probe fires on a real ellipsis', !!squeeze && squeeze.location === true && squeeze.phone === false, squeeze)
    await ev('document.body.style.fontFamily = ""; true')

    // mobile dock: scroll reveal + indicator
    await metrics(390, 844, true)
    await nav(appUrl)
    await ev('window.scrollTo({ top: 0, behavior: "instant" }); true'); await sleep(600)
    const barOff = 'document.querySelector(\'nav[aria-label="Mobile product categories"]\').closest("div.fixed").getBoundingClientRect().top - innerHeight'
    const shown = await ev(barOff)
    for (const y of [260, 460, 660]) { await ev('window.scrollTo({ top: ' + y + ', behavior: "instant" }); true'); await sleep(150) }
    const hidden = await waitFor(barOff + ' >= -2')
    const mGeom = await ev('(() => { const nav = document.querySelector(\'nav[aria-label="Mobile product categories"]\'); const p = nav.firstElementChild.getBoundingClientRect(); const a = nav.querySelector(\'[aria-selected="true"]\').getBoundingClientRect(); return { d: +Math.abs(p.top - a.top).toFixed(2), n: nav.querySelectorAll("button").length } })()')
    check('mobile dock hides on scroll down and its indicator is aligned', shown < -2 && hidden && mGeom.d < 1.5, { shown, hidden, mGeom })
    // Bring the bar back before aiming at it: while it is translated off-screen its buttons
    // report rects below the viewport, and Chrome silently drops touch points sent there.
    await ev('window.scrollTo({ top: 0, behavior: "instant" }); true'); await sleep(600)
    if (!await waitFor(barOff + ' < -2', 4000)) check('mobile dock is back before dragging', false)
    const mbox = await ev(boxesExpr('nav[aria-label="Mobile product categories"] button'))
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, radiusX: 10, radiusY: 10, force: 1 })) })
    await touch('touchStart', [{ x: mbox[0].x, y: mbox[0].y }])
    // Drag-select is now gated behind a long-press (a quick flick scrolls natively instead), so
    // hold still past LONG_PRESS_MS (220) before moving to arm it.
    await sleep(260)
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: mbox[0].x + (mbox[3].x - mbox[0].x) * i / 8, y: mbox[0].y }]); await sleep(45) }
    await touch('touchEnd', [])
    check('mobile drag selects its target', await waitFor(`(document.querySelector(\'nav[aria-label="Mobile product categories"] [aria-selected="true"]\').textContent || "").trim() === ${JSON.stringify(mbox[3].t)}`), { want: mbox[3].t })

    // The other half of the split: a quick flick (no hold) is the browser's scroll, not a select.
    // It must leave the chosen category alone — the gesture that used to be captured as drag-select
    // now belongs to the native scroller.
    const flickBefore = await ev(`(document.querySelector(\'nav[aria-label="Mobile product categories"] [aria-selected="true"]\').textContent || "").trim()`)
    await touch('touchStart', [{ x: mbox[3].x, y: mbox[3].y }])
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: mbox[3].x - i * 14, y: mbox[3].y }]); await sleep(16) }
    await touch('touchEnd', [])
    await sleep(140)
    const flickAfter = await ev(`(document.querySelector(\'nav[aria-label="Mobile product categories"] [aria-selected="true"]\').textContent || "").trim()`)
    check('a quick flick scrolls without selecting', flickBefore === flickAfter, { flickBefore, flickAfter })

    // The bar no longer relies on tapping the last item to cycle: a long list overflows the
    // phone-width bar, and dragging a category into the right edge must pan it. Seed the overflow,
    // then prove the drag actually moved scrollLeft (the in-view drag-select check above never
    // reaches an edge, so it cannot cover this).
    const mobileMany = 'for (let i = 0; i < 12; i++) window.__CATEGORIES.push({ id: "ffffffff-0000-4000-8000-000000000e" + (10 + i), slug: "mcat-" + i, sort_order: 30 + i, is_active: true, category_translations: [{ id: "gggggggg-0000-4000-8000-000000000e" + (10 + i), locale: "en", name: "MCategory " + i }] });'
    const mobileManyScript = await forNextDocument(mobileMany)
    await metrics(390, 844, true)
    await nav(new URL('/', appUrl).href)
    await ev('window.scrollTo({ top: 0, behavior: "instant" }); true'); await sleep(600)
    if (!await waitFor(barOff + ' < -2', 4000)) check('mobile dock is back before edge-dragging', false)
    const mOver = await ev('(() => { const nav = document.querySelector(\'nav[aria-label="Mobile product categories"]\'); return { o: nav.scrollWidth - nav.clientWidth, sl: nav.scrollLeft } })()')
    const mEdge = await ev('(() => { const r = document.querySelector(\'nav[aria-label="Mobile product categories"]\').getBoundingClientRect(); return { right: r.right } })()')
    const mbox2 = await ev(boxesExpr('nav[aria-label="Mobile product categories"] button'))
    // Flicker lock. While a drag owns the pill, the edge auto-scroll fires a `scroll` event on every
    // pan step, and that handler re-aimed the indicator at the *active* item's box — hundreds of px to
    // the left of the finger — in the same breath as the drag wrote its own position. The two writers
    // alternated at touch frequency, which is what reads as the icons flickering once the drag reaches
    // the end of the list. Sampled frame by frame and only until the finger lifts (the settle after a
    // release is allowed to travel back), because a pill under the finger may hold or advance but must
    // never retreat.
    const START_PILL_FRAMES = '(() => { window.__PF = []; window.__PFstop = false; const t0 = performance.now(); const tick = function () { if (window.__PFstop) return; const nav = document.querySelector(\'nav[aria-label="Mobile product categories"]\'); const p = nav && nav.firstElementChild; if (p) { const m = new DOMMatrixReadOnly(getComputedStyle(p).transform); window.__PF.push({ e: +m.e.toFixed(1), w: +m.d.toFixed(1), sl: Math.round(nav.scrollLeft) }) } if (performance.now() - t0 < 3000) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()'
    await ev(START_PILL_FRAMES)
    await touch('touchStart', [{ x: mbox2[0].x, y: mbox2[0].y }])
    await sleep(260)
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: mbox2[0].x + (mEdge.right - 6 - mbox2[0].x) * i / 10, y: mbox2[0].y }]); await sleep(30) }
    for (let i = 0; i < 6; i++) { await touch('touchMove', [{ x: mEdge.right - 4, y: mbox2[0].y }]); await sleep(30) }
    const mScrolled = await ev('document.querySelector(\'nav[aria-label="Mobile product categories"]\').scrollLeft')
    await touch('touchEnd', [])
    await ev('window.__PFstop = true')
    const pillFrames = await ev('window.__PF || []')
    let pillDrop = 0
    for (let i = 1; i < pillFrames.length; i++) if (pillFrames[i].sl > pillFrames[i - 1].sl) pillDrop = Math.max(pillDrop, pillFrames[i - 1].e - pillFrames[i].e)
    check('the dragged pill does not snap back while the bar pans', mOver.o > 40 && mScrolled > mOver.sl + 20 && pillDrop < 12, { pan: mScrolled - mOver.sl, worstPillDropPx: pillDrop, frames: pillFrames.length, sample: pillFrames.filter((f, i) => i && f.sl > pillFrames[i - 1].sl).slice(0, 6) })
    check('dragging a mobile category to the right edge pans the overflowing bar', mOver.o > 40 && mScrolled > mOver.sl + 20, { overflow: mOver.o, before: mOver.sl, after: mScrolled })
    check('the tab icon is the logo, scoped to the browser theme', await ev(`!!document.querySelector('link[rel="icon"][media*="light"][href^="/favicon-light.png"]') && !!document.querySelector('link[rel="icon"][media*="dark"][href^="/favicon-dark.png"]')`))
    // Mobile reuses this declaration but has its own taste: Google's favicon guidance asks for more
    // than 48px because the same file is painted on surfaces far bigger than a desktop tab, and no
    // engine's choice between `media`-scoped links can be predicted. So the 192 pair and the 180 tile
    // carry their own background, and the 64 pair must keep NOT carrying one or the theme-following
    // above is worthless. Measured as the minimum alpha over the whole image — a corner probe is not
    // it, because the emblem's ring reaches the corner of the crop. These are same-origin images, so
    // the canvas read is not tainted. The URLs are read from the DOM rather than hardcoded, so the
    // version query the declarations carry (`?v=2`, which is how a cached wrong icon gets dislodged)
    // is part of what is proven to resolve — a declared path that 404s is exactly a blank tab icon.
    check('an icon above the 48px favicon recommendation is declared', await ev(`!!document.querySelector('link[rel="icon"][sizes="192x192"]')`))
    const iconAlpha = await ev(`(async () => { const out = {}; for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) { const key = new URL(l.href).pathname; try { const img = new Image(); img.src = l.href; await img.decode(); const n = img.naturalWidth, cv = document.createElement('canvas'); cv.width = cv.height = n; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, n, n).data; let min = 255; for (let i = 3; i < d.length; i += 4) if (d[i] < min) min = d[i]; out[key] = { size: n, minAlpha: min } } catch (e) { out[key] = { error: String(e).slice(0, 60) } } } return out })()`)
    const keyable = p => iconAlpha[p]?.size === 64 && iconAlpha[p]?.minAlpha === 0
    const solid = (p, n) => iconAlpha[p]?.size === n && iconAlpha[p]?.minAlpha === 255
    check('every declared icon resolves, at the size it claims and the opacity it needs', Object.keys(iconAlpha).length === 5 && !Object.values(iconAlpha).some(v => v.error) && keyable('/favicon-light.png') && keyable('/favicon-dark.png') && solid('/favicon-192-light.png', 192) && solid('/favicon-192-dark.png', 192) && solid('/apple-touch-icon.png', 180), iconAlpha)
    // The case the two media-scoped links above do not cover: a client that ignores `media` asks for
    // `/favicon.ico` directly. That file was still the framework's own default logo for ten days and
    // nothing in this harness looked at it, so the deployed tab icon was wrong while every check ran
    // green. An ICO is 6 header bytes then 16 per entry, and the entry starts with its width and
    // height bytes (0 means 256) with `imageOffset` 12 bytes later — `p` below already carries the
    // 6-byte header, so `u[p]`/`u[p+1]` are the size and `p + 12` the offset. All entries are walked
    // because a single 64px entry is legal and still renders as mush: the tab paints at 16 CSS px
    // (32 device px on a Retina screen), so the file has to carry those sizes or the browser
    // resamples artwork nobody designed for them.
    const ico = await ev(`fetch('/favicon.ico').then(r => r.arrayBuffer()).then(b => { const u = new Uint8Array(b), dv = new DataView(b), n = dv.getUint16(4, true), e = []; for (let i = 0; i < n; i++) { const p = 6 + 16 * i, off = dv.getUint32(p + 12, true); e.push({ w: u[p] || 256, h: u[p + 1] || 256, png: u[off] === 0x89 && u[off + 1] === 0x50 && u[off + 2] === 0x4e && u[off + 3] === 0x47 }) } return { type: dv.getUint16(2, true), n, e } })`)
    check('/favicon.ico is the emblem at every tab size, not the framework default', ico.type === 1 && ico.n >= 4 && ico.e.every(x => x.png) && [16, 32, 64].every(px => ico.e.some(x => x.w === px && x.h === px)), ico)
    await stopForNextDocument(mobileManyScript)
    await metrics(1440, 900, false)
    await nav(new URL('/', appUrl).href)

    // detail pages: every stored specification shape
    await metrics(1440, 900, false)
    for (const id of Object.keys(EXP.specRows)) {
      await nav(new URL('/products/' + id, appUrl).href)
      const rows = await ev('(() => [...document.querySelectorAll("main dl > div")].map(d => [(d.querySelector("dt")?.textContent || "").trim(), (d.querySelector("dd")?.textContent || "").trim()]))()')
      check(`detail page renders specifications for ${id.slice(-2)}`, JSON.stringify(rows) === JSON.stringify(EXP.specRows[id]), { rows })
    }

    // ---- product gallery: a bounded strip window that ADVANCES one slot when an adjacent
    // thumb is selected (a static list would keep the window and just move the highlight —
    // the WINDOW array is what distinguishes the two), centring the selection while it can ----
    const G = EXP.gallery
    const THUMB = '[data-gallery-thumb]'
    const SEL_IDX = `(() => { const t = document.querySelector('${THUMB}[data-selected]'); return t ? +t.getAttribute('data-index') : -1 })()`
    const WINDOW = `(() => [...document.querySelectorAll('${THUMB}')].map(b => +b.getAttribute('data-index')))()`
    const CENTRE = `(() => { const s = document.querySelector('[data-gallery-strip]'); const t = document.querySelector('${THUMB}[data-selected]'); if (!s || !t) return null; const sc = s.getBoundingClientRect(), tc = t.getBoundingClientRect(); return Math.abs((sc.left + sc.width / 2) - (tc.left + tc.width / 2)) })()`
    // The authoritative main image during a swap: the entering/current one, never a layer the
    // directional transition is still sliding out (a plain querySelector can catch mid-flight).
    const MAIN_SRC = '(() => { const is = [...document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\')]; const cur = is.find(i => !/leave-(from|active|to)/.test(i.className)) || is[is.length - 1]; return cur ? cur.getAttribute(\'src\') : null })()'
    const LB = '[data-lightbox]'
    const SAME_SRC = `(() => { const l = document.querySelector('${LB} [data-lightbox-main]'); const m = document.querySelector('[data-gallery-main]'); return !!l && !!m && l.getAttribute('src') === m.getAttribute('src') })()`
    const winJson = () => ev(WINDOW).then(w => JSON.stringify(w))
    const detailUrl = id => new URL('/products/' + id, appUrl).href
    const pathnameIs = id => `location.pathname === '/products/${id}'`

    // SPA navigation into a detail page — the path every direct-URL mount below skips. The first
    // photo must be on-frame at rest, not left a full width to the right (clipped by the frame's
    // overflow-hidden) by an enter animation that only completes when frames are produced. This is
    // the regression the inline <motion.img> carried: it started at initial={x:'100%'} and relied on
    // its enter animation to slide back, so when that animation never ran (SPA nav / an interrupted
    // or backgrounded frame) the photo stayed off-frame until a reload. `:initial="false"` fixes it.
    await metrics(1440, 900, false)
    await nav(appUrl)
    await waitFor('!!document.querySelector(\'a[href^="/products/"]\')')
    await ev('(() => { document.querySelector(\'a[href^="/products/"]\').click(); return true })()')
    await waitFor('location.pathname.startsWith("/products/")')
    await waitFor('!!document.querySelector(\'[data-gallery-main]\')')
    const spaFirst = await ev('(() => { const i = document.querySelector(\'[data-gallery-main]\'); const b = document.querySelector(\'[data-gallery-zoom]\'); if (!i || !b) return null; const r = i.getBoundingClientRect(); const s = b.parentElement.getBoundingClientRect(); return { vis: +(Math.max(0, Math.min(r.right, s.right) - Math.max(r.left, s.left)) / r.width).toFixed(2), tf: getComputedStyle(i).transform } })()')
    check('the first photo is on-frame after navigating from the storefront', !!spaFirst && spaFirst.vis > 0.9 && (spaFirst.tf === 'none' || spaFirst.tf === 'matrix(1, 0, 0, 1, 0, 0)'), spaFirst)

    await nav(detailUrl(G.manyId))
    if (!await waitFor('!!document.querySelector(\'[data-product-gallery]\')')) check('product gallery mounts', false)
    else {
      check('strip renders a bounded window of thumbs', (await ev(`document.querySelectorAll('${THUMB}').length`)) === G.window, { window: G.window })
      check('first photo is selected, with both arrows', (await ev(SEL_IDX)) === 0 && await ev('!!document.querySelector(\'[data-gallery-prev]\') && !!document.querySelector(\'[data-gallery-next]\')'))
      const src0 = await ev(MAIN_SRC)
      await clickSelector('[data-gallery-next]', `(${SEL_IDX}) === 1`)
      check('next arrow advances the selection', await waitFor(`(${SEL_IDX}) === 1`))
      // Wait for the Motion crossfade to settle to a single layer before asserting the current photo.
      // During the overlap two [data-gallery-main] are alive, and with no old CSS leave-* class to
      // key off, MAIN_SRC could read the outgoing layer. "The selected photo is showing" is a
      // settled-state fact; the mid-flight two-layer travel is asserted separately by midSwap below.
      await waitFor(`document.querySelectorAll('[data-product-gallery] [data-gallery-main]').length === 1`, 2000)
      check('main photo swaps when the selection moves', !!src0 && (await ev(MAIN_SRC)) !== src0)
      await clickSelector('[data-gallery-next]', `(${SEL_IDX}) === 2`)
      check('arrows never navigate the page', await ev(pathnameIs(G.manyId)))
      // [0..4] window, selection 2 → clicking the adjacent thumb (3) must slide the window to
      // [1..5], not leave it at [0..4] with a moved highlight — and the slide must actually run.
      const t3 = (await ev(boxesExpr(`${THUMB}[data-index="3"]`)))[0]
      await clickAt(t3.x, t3.y)
      // Poll for the slide's evidence in a bounded window instead of sampling one instant: the
      // click's effect flushes on the next render, and a stalled frame (observed 2026-10-05) can
      // push that flush past a single read — `tr: none, anims: 0` while the very next reads show
      // the window had advanced. The slide is a CSS transition (`anims` stays 0; the in-flight
      // matrix is the real arm), so "it runs" means the matrix appears within the bound.
      const slideSeen = await waitFor('(() => { const s = document.querySelector("[data-gallery-strip]"); if (!s) return false; return s.getAnimations().length >= 1 || getComputedStyle(s).transform !== "none" })()', 600)
      const midSlide = await ev('(() => { const s = document.querySelector(\'[data-gallery-strip]\'); return { anims: s ? s.getAnimations().length : 0, tr: s ? getComputedStyle(s).transform : null } })()')
      const fwdSel = await ev(SEL_IDX)
      const fwdWindow = await winJson()
      check('adjacent-thumb selection advances the strip one slot', fwdSel === 3 && fwdWindow === JSON.stringify([1, 2, 3, 4, 5]), { fwdSel, fwdWindow })
      check('the filmstrip slide actually runs when the window advances', slideSeen, { midSlide })
      await sleep(350) // let the one-slot slide settle before measuring centring
      const fwdCentre = await ev(CENTRE)
      check('selected thumb is highlighted and centred', fwdCentre !== null && fwdCentre < 2, { fwdCentre })
      await clickSelector(`${THUMB}[data-index="2"]`, `(${SEL_IDX}) === 2`)
      const backWindow = await winJson()
      check('previous-adjacent selection retreats the strip one slot', (await ev(SEL_IDX)) === 2 && backWindow === JSON.stringify([0, 1, 2, 3, 4]), { backWindow })
      // wrap: from 2, three prev clicks land on 0 then wrap to the last photo
      await clickSelector('[data-gallery-prev]', `(${SEL_IDX}) === 1`)
      await clickSelector('[data-gallery-prev]', `(${SEL_IDX}) === 0`)
      await clickSelector('[data-gallery-prev]', `(${SEL_IDX}) === ${G.manyImages - 1}`)
      const wrapWindow = await winJson()
      check('previous wraps first → last and pins the window to the end', (await ev(SEL_IDX)) === G.manyImages - 1 && wrapWindow === JSON.stringify([2, 3, 4, 5, 6]), { wrapWindow })
      await sleep(350)
      // At the clamped ends the window cannot stay centred — the last thumb rests in the last
      // slot with the strip pinned at [2..6]. That is the "stay centred whenever possible" rule;
      // what must hold is highlight + pinned window + right-slot position, not the centre.
      const wrapEnd = await ev('(() => { const s = document.querySelector(\'[data-gallery-strip]\'); const t = document.querySelector(\'[data-gallery-thumb][data-selected]\'); if (!s || !t) return null; const sc = s.getBoundingClientRect(), tc = t.getBoundingClientRect(); return { right: Math.abs(sc.right - tc.right) < 1.5, ring: getComputedStyle(t).borderColor } })()')
      check('the wrapped-last selection is highlighted in the pinned end slot', !!wrapEnd && wrapEnd.right, { wrapEnd })
      await clickSelector('[data-gallery-next]', `(${SEL_IDX}) === 0`)
      check('next wraps last → first', await waitFor(`(${SEL_IDX}) === 0`))
      await ev('document.querySelector(\'[data-product-gallery]\').focus(); true')
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowRight', key: 'ArrowRight' })
      check('keyboard arrow drives the selection when the gallery is focused', await waitFor(`(${SEL_IDX}) === 1`))

      // ---- arrows that wait for hover, and a swap that travels instead of teleporting ----
      await ev('(() => { const a = document.activeElement; if (a && a.getAttribute(\'data-product-gallery\') !== null) a.blur(); return true })()')
      await park()
      const hoverCapable = await ev('window.matchMedia(\'(hover: hover)\').matches')
      const arrowOpa = 'Number(getComputedStyle(document.querySelector(\'[data-gallery-next]\')).opacity)'
      const restOpa = await ev(arrowOpa)
      if (hoverCapable) check('arrows rest invisible to a hovering pointer', restOpa === 0, { restOpa })
      else check('arrows stay painted for a non-hovering pointer', restOpa === 1, { restOpa })
      const zoomBox = (await ev(boxesExpr('[data-gallery-zoom]')))[0]
      await mouse('mouseMoved', zoomBox.x, zoomBox.y)
      await sleep(250)
      check('hovering the photo raises the arrows', (await ev(arrowOpa)) === 1)

      const nextBtn = (await ev(boxesExpr('[data-gallery-next]')))[0]
      await mouse('mouseMoved', nextBtn.x, nextBtn.y)
      await sleep(120)
      await mouse('mousePressed', nextBtn.x, nextBtn.y, 1)
      await mouse('mouseReleased', nextBtn.x, nextBtn.y)
      const midSwap = await ev('(() => { const f = document.querySelector(\'[data-gallery-zoom]\'); const is = [...document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\')]; return { layers: is.length, anims: is.reduce((n, i) => n + i.getAnimations().length, 0), travel: is.some(i => getComputedStyle(i).transform !== \'none\'), widths: is.map(i => Math.round(i.getBoundingClientRect().width)), box: Math.round(f.getBoundingClientRect().width), ops: is.map(i => +getComputedStyle(i).opacity), gap: is.length > 1 ? Math.round(Math.abs(is[1].getBoundingClientRect().left - is[0].getBoundingClientRect().left)) : 0 } })()')
      check('the swap travels: a second layer mid-flight carrying an actual transform', midSwap.layers >= 2 && (midSwap.anims >= 1 || midSwap.travel) && await waitFor(`(${SEL_IDX}) === 2`), { midSwap })
      // "Continuous, not a fade." Both layers stay fully opaque through the swap, and they sit exactly
      // one photo box apart — so the pair reads as one surface sliding across the frame with no gap
      // and no dissolve. A cross-fade regression fails the opacity half; a desynced enter/exit (which
      // is what a snap-back parent looks like) fails the adjacency half.
      check('the inline swap slides as one continuous surface, never a cross-fade', midSwap.layers >= 2 && midSwap.ops.every(o => o > 0.99) && Math.abs(midSwap.gap - midSwap.box) <= 4, { ops: midSwap.ops, gap: midSwap.gap, box: midSwap.box })
      // The enlargement-flash regression: the outgoing layer once sized to the padded
      // frame's padding box (~17% wider than the photo box) and read as a split-second
      // zoom. Both layers must occupy the identical box mid-swap. Broken fixture images
      // paint nothing but still lay out, so this is measurable here.
      check('no swap layer outgrows the photo box mid-flight', midSwap.layers >= 2 && midSwap.widths.every(w => Math.abs(w - midSwap.box) <= 2), { midSwap })
      // the reported regression: a mouse click leaves focus on the arrow it hit, and that must
      // NOT pin the arrows lit — only a keyboard focus may. Pointer off the photo ⇒ faded out,
      // while the arrow stays focused and therefore still tab-operable.
      await park()
      if (hoverCapable) {
        const afterClickAway = await ev('(() => { const b = document.querySelector(\'[data-gallery-next]\'); return { opa: Number(getComputedStyle(b).opacity), focused: document.activeElement === b } })()')
        check('a clicked arrow fades out when the pointer leaves (mouse focus does not pin it)', afterClickAway.opa === 0 && afterClickAway.focused, { afterClickAway })
      }
      await sleep(400)
      check('the swap settles to a single image layer', (await ev('document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\').length')) === 1)

      // ---- lightbox: no index of its own, it renders the gallery's selection ----
      await clickAt(zoomBox.x, zoomBox.y)
      check('clicking the photo opens the lightbox', await waitFor(`!!document.querySelector(${JSON.stringify(LB)})`))
      check('the lightbox shows the shared selected image', await ev(SAME_SRC))
      check('focus moved into the lightbox', await ev(`(() => { const d = document.querySelector(${JSON.stringify(LB)}); return !!d && d.contains(document.activeElement) })()`))
      await clickSelector('[data-lightbox-next]', `(${SEL_IDX}) === 3`)
      check('lightbox next moves the one shared selection', await waitFor(`(${SEL_IDX}) === 3`) && (await ev(`(document.querySelector('${THUMB}[data-selected]') || {}).getAttribute && document.querySelector('${THUMB}[data-selected]').getAttribute('data-index')`)) === '3')
      // Let the swap finish first: while two layers are alive, the press and the release of one
      // synthetic click can land on different nodes, and Blink then delivers the click to their
      // common ancestor — the frame — which reads as a zoom that never happened.
      await waitFor(`document.querySelectorAll('${LB} [data-lightbox-main]').length === 1`, 3000)
      const lbImg = (await ev(boxesExpr(`${LB} [data-lightbox-main]`)))[0]
      await clickAt(lbImg.x, lbImg.y)
      await sleep(300)
      const centreClick = await ev('(() => { const lb = document.querySelector(\'[data-lightbox]\'); const z = document.querySelector(\'[data-lightbox-main][data-zoomed]\'); return { open: !!lb, zoomed: !!z } })()')
      check('clicking the enlarged image keeps the lightbox open and magnifies it', centreClick.open && centreClick.zoomed, { centreClick, aimedAt: lbImg })
      await clickAt(lbImg.x, lbImg.y)
      await sleep(300)
      // The backdrop, not the photo: with the zoom folded into the photo, a click that lands on the
      // picture is a zoom gesture, so this aims at the band beside it.
      await clickAt(12, 12)
      check('backdrop click closes the lightbox', await waitFor(`!document.querySelector(${JSON.stringify(LB)})`))
      check('closing hands focus back to the photo', await waitFor('document.activeElement === document.querySelector(\'[data-gallery-zoom]\')', 2500))
      check('the page scroll lock is released on close', await ev('document.documentElement.style.overflow === \'\''))
      await clickAt(zoomBox.x, zoomBox.y)
      await waitFor(`!!document.querySelector(${JSON.stringify(LB)})`)
      check('reopening starts at the current selection', await ev(SAME_SRC) && (await ev(SEL_IDX)) === 3)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowRight', key: 'ArrowRight' })
      check('arrow keys navigate inside the lightbox', await waitFor(`(${SEL_IDX}) === 4`))
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
      check('Escape closes the lightbox', await waitFor(`!document.querySelector(${JSON.stringify(LB)})`))

      // ---- second-stage zoom: the enlarged photo *is* the zoom control ----
      // No button, no second modal: a click magnifies the photo around the point that was clicked and
      // a click again returns it. These checks are explicit about the motion preference, because
      // headless Chrome answers reduced-motion queries with `reduce` by default and "running with
      // motion" is a precondition here, not an accident of the rig.
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      await clickAt(zoomBox.x, zoomBox.y)
      await waitFor(`!!document.querySelector(${JSON.stringify(LB)} [data-lightbox-main])`)
      // The *current* lightbox photo, never the outgoing layer of a swap still running (the same
      // MAIN_SRC rule the gallery checks follow): a leave-active ghost is first in document order,
      // absolutely positioned and perfectly zoomable — measuring it would measure yesterday's photo.
      // Geometry is read off the frame (the photo's parent), which carries no transform of its own,
      // and the *painted* picture is derived from it plus the image's intrinsic size: `object-contain`
      // letterboxes one axis, and the focal point belongs to the picture, not to the box around it.
      const ZGEO = `(() => { const ls = [...document.querySelectorAll('${LB} [data-lightbox-main]')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; if (!i) return null; const f = i.parentElement; const fr = f.getBoundingClientRect(); const c = getComputedStyle(i); const ctl = document.querySelector('${LB} [data-lightbox-zoom-target]'); const m = /matrix\\(([^)]+)\\)/.exec(c.transform); const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0]; const o = (c.transformOrigin || '0 0').split(/\\s+/); const px = (v, size) => /%$/.test(v) ? parseFloat(v) / 100 * size : parseFloat(v) || 0; const ox = px(o[0] || '0', fr.width), oy = px(o[1] || '0', fr.height); const nat = (i.naturalWidth && i.naturalHeight) ? i.naturalWidth / i.naturalHeight : 1; const pw = Math.min(fr.width, fr.height * nat), ph = pw / nat; return { zoomed: i.getAttribute('data-zoomed'), cursor: ctl ? getComputedStyle(ctl).cursor : null, scale: p[0], tx: p[4], ty: p[5], originX: ox, originY: oy, originFX: fr.width ? ox / fr.width : 0, originFY: fr.height ? oy / fr.height : 0, transition: c.transitionDuration, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, frameLeft: fr.left, frameTop: fr.top, frameW: fr.width, frameH: fr.height, paintLeft: fr.left + (fr.width - pw) / 2, paintTop: fr.top + (fr.height - ph) / 2, paintW: pw, paintH: ph, ratio: nat } })()`
      const ZFOCUS = `(() => { const ls = [...document.querySelectorAll('${LB} [data-lightbox-main]')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; const d = document.querySelector('${LB}'); if (d) d.focus(); return !!d })()`
      // Every measurement below derives the painted picture from the image's intrinsic size, so a
      // photo that has not decoded yet reports a ratio of 1 and the letterbox maths reads as broken.
      const PHOTO_READY = `(() => { const ls = [...document.querySelectorAll('${LB} [data-lightbox-main]')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; return !!i && i.complete && i.naturalWidth > 0 })()`
      const photoReady = () => waitFor(PHOTO_READY, 5000)
      await photoReady()
      const geo0 = await ev(ZGEO)
      // Clicks are aimed at fractions of the *picture*, not of the frame: a portrait photo in a wide
      // window occupies the middle third of it, and a click outside the picture is the clamp's test
      // case, not the focal point's.
      const anchorOf = (g, fx, fy) => ({ x: g.paintLeft + g.paintW * fx, y: g.paintTop + g.paintH * fy })
      const clickPhoto = async (fx, fy) => { const g = await ev(ZGEO); const p = anchorOf(g, fx, fy); await clickAt(p.x, p.y); await sleep(320); return p }
      // The containment rule: after the scale and the resting translate, the picture's own edges must
      // sit at or beyond the frame's on any axis it is large enough to cover — otherwise the zoom has
      // uncovered the backdrop, which is exactly what the pan clamp exists to prevent. Scaling about
      // an origin maps a picture edge at element-local `p` to `o + (p − o)·s + t`.
      const coverGaps = g => {
        const edge = (paintStart, paintSize, origin, translate, frameStart, frameSize) => {
          const near = frameStart + origin + (paintStart - origin) * g.scale + translate
          const far = near + paintSize * g.scale
          return { left: frameStart - near, right: far - (frameStart + frameSize) }
        }
        const x = edge(g.paintLeft - g.frameLeft, g.paintW, g.originX, g.tx, g.frameLeft, g.frameW)
        const y = edge(g.paintTop - g.frameTop, g.paintH, g.originY, g.ty, g.frameTop, g.frameH)
        return { x, y, wideEnough: g.paintW * g.scale >= g.frameW - 1, tallEnough: g.paintH * g.scale >= g.frameH - 1 }
      }
      const contained = g => {
        const c = coverGaps(g)
        return (!c.wideEnough || (c.x.left >= -1 && c.x.right >= -1)) && (!c.tallEnough || (c.y.left >= -1 && c.y.right >= -1))
      }
      // Anchoring is what the gesture asks for, but containment is what the app must never break, so a
      // resting zoom has exactly three legal shapes per axis: held under the pointer; centred, because
      // the picture is too small to cover the frame even at 2.5x (`panRange` inverts and refuses to
      // invent travel); or flush with a frame edge, because the clamp moved it to keep the backdrop
      // covered. Anything else is drift, and the axis says so in the detail.
      const anchoredOrCentred = (g, click) => {
        const c = coverGaps(g)
        const h = hold(g, click)
        const axis = (enough, gaps, paint, frame, moved) => {
          if (Math.abs(moved) < 2) return { ok: true, how: 'anchored' }
          if (!enough) return { ok: Math.abs(gaps.left - (paint * g.scale - frame) / 2) < 2, how: 'centred' }
          const flush = Math.abs(gaps.left) < 2 || Math.abs(gaps.right) < 2
          return { ok: flush, how: flush ? 'clamped' : 'drifted' }
        }
        const x = axis(c.wideEnough, c.x, g.paintW, g.frameW, h.dx)
        const y = axis(c.tallEnough, c.y, g.paintH, g.frameH, h.dy)
        return { ok: x.ok && y.ok, how: x.how + '/' + y.how, dx: h.dx, dy: h.dy }
      }

      check('the enlarged photo invites a click and no standalone zoom button survives', !!geo0 && geo0.cursor === 'zoom-in' && (await ev(`document.querySelectorAll('[data-lightbox-zoom]').length`)) === 0, { geo0 })
      // The rig must be serving photos with a real intrinsic size, or every painted-box measurement
      // below is derived from a broken image's zero and the letterbox maths is untested. Compared
      // against the declared size of the photo actually on screen — which may legitimately be square.
      const sel0 = await ev(SEL_IDX)
      const [w0, h0] = sizeOfPhoto(row(G.manyId).product_images[sel0].storage_path)
      check('the rig is painting real photos, so the letterbox maths is actually under test', !!geo0 && geo0.ratio === w0 / h0 && geo0.paintW > 0 && geo0.paintH > 0, { ratio: geo0 && geo0.ratio, served: w0 / h0, sel0 })

      // The anchoring rule, measured rather than asserted by reading the code: the picture coordinate
      // under the pointer must be the picture coordinate still under the pointer afterwards. Scaling
      // about an origin maps local `p` to `o + (p − o)·s + t`, so the clicked point is held exactly
      // when that expression returns where it started.
      const topLeft = await clickPhoto(0.25, 0.25)
      const zin = await ev(ZGEO)
      const hold = (g, click) => {
        const local = click.x - g.frameLeft
        const anchored = g.originX + (local - g.originX) * g.scale + g.tx
        const localY = click.y - g.frameTop
        const anchoredY = g.originY + (localY - g.originY) * g.scale + g.ty
        return { dx: anchored - local, dy: anchoredY - localY }
      }
      const heldTopLeft = hold(zin, topLeft)
      check('clicking the photo magnifies it in place at the point that was clicked', zin.zoomed === 'true' && Math.abs(zin.scale - G.zoomScale) < 0.01 && Math.abs(heldTopLeft.dx) < 2 && Math.abs(heldTopLeft.dy) < 2, { zin, heldTopLeft })
      check('the zoomed photo still covers its frame — no band of backdrop at the clicked edge', contained(zin), { gaps: coverGaps(zin) })
      check('the zoomed photo offers the zoom-out cursor', zin.cursor === 'zoom-out', { cursor: zin.cursor })
      check('the zoomed photo cannot make the page scroll sideways', zin.overflow <= 1, { overflow: zin.overflow })
      // A different corner has to produce a different anchor — a `scale()` with a fixed centre would
      // pass the check above just as well, which is precisely the defect this replaced.
      await clickPhoto(0.5, 0.5)
      const bottomRight = await clickPhoto(0.78, 0.72)
      const zin2 = await ev(ZGEO)
      const heldBottomRight = hold(zin2, bottomRight)
      check('a different point produces a different focal point, still anchored', zin2.zoomed === 'true' && Math.abs(zin2.originFX - zin.originFX) > 0.1 && Math.abs(zin2.originFY - zin.originFY) > 0.1 && Math.abs(heldBottomRight.dx) < 2 && Math.abs(heldBottomRight.dy) < 2, { before: [zin.originFX, zin.originFY], after: [zin2.originFX, zin2.originFY], heldBottomRight })

      // Pan: press, drag, and the translate part of the matrix follows the pointer while the scale
      // part stays pinned at the one magnification. Started near the anchor so every intermediate
      // lands on the photo itself, not on a floating control.
      const panFrom = anchorOf(zin2, 0.6, 0.6)
      await mouse('mouseMoved', panFrom.x, panFrom.y)
      await mouse('mousePressed', panFrom.x, panFrom.y, 1)
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', panFrom.x + 40 * i, panFrom.y + 20 * i, 1); await sleep(30) }
      const midPan = await ev(ZGEO)
      await mouse('mouseReleased', panFrom.x + 240, panFrom.y + 120)
      await sleep(60)
      const dragSettled = await ev(ZGEO)
      check('while zoomed the photo pans with the pointer and keeps its magnification', Math.abs(midPan.scale - G.zoomScale) < 0.01 && midPan.tx > 30 && midPan.ty > 10, { midPan })
      check('after the drag the photo stays where it was left (no snap-back)', dragSettled.zoomed === 'true' && dragSettled.tx === midPan.tx && dragSettled.ty === midPan.ty, { released: [dragSettled.tx, dragSettled.ty], moved: [midPan.tx, midPan.ty] })
      // The bound is what keeps the zoom inside the lightbox: dragging far past the edge stops at it
      // instead of dragging the photo (or the document) with it.
      await mouse('mouseMoved', panFrom.x, panFrom.y)
      await mouse('mousePressed', panFrom.x, panFrom.y, 1)
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', panFrom.x + 600 * i, panFrom.y + 400 * i, 1); await sleep(30) }
      const farPan = await ev(ZGEO)
      await mouse('mouseReleased', panFrom.x + 3600, panFrom.y + 2400)
      const further = await ev(ZGEO)
      const coverX = farPan.frameW * G.zoomScale >= farPan.frameW
      check('a drag past the edge stops at the photo\u2019s own bound instead of uncovering the frame', farPan.tx === further.tx && farPan.ty === further.ty && contained(farPan) && (!coverX || farPan.tx > 0) && farPan.overflow <= 1, { farPan, further, gaps: coverGaps(farPan) })

      // Zoom is a view, not a second modal: navigation and Escape must survive it, and a photo swap
      // must not carry the previous photo's magnification onto the next one.
      const selBeforeStep = await ev(SEL_IDX)
      await ev(ZFOCUS)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowRight', key: 'ArrowRight' })
      await waitFor(`(${SEL_IDX}) === ${(selBeforeStep + 1) % G.manyImages}`, 2500)
      await sleep(300) // let the swap's leave layer unmount before asking the current photo
      const afterStep = await ev(ZGEO)
      check('next while zoomed advances the shared selection and resets the zoom', !!afterStep && !afterStep.zoomed && afterStep.scale === 1 && Math.abs(afterStep.originFX - 0.5) < 0.01 && Math.abs(afterStep.originFY - 0.5) < 0.01 && (await ev(SEL_IDX)) === (selBeforeStep + 1) % G.manyImages, { afterStep, selBeforeStep })
      const again = await clickPhoto(0.4, 0.6)
      check('the photo zooms back in on demand', (await ev(ZGEO)).zoomed === 'true')
      await clickAt(again.x, again.y)
      await sleep(320)
      check('a second click returns the photo to the contained view', (await ev(ZGEO)).scale === 1 && (await ev(ZGEO)).zoomed === null)
      // The zoom is also a keyboard affordance: the control over the photo is a real button, and it is
      // the only way to magnify a detail without a pointer position to lend it.
      await ev('(() => { const b = document.querySelector(\'[data-lightbox] [data-lightbox-zoom-target]\'); if (b) b.focus(); return document.activeElement === b })()')
      await press('Enter', 'Enter', 13, '\r')
      await sleep(320) // the same 220ms entry the pointer path gets; read too early it is still at scale 1
      const keyedZoom = await ev(ZGEO)
      const keyedVisible = await ev('(() => { const b = document.querySelector(\'[data-lightbox] [data-lightbox-zoom-target]\'); return !!b && b === document.activeElement })()')
      check('Enter on the zoom control magnifies the middle of the picture and keeps focus there', keyedZoom.zoomed === 'true' && Math.abs(keyedZoom.scale - G.zoomScale) < 0.01 && Math.abs(keyedZoom.originFX - 0.5) < 0.01 && Math.abs(keyedZoom.originFY - 0.5) < 0.01 && keyedVisible === true, { keyedZoom, keyedVisible })
      await press('Enter', 'Enter', 13, '\r')
      check('Enter again returns it, so the keyboard path round-trips', (await ev(ZGEO)).zoomed === null)
      // Portrait, landscape and square: the same zoom asked of three different letters. The rig serves
      // each fixture photo at a known intrinsic size, so the ratio the app derives from the loaded
      // image can be checked against the ratio the file declares, and the anchoring and containment
      // rules are re-asked for every one of them — a `scale()` about the centre passes none of this.
      // The lightbox is wherever the checks above left it, so the sweep starts from the selection it
      // actually finds and takes each declared size from that index: assuming index 0 here compares a
      // portrait file's ratio against the landscape photo on screen and then waits out a full
      // `clickSelector` timeout per step.
      const startSel = await ev(SEL_IDX)
      const shapes = []
      for (let step = 0; step < G.manyImages; step++) {
        const sel = (startSel + step) % G.manyImages
        const before = await ev(ZGEO)
        if (step > 0) { await clickSelector('[data-lightbox-next]', `(${SEL_IDX}) === ${sel}`); await photoReady(); await sleep(320) }
        const fit = await ev(ZGEO)
        const file = String(row(G.manyId).product_images[sel].storage_path).split('/').pop()
        const [w, h] = sizeOfPhoto(file)
        const anchor = await clickPhoto(0.85, 0.12)
        const z = await ev(ZGEO)
        const held = anchoredOrCentred(z, anchor)
        shapes.push({
          sel, file, want: w / h > 1.05 ? 'landscape' : w / h < 0.95 ? 'portrait' : 'square',
          got: fit.ratio > 1.05 ? 'landscape' : fit.ratio < 0.95 ? 'portrait' : 'square',
          natural: Math.round(fit.ratio * 100) === Math.round((w / h) * 100),
          // A photo the frame cannot show at full width *and* full height must be letterboxed, which
          // is what makes the painted box differ from the element box.
          letterboxed: Math.abs(fit.paintW / fit.paintH - fit.ratio) < 0.02,
          anchored: held.ok, how: held.how, dx: +held.dx.toFixed(2), dy: +held.dy.toFixed(2),
          contained: contained(z),
          // The zoom must not survive the swap that got us here: each photo opens contained.
          resetOnSwap: !before.zoomed || step === 0
        })
        await clickAt(anchor.x, anchor.y)
        await sleep(320)
      }
      check('every fixture photo is painted at the size the rig served it', shapes.every(s => s.natural && s.letterboxed), shapes.map(s => [s.sel, s.file, s.natural, s.letterboxed]))
      check('the zoom anchors and stays contained on landscape, portrait and square photos', new Set(shapes.map(s => s.got)).size === 3 && shapes.every(s => s.anchored && s.contained && s.resetOnSwap), shapes)
      // Reduced motion keeps the magnification and the drag — the visitor's own hand moving the
      // photo is direct manipulation — and drops only the animated entry.
      await clickPhoto(0.5, 0.5)
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await sleep(120)
      const rmFrom = anchorOf(await ev(ZGEO), 0.5, 0.5)
      await mouse('mouseMoved', rmFrom.x, rmFrom.y)
      await mouse('mousePressed', rmFrom.x, rmFrom.y, 1)
      for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', rmFrom.x - 50 * i, rmFrom.y, 1); await sleep(30) }
      const rmPan = await ev(ZGEO)
      await mouse('mouseReleased', rmFrom.x - 200, rmFrom.y)
      check('under reduced motion the zoom arrives without a transition and still pans', !!rmPan && rmPan.zoomed === 'true' && rmPan.transition === '0s' && rmPan.tx < -50, rmPan && { scale: rmPan.scale, transition: rmPan.transition, tx: rmPan.tx })
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      await clickSelector(`${LB} [data-lightbox-close]`, `!document.querySelector(${JSON.stringify(LB)})`)
      await clickAt(zoomBox.x, zoomBox.y)
      await waitFor(`!!document.querySelector(${JSON.stringify(LB)} [data-lightbox-main])`)
      check('closing resets the zoom: reopening starts from the contained photo', !(await ev(ZGEO)).zoomed)
      await press('Escape', 'Escape', 27)
      await waitFor(`!document.querySelector(${JSON.stringify(LB)})`)
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

      // ---- a burst of clicks must settle on the latest photo, never stack layers ----
      const beforeBurst = await ev(SEL_IDX)
      const rb = (await ev(boxesExpr('[data-gallery-next]')))[0]
      await mouse('mouseMoved', rb.x, rb.y)
      await sleep(120)
      for (let i = 0; i < 3; i++) { await mouse('mousePressed', rb.x, rb.y, 1); await mouse('mouseReleased', rb.x, rb.y); await sleep(40) }
      await sleep(650)
      const settled = await ev('(() => { const t = document.querySelector(\'[data-gallery-thumb][data-selected]\'); return { sel: t ? +t.getAttribute(\'data-index\') : -1, layers: document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\').length, stuck: document.querySelectorAll(\'.gallery-next-leave-active, .gallery-previous-leave-active, .gallery-next-enter-active, .gallery-previous-enter-active\').length } })()')
      check('rapid next clicks wrap and settle on the latest photo with no stuck layers', settled.sel === (beforeBurst + 3) % G.manyImages && settled.layers === 1 && settled.stuck === 0, { beforeBurst, settled })

      // ---- reduced motion: the swap is softened, never frozen ----
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      const beforeReduce = await ev(SEL_IDX)
      const rbtn = (await ev(boxesExpr('[data-gallery-next]')))[0]
      await mouse('mouseMoved', rbtn.x, rbtn.y)
      await sleep(120)
      await mouse('mousePressed', rbtn.x, rbtn.y, 1)
      await mouse('mouseReleased', rbtn.x, rbtn.y)
      const midReduce = await ev('(() => { const is = [...document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\')]; return { layers: is.length, anims: is.reduce((n, i) => n + i.getAnimations().length, 0), travel: is.some(i => getComputedStyle(i).transform !== \'none\') } })()')
      await sleep(500)
      check('reduced motion still swaps with a real transition to the next photo', midReduce.layers >= 2 && (midReduce.anims >= 1 || midReduce.travel) && (await waitFor(`(${SEL_IDX}) === ${(beforeReduce + 1) % G.manyImages}`)) && (await ev('document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\').length')) === 1, { beforeReduce, midReduce })
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    }

    await nav(detailUrl(G.twoId))
    await waitFor('!!document.querySelector(\'[data-gallery-strip]\')')
    const twoWindow = await winJson()
    check('two-photo product shows both thumbs unwindowed', twoWindow === JSON.stringify([0, 1]), { twoWindow })
    const t1box = (await ev(boxesExpr(`${THUMB}[data-index="1"]`)))[0]
    await clickAt(t1box.x, t1box.y)
    const twoAnims = await ev('(() => { const s = document.querySelector(\'[data-gallery-strip]\'); return s ? s.getAnimations().length : -1 })()')
    check('small sets do not slide: the strip stays put on selection', (await waitFor(`(${SEL_IDX}) === 1`)) && (await winJson()) === JSON.stringify([0, 1]) && twoAnims === 0, { twoAnims })
    await clickSelector('[data-gallery-next]', `(${SEL_IDX}) === 0`)
    check('two-photo arrows wrap', await waitFor(`(${SEL_IDX}) === 0`))

    await nav(detailUrl(G.singleId))
    await waitFor('!!document.querySelector(\'[data-product-gallery]\')')
    check('one-photo product shows no strip, no arrows, and its photo', !(await ev('!!document.querySelector(\'[data-gallery-strip]\')')) && !(await ev('!!document.querySelector(\'[data-gallery-prev]\')')) && !!(await ev(MAIN_SRC)))

    await metrics(390, 844, true)
    await nav(detailUrl(G.manyId))
    await waitFor(`document.querySelectorAll('${THUMB}').length === ${G.window}`)
    await sleep(300)
    check('mobile gallery does not overflow horizontally', (await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    const mNext = (await ev(boxesExpr('[data-gallery-next]')))[0]
    await clickAt(mNext.x, mNext.y)
    check('touch taps reach the gallery arrows without hovering', await waitFor(`(${SEL_IDX}) === 1`))
    // ---- swipe to cycle the inline photo ----------------------------------------------------
    // A leftward flick advances, a rightward one takes it back — and the pair leaves the selection
    // where the checks below expect it. `touch-action: pan-y` on the button is what lets the
    // horizontal axis reach the app while the page keeps the vertical one.
    const cyc = (await ev(boxesExpr('[data-gallery-zoom]')))[0]
    const flick = async (fromX, toX) => {
      await touch('touchStart', [{ x: fromX, y: cyc.y }])
      for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: fromX + ((toX - fromX) * i) / 5, y: cyc.y }]); await sleep(30) }
      await touch('touchEnd', [])
    }
    await flick(cyc.x + 30, cyc.x - 70)
    check('a leftward swipe on the photo advances it', await waitFor(`(${SEL_IDX}) === 2`, 2500), { idx: await ev(SEL_IDX) })
    await flick(cyc.x - 30, cyc.x + 70)
    check('a rightward swipe takes it back', await waitFor(`(${SEL_IDX}) === 1`, 2500), { idx: await ev(SEL_IDX) })
    // The finger-follow must not be left on the page, and the click that trails a drag is the end of
    // a gesture rather than an intent to enlarge — the same guard the lightbox pan carries.
    check('the photo settles back to no offset after a swipe', await ev('(() => { const b = document.querySelector("[data-gallery-zoom]"); if (!b) return false; const t = getComputedStyle(b).transform; if (t === "none" || t === "") return true; const m = new DOMMatrixReadOnly(t); return Math.abs(m.f) <= 1 })()'))
    check('the trailing click of a swipe does not open the lightbox', await ev(`!document.querySelector(${JSON.stringify(LB)})`))
    const mZoom = (await ev(boxesExpr('[data-gallery-zoom]')))[0]
    await clickAt(mZoom.x, mZoom.y)
    const mOpen = await waitFor(`!!document.querySelector(${JSON.stringify(LB)})`)
    const mFit = await ev('(() => { const d = document.querySelector(\'[data-lightbox-main]\'); if (!d) return null; const r = d.getBoundingClientRect(); return { fits: r.left >= -1 && r.right <= innerWidth + 1 && r.width >= innerWidth * 0.7, w: Math.round(r.width) } })()')
    check('lightbox on touch: opens from the photo and fills the viewport without overflow', mOpen && !!mFit && mFit.fits, { mFit })
    check('no horizontal overflow with the lightbox open @390', (await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    // Touch zoom + pan: a tap on the enlarged photo magnifies it in place, a finger drag translates
    // the magnified photo inside its own bounds — the page never scrolls sideways because of it, which
    // is the same overflow number re-read, now mid-zoom — and a second tap without a drag returns it.
    // There is no zoom control to aim at any more, which is the point of the first check.
    const MTAP = '[data-lightbox] [data-lightbox-main]'
    // Taps are aimed at the middle of the *frame*, not of the photo: while magnified the photo's own
    // rect hangs outside the viewport, and a touch point sent below the fold is silently dropped —
    // which reads exactly like a tap that the app ignored. The pan clamp guarantees the picture still
    // covers the frame, so this point is always on the picture.
    // A tap is held for ~70ms, because a real finger is, and the control logs the events it is handed.
    const tapAt = async (x, y) => { await touch('touchStart', [{ x, y }]); await sleep(70); await touch('touchEnd', []); await sleep(320) }
    const zlog = '(() => { const b = document.querySelector(\'[data-lightbox] [data-lightbox-zoom-target]\'); if (!b) return null; window.__Z = []; for (const ty of [\'pointerdown\', \'pointerup\', \'click\']) b.addEventListener(ty, e => window.__Z.push(ty + \'@\' + Math.round(e.clientX) + \',\' + Math.round(e.clientY) + \' d\' + e.detail)); return true })()'
    await ev(zlog)
    const zlen = () => ev('(window.__Z || []).length')
    // The tap a zoom gesture needs, delivered as faithfully as the platform allows, and logged so the
    // run says which gesture proved the rule. A touch tap that *starts* a zoom has always arrived as a
    // click here; a tap that *follows a touch pan* has not, on this runner, reliably: two CI runs gave
    // `pointerdown` + `pointerup` and no click at all, the next gave `click d1` at the same point with
    // the same timings. Blink owning that decision means the check would be intermittently red for a
    // reason no line of app code can fix, so: try the touch tap, and when the platform offered pointer
    // events but no click, press and release the same point as a mouse pair. `how` is printed either way.
    const tapOnPhoto = async (x, y) => {
      const from = await zlen()
      await tapAt(x, y)
      let log = (await ev('window.__Z || []')).slice(from)
      let how = 'touch'
      if (!log.some(e => e.startsWith('click@'))) { await clickAt(x, y); log = log.concat((await ev('window.__Z || []')).slice(from + log.length)); how = 'touch-then-mouse' }
      return { how, log }
    }
    const zoomedNow = () => ev('(() => { const ls = [...document.querySelectorAll(\'[data-lightbox] [data-lightbox-main]\')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; return i && i.getAttribute("data-zoomed") === "true" })()')
    check('the lightbox photo itself takes the tap, with no standalone zoom control left', (await ev('document.querySelectorAll(\'[data-lightbox-zoom]\').length')) === 0 && await ev(`!!document.querySelector('${MTAP}')`))
    await tapOnPhoto(195, 300)
    check('a tap on the photo magnifies it in place on touch', await zoomedNow())
    await touch('touchStart', [{ x: 195, y: 420 }])
    for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: 195 - 30 * i, y: 420 }]); await sleep(30) }
    const mPan = await ev('(() => { const ls = [...document.querySelectorAll(\'[data-lightbox] [data-lightbox-main]\')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; const t = getComputedStyle(i).transform; const m = /matrix\\(([^)]+)\\)/.exec(t); return { tx: m ? +m[1].split(",")[4] : 0, zoomed: i.getAttribute("data-zoomed"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    await touch('touchEnd', [])
    await sleep(300)
    check('a finger drag pans the zoomed photo without moving the page', mPan.zoomed === 'true' && mPan.tx < -40 && mPan.overflow <= 1, { mPan })
    // The reset tap lands away from the drag's own points anyway — the gesture a visitor makes is a
    // lift, a move, and a press somewhere else — and `dragged` in `ProductGallery` is what keeps a
    // release that *does* trail a click (the mouse path, asserted by `dragSettled.zoomed` above) from
    // reading as a zoom-out.
    const reset = await tapOnPhoto(300, 200)
    check('a second tap, with no drag behind it, returns the photo to the contained view', (await zoomedNow()) === false, { reset })
    // The drag must not be mistaken for navigation, and navigation must not be lost to the drag: the
    // arrows live outside the photo, so they answer a tap while it is magnified.
    const armed = await tapOnPhoto(195, 420)
    // Ask before assuming the photo is magnified here: an arm that silently failed would let the
    // navigation check pass while testing nothing.
    const armedForNav = await zoomedNow()
    const selBeforeNav = await ev(SEL_IDX)
    const mLbNext = (await ev(boxesExpr('[data-lightbox-next]')))[0]
    await clickAt(mLbNext.x, mLbNext.y)
    await sleep(200)
    check('the arrow still navigates while the photo is magnified, and the swap resets the zoom', armedForNav === true && (await ev(SEL_IDX)) === (selBeforeNav + 1) % G.manyImages && !(await zoomedNow()), { armedForNav, armed: armed.how, selBeforeNav })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
    check('Escape closes the lightbox on mobile too', await waitFor(`!document.querySelector(${JSON.stringify(LB)})`))
    // ---- thumb-reach exits from the phone lightbox -----------------------------------------------
    // The close control sits bottom-centre under the photo, not in the far top corner, and a
    // vertical swipe on the contained photo dismisses. A short, slow pull must snap back without
    // closing AND without its trailing click reading as a zoom — the same gesture the pan tests
    // proved the overlay can keep honest.
    await clickAt(mZoom.x, mZoom.y)
    await waitFor(`!!document.querySelector(${JSON.stringify(LB)})`)
    await sleep(300)
    const lbCloseGeo = await ev('(() => { const b = document.querySelector(\'[data-lightbox-close]\'); if (!b) return null; const r = b.getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), top: Math.round(r.top), gapToBottom: Math.round(innerHeight - r.bottom), vw: innerWidth, vh: innerHeight } })()')
    check('the lightbox close sits bottom-centre within thumb reach', !!lbCloseGeo && Math.abs(lbCloseGeo.cx - lbCloseGeo.vw / 2) < 4 && lbCloseGeo.top > lbCloseGeo.vh * 0.75 && lbCloseGeo.gapToBottom < 48, { lbCloseGeo })
    // The swap's own axis: a leftward flick on the contained photo advances it, a rightward one
    // takes it back — the gesture the inline photo accepts, in the same direction and on the same
    // gates. The photo must settle to rest after each, neither flick may read as a zoom, and a
    // cycle is not an exit — the lightbox stays open.
    const lbFlick = async (fromX, toX) => {
      await touch('touchStart', [{ x: fromX, y: 420 }])
      for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: fromX + ((toX - fromX) * i) / 5, y: 420 }]); await sleep(30) }
      await touch('touchEnd', [])
    }
    const beforeCycle = await ev(SEL_IDX)
    await lbFlick(225, 125)
    check('a leftward swipe on the enlarged photo advances it', await waitFor(`(${SEL_IDX}) === ${(beforeCycle + 1) % G.manyImages}`, 2500), { from: beforeCycle, idx: await ev(SEL_IDX) })
    await sleep(320)
    const cycleRest = await ev('(() => { const lb = document.querySelector(\'[data-lightbox]\'); const i = lb && lb.querySelector(\'[data-lightbox-main]\'); const t = i ? getComputedStyle(i).transform : null; return { open: !!lb, zoomed: !!i && i.getAttribute(\'data-zoomed\') === \'true\', rest: t === null ? null : (t === "none" || Math.abs(new DOMMatrixReadOnly(t).e) <= 1) } })()')
    check('the cycle leaves the photo at rest, unzoomed, inside the open lightbox', cycleRest.open === true && cycleRest.zoomed === false && cycleRest.rest === true, { cycleRest })
    await lbFlick(165, 265)
    check('a rightward swipe on the enlarged photo takes it back', await waitFor(`(${SEL_IDX}) === ${beforeCycle}`, 2500), { idx: await ev(SEL_IDX) })
    await sleep(320)
    const swipeFrom = { x: 195, y: 420 }
    await touch('touchStart', [swipeFrom])
    for (let i = 1; i <= 3; i++) { await touch('touchMove', [{ x: swipeFrom.x, y: swipeFrom.y + i * 12 }]); await sleep(80) }
    await touch('touchEnd', [])
    await sleep(320)
    const shortPull = await ev('(() => { const lb = document.querySelector(\'[data-lightbox]\'); const i = document.querySelector(\'[data-lightbox] [data-lightbox-main]\'); return { open: !!lb, zoomed: !!i && i.getAttribute(\'data-zoomed\') === \'true\', tr: i ? getComputedStyle(i).transform : null } })()')
    check('a short slow pull on the photo snaps it back without closing or zooming', shortPull.open === true && shortPull.zoomed === false && shortPull.tr === 'none', { shortPull })
    await touch('touchStart', [swipeFrom])
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: swipeFrom.x, y: swipeFrom.y + i * 28 }]); await sleep(30) }
    await touch('touchEnd', [])
    check('swiping the photo down closes the lightbox', await waitFor(`!document.querySelector(${JSON.stringify(LB)})`))
    check('the swipe hands focus back to the photo button', await ev('(() => { const el = document.activeElement; return !!el && el.getAttribute("data-gallery-zoom") !== null })()'))
    await sleep(300)
    await clickAt(mZoom.x, mZoom.y)
    await waitFor(`!!document.querySelector(${JSON.stringify(LB)})`)
    await sleep(300)
    await touch('touchStart', [swipeFrom])
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: swipeFrom.x, y: swipeFrom.y - i * 28 }]); await sleep(30) }
    await touch('touchEnd', [])
    check('swiping the photo up closes it too', await waitFor(`!document.querySelector(${JSON.stringify(LB)})`))
    await sleep(300)
    await metrics(1440, 900, false)

    // ---- product-detail header search: one lazy catalog fetch per visit, filtered locally ----
    const SB = '[data-catalog-search]'
    const SB_INPUT = `${SB} input`
    const productsReads = async () => (await allW()).filter(w => w.method === 'GET' && w.p === '/api/catalog/products').length

    await nav(detailUrl(G.manyId))
    await waitFor(`!!document.querySelector(${JSON.stringify(SB_INPUT)})`)
    const sb = (await ev(boxesExpr(SB_INPUT)))[0]
    await clickAt(sb.x, sb.y)
    await cdp.send('Input.insertText', { text: 'mouse' })
    check('detail search filters the catalog locally', await waitFor(`document.querySelectorAll(${JSON.stringify(`${SB} a[href^="/products/"]`)}).length === 1 && document.body.textContent.includes('Verify Mouse')`))
    await clickByText(`${SB} a`, 'Verify Mouse', pathnameIs(G.twoId))
    check('search result navigates to that product', await waitFor(pathnameIs(G.twoId)) && await waitFor(`(document.querySelector('main h1')?.textContent || '').trim() === 'Verify Mouse'`))

    await nav(detailUrl(G.manyId))
    await waitFor(`!!document.querySelector(${JSON.stringify(SB_INPUT)})`)
    await clickAt(sb.x, sb.y)
    await cdp.send('Input.insertText', { text: 'zzzqqq' })
    const emptyShown = await waitFor(`document.querySelector(${JSON.stringify(`${SB} p`)})?.textContent?.includes('No products match this view.')`)
    const readsAfterFirst = await productsReads()
    await sleep(450)
    check('no keystroke queries: reads stay put while typing', emptyShown && (await productsReads()) === readsAfterFirst, { readsAfterFirst })
    // The detail box had the visibility rule first (`v-if` on the query) and keeps it, on the same trim
    // test as the other two: text in the box, ✕ in the box; ✕ pressed, box empty and ✕ gone.
    const sbClear = (await ev(boxesExpr(`${SB} [data-search-clear]`)))[0]
    check('the detail box shows its clear ✕ while the query has text', !!sbClear, { text: await ev(`document.querySelector(${JSON.stringify(SB_INPUT)}).value`) })
    await clickAt(sbClear.x, sbClear.y)
    check('pressing it empties the detail box and retires the ✕', await waitFor(`!document.querySelector(${JSON.stringify(`${SB} [data-search-clear]`)}) && document.querySelector(${JSON.stringify(SB_INPUT)}).value === ''`))
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
    check('Escape closes the search popover', await waitFor(`!document.querySelector(${JSON.stringify(`${SB} ul`)})`))
    await clickAt(sb.x, sb.y)
    await sleep(350)
    check('refocus reuses the loaded catalog (one fetch per visit)', (await productsReads()) === readsAfterFirst)
    await cdp.send('Input.insertText', { text: 'controller' })
    await waitFor(`!!document.querySelector(${JSON.stringify(`${SB} ul a`)})`)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter' })
    check('Enter selects the first search result', await waitFor(pathnameIs(G.controllerId)) && await waitFor(`(document.querySelector('main h1')?.textContent || '').trim() === 'Verify Controller'`))

    // ============================== PRODUCT CONVERSION (Phase 1) ==============================
    // Everything below runs against the mounted feature on the real product page — the two new
    // components are only in the build graph because `[id].vue` composes them, which is the point:
    // a check that reached them only through an isolated mount would prove nothing about the page.
    const C = EXP.conversion
    const canonical = id => new URL('/products/' + id, appUrl).href
    // A missing mount must read as a failed check, not as a TypeError that aborts the run: these
    // defaults are the shape of "nothing rendered", so every assertion below still gets a value.
    const NO_MOUNT = { where: null, visible: false, tag: null, type: null, ctaText: null, expanded: null, controls: null, panelOpen: false, panelLabel: null, panelControls: null, message: '', feedback: null, live: null, role: null, labelFor: null, fieldId: null, labelText: null, shareTag: null, channels: [] }
    const inlineMount = async () => (await mounts()).find(m => m.where === 'inline') || { ...NO_MOUNT }
    const stickyMount = async () => (await mounts()).find(m => m.where === 'sticky') || { ...NO_MOUNT }
    // The prepared message, its label and the channel list only exist while the panel is open, so
    // anything that asserts them opens the panel first. A probe that reads them shut is measuring
    // its own timing, not the page.
    const openInlinePanel = async () => {
      if (!await ev('!!document.querySelector("[data-product-actions] [data-contact-panel]")')) await clickSelector('[data-contact-cta]', '!!document.querySelector(\'[data-contact-panel]\')')
      return await inlineMount()
    }

    await nav(detailUrl(G.manyId))
    if (!await waitFor('!!document.querySelector(\'[data-contact-cta]\')')) check('the product page mounts the conversion feature', false)
    const mounted = await mounts()
    check('the conversion feature mounts on the product page', !!mounted.find(m => m.where === 'inline'), { mounts: mounted.map(m => m.where) })
    check('the conversion block composes after the product information and specifications', await ev('(() => { const dl = document.querySelector("main dl"); const act = document.querySelectorAll("[data-product-actions]")[0]; return !!dl && !!act && !!(dl.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING) })()'))

    // A primary action must be a button: the requirement outlives the implementation.
    const first = mounted.find(m => m.where === 'inline') || { ...NO_MOUNT }
    check('the contact action is a real button with an accessible name, not a clickable div', first.tag === 'BUTTON' && first.type === 'button' && first.ctaText === C.cta.in, { tag: first.tag, type: first.type, text: first.ctaText })
    check('the confirmation region is a polite status live region', first.live === 'polite' && first.role === 'status', { live: first.live, role: first.role })

    // In stock: the order action, and the message assembled from the product the page is about.
    const wantIn = expectedMessage(row(G.manyId), C.ask.in, canonical(G.manyId))
    const opened = await openInlinePanel()
    check('the CTA opens the channel panel and announces that it did', opened.expanded === 'true' && opened.panelOpen && opened.controls === opened.panelControls, { expanded: opened.expanded, controls: opened.controls, panelId: opened.panelControls })
    // A scroll region the keyboard cannot reach is a defect, not a style choice, and on a desktop
    // there is room to show the whole list — so no inner scroll should be needed at this width.
    check('the panel is keyboard-focusable and shows every channel on a desktop without an inner scroll', opened.panelTabbable && opened.panelOverflow <= 1, { tabbable: opened.panelTabbable, overflow: opened.panelOverflow })
    check('an in-stock product offers the order action and a five-line message built from the product', opened.ctaText === C.cta.in && opened.message === wantIn && opened.message.split('\n').length === C.lines.length, { cta: opened.ctaText, message: norm(opened.message) })
    check('the message field is a textarea associated with its own label', !!opened.labelFor && opened.labelFor === opened.fieldId && !!opened.labelText, { labelFor: opened.labelFor, fieldId: opened.fieldId, labelText: opened.labelText })

    // The contact list is the shop's `contact_enabled` rows and nothing else. The seeded set is a
    // three-case probe on purpose: facebook is visible but not contactable, telegram carries no
    // `contact_enabled` key at all (an old row, which must inherit `enabled` and survive), and
    // tiktok is hidden from the header yet contactable. If either flag is used to answer the other's
    // question, the order or the membership below stops matching. `{message}` is filled with this
    // product's own encoded message, so a prefill that carried someone else's text would fail too.
    const wantHrefs = C.channelHrefs.map(href => href.replace('{message}', encodeURIComponent(wantIn)))
    const hrefsOf = m => m.channels.map(c => c.href)
    check('the contact list is exactly the contact_enabled rows, in stored order', JSON.stringify(hrefsOf(opened)) === JSON.stringify(wantHrefs), { hrefs: hrefsOf(opened).map(h => h.slice(0, 60)), want: wantHrefs.map(h => h.slice(0, 60)) })
    check('visible-but-not-contactable is withheld and hidden-but-contactable is offered', !hrefsOf(opened).some(h => h.includes('facebook.com')) && hrefsOf(opened).some(h => h.includes('t.me/raccoongearbin')))
    check('only the documented platforms carry the message; the rest keep their stored URL byte-for-byte', JSON.stringify(opened.channels.map(c => c.prefilled)) === JSON.stringify(C.channelsPrefilled) && hrefsOf(opened)[2] === 'https://tiktok.com/@raccoongearbin.hidden', { prefilled: opened.channels.map(c => c.prefilled), tiktok: hrefsOf(opened)[2] })
    check('the phone channel shows the stored number and web channels are named by platform', opened.channels[0].text.includes(EXP.siteInfo.phoneText) && opened.channels.slice(1).every((c, i) => c.text.trim().startsWith(C.channelLabels[i + 1])), { texts: opened.channels.map(c => c.text) })
    check('each web row says what it does, so no channel implies a paste it did not make', opened.channels.slice(1).every(c => c.text.includes(c.prefilled ? C.claimPrefilled : C.claimCopy)), opened.channels.map(c => c.text))
    // The marks come from the one source the masthead uses: exactly one svg per row, a known
    // platform a single filled path — and the path must actually paint most of the frame. The
    // header learned the hard way that a truncated path still yields an element with a fill, so
    // existence and attributes alone prove nothing about what the visitor sees.
    check('a known platform is marked by the shared brand mark, one filled path that paints', opened.channels.slice(1).every(c => c.svgs === 1 && c.paths === 1 && c.fill === 'currentColor' && c.ink[0] >= 12 && c.ink[1] >= 12), opened.channels.map(c => [c.svgs, c.paths, c.fill, c.ink]))
    check('a web channel opens in a new tab with a safe rel, the phone stays a plain link', opened.channels.slice(1).every(c => c.target === '_blank' && /noopener/.test(c.rel || '') && /noreferrer/.test(c.rel || '')) && opened.channels[0].target === null, opened.channels.map(c => [c.target, c.rel]))

    // WhatsApp's documented prefill and an unknown platform are not in the seeded rows, so the
    // stub's own collection is extended for one navigation. The app reads them through the same
    // REST path as everything else, which is what makes this an integration check rather than a
    // unit test of the rule — and the unknown platform is the case that a guessed `?text=` would
    // have passed happily while shipping an empty chat box to a real customer.
    const extraScript = await forNextDocument('window.__SITE.social_links.push({ platform: "whatsapp", url: "https://wa.me/85512345678", enabled: false, contact_enabled: true, sort_order: 5 }, { platform: "thelifeofpw", url: "https://store.example.test/handmade", enabled: false, contact_enabled: true, sort_order: 6 });')
    await nav(detailUrl(G.manyId))
    const extra = await openInlinePanel()
    const waRow = extra.channels.find(c => c.href.includes('wa.me'))
    const oddRow = extra.channels.find(c => c.href.includes('store.example.test'))
    check('WhatsApp prefills through the documented wa.me form with the exact message', !!waRow && waRow.href === `https://wa.me/85512345678?text=${encodeURIComponent(wantIn)}` && waRow.prefilled === true, { wa: waRow && waRow.href.slice(0, 70) })
    check('an unknown platform keeps its stored URL and the drawn globe, never a guessed parameter', !!oddRow && oddRow.href === 'https://store.example.test/handmade' && oddRow.prefilled === false && oddRow.svgs === 1 && oddRow.paths === 2 && oddRow.fill === 'none', { odd: oddRow && { href: oddRow.href, prefilled: oddRow.prefilled, paths: oddRow.paths, fill: oddRow.fill } })
    await stopForNextDocument(extraScript)

    // The determinism rule: leaving for a channel must not leave a "copied" claim behind. The
    // capture listener cancels only the navigation, so the app's own click path still runs.
    await holdChannelLinks()
    await armClipboard('ok')
    // Bring the row into the viewport before measuring it: the panel hangs under a long summary
    // column, and a click aimed below the fold is silently dropped — which looks exactly like a
    // handler that never ran.
    await ev('(() => { const links = document.querySelectorAll("[data-contact-panel] [data-contact-channel]"); if (links[1]) links[1].scrollIntoView({ block: "center" }); return true })()')
    await sleep(300)
    const channelBox = (await ev(boxesExpr('[data-contact-panel] [data-contact-channel]')))[1]
    await clickAt(channelBox.x, channelBox.y)
    await sleep(300)
    const afterChannel = await inlineMount()
    const blocked = await ev('window.__BLOCKED')
    check('tapping a channel does not pretend the message was copied', blocked >= 1 && (await copies()).length === 0 && afterChannel.feedback === '', { blocked, copies: await copies(), feedback: afterChannel.feedback, clicked: channelBox })

    // ---- the copy is claimed only when it actually happened -------------------------------------
    // Each case has to start from a silent region, or the previous case's sentence would satisfy
    // the wait expression before the click ever landed. Waiting it out is also the only way to prove
    // the confirmation clears itself.
    const expectFeedback = value => '((document.querySelectorAll("[data-product-actions]")[0].querySelector("[data-contact-feedback]") || {}).textContent || "").trim() === ' + value
    const cleared = expectFeedback('""')
    const clearFeedback = async () => await waitFor(cleared, 7000)
    const HEAD = '(() => { const map = {}; for (const m of document.querySelectorAll("meta")) { const k = m.getAttribute("property") || m.getAttribute("name"); if (k) map[k] = m.getAttribute("content"); } const l = document.querySelector("link[rel=canonical]"); return { title: document.title, canonical: l ? l.getAttribute("href") : null, desc: map.description || null, ogType: map["og:type"] || null, ogSite: map["og:site_name"] || null, ogTitle: map["og:title"] || null, ogDesc: map["og:description"] || null, ogUrl: map["og:url"] || null, ogImage: map["og:image"] || null, ogImageAlt: map["og:image:alt"] || null } })()'

    await armClipboard('ok')
    await clickSelector('[data-copy-message]', expectFeedback(JSON.stringify(C.feedback.copied)))
    const okCopies = await copies()
    check('a successful copy writes the exact message and only then says so', okCopies.length === 1 && okCopies[0] === wantIn && (await inlineMount()).feedback === C.feedback.copied, { copied: norm(okCopies[0] || ''), feedback: (await inlineMount()).feedback })
    check('a copy that worked does not clutter the block with a manual fallback', !(await inlineMount()).shareLink, { shareLink: (await inlineMount()).shareLink })

    await armClipboard('missing')
    await clickSelector('[data-copy-message]', expectFeedback(JSON.stringify(C.feedback.blocked)))
    const refused = await inlineMount()
    check('an unavailable clipboard is reported as a failure, never as copied', (await copies()).length === 0 && refused.feedback === C.feedback.blocked && refused.feedback !== C.feedback.copied, { feedback: refused.feedback })
    check('a refused clipboard still leaves the whole message on screen to select by hand', refused.message === wantIn && refused.message.length > 40, { length: (refused.message || '').length })
    // The sentence tells the visitor to copy the link themselves. Before this existed, that
    // instruction pointed at nothing: the canonical address lived only inside the message field,
    // behind a panel that the failed copy did not open.
    check('and it puts the link on screen that the failure message asks them to copy', refused.shareLink === canonical(G.manyId) && refused.readonly === true, { shareLink: refused.shareLink, readonly: refused.readonly })

    check('the confirmation clears itself', await waitFor(cleared, 7000))
    await armClipboard('reject')
    await clickSelector('[data-copy-message]', expectFeedback(JSON.stringify(C.feedback.blocked)))
    const rejected = await inlineMount()
    check('a clipboard write that rejects is reported as a failure, not a success', (await copies()).length === 0 && rejected.feedback === C.feedback.blocked, { feedback: rejected.feedback, copies: await copies() })

    // ---- the Contact panel's enter and leave -------------------------------------------------
    // The panel used to appear with nothing but a colour change and a spinning chevron. These record
    // every frame of the flight rather than sampling at one guessed moment: a class that lives for
    // 200ms is exactly what a settle-only check cannot see, and a single read taken too early lands on
    // the frame *before* Vue attached the transition to the element (which reports `all 0s`) — the
    // probe below is that lesson, written down.
    const ctaBoxExpr = '(() => { const el = document.querySelector("[data-product-actions] [data-contact-cta]"); el.scrollIntoView({ block: "center", inline: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'
    const panelGone = '!document.querySelector(\'[data-contact-panel]\')'
    const START_FLIGHT = '(() => { window.__F = []; window.__Fdone = false; const t0 = performance.now(); const tick = function () { const p = document.querySelector("[data-contact-panel]"); if (p) { const c = getComputedStyle(p); const sc = c.transform === "none" ? 1 : +new DOMMatrixReadOnly(c.transform).a.toFixed(3); window.__F.push({ tr: c.transform, op: +c.opacity, tp: c.transitionProperty, sc }); } if (performance.now() - t0 < 720) requestAnimationFrame(tick); else window.__Fdone = true; }; requestAnimationFrame(tick); return true })()'
    const travelled = f => f.some(s => s.tr !== 'none' && s.tr !== '')
    const faded = f => f.some(s => s.op < 1)
    const namedTransform = f => f.some(s => /transform/.test(s.tp))
    const namedOpacity = f => f.some(s => /opacity/.test(s.tp))

    await press('Escape', 'Escape', 27)
    await waitFor(panelGone)
    // `scroll-behavior: smooth` is the trap here: `scrollIntoView` starts an animation, so a rect read
    // in the same breath is a point the button is about to leave. Scroll, wait, re-measure, then start
    // recording and click — and the button's own position also moves when the panel opens, because the
    // sticky column grows with it.
    const settleOnCta = async () => { await ev(ctaBoxExpr); await sleep(500); return await ev(ctaBoxExpr) }
    const flight = async () => { const box = await settleOnCta(); await ev(START_FLIGHT); await clickAt(box.x, box.y); await waitFor('!!window.__Fdone', 4000); return await ev('window.__F || []') }
    // A reveal/return glide is still running after a panel's transform settles, and the geometry
    // checks that use this read viewport rects: two level reads in a row is the cheapest way to say
    // "the page has stopped". The bound is a smooth scroll's own duration plus slack.
    const waitScrollStill = async () => {
      await ev('window.__SY = null')
      return await waitFor('(() => { const y = Math.round(window.scrollY); const ok = y === window.__SY; window.__SY = y; return ok })()', 4000)
    }
    const enter = await flight()
    check('the panel enters through a Motion transform morph that actually runs and settles full-size', enter.length >= 3 && travelled(enter) && faded(enter) && enter[enter.length - 1].op === 1 && enter[enter.length - 1].sc >= 0.99, { frames: enter.length, first: enter[0], middle: enter[Math.floor(enter.length / 2)], last: enter[enter.length - 1] })
    const leave = await flight()
    check('the panel leaves through the same morph rather than popping out', leave.length >= 3 && travelled(leave) && faded(leave), { frames: leave.length, first: leave[0] })
    await waitFor(panelGone)
    // The pop's contract is painted, not textual. Phase H replaced the FLIP-onto-the-button with an
    // in-place Apple bloom, so the assertion is no longer "the panel lands on the CTA rect" but "the
    // panel really blooms: some frame is scaled below full size, and it settles back to identity."
    // A fade-only regression — the transform never applied — keeps every frame at scale 1.
    const START_RECTS = '(() => { window.__R = []; window.__Rdone = false; const t0 = performance.now(); const tick = function () { const p = document.querySelector("[data-contact-panel]"); if (p) { const c = document.querySelector("[data-product-actions] [data-contact-cta]"); if (c) { const pr = p.getBoundingClientRect(); const br = c.getBoundingClientRect(); window.__R.push({ pt: pr.top, pl: pr.left, pw: pr.width, ph: pr.height, bt: br.top, bl: br.left, bw: br.width, bh: br.height, ct: getComputedStyle(p).transform }); } } if (performance.now() - t0 < 720) requestAnimationFrame(tick); else window.__Rdone = true; }; requestAnimationFrame(tick); return true })()'
    const bloomed = f => f.some(s => { const m = /^matrix\(([\d.-]+)/.exec(s.ct || ''); return !!m && Number(m[1]) > 0 && Number(m[1]) < 0.98 })
    // The genie: on the way out the desktop panel flattens onto its own CTA's box, so some frame must
    // be scaled by a different amount on each axis. Read from the matrix's two scale terms and compare
    // them absolutely — this panel is 518×517 over a 199×44 button, so it goes flat (scaleY < scaleX),
    // and a signed comparison would encode whichever surface was written first. `bloomed` looks at m11
    // only and stays green for a uniform shrink, which is the point of the enter and the defect on a
    // leave.
    const scalePair = s => { const m = /^matrix\(([-\d.]+), [-\d.]+, [-\d.]+, ([-\d.]+)/.exec(s.ct || ''); return m ? [Number(m[1]), Number(m[2])] : null }
    const collapsedIntoTrigger = f => f.some(s => { const [a, d] = scalePair(s) || []; return a != null && a < 0.75 && Math.abs(d - a) > 0.05 })
    const rectsFlight = async () => { const box = await settleOnCta(); await ev(START_RECTS); await clickAt(box.x, box.y); await waitFor('!!window.__Rdone', 4000); return await ev('window.__R || []') }
    const enterR = await rectsFlight()
    check('the panel pops open from a real sub-full-size bloom (not a fade)', enterR.length > 3 && bloomed(enterR), { first: enterR[0], scales: enterR.slice(0, 4).map(s => s.ct) })
    const leaveR = await rectsFlight()
    check('the panel pops closed through the same bloom, collapsing into its trigger corner', leaveR.length > 3 && bloomed(leaveR) && collapsedIntoTrigger(leaveR), { frames: leaveR.length, last: leaveR[leaveR.length - 1], collapsed: collapsedIntoTrigger(leaveR) })
    await waitFor(panelGone)
    // Interrupting the enter is the regression this path was built for: closing mid-flight used
    // to measure through the half-finished transform, compounding two inverses and landing the
    // exit at an arbitrary scale. Escape (not a re-click, which a reveal-scroll could move out
    // from under) interrupts at 140ms of the enter; the exit must still play the pop out.
    {
      const box = await settleOnCta()
      await ev(START_RECTS)
      await clickAt(box.x, box.y)
      await sleep(140)
      await press('Escape', 'Escape', 27)
      await waitFor('!!window.__Rdone', 4000)
      const interrupted = await ev('window.__R || []')
      check('a close that interrupts the enter still plays the pop out', interrupted.length > 4 && bloomed(interrupted), { frames: interrupted.length, last: interrupted[interrupted.length - 1] })
      await waitFor(panelGone)
      const reopened = await rectsFlight()
      check('and the panel still blooms after an interrupted cycle', reopened.length > 3 && bloomed(reopened), { first: reopened[0] })
      // Every flight above is a toggle, and this one ENDED open — dismiss it rather than waiting
      // for a departure that will not come, or the reduced-motion flight below starts by closing
      // the panel and measures a leave as if it were an enter.
      await press('Escape', 'Escape', 27)
      await waitFor(panelGone)
    }
    // ---- the return trip, and the side Share takes when the panel was open ----------------------
    // Opening reveals the panel by scrolling down; closing has to put the viewport back. The bug this
    // locks is the old order of operations — unpin, then let the browser clamp `scrollY` when the column
    // shrinks by the panel's height — which moved the page in one frame and left the Share button near
    // the viewport bottom, so its popover flipped upward. Both halves are asserted: that it moved at all,
    // and that it landed where it started. The side is read from the popover's resolved transform-origin
    // (`top left` computes to "0px 0px"), because `placed.side` is not in the DOM and the geometry itself
    // is what the clamp is allowed to move.
    const returnBox = await settleOnCta()
    const returnFrom = await ev('window.scrollY')
    await clickAt(returnBox.x, returnBox.y)
    await waitFor('!!document.querySelector(\'[data-contact-panel]\')')
    await sleep(900)
    const revealedTo = await ev('window.scrollY')
    await press('Escape', 'Escape', 27)
    await waitFor(panelGone)
    await sleep(900)
    const returnedTo = await ev('window.scrollY')
    check('closing the panel returns the page to where it stood, and the reveal really moved it', revealedTo > returnFrom + 40 && Math.abs(returnedTo - returnFrom) <= 8, { returnFrom, revealedTo, returnedTo })

    // ---- one open surface: either control closes the other's panel -----------------------------
    // The two panels share one slot in the flow under the buttons, so opening one is closing the
    // other — Share out of an open contact panel, the contact CTA out of an open share panel. The
    // swap is sequenced (the outgoing panel's leave reports done before the incoming mounts), which
    // is what keeps the document from ever going empty under a viewport parked in the panel's own
    // height: on this fixture the panels ARE the page's scrollable height (scrollHeight 1438 with
    // the contact panel, 900 without, viewport 900), and an emptied slot clamps `scrollY` to the new
    // maximum in a single frame — the 302px jump the frame recorder caught when a panel was simply
    // unmounted. `step` is the biggest one-frame move; the swap's smooth glides run 30-60px a frame,
    // so the bound of 80 separates them from a clamp by an order of magnitude. `overlap` counts
    // frames with both panels in the DOM: one at a time is the whole contract, and it is
    // frame-sampled because a report of "never both" is only as good as the frames it was seen in.
    //
    // A swap moves the page nowhere: the outgoing panel is not dismissed to its reveal's origin and
    // the incoming one is not aimed anywhere — the slot changes hands at the position both panels
    // share, which is the whole point (a tour up and back down is motion without a journey). And the
    // outgoing panel leaves its height behind on the slot, because a shorter incoming panel would
    // otherwise shrink the document under the viewport and the browser would clamp the scroll up "a
    // bit" the frame the panels changed places — a clamp no scroll call causes, so none prevents.
    // Which makes the assertion strict: `minY >= swapY - 12` and a landing within 12px of where the
    // outgoing panel had the page. Not one pixel of uncommanded travel.
    const swapFrames = '(() => { window.__P = []; window.__Pdone = false; const t0 = performance.now(); const tick = function () { window.__P.push({ y: Math.round(window.scrollY), panel: !!document.querySelector("[data-contact-panel]"), sheet: !!document.querySelector("[data-share-sheet]") }); if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else window.__Pdone = true }; requestAnimationFrame(tick); return true })()'
    const swapStats = async () => {
      const frames = await ev('window.__P || []')
      const overlap = frames.filter(f => f.panel && f.sheet).length
      const step = frames.reduce((m, f, i) => i ? Math.max(m, Math.abs(f.y - frames[i - 1].y)) : m, 0)
      const minY = frames.reduce((m, f) => Math.min(m, f.y), Infinity)
      return { overlap, step, minY, last: frames[frames.length - 1] || {} }
    }
    const pageBottom = async () => await ev('Math.round(document.documentElement.scrollHeight - innerHeight)')
    const liveBox = async sel => await ev('(() => { const el = [...document.querySelectorAll(' + JSON.stringify(sel) + ')].find(e => e.getClientRects().length); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
    const panelBox = async sel => await ev('(() => { const p = document.querySelector(' + JSON.stringify(sel) + '); if (!p) return null; const r = p.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight } })()')

    const swapCta = await settleOnCta()
    const swapFrom = await ev('Math.round(window.scrollY)')
    await clickAt(swapCta.x, swapCta.y)
    await waitFor('!!document.querySelector(\'[data-contact-panel]\')')
    await sleep(900)
    const swapRevealed = await ev('Math.round(window.scrollY)')
    const shareSwap = await liveBox('[data-share-cta]')
    await ev(swapFrames)
    await clickAt(shareSwap.x, shareSwap.y)
    await waitFor('window.__Pdone === true', 5000)
    const toShare = await swapStats()
    const swapEnd = await panelBox('[data-share-sheet]')
    const swapY = await ev('Math.round(window.scrollY)')
    const swapBottom = await pageBottom()
    check('Share out of the open contact panel swaps the panels where the page stands',
      swapRevealed > swapFrom + 60 && toShare.overlap === 0
      && toShare.last.panel === false && toShare.last.sheet === true
      && toShare.minY >= swapY - 12 && Math.abs(swapY - swapRevealed) <= 12
      && !!swapEnd && swapEnd.top >= -1 && swapEnd.bottom <= swapEnd.vh + 1,
      { swapFrom, swapRevealed, swapY, swapBottom, toShare, swapEnd })
    const ctaSwap = await liveBox('[data-contact-cta]')
    await ev(swapFrames)
    await clickAt(ctaSwap.x, ctaSwap.y)
    await waitFor('window.__Pdone === true', 5000)
    const toPanel = await swapStats()
    const panelEnd = await panelBox('[data-contact-panel]')
    const backY = await ev('Math.round(window.scrollY)')
    const backBottom = await pageBottom()
    check('the contact CTA out of the open share panel swaps them back where it stands',
      toPanel.overlap === 0
      && toPanel.last.panel === true && toPanel.last.sheet === false
      && toPanel.minY >= backY - 12 && Math.abs(backY - swapY) <= 12
      // Begins on screen, tail and all that runs past the fold: the page did not move to show the
      // taller incoming panel, which is the requested behaviour, so only its top edge is owed.
      && !!panelEnd && panelEnd.top >= -1 && panelEnd.top <= panelEnd.vh - 1,
      { backY, backBottom, toPanel, panelEnd })
    // Leave the run as it likes to find things: the checks after this one drive the CTA as a closed
    // surface, and the return scroll has to be allowed to finish before they measure it.
    await press('Escape', 'Escape', 27)
    await waitFor(panelGone)
    await sleep(900)

    // ---- the share panel's own collapse, pressed off ------------------------------------------
    // Pressing Share again is the path a visitor takes to collapse the panel, and it is the one
    // where the reveal's aim can exceed the document: the share panel is short and this page ends
    // under it, so the browser clamps the reveal's glide to the document's own bottom. A return
    // target recorded as the raw aim would make the close's ownership test read that clamp as "the
    // visitor scrolled away", skip the return glide, and let the unmount clamp the page in one
    // frame — ~280px of snap. `step` catches exactly that: a clamp is ~280 in a frame, a glide under
    // 80. And the viewport has to land back where it stood, because the return scroll played.
    const shareBtn1 = await liveBox('[data-share-cta]')
    const shareFrom = await ev('Math.round(window.scrollY)')
    await clickAt(shareBtn1.x, shareBtn1.y)
    await waitFor('!!document.querySelector(\'[data-share-sheet]\')')
    await waitScrollStill()
    const shareRevealed = await ev('Math.round(window.scrollY)')
    const shareBtn2 = await liveBox('[data-share-cta]')
    await ev(swapFrames)
    await clickAt(shareBtn2.x, shareBtn2.y)
    await waitFor('window.__Pdone === true', 5000)
    const collapse = await swapStats()
    const collapsedY = await ev('Math.round(window.scrollY)')
    check('pressing Share again collapses the panel and glides the page back without a snap',
      shareRevealed > shareFrom + 60 && collapse.step <= 80 && collapse.last.sheet === false
      && Math.abs(collapsedY - shareFrom) <= 12,
      { shareFrom, shareRevealed, collapsedY, collapse })

    // Reduced motion keeps the FLIP — it is a short, contained morph of one panel back into its own
    // button, not the large-area travel the preference targets — and only trims the duration. So the
    // panel must still grow from and retract into the button here, just faster, and still settle.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const reduced = await flight()
    check('under reduced motion the panel still flips from the button and settles', reduced.length >= 3 && travelled(reduced) && faded(reduced) && reduced[reduced.length - 1].op === 1 && reduced[reduced.length - 1].sc >= 0.99, { frames: reduced.length, sample: reduced.slice(0, 3), last: reduced[reduced.length - 1] })
    await flight()
    await waitFor(panelGone)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

    // ---- CTA press feedback (Phase B: press moved from CSS `active:scale` to a Motion spring) ------
    // The press is a JS-driven gesture now, so it is asserted while the pointer is HELD, not at rest:
    // a broken `whilePress` would leave the button at scale 1 through the whole press and read as no
    // feedback at all — the very failure a plain CSS transition never had. Pressing *without* releasing
    // engages the spring before the click (and the panel) fires; a few frames in the CTA's own matrix
    // must be scaled below 1. Under prefers-reduced-motion the gesture is gated off entirely (the old
    // `motion-safe:` contract), so the button must not scale at all. This is transform-only, so it
    // never shifts layout, and it reads the inline `transform` Motion writes — not a Tailwind utility.
    const pressScaleExpr = '(() => { const c = document.querySelector("[data-product-actions] [data-contact-cta]"); if (!c) return null; return +new DOMMatrixReadOnly(getComputedStyle(c).transform).a.toFixed(3) })()'
    const heldPressScale = async () => {
      await press('Escape', 'Escape', 27); await waitFor(panelGone)
      const box = await settleOnCta()
      await mouse('mouseMoved', box.x, box.y)
      await mouse('mousePressed', box.x, box.y, 1)   // pointerdown -> whilePress engages; click not yet
      await sleep(130)                               // let the spring travel from 1 toward 0.97
      const held = await ev(pressScaleExpr)
      await mouse('mouseReleased', box.x, box.y)     // release fires the click (opens the panel)
      await press('Escape', 'Escape', 27); await waitFor(panelGone)
      return held
    }
    const pressHeld = await heldPressScale()
    check('pressing a conversion CTA answers with a subtle Motion scale (while held)', pressHeld !== null && pressHeld > 0.9 && pressHeld < 0.99, { held: pressHeld })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const pressHeldReduced = await heldPressScale()
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    check('under reduced motion the CTA press emits no scale (the motion-safe contract preserved)', pressHeldReduced !== null && pressHeldReduced >= 0.995, { held: pressHeldReduced })

    // ---- the Share Sheet -------------------------------------------------------------------------
    // The sheet is the product's share UI, so every claim below is about a surface the visitor can
    // see: the platform's own share API must never be reached for (the trap records any call), the
    // sheet must name the product it is sharing, and its rows must be the shop's *share* list rather
    // than its contact list. The seeded shop makes that last one measurable rather than rhetorical:
    // facebook is visible in the header but not contactable, tiktok is contactable but hidden, so a
    // sheet that borrowed the other list would fail on membership alone.
    const S = EXP.share
    const shareRow = row(G.manyId).product_translations[0]
    const shareText = [shareRow.name, shareRow.short_description, canonical(G.manyId)].join('\n')
    const expectSheetFeedback = value => '((document.querySelector("[data-share-feedback]") || {}).textContent || "").trim() === ' + value
    const sheetOpen = '!!document.querySelector("[data-share-sheet]")'
    // The enter transition moves the painted sheet by its own height, so a rect read on the first
    // frame is the sheet mid-slide — off the bottom of the viewport. Every geometry read waits for
    // it to rest: the phone's slide is the host's (`data-share-slide`) with the drag host read
    // beside it, while the desktop popover animates on the sheet element itself.
    const sheetAtRest = '(() => { const s = document.querySelector("[data-share-slide]") || document.querySelector("[data-share-sheet]"); if (!s) return false; const settled = el => { const t = getComputedStyle(el).transform; return t === "none" || (() => { const m = new DOMMatrixReadOnly(t); return Math.abs(m.a - 1) < 0.02 && Math.abs(m.d - 1) < 0.02 && Math.abs(m.e) < 2 && Math.abs(m.f) < 2 })() }; const still = el => settled(el) && !el.getAnimations().some(a => a.playState === "running"); const p = document.querySelector("[data-share-sheet]"); return still(s) && (!p || p === s || still(p)) })()'
    const openSheet = async () => { await clickSelector('[data-share-cta]', sheetOpen); await waitFor(sheetAtRest); return await waitScrollStill() }
    const closeSheet = async () => { await press('Escape', 'Escape', 27); return await waitFor('!document.querySelector(\'[data-share-sheet]\')') }

    // A clean visit: the copy failures above legitimately revealed the manual link for this product,
    // and that reveal is kept until the product changes. Asking the sheet about its fallback states
    // from that carry-over would be measuring the previous check, not this one.
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-share-cta]\')')
    await armShareTrap()
    await armClipboard('ok')
    await clearFeedback()
    await openSheet()
    const openedSheet = await sheet()
    check('the Share button opens the share panel, and the platform share API is never called', !!openedSheet && (await shareCalls()).length === 0, { calls: await shareCalls(), panel: !!openedSheet })
    // The panel is the contact panel's twin, not a floating menu: it sits in the info column's own
    // flow, expanding down from the button row it hangs from.
    const openedBelow = await ev('(() => { const p = document.querySelector("[data-share-sheet]"); const b = [...document.querySelectorAll("[data-share-cta]")].find(e => e.getClientRects().length); if (!p || !b) return null; const pr = p.getBoundingClientRect(), br = b.getBoundingClientRect(); return { below: pr.top >= br.bottom - 1, gap: Math.round(pr.top - br.bottom), position: getComputedStyle(p).position } })()')
    check('the panel expands downward in the page\u2019s own flow, directly under the Share control', !!openedBelow && openedBelow.position !== 'fixed' && openedBelow.below && openedBelow.gap <= 80, { openedBelow })
    // The arrow that answers "which button is this?": it must sit ON its own button's centre line and
    // ride the panel's top edge, or it is pointing at nothing. `dx` is read against the painted button
    // rather than a stored number because the panel is column-wide and its trigger is not.
    const caretGeo = await ev('(() => { const c = document.querySelector("[data-panel-caret]"); const b = [...document.querySelectorAll("[data-share-cta]")].find(e => e.getClientRects().length); const p = document.querySelector("[data-share-sheet]"); if (!c || !b || !p) return null; const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect(), pr = p.getBoundingClientRect(); return { dx: Math.round(cr.left + cr.width / 2 - (br.left + br.width / 2)), onEdge: Math.round(pr.top - (cr.top + cr.height / 2)), painted: c.getClientRects().length > 0 } })()')
    check('the share panel wears an arrow centred on the Share button it grew out of', !!caretGeo && caretGeo.painted && Math.abs(caretGeo.dx) <= 2 && caretGeo.onEdge >= -1 && caretGeo.onEdge <= 2, { caretGeo })
    check('the panel is named for the product it shares', !!openedSheet && openedSheet.label === S.label.replace('{name}', shareRow.name) && openedSheet.text.includes(shareRow.name) && openedSheet.text.includes(shareRow.short_description), { label: openedSheet && openedSheet.label })
    check('the sheet carries Copy link, Copy message and its own dismiss, in the page\u2019s words', !!openedSheet && openedSheet.hasCopyLink && openedSheet.hasCopyMessage && openedSheet.hasClose && openedSheet.copyLinkText === S.copyLink && openedSheet.copyMessageText === S.copyMessage && openedSheet.viaText.includes(S.viaLabel), { copyLink: openedSheet && openedSheet.copyLinkText, copyMessage: openedSheet && openedSheet.copyMessageText, via: openedSheet && openedSheet.viaText })
    const wantShareHrefs = S.destinationHrefs.map(href => href.replace('{share}', encodeURIComponent(shareText)))
    const rowsOf = m => (m && m.rows || []).map(r => r.href)
    check('the destinations are exactly the shop\u2019s visible links, in stored order', JSON.stringify(rowsOf(openedSheet)) === JSON.stringify(wantShareHrefs) && JSON.stringify((openedSheet.rows || []).map(r => r.platform)) === JSON.stringify(S.destinationPlatforms), { hrefs: rowsOf(openedSheet), platforms: (openedSheet.rows || []).map(r => r.platform) })
    check('share is not coupled to contact: the visible-but-not-contactable row appears, the hidden-but-contactable one does not', wantShareHrefs.some(h => h.includes('facebook.com')) && !wantShareHrefs.some(h => h.includes('tiktok')))
    check('only the documented platform carries the text; the rest keep their stored URL byte-for-byte', JSON.stringify((openedSheet.rows || []).map(r => r.prefilled)) === JSON.stringify(S.destinationsPrefilled) && openedSheet.rows[0].href === 'https://facebook.com/raccoongearbin', { prefilled: (openedSheet.rows || []).map(r => r.prefilled) })
    check('every destination opens in a new tab with a safe rel, named by the shared brand mark', (openedSheet.rows || []).every(r => r.target === '_blank' && /noopener/.test(r.rel || '') && /noreferrer/.test(r.rel || '') && r.svgs === 1 && r.fill === 'currentColor'), (openedSheet.rows || []).map(r => [r.target, r.rel, r.svgs, r.fill]))

    // Copy is claimed only when the clipboard took it, and the sentence belongs to the surface the
    // visitor is using: the sheet speaks, the row behind it stays silent.
    await clickSelector('[data-share-copy-link]', expectSheetFeedback(JSON.stringify(C.feedback.link)))
    const linkCopies = await copies()
    const afterLinkCopy = await sheet()
    check('Copy link writes the canonical URL and says so inside the sheet', linkCopies.length === 1 && linkCopies[0] === canonical(G.manyId) && afterLinkCopy.feedback === C.feedback.link, { copied: linkCopies, feedback: afterLinkCopy.feedback })
    check('only one surface announces a copy', (await inlineMount()).feedback === '', { mountFeedback: (await inlineMount()).feedback })
    await clickSelector('[data-share-copy-message]', expectSheetFeedback(JSON.stringify(C.feedback.copied)))
    const messageCopies = await copies()
    check('Copy message writes the product line and the link, in that order', messageCopies.length === 2 && messageCopies[1] === shareText, { copied: messageCopies.map(norm) })
    check('a copy that worked leaves no manual fallback on either surface', (await sheet()).link === null && (await inlineMount()).shareLink === null, { sheetLink: (await sheet()).link })

    await armClipboard('missing')
    await clickSelector('[data-share-copy-link]', expectSheetFeedback(JSON.stringify(C.feedback.blocked)))
    const refusedSheet = await sheet()
    check('a refused clipboard is reported as a failure, never as copied', (await copies()).length === 0 && refusedSheet.feedback === C.feedback.blocked, { feedback: refusedSheet.feedback })
    check('and the sheet shows the very link its message asks the visitor to copy', refusedSheet.link === canonical(G.manyId) && refusedSheet.readonly === true, { link: refusedSheet.link })
    check('the fallback is shown once, in the sheet the visitor is using', (await inlineMount()).shareLink === null, { mountLink: (await inlineMount()).shareLink })
    await armClipboard('ok')

    // The manual fallback's row is the one thing that can differ between the two panels' slot while
    // it is revealed, and it keeps its space (`invisible`, not `v-if`) while the share panel is open
    // for exactly this: opening either panel must aim its reveal at the same place. `offsetTop` is
    // read rather than a rect, so a panel mid-bloom cannot skew the number with its transform — and
    // the fixture's own clamp is beside the point here: the share panel's shorter document lands the
    // scroll differently, but the slot the reveal aims with is what the two openings must agree on.
    await closeSheet()
    await waitScrollStill()
    const parityBox = await settleOnCta()
    await clickAt(parityBox.x, parityBox.y)
    await waitFor('!!document.querySelector(\'[data-contact-panel]\')')
    const ctoTop = await ev('(() => { const p = document.querySelector("[data-contact-panel]"); return p ? p.offsetTop : null })()')
    const ctoCaret = await ev('(() => { const c = document.querySelector("[data-panel-caret]"); const b = document.querySelector("[data-product-actions] [data-contact-cta]"); const p = document.querySelector("[data-contact-panel]"); if (!c || !b || !p) return null; const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect(); return { dx: Math.round(cr.left + cr.width / 2 - (br.left + br.width / 2)), ownButton: p.hasAttribute("data-contact-panel") } })()')
    await press('Escape', 'Escape', 27)
    await waitFor(panelGone)
    await waitScrollStill()
    await openSheet()
    const slotTop = await ev('(() => { const p = document.querySelector("[data-share-sheet]"); return p ? p.offsetTop : null })()')
    check('opening either panel aims its reveal at the same slot, fallback row included', ctoTop !== null && slotTop !== null && Math.abs(ctoTop - slotTop) <= 2, { ctoTop, slotTop })
    check('the contact panel wears an arrow centred on its own CTA, not the share button', !!ctoCaret && ctoCaret.ownButton === true && Math.abs(ctoCaret.dx) <= 2, { ctoCaret })

    check('Escape closes the sheet and hands focus back to the Share button', await closeSheet() && await ev('(() => { const el = document.activeElement; return !!el && el.getAttribute("data-share-cta") !== null })()'))
    await openSheet()
    // No modal catcher and no outside-click dismissal: this is a panel in the page, like the contact
    // panel — it is dismissed by the control that opened it, its close button, or Escape.
    check('the desktop panel carries no modal backdrop, unlike the phone sheet', !(await ev('!!document.querySelector("[data-share-backdrop]")')))
    await clickSelector('[data-share-cta]', '!document.querySelector(\'[data-share-sheet]\')')
    check('pressing Share again closes the panel it opened', await waitFor('!document.querySelector(\'[data-share-sheet]\')'))
    await ev('(() => { const el = document.querySelector("[data-share-cta]"); if (el) el.focus(); return true })()')
    await press('Enter', 'Enter', 13, '\r')
    await waitFor(sheetAtRest)
    await waitScrollStill()
    const keyed = await sheet()
    const shareBtnGeo = await ev('(() => { const el = [...document.querySelectorAll("[data-share-cta]")].find(b => b.getClientRects().length); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } })()')
    check('the keyboard opens the panel, and it stays inside the viewport', !!keyed && keyed.position !== 'fixed' && keyed.left >= 0 && keyed.top >= 0 && keyed.right <= keyed.vw + 1 && keyed.bottom <= keyed.vh + 1 && keyed.overflow <= 1, { keyed })
    // Directly under its control, not floating beside it: the panel occupies the slot below the
    // button row, so its top edge clears the button's bottom with only the row gap between them.
    check('the panel expands directly under the Share control that opened it', !!keyed && !!shareBtnGeo && keyed.width > 100 && keyed.top >= shareBtnGeo.bottom - 1 && keyed.top - shareBtnGeo.bottom <= 80, { keyed, shareBtnGeo })
    check('the desktop panel carries no thumb-reach close row', !!keyed && keyed.hasCloseBottom === false, { hasCloseBottom: keyed && keyed.hasCloseBottom })
    await closeSheet()
    // ---- the panel's bloom (desktop shape) --------------------------------------------------
    // The desktop shape used to unfold on `scaleY` alone, which stretched every copy row and
    // destination pill vertically for the length of the pop — the defect Phase H removed from the
    // contact panel. Frame-sampled rather than read at rest, because a settled popover reports the
    // identity matrix whatever curve got it there: only a mid-flight frame can tell a uniform bloom
    // (a === d < 1) from a one-axis stretch (scaleY 0.5 gives a=1, d=0.5).
    const START_SHEET_FRAMES = '(() => { window.__SF = []; window.__SFdone = false; const t0 = performance.now(); const tick = function () { const s = document.querySelector("[data-share-sheet]"); const t = s && getComputedStyle(s).transform; if (t && t !== "none") { const m = new DOMMatrixReadOnly(t); window.__SF.push({ a: +m.a.toFixed(3), d: +m.d.toFixed(3), f: +m.f.toFixed(1), o: +getComputedStyle(s).opacity }) } if (performance.now() - t0 < 700) requestAnimationFrame(tick); else window.__SFdone = true }; requestAnimationFrame(tick); return true })()'
    const settleOnShare = async () => {
      await ev('(() => { const el = [...document.querySelectorAll("[data-share-cta]")].find(b => b.getClientRects().length); el.scrollIntoView({ block: "center", inline: "nearest" }); return true })()')
      await sleep(500)
      return await ev('(() => { const el = [...document.querySelectorAll("[data-share-cta]")].find(b => b.getClientRects().length); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
    }
    const sbox = await settleOnShare()
    await ev(START_SHEET_FRAMES)
    await clickAt(sbox.x, sbox.y)
    await waitFor('!!window.__SFdone', 4000)
    const sframes = await ev('window.__SF || []')
    const popBloom = sframes.filter(f => f.a > 0.5 && f.a < 0.995)
    check('the desktop panel blooms on a uniform scale, not a one-axis stretch', sframes.length > 3 && popBloom.length > 0 && popBloom.every(f => Math.abs(f.a - f.d) <= 0.01), { frames: sframes.slice(0, 6) })
    // The other half of "the same animation as the Contact panel": the bloom travels a few px back
    // toward the control it opened from, and opacity fades on its own curve rather than riding the
    // spring. A scale-only pop passes the check above and fails this one.
    const popTravelled = sframes.filter(f => Math.abs(f.f) >= 2)
    const popFaded = sframes.some(f => f.o > 0.02 && f.o < 0.98)
    check('the panel travels toward its trigger and fades on its own curve, like the contact panel', popTravelled.length > 0 && popFaded, { travel: popTravelled.slice(0, 4), frames: sframes.slice(0, 4) })
    await waitFor(sheetAtRest)
    await closeSheet()
    check('the sheet never reached the platform share API during the whole visit', (await shareCalls()).length === 0, { calls: await shareCalls() })

    await clearFeedback()
    await armClipboard('ok')
    await openSheet()
    await clickSelector('[data-share-copy-link]', expectSheetFeedback(JSON.stringify(C.feedback.link)))
    const shareCopies = await copies()
    await closeSheet()

    // ---- metadata -----------------------------------------------------------------------------
    const head = await ev(HEAD)
    const headRow = row(G.manyId).product_translations[0]
    check('the page publishes a title, description and canonical for the current product', head.title === headRow.name + C.titleSuffix && head.desc === headRow.short_description && head.canonical === canonical(G.manyId), { title: head.title, desc: head.desc, canonical: head.canonical })
    const gallerySrc = await ev('(() => { const i = document.querySelector("[data-gallery-main]"); return i ? i.src : null })()')
    check('Open Graph carries the product, and its image is the same catalog-mapped photo the gallery shows', head.ogType === 'product' && head.ogSite === C.appName && head.ogTitle === headRow.name && head.ogDesc === headRow.short_description && head.ogUrl === canonical(G.manyId) && head.ogImage === gallerySrc && head.ogImageAlt === row(G.manyId).product_images[0].alt_text, { ogType: head.ogType, ogImage: head.ogImage, gallerySrc, ogImageAlt: head.ogImageAlt })
    check('the canonical in the head is the URL the message and the share both carried', head.canonical === wantIn.split('\n').pop() && head.canonical === shareCopies[0], { canonical: head.canonical })

    // ---- low stock and out of stock, reached by an in-app navigation ----------------------------
    // Using the page's own header search rather than a fresh load is deliberate: it is the
    // detail→detail path, where a canonical built from a one-shot request URL would go stale.
    const searchTo = async (term, label, id) => {
      const box = (await ev(boxesExpr(SB_INPUT)))[0]
      await clickAt(box.x, box.y)
      await cdp.send('Input.insertText', { text: term })
      return await clickByText(`${SB} a`, label, pathnameIs(id))
    }
    const bandState = async () => await ev('(() => { const el = document.querySelector("[data-stock-status]"); return el ? el.getAttribute("data-stock-state") : null })()')

    check('navigating detail→detail through the search works', await searchTo('mouse', 'Verify Mouse', G.twoId))
    await waitFor(`(document.querySelector('main h1')?.textContent || '').trim() === 'Verify Mouse'`)
    const lowMount = await openInlinePanel()
    check('a low-stock product keeps the order action and asks about the remaining stock', lowMount.ctaText === C.cta.low && lowMount.message === expectedMessage(row(G.twoId), C.ask.low, canonical(G.twoId)), { cta: lowMount.ctaText, message: norm(lowMount.message) })
    check('the badge and the CTA agree on the band because one rule answers for both', await bandState() === 'low' && lowMount.ctaText === C.cta.low, { band: await bandState(), cta: lowMount.ctaText })
    const headLow = await ev(HEAD)
    check('a detail→detail navigation re-points the canonical and the Open Graph title', headLow.canonical === canonical(G.twoId) && headLow.ogTitle === row(G.twoId).product_translations[0].name, { canonical: headLow.canonical, ogTitle: headLow.ogTitle })

    await searchTo('headphones', 'Verify Headphones', G.singleId)
    await waitFor(`(document.querySelector('main h1')?.textContent || '').trim() === 'Verify Headphones'`)
    const outMount = await openInlinePanel()
    const wantOut = expectedMessage(row(G.singleId), C.ask.out, canonical(G.singleId))
    check('an out-of-stock product asks about availability instead of offering to sell', outMount.ctaText === C.cta.out && outMount.message === wantOut && await bandState() === 'out', { cta: outMount.ctaText, band: await bandState(), message: norm(outMount.message) })
    check('the out-of-stock message asks for a restock and never claims the item can be ordered now', /out of stock/.test(outMount.message) && /restocked/.test(outMount.message) && !/I would like to order/i.test(outMount.message), { message: norm(outMount.message) })

    // ---- shops and products the fixtures do not contain ----------------------------------------
    // A document script mutates the stub's own collections before the app boots, so the app reads
    // this data through exactly the same REST path as any other: the alternative is a seventh
    // product row that every card and price count in this file would then have to chase.

    const odd = 'Rüç “Koï” 100% <b> & € ✦ Keyboard'
    const oddScript = await forNextDocument('window.__PRODUCTS[0].product_translations[0].name = ' + JSON.stringify(odd) + ';')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-contact-cta]\')')
    const oddMount = await openInlinePanel()
    const wantOdd = expectedMessage({ ...row(G.manyId), product_translations: [{ name: odd }] }, C.ask.in, canonical(G.manyId))
    check('a name full of punctuation, quotes and non-Latin characters survives the message intact', oddMount.message === wantOdd && oddMount.message.includes(odd) && oddMount.message.split('\n').length === C.lines.length, { message: norm(oddMount.message) })
    check('and it stays text: no markup from a product name is ever interpreted', await ev('(() => { const h = document.querySelector("main h1"); return !!h && h.textContent.includes(' + JSON.stringify(odd) + ') && h.querySelector("b") === null })()'))
    await stopForNextDocument(oddScript)

    const bareScript = await forNextDocument('window.__SITE.phone = ""; window.__SITE.social_links = [];')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-share-cta]\')')
    const bare = await mounts()
    // Sharing is not the contact flow's guest: a shop with no configured channel loses the contact
    // action and keeps the share action, which is why the bar no longer disappears with the channels
    // — an empty strip covering the product became a row that still has something to do.
    check('a shop with no configured contact offers no contact action, and still offers Share', !(await ev('!!document.querySelector("[data-contact-cta]")')) && !!(await ev('!!document.querySelector("[data-share-cta]")')) && !!(await ev('!!document.querySelector("[data-sticky-cta] [data-share-cta]")')) && !!bare.find(m => m.where === 'inline'), { mounts: bare.map(m => m.where + ':' + m.visible) })
    check('nothing is invented in the missing channel’s place', !(await ev('document.body.innerHTML.includes("tel:")')) && !(await ev('document.body.innerText.includes("example.com")')) && (await ev('document.querySelector("main h1") ? (document.querySelector("main h1").textContent || "").trim() : ""')) === row(G.manyId).product_translations[0].name)
    await armShareTrap()
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', '!!document.querySelector("[data-share-sheet]")')
    const bareSheet = await sheet()
    check('the sheet renders with no configured destination at all, rather than an empty group', !!bareSheet && bareSheet.rows.length === 0 && bareSheet.hasCopyLink && bareSheet.text.includes(row(G.manyId).product_translations[0].name), { rows: bareSheet && bareSheet.rows.length })
    await clickSelector('[data-share-copy-link]', expectSheetFeedback(JSON.stringify(C.feedback.link)))
    check('sharing still works when there is no contact channel to configure', (await copies()).length === 1 && (await copies())[0] === canonical(G.manyId), { copied: await copies() })
    await press('Escape', 'Escape', 27)
    await stopForNextDocument(bareScript)

    const noPhotoScript = await forNextDocument('window.__PRODUCTS[0].product_images = [];')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-product-gallery]\')')
    const bareHead = await ev(HEAD)
    check('a product with no photos publishes no og:image rather than an empty one', bareHead.ogImage === null && bareHead.ogImageAlt === null && bareHead.canonical === canonical(G.manyId) && bareHead.ogTitle === row(G.manyId).product_translations[0].name, { ogImage: bareHead.ogImage, ogTitle: bareHead.ogTitle })
    const noPhotoMount = await openInlinePanel()
    // `innerText` reports what is painted, and the no-image frame is uppercased by the eyebrow
    // style — matching it case-insensitively is the difference between testing the text and
    // testing the CSS.
    check('the gallery shows its own no-image frame while the conversion still carries the product', await ev('/no image/i.test(document.body.innerText)') && noPhotoMount.message === wantIn, { message: norm(noPhotoMount.message) })
    await stopForNextDocument(noPhotoScript)

    // ---- a product on promotion ------------------------------------------------------------------
    // Two numbers, four surfaces that show them and one sort that reads them: which pair is painted
    // is decided by the rule in `app/utils/product-pricing.ts`, so the check asks the page. The live
    // window is fixed to dates no run can drift out of (year 2000 to year 2900), so no clock is
    // stubbed and the same arm proves both the window and the unit cap by moving one value.
    const promoArm = extra => forNextDocument('var p = window.__PRODUCTS[0]; p.promo_price = "79.00"; p.promo_label = "Verify Sale"; p.promo_quantity = 3; p.promo_starts_at = "2000-01-01T00:00:00Z"; p.promo_ends_at = "2900-01-01T00:00:00Z";' + extra)
    const PRICE_PAIR = '(() => { const root = document.querySelector("[data-product-price]"); if (!root) return null; const ps = root.querySelectorAll("p"); const del = root.querySelector("del"); return { current: ((ps[0].querySelector("span") || {}).textContent || "").trim(), struck: del ? (del.textContent || "").trim() : null, deco: del ? (getComputedStyle(del).textDecorationLine || "") : null, note: ps.length > 1 ? (ps[1].textContent || "").trim() : null } })()'
    // The ribbon is read against the photo frame it is cut across — the card's own frame on a card, the
    // gallery's first child on the detail page — because the box that anchors it is the part most likely
    // to drift (a wrapper wider than the photo would park the band in the gutter beside it). `angle` and
    // `onDiagonal` together are what prove the band lies across the corner rather than sitting in it, and
    // `overhang` proves its ends run past the 112px clip box instead of ending early in mid-air. `angle`
    // is read off the `rotate` property, never `transform`: Tailwind v4 writes `rotate: -45deg`, which
    // `getComputedStyle().transform` reports as a plain matrix none of this would notice.
    const RIBBON = '(() => { const all = document.querySelectorAll("[data-sale-ribbon]"); if (all.length !== 1) return { count: all.length }; const el = all[0]; const band = el.firstElementChild; if (!band) return { count: 1, noBand: true }; const host = el.closest("article") ? el.parentElement : document.querySelector("[data-product-gallery] > div") || el.parentElement; const b = el.getBoundingClientRect(); const g = band.getBoundingClientRect(); const f = host.getBoundingClientRect(); const nums = (getComputedStyle(band).rotate || "none").match(/-?[0-9.]+/g) || []; const cx = g.left + g.width / 2, cy = g.top + g.height / 2; const hit = document.elementFromPoint(cx, cy); const prev = document.querySelector("[data-gallery-prev]"); return { count: 1, text: (el.textContent || "").trim(), pe: getComputedStyle(el).pointerEvents, angle: nums.length ? Math.round(parseFloat(nums[nums.length - 1])) : 0, boxH: Math.round(g.height), layoutH: band.offsetHeight, inX: Math.round(b.left - f.left), inY: Math.round(b.top - f.top), inside: b.left >= f.left - 0.5 && b.top >= f.top - 0.5 && b.right <= f.right + 0.5 && b.bottom <= f.bottom + 0.5, overhang: g.left < f.left - 4 && g.top < f.top - 4, onDiagonal: Math.abs((cx - f.left) - (cy - f.top)) < 6, arrowOverlap: prev ? (() => { const p = prev.getBoundingClientRect(); return !(g.right < p.left || g.left > p.right || g.bottom < p.top || g.top > p.bottom) })() : null, through: !!hit && !(hit.closest && hit.closest("[data-sale-ribbon]")) } })()'

    const liveArm = await promoArm('')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-product-price] del\')')
    const live = await ev(PRICE_PAIR)
    check('a live promotion paints the discounted price with the original crossed out', !!live && live.current === 'USD 79.00' && live.struck === 'USD 123.45' && live.deco.includes('line-through') && live.note === 'Only 3 left at this price', live)
    const liveRibbon = await ev(RIBBON)
    check('the promoted product wears its named ribbon across the photo corner, off the arrows and click-through', !!liveRibbon && liveRibbon.count === 1 && liveRibbon.text === 'Verify Sale' && liveRibbon.inside && liveRibbon.inX < 2 && liveRibbon.inY < 2 && liveRibbon.angle === -45 && liveRibbon.boxH > liveRibbon.layoutH + 20 && liveRibbon.onDiagonal && liveRibbon.overhang && liveRibbon.arrowOverlap === false && liveRibbon.pe === 'none' && liveRibbon.through === true, liveRibbon)
    const livePanel = await openInlinePanel()
    check('the message handed to the shop quotes the price on the page, not the one crossed out', livePanel.message === expectedMessage({ ...row(G.manyId), price: '79.00' }, C.ask.in, canonical(G.manyId)), { message: norm(livePanel.message) })
    await nav(new URL('/', appUrl).href)
    await waitFor('!!document.querySelector(\'main article [data-product-price] del\')')
    const promoCard = await ev(PRICE_PAIR)
    // The second clause is the one that keeps the grid honest: a card that grew a second tabular
    // price would silently change what `main article p.tabular-nums` counts, and the sort check above
    // reads that selector.
    check('the card paints the same pair, and still exactly one tabular price per card', !!promoCard && promoCard.current === 'USD 79.00' && promoCard.struck === 'USD 123.45' && (await ev('document.querySelectorAll("main article p.tabular-nums").length')) === EXP.cards, { promoCard })
    const cardRibbon = await ev(RIBBON)
    // One ribbon across six cards, because only the promoted row carries the columns: a badge keyed off
    // anything looser (a stored price, a stale flag) would show on products nobody put on sale. The inset
    // is a bound, not a constant: a card's frame carries a 1px border and the gallery's does not.
    check('the grid wears exactly one ribbon, on the promoted card, cut across its corner', !!cardRibbon && cardRibbon.count === 1 && cardRibbon.text === 'Verify Sale' && cardRibbon.inside && cardRibbon.inX < 2 && cardRibbon.inY < 2 && cardRibbon.angle === -45 && cardRibbon.boxH > cardRibbon.layoutH + 20 && cardRibbon.onDiagonal && cardRibbon.overhang && (await ev('document.querySelectorAll("[data-sale-ribbon]").length')) === 1, cardRibbon)
    await stopForNextDocument(liveArm)

    const unnamedArm = await promoArm('p.promo_label = null; p.promo_quantity = null;')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-sale-ribbon]\')')
    const unnamed = await ev(RIBBON)
    check('a promotion with no name of its own still says what it is', !!unnamed && unnamed.count === 1 && unnamed.text === 'Sale' && unnamed.angle === -45 && unnamed.pe === 'none', unnamed)
    await stopForNextDocument(unnamedArm)

    for (const [why, extra] of [['has closed', 'p.promo_ends_at = "2000-06-01T00:00:00Z";'], ['has run out', 'p.promo_quantity = 0;']]) {
      const arm = await promoArm(extra)
      await nav(detailUrl(G.manyId))
      await waitFor('!!document.querySelector(\'[data-product-price]\')')
      const off = await ev(PRICE_PAIR)
      check(`a promotion whose ${why} leaves the original price alone, with nothing crossed out`, !!off && off.current === 'USD 123.45' && off.struck === null && off.note === null, off)
      await stopForNextDocument(arm)
    }

    // ---- the mobile sticky bar -----------------------------------------------------------------
    await metrics(390, 844, true)
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-sticky-cta] [data-contact-cta]\')')
    // One visible Contact CTA per breakpoint: the inline block is `hidden lg:block` on purpose,
    // so a second painted CTA at phone width means that contract broke and the visitor is being
    // asked to choose between two identical actions. `getClientRects()` reads painted layout,
    // which is what a `display: none` mount honestly does not have.
    const ctaCount = await ev('(() => { let n = 0; for (const el of document.querySelectorAll("[data-contact-cta]")) if (el.getClientRects().length) n++; return n })()')
    const shareCount = await ev('(() => { let n = 0; for (const el of document.querySelectorAll("[data-share-cta]")) if (el.getClientRects().length) n++; return n })()')
    check('exactly one Contact to Order CTA is visible at mobile width', ctaCount === 1, { ctaCount })
    check('exactly one Share CTA is visible at mobile width', shareCount === 1, { shareCount })
    const geo = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); if (!bar) return null; const r = bar.getBoundingClientRect(); const c = getComputedStyle(bar); const inner = bar.querySelector("[data-product-actions]").getBoundingClientRect(); const ctl = bar.querySelector("[data-contact-cta]"); const shr = bar.querySelector("[data-share-cta]"); const cr = ctl.getBoundingClientRect(); const sr = shr.getBoundingClientRect(); const label = ctl.querySelector("span"); return { display: c.display, position: c.position, z: c.zIndex, pb: c.paddingBottom, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, vh: innerHeight, vw: innerWidth, insetLeft: Math.round(inner.left - r.left), insetRight: Math.round(r.right - inner.right), ctlH: Math.round(cr.height), ctlW: Math.round(cr.width), shrH: Math.round(sr.height), shrW: Math.round(sr.width), shrTop: Math.round(sr.top), shrBottom: Math.round(sr.bottom), rowH: Math.round(Math.max(cr.bottom, sr.bottom) - Math.min(cr.top, sr.top)), ctlClip: label ? label.scrollWidth - label.clientWidth : null, hasShare: !!shr, sameRow: Math.abs((cr.top + cr.height / 2) - (sr.top + sr.height / 2)) < 2, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    check('the sticky bar is a fixed bottom row that stays inside the viewport', geo.position === 'fixed' && geo.display !== 'none' && Math.abs(geo.bottom - geo.vh) <= 1 && geo.left === 0 && geo.right === geo.vw, geo)
    check('the sticky bar does not widen the page, keeps the 44px control and its symmetric inset', geo.overflow <= 1 && geo.ctlH === C.sticky.controlHeight && geo.insetLeft === geo.insetRight && geo.ctlW + geo.insetLeft * 2 <= geo.vw, geo)
    check('the sticky bar reserves room for the home-indicator safe area', parseFloat(geo.pb) >= C.sticky.minPadding, { paddingBottom: geo.pb })
    // The mobile row is Contact and Share, in one row, of the same height, on the same centre line:
    // the same `ProductActions`, not a phone-shaped copy of it.
    check('the sticky bar carries Contact and Share as one row of equal-height controls', geo.hasShare && geo.sameRow && geo.shrH === C.sticky.controlHeight && geo.rowH === C.sticky.controlHeight && geo.shrBottom <= geo.vh, { geo })
    // Adding Share to the phone row must not cost the primary action its wording: Share takes the
    // room its own label needs, so "Contact to order" still reads whole at a common phone width.
    check('the sticky row fits both actions and keeps the primary label unclipped', geo.overflow <= 1 && geo.shrTop >= 0 && geo.ctlW + geo.shrW + 2 * geo.insetLeft + 8 <= geo.vw && geo.ctlClip <= 0, { geo })
    // iOS answers a double tap with a viewport zoom unless the page opts out. `touch-action:
    // manipulation` on the root drops that one browser gesture and keeps pan and pinch; every
    // storefront touch surface already sets a stronger value of its own, so none of them change.
    check('a double tap cannot zoom the phone viewport', await ev('getComputedStyle(document.documentElement).touchAction === "manipulation"'))

    // ---- the Share Sheet on a phone -----------------------------------------------------------
    // Bottom-anchored, full-bleed, safe-area aware, and dismissed by the backdrop — the shape a
    // desktop popover is not, from the same component. Measured at the widths this project has already
    // been bitten at.
    await armShareTrap()
    await armClipboard('ok')
    const stickyShare = '[data-sticky-cta] [data-share-cta]'
    // The sheet's enter must clear the same bar the panel's does: a bezier, not a spring, and —
    // the deeper half — it must be a WAAPI animation at all: a declarative `y` is not on Motion's
    // accelerated list and animates through its JS frameloop, which is what the phone kept reading
    // as choppy. Captured on the first tick that finds the slide host, where its animations are
    // still in flight, rather than after it has settled.
    const START_SHEET_ANIMS = '(() => { window.__SA = null; const t0 = performance.now(); const tick = () => { const s = document.querySelector("[data-share-slide]"); if (s && !window.__SA) { for (const a of document.getAnimations()) { if (a.effect && a.effect.target === s) { window.__SA = String(a.effect.getComputedTiming().easing); break } } } if (window.__SA || performance.now() - t0 > 1200) return; requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()'
    await ev(START_SHEET_ANIMS)
    await clickSelector(stickyShare, sheetOpen)
    await waitFor('window.__SA !== null', 2000)
    const sheetEase = await ev('window.__SA')
    check('the sheet enters on a bezier the compositor takes, not a generated spring curve', typeof sheetEase === 'string' && sheetEase.length > 0 && !sheetEase.startsWith('linear('), { sheetEase })
    // The scrim is a flat dim and the sheet is its SIBLING, never its child: a full-viewport
    // `backdrop-filter` on the scrim whose opacity fades with the sheet was the phone's last
    // low-fps surface — and a descendant sliding inside a filtered ancestor re-runs that filter
    // anyway (the coupling the bar's frost was hoisted out of).
    const sheetSiblings = await ev('(() => { const b = document.querySelector("[data-share-backdrop]"); const s = document.querySelector("[data-share-sheet]"); return { both: !!b && !!s, nested: !!b && !!s && b.contains(s), scrimFlat: !!b && getComputedStyle(b).backdropFilter === "none" } })()')
    check('the sheet slides beside a flat scrim, never inside a blurred one', sheetSiblings.both && !sheetSiblings.nested && sheetSiblings.scrimFlat, { sheetSiblings })
    // The slide host is promoted while it exists (it mounts and unmounts with the sheet, so no
    // layer is left behind), and the two animations on it are WAAPI — transform and opacity on the
    // bezier, never a generated spring curve.
    const sheetWillChange = await ev('getComputedStyle(document.querySelector("[data-share-slide]")).willChange')
    check('the sheet slide is its own compositor layer while it is open', sheetWillChange === 'transform', { sheetWillChange })
    await waitFor(sheetAtRest)
    const mSheet = await sheet()
    check('the mobile Share button opens a bottom sheet, not a centred dialog', !!mSheet && mSheet.position === 'fixed' && Math.abs(mSheet.bottom - mSheet.vh) <= 1 && mSheet.left >= 0 && mSheet.right <= mSheet.vw + 1 && mSheet.width <= mSheet.vw, { mSheet })
    check('the sheet is rounded across its top edge and clears the home indicator', !!mSheet && parseFloat(mSheet.radius) >= 16 && parseFloat(mSheet.pb) >= C.sticky.minPadding, { radius: mSheet && mSheet.radius, pb: mSheet && mSheet.pb })
    check('the mobile sheet carries the product, the copy rows and the destinations', !!mSheet && mSheet.hasCopyLink && mSheet.hasCopyMessage && mSheet.hasClose && mSheet.rows.length === 2 && mSheet.text.includes(shareRow.name), { rows: mSheet && mSheet.rows.length })
    check('the open sheet does not widen the page', mSheet.overflow <= 1, { overflow: mSheet && mSheet.overflow })
    await clickSelector('[data-share-copy-link]', expectSheetFeedback(JSON.stringify(C.feedback.link)))
    check('Copy link works from the sticky bar\u2019s sheet', (await copies()).length === 1 && (await copies())[0] === canonical(G.manyId) && (await sheet()).feedback === C.feedback.link, { copied: await copies() })
    check('and the sticky bar\u2019s own line stays silent while the sheet speaks', (await stickyMount()).feedback === '', { barFeedback: (await stickyMount()).feedback })
    // The backdrop, aimed beside the sheet rather than at the page's right edge: on a phone the sheet
    // is full-bleed, so the band above it is the only thing that is backdrop.
    await clickAt(195, 60)
    check('the backdrop closes the mobile sheet', await waitFor('!document.querySelector(\'[data-share-sheet]\')'))
    check('the sheet never reached the platform share API on mobile', (await shareCalls()).length === 0, { calls: await shareCalls() })

    // ---- the decode must not move the sticky header (phone) --------------------------------------
    // A decoded label changes size every 40ms step, and size is what layout measures: the header's first
    // row is a `flex-wrap` row that re-wraps on its items' widths, and at 390px the Khmer label puts it a
    // line taller. Before the pinned box, that line stayed until the last cluster settled and the whole
    // header then jumped ~44px — the reported flicker. The pin holds the box at its FINAL width and
    // height from the first decoded frame, so the one reflow happens with the language change and nothing
    // moves after. Sampled per frame because "it settled eventually" is exactly what the broken build
    // does, and paired with the check below it that counts the pins: a row with nothing to cross would
    // hand the height sequence a free pass. A pin is `white-space: nowrap` on a one-line box, or a
    // height on text that already wraps — counting either is what proves the mechanism fired.
    await ev('(() => { const p = document.querySelector(\'[data-detail-header] [data-language-switcher] a:nth-of-type(2)\'); if (p) p.focus(); return true })()')
    await press('Enter', 'Enter', 13)
    await waitFor('location.pathname.startsWith("/km/products")', 4000)
    await sleep(1600)
    await ev('(() => { window.__H = []; window.__F = []; window.__E = []; window.__Hdone = false; const tick = () => { const h = document.querySelector("[data-detail-header]"); window.__H.push(h ? Math.round(h.getBoundingClientRect().height) : -1); window.__F.push([...document.querySelectorAll("[data-detail-header] *")].filter(e => e.style.whiteSpace === "nowrap" || e.style.height !== "").length); window.__E.push((() => { const pins = [...document.querySelectorAll("[data-decode-pin]")]; let ell = 0, clip = 0; for (const p of pins) for (const e of [p, ...p.querySelectorAll("*")]) { if (getComputedStyle(e).textOverflow === "ellipsis") ell++; if (e.scrollWidth > e.clientWidth + 1) clip++ } return pins.length + "," + ell + "," + clip })()); if (window.__H.length < 60) requestAnimationFrame(tick); else window.__Hdone = true }; requestAnimationFrame(tick); return true })()')
    await ev('(() => { const p = document.querySelector(\'[data-detail-header] [data-language-switcher] a:nth-of-type(1)\'); if (p) p.focus(); return true })()')
    await press('Enter', 'Enter', 13)
    await waitFor('window.__Hdone', 5000)
    const headerHeights = await ev('window.__H') || []
    const headerPins = await ev('window.__F') || []
    const headerEllipsis = (await ev('window.__E') || []).map(r => r.split(','))
    const lastH = headerHeights.at(-1) ?? -1
    check('the header reaches its final row before the words finish decoding', headerHeights.length > 20 && [...new Set(headerHeights)].length <= 2 && lastH > 0 && headerHeights.slice(10).every(h => h === lastH), { headerHeights: headerHeights.slice(0, 45), lastH })
    check('the decode holds the shape of the box its words sit in', Math.max(...headerPins) > 0, { pinned: Math.max(...headerPins, 0) })
    // A pinned box must clip, not ellipsise. Most labels here are `truncate`, so with the default
    // `text-overflow` a noise string wider than the real word paints a "…" the word never needed — the
    // trailing dots reported as "some parts has the … at the end". Read over the pinned box AND its
    // descendants, because the element doing the truncating is usually a `truncate` span inside the box
    // the pin holds. Three claims, so it cannot pass by idleness: boxes were pinned, something under a
    // pinned box was actually overflowing (the rule had work to do), and no frame ever computed ellipsis.
    const ellipsisFrames = headerEllipsis.filter(r => +r[1] > 0).length
    const pinnedFrames = headerEllipsis.filter(r => +r[0] > 0).length
    const clipFrames = headerEllipsis.filter(r => +r[2] > 0).length
    check('a pinned box clips instead of trailing an ellipsis', pinnedFrames > 0 && clipFrames > 0 && ellipsisFrames === 0, { pinnedFrames, clipFrames, ellipsisFrames })
    await waitFor('location.pathname.startsWith("/products")', 4000)
    await sleep(600)

    // The widths this project has already had an overflow defect at, asked of the open sheet rather
    // than of the page: a bottom panel with two pills inside it is exactly where a 320px screen starts
    // pushing the document sideways.
    for (const [sw, sh] of [[320, 700], [390, 844], [640, 960]]) {
      await metrics(sw, sh, sw < 500)
      await sleep(350)
      if (!await ev('!!document.querySelector("[data-share-sheet]")')) { await clickSelector(stickyShare, sheetOpen); await waitFor(sheetAtRest) }
      const wide = await sheet()
      const wideGeo = await ev('(() => { const s = document.querySelector("[data-share-sheet]"); if (!s) return null; const r = s.getBoundingClientRect(); const rows = [...s.querySelectorAll("a,button")].map(b => b.getBoundingClientRect()); return { left: Math.round(r.left), right: Math.round(r.right), widest: rows.length ? Math.round(Math.max(...rows.map(b => b.width))) : 0, over: rows.filter(b => b.right > innerWidth + 1 || b.left < -1).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, scrollable: s.scrollHeight > s.clientHeight + 1, vh: innerHeight, bottom: Math.round(r.bottom) } })()')
      check(`the open sheet fits ${sw}px with no overflow and no clipped control`, !!wide && !!wideGeo && wideGeo.overflow <= 1 && wideGeo.over === 0 && wideGeo.left >= 0 && wideGeo.right <= sw + 1 && wideGeo.widest <= sw && Math.abs(wideGeo.bottom - wideGeo.vh) <= 1, { wideGeo })
      check(`the sheet keeps its copy rows and destinations at ${sw}px`, !!wide && wide.hasCopyLink && wide.hasCopyMessage && wide.rows.length === 2, { rows: wide && wide.rows.length })
    }
    await press('Escape', 'Escape', 27)
    await waitFor('!document.querySelector(\'[data-share-sheet]\')')
    await metrics(390, 844, true)
    await sleep(250)

    // ---- the sheet in Khmer -------------------------------------------------------------------
    // Every string in the sheet sits behind `t()`, and Khmer is the locale that proves it: the words
    // are longer, and wide Latin letter-spacing tears Khmer clusters apart (the rule the storefront
    // already follows for its eyebrows). The visit returns to English afterwards, because every check
    // below this one reads English copy.
    // Control first, while the page is still English: the same probe must read WIDE here (0.2em at the
    // 10px phone step = 2px), or the Khmer bound below would only be proving that a probe which never
    // fires is green. It has to run before the Khmer visit because that visit sets the locale cookie,
    // and `redirectOn: 'root'` would send an unprefixed `/` back to `/km/`.
    await nav(new URL('/', appUrl).href)
    await waitFor('!!document.querySelector(\'main article p.uppercase\')')
    const enEyebrows = await ev('Array.from(document.querySelectorAll("main article p.uppercase")).map(p => parseFloat(getComputedStyle(p).letterSpacing))')
    check('the English card eyebrow is wide, so the Khmer bound has something to measure', enEyebrows.length > 0 && enEyebrows.every(px => px > 1.5), { enEyebrows })
    // The locale pill answers on pointer-down, because a locale switch is a remount plus a refetch and
    // the control is the only thing that *can* respond in that gap. Read `scale`, not `transform` —
    // Tailwind v4's scale utility writes the standalone property, which a transform read never sees.
    const pills = await ev(boxesExpr('div[data-language-switcher] a'))
    const kmPill = pills[1]
    await mouse('mousePressed', kmPill.x, kmPill.y, 1)
    await sleep(90)
    const pillPress = await ev('(() => { const a = document.querySelectorAll(\'div[data-language-switcher] a\')[1]; return getComputedStyle(a).scale })()')
    // Released away from the pill on purpose: a press and release over the same link would navigate,
    // and the run wants to make that trip through the pill itself two lines later.
    await mouse('mouseReleased', kmPill.x, kmPill.y + 320, 0)
    check('the locale pill answers on press, before the new page paints', /^0\.9/.test(pillPress), { pillPress })
    // ---- the switch: same page, same component, no round trip --------------------------------
    // A locale switch used to cost everything a page change costs: the component was rebuilt, the
    // catalog was fetched a second time for text the first response had already embedded, and Nuxt's
    // default scroll behaviour threw the visitor back to the masthead. It is now `setLocale()` on a
    // page keyed by the path *without* the locale prefix, which is a claim about three separate
    // mechanisms — Vue's page key, the data layer's computed, and `scrollToTop` — so all three are
    // measured on the same click. An expando on the page root is the cheapest honest identity probe:
    // it survives if and only if the same DOM node is still there. `resetW` is the request log the
    // admin flow already trusts. And the scroll is read *before* and *after*, with the smooth-scroll
    // rule in `main.css` asked to stay out of the way, because a `scrollTo` that animates would make
    // the before-read a lie.
    //
    // The switch is made from the KEYBOARD, and that is not a preference: the masthead is not sticky,
    // so scrolling the visitor down takes the pill's viewport coordinates with it. The first version
    // of this check measured the pill at `scrollY = 0`, scrolled to 600, then clicked those stale
    // coordinates — and landed on a product card, which dutifully navigated, rebuilt the page, fetched
    // and scrolled to top. Every one of the four assertions below went red for a bug in the test. A
    // focused link answers Enter wherever it sits in the page, and it is the path a keyboard visitor
    // takes anyway.
    await ev('(() => { const m = document.querySelector("main"); if (m) m.__localeProbe = "kept"; window.scrollTo({ top: 600, behavior: "instant" }); const p = document.querySelector(\'div[data-language-switcher] a:nth-of-type(2)\'); if (p) p.focus(); return true })()')
    await sleep(150)
    const yBefore = await ev('window.scrollY')
    const hBefore = await ev('document.documentElement.scrollHeight')
    const enTracking = await ev('(() => { const h = document.querySelector("h1"); return h ? getComputedStyle(h).letterSpacing : null })()')
    const pillFocused = await ev('document.activeElement === document.querySelector(\'div[data-language-switcher] a:nth-of-type(2)\')')
    // The decode is recorded, not read: "it cycled then settled" and "it painted the right string" are
    // indistinguishable in one read, and the page-wide version makes a second claim a single element
    // cannot — that the rest of the page moved too. So every frame captures the rail eyebrow's text *and*
    // how many text nodes currently hold a Greek or Cyrillic glyph, which is noise by construction: no
    // string on this storefront contains either script. Those two sets sit in the pool unprobed (every
    // platform's system font carries them), so the metric cannot go quiet on a machine with no Hanzi or
    // Hangul face — the optional scripts are a bonus, never the evidence. 110 frames outruns the whole
    // ~300ms cycle, so the read below never races it.
    await ev('(() => { window.__DECODE = []; window.__DECODE_DONE = false; var noise = /[\u0370-\u03FF\u0400-\u04FF]/; var rec = function () { var h = document.querySelector("aside p.uppercase"); var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); var n = 0; while (w.nextNode()) { var v = w.currentNode.nodeValue; if (v && noise.test(v)) n++ } var s = document.querySelector("[data-slot=value]"); var i = document.querySelector("input[type=text]"); window.__DECODE.push([h ? h.textContent : "-", n, noise.test(s ? s.textContent : "") ? 1 : 0, noise.test(i ? i.placeholder : "") ? 1 : 0, (document.querySelector("main article p.uppercase") || {}).textContent || "-", Math.round(performance.now())].join("\\u0001")); if (window.__DECODE.length < 110) requestAnimationFrame(rec); else window.__DECODE_DONE = true; }; requestAnimationFrame(rec); return true })()')
    await resetW()
    await press('Enter', 'Enter', 13)
    const switched = await waitFor('location.pathname.startsWith("/km")', 4000)
    const keptComponent = await ev('(() => { const m = document.querySelector("main"); return !!m && m.__localeProbe === "kept" })()')
    const yAfter = await ev('window.scrollY')
    const hAfter = await ev('document.documentElement.scrollHeight')
    const readsAfterSwitch = (await allW()).filter(w => w.method === 'GET' && w.p.startsWith('/api/'))
    check('a locale switch lands on the Khmer route without leaving the page', switched && pillFocused && keptComponent === true, { switched, pillFocused, keptComponent })
    check('a locale switch asks the server for nothing it already has', readsAfterSwitch.length === 0, { calls: seqOf(readsAfterSwitch) })
    // A shorter document — the Khmer text lands under a font the layout was not tuned on — clamps
    // the scroll position down, which is the browser keeping its own invariant, not lost state.
    // The bound is physical: a bug-free switch can move the scroll down by at most the height the
    // document lost, and never up. The heights are printed so a red run says which side it was on.
    const scrollDrift = yBefore - yAfter
    check('a locale switch keeps the place the visitor was reading', yBefore > 200 && scrollDrift <= 2 + Math.max(0, hBefore - hAfter) && scrollDrift >= -2, { yBefore, yAfter, hBefore, hAfter })
    await waitFor('window.__DECODE_DONE === true', 5000)
    const decodeRun = await ev('(() => { const h = document.querySelector("aside p.uppercase"); const label = h ? h.textContent : null; const all = []; const stamps = []; let prev = null; let eprev = null; let holdHead = 0; let run = 0; let holdCard = 0; let peak = 0; let last = 0; let sort = 0; let ph = 0; for (const row of (window.__DECODE || [])) { const c = row.split("\\u0001"); const t = c[0]; const n = +c[1]; const ms = +c[5]; sort += +c[2]; ph += +c[3]; peak = Math.max(peak, n); last = n; if (t === prev) { if (t !== label) run++ } else { holdHead = Math.max(holdHead, run); run = 0; all.push(t); stamps.push(ms); prev = t } if (c[4] !== eprev) { if (eprev !== null) holdCard = Math.max(holdCard, ms - (stamps[stamps.length - 1] ?? ms)); eprev = c[4] } } holdHead = Math.max(holdHead, run); const from = all.findIndex(t => /[\u1780-\u17FF]/.test(t)); const seen = from < 0 ? all : all.slice(from); const seg = new Intl.Segmenter("km", { granularity: "grapheme" }); const count = t => { let n = 0; for (const g of seg.segment(t)) n++; return n }; const want = label ? count(label) : 0; const sl = document.querySelector("[data-slot=value]"); return { first: all[0] ?? null, label, seen, want, peak, last, sort, ph, holdHead, holdCard, sortLabel: sl ? sl.textContent.trim() : null, off: seen.filter(t => count(t) !== want).length, noise: seen.filter(t => t !== label).length } })()')
    // One heading's cycle, asserted four ways: it must cycle (≥3 frames that are not the word), it must
    // land on the word (`ទិញតាមប្រភេទ` — proof the row re-resolved in place rather than
    // waiting for a refetch), the FIRST frame already in the new language must not be the word (the wave
    // defers each node's cycle by up to `STAGGER_MS * index`, and a deferred node otherwise paints the
    // translated string and sits on it until its turn — the flash this locks out), and every frame must
    // hold the same number of grapheme clusters, which is
    // the property `textClusters` exists to keep: `ខ្មែរ` is five codepoints in two clusters, and a
    // codepoint split strands a coeng (្) with nothing to subscript. That last one was written after a
    // deliberate sabotage — a regex for "a mark at the head of a cluster" stayed green on the broken
    // build, because UAX #29 binds a trailing coeng into the consonant before it. The frames before the
    // first Khmer one are the English heading the recorder watched up to the click, and they are left
    // out of the count assertion for the obvious reason — but `first` still has to name them, or the
    // check would pass on a heading that never changed language at all.
    check('the section heading decodes into the new language and settles on it', !!decodeRun.label
      && /[ក-៿]/.test(decodeRun.label)
      && typeof decodeRun.first === 'string' && !/[ក-៿]/.test(decodeRun.first)
      && decodeRun.noise >= 3
      && decodeRun.seen[0] !== decodeRun.label
      // Nothing sits still mid-decode. Counted in SAMPLES, not wall-clock: the recorder's cadence
      // bends under a loaded machine (the locale switch remounts the very page it is watching, and a
      // single slow frame used to read as a long hold). What the frozen-gibberish state really is, is
      // one string surviving many samples on the way TO the settle — the runs of the settled word
      // that fill the tail of the recording are the decode being done, not a hold, so only runs of a
      // not-yet-final string count. Deferring each node's first write left one random string standing
      // for up to `STAGGER_MS * STAGGER_WRAP` = 336ms, twenty-odd samples at the recorder's frame
      // cadence, so the bound is four: a stalled frame can add at most one, and the bug cannot stay
      // under it. The sidebar eyebrow is early in the wave and the card eyebrow is late, so the two
      // together sample both ends of it.
      && decodeRun.holdHead <= 4 && decodeRun.holdCard <= 140
      && decodeRun.seen[decodeRun.seen.length - 1] === decodeRun.label
      && decodeRun.off === 0 && decodeRun.want >= 2, { decodeRun })
    // The page-wide half, which is the claim the single element cannot make: at the peak, many text
    // nodes are mid-noise at the same instant, and by the end none of them is. `peak >= 5` is a floor
    // and not a census on purpose — a run where only the eyebrow decoded (what this was before the
    // observer) fails it, while a throttled CI machine that catches fewer frames still passes.
    check('the whole page decodes, not one label', decodeRun.peak >= 5 && decodeRun.last === 0, { peak: decodeRun.peak, last: decodeRun.last })
    // The two the page-wide sweep used to miss, named rather than counted, because both were reported
    // as "still static" and a node count cannot tell you which one stayed behind: the sort control's
    // label arrives inside a re-rendered *element* (Reka rebuilds the trigger subtree), and the search
    // field's placeholder is an *attribute* — not a text node at all, on either path. The selector is
    // Nuxt UI's slot name, not `aria-haspopup`: this `USelect` renders Reka's trigger without one, and
    // a selector that matches nothing reports zero frames exactly like a control that never decodes.
    check('the sort control and the search placeholder decode too', decodeRun.sort >= 2 && decodeRun.ph >= 2, { sortFrames: decodeRun.sort, placeholderFrames: decodeRun.ph, sortFound: decodeRun.sortLabel })
    // The masthead heading is "Collection Bin" in both locales, so it keeps its display tracking on
    // the Khmer route — the guard reads the string, not the route. Compared against the same element
    // measured on the English route, and required to be *some* tracking: two zeros would pass the
    // equality and prove nothing.
    const kmTracking = await ev('(() => { const h = document.querySelector("h1"); return h ? getComputedStyle(h).letterSpacing : null })()')
    const trackPx = v => v === 'normal' ? 0 : parseFloat(v) || 0
    check('the Latin brand heading keeps its EN tracking on the Khmer route, and it is not zero',
      kmTracking === enTracking && trackPx(kmTracking) > 0.5, { enTracking, kmTracking })
    // And the observer has to be gone once the settle is over: after this point a text change is a
    // keystroke, a filter or a re-render, and none of them is a language change. Written by hand so
    // nothing else can be blamed for the result, and read back after the window would have closed.
    await ev('(() => { const h = document.querySelector("aside p.uppercase"); if (h && h.firstChild) h.firstChild.nodeValue = "MUTATED"; return true })()')
    await sleep(320)
    const afterSettle = await ev('(() => { const h = document.querySelector("aside p.uppercase"); return h ? h.textContent : null })()')
    check('an ordinary text change after the settle is not decoded', afterSettle === 'MUTATED', { afterSettle })
    await nav(new URL('/km/products/' + G.manyId, appUrl).href)
    await waitFor('!!document.querySelector(\'[data-sticky-cta] [data-share-cta]\')')
    await clickSelector('[data-sticky-cta] [data-share-cta]', sheetOpen)
    await waitFor(sheetAtRest)
    const kmSheet = await sheet()
    const kmType = await ev('(() => { const s = document.querySelector("[data-share-sheet]"); if (!s) return null; const p = [...s.querySelectorAll("p")].find(x => /^ចែករំលែក/.test((x.textContent || "").trim())); if (!p) return null; const c = getComputedStyle(p); return { tracking: c.letterSpacing, transform: c.textTransform } })()')
    check('the sheet speaks Khmer when the page does', !!kmSheet && kmSheet.text.includes('ចម្លងតំណ') && kmSheet.text.includes('ចែករំលែក'), { text: kmSheet && kmSheet.text.slice(0, 90) })
    check('the Khmer sheet carries no wide Latin tracking and does not widen the page', !!kmType && kmType.transform === 'none' && (kmType.tracking === 'normal' || parseFloat(kmType.tracking) <= 0.5) && !!kmSheet && kmSheet.overflow <= 1, { kmType, overflow: kmSheet && kmSheet.overflow })
    await press('Escape', 'Escape', 27)
    await waitFor('!document.querySelector(\'[data-share-sheet]\')')
    // The same rule on the storefront itself, using the shared sweeps defined above. Control first,
    // while the page is still English: the card eyebrows must compute wide (0.2em at the 10px phone
    // step = 2px), or a sweep that returns nothing would be green forever. Note what the sweeps
    // deliberately do NOT fail — on a Khmer route a category with no Khmer row still prints Latin, and
    // that Latin keeps its wide tracking on purpose.
    await nav(new URL('/km/', appUrl).href)
    await waitFor('!!document.querySelector(\'main article p.uppercase\')')
    const kmHomeWide = await latinSpacedKhmer()
    check('no Khmer run on the Khmer home is letter-spaced like Latin', kmHomeWide.bad.length === 0 && kmHomeWide.seen > 5, { kmHomeWide })
    // Positive control for the negative half of the bound. "Every Khmer run is unspaced" and "the sweep
    // cannot see a squeeze" print the same green line, and this file has already been bitten by exactly
    // that — so crowd one Khmer run, require the real sweep to name it, then hand the element back.
    const kmSqueezeArmed = await ev('(() => { const el = [...document.querySelectorAll("body *")].find(n => [...n.childNodes].some(c => c.nodeType === 3 && /[\\u1780-\\u17FF]/.test(c.textContent || ""))); if (!el) return false; window.__KMEL = el; el.style.letterSpacing = "-0.5px"; return true })()')
    const kmSqueezed = await latinSpacedKhmer()
    await ev('(() => { if (window.__KMEL) window.__KMEL.style.letterSpacing = ""; return true })()')
    check('the sweep reports a Khmer run squeezed by negative tracking', kmSqueezeArmed === true && kmSqueezed.bad.length === 1 && kmSqueezed.bad[0].em < 0, { bad: kmSqueezed.bad })
    const kmHomeClipped = await clippedInk()
    check('no Khmer run on the Khmer home is clipped by its own box', kmHomeClipped.bad.length === 0, { kmHomeClipped })
    // The locale a card links to is the bug this guards. A hardcoded `/products/<id>` is the *English*
    // route under `prefix_except_default`, so a Khmer visitor clicking a listing was handed English
    // until they found the storefront again. Assert the href carries the prefix, then follow it and
    // assert the page it lands on is still Khmer — a link that only looks right in the DOM fails there.
    // The other half of the page-key rule: a *real* navigation is still a real navigation. Same probe
    // as the locale switch, planted on the Khmer home page before the card is followed — if it survived
    // here, the key would be swallowing genuine page changes and every product link would be an
    // in-place swap that never re-reads. The request log is the second half of that: a card click has
    // to fetch, or the detail page would render the home page's cache.
    await ev('(() => { const m = document.querySelector("main"); if (m) m.__localeProbe = "kept"; return true })()')
    await resetW()
    const kmHref = await ev('(() => { const a = document.querySelector("main article a[href]"); return a ? a.getAttribute("href") : null })()')
    check('a Khmer card links into the Khmer route', typeof kmHref === 'string' && kmHref.startsWith('/km/products/'), { kmHref })
    await clickSelector('main article a[href]', 'location.pathname.startsWith("/km/products/")')
    await waitFor('!!document.querySelector(\'[data-product-gallery]\')')
    const rebuilt = await ev('(() => { const m = document.querySelector("main"); return !m || m.__localeProbe !== "kept" })()')
    const readsAfterCard = (await allW()).filter(w => w.method === 'GET' && w.p.startsWith('/api/'))
    check('a product navigation rebuilds the page and reads again', rebuilt === true && readsAfterCard.length > 0, { rebuilt, calls: seqOf(readsAfterCard).slice(0, 3) })
    check('following that card keeps the detail page in Khmer', await ev('(() => { const p = location.pathname; const khmer = /[\u1780-\u17FF]/.test(document.body.innerText); return p.startsWith("/km/products/") && khmer })()'), { href: kmHref })
    const kmDetailWide = await latinSpacedKhmer()
    check('no Khmer run on the Khmer detail page is letter-spaced like Latin', kmDetailWide.bad.length === 0 && kmDetailWide.seen > 5, { kmDetailWide })
    const kmDetailClipped = await clippedInk()
    check('no Khmer run on the Khmer detail page is clipped by its own box', kmDetailClipped.bad.length === 0, { kmDetailClipped })
    // The primary action in Khmer, measured rather than read: the copy pass shortened `contactToOrder`
    // (ទំនាក់ទំនង → ទាក់ទង), and the phone row is the one place a longer order label
    // had to share width with Share inside a 44px control. Same three numbers the English sticky bar is
    // held to — label unclipped, control height, no page widening.
    await waitFor('!!document.querySelector(\'[data-sticky-cta] [data-contact-cta]\')')
    const kmSticky = await ev('(() => { const ctl = document.querySelector("[data-sticky-cta] [data-contact-cta]"); if (!ctl) return null; const label = ctl.querySelector("span") || ctl; const r = ctl.getBoundingClientRect(); return { text: (label.textContent || "").trim(), clip: label.scrollWidth - label.clientWidth, h: Math.round(r.height), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    check('the Khmer order action reads Khmer, stays whole and keeps the 44px control', !!kmSticky && /[\u1780-\u17FF]/.test(kmSticky.text) && kmSticky.clip <= 0 && kmSticky.h === C.sticky.controlHeight && kmSticky.overflow <= 1, { kmSticky })
    // The Sale ribbon is the label that clips by construction: `truncate` sets overflow hidden on a
    // `text-[10px] leading-[14px]` band. It paints only while a promotion runs, and the campaign has
    // to be *unnamed*, because a Latin promo label would render Latin and prove nothing about Khmer.
    const kmRibbonArm = await forNextDocument('var p = window.__PRODUCTS[0]; p.promo_price = "19.00"; p.promo_label = null; p.promo_quantity = null; p.promo_starts_at = "2000-01-01T00:00:00.000Z";')
    await nav(new URL('/km/', appUrl).href)
    await waitFor('!!document.querySelector(\'[data-sale-ribbon]\')')
    const kmRibbon = await ev('(() => { const el = document.querySelector("[data-sale-ribbon] span"); if (!el) return null; const own = (el.textContent || "").trim(); const c = getComputedStyle(el); const cv = document.createElement("canvas").getContext("2d"); cv.font = c.fontWeight + " " + c.fontSize + " " + c.fontFamily; const m = cv.measureText(own); return { text: own, ink: +(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent).toFixed(1), lh: +parseFloat(c.lineHeight).toFixed(1), em: +(c.letterSpacing === "normal" ? 0 : parseFloat(c.letterSpacing) / parseFloat(c.fontSize)).toFixed(3) } })()')
    check('the Khmer Sale ribbon fits the band it is cut from and carries no tracking at all', !!kmRibbon && /[\u1780-\u17FF]/.test(kmRibbon.text) && kmRibbon.ink <= kmRibbon.lh + 0.5 && kmRibbon.em <= 0.005, { kmRibbon })
    // The transform guard, asked while the ribbon is guaranteed on screen and a real decode is running:
    // the band is `-rotate-45`, so its bounding rect is the bounds of a diamond, and writing that back
    // as a layout size turns the ribbon into a stub — the deformation reported as "it breaks the
    // promotion bow tag". Flipping the locale here rather than counting nodes in the recording above,
    // because a ribbon that is simply absent would pass a count (`ribbonFrames: 0` did exactly that).
    await ev('(() => { window.__RB = []; const tick = () => { const b = document.querySelector("[data-sale-ribbon] > span"); window.__RB.push(b ? (b.style.width !== "" || b.style.height !== "" ? 1 : 0) : -1); if (window.__RB.length < 90) requestAnimationFrame(tick); else window.__RBdone = true }; requestAnimationFrame(tick); return true })()')
    await ev('(() => { const p = document.querySelector(\'div[data-language-switcher] a:nth-of-type(1)\'); if (p) p.focus(); return true })()')
    await press('Enter', 'Enter', 13)
    await waitFor('window.__RBdone === true', 8000)
    const ribbonHold = await ev('(() => { const r = window.__RB || []; return { frames: r.filter(v => v >= 0).length, sized: r.filter(v => v === 1).length, path: location.pathname } })()')
    check('the rotated sale ribbon is never sized from its own transformed rect', ribbonHold.frames > 0 && ribbonHold.sized === 0, ribbonHold)
    // Back into Khmer, because the ribbon's own assertion above and the checks after it read Khmer copy.
    await ev('(() => { const p = document.querySelector(\'div[data-language-switcher] a:nth-of-type(2)\'); if (p) p.focus(); return true })()')
    await press('Enter', 'Enter', 13)
    await waitFor('location.pathname.startsWith("/km/")', 8000)
    await sleep(1400)
    await stopForNextDocument(kmRibbonArm)
    // The hole a locale-keyed guard cannot see: this product now has *no* English row, so on the
    // unprefixed (English) route its name and its category eyebrow both render Khmer — and the
    // eyebrow they render through is the wide-tracking branch of the ternary.
    const kmNameArm = await forNextDocument('var p = window.__PRODUCTS[0]; p.product_translations = [{ id: "dddddddd-0000-4000-8000-000000000101", locale: "km", name: "ក្តារចុច Verify Keyboard", short_description: "ក្តារចុចសម្រាប់សាកល្បង", description: "ផលិតផលសម្រាប់តេស្ត", specifications: null }]; p.categories.category_translations = [{ id: "ffffffff-0000-4000-8000-000000000301", locale: "km", name: "ក្តារចុច" }];')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-product-gallery]\')')
    const enRouteKhmer = await latinSpacedKhmer()
    check('a Khmer name on the English route is not letter-spaced like Latin', enRouteKhmer.bad.length === 0 && enRouteKhmer.seen > 0, { enRouteKhmer })
    const enRouteKhmerClipped = await clippedInk()
    check('a Khmer name on the English route is not clipped by its own box', enRouteKhmerClipped.bad.length === 0, { enRouteKhmerClipped })
    // The same product on the English *home*, where the card eyebrow is the other site that keys off
    // the locale. The cookie has to be written for `/` to serve English at all — after the Khmer
    // visit `redirectOn: 'root'` would send an unprefixed `/` straight back to `/km/`.
    await ev('document.cookie = "raccoon-gear-bin-locale=en; path=/"; true')
    await nav(new URL('/', appUrl).href)
    await waitFor('!!document.querySelector(\'main article p.uppercase\')')
    const enCardWide = await latinSpacedKhmer()
    check('a Khmer category name on an English card eyebrow is not letter-spaced like Latin', enCardWide.bad.length === 0 && enCardWide.seen > 0, { enCardWide })
    await stopForNextDocument(kmNameArm)
    await nav(new URL('/km/', appUrl).href)
    await waitFor('!!document.querySelector(\'main article p.uppercase\')')
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-sticky-cta] [data-share-cta]\')')
    check('the page is back in English for the checks that follow', (await stickyMount()).ctaText === C.cta.in, { cta: (await stickyMount()).ctaText })

    await ev('window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); true')
    await sleep(450)
    // The last real content above the fold (the specifications block) is what the bar must leave
    // clear: the inline conversion block sits under it, but below `lg` that block is not painted
    // and the sticky bar *is* the conversion UI, so the page has to end in something readable.
    const clearance = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); const dl = document.querySelector("main dl") || document.querySelector("main pre"); const b = bar.getBoundingClientRect(); const d = dl ? dl.getBoundingClientRect() : null; return { atEnd: window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2, barTop: Math.round(b.top), dlBottom: d ? Math.round(d.bottom) : null, gap: d ? Math.round(b.top - d.bottom) : null } })()')
    check('at the end of the page the sticky bar leaves the product content clear of itself', clearance.atEnd && clearance.dlBottom !== null && clearance.dlBottom <= clearance.barTop + 1, clearance)

    // ---- thumb-reach exits from the phone sheet ------------------------------------------------
    // The bottom Close row and the swipe-down handle belong to the sheet only (the desktop-absence
    // of the row is asserted in the popover section). A slow short pull is below both gates and
    // must snap back; a long pull dismisses; the header's own buttons stay clickable under the
    // handle's pointer capture.
    await clickSelector('[data-sticky-cta] [data-share-cta]', sheetOpen)
    await waitFor(sheetAtRest)
    const sheetGeo = await ev('(() => { const s = document.querySelector("[data-share-sheet]"); const b = s && s.querySelector("[data-share-close-bottom]"); const d = s && s.querySelector("[data-share-drag]"); if (!b || !d) return null; const r = b.getBoundingClientRect(); const dr = d.getBoundingClientRect(); return { centre: Math.round(r.top + r.height / 2), gapToBottom: Math.round(innerHeight - r.bottom), width: Math.round(r.width), grabX: Math.round(dr.left + dr.width / 2), grabY: Math.round(dr.top + 8), vh: innerHeight } })()')
    check('the phone sheet repeats its Close at the bottom edge, within thumb reach', !!sheetGeo && sheetGeo.gapToBottom < 140 && sheetGeo.width > 100 && sheetGeo.centre > sheetGeo.vh * 0.6, { sheetGeo })
    const bottomClose = (await ev(boxesExpr('[data-share-sheet] [data-share-close-bottom]')))[0]
    await clickAt(bottomClose.x, bottomClose.y)
    check('the bottom Close row dismisses the sheet', await waitFor('!document.querySelector(\'[data-share-sheet]\')'))
    await sleep(300)
    await clickSelector('[data-sticky-cta] [data-share-cta]', sheetOpen)
    await waitFor(sheetAtRest)
    const grabAt = { x: sheetGeo.grabX, y: sheetGeo.grabY }
    await touch('touchStart', [grabAt])
    for (let i = 1; i <= 3; i++) { await touch('touchMove', [{ x: grabAt.x, y: grabAt.y + i * 12 }]); await sleep(80) }
    await touch('touchEnd', [])
    await waitFor(sheetAtRest, 1500)
    const pulled = await ev('(() => { const s = document.querySelector("[data-share-sheet]"); if (!s) return { open: false }; const t = getComputedStyle(s).transform; const settled = t === "none" || (() => { const m = new DOMMatrixReadOnly(t); return Math.abs(m.a - 1) < 0.02 && Math.abs(m.d - 1) < 0.02 && Math.abs(m.e) < 2 && Math.abs(m.f) < 2 })(); return { open: true, settled, tr: t } })()')
    check('a short slow pull on the handle snaps the sheet back instead of dismissing', pulled.open === true && pulled.settled === true, { pulled })
    await touch('touchStart', [grabAt])
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: grabAt.x, y: grabAt.y + i * 30 }]); await sleep(30) }
    await touch('touchEnd', [])
    check('swiping the handle down dismisses the sheet', await waitFor('!document.querySelector(\'[data-share-sheet]\')'))
    await sleep(300)

    await ev('window.scrollTo({ top: 0, behavior: "instant" }); true')
    await sleep(350)
    const zoomMobile = (await ev(boxesExpr('[data-gallery-zoom]')))[0]
    await clickAt(zoomMobile.x, zoomMobile.y)
    await waitFor('!!document.querySelector("[data-lightbox]")')
    const stacked = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); const lb = document.querySelector("[data-lightbox]"); const r = bar.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { barZ: getComputedStyle(bar).zIndex, lbZ: getComputedStyle(lb).zIndex, covered: !!lb && lb.contains(hit), hit: hit ? hit.tagName : null } })()')
    check('the sticky CTA never paints above the gallery lightbox', stacked.covered && Number(stacked.barZ) < Number(stacked.lbZ), stacked)
    await press('Escape', 'Escape', 27)
    check('Escape still closes the lightbox with the sticky bar on screen', await waitFor('!document.querySelector("[data-lightbox]")'))

    // Same action, not a second implementation of it: the sticky panel must offer what the inline
    // block offers and its copy must go through the same code path. The inline block cannot be
    // opened at this width any more — it is the mount the breakpoint switched off — so the
    // comparison is built from a fresh desktop visit that opens it where it does live.
    await metrics(1440, 900, false)
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-contact-cta]\')')
    const inlineNow = await openInlinePanel()
    // Dismiss it before resizing: `display: none` hides the inline panel without unmounting it,
    // and a stale node would let the next wait expression pass without the sticky click doing anything.
    await press('Escape', 'Escape', 27)
    await metrics(390, 844, true)
    await sleep(250)
    await armClipboard('ok')
    // The phone mount must read as the same surface as the desktop one, so it blooms on the same
    // preset, mirrored: it hangs off the bottom edge of the sticky bar, so it grows from `center
    // bottom` on `applePop.above` — while its transition is `applePop.phone`, a bezier, because the
    // spring's generated easing is the shape iOS runs off its compositor (the device report: this
    // enter low fps, its own bezier exit smooth, the spring-driven sheet low fps both ways). The
    // frost trace below is history with a structural answer: the bar's material is a sibling layer
    // under the controls (`data-sticky-frost`), so the panel never animates inside a
    // `backdrop-filter` element. A travel-only shape once stood in for the bloom — a scale inside the
    // bar's `backdrop-blur-xl` re-runs the filter pass every frame (traced at 390x844 @3x with a 4x
    // CPU throttle: 28.9ms of main-thread Layout+Paint+PrePaint over four plays, against 19.0-20.7ms
    // for any shape that dropped either half) — and is not coming back. The lock is the OPPOSITE of
    // the one it replaces: the bloom must run (a frame uniform-scaled below 1), with the travel and
    // the fade riding along. Sampled frame by frame rather than at rest, because a settled panel
    // reports the identity matrix whatever curve got it there.
    const START_STICKY_FRAMES = '(() => { window.__KF = []; window.__KFdone = false; window.__KA = null; const t0 = performance.now(); const tick = function () { const p = document.querySelector("[data-sticky-cta] [data-contact-panel]"); if (p) { if (!window.__KA) { for (const a of document.getAnimations()) { if (a.effect && a.effect.target === p) { window.__KA = String(a.effect.getComputedTiming().easing); break } } } const c = getComputedStyle(p); const m = new DOMMatrixReadOnly(c.transform); window.__KF.push({ a: +m.a.toFixed(3), d: +m.d.toFixed(3), f: +m.f.toFixed(1), o: +c.opacity }) } if (performance.now() - t0 < 700) requestAnimationFrame(tick); else window.__KFdone = true }; requestAnimationFrame(tick); return true })()'
    await ev(START_STICKY_FRAMES)
    await clickSelector('[data-sticky-cta] [data-contact-cta]', '!!document.querySelector("[data-sticky-cta] [data-contact-panel]")')
    await waitFor('!!window.__KFdone', 4000)
    const kframes = await ev('window.__KF || []')
    const kBloom = kframes.filter(f => f.a > 0.5 && f.a < 0.995)
    check('the mobile panel blooms out of the bar on the shared preset: uniform scale, travel, its own fade', kframes.length > 3 && kBloom.length > 0 && kBloom.every(f => Math.abs(f.a - f.d) <= 0.01) && kframes.some(f => Math.abs(f.f) >= 2) && kframes.some(f => f.o > 0.02 && f.o < 0.98), { frames: kframes.slice(0, 5) })
    const kEase = await ev('window.__KA')
    check('the panel enters on a bezier the compositor takes, not a generated spring curve', typeof kEase === 'string' && kEase.length > 0 && !kEase.startsWith('linear('), { kEase })
    // And the leave has to actually retract: the phone panel dismisses with the same genie the desktop
    // one uses, collapsing into the CTA that sits in the bar right under it. Before this lock the
    // phone exit was the preset's own `.to` shrink — 4% — which under a 240ms fade read as the panel
    // simply switching off: it popped out but never popped in. The bound is 0.8 with the two axes 0.2
    // apart rather than the desktop's 0.75: the phone's collapse ratio is its CTA-to-panel widths
    // (~0.72), so a 0.75 line sits a rounding error from the real geometry, while a fade-only or
    // uniform exit reads `a ≈ d ≈ 1` and fails either way.
    const START_STICKY_LEAVE = '(() => { window.__KL = []; window.__KLdone = false; const t0 = performance.now(); const tick = function () { const p = document.querySelector("[data-sticky-cta] [data-contact-panel]"); if (p) { const c = getComputedStyle(p); const m = new DOMMatrixReadOnly(c.transform); window.__KL.push({ a: +m.a.toFixed(3), d: +m.d.toFixed(3), o: +c.opacity }) } if (performance.now() - t0 < 700) requestAnimationFrame(tick); else window.__KLdone = true }; requestAnimationFrame(tick); return true })()'
    const stickyOpen = await stickyMount()
    check('the sticky panel offers the same channels and the same message as the inline block', JSON.stringify(stickyOpen.channels.map(c => c.href)) === JSON.stringify(inlineNow.channels.map(c => c.href)) && stickyOpen.message === inlineNow.message && stickyOpen.ctaText === inlineNow.ctaText, { channels: stickyOpen.channels.map(c => c.href), cta: stickyOpen.ctaText })
    // Two things the desktop-only geometry checks could not see, both found by looking at the page:
    // the floating panel must be opaque (a translucent wash over the product photo is unreadable,
    // and two background utilities in one class list resolve by stylesheet order, not by intent),
    // and the prepared message must fit its own field (the URL wraps at a phone width).
    const surface = await ev('(() => { const p = document.querySelector("[data-sticky-cta] [data-contact-panel]"); if (!p) return null; const c = getComputedStyle(p); const f = p.querySelector("[data-contact-message]"); const r = p.getBoundingClientRect(); return { bg: c.backgroundColor, fieldClip: f ? f.scrollHeight - f.clientHeight : null, fieldH: f ? Math.round(f.getBoundingClientRect().height) : 0, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight } })()')
    check('the floating mobile panel is opaque rather than a translucent wash', !!surface && !/\/\s*0\./.test(surface.bg), surface)
    check('the mobile panel shows the whole prepared message and stays entirely on screen', !!surface && surface.fieldClip <= 1 && surface.top >= 0 && surface.bottom <= surface.vh + 1, surface)
    // The phone panel floats above the bar, so its arrow has to hang off the panel's BOTTOM edge and
    // line up with the CTA pill sitting in that bar — the same "which button is this" answer the
    // desktop panels give, hung at the other end because the geometry is upside down there.
    const stickyCaret = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); if (!bar) return null; const c = bar.querySelector("[data-panel-caret]"); const p = bar.querySelector("[data-contact-panel]"); const b = bar.querySelector("[data-contact-cta]"); if (!c || !p || !b) return null; const cr = c.getBoundingClientRect(), pr = p.getBoundingClientRect(), br = b.getBoundingClientRect(); return { dx: Math.round(cr.left + cr.width / 2 - (br.left + br.width / 2)), onEdge: Math.round(cr.top + cr.height / 2 - pr.bottom) } })()')
    check('the mobile panel hangs its arrow off its bottom edge, aimed at the bar\u2019s CTA', !!stickyCaret && Math.abs(stickyCaret.dx) <= 2 && Math.abs(stickyCaret.onEdge) <= 2, { stickyCaret })
    // The frost is a sibling layer, never an ancestor of the controls: an animated descendant of a
    // `backdrop-filter` element re-runs that filter pass every frame, the shape the phone pop exists
    // to avoid. The layer must also still cover the bar's exact box, or the material has quietly
    // stopped being the bar's skin.
    const frostShape = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); const f = document.querySelector("[data-sticky-frost]"); if (!bar || !f) return null; const b = bar.getBoundingClientRect(), r = f.getBoundingClientRect(); return { bars: Math.round(Math.abs(b.width - r.width) + Math.abs(b.height - r.height) + Math.abs(b.top - r.top)), inside: !!f.querySelector("[data-contact-cta], [data-contact-panel], [data-panel-caret]"), barFilter: getComputedStyle(bar).backdropFilter, frostFilter: getComputedStyle(f).backdropFilter } })()')
    check('the bar\u2019s frost is a sibling layer under the controls, never their ancestor', !!frostShape && frostShape.bars <= 2 && !frostShape.inside && frostShape.barFilter === 'none' && frostShape.frostFilter !== 'none', { frostShape })
    const beforeStickyCopy = (await copies()).length
    const expectStickyFeedback = value => '((document.querySelector("[data-sticky-cta] [data-contact-feedback]") || {}).textContent || "").trim() === ' + value
    await clickSelector('[data-sticky-cta] [data-copy-message]', expectStickyFeedback(JSON.stringify(C.feedback.copied)))
    const afterStickyCopy = await copies()
    check('the sticky copy runs the shared action and writes the same message', afterStickyCopy.length === beforeStickyCopy + 1 && afterStickyCopy[afterStickyCopy.length - 1] === inlineNow.message, { added: afterStickyCopy.length - beforeStickyCopy, copied: norm(afterStickyCopy[afterStickyCopy.length - 1] || '') })
    const speakers = await mounts()
    const stickySpeaker = speakers.find(m => m.where === 'sticky') || { ...NO_MOUNT }
    const inlineSpeaker = speakers.find(m => m.where === 'inline') || { ...NO_MOUNT }
    check('only the mount the visitor used announces the copy', stickySpeaker.feedback === C.feedback.copied && inlineSpeaker.feedback === '', speakers.map(m => [m.where, m.feedback]))

    const stickyPanelGone = '!document.querySelector("[data-sticky-cta] [data-contact-panel]")'
    await press('Escape', 'Escape', 27)
    // The panel now leaves through a transition, so it is still in the DOM for a few frames after
    // Escape. Every read that means "it is closed" has to wait for the departure, or it measures the
    // animation rather than the state.
    check('Escape closes the sticky panel and leaves focus on the control', await waitFor(stickyPanelGone) && await ev('(() => { const el = document.activeElement; return !!el && el.getAttribute("data-contact-cta") !== null })()'))
    // Escape has to hand focus back to the control that opened the panel rather than dropping the
    // visitor at the top of the tab order. The inline block is no longer painted at this width,
    // so the bar's own panel is the one that answers — and a hidden field cannot take focus to be
    // accidentally closed from anyway.
    await clickSelector('[data-sticky-cta] [data-contact-cta]', '!!document.querySelector("[data-sticky-cta] [data-contact-panel]")')
    await ev('(() => { const el = document.querySelector("[data-sticky-cta] [data-contact-message]"); if (el) el.focus(); return true })()')
    await ev(START_STICKY_LEAVE)
    await press('Escape', 'Escape', 27)
    await waitFor(stickyPanelGone)
    check('Escape closes the mobile panel and hands focus back to the control that opened it', await ev('(() => { const el = document.activeElement; return !!el && el.getAttribute("data-contact-cta") !== null })()'), { active: await ev('(() => { const el = document.activeElement; return el ? el.tagName : null })()') })
    await waitFor('!!window.__KLdone', 4000)
    const lframes = await ev('window.__KL || []')
    check('the mobile panel collapses into its CTA on leave, not just a fade', lframes.length > 3 && lframes.some(f => f.a < 0.8 && Math.abs(f.d - f.a) > 0.2) && lframes.some(f => f.o > 0.02 && f.o < 0.98), { n: lframes.length, minA: lframes.length ? Math.min(...lframes.map(f => f.a)) : null, minD: lframes.length ? Math.min(...lframes.map(f => f.d)) : null, first: lframes.slice(0, 4), last: lframes.slice(-4) })
    // Tab reaches the bar's own controls from its field, and every stop in the bar wears a ring:
    // with the inline block switched off at this width, the panel and its buttons are the tab
    // path through the bar, and one of the two surfaces the visitor can reach must be lit.
    await clickSelector('[data-sticky-cta] [data-contact-cta]', '!!document.querySelector("[data-sticky-cta] [data-contact-panel]")')
    await ev('(() => { const el = document.querySelector("[data-sticky-cta] [data-contact-message]"); if (el) el.focus(); return true })()')
    await press('Tab', 'Tab', 9)
    const focused = await ev('(() => { const el = document.activeElement; const c = getComputedStyle(el); return { inSticky: !!(el.closest && el.closest("[data-sticky-cta]")), painted: el.getClientRects().length > 0, tag: el.tagName, shadow: c.boxShadow, outline: c.outlineWidth + " " + c.outlineStyle } })()')
    check('Tab moves through the sticky bar onto a painted control with a visible focus ring', focused.inSticky && focused.painted && focused.tag === 'BUTTON' && (focused.shadow !== 'none' || !/^0px none/.test(focused.outline)), focused)
    // A `keydown` carrying no `text` produces no `keypress`, and it is the keypress that activates
    // a native button in Blink — without it Enter lands on the control and nothing happens.
    // Close first, so Enter is genuinely opening the panel here rather than toggling it shut.
    await press('Escape', 'Escape', 27)
    await ev('(() => { const el = document.querySelector("[data-sticky-cta] [data-contact-cta]"); if (el) el.focus(); return true })()')
    await press('Enter', 'Enter', 13, '\r')
    const entered = await stickyMount()
    check('the keyboard opens the sticky channel panel', entered.panelOpen, { expanded: entered.expanded, panel: entered.panelOpen, mount: entered.where, panels: await ev('document.querySelectorAll("[data-contact-panel]").length'), active: await ev('(() => { const el = document.activeElement; return el ? el.tagName + " sticky:" + !!(el.closest && el.closest("[data-sticky-cta]")) : null })()') })
    await press('Escape', 'Escape', 27)
    await waitFor(stickyPanelGone)
    await ev('(() => { const el = document.querySelector("[data-sticky-cta] [data-copy-message]") || document.querySelector("[data-sticky-cta] [data-contact-cta]"); if (el) el.focus(); return true })()')
    let leftBar = false
    for (let i = 0; i < 3 && !leftBar; i++) { await press('Tab', 'Tab', 9); leftBar = await ev('(() => { const el = document.activeElement; return !el || !el.closest || !el.closest("[data-sticky-cta]") })()') }
    check('the sticky bar does not trap keyboard focus', leftBar)

    // ---- six widths, both colour schemes -------------------------------------------------------
    // One check per viewport that names what went wrong, in the style of the masthead sweep: the
    // breakpoint, the control height, the overflow and the theme are four separate regressions that
    // all read as "the page looks wrong" in a screenshot and as nothing at all in a build.
    // 320 is in the list because the browser pass found 5px of sideways scroll there and nowhere
    // else: a grid item's intrinsic width, which no wider viewport is short enough to reveal.
    await metrics(1440, 900, false)
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-contact-cta]\')')
    const surfaces = {}
    for (const [w, h] of [[1440, 900], [1280, 900], [1024, 900], [834, 1112], [640, 960], [390, 844], [320, 700]]) {
      for (const scheme of ['light', 'dark']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
        await metrics(w, h, w < 500)
        await sleep(600)
        // The CTA question is asked of whichever mount the breakpoint paints: below `lg` that is
        // the bar's, at `lg` and above the inline block's — the hidden one has no rect and would
        // read as a 0px control if it were measured blindly.
        const r = await ev('(() => { const dark = document.documentElement.classList.contains("dark"); const bar = document.querySelector("[data-sticky-cta]"); const cta = (bar && bar.getClientRects().length && bar.querySelector("[data-contact-cta]")) || [...document.querySelectorAll("[data-contact-cta]")].find(el => el.getClientRects().length) || null; const share = document.querySelector("[data-share-cta]"); const cr = cta ? cta.getBoundingClientRect() : null; const cc = cta ? getComputedStyle(cta) : null; const sc = share ? getComputedStyle(share) : null; const bc = bar ? getComputedStyle(bar) : null; const bf = document.querySelector("[data-sticky-frost]"); const bfc = bf ? getComputedStyle(bf) : null; const br = bar ? bar.getBoundingClientRect() : null; return { dark, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth, ctaShown: !!cta && cta.getClientRects().length > 0, ctaH: cr ? Math.round(cr.height) : 0, ctaW: cr ? Math.round(cr.width) : 0, ctaBg: cc ? cc.backgroundColor : null, ctaFg: cc ? cc.color : null, shareBg: sc ? sc.backgroundColor : null, barShown: !!bar && br.width > 0 && bc.display !== "none", barBg: bfc ? bfc.backgroundColor : null, pageBg: getComputedStyle(document.body).backgroundColor, ctaText: cta ? (cta.textContent || "").trim() : null } })()')
        if (!surfaces[scheme]) surfaces[scheme] = { bar: r.barBg, cta: r.ctaBg, share: r.shareBg, page: r.pageBg }
        const faults = []
        if (r.overflow > 1) faults.push(`${r.overflow}px of horizontal overflow`)
        if (!r.ctaShown) faults.push(`no Contact CTA is painted at ${w}px`)
        if (r.ctaH !== C.sticky.controlHeight) faults.push(`the CTA is ${r.ctaH}px, a storefront control is ${C.sticky.controlHeight}px`)
        if (r.ctaW > r.vw - 32) faults.push(`the CTA is ${r.ctaW}px inside a ${r.vw}px viewport`)
        if (!r.ctaText) faults.push('the primary action has no name')
        if (r.ctaBg === r.ctaFg) faults.push('the primary action is invisible: fill equals its own text colour')
        if (r.barShown !== (w < 1024)) faults.push(`the sticky bar is ${r.barShown ? 'shown' : 'hidden'} at ${w}px`)
        // The two-rung rule: a bar that sits on the page may not be the page's own colour, or in
        // dark mode it is a hairline with a button floating in nowhere. The colour is read off the
        // bar's frost layer — since the material moved to `[data-sticky-frost]`, the wrapper itself
        // is a transparent box and reading it would compare nothing with nothing.
        if (r.barShown && r.barBg === r.pageBg) faults.push('the sticky bar is the same surface as the page it sits on')
        if ((scheme === 'dark') !== r.dark) faults.push(`a ${scheme} colour scheme did not reach the theme`)
        check(`the conversion UI fits, keeps its hierarchy and obeys its breakpoint @${w} ${scheme}`, faults.length === 0, faults.length ? faults : { ctaH: r.ctaH, ctaW: r.ctaW, barShown: r.barShown })
      }
    }
    check('the sticky bar and both controls change surface between light and dark', !!surfaces.light && !!surfaces.dark && surfaces.light.bar !== surfaces.dark.bar && surfaces.light.cta !== surfaces.dark.cta && surfaces.light.share !== surfaces.dark.share, surfaces)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'no-preference' }] })
    await metrics(1440, 900, false)

    // ---- the catalog page's contact dock (desktop corner) ---------------------------------------
    // `ContactDock.vue` resolves its rows through the same `getSiteContactChannels` the product page's
    // Contact to Order rows use, so the interesting failures are all invisible to a compiler: a row that
    // says it carried a message but carries `?text=` empty, a panel that opens over the viewport edge, a
    // control that leaks into the phone corner where the search launcher already lives, and a preset that
    // gets quietly replaced by a local spring. The dock reads the site info the catalog page already
    // loads, so this runs on that page at desktop and hands the viewport back afterwards.
    await metrics(1280, 900, false)
    await nav(new URL('/', appUrl).href)
    await waitFor('!!document.querySelector(\'[data-site-phone]\')')
    await waitFor('!!document.querySelector(\'[data-contact-dock] [data-contact-dock-cta]\')')
    const dockBox = await ev('(() => { const e = document.querySelector("[data-contact-dock-cta]"); const r = e.getBoundingClientRect(); const c = getComputedStyle(e.parentElement); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, display: c.display, expanded: e.getAttribute("aria-expanded"), label: e.getAttribute("aria-label") } })()')
    check('the contact dock holds the desktop corner as a full-size control', dockBox.display !== 'none' && dockBox.w >= 44 && dockBox.h >= 44 && dockBox.right <= dockBox.vw && dockBox.bottom <= dockBox.vh && !!dockBox.label && dockBox.expanded === 'false', dockBox)

    const START_DOCK_FRAMES = '(() => { window.__DF = []; window.__DFdone = false; const t0 = performance.now(); const tick = function () { const p = document.querySelector("[data-contact-dock-panel]"); const t = p && getComputedStyle(p).transform; if (t && t !== "none") { const m = new DOMMatrixReadOnly(t); window.__DF.push({ a: +m.a.toFixed(3), d: +m.d.toFixed(3), f: +m.f.toFixed(1), o: +getComputedStyle(p).opacity }) } if (performance.now() - t0 < 700) requestAnimationFrame(tick); else window.__DFdone = true }; requestAnimationFrame(tick); return true })()'
    await ev(START_DOCK_FRAMES)
    await clickAt(dockBox.x, dockBox.y)
    await waitFor('!!window.__DFdone', 4000)
    await waitFor('!!document.querySelector("[data-contact-dock-panel]")')
    const dframes = await ev('window.__DF || []')
    const dBloom = dframes.filter(f => f.a > 0.5 && f.a < 0.995)
    const dTravel = dframes.filter(f => Math.abs(f.f) >= 2)
    const dFade = dframes.some(f => f.o > 0.02 && f.o < 0.98)
    check('the dock panel blooms on the shared preset: uniform scale, travel toward its trigger, its own fade', dframes.length > 3 && dBloom.length > 0 && dBloom.every(f => Math.abs(f.a - f.d) <= 0.01) && dTravel.length > 0 && dFade, { frames: dframes.slice(0, 6) })
    const dockPanel = await ev('(() => { const p = document.querySelector("[data-contact-dock-panel]"); const r = p.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, vh: innerHeight, ctaTop: Math.round(document.querySelector("[data-contact-dock-cta]").getBoundingClientRect().top) } })()')
    check('the panel opens above its trigger and stays inside the viewport', dockPanel.bottom <= dockPanel.ctaTop && dockPanel.left >= 0 && dockPanel.right <= dockPanel.vw && dockPanel.top >= 0, dockPanel)

    // The assert the whole channel rule turns on, and the one no type checker can see: `prefilled` is a
    // promise that the link carries the text, so a `true` beside an empty `text=` is the row lying.
    const dockRows = await ev('Array.from(document.querySelectorAll("[data-contact-dock-panel] a")).map(a => ({ href: a.getAttribute("href"), prefilled: a.dataset.contactPrefilled, target: a.target || null }))')
    const lying = dockRows.filter(r => r.prefilled === 'true' && !/[?&]text=[^&]/.test(r.href))
    check('no dock row claims it carried a message it did not carry', dockRows.length > 0 && lying.length === 0, { lying, rows: dockRows })
    const clippedDock = await ev('(() => { const p = document.querySelector("[data-contact-dock-panel]"); const over = []; for (const el of p.querySelectorAll("span,p")) { const d = el.scrollWidth - el.clientWidth; if (d > 1) over.push({ t: (el.textContent || "").trim().slice(0, 30), over: d }) } const eb = p.querySelector("p"); const rg = document.createRange(); rg.selectNodeContents(eb); return { over, eyebrowLines: rg.getClientRects().length } })()')
    check('nothing in the dock panel is clipped by its own box, and its eyebrow holds one line', clippedDock.over.length === 0 && clippedDock.eyebrowLines === 1, clippedDock)

    // The exit is a different kind of motion from the enter, so it earns its own frame sample. A genie
    // collapse is non-uniform by definition — the surface flattens into the corner the trigger occupies
    // — which is exactly the shape Phase H removed from the *enter* and kept out of the other two popover
    // surfaces. Someone "harmonising" this exit back to the shared bloom, or letting the enter start
    // collapsing too, is what this catches. The anchor is read as the two numbers Chrome resolves
    // `bottom right` into (the panel's own box), because the computed value never contains the keywords.
    const START_DOCK_LEAVE = '(() => { window.__DG = []; window.__DGdone = false; const t0 = performance.now(); const tick = function () { const p = document.querySelector("[data-contact-dock-panel]"); const t = p && getComputedStyle(p).transform; if (t && t !== "none") { const m = new DOMMatrixReadOnly(t); const o = getComputedStyle(p).transformOrigin.split(" ").map(parseFloat); window.__DG.push({ a: +m.a.toFixed(3), d: +m.d.toFixed(3), o: +getComputedStyle(p).opacity, ox: o[0], oy: o[1], w: p.offsetWidth, h: p.offsetHeight }) } if (performance.now() - t0 < 700) requestAnimationFrame(tick); else window.__DGdone = true }; requestAnimationFrame(tick); return true })()'
    await ev(START_DOCK_LEAVE)
    await press('Escape', 'Escape', 27)
    await waitFor('!!window.__DGdone', 4000)
    const gframes = await ev('window.__DG || []')
    const squash = gframes.filter(f => f.a < 0.75 && Math.abs(f.d - f.a) > 0.05)
    const fadeLeads = gframes.some(f => f.o < 0.5 && f.a > 0.5)
    const anchored = gframes.length > 3 && gframes.every(f => Math.abs(f.ox - f.w) <= 2 && Math.abs(f.oy - f.h) <= 2)
    check('the panel collapses into its trigger corner on leave: non-uniform, anchored at its own bottom-right, faded before it is squashed', anchored && squash.length > 0 && fadeLeads, { frames: gframes.slice(0, 4), minScaleX: Math.min(...gframes.map(f => f.a)) })
    await waitFor('!document.querySelector("[data-contact-dock-panel]")')
    const dockFocus = await ev('document.activeElement === document.querySelector("[data-contact-dock-cta]")')
    check('Escape closes the panel and hands focus back to the control that opened it', dockFocus === true, { dockFocus })

    // Below `lg` the dock must be gone rather than merely hidden-behind something: `display: none` is
    // what keeps it out of the corner, out of the tab order and out of the paint cost, and it is the
    // only thing that makes "mobile is unchanged" a fact instead of an intention.
    await metrics(390, 844, true)
    await sleep(400)
    const dockPhone = await ev('(() => { const d = document.querySelector("[data-contact-dock]"); const launcher = document.querySelector(".fixed.right-4"); return { display: d ? getComputedStyle(d).display : "absent", painted: !!d && d.getClientRects().length > 0, launcherPainted: !!launcher && launcher.getClientRects().length > 0, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    check('the dock is off below lg, so the phone corner keeps its one control and no overflow', dockPhone.display === 'none' && !dockPhone.painted && dockPhone.launcherPainted && dockPhone.overflow <= 1, dockPhone)
    await metrics(1440, 900, false)
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-contact-cta]\')')

    // ---- frosted surfaces under `prefers-reduced-transparency` ---------------------------------
    // The storefront frosts nine surfaces, and the fallback lives in one `main.css` block rather than
    // in nine components — so the only thing that proves the flag is wired is measuring it painted:
    // frost gone, fill opaque, at the phone width where the sticky bar is the surface in question.
    await metrics(390, 844, true)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-sticky-cta]\')')
    await sleep(600)
    const unfrosted = await ev('(() => { const alpha = c => { const m = /rgba\\(([^)]+)\\)/.exec(c); return m ? parseFloat(m[1].split(",")[3]) : 1 }; const bar = document.querySelector("[data-sticky-frost]"); const head = document.querySelector("[data-detail-header]"); const bc = bar && getComputedStyle(bar); const hc = head && getComputedStyle(head); return { barFilter: bc ? (bc.backdropFilter || bc.webkitBackdropFilter) : null, barAlpha: bc ? alpha(bc.backgroundColor) : 0, headFilter: hc ? (hc.backdropFilter || hc.webkitBackdropFilter) : null, headAlpha: hc ? alpha(hc.backgroundColor) : 0 } })()')
    check('reduced transparency leaves the frosted storefront surfaces opaque and unfrosted', unfrosted.barFilter === 'none' && unfrosted.barAlpha === 1 && unfrosted.headFilter === 'none' && unfrosted.headAlpha === 1, unfrosted)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] })
    await metrics(1440, 900, false)

    // ---- cart (phase 2: cart) ---------------------------------------------------------------------
    // Signed-out flow; the merge assertion lives inside the account block below, where a session
    // actually appears. Two facts shape this block: the badge lives on the CATALOG masthead (not the
    // detail page), and each add gets its own document so every count is also a persistence proof.
    // The product is chosen from the DOM — the one card wearing the `in` band — so the counts cannot
    // be silently capped by a low-stock fixture.
    await nav(appUrl)
    const cartProductId = await ev('(() => { const card = [...document.querySelectorAll("main article")].find(a => { const s = a.querySelector("[data-stock-state]"); return s && s.getAttribute("data-stock-state") === "in" }); const link = card && card.querySelector("a"); return link ? link.getAttribute("href").split("/").pop() : null })()')
    await nav(detailUrl(cartProductId))
    await waitFor('!!document.querySelector("[data-add-to-cart]")')
    const cartPrice = Number(((await ev('(document.querySelector("[data-product-price] p > span") || {}).textContent || ""')) || '').replace(/[^0-9.]/g, ''))
    await clickSelector('[data-add-to-cart]')
    // The add's three-beat rhythm, in the order it plays: the badge pops (iconPop, played by the
    // WAAPI `pulseScale`), the ghost flies the SearchDock engine's sampled path — bow, bank, apex
    // scale — and its landing plays `arrival` on the badge. All polled — one-sample reads of
    // half-second animations are this session's race. The landing catch is read from after the
    // pop's 450ms can no longer be what a >1.02 scale is (a 430ms sleep past the bank read, which
    // lands mid-flight), so the second rise can only be the catch.
    const addPop = await waitFor('(() => { const b = document.querySelector("[data-cart-badge]"); if (!b) return false; const t = getComputedStyle(b).transform; if (t === "none") return false; return new DOMMatrixReadOnly(t).a > 1.02 })()', 1200)
    const ghostSeen = await waitFor('!!document.querySelector("[data-fly-ghost]")', 1200)
    // The bank is the engine's tell: matrix.b carries sin(bank)·scale and is zero only at the
    // endpoints — a straight-line ghost leaves it at 0 for the whole flight.
    const bankSeen = await waitFor('(() => { const g = document.querySelector("[data-fly-ghost]"); if (!g) return false; const t = getComputedStyle(g).transform; if (t === "none") return false; return Math.abs(new DOMMatrixReadOnly(t).b) > 0.02 })()', 400)
    await sleep(430)
    const catchPop = await waitFor('(() => { const b = document.querySelector("[data-cart-badge]"); if (!b) return false; const t = getComputedStyle(b).transform; if (t === "none") return false; return new DOMMatrixReadOnly(t).a > 1.02 })()', 1300)
    const ghostGone = await waitFor('!document.querySelector("[data-fly-ghost]")', 2500)
    check('the add pops the cart badge', addPop)
    check('adding to cart flies a banking ghost into the badge and the landing thumps it', ghostSeen && bankSeen && catchPop && ghostGone, { ghostSeen, bankSeen, catchPop, ghostGone })
    await nav(appUrl)
    check('one add from the detail page badges the cart with 1', await waitFor('(document.querySelector("[data-cart-badge]") || {}).textContent?.trim() === "1"'), { badge: await ev('(document.querySelector("[data-cart-badge]") || {}).textContent') })
    await nav(detailUrl(cartProductId))
    await waitFor('!!document.querySelector("[data-add-to-cart]")')
    // The second add doubles as the reduced-motion arm: no ghost at all. The add itself still
    // lands — the count check below is the positive control that the click was not simply lost.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await clickSelector('[data-add-to-cart]')
    await sleep(600)
    check('under reduced motion the add flies no ghost', await ev('!document.querySelector("[data-fly-ghost]")'))
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await nav(appUrl)
    check('a second add survives the reload and reaches 2', await waitFor('(document.querySelector("[data-cart-badge]") || {}).textContent?.trim() === "2"'))

    // Drift: the stub answers a stock of 1 for this product from the next document on, so the cart
    // page must clamp the line, say so, and the badge must follow the written-back clamp.
    const cartDriftArm = await forNextDocument('var p = window.__PRODUCTS.find(function (x) { return x.id === ' + JSON.stringify(cartProductId) + ' }); p.stock_quantity = 1;')
    await nav(appUrl + 'cart')
    await waitFor('!!document.querySelector("[data-cart-line]")')
    const drift = await ev('(() => ({ qty: (document.querySelector("[data-cart-qty]") || {}).textContent?.trim(), issue: !!document.querySelector("[data-cart-issue]"), subtotal: (document.querySelector("[data-cart-subtotal]") || {}).textContent?.trim() }))()')
    check('the cart page clamps a drift-dropped line and says so', drift.qty === '1' && drift.issue === true, drift)
    check('the subtotal is the live price at the clamped quantity', drift.subtotal === 'USD ' + cartPrice.toFixed(2), { subtotal: drift.subtotal, cartPrice })
    await nav(appUrl)
    check('the badge follows the written-back clamp', await waitFor('(document.querySelector("[data-cart-badge]") || {}).textContent?.trim() === "1"'))
    await stopForNextDocument(cartDriftArm)
    await nav(detailUrl(cartProductId))
    check('the detail header carries the cart control too', await waitFor('(document.querySelector("[data-detail-header] [data-cart-badge]") || {}).textContent?.trim() === "1"'), { badge: await ev('(document.querySelector("[data-detail-header] [data-cart-badge]") || {}).textContent') })

    // ---- customer accounts (phase 1: identity) ----------------------------------------------------
    // The whole flow against the session the stub hands out: guard bounce, signup, profile save and
    // sign-out. `/checkout` is guarded by the same middleware and is asserted beside `/account`; its
    // signed-in flow, and the orders that follow it, live in the phase 3 block below.
    await nav(appUrl + 'account')
    check('signed-out /account lands on the login page with a return path', await waitFor('location.pathname === "/login" && location.search.indexOf("redirect") !== -1'), { url: await ev('location.pathname + location.search') })
    await nav(appUrl + 'checkout')
    check('signed-out /checkout lands on the login page too', await waitFor('location.pathname === "/login" && location.search.indexOf("redirect") !== -1'), { url: await ev('location.pathname + location.search') })

    await nav(appUrl + 'signup')
    await waitFor('!!document.querySelector("main form input")')
    const signupBoxes = await ev(boxesExpr('main form input'))
    const signupValues = ['shopper@example.test', 'password123', 'password123']
    for (let i = 0; i < signupBoxes.length && i < signupValues.length; i++) {
      await clickAt(signupBoxes[i].x, signupBoxes[i].y)
      await cdp.send('Input.insertText', { text: signupValues[i] })
    }
    await clickByText('main form button[type="submit"]', 'Create account', 'location.pathname === "/account"')
    const afterSignup = await ev('(() => ({ url: location.pathname + location.search, cookie: document.cookie.indexOf("__harness_clerk") !== -1, session: (window.__HARNESS_CLERK || {}).signedIn === true }))()')
    check('signing up lands signed in on the account page', await waitFor('location.pathname === "/account"'), afterSignup)

    await waitFor('!!document.querySelector("[data-account-email]")')
    const accountEmail = await ev('(document.querySelector("[data-account-email]") || {}).textContent?.trim()')
    check('the account page shows the signed-in email', accountEmail === 'verify@example.test', { accountEmail })
    check('the account form is prefilled from the profile row', await waitFor('[...document.querySelectorAll("main form input")].some(el => el.value === "Verify User")'))

    await clickByText('main form button[type="submit"]', 'Save changes', 'document.body.innerText.includes("Account saved.")')
    const profileWrites = await ev('window.__W.filter(w => w.p === "/api/profile" && w.method === "PATCH").map(w => ({ b: w.body || "" }))')
    check('saving the profile confirms once, on the signed-in row, with the form values', await waitFor('document.body.innerText.includes("Account saved.")') && profileWrites.length === 1 && profileWrites[0].b.includes('displayName') && profileWrites[0].b.includes('phone'), profileWrites)

    // The merge runs when the cart next binds with the new session — visiting the catalog is that
    // moment. The guest key's removal is the merge's signature, and the watcher that performs it
    // fires when the module's async user state lands, so wait for the evidence, not for a clock.
    await nav(appUrl)
    await waitFor('!localStorage.getItem("raccoon-cart:v1:guest")')
    const mergeState = await ev('(() => ({ guest: !!localStorage.getItem("raccoon-cart:v1:guest"), user: JSON.parse(localStorage.getItem("raccoon-cart:v1:00000000-0000-4000-8000-0000000000ad") || "null"), pill: ([...document.querySelectorAll("header a")].find(l => (l.innerText || "").trim() === "My account") || {}).innerText?.trim() || null, signed: document.cookie.indexOf("__harness_clerk") !== -1 }))()')
    check('signing in merges the guest cart into the account cart', !mergeState.guest && !!mergeState.user && mergeState.user.items.length === 1 && mergeState.user.items[0].productId === cartProductId && mergeState.user.items[0].quantity === 1, mergeState)
    check('the merged cart badges the masthead', await waitFor('(document.querySelector("[data-cart-badge]") || {}).textContent?.trim() === "1"'), { badge: await ev('(document.querySelector("[data-cart-badge]") || {}).textContent') })
    // Back to /account client-side: a full page load would hit the SSR guard, which the in-browser
    // stub cannot satisfy (server-side auth reads leave the browser) — and the signed-in label the
    // pill switches to is exactly what this click asserts.
    await clickByText('header a', 'My account', 'location.pathname === "/account"')
    await waitFor('!!document.querySelector("[data-account-signout]")')

    // ---- checkout and the buyer's orders (phase 3: orders) ---------------------------------------
    // The cart here is the merged one (1 × the in-band product). The refusal arm runs first on the
    // same page: the stub's one-shot flag makes `create_order` answer the RPC's `PROMO_LIMIT:<id>:2`
    // raise, and the page must show the mapped sentence, stay on the form and keep the cart. Only
    // then does the real submit run — each arm issues exactly one RPC, so neither click double-fired.
    await nav(appUrl + 'cart')
    await waitFor('!!document.querySelector("[data-cart-line]")')
    // The cart mirrors the checkout's locked frame — same one-screen contract, same settle poll
    // (a page-enter transform counts as scrollable overflow) and the same self-diagnosing
    // failure detail.
    await waitFor('(() => document.documentElement.scrollHeight - innerHeight <= 1 && Math.round(window.scrollY) === 0)()', 2000)
    const cartOneScreen = await ev('(() => { const b = document.querySelector("[data-cart-checkout]"); if (!b) return null; const r = b.getBoundingClientRect(); const deep = [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().bottom > innerHeight + 1).map(el => el.tagName.toLowerCase() + "." + (typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "") + "@" + Math.round(el.getBoundingClientRect().bottom)).slice(0, 6); return { overflow: document.documentElement.scrollHeight - innerHeight, scrollY: Math.round(window.scrollY), checkoutBottom: Math.round(r.bottom), vh: innerHeight, visible: r.top >= 0 && r.bottom <= innerHeight + 1, deep } })()')
    check('the cart fits one screen: no page scroll and the checkout button is on-screen', !!cartOneScreen && cartOneScreen.overflow <= 1 && cartOneScreen.scrollY === 0 && cartOneScreen.visible, cartOneScreen)
    // The same contract on a phone frame (390×844): the locked `h-dvh` frame must hold and the
    // checkout CTA must stay pinned on-screen while the lines pane scrolls internally.
    await metrics(390, 844, true)
    await waitFor('(() => document.documentElement.scrollHeight - innerHeight <= 1 && Math.round(window.scrollY) === 0)()', 2000)
    const cartMobile = await ev('(() => { const b = document.querySelector("[data-cart-checkout]"); if (!b) return null; const r = b.getBoundingClientRect(); return { overflow: document.documentElement.scrollHeight - innerHeight, scrollY: Math.round(window.scrollY), checkoutBottom: Math.round(r.bottom), vh: innerHeight, visible: r.top >= 0 && r.bottom <= innerHeight + 1 } })()')
    // The money pane is sized so the subtotal card sits close above the CTA — pinned but not
    // hollow. The gap is the contract: visible separation, no dead space (8–64 px at 390×844).
    const cartGap = await ev('(() => { const card = document.querySelector("[data-cart-summary]"); const cta = document.querySelector("[data-cart-checkout]"); if (!card || !cta) return null; return { gap: Math.round(cta.getBoundingClientRect().top - card.getBoundingClientRect().bottom) } })()')
    check('the cart fits one phone screen too: no page scroll, the checkout button on-screen, the subtotal close above it', !!cartMobile && cartMobile.overflow <= 1 && cartMobile.scrollY === 0 && cartMobile.visible && !!cartGap && cartGap.gap >= 8 && cartGap.gap <= 64, { ...cartMobile, ...cartGap })
    await metrics(1440, 900, false)
    check('the cart hands the shopper to a real checkout', await clickSelector('[data-cart-checkout]', 'location.pathname === "/checkout" && !!document.querySelector("[data-checkout-form]")'))
    await waitFor('!!document.querySelector("[data-checkout-name]")')
    // The one-screen contract at the harness's 1440×900: the page itself must not scroll and
    // the submit must be on-screen — the locked frame is the redesign's whole point. Read
    // before the press probe below, which scrolls deliberately. The settle wait matters: this
    // check lands right after a client-side navigation, and the page-enter transition holds
    // `main` at translateY(4px) for its 180ms — a transformed box counts as scrollable
    // overflow, which read as a one-sample 4px failure until the poll waited it out. The
    // failure detail names the elements whose boxes cross the fold, so a regression diagnoses
    // itself.
    await waitFor('(() => document.documentElement.scrollHeight - innerHeight <= 1 && Math.round(window.scrollY) === 0)()', 2000)
    const oneScreen = await ev('(() => { const b = document.querySelector("[data-checkout-submit]"); if (!b) return null; const r = b.getBoundingClientRect(); const deep = [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().bottom > innerHeight + 1).map(el => el.tagName.toLowerCase() + "." + (typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "") + "@" + Math.round(el.getBoundingClientRect().bottom)).slice(0, 6); return { overflow: document.documentElement.scrollHeight - innerHeight, scrollY: Math.round(window.scrollY), submitBottom: Math.round(r.bottom), vh: innerHeight, visible: r.top >= 0 && r.bottom <= innerHeight + 1, deep } })()')
    check('the checkout fits one screen: no page scroll and the submit is on-screen', !!oneScreen && oneScreen.overflow <= 1 && oneScreen.scrollY === 0 && oneScreen.visible, oneScreen)
    // The global press idiom (the button base in app.config), asserted here on the checkout
    // submit: hold the control and read the standalone `scale` Tailwind v4 writes on `:active` —
    // then release OUTSIDE the button so this probe never submits the form. Reduced motion is
    // pinned to no-preference so the `motion-safe:` gate is on whatever ran earlier.
    // Two traps this probe paid for (both observed as flaky reads of `scale: none`):
    // `html { scroll-behavior: smooth }` makes a rect read while the scroll is still in flight
    // stale, so the scroll is INSTANT and the aim is only accepted once `elementFromPoint`
    // confirms the press would land on the button; and the 0.97 arrives through a 150 ms
    // transition, so the read polls for the settled value instead of guessing a sleep.
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    let aim = null
    const aimExpr = '(() => { const el = document.querySelector("[data-checkout-submit]"); if (!el) return null; el.scrollIntoView({ block: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, on: !!hit && (hit === el || el.contains(hit)) } })()'
    const aimUntil = Date.now() + 2000
    while ((!aim || !aim.on) && Date.now() < aimUntil) { aim = await ev(aimExpr); if (!aim || !aim.on) await sleep(40) }
    let pressedScale = null
    if (aim && aim.on) {
      await mouse('mouseMoved', aim.x, aim.y)
      await mouse('mousePressed', aim.x, aim.y, 1)
      const scaleUntil = Date.now() + 1000
      while (pressedScale !== '0.97' && Date.now() < scaleUntil) { pressedScale = await ev('(() => { const el = document.querySelector("[data-checkout-submit]"); return el ? getComputedStyle(el).scale : null })()'); await sleep(40) }
      await mouse('mouseReleased', aim.x, aim.y - 160, 0)
    }
    check('the checkout submit carries the storefront press idiom while held', pressedScale === '0.97', { pressedScale, aim })
    // The address's "use my location", both arms, straight through the browser's own permission
    // machinery: DENIED first (the form must stay usable, say why, and leave the field alone —
    // this arm also pins the Permissions-API gate: a hard block can never be prompted again, so
    // the click must guide instead of calling), then GRANTED (the user having allowed it — i.e.
    // the next click after following that guidance, which is what the grant between the arms
    // emulates) with a CDP-emulated fix, where the field must fill with exactly the pin URL the
    // util formats. The ask in production is the browser's own prompt — which is why nothing
    // here fakes a custom modal.
    const checkoutOrigin = new URL(appUrl).origin
    await cdp.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: checkoutOrigin })
    await clickSelector('[data-checkout-locate]')
    const locationDeniedShown = await waitFor('(() => { const el = document.querySelector("[data-checkout-location-error]"); return !!el && (el.textContent || "").includes(' + JSON.stringify(EXP.orders.locationBlockedText) + ') })()')
    const locationAfterDenied = await ev('(document.querySelector("[data-checkout-location]") || {}).value ?? null')
    check('a denied location leaves the location link untouched and explains itself', locationDeniedShown && locationAfterDenied === '', { locationDeniedShown, locationAfterDenied })
    await cdp.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'granted', origin: checkoutOrigin })
    await cdp.send('Emulation.setGeolocationOverride', { latitude: EXP.orders.location.latitude, longitude: EXP.orders.location.longitude, accuracy: 10 })
    await clickSelector('[data-checkout-locate]')
    const pinUrl = 'https://maps.google.com/?q=' + EXP.orders.location.latitude.toFixed(5) + ',' + EXP.orders.location.longitude.toFixed(5)
    const located = await waitFor('(() => ((document.querySelector("[data-checkout-location]") || {}).value || "") === ' + JSON.stringify(pinUrl) + ')()')
    check('a granted location fills the location link with the pin URL', located, { pinUrl, settled: await ev('(document.querySelector("[data-checkout-location]") || {}).value ?? null') })
    // Submitting with the address still empty must not spend a request: the first invalid field
    // in form order is shaken (the WAAPI animation is read on its form-field wrapper) and the
    // message names the requirements. The request count pins the local short-circuit.
    const postsBeforeInvalid = (await allW()).filter(w => w.method === 'POST' && w.p === '/api/orders').length
    await clickSelector('[data-checkout-submit]')
    const addressShake = await waitFor('(() => { const el = document.querySelector("[data-checkout-field=address]"); return !!el && el.getAnimations().length >= 1 })()', 500)
    const addressHint = await waitFor('(() => { const el = document.querySelector("[data-checkout-field=address]"); return !!el && (el.textContent || "").includes(' + JSON.stringify(EXP.orders.requiredAddressText) + ') })()')
    const invalidShown = await waitFor('(() => { const a = document.querySelector("[data-checkout-error]"); return !!a && (a.textContent || "").includes(' + JSON.stringify(EXP.orders.invalidDeliveryText) + ') })()')
    const postsAfterInvalid = (await allW()).filter(w => w.method === 'POST' && w.p === '/api/orders').length
    check('an empty address refuses locally: the field shakes, names what is needed, and sends nothing', addressShake && addressHint && invalidShown && postsAfterInvalid === postsBeforeInvalid, { addressShake, addressHint, invalidShown, posts: postsAfterInvalid })
    const DELIVERY = EXP.orders.delivery
    await ev(setInput('[data-checkout-name]', DELIVERY.name))
    await ev(setInput('[data-checkout-phone]', DELIVERY.phone))
    await ev(setInput('[data-checkout-address]', DELIVERY.address))
    // The red state is live: typing the address must clear its hint without another submit.
    const hintCleared = await waitFor('(() => { const el = document.querySelector("[data-checkout-field=address]"); return !!el && !(el.textContent || "").includes(' + JSON.stringify(EXP.orders.requiredAddressText) + ') })()')
    check('the address hint clears as soon as the address is typed', hintCleared)
    // And the phone frame: the fields pane may scroll internally, but the submit must stay
    // pinned on-screen — the mobile half of the one-screen contract.
    await metrics(390, 844, true)
    await waitFor('(() => document.documentElement.scrollHeight - innerHeight <= 1 && Math.round(window.scrollY) === 0)()', 2000)
    const checkoutMobile = await ev('(() => { const b = document.querySelector("[data-checkout-submit]"); if (!b) return null; const r = b.getBoundingClientRect(); return { overflow: document.documentElement.scrollHeight - innerHeight, scrollY: Math.round(window.scrollY), submitBottom: Math.round(r.bottom), vh: innerHeight, visible: r.top >= 0 && r.bottom <= innerHeight + 1 } })()')
    check('the checkout fits one phone screen too: no page scroll and the submit is on-screen', !!checkoutMobile && checkoutMobile.overflow <= 1 && checkoutMobile.scrollY === 0 && checkoutMobile.visible, checkoutMobile)
    await metrics(1440, 900, false)
    await ev('window.__ORDERS_FAIL = "PROMO_LIMIT:' + cartProductId + ':2"; true')
    await clickSelector('[data-checkout-submit]')
    const refusedShown = await waitFor('(() => { const a = document.querySelector("[data-checkout-error]"); return !!a && (a.textContent || "").includes(' + JSON.stringify(EXP.orders.promoLimitText) + ') && location.pathname === "/checkout" })()')
    const cartAfterRefusal = await ev('(JSON.parse(localStorage.getItem("raccoon-cart:v1:00000000-0000-4000-8000-0000000000ad") || "{}").items || []).length')
    const refusalProbe = await ev('JSON.stringify({ path: location.pathname, alert: !!document.querySelector("[data-checkout-error]"), disabled: (document.querySelector("[data-checkout-submit]") || {}).disabled ?? null, posts: (window.__W || []).filter(w => w.method === "POST" && w.p === "/api/orders").length, failFlag: window.__ORDERS_FAIL || null })')
    check('a refused order shows the mapped sentence, stays put and keeps the cart', refusedShown && cartAfterRefusal === 1, { refusedShown, cartAfterRefusal, refusalProbe })
    check('the refused click issued exactly one create_order', (await allW()).filter(w => w.method === 'POST' && w.p === '/api/orders').length === 1)

    check('placing the order lands on the success page with the returned reference', await clickSelector('[data-checkout-submit]', 'location.pathname === "/checkout/success" && !!document.querySelector("[data-order-number]")'))
    const placed = (await allW()).filter(w => w.method === 'POST' && w.p === '/api/orders')
    const placedBody = JSON.parse(placed[placed.length - 1]?.body || '{}')
    const wantBody = { items: [{ productId: cartProductId, quantity: 1 }], delivery: { name: DELIVERY.name, phone: DELIVERY.phone, address: DELIVERY.address, location: pinUrl, note: null }, locale: 'en', payNow: false }
    const ref = await ev('(document.querySelector("[data-order-number]") || {}).textContent?.trim()')
    const cartAfterOrder = await ev('(JSON.parse(localStorage.getItem("raccoon-cart:v1:00000000-0000-4000-8000-0000000000ad") || "{}").items || []).length')
    check('the placed body is the clamped cart, the delivery form and the locale — exactly', placed.length === 2 && JSON.stringify(placedBody) === JSON.stringify(wantBody), { placedBody })
    check('the success page shows the returned order id and the cart is empty', ref === ORDER_ID && cartAfterOrder === 0, { ref, cartAfterOrder })

    // The success page's own button is the route into the buyer's history — client-side, so the
    // guard reads the stub session like every other client navigation in this file.
    check('View order opens that order and reads the snapshot back', await clickSelector('[data-order-view]', 'location.pathname.indexOf("/account/orders/") !== -1 && !!document.querySelector("[data-order-ref]")'))
    const orderDetail = await ev('(() => ({ ref: (document.querySelector("[data-order-ref]") || {}).textContent?.trim(), status: (document.querySelector("[data-order-status]") || {}).textContent?.trim(), items: [...document.querySelectorAll("[data-order-items] li")].map(li => (li.textContent || "").replace(/\\s+/g, " ").trim()), timeline: [...document.querySelectorAll("[data-order-timeline] li p")].map(p => (p.textContent || "").trim()), location: (document.querySelector("[data-order-location]") || {}).getAttribute?.("href") ?? null }))()')
    check('the buyer order page carries the reference, pending chip, snapshot item, placed step and map pin', orderDetail.ref === ORDER_ID && orderDetail.status === 'Pending' && orderDetail.items.length === 1 && orderDetail.items[0].includes('Verify Keyboard') && orderDetail.items[0].includes('USD 123.45') && orderDetail.timeline.includes('Placed') && orderDetail.location === pinUrl, orderDetail)

    check('Back to orders opens the list carrying the same order', await clickByText('main a', 'Back to orders', 'location.pathname === "/account/orders" && !!document.querySelector("[data-orders-list]")'))
    const listRows = await ev('[...document.querySelectorAll("[data-order-row]")].map(r => ({ ref: (r.textContent || "").includes(' + JSON.stringify('#' + ORDER_ID.slice(0, 8).toUpperCase()) + '), status: (r.querySelector("[data-order-status]") || {}).textContent?.trim(), total: (r.textContent || "").includes("USD 123.45") }))')
    const listed = listRows.find(r => r.ref)
    check('the list row shows the order reference, its status chip and its total', !!listed && listed.status === 'Pending' && listed.total === true, listRows)

    // The cancelled fixture's detail: the reason recorded at cancellation must reach the buyer.
    // The row is picked by structure — the one that is NOT the pending order — and clicked
    // programmatically (trap 9: aimed clicks drift on freshly-settled pages).
    const cancelledClicked = await ev('(() => { const row = [...document.querySelectorAll("[data-order-row]")].find(r => !(r.textContent || "").includes(' + JSON.stringify('#' + ORDER_ID.slice(0, 8).toUpperCase()) + ')); if (row) row.click(); return !!row })()')
    await waitFor('location.pathname === "/account/orders/' + CANCELLED_ORDER_ID + '" && !!document.querySelector("[data-order-cancel-note]")', 10000)
    const cancelledRef = await ev('(document.querySelector("[data-order-ref]") || {}).textContent?.trim()')
    const cancelledNote = await ev('(document.querySelector("[data-order-cancel-note]") || {}).textContent?.trim()')
    check('the buyer sees the cancellation note on a cancelled order', cancelledClicked && cancelledRef === CANCELLED_ORDER_ID && cancelledNote === CANCELLED_NOTE, { cancelledClicked, cancelledRef, cancelledNote })
    check('Back to orders returns after the cancelled visit', await clickByText('main a', 'Back to orders', 'location.pathname === "/account/orders" && !!document.querySelector("[data-orders-list]")'))

    // The endpoint set decides what a buyer's pages may read: the self-scoped trio (mine, stamps,
    // single) and never the desk's unscoped list — without that split an admin account's
    // My-account → Orders would list the whole shop (the policy grants that access), which is
    // the desk's view, not this page's.
    const ordersReads = (await allW()).filter(w => w.method === 'GET' && w.p.startsWith('/api/orders'))
    check('the buyer history reads all go through the self-scoped endpoints, never the desk list', ordersReads.length > 0 && ordersReads.every(w => w.p !== '/api/orders'), { reads: ordersReads.map(w => w.p) })

    await clickByText('main a', 'My account', 'location.pathname === "/account"')
    await waitFor('!!document.querySelector("[data-account-signout]")')

    // Asserted and retried once, like every other aimed departure near a freshly-settled page in
    // this file (observed once absorbed: the run stayed on /account with the session intact).
    await clickSelector('[data-account-signout]', 'location.pathname === "/"')
      || await clickSelector('[data-account-signout]', 'location.pathname === "/"')
    const signOutProbe = await ev('(() => { const btn = document.querySelector("[data-account-signout]"); const alerts = [...document.querySelectorAll("main [role=\\"alert\\"]")].map(a => (a.textContent || "").trim()); return { url: location.pathname, btn: !!btn, btnText: btn ? (btn.textContent || "").trim() : null, alerts, clerk: (window.__HARNESS_CLERK || {}).signedIn } })()')
    check('signing out returns to the storefront and clears the session', await waitFor('location.pathname === "/" && document.cookie.indexOf("__harness_clerk") === -1 && (window.__HARNESS_CLERK || {}).signedIn === false'), { probe: signOutProbe, url: await ev('location.pathname'), cookie: await ev('document.cookie.indexOf("__harness_clerk") !== -1'), clerk: await ev('(window.__HARNESS_CLERK || {}).signedIn') })

    // The label flips when the module's post-sign-out refresh lands (which is also when the stub's
    // 401 makes it stick), so wait for it before reading the href.
    await waitFor('[...document.querySelectorAll("header a")].some(l => (l.textContent || "").trim() === "Sign in")')
    const headerAccount = await ev('(() => { const a = [...document.querySelectorAll("header a")].find(l => (l.textContent || "").trim() === "Sign in"); return a ? a.getAttribute("href") : null })()')
    check('the masthead carries the account entry', headerAccount === '/login', { headerAccount })
    check('the signed-out masthead carries no Orders entry', await ev('![...document.querySelectorAll("header a")].some(l => (l.textContent || "").trim().startsWith("Orders"))'))

    // The sign-out landed on a freshly-mounted home, so its grid is waited for before the footer
    // is aimed at — the same trap-9 departure the walk's clicks carry, and this one shares their
    // retry for the same reason (observed once as `url: "/"`, the click absorbed by the
    // still-growing page).
    await waitFor('location.pathname === "/" && !!document.querySelector("main article h2 a")', 10000)
    const footerToLogin = await clickByText('footer a', 'Sign in', 'location.pathname === "/login"')
      || await clickByText('footer a', 'Sign in', 'location.pathname === "/login"')
    check('the storefront footer carries the account entry', footerToLogin, { footerToLogin, url: await ev('location.pathname') })

    // ---- the cart must follow accounts live, not only across reloads ------------------------------
    // The per-scope transition was observed by a COMPONENT-SCOPED watcher once (it was registered in
    // whichever page first called `useCart`), so the first SPA navigation killed it and `bound`
    // blocked re-registration — items stayed on screen across sign-out/sign-in ("items carried
    // across accounts", the owner's report) and the guest key was only consumed by a full reload.
    // This walk adds as a guest and signs in CLIENT-SIDE on one document: the guest key must be
    // consumed and the account key must hold the line.
    await ev('(() => { const a = [...document.querySelectorAll("main a")].find(el => (el.getAttribute("href") || "") === "/"); if (a) a.click(); return !!a })()')
    await waitFor('location.pathname === "/" && !!document.querySelector("main article h2 a")', 10000)
    await ev('(() => { const a = [...document.querySelectorAll("main article a")].find(el => (el.getAttribute("href") || "").includes(' + JSON.stringify(cartProductId) + ')); if (a) a.click(); return !!a })()')
    await waitFor('!!document.querySelector("[data-add-to-cart]")')
    await clickSelector('[data-add-to-cart]')
    await ev('(() => { const a = [...document.querySelectorAll("main a")].find(el => (el.getAttribute("href") || "") === "/"); if (a) a.click(); return !!a })()')
    await waitFor('location.pathname === "/" && !!document.querySelector("main article h2 a")', 10000)
    // The departure is asserted and retried once: with `scroll-behavior: smooth` in force, a click
    // fetched while the page is still settling can land on the drifting gap instead of the link —
    // and a walk that continues from the miss makes the two checks below fail under names that
    // blame the wrong step. (Observed once as `url: "/"` with the guest cart intact.)
    const toLogin = await clickByText('footer a', 'Sign in', 'location.pathname === "/login"')
      || await clickByText('footer a', 'Sign in', 'location.pathname === "/login"')
    await waitFor('!!document.querySelector(\'main form input[type="email"]\')')
    const liveLoginBoxes = await ev(boxesExpr('main form input'))
    // The form can EXIST while still mid-enter-animation: a falsified `preSubmit` once showed the
    // boxes 16px above their final home, the first click landing and the second hitting whatever
    // slid into the gap. Settle on stable coordinates first, then (below) re-measure per click —
    // the same drifting-gap class the walk's retried departures name.
    let settledBoxes = liveLoginBoxes
    for (let tries = 0; tries < 8; tries++) {
      await sleep(150)
      const next = await ev(boxesExpr('main form input'))
      if (JSON.stringify(next) === JSON.stringify(settledBoxes)) break
      settledBoxes = next
    }
    const liveLoginValues = ['shopper@example.test', 'password123']
    // The boxes are re-measured before EVERY click: the first observation can land mid-enter-
    // animation (~16px of drift once falsified `preSubmit` with a BUTTON-focused password miss —
    // the page settles between the two inserts, and the second fixed-coordinate click then hits
    // whatever slid into the gap). Same class as the walk's documented retried departures.
    for (let i = 0; i < liveLoginValues.length; i++) {
      const fresh = await ev(boxesExpr('main form input'))
      if (!fresh[i]) break
      await clickAt(fresh[i].x, fresh[i].y)
      await cdp.send('Input.insertText', { text: liveLoginValues[i] })
    }
    const preSubmit = await ev('location.pathname')
    // The stub profile carries a nickname, so the bare-/login landing takes the storefront branch;
    // the profile-page branch is pinned further down, behind the one-shot flag.
    check('a client-side sign-in with a nickname set lands on the storefront', await clickByText('main form button[type="submit"]', 'Sign in', 'location.pathname === "/"'), { toLogin, preSubmit })
    const liveCart = await ev('(() => ({ guest: localStorage.getItem("raccoon-cart:v1:guest"), user: JSON.parse(localStorage.getItem("raccoon-cart:v1:00000000-0000-4000-8000-0000000000ad") || "null"), url: location.pathname }))()')
    check('a client-side sign-in consumes the guest cart into the account, no reload anywhere', liveCart.url === '/' && !liveCart.guest && !!liveCart.user && liveCart.user.items.length === 1 && liveCart.user.items[0].productId === cartProductId && liveCart.user.items[0].quantity === 1, liveCart)
    await ev('(() => { const a = [...document.querySelectorAll("main a")].find(el => (el.getAttribute("href") || "") === "/"); if (a) a.click(); return !!a })()')
    check('the merged cart badges the masthead without a reload', await waitFor('location.pathname === "/" && (document.querySelector("[data-cart-badge]") || {}).textContent?.trim() === "1"', 10000))

    // The masthead's Orders entry (signed-in only — signed out it would only be a login detour,
    // asserted above). The href is read first, then the click proves the entry is reachable.
    const headerOrders = await ev('(() => { const a = [...document.querySelectorAll("header a")].find(l => (l.textContent || "").trim().startsWith("Orders")); return a ? a.getAttribute("href") : null })()')
    check('the signed-in masthead carries an Orders entry into the buyer history', headerOrders === '/account/orders', { headerOrders })
    check('Orders opens the buyer history from the masthead', await clickByText('header a', 'Orders', 'location.pathname === "/account/orders" && !!document.querySelector("[data-orders-list]")'))

    // The onboarding branch of the login landing, on the same document walk: a profile without a
    // nickname must still land on the profile page after signing in, because that page IS the
    // onboarding. The one-shot stub flag makes the login's own profiles read answer an empty
    // nickname — it is consumed there, so the profile page's read after arrival still sees the
    // real row. The sign-out lands on a freshly-mounted home, so the grid is waited for before
    // the footer is aimed at (trap 9).
    await clickByText('main a', 'My account', 'location.pathname === "/account"')
    await waitFor('!!document.querySelector("[data-account-signout]")')
    await clickSelector('[data-account-signout]', 'location.pathname === "/"')
    await waitFor('location.pathname === "/" && !!document.querySelector("main article h2 a")', 10000)
    await ev('window.__PROFILE_EMPTY = true; true')
    const toLoginEmpty = await clickByText('footer a', 'Sign in', 'location.pathname === "/login"')
      || await clickByText('footer a', 'Sign in', 'location.pathname === "/login"')
    await waitFor('!!document.querySelector(\'main form input[type="email"]\')')
    // Same settle + per-click re-measure as the first walk above. This block's absence of it was
    // the four-check debt of plans/006 item 17: measured once mid-enter, the second click hit the
    // drifting gap, `password` stayed empty, the form's own refusal parked the walk on /login —
    // and the masthead/badge checks downstream red-cascaded from a refusal, not from a bug. The
    // typed-values check names that failure here instead of three checks later.
    let settledEmpty = await ev(boxesExpr('main form input'))
    for (let tries = 0; tries < 8; tries++) {
      await sleep(150)
      const next = await ev(boxesExpr('main form input'))
      if (JSON.stringify(next) === JSON.stringify(settledEmpty)) break
      settledEmpty = next
    }
    const emptyValues = ['shopper@example.test', 'password123']
    for (let i = 0; i < emptyValues.length; i++) {
      const fresh = await ev(boxesExpr('main form input'))
      if (!fresh[i]) break
      await clickAt(fresh[i].x, fresh[i].y)
      await cdp.send('Input.insertText', { text: emptyValues[i] })
    }
    check('the no-nickname sign-in typed both fields before submitting', await ev('JSON.stringify([...document.querySelectorAll("main form input")].map(i => i.value))') === JSON.stringify(emptyValues))
    check('a sign-in with no nickname set lands on the profile page', await clickByText('main form button[type="submit"]', 'Sign in', 'location.pathname === "/account"'), { toLogin: toLoginEmpty, url: await ev('location.pathname') })

    // The buyer's notice badge, on the same document walk: quiet while nothing has moved, then a
    // status change — the stub's one-shot touch of the pending row's `confirmed_at` — surfaces as
    // the pill's count, and a visit to the orders area consumes it. Every absence is asserted only
    // AFTER its stamps read landed in `window.__W`, because a badge that has not been computed yet
    // is also absent, and that absence would prove nothing.
    await resetW()
    await ev('(() => { const a = [...document.querySelectorAll("main a")].find(el => (el.getAttribute("href") || "") === "/"); if (a) a.click(); return !!a })()')
    await waitFor('location.pathname === "/" && !!document.querySelector("main article h2 a")', 10000)
    const quietRead = await waitFor('window.__W.some(w => w.method === "GET" && w.p === "/api/orders/stamps")', 10000)
    const badgeBefore = await ev('(() => { const a = [...document.querySelectorAll("header a")].find(l => (l.textContent || "").trim().startsWith("Orders")); if (!a) return null; const b = a.querySelector("[data-orders-badge]"); return { text: (a.textContent || "").trim(), badge: b ? (b.textContent || "").trim() : null } })()')
    check('the Orders entry stays quiet while nothing has changed', quietRead && !!badgeBefore && badgeBefore.text === 'Orders' && badgeBefore.badge === null, { quietRead, badgeBefore })
    await ev('window.__ORDER_TOUCH = true; true')
    // JS clicks on purpose: aiming a real click at the masthead right after an arrival means
    // scrollIntoView starts a smooth scroll under its own feet (trap 9 — observed as a pill click
    // that never navigated, `accountHop: false, accountUrl: "/"`). These are links; a programmatic
    // click is position-independent and the router still handles it.
    // innerText, not textContent: the account pill carries a responsive label (short "Account"
    // on phones, "My account" here) as two spans, so textContent concatenates both. innerText is
    // the visible text — what the walker actually clicks.
    const accountHop = await ev('(() => { const a = [...document.querySelectorAll("header a")].find(l => (l.innerText || "").trim() === "My account"); if (a) a.click(); return !!a })()')
    const accountHere = await waitFor('location.pathname === "/account"')
    await resetW()
    await ev('(() => { const a = [...document.querySelectorAll("main a")].find(el => (el.getAttribute("href") || "") === "/"); if (a) a.click(); return !!a })()')
    const homeHop = await waitFor('location.pathname === "/" && !!document.querySelector("main article h2 a")', 10000)
    const noticeRead = await waitFor('window.__W.some(w => w.method === "GET" && w.p === "/api/orders/stamps")', 10000)
    const noticeSeen = await waitFor('(document.querySelector("[data-orders-badge]") || {}).textContent?.trim() === "1"')
    // Evidence-rich on purpose: if this ever fails, the detail names the broken link — a hop that
    // did not happen, the read never firing (watch path), firing with a stale marker (count path),
    // or firing and the badge not rendering.
    const noticeProbe = await ev('JSON.stringify({ url: location.pathname, pill: ([...document.querySelectorAll("header a")].find(l => (l.textContent || "").trim().startsWith("Orders")) || {}).textContent || null, seen: localStorage.getItem("raccoon-orders-seen:v1:00000000-0000-4000-8000-0000000000ad"), reads: (window.__W || []).filter(w => w.p.indexOf("/api/orders") === 0).map(w => w.method + " " + (w.q || "").slice(0, 48)) })')
    check('a status update surfaces as the Orders badge', accountHop && accountHere && homeHop && noticeRead && noticeSeen, { accountHop, accountHere, homeHop, noticeRead, noticeSeen, noticeProbe })
    const clearHop = await ev('(() => { const a = [...document.querySelectorAll("header a")].find(l => (l.textContent || "").trim().startsWith("Orders")); if (a) a.click(); return !!a })()')
    check('viewing the orders area clears the badge', clearHop && await waitFor('location.pathname === "/account/orders" && !!document.querySelector("[data-orders-list]")'))
    await nav(appUrl)
    await waitFor('window.__W.some(w => w.method === "GET" && w.p === "/api/orders/stamps")', 10000)
    check('and the badge stays clear once seen', await ev('!document.querySelector("[data-orders-badge]")'))

    // The legal pages (compliance module): reachable from the catalog footer, translated headings in
    // both locales. The km visit writes the locale cookie, so it is put back to `en` afterwards — an
    // unprefixed `/` would otherwise redirect to /km/ for the slice that follows (redirectOn: root).
    await nav(appUrl)
    const footerLinks = await ev('[...document.querySelectorAll("footer a")].map(a => (a.textContent || "").trim())')
    check('the catalog footer links the legal pages', footerLinks.includes('Privacy Policy') && footerLinks.includes('Terms'), { footerLinks })
    await nav(appUrl + 'privacy')
    check('the privacy page renders its heading', await waitFor('(document.querySelector("main h1") || {}).textContent?.trim() === "Privacy Policy"'))
    await nav(appUrl + 'terms')
    check('the terms page renders its heading', await waitFor('(document.querySelector("main h1") || {}).textContent?.trim() === "Terms of Sale"'))
    await nav(appUrl + 'km/privacy')
    check('the privacy page renders in Khmer too', await waitFor('/[\\u1780-\\u17FF]/.test((document.querySelector("main h1") || {}).textContent || "")'))
    await ev('document.cookie = "raccoon-gear-bin-locale=en; path=/"; true')

    collectErrors()
  }

  // ============================== ADMIN ==============================
  if (ONLY !== 'guest') {
    await metrics(1440, 900, false)
    await nav(appUrl + 'admin/login')
    // Wait for the form rather than trusting `nav`'s settle guess: every other section does this, and
    // without it a page that fails to render turns into `Cannot read properties of undefined (reading 'x')`
    // instead of a named check that says which element never arrived.
    // The identifier field is `type="text"` since P6 — the phone-alias usernames are not
    // email-shaped, so the admin door takes either. This browser session becomes the desk here:
    // the stub's `/api/admin-check` answers admin while `__admin_session` is set (sessionStorage
    // carries it across the section's documents; the guest walk never sets it).
    await waitFor('!!document.querySelector("main form input")')
    // A refused gate must not be remembered (plans/007, D2). The storefront badge asks this same
    // question on the document's first mount, so a cached `false` would be handed back to the next
    // `isAdmin()` — and the login page reads it right after `signIn`, which is how a real admin gets
    // "unauthorized" without ever reloading. Refusing twice in ONE document is the proof: the second
    // attempt still asked. The recorder is in the page, so `__W` is the completion signal — waiting on
    // the path alone would race the fetch and read a count that has not landed yet.
    const setGateFields = (mail, pwd) => '(() => { const [m, p] = document.querySelectorAll("main form '
      + 'input"); if (!m || !p) return false; const set = (el, v) => { Object.getOwnPropertyDescriptor'
      + '(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { '
      + 'bubbles: true })) }; set(m, ' + JSON.stringify(mail) + '); set(p, ' + JSON.stringify(pwd) + ')'
      + '; return true })()'
    await ev(setGateFields('verify@example.test', 'verify-password'))
    await clickByText('form button[type="submit"]', 'Sign in', 'window.__W.filter(w => w.p === "/api/admin-check").length === 1')
    const gateRefused = await allW()
    check('a refused admin login asks the gate once and keeps the door shut',
      gateRefused.filter(w => w.p === '/api/admin-check').length === 1 && await ev('location.pathname') === '/admin/login',
      seqOf(gateRefused))
    await clickByText('form button[type="submit"]', 'Sign in', 'window.__W.filter(w => w.p === "/api/admin-check").length === 2')
    const gateRefusedTwice = await allW()
    check('a refused gate is not remembered — the second attempt asks again',
      gateRefusedTwice.filter(w => w.p === '/api/admin-check').length === 2, seqOf(gateRefusedTwice))
    // Back to empty fields: the walk below types with `Input.insertText`, which inserts at the caret
    // rather than replacing, so leftover text here would corrupt the real login.
    await ev(setGateFields('', ''))
    await resetW()
    await ev('sessionStorage.setItem("__admin_session", "1"); true')
    const email = (await ev(boxesExpr('main form input')))[0]
    const pass = (await ev(boxesExpr('main form input')))[1]
    await clickAt(email.x, email.y)
    await cdp.send('Input.insertText', { text: 'verify@example.test' })
    await clickAt(pass.x, pass.y)
    await cdp.send('Input.insertText', { text: 'verify-password' })
    await resetW()
    await clickByText('form button[type="submit"]', 'Sign in')
    check('login lands back on the catalog', await waitFor('location.pathname === "/"'))
    const loginWrites = await allW()
    check('login asked the admin gate and wrote no data', loginWrites.some(w => w.method === 'GET' && w.p === '/api/admin-check') && (await writes()).length === 0, seqOf(loginWrites))
    // stay in the SPA: a hard reload would make the un-stubbed server validate the fake JWT
    check('admin mode turns on', await waitFor(`document.querySelectorAll(${JSON.stringify(EDIT_BTN)}).length === ${EXP.cards}`, 15000))
    check('admin banner labels the mode', await ev('!![...document.querySelectorAll("header span")].find(el => /admin\\s*mode/i.test(el.textContent || ""))'))
    // The admin affordances join the utility group, so this is the widest the masthead ever gets.
    const adminMast = await ev(MASTHEAD_EXPR)
    check('masthead holds with the admin affordances in the utility group', mastheadFaults(adminMast, 1440).length === 0, mastheadFaults(adminMast, 1440))
    // The admin's Orders entry: the desk, not the buyer page — an admin's own account has no
    // purchases worth walking to — wearing the pending queue as its badge.
    const adminOrdersPill = await ev('(() => { const a = [...document.querySelectorAll("header a")].find(l => (l.textContent || "").trim().startsWith("Orders")); if (!a) return null; const b = a.querySelector("[data-orders-badge]"); return { href: a.getAttribute("href"), badge: b ? (b.textContent || "").trim() : null } })()')
    check('the admin masthead points Orders at the desk, not the buyer page', !!adminOrdersPill && adminOrdersPill.href === '/admin/orders', { adminOrdersPill })
    check('the admin masthead badges the pending queue', await waitFor('(document.querySelector("[data-orders-badge]") || {}).textContent?.trim() === "1"'), { adminOrdersPill })

    // --- add product, with a real file attached ---
    check('add button opens the editor', await clickByText('main button', 'Add product', `!!document.querySelector('${DIALOG} h2')`))
    const title = await ev(`(document.querySelector('${DIALOG} h2')?.textContent || "").trim()`)
    const catNames = [...new Set(FIXTURES.categories.map(c => c.category_translations?.[0]?.name || c.slug))]
    const trigText = await ev(`(() => { const d = document.querySelector(${JSON.stringify(DIALOG)}); if (!d) return "NODIALOG"; const b = [...d.querySelectorAll("button")].map(x => (x.textContent || "").trim()).filter(Boolean); return b[0] || "NOBUTTON" })()`)
    check('editor prefills the first category from the catalog', title === 'Add product' && catNames.includes(trigText), { title, trigText })
    await ev(byLabel('Product name', 'Verify Keyboard 99'))
    await ev(byLabel('SKU', 'VERIFY-KB-99'))
    await ev(byLabel('Slug', 'verify-keyboard-99'))
    await ev(byLabel('Price', '99.99'))
    await ev(byLabel('Stock', '3'))
    await ev(byLabel('Short description', 'Harness short'))
    await ev(byLabel('Full description', 'Harness full'))
    await ev(byLabel('Specifications', 'Switch: MX Black\nRatio: 70:30'))
    await ev(byLabel('Product image paths', 'products/verify/keep-me.png'))
    let uploadOk = false
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const FILE_SEL = DIALOG + ' input[type="file"]'
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: FILE_SEL })
    if (nodeId) {
      await cdp.send('DOM.setFileInputFiles', { files: [PNG_PATH], nodeId })
      uploadOk = (await ev('(() => { const el = document.querySelector(' + JSON.stringify(FILE_SEL) + '); el.dispatchEvent(new Event("change", { bubbles: true })); return el.files.length })()')) > 0
    }
    check('image selection reaches the file input', uploadOk)
    await resetW()
    await clickByText(DIALOG + ' button[type="submit"]', 'Save changes', '!document.querySelector(' + JSON.stringify(DIALOG) + ')')
    check('add closes the editor', await ev('!document.querySelector(' + JSON.stringify(DIALOG) + ')'))
    const addW = await writes()
    // The save is one transactional route call now (P7): the uploads run first from the browser,
    // then a single POST carries the row, its translation and the whole ordered image list.
    check('add write order: upload → one transactional save',
      JSON.stringify(addW.map(w => w.p.startsWith('/storage') ? 'UPLOAD' : `${w.method} ${w.p}`)) === JSON.stringify(['UPLOAD', 'POST /api/admin/products']),
      seqOf(addW))
    const addBody = JSON.parse(addW.find(w => w.p === '/api/admin/products')?.body || '{}')
    const prodBody = addBody.product || {}
    check('product payload keeps exactly the products columns', Object.keys(prodBody).sort().join(',') === EXP.sortedPayloadColumns && prodBody.status === 'published' && Number(prodBody.price) === 99.99 && prodBody.sku === 'VERIFY-KB-99', prodBody)
    const trBody = addBody.translation || {}
    check('translation row carries the name and parsed specification pairs', trBody.name === 'Verify Keyboard 99' && JSON.stringify(trBody.specifications) === JSON.stringify([{ label: 'Switch', value: 'MX Black' }, { label: 'Ratio', value: '70:30' }]), { name: trBody.name, specs: trBody.specifications })
    const uploadPath = norm(addW.find(w => w.p.startsWith('/storage/v1/object'))?.p || '')
    check('upload path is object/<bucket>/products/<newId>/<uuid>-<file>', uploadPath === '/storage/v1/object/product-images/products/<uuid>/<uuid>-upload-probe.png', uploadPath)
    const rows = addBody.images || []
    check('the save payload replaces all image rows: existing first, upload second', Array.isArray(rows) && rows.length === 2 && rows[0] === 'products/verify/keep-me.png' && String(rows[1]).endsWith('upload-probe.png'), rows)
    check('no image-row traffic rides beside the save', addW.every(w => w.p === '/api/admin/products' || w.p.startsWith('/storage')))
    check('catalog reloaded after the write', (await allW()).some(w => w.method === 'GET' && w.p === '/api/catalog/products'))

    // --- edit + update ---
    // The pen used to be `opacity-0 group-hover:opacity-100`: still clickable, still invisible,
    // so the affordance read as a dead spot that happened to work. Assert it is actually painted.
    const pen = await ev('(() => { const b = document.querySelector(' + JSON.stringify(EDIT_BTN) + '); if (!b) return null; const s = getComputedStyle(b); const r = b.getBoundingClientRect(); return { opacity: +s.opacity, w: r.width, h: r.height } })()')
    check('the edit affordance is visible without hovering', !!pen && pen.opacity === 1 && pen.w >= 32 && pen.h >= 32, pen)
    await ev(`document.querySelector(${JSON.stringify(EDIT_BTN)}).click()`)
    check('edit editor opens', await waitFor(`(document.querySelector('${DIALOG} h2')?.textContent || "").trim() === "Edit product"`))
    const seeded = await ev(`(() => { const d = document.querySelector(${JSON.stringify(DIALOG)}); if (!d) return { texts: [], nums: [], tas: [] }; return { texts: [...d.querySelectorAll("input")].filter(i => i.type !== "number" && i.type !== "file").map(i => i.value), nums: [...d.querySelectorAll("input[type=number]")].map(i => i.value), tas: [...d.querySelectorAll("textarea")].map(t => t.value.slice(0, 20)) } })()`)
    check('edit seeds every field from the product', seeded.texts.every(v => v.length > 0) && seeded.nums.length === 2 && seeded.tas.length === 3, seeded)
    await ev(byLabel('Product name', 'Renamed By Harness'))
    await resetW()
    await clickByText(DIALOG + ' button[type="submit"]', 'Save changes', '!document.querySelector(' + JSON.stringify(DIALOG) + ')')
    const editW = await writes()
    check('update order: one transactional save, no upload',
      JSON.stringify(editW.map(w => `${w.method} ${w.p}`)) === JSON.stringify(['POST /api/admin/products']),
      seqOf(editW))
    const patchReq = editW.find(w => w.p === '/api/admin/products')
    const patchBody = JSON.parse(patchReq?.body || '{}')
    check('update targets one row and keeps the same column set', /^[0-9a-f-]{36}$/.test(String(patchBody.id || '')) && Object.keys(patchBody.product || {}).sort().join(',') === EXP.sortedPayloadColumns, { id: norm(patchBody.id) })
    check('update rewrites the translation with the new name', (patchBody.translation || {}).name === 'Renamed By Harness')

    // --- promotion write ---
    // The five fields do not exist until the switch is on, so this reads the switch as the feature's
    // entry point and then asks what reached the row: five columns on the product, in the browser's
    // own local time — the modal takes a wall clock because an owner's "8pm" is theirs, not UTC's.
    await ev(`document.querySelector(${JSON.stringify(EDIT_BTN)}).click()`)
    await waitFor(`!!document.querySelector('${DIALOG}')`)
    const PROMO_SWITCH = DIALOG + ' [role="switch"]'
    await clickSelector(PROMO_SWITCH, '(() => { const b = document.querySelector(' + JSON.stringify(PROMO_SWITCH) + '); return !!b && b.getAttribute("aria-checked") === "true" })()')
    check('the promotion switch reveals its fields', await waitFor(`!!document.querySelector('${DIALOG} input[type="datetime-local"]')`))
    for (const [label, value] of [['Discounted price', '79.00'], ['Promotion name', 'Verify Sale'], ['Starts', '2026-09-01T10:00'], ['Ends', '2026-09-30T20:00'], ['Limited units', '3']]) await ev(byLabel(label, value))
    await resetW()
    const promoSaved = await clickByText(DIALOG + ' button[type="submit"]', 'Save changes', '!document.querySelector(' + JSON.stringify(DIALOG) + ')')
    const promoW = await writes()
    const promoBody = JSON.parse(promoW.find(w => w.p === '/api/admin/products')?.body || '{}').product || {}
    check('a promotion saves five columns on the product row', promoSaved && promoBody.promo_price === 79 && promoBody.promo_label === 'Verify Sale' && promoBody.promo_quantity === 3 && Date.parse(promoBody.promo_starts_at) === new Date('2026-09-01T10:00').getTime() && Date.parse(promoBody.promo_ends_at) === new Date('2026-09-30T20:00').getTime(), { promoBody, seq: seqOf(promoW) })

    // --- cancel + backdrop ---
    await ev(`document.querySelector(${JSON.stringify(EDIT_BTN)}).click()`)
    await waitFor(`!!document.querySelector('${DIALOG}')`)
    await resetW()
    const cancelled = await clickByText(DIALOG + ' button', 'Cancel', '!document.querySelector(' + JSON.stringify(DIALOG) + ')')
    await ev(`document.querySelector(${JSON.stringify(EDIT_BTN)}).click()`)
    await waitFor(`!!document.querySelector('${DIALOG}')`)
    await clickAt(14, 14)
    const backdropClosed = await waitFor('!document.querySelector(' + JSON.stringify(DIALOG) + ')')
    check('cancel and backdrop both close, writing nothing', cancelled && backdropClosed && (await writes()).length === 0, { cancelled, backdropClosed })

    // --- delete ---
    await ev(`document.querySelector(${JSON.stringify(EDIT_BTN)}).click()`)
    await waitFor(`!!document.querySelector('${DIALOG}')`)
    await clickByText(DIALOG + ' button', 'Delete product', `!!document.querySelector('${ALERT}')`)
    const confirmTxt = await ev(`(document.querySelector('${ALERT} h2')?.textContent || "").trim()`)
    check('delete confirmation names the product', confirmTxt.startsWith('Delete ') && confirmTxt.endsWith('?') && confirmTxt.length > 'Delete ?'.length, confirmTxt)
    await resetW()
    await clickByText(ALERT + ' button', 'Delete product', `!document.querySelector('${ALERT}')`)
    const delW = await writes()
    check('delete issues exactly one DELETE on the product row', delW.length === 1 && delW[0].method === 'DELETE' && /^\/api\/admin\/products\/[0-9a-f-]{36}$/.test(delW[0].p), seqOf(delW))
    check('no error alert surfaced by any admin flow', !(await ev('document.body.innerText.includes("could not be")')))

    // --- category editor: open, seed, rename, add, reorder, save, delete ---
    // The order is not a field: the list's position is the order, and saving rewrites `sort_order`
    // from it, so the assert reads the numbers the rows were patched with rather than a box an owner
    // could leave disagreeing with the list.
    const CAT_FORM = '[data-category-form]'
    // One header entry for the admin tools, then the tab strip moves between the editors. Each tool is
    // still its own page, so the flow asserts the route changed, not just that something rendered.
    check('the admin tools button opens the editors', await clickByText('header button', 'Admin tools', `location.pathname === "/admin/site-info" && !!document.querySelector('[data-admin-tabs]')`))
    check('the Categories tab is the current one only on its own page', await ev('(() => { const tabs = [...document.querySelectorAll("[data-admin-tab]")]; const on = tabs.filter(t => t.getAttribute("aria-current") === "page"); return tabs.length === 3 && on.length === 1 && on[0].getAttribute("data-admin-tab") === "site-info" })()'))
    await clickSelector('[data-admin-tab="categories"]', `location.pathname === "/admin/categories" && !!document.querySelector('${CAT_FORM}')`)
    check('the Categories tab opens the category editor', await ev(`!!document.querySelector('${CAT_FORM}')`))
    const catSeed = await ev('(() => { const f = document.querySelector(' + JSON.stringify(CAT_FORM) + '); if (!f) return null; const rows = [...f.querySelectorAll("[data-category-row]")]; const val = (r, k) => { const el = r.querySelector(k); return el ? el.value : null }; return { rows: rows.length, names: rows.map(r => val(r, "[data-category-en]")), slugs: rows.map(r => val(r, "[data-category-slug]")), on: rows.map(r => r.querySelector("[data-category-active]").getAttribute("aria-checked")) } })()')
    check('category editor seeds every stored row with both names and its visibility', !!catSeed && catSeed.rows === 5 && catSeed.names[0] === 'Controllers' && catSeed.slugs.join(',') === 'controllers,keyboards,mice,headphones,earphones' && catSeed.on.every(v => v === 'true'), catSeed)
    await ev(setInput('[data-category-en="4"]', 'Earphones Renamed'))
    await clickByText(CAT_FORM + ' button', 'Add category', 'document.querySelectorAll("[data-category-row]").length === 6')
    await ev(setInput('[data-category-en="5"]', 'Monitors'))
    // Move the new row up one: position five, so its stored order must come out as 5 and not 6.
    await clickSelector(CAT_FORM + ' [data-category-up="5"]', '(() => { const rows = document.querySelectorAll("[data-category-row]"); return (rows[4].textContent || "").includes("Monitors") })()')
    await resetW()
    await clickByText(CAT_FORM + ' button[type="submit"]', 'Save changes', 'document.body.textContent.includes("Categories saved")')
    const catW = await writes()
    // One save = one POST (P7). The rows array's ORDER is the dock order — the route writes
    // `sort_order` from the array position — and each row carries both locale names.
    const catSave = catW.filter(w => w.method === 'POST' && w.p === '/api/admin/categories')
    const catRows = JSON.parse(catSave[0]?.body || '{}').rows || []
    check('one save writes every category row and both locale names per row', catSave.length === 1 && catRows.length === 6 && catRows.some(r => r.names.en === 'Earphones Renamed') && catRows.some(r => r.names.en === 'Monitors'), { saves: catSave.length, rows: catRows.length })
    check('position in the list is the stored order, and the moved row takes its place not the end', catRows[4]?.slug === 'monitors' && catRows[4]?.isActive === true && catRows.map(r => r.slug).join(',') === 'controllers,keyboards,mice,headphones,monitors,earphones', { order: catRows.map(r => r.slug) })
    // The save reloads from the stub, which answers GETs from its fixture rows and keeps nothing an
    // admin flow writes (only `site_settings` is mutable in-stub) — so the created category is gone
    // again here and the list is the stored five. What this step proves is the row's own delete: one
    // DELETE on the id it was loaded with, and the row leaving the list.
    await resetW()
    await clickSelector(CAT_FORM + ' [data-category-remove="4"]', 'document.querySelectorAll("[data-category-row]").length === 4')
    const catDeleteW = await writes()
    check('a stored category\'s delete is one DELETE on its own row, and it leaves the list', catDeleteW.length === 1 && catDeleteW[0].method === 'DELETE' && /^\/api\/admin\/categories\/[0-9a-z-]+$/i.test(catDeleteW[0].p), seqOf(catDeleteW))
    // A name the owner erases has to leave the database. The save payload is where that decision
    // is visible now: the route deletes the stored locale when `namesBefore` had a name and the
    // new `names` entry is blank (the stub does not persist writes, so the stored value comes
    // from the fixture row, not from an earlier save in this flow).
    await resetW()
    await ev(setInput('[data-category-km="0"]', ''))
    await clickByText(CAT_FORM + ' button[type="submit"]', 'Save changes', 'document.body.textContent.includes("Categories saved")')
    const clearedW = await writes()
    const clearedSave = JSON.parse(clearedW.find(w => w.method === 'POST' && w.p === '/api/admin/categories')?.body || '{}')
    const clearedRow = (clearedSave.rows || [])[0] || {}
    check('erasing a stored Khmer name marks that translation for deletion in the save payload', clearedW.filter(w => w.method === 'DELETE').length === 0 && (clearedRow.names || {}).km === '' && String(((clearedRow.namesBefore || {}).km) || '').length > 0, { names: clearedRow.names, namesBefore: clearedRow.namesBefore })

    // Two rows that resolve to the same slug have to fail before the first write. The save loop is not
    // a transaction, so discovering the collision mid-loop would leave a half-saved dock order.
    // The list was reloaded by the save above, so it is the stored five again and the two new rows
    // are indices 5 and 6. Each Add waits for the count it should produce, and the refusal is asserted
    // by its message as well as by the absence of writes — an off-by-one here used to trip the *other*
    // guard (an empty row) and still satisfy a check that only counted requests.
    await clickByText(CAT_FORM + ' button', 'Add category', 'document.querySelectorAll("[data-category-row]").length === 6')
    await ev(setInput('[data-category-en="5"]', 'Duplicate Test'))
    await clickByText(CAT_FORM + ' button', 'Add category', 'document.querySelectorAll("[data-category-row]").length === 7')
    await ev(setInput('[data-category-en="6"]', 'Duplicate Test'))
    await resetW()
    await clickByText(CAT_FORM + ' button[type="submit"]', 'Save changes', 'document.body.textContent.includes("same slug")')
    const dupW = await writes()
    check('a duplicate slug is refused before anything is written', dupW.length === 0 && await ev('document.body.textContent.includes("Two categories ended up with the same slug")'), { seq: seqOf(dupW) })

    // --- the icon picker ---
    // The dock matches a category's mark on its slug, so the picker is the slug field's other end and
    // both halves are asserted: the slug the storefront will read, and the glyph the trigger paints.
    // The mark is measured, not looked for, because the crate fallback is painted before anything is
    // chosen too — only its geometry changing proves the preview follows the choice. Row 6 is one of
    // the two unsaved duplicate rows, so this touches no stored category and writes nothing.
    const ICON_TRIGGER = CAT_FORM + ' [data-category-icon="6"]'
    const ICON_SLUG_INPUT = CAT_FORM + ' [data-category-slug="6"]'
    const markExpr = '(() => { const s = document.querySelector(' + JSON.stringify(ICON_TRIGGER + ' svg') + '); if (!s) return null; const b = s.getBBox(); return [Math.round(b.width), Math.round(b.height)] })()'
    const slugValExpr = '(() => { const i = document.querySelector(' + JSON.stringify(ICON_SLUG_INPUT) + '); return i ? i.value : null })()'
    const markBefore = await ev(markExpr)
    await clickSelector(ICON_TRIGGER, '!!document.querySelector(\'[role="option"]\')')
    await clickByText('[role="option"]', 'gpu', '(() => { const i = document.querySelector(' + JSON.stringify(ICON_SLUG_INPUT) + '); return !!i && i.value === "gpu" })()')
    const iconSlug = await ev(slugValExpr)
    const markAfter = await ev(markExpr)
    check('choosing an icon writes the slug the dock matches on, and its mark replaces the crate', iconSlug === 'gpu' && !!markBefore && !!markAfter && markBefore.join() !== markAfter.join(), { slug: iconSlug, before: markBefore, after: markAfter })

    // The rail must be a sidebar beside the tool — an eyebrow over a vertical column, to the left of
    // the form — because that is the shape the storefront's category sidebar taught the owner.
    const railShape = contentSel => ev('(() => { const tabs = [...document.querySelectorAll("[data-admin-tab]")].map(t => t.getBoundingClientRect()); const content = document.querySelector(' + JSON.stringify(contentSel) + '); if (tabs.length !== 3 || !content) return null; const c = content.getBoundingClientRect(); return { stacked: tabs[1].top >= tabs[0].bottom - 0.5, leftOfContent: tabs[0].right <= c.left + 0.5 } })()')
    const catRail = await railShape(CAT_FORM)
    check('the admin tools rail is a sidebar beside the category editor', !!catRail && catRail.stacked && catRail.leftOfContent, catRail)

    // --- site info editor: open, seed, edit, add/toggle/reorder/remove links, save, reflect ---
    const SI = FIXTURES.siteSettings
    const SITE_FORM = '[data-site-info-form]'
    check('the Site info tab opens the site-info editor', await clickSelector('[data-admin-tab="site-info"]', `location.pathname === "/admin/site-info" && !!document.querySelector('${SITE_FORM}')`))
    const siteRail = await railShape(SITE_FORM)
    check('the same rail heads the site-info tool too', !!siteRail && siteRail.stacked && siteRail.leftOfContent, siteRail)
    const seed = await ev('(() => { const f = document.querySelector(' + JSON.stringify(SITE_FORM) + '); if (!f) return null; const v = (k) => (f.querySelector("[data-field=" + k + "]") || {}).value; return { phone: v("phone"), url: v("location-url"), en: v("location-en"), km: v("location-km"), rows: f.querySelectorAll("[data-social-row]").length } })()')
    check('editor seeds every stored value, disabled links included', !!seed && seed.phone === SI.phone && seed.url === SI.location_url && seed.en === 'Phnom Penh, Cambodia' && seed.km === 'ភ្នំពេញ កម្ពុជា' && seed.rows === 3, seed)
    await ev(setInput('[data-field=phone]', '+855 99 888 777'))
    await ev(setInput('[data-field=location-en]', 'RGB Bin HQ'))
    await ev(setInput('[data-field=location-url]', 'https://maps.example/hq'))
    check('adding a link appends an editable row', await clickByText('[data-social-add]', 'Add social link', 'document.querySelectorAll("[data-social-row]").length === 4'))
    await ev(setInput('[data-social-platform="3"]', 'youtube'))
    await ev(setInput('[data-social-url="3"]', 'https://youtube.com/@raccoongearbin'))
    const SWITCH_1 = '[data-social-enabled="1"]'
    const SWITCH_OFF = '(() => { const b = document.querySelector(' + JSON.stringify(SWITCH_1) + '); return !!b && b.getAttribute("aria-checked") === "false" })()'
    await clickSelector(SWITCH_1, SWITCH_OFF)
    check('a social link can be disabled from its row', await ev(SWITCH_OFF))
    const SWITCH_2 = '[data-social-enabled="2"]'
    const SWITCH_ON = '(() => { const b = document.querySelector(' + JSON.stringify(SWITCH_2) + '); return !!b && b.getAttribute("aria-checked") === "true" })()'
    // The two switches have to drive two fields, and the seeded row 2 proves it before anything is
    // clicked: tiktok is stored hidden from the header (`enabled` false) but contactable
    // (`contact_enabled` true), so its two controls must disagree out of the box. Asserted here,
    // above, because the next line is the flow turning that row's masthead switch on.
    const CONTACT_2 = '[data-social-contact="2"]'
    const flagsOf = (visible, contact) => '(() => { const v = document.querySelector(' + JSON.stringify(visible) + '); const c = document.querySelector(' + JSON.stringify(contact) + '); return !!v && !!c && v.getAttribute("aria-checked") === "false" && c.getAttribute("aria-checked") === "true" })()'
    check('one row can be hidden from the site and contactable at the same time', await ev(flagsOf(SWITCH_2, CONTACT_2)), { row: 2 })
    await clickSelector(SWITCH_2, SWITCH_ON)
    check('a social link can be enabled from its row', await ev(SWITCH_ON))
    // Row 1 is the other half of the pair: the flow has just hidden telegram from the header, and
    // its contact switch must still be on. Flipping that switch off and back on leaves `enabled`
    // untouched at both ends, which is the point of two controls — and restores the exact state the
    // saved body below is asserted against.
    const CONTACT_1 = '[data-social-contact="1"]'
    check('the row the flow just hid is still contactable', await ev('(() => { const v = document.querySelector(' + JSON.stringify(SWITCH_1) + '); const c = document.querySelector(' + JSON.stringify(CONTACT_1) + '); return !!v && !!c && v.getAttribute("aria-checked") === "false" && c.getAttribute("aria-checked") === "true" })()'))
    const contactOffVisibleStillOff = '(() => { const c = document.querySelector(' + JSON.stringify(CONTACT_1) + '); const v = document.querySelector(' + JSON.stringify(SWITCH_1) + '); return !!c && !!v && c.getAttribute("aria-checked") === "false" && v.getAttribute("aria-checked") === "false" })()'
    await clickSelector(CONTACT_1, contactOffVisibleStillOff)
    check('the contact switch turns off without touching the masthead switch', await ev(contactOffVisibleStillOff))
    await clickSelector(CONTACT_1, '(() => { const c = document.querySelector(' + JSON.stringify(CONTACT_1) + '); return !!c && c.getAttribute("aria-checked") === "true" })()')
    check('and turns back on, so the saved rows keep their contact visibility', await ev('(() => { const c = document.querySelector(' + JSON.stringify(CONTACT_1) + '); return !!c && c.getAttribute("aria-checked") === "true" })()'))
    check('a link can be reordered up', await clickSelector('[data-social-up="3"]', 'JSON.stringify([...document.querySelectorAll("[data-social-platform]")].map(i => i.value)) === "[\\"facebook\\",\\"telegram\\",\\"youtube\\",\\"tiktok\\"]"'))
    check('a link can be removed', await clickSelector('[data-social-remove="0"]', 'document.querySelectorAll("[data-social-row]").length === 3 && document.querySelectorAll("[data-social-platform]")[0].value === "telegram"'))
    await resetW()
    await clickByText('form button[type="submit"]', 'Save changes', 'document.body.textContent.includes("Site info saved")')
    const siteW = await writes()
    check('save issues exactly one upsert on the singleton', siteW.length === 1 && siteW[0].method === 'POST' && siteW[0].p === '/api/admin/site-info', seqOf(siteW))
    const siteBody = JSON.parse(siteW[0]?.body || '{}')
    check('saved phone, location label and link reflect the edits', siteBody.phone === '+855 99 888 777' && siteBody.location_url === 'https://maps.example/hq' && JSON.stringify(siteBody.location_translations) === JSON.stringify([{ locale: 'en', label: 'RGB Bin HQ' }, { locale: 'km', label: 'ភ្នំពេញ កម្ពុជា' }]), { phone: siteBody.phone, url: siteBody.location_url, labels: siteBody.location_translations })
    check('saved links reflect add, edit, disable, enable, reorder and remove', JSON.stringify(siteBody.social_links) === JSON.stringify([
      { platform: 'telegram', url: 'https://t.me/raccoongearbin', enabled: false, contact_enabled: true, sort_order: 0 },
      { platform: 'youtube', url: 'https://youtube.com/@raccoongearbin', enabled: true, contact_enabled: true, sort_order: 1 },
      { platform: 'tiktok', url: 'https://tiktok.com/@raccoongearbin.hidden', enabled: true, contact_enabled: true, sort_order: 2 }
    ]), siteBody.social_links)
    // The new key is written explicitly on every row the current editor saves, so a shop's stored
    // data stops depending on the inheritance rule the moment an owner touches the panel.
    check('both visibility flags are written per row, not implied', siteBody.social_links.every(link => typeof link.enabled === 'boolean' && typeof link.contact_enabled === 'boolean'), siteBody.social_links)
    check('editor reloads the saved row', await waitFor('document.querySelectorAll("[data-social-row]").length === 3'))
    await ev('document.querySelector("main header a")?.click(); true')
    check('public header reflects the saved values', await waitFor('location.pathname === "/" && document.querySelector("header a[data-site-phone]")?.getAttribute("href") === "tel:+85599888777" && document.querySelector("header a[data-site-location]")?.getAttribute("href") === "https://maps.example/hq" && [...document.querySelectorAll("header a[data-site-social]")].map(a => a.getAttribute("data-platform")).join() === "youtube,tiktok"'))

    check('back on the catalog, the dock is the stored five again', await waitFor('document.querySelectorAll(' + JSON.stringify('nav[aria-label="Product categories"] button') + ').length === 6'))
    // Every enabled platform must land on its own mark rather than the globe stand-in. TikTok is
    // the one that used to render as a generic music icon; youtube is asserted by name because it
    // is the platform the site owner asks for by name.
    const marks = await ev('(() => { const seen = {}; for (const a of document.querySelectorAll("header a[data-site-social]")) { const s = a.querySelector("svg"); const g = s.getBoundingClientRect(); const ink = s.getBBox(); seen[a.getAttribute("data-platform")] = { fill: s.getAttribute("fill"), children: s.children.length, paths: s.querySelectorAll("path").length, w: g.width, h: g.height, ink: [Math.round(ink.width), Math.round(ink.height)], d: s.querySelector("path")?.getAttribute("d") } } return seen })()')
    // Reported as `<platform>: <ink>` so a failure names which mark went blank instead of just
    // saying the set was wrong.
    const inkOf = () => Object.entries(marks).map(([k, g]) => `${k}=${g.ink.join('x')}`).join(' ')
    check('every enabled platform renders one filled mark, not the globe', Object.keys(marks).length > 1 && Object.values(marks).every(g => g.fill === 'currentColor' && g.children === 1 && g.paths === 1 && g.w === 16 && g.h === 16) && new Set(Object.values(marks).map(g => g.d)).size === Object.keys(marks).length, Object.keys(marks))
    check('every enabled platform paints its mark, none is a blank', Object.values(marks).every(g => g.ink[0] >= 12 && g.ink[1] >= 12), inkOf())
    check('youtube and tiktok are both on screen, as distinct marks', !!marks.youtube && !!marks.tiktok && marks.youtube.d !== marks.tiktok.d, inkOf())

    // ---- the editors in Khmer -------------------------------------------------------------------
    // No storefront route renders these pages, and the copy pass changed more text here than anywhere
    // else: `socialContactLabel` went from អនុញ្ញាតឱ្យទំនាក់ទំនង… to ឱ្យទាក់ទង…
    // precisely because it is a caption bounded at `max-w-[6.5rem]`. Those captions carry no
    // `truncate`, so nothing clips and the ink-vs-line-box sweep has nothing to report — what a long
    // Khmer word does to a box like this is overflow it, which `captionOverflow` reads as
    // `scrollWidth - clientWidth` off the `data-switch-caption` hook. The run sits at 1440 here, which
    // is what makes these `hidden xl:block` captions visible at all; below `xl` the list would be empty
    // and the bound would be measuring nothing. Reached through the language pill, never through
    // `AdminTabs`: those hrefs are plain by design (`/admin/*` is not a localized flow), so a tab click
    // leaves Khmer rather than carrying it.
    await clickByText('header button', 'Admin tools', `location.pathname === "/admin/site-info" && !!document.querySelector(${JSON.stringify(SITE_FORM)})`)
    await clickSelector('div[data-language-switcher] a[href^="/km/"]', 'location.pathname === "/km/admin/site-info"')
    await waitFor('!!document.querySelector(' + JSON.stringify(SITE_FORM) + ')')
    // Same wait the categories sweep below documents: the decode window is still cycling when these
    // reads land, and the noise is Greek, Cyrillic, Hanzi — an unbreakable noise run in a 76px
    // caption box overflows it where the settled Khmer caption wraps (the caption control's own
    // comment admits the scrambling decides the answer; a run caught `over: 3` on noise). Wait the
    // window out: the pins release with the last settle and `MAX_WINDOW_MS` caps the whole thing.
    await sleep(1400)
    const kmSiteWide = await latinSpacedKhmer()
    check('no Khmer run in the site-info editor is letter-spaced like Latin', kmSiteWide.bad.length === 0 && kmSiteWide.seen > 5, { kmSiteWide })
    const kmSiteClipped = await clippedInk()
    check('no Khmer run in the site-info editor is clipped by its own box', kmSiteClipped.bad.length === 0, { kmSiteClipped })
    const SWITCH_CAPTIONS = '[data-switch-caption]'
    const kmSiteCaptions = await captionOverflow(SWITCH_CAPTIONS)
    check('every Khmer site-info caption fits the box it is bounded to', kmSiteCaptions.length === 6 && kmSiteCaptions.every(c => c.over <= 1), { kmSiteCaptions })
    // Control, because "nothing overflows" and "the probe never fired" are the same green line.
    // Squeeze one caption on purpose, read the overflow back, restore it in the same expression — and
    // pin `white-space` for the squeeze: the captions are measured while the locale decode may still be
    // scrambling them, and whether the string in the box at that instant happens to be a run of
    // unbreakable noise glyphs or a real caption that can wrap decides the answer. The control's claim
    // is that the measurement reports an overflow at all, which needs a box that cannot make the
    // content fit.
    const kmCaptionProbe = await ev('(() => { const s = document.querySelector(' + JSON.stringify(SWITCH_CAPTIONS) + '); if (!s) return null; const before = { tag: s.tagName, display: getComputedStyle(s).display, white: getComputedStyle(s).whiteSpace, text: (s.textContent || "").trim().slice(0, 24), w: Math.round(s.getBoundingClientRect().width), rects: s.getClientRects().length, cw: s.clientWidth, sw: s.scrollWidth }; s.style.maxWidth = "2rem"; s.style.whiteSpace = "nowrap"; const o = s.scrollWidth - s.clientWidth; s.style.maxWidth = ""; s.style.whiteSpace = ""; return { over: o, ...before } })()')
    check('the caption-overflow measurement can report an overflow', !!kmCaptionProbe && kmCaptionProbe.over > 1, { kmCaptionProbe })

    await clickSelector('[data-admin-tab="categories"]', 'location.pathname === "/admin/categories"')
    await clickSelector('div[data-language-switcher] a[href^="/km/"]', 'location.pathname === "/km/admin/categories"')
    await waitFor('!!document.querySelector(' + JSON.stringify(CAT_FORM) + ')')
    // The decode is still cycling when this sweep first lands, and the noise is Greek, Cyrillic,
    // Hanzi — not Khmer — so the count of nodes actually carrying a Khmer run drops below the floor
    // that proves the sweep looked at anything (`seen: 2`, twice, on otherwise green runs). Wait the
    // window out: the pins release with the last settle and `MAX_WINDOW_MS` caps the whole thing.
    await sleep(1400)
    const kmCatWide = await latinSpacedKhmer()
    check('no Khmer run in the category editor is letter-spaced like Latin', kmCatWide.bad.length === 0 && kmCatWide.seen > 5, { kmCatWide })
    const kmCatClipped = await clippedInk()
    check('no Khmer run in the category editor is clipped by its own box', kmCatClipped.bad.length === 0, { kmCatClipped })
    const kmCatCaptions = await captionOverflow(SWITCH_CAPTIONS)
    check('every Khmer category caption fits the box it is bounded to', kmCatCaptions.length > 0 && kmCatCaptions.every(c => c.over <= 1), { kmCatCaptions })
    // Back to English before anything else runs — the channel list and the prepared message below are
    // built through `t()`, so a Khmer page left behind would hand the fixtures copy they never expect —
    // then onto the catalog the same way the flow above returns, leaving the page state the checks that
    // follow were written against. The first pill is `EN` (this is `prefix_except_default`).
    // Asserted, not fire-and-forget: `clickSelector` returns false when its wait expires, and a locale
    // switch that silently does nothing would leave every check below this one reading Khmer copy. The
    // switcher is aimed at through `data-language-switcher` rather than its aria-label because that
    // label is itself translated — on a Khmer page it reads ភាសា, so the English string matches nothing.
    check('the English pill hands the editors back to English', await clickSelector('div[data-language-switcher] a:first-child', 'location.pathname === "/admin/categories"'), { path: await ev('location.pathname') })
    await clickSelector('[data-admin-tab="site-info"]', `!!document.querySelector(${JSON.stringify(SITE_FORM)})`)
    check('the editors are back in English for the checks that follow', await ev('(() => { const h = document.querySelector("main h1"); return !!h && h.textContent.trim() === "Site info" })()'), { path: await ev('location.pathname') })
    await ev('(() => { const a = document.querySelector("main header a"); if (a) a.click(); return true })()')
    await waitFor('location.pathname === "/" && !!document.querySelector(\'main article h2 a\')', 10000)

    // ---- the admin order desk (phase 3: orders) ---------------------------------------------------
    // The buyer's half of the flow runs in the guest slice (it needs a session and a cart); this half
    // is the desk. The stub answers the order read newest-first with the cancelled fixture on top, so
    // the row order below proves the desk's own pending-first sort rather than the server's.
    //
    // The recorder is emptied here on purpose: the admin navigations between this line and the check
    // below are what plans/007 is about, and counting them needs a clean starting point.
    await resetW()
    await clickByText('header button', 'Admin tools', `location.pathname === "/admin/site-info" && !!document.querySelector('[data-admin-tabs]')`)
    check('the orders tab opens the desk', await clickSelector('[data-admin-tab="orders"]', 'location.pathname === "/admin/orders" && !!document.querySelector("[data-order-filters]")'))
    await waitFor('!!document.querySelector("[data-admin-order-row]")')
    const deskRows = await ev('[...document.querySelectorAll("[data-admin-order-row]")].map(r => (r.querySelector("[data-order-status]") || {}).textContent?.trim())')
    check('the desk lists both orders with the pending one first', JSON.stringify(deskRows) === JSON.stringify(['Pending', 'Cancelled']), deskRows)

    // The gate question, once at most for the whole walk (plans/007, D1 + D4). Each `clickSelector`
    // above and below asserts its own route and form first, because a request count on a page that
    // never mounted would pass by idleness — the trap this file documents for the locale sweeps.
    //
    // The bound is 1 rather than 0 because the answer may or may not already be cached when the walk
    // starts (the storefront's own mount asks after the session lands), and it is measured over FOUR
    // navigations so the difference is decisive: reverting the composable's cache (D1) or the guard's
    // use of it (D4) makes this 4, because the guard then keeps its own copy and pays it every time.
    // Measured: 0 here, 4 with the guard reverted.
    await clickSelector('[data-admin-tab="site-info"]', `location.pathname === "/admin/site-info" && !!document.querySelector(${JSON.stringify(SITE_FORM)})`)
    await clickSelector('[data-admin-tab="categories"]', `location.pathname === "/admin/categories" && !!document.querySelector(${JSON.stringify(CAT_FORM)})`)
    const gateWalk = await allW()
    const gateAsks = gateWalk.filter(w => w.p === '/api/admin-check')
    check('walking the admin desk asks the gate at most once, never once per view', gateAsks.length <= 1, seqOf(gateWalk))
    await clickSelector('[data-admin-tab="orders"]', 'location.pathname === "/admin/orders" && !!document.querySelector("[data-admin-order-row]")')

    // The desk's search: client-side over the loaded list, across identity, delivery and item
    // names — whatever a phone call gives you. Queries come from the fixtures ('siem reap' is the
    // cancelled row's address, 'keyboard' the pending row's item) and stay lowercase on purpose:
    // case-insensitivity is part of the contract.
    await ev(setInput('[data-admin-orders-search]', 'siem reap'))
    const addressHit = await waitFor('[...document.querySelectorAll("[data-admin-order-row]")].length === 1 && (document.querySelector("[data-order-status]") || {}).textContent?.trim() === "Cancelled"')
    check('search narrows the desk by delivery address, case-insensitively', addressHit)
    await ev(setInput('[data-admin-orders-search]', 'keyboard'))
    const itemHit = await waitFor('[...document.querySelectorAll("[data-admin-order-row]")].length === 1 && (document.querySelector("[data-order-status]") || {}).textContent?.trim() === "Pending"')
    check('search matches item names too', itemHit)
    await ev(setInput('[data-admin-orders-search]', 'no-such-order'))
    const emptied = await waitFor('[...document.querySelectorAll("[data-admin-order-row]")].length === 0 && (document.body.textContent || "").includes("No orders in this view.")')
    await ev(setInput('[data-admin-orders-search]', ''))
    const restored = await waitFor('[...document.querySelectorAll("[data-admin-order-row]")].length === 2')
    check('a search with no matches says so, and clearing restores the list', emptied && restored, { emptied, restored })

    check('a pending order expands to its detail', await clickSelector('[data-order-toggle]', '!!document.querySelector("[data-order-actions]")'))
    const pendingActions = await ev('[...document.querySelectorAll("[data-order-actions] [data-order-action]")].map(b => ({ action: b.getAttribute("data-order-action"), text: (b.textContent || "").trim() }))')
    check('a pending order offers exactly the two written transitions', JSON.stringify(pendingActions) === JSON.stringify(EXP.orders.pendingActions), pendingActions)

    await resetW()
    await clickSelector('[data-order-action="confirmed"]', 'window.__W.filter(w => w.method === "POST" && w.p.indexOf("/status") !== -1).length === 1')
    const orderWrites = await writes()
    const transitionBody = JSON.parse(orderWrites[0]?.body || '{}')
    check('confirming issues exactly one set_order_status and no other write', orderWrites.length === 1 && orderWrites[0].p === '/api/orders/' + ORDER_ID + '/status' && transitionBody.status === 'confirmed', seqOf(orderWrites))
    check('the desk reloads the list after the write', (await allW()).some(w => w.method === 'GET' && w.p === '/api/orders'))

    // The cancel arm: its confirmation asks for an optional reason, and confirming sends it with
    // the transition in the same one RPC. The row is still open from the confirm above.
    check('the cancel confirmation asks for an optional reason', await clickSelector('[data-order-action="cancelled"]', '!!document.querySelector("[data-order-confirm-note]")'))
    await ev(setInput('[data-order-confirm-note]', CANCEL_NOTE))
    await resetW()
    await clickSelector('[data-order-confirm]', 'window.__W.filter(w => w.method === "POST" && w.p.indexOf("/status") !== -1).length === 1')
    const cancelWrites = await writes()
    const cancelBody = JSON.parse(cancelWrites[0]?.body || '{}')
    check('cancelling sends the note with the transition', cancelWrites.length === 1 && cancelBody.status === 'cancelled' && cancelBody.note === CANCEL_NOTE, seqOf(cancelWrites))

    check('a cancelled order opens with no transition buttons at all', await clickSelector(`[data-order-toggle="${CANCELLED_ORDER_ID}"]`, `!!document.querySelector(${JSON.stringify('[data-order-body="' + CANCELLED_ORDER_ID + '"]')}) && !document.querySelector("[data-order-actions]")`))
    const cancelledDeskBody = await ev('(document.querySelector(' + JSON.stringify('[data-order-body="' + CANCELLED_ORDER_ID + '"]') + ') || {}).textContent || ""')
    check('the desk shows the recorded cancellation note', cancelledDeskBody.includes(CANCELLED_NOTE), { hasNote: cancelledDeskBody.includes(CANCELLED_NOTE) })
    const cancelledLocation = await ev('(document.querySelector(' + JSON.stringify('[data-order-body="' + CANCELLED_ORDER_ID + '"] [data-order-location]') + ') || {}).href || null')
    check('the desk links the cancelled order\'s map pin', cancelledLocation === EXP.orders.cancelledLocation, { cancelledLocation })

    // ---- the refund marker (plans/009) -----------------------------------------------------------
    // Money is its own axis: the paid fixture is also the cancelled one, which is the SPEC's "paid
    // then cancelled, returned manually" case — a terminal order renders no transition buttons at
    // all, and the refund is still offered. That is the whole reason it is not one of them.
    check('a paid order offers the refund marker even with no transitions left',
      await ev('!!document.querySelector(' + JSON.stringify(`[data-order-body="${CANCELLED_ORDER_ID}"] [data-order-action="refund"]`) + ') && !document.querySelector("[data-order-actions]")'))
    check('an unpaid order offers no refund marker',
      await clickSelector(`[data-order-toggle="${ORDER_ID}"]`, `!!document.querySelector(${JSON.stringify(`[data-order-body="${ORDER_ID}"]`)}) && !document.querySelector(${JSON.stringify(`[data-order-body="${ORDER_ID}"] [data-order-refund]`)})`))
    await clickSelector(`[data-order-toggle="${CANCELLED_ORDER_ID}"]`, `!!document.querySelector(${JSON.stringify(`[data-order-body="${CANCELLED_ORDER_ID}"] [data-order-action="refund"]`)})`)
    check('the refund confirmation asks for an optional note', await clickSelector('[data-order-action="refund"]', '!!document.querySelector("[data-order-confirm-note]")'))
    await ev(setInput('[data-order-confirm-note]', REFUND_NOTE))
    await resetW()
    await clickSelector('[data-order-confirm]', 'window.__W.filter(w => w.method === "POST" && w.p.indexOf("/refund") !== -1).length === 1')
    const refundWrites = await writes()
    const refundBody = JSON.parse(refundWrites[0]?.body || '{}')
    check('refunding posts exactly one marker carrying its note',
      refundWrites.length === 1 && refundWrites[0].p === `/api/orders/${CANCELLED_ORDER_ID}/refund` && refundBody.note === REFUND_NOTE,
      seqOf(refundWrites))
    check('the desk re-reads and shows the payment as refunded',
      await waitFor(`(document.querySelector(${JSON.stringify(`[data-order-toggle="${CANCELLED_ORDER_ID}"] [data-payment-status]`)}) || {}).textContent?.trim() === "Refunded"`))
    check('the marker is gone once the payment is refunded',
      await ev(`!document.querySelector(${JSON.stringify(`[data-order-body="${CANCELLED_ORDER_ID}"] [data-order-refund]`)})`))
    check('the cancelled chip narrows the desk to that status', await clickSelector('[data-order-filter="cancelled"]', '[...document.querySelectorAll("[data-admin-order-row]")].length === 1 && (document.querySelector("[data-order-status]") || {}).textContent?.trim() === "Cancelled"'))

    // Back to the catalog through the header's own back link, the way the blocks below expect it.
    await ev('(() => { const links = document.querySelectorAll("header a"); if (links.length) links[links.length - 1].click(); return true })()')
    await waitFor('location.pathname === "/" && !!document.querySelector(\'main article h2 a\')', 10000)

    // The site-info save has to reach the product page's contact channels. Reached by an in-app
    // navigation, not a reload: the stub's site row lives inside the document, so a fresh load
    // would reset it to the fixture values and prove nothing about the edit. This is also the only
    // check that can prove the channel list is consumed from configuration rather than invented.
    // The card's title link is the route into a product; picked by structure because a selector
    // carrying quoted quotes inside this file's single-quoted expressions is how the previous
    // attempt produced an invalid selector instead of a click.
    await ev('(() => { const card = document.querySelector("main article h2 a"); if (card) card.click(); return true })()')
    check('a product page reached from the catalog mounts the conversion feature', await waitFor('!!document.querySelector(\'[data-contact-cta]\')', 10000))
    await clickSelector('[data-contact-cta]', '!!document.querySelector("[data-contact-panel]")')
    const afterSave = (await mounts()).find(m => m.where === 'inline') || { channels: [], message: '' }
    const hrefsNow = afterSave.channels.map(c => c.href)
    const wantSaved = EXP.conversion.savedChannelHrefs.map(href => href.replace('{message}', encodeURIComponent(afterSave.message)))
    check('the product page offers exactly the channels the shop just configured', JSON.stringify(hrefsNow) === JSON.stringify(wantSaved), { hrefsNow: hrefsNow.map(h => h.slice(0, 60)), want: wantSaved.map(h => h.slice(0, 60)) })
    // The header check above proves telegram left the masthead; this one proves it stayed a contact
    // channel, which is only possible because the two flags are separate settings. Seeded fixtures
    // already cover the same pair statically — this is the same rule applied to data the admin flow
    // actually wrote through the real upsert body.
    check('a channel the shop hid from the header but left contactable is still offered', hrefsNow.some(h => h.includes('t.me/raccoongearbin')) && await ev('window.__SITE.social_links.some(l => l.platform === "telegram" && l.enabled === false && l.contact_enabled === true)'), { hrefsNow: hrefsNow.map(h => h.slice(0, 60)) })
    const here = await ev('location.origin + location.pathname')
    const headingNow = await ev('(document.querySelector("main h1") || {}).textContent?.trim()')
    const canonicalHere = await ev('(() => { const l = document.querySelector("link[rel=canonical]"); return l ? l.getAttribute("href") : null })()')
    check('the prepared message names this product and ends at this page’s canonical address', !!headingNow && (afterSave.message || '').includes(headingNow) && (afterSave.message || '').split('\n').pop() === here && canonicalHere === here, { headingNow, here, canonicalHere, message: norm(afterSave.message) })

    // --- logout ---
    // Back to the catalog through the detail page's own control first: the logout button lives in
    // the home header, and a product page has never carried one. (The last anchor in the detail
    // header is the back link; naming it by structure avoids a quoted attribute selector inside
    // this file's single-quoted expressions.)
    await ev('(() => { const links = document.querySelectorAll("header a"); if (links.length) links[links.length - 1].click(); return true })()')
    await waitFor('location.pathname === "/"', 10000)
    check('logout clears admin mode', await clickByText('header button', 'Log out', `document.querySelectorAll(${JSON.stringify(EDIT_BTN)}).length === 0`))
    collectErrors()
  }

  // ============================== console ==============================
  // Two allowlisted classes, each named by its cause rather than "errors are fine": the hydration
  // mismatch Vue reports on every stubbed page, and Clerk's client SDK failing to load from the
  // harness's deliberately fake key host (see the spawn env — dev-form keys were rejected for
  // their per-navigation network handshake, so no key that could actually load can be used).
  // Every other line stays a failure.
  const known = /Hydration completed but contains mismatches|Clerk: Failed to load Clerk (JS|UI)/
  const real = consoleErrors.filter(e => !known.test(e))
  console.log(`\nCONSOLE_ERRORS ${JSON.stringify(consoleErrors.slice(0, 4))}`)
  check('no exceptions or console errors beyond the known hydration and local Clerk-load failures', real.length === 0, real.slice(0, 3))

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) console.log('failed: ' + failed.map(f => f.name).join(' | '))
  await shutdown(failed.length ? 1 : 0)
}

run().catch(err => { console.error('\nharness error: ' + (err?.stack || err)); return shutdown(2) })
