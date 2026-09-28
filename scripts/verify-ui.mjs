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
 * SAFETY: it never touches a real project. A browser-level `fetch` stub answers every
 * /rest/v1, /auth/v1 and /storage/v1 request from scripts/fixtures.json, so no read is needed,
 * no login is required, and no write can reach the database. Server-side (SSR) requests are NOT
 * stubbed — which is why the admin section stays inside the SPA after logging in rather than
 * hard-reloading into a session the real auth server cannot validate.
 *
 * USAGE
 *   bun run verify                 # build first, then all checks
 *   node scripts/verify-ui.mjs     # same, on Node 24 (global WebSocket; no dependencies)
 *   ... --only=guest | --only=admin
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
const WORK = join(ROOT, '.nuxt', 'verify')
const FIXTURES = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const argv = process.argv.slice(2)
const flag = name => argv.find(a => a.startsWith(`--${name}`))
const ONLY = flag('only=')?.split('=')[1] || 'all'
const URL_OVERRIDE = flag('url=')?.split('=')[1] || null

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ::  ' + JSON.stringify(detail) : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

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
  '  function b64(o) { return btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/[+]/g, "-").replace(/[/]/g, "_") }',
  '  var iat = Math.floor(Date.now() / 1000);',
  '  var jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: FIXED_USER, role: "authenticated", aud: "authenticated", session_id: "verify", iat: iat, exp: iat + 7200 }) + ".sig";',
  '  var user = { id: FIXED_USER, aud: "authenticated", role: "authenticated", email: "verify@example.test", phone: null, user_metadata: {}, app_metadata: { provider: "email", providers: ["email"] }, identities: [], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(), last_sign_in_at: new Date(0).toISOString() };',
  '  var session = { access_token: jwt, token_type: "bearer", expires_in: 3600, refresh_token: "verify-refresh", expires_at: iat + 3600, user: user };',
  '  window.__W = [];',
  // Aliases for the two fixture collections the stub answers from. They are handed out on purpose:
  // a test that needs a *different* shop configuration — no contact channels at all, a product with
  // no photos, a name full of punctuation — mutates these from a document script registered before
  // the app runs, then removes it again. That keeps those cases honest (the app reads them through
  // the same REST stub as everything else) without adding a seventh product row that every card and
  // price count in this file would then have to chase.
  '  window.__PRODUCTS = PRODUCTS;',
  '  window.__SITE = SITE;',
  '  function json(body, status) { return new Response(body === null ? null : JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } }) }',
  '  var orig = window.fetch.bind(window);',
  '  window.fetch = function (input, init) {',
  '    var url = (typeof input === "string") ? input : ((input && input.url) || "");',
  '    var method = String((init && init.method) || ((typeof input === "object") && input.method) || "GET").toUpperCase();',
  '    if (!new RegExp("/(rest|auth|storage)/").test(url)) return orig(input, init);',
  '    var path = url.replace(new RegExp("^https?://[^/]+"), "");',
  '    var cut = path.indexOf("?");',
  '    var p = cut >= 0 ? path.slice(0, cut) : path;',
  '    var q = cut >= 0 ? path.slice(cut + 1).replace(new RegExp("&?apikey=[^&]*", "g"), "").replace(new RegExp("&?[a-z-]+=\\\\d{10,13}", "g"), "") : "";',
  '    var raw = init && init.body;',
  '    window.__W.push({ method: method, p: p, q: q, body: (typeof raw === "string") ? raw : (raw ? "<bytes>" : null) });',
  '    if (method === "GET" && p === "/rest/v1/admin_users") return json({ role: "super_admin" }, 200);',
  '    if (method === "GET" && p === "/auth/v1/user") return json(user, 200);',
  '    if (p === "/auth/v1/token") return json(session, 200);',
  '    if (p === "/auth/v1/logout") return json(null, 204);',
  '    if (new RegExp("^/storage/v1/object").test(p) && method !== "GET") return json({ Key: "ok", Id: NEW_ROW_ID }, 200);',
  '    if (p === "/rest/v1/products" && method === "GET") { var one = new RegExp("id=eq[.]([0-9a-f-]+)").exec(q); return json(one ? (PRODUCTS.filter(function (x) { return x.id === one[1] })[0] || null) : PRODUCTS, 200) }',
  '    if (p === "/rest/v1/categories" && method === "GET") return json(CATEGORIES, 200);',
  '    if (p === "/rest/v1/site_settings" && method === "GET") return json([SITE], 200);',
  // The site-info singleton is editable in-stub so the "public reflects the save" check can
  // read back what the admin flow wrote, without any real project being touched.
  '    if (p === "/rest/v1/site_settings" && (method === "PATCH" || method === "POST")) { try { Object.assign(SITE, JSON.parse(raw || "{}")); } catch (e) {} return json(method === "POST" ? [SITE] : null, method === "POST" ? 201 : 204); }',
  '    if (p === "/rest/v1/products" && method === "POST") return json({ id: NEW_ROW_ID }, 201);',
  '    if (method === "PATCH" || method === "DELETE") return json(null, 204);',
  '    if (method === "POST") return json([], 201);',
  '    return json([], 200);',
  '  };',
  '})()'
].join('\n')

// ---------------------------------------------------------------- CDP client
// Every CDP response wraps its payload in `result`; forgetting that level is the single easiest
// way to "discover" a missing element that is really a parsing mistake.
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.events = [] }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)
      this.ws.onopen = resolve
      this.ws.onerror = e => reject(new Error('websocket failed: ' + (e?.message || e)))
      this.ws.onmessage = ev => {
        const m = JSON.parse(ev.data)
        if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id) }
        if (m.method) this.events.push(m)
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
    server = spawn(process.execPath, [join(ROOT, '.output', 'server', 'index.mjs')], {
      cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: 'ignore'
    })
    if (!await waitForHttp(appUrl)) throw new Error('preview server never answered on ' + appUrl)
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
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOM.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource })

  // 3. helpers built on the client
  const ev = expr => cdp.ev(expr)
  const nav = async url => { await cdp.send('Page.navigate', { url }); await sleep(2200) }
  const metrics = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  const mouse = (type, x, y, buttons = 0) => cdp.send('Input.dispatchMouseEvent', { type, x, y, buttons, clickCount: 1, button: 'left' })
  const clickAt = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await mouse('mouseReleased', x, y); await sleep(90) }
  const park = async () => { await mouse('mouseMoved', 12, 12); await sleep(450) }
  const waitFor = async (expr, ms = 8000) => {
    const until = Date.now() + ms
    while (Date.now() < until) { try { if (await ev(expr)) return true } catch { return false } await sleep(150) }
    return false
  }
  // contains, not equality ("＋ Add product"); and a modal's footer button sits below its own
  // scroll fold, so scroll it into view before reading the rect.
  const findBox = (sel, text) => '(() => { const el = [...document.querySelectorAll(' + JSON.stringify(sel) + ')].find(b => (b.textContent || "").trim().includes(' + JSON.stringify(text) + ')); if (!el) return null; el.scrollIntoView({ block: "center", inline: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'
  const clickByText = async (sel, text, waitExpr) => {
    let box = null
    const until = Date.now() + 7000
    while (!box && Date.now() < until) { box = await ev(findBox(sel, text)); if (!box) await sleep(150) }
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
  // The clipboard and the share sheet are things the rig has to decide about, and both have to be
  // installed *after* the navigation that re-injected the stub: the app reads `navigator.clipboard`
  // and `navigator.share` when the button is pressed, not when the page loads. `reject` and
  // `absent` deliberately record nothing, so "the copy happened" and "the copy was attempted" stay
  // distinguishable in the assertions.
  const CLIPBOARD = {
    ok: '{ writeText: function (t) { window.__COPIES.push(String(t)); return Promise.resolve(); } }',
    reject: '{ writeText: function () { return Promise.reject(new Error("NotAllowedError")); } }',
    missing: 'undefined'
  }
  const SHARE = {
    // `navigator.userActivation.isActive` is recorded at the moment the app calls share, which is
    // the only way to tell "called from the click" apart from "called after an await that cost the
    // activation" — a sheet that silently stops opening on mobile is exactly that failure, and no
    // amount of reading the code afterwards proves the timing.
    // Both settling mocks settle on a *timer*, not a microtask: a real share sheet takes ~1s
    // before it can resolve or be dismissed (measured in a visible Chrome window), and the app
    // now reads the SPEED of any settle as "the visitor had a sheet" vs "the platform answered
    // for them". A mock that settled synchronously would mock a browser that does not exist —
    // and the app must treat that shape (fast resolve or fast abort) as a phantom: no sheet ever
    // painted, so the clipboard fallback is the only honest outcome.
    ok: 'function (data) { window.__SHARES.push(Object.assign({}, data, { activation: !!(navigator.userActivation && navigator.userActivation.isActive) })); return new Promise(function (resolve) { setTimeout(function () { window.__SHARE_SETTLED = "shared"; resolve(); }, 400) }); }',
    // The reported defect, as a mock: the method exists, "succeeds" instantly, and no UI paints.
    'resolve-fast': 'function (data) { window.__SHARES.push(Object.assign({}, data, { activation: !!(navigator.userActivation && navigator.userActivation.isActive) })); return Promise.resolve(); }',
    abort: 'function () { return new Promise(function (_, reject) { setTimeout(function () { var e = new Error("dismissed"); e.name = "AbortError"; window.__SHARE_SETTLED = "aborted"; reject(e); }, 400) }); }',
    // The desktop-Chrome-on-macOS case measured in Phase 1.2: the method exists, and it rejects
    // with an AbortError so fast the sheet never painted.
    'abort-fast': 'function () { return Promise.reject(Object.assign(new Error("abort"), { name: "AbortError" })); }',
    absent: 'undefined'
  }
  const armClipboard = mode => ev('(() => { window.__COPIES = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: ' + CLIPBOARD[mode] + ' }); return true })()')
  const armShare = mode => ev('(() => { window.__SHARES = []; Object.defineProperty(navigator, "share", { configurable: true, value: ' + SHARE[mode] + ' }); return true })()')
  const copies = async () => await ev('window.__COPIES || []')
  const shares = async () => await ev('window.__SHARES || []')
  // Stop a channel link from actually leaving the page so the click can still be observed. The
  // listener captures on the document and only cancels the default, which leaves the app's own
  // handlers running — the way to ask "did tapping a channel pretend to copy something?".
  const holdChannelLinks = () => ev('(() => { window.__BLOCKED = 0; document.addEventListener("click", function (e) { var link = e.target && e.target.closest ? e.target.closest("[data-contact-channel]") : null; if (link) { e.preventDefault(); window.__BLOCKED++; } }, true); return true })()')
  // A shop or a product that the fixtures do not contain: mutate the stub's own collections before
  // the app boots, run the navigation, then remove the script so no later check inherits it.
  const forNextDocument = async source => (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier
  const stopForNextDocument = identifier => cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {})
  // Both mounts of the conversion UI in one read: the inline block and the teleported sticky bar
  // are the same component twice, so every assertion below asks the same question of each and the
  // answers are what prove the two cannot drift apart.
  const MOUNTS = '(() => { const out = []; for (const el of document.querySelectorAll("[data-product-actions]")) { const cta = el.querySelector("[data-contact-cta]"); const msg = el.querySelector("[data-contact-message]"); const fb = el.querySelector("[data-contact-feedback]"); const panel = el.querySelector("[data-contact-panel]"); const label = el.querySelector("label"); const field = el.querySelector("textarea"); out.push({ where: el.closest("[data-sticky-cta]") ? "sticky" : "inline", visible: el.getClientRects().length > 0, tag: cta ? cta.tagName : null, type: cta ? cta.getAttribute("type") : null, ctaText: cta ? (cta.textContent || "").trim() : null, expanded: cta ? cta.getAttribute("aria-expanded") : null, controls: cta ? cta.getAttribute("aria-controls") : null, panelOpen: !!panel, panelLabel: panel ? panel.getAttribute("aria-label") : null, panelControls: panel ? panel.id : null, panelTabbable: panel ? panel.getAttribute("tabindex") === "0" : false, panelOverflow: panel ? panel.scrollHeight - panel.clientHeight : null, message: msg ? msg.value : null, feedback: fb ? (fb.textContent || "").trim() : null, live: fb ? fb.getAttribute("aria-live") : null, role: fb ? fb.getAttribute("role") : null, labelFor: label ? label.getAttribute("for") : null, fieldId: field ? field.id : null, labelText: label ? (label.textContent || "").trim() : null, shareTag: (el.querySelector("[data-share-cta]") || {}).tagName || null, shareLink: (el.querySelector("[data-share-link]") || {}).value || null, readonly: el.querySelector("[data-share-link]") ? el.querySelector("[data-share-link]").getAttribute("readonly") !== null : null, channels: [...el.querySelectorAll("[data-contact-channel]")].map(a => { const mark = a.querySelector("svg"); return { href: a.getAttribute("href"), text: (a.textContent || "").trim(), target: a.getAttribute("target"), rel: a.getAttribute("rel"), prefilled: a.getAttribute("data-contact-prefilled") === "true", svgs: a.querySelectorAll("svg").length, paths: a.querySelectorAll("svg path").length, fill: mark ? mark.getAttribute("fill") : null, stroke: mark ? mark.getAttribute("stroke") : null, ink: mark ? (() => { const bb = mark.getBBox(); return [Math.round(bb.width), Math.round(bb.height)] })() : null } }) }) } return out })()'
  const mounts = async () => await ev(MOUNTS)
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
    const groups = [bx(logoEl), bx(col)].filter(Boolean);
    const rows = groups.slice().sort((a, b) => a.y - b.y);
    let wrapped = 1;
    for (let i = 1; i < rows.length; i++) if (rows[i].y >= rows[i - 1].y + rows[i - 1].h - 2) wrapped++;
    const clash = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h && a.x < b.right && b.x < a.right;
    let collide = false;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) if (clash(groups[i], groups[j])) collide = true;
    return {
      header: bx(h), logo: groups[0], contact: bx(h.querySelector('[data-site-contact]')),
      phone: bx(h.querySelector('a[data-site-phone]')), location: bx(h.querySelector('a[data-site-location]')),
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
      // Still a spread pair rather than a centred one: each stays on its own side of the line.
      if (m.phone.right > m.header.x + m.header.w / 2) f.push('phone has crossed the centre line')
      if (m.location.x < m.header.x + m.header.w / 2) f.push('location has crossed the centre line')
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
    check('the catalog label is the page heading', (await ev('(document.querySelector("main h1") || {}).textContent?.trim()')) === 'The collection')

    const search = (await ev(boxesExpr('[data-search-anchor] input')))[0]
    await clickAt(search.x, search.y)
    await cdp.send('Input.insertText', { text: 'zzzqqq' })
    check('search with no hits shows the empty state', await waitFor(`document.querySelectorAll("main article").length === 0 && document.body.innerText.includes("No products match this view.")`))
    const clearBtn = (await ev(boxesExpr('[data-search-anchor] button'))).find(b => b.x > search.x)
    await clickAt(clearBtn.x, clearBtn.y)
    check('clearing the search restores the grid', await waitFor(`document.querySelectorAll("main article").length === ${EXP.cards}`))

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
      check('spotlight opens with a live morph', await waitFor('document.querySelector(\'[role="dialog"][aria-label="Search products"] .h-14\').getAnimations().length >= 1'))
      const settled = await waitFor('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] .h-14\'); return !!p && p.getBoundingClientRect().width > 400 })()', 6000)
      const panel = await ev('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] .h-14\'); if (!p) return null; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()')
      check('spotlight panel settles as a wide field', settled && !!panel && panel.w > 400 && panel.h > 40, panel)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
      check('spotlight closes on Escape', await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')'))
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
      const opened = await waitFor('(() => { const p = document.querySelector(\'[role="dialog"][aria-label="Search products"] .h-14\'); return !!p && p.getBoundingClientRect().width > 400 })()', 6000)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
      const closed = await waitFor('!document.querySelector(\'[role="dialog"][aria-label="Search products"]\')')
      const restClean = await ev(LAUNCH)
      check('launcher→overlay morph stays intact after a collapse', opened && closed && restClean.anims === 0, { opened, closed })
    }

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

    for (const [w, h] of [[1440, 900], [1024, 900], [834, 1112], [640, 960], [390, 844]]) {
      await metrics(w, h, w < 500)
      await sleep(600)
      check(`no horizontal overflow @${w}`, (await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
      const m = await ev(MASTHEAD_EXPR)
      check(`masthead reflows without losing its hierarchy @${w}`, mastheadFaults(m, w).length === 0, mastheadFaults(m, w))
    }

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
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: mbox[0].x + (mbox[3].x - mbox[0].x) * i / 8, y: mbox[0].y }]); await sleep(45) }
    await touch('touchEnd', [])
    check('mobile drag selects its target', await waitFor(`(document.querySelector(\'nav[aria-label="Mobile product categories"] [aria-selected="true"]\').textContent || "").trim() === ${JSON.stringify(mbox[3].t)}`), { want: mbox[3].t })

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

    await nav(detailUrl(G.manyId))
    if (!await waitFor('!!document.querySelector(\'[data-product-gallery]\')')) check('product gallery mounts', false)
    else {
      check('strip renders a bounded window of thumbs', (await ev(`document.querySelectorAll('${THUMB}').length`)) === G.window, { window: G.window })
      check('first photo is selected, with both arrows', (await ev(SEL_IDX)) === 0 && await ev('!!document.querySelector(\'[data-gallery-prev]\') && !!document.querySelector(\'[data-gallery-next]\')'))
      const src0 = await ev(MAIN_SRC)
      await clickSelector('[data-gallery-next]', `(${SEL_IDX}) === 1`)
      check('next arrow advances the selection', await waitFor(`(${SEL_IDX}) === 1`))
      check('main photo swaps when the selection moves', !!src0 && (await ev(MAIN_SRC)) !== src0)
      await clickSelector('[data-gallery-next]', `(${SEL_IDX}) === 2`)
      check('arrows never navigate the page', await ev(pathnameIs(G.manyId)))
      // [0..4] window, selection 2 → clicking the adjacent thumb (3) must slide the window to
      // [1..5], not leave it at [0..4] with a moved highlight — and the slide must actually run.
      const t3 = (await ev(boxesExpr(`${THUMB}[data-index="3"]`)))[0]
      await clickAt(t3.x, t3.y)
      const midSlide = await ev('(() => { const s = document.querySelector(\'[data-gallery-strip]\'); return { anims: s ? s.getAnimations().length : 0, tr: s ? getComputedStyle(s).transform : null } })()')
      const fwdSel = await ev(SEL_IDX)
      const fwdWindow = await winJson()
      check('adjacent-thumb selection advances the strip one slot', fwdSel === 3 && fwdWindow === JSON.stringify([1, 2, 3, 4, 5]), { fwdSel, fwdWindow })
      check('the filmstrip slide actually runs when the window advances', midSlide.anims >= 1 || (!!midSlide.tr && midSlide.tr !== 'none'), { midSlide })
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
      const midSwap = await ev('(() => { const f = document.querySelector(\'[data-gallery-zoom]\'); const is = [...document.querySelectorAll(\'[data-product-gallery] [data-gallery-main]\')]; return { layers: is.length, anims: is.reduce((n, i) => n + i.getAnimations().length, 0), travel: is.some(i => getComputedStyle(i).transform !== \'none\'), widths: is.map(i => Math.round(i.getBoundingClientRect().width)), box: Math.round(f.getBoundingClientRect().width) } })()')
      check('the swap travels: a second layer mid-flight carrying an actual transform', midSwap.layers >= 2 && (midSwap.anims >= 1 || midSwap.travel) && await waitFor(`(${SEL_IDX}) === 2`), { midSwap })
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
      const lbImg = (await ev(boxesExpr(`${LB} [data-lightbox-main]`)))[0]
      await clickAt(lbImg.x, lbImg.y)
      await sleep(160)
      check('clicking the enlarged image keeps the lightbox open', await ev(`!!document.querySelector(${JSON.stringify(LB)})`))
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

      // ---- second-stage zoom: photo → lightbox → zoom, inside the same dialog ----
      // Explicit about the motion preference: headless Chrome answers the reduced-motion query
      // with `reduce` by default, and "running with motion" is a precondition of these checks,
      // not an accident of the rig.
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      await clickAt(zoomBox.x, zoomBox.y)
      await waitFor(`!!document.querySelector(${JSON.stringify(LB)} [data-lightbox-zoom])`)
      const zBtn = (await ev(boxesExpr(`${LB} [data-lightbox-zoom]`)))[0]
      // The *current* lightbox photo, never the outgoing layer of a swap still running (the same
      // MAIN_SRC rule the gallery checks follow): a leave-active ghost is first in document order,
      // absolutely positioned and perfectly zoomable — measuring it would measure yesterday's photo.
      const ZGEO = `(() => { const ls = [...document.querySelectorAll('${LB} [data-lightbox-main]')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; const b = document.querySelector('${LB} [data-lightbox-zoom]'); if (!i || !b) return null; const r = i.getBoundingClientRect(); const c = getComputedStyle(i); return { zoomed: i.getAttribute('data-zoomed'), pressed: b.getAttribute('aria-pressed'), scale: c.transform, transition: c.transitionDuration, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: r.width, left: r.left, right: r.right, h: r.height, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight } })()`
      const ZFOCUS = `(() => { const ls = [...document.querySelectorAll('${LB} [data-lightbox-main]')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; if (i) i.focus(); return true })()`
      check('the lightbox carries one zoom control that starts unpressed', !!zBtn && (await ev(`document.querySelectorAll(${JSON.stringify(LB + ' [data-lightbox-zoom]')}).length`)) === 1 && (await ev(`document.querySelector(${JSON.stringify(LB + ' [data-lightbox-zoom]')}).getAttribute('aria-pressed')`)) === 'false')
      const fit0 = await ev(ZGEO)
      await clickAt(zBtn.x, zBtn.y)
      await sleep(350) // the 220ms zoom transition must settle before the matrix is read
      const zin = await ev(ZGEO)
      check('the zoom control magnifies the one enlarged photo in place', zin && zin.zoomed === 'true' && zin.pressed === 'true' && zin.scale.startsWith('matrix') && Math.abs(Number(zin.scale.slice(7).split(',')[0]) - G.zoomScale) < 0.01, { zin })
      check('the zoomed photo cannot make the page scroll sideways', zin.overflow <= 1, { overflow: zin.overflow })
      // Pan: press, drag, and the translate part of the matrix follows the pointer while the
      // scale part stays pinned at the one magnification. The drag starts at the centre of the
      // *contained* box (the zoomed rect hangs outside the viewport and its corners are buttons)
      // and travels down-right: from the centre, every intermediate of a ±(s−1)/2·w pan stays
      // inside the viewport, so no step of the gesture can land on a floating control.
      const panFrom = { x: fit0.left + fit0.w / 2, y: fit0.top + fit0.h / 2 }
      await mouse('mouseMoved', panFrom.x, panFrom.y)
      await mouse('mousePressed', panFrom.x, panFrom.y, 1)
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', panFrom.x + 46 * i, panFrom.y + 22 * i, 1); await sleep(30) }
      const midPan = await ev(ZGEO)
      await mouse('mouseReleased', panFrom.x + 276, panFrom.y + 132)
      await sleep(60)
      const dragSettled = await ev(ZGEO)
      const tp = /matrix\(([^)]+)\)/.exec(midPan.scale)
      const pm = tp ? tp[1].split(',').map(Number) : []
      check('while zoomed the photo pans with the pointer and keeps its magnification', pm.length >= 6 && Math.abs(pm[0] - G.zoomScale) < 0.01 && pm[4] > 30 && pm[5] > 10, { matrix: pm })
      check('after the drag the photo stays where it was left (no snap-back)', dragSettled.zoomed === 'true' && (/matrix\(([^)]+)\)/.exec(dragSettled.scale) || [])[1] === (tp || [])[1], { released: dragSettled && dragSettled.scale })
      // Zoom is a view, not a second modal: navigation and Escape must survive it. The arrow
      // goes through the dialog's own keydown (the current photo is focusable and focused after
      // a tap), so this checks the selection rule, not where a pointer release happens to land.
      const selBeforeStep = await ev(SEL_IDX)
      await ev(ZFOCUS)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowRight', key: 'ArrowRight' })
      await waitFor(`(${SEL_IDX}) === ${(selBeforeStep + 1) % G.manyImages}`, 2500)
      await sleep(300) // let the swap's leave layer unmount before asking the current photo
      const afterStep = await ev(ZGEO)
      check('next while zoomed advances the shared selection and resets the zoom', afterStep && !afterStep.zoomed && afterStep.scale === 'none' && (await ev(SEL_IDX)) === (selBeforeStep + 1) % G.manyImages, { afterStep, selBeforeStep })
      await clickSelector(`${LB} [data-lightbox-zoom]`, `[data-zoomed]`)
      await sleep(350)
      check('the same control zooms back in on demand', (await ev(ZGEO)).zoomed === 'true')
      await clickSelector(`${LB} [data-lightbox-zoom]`, 'true')
      await sleep(350)
      check('pressing it again returns the photo to the contained view', (await ev(ZGEO)).scale === 'none' && (await ev(ZGEO)).zoomed === null)
      // Reduced motion keeps the magnification and the drag — the visitor's own hand moving the
      // photo is direct manipulation — and drops only the animated entry.
      await clickSelector(`${LB} [data-lightbox-zoom]`, '[data-zoomed]')
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await sleep(120)
      const rmFrom = { x: fit0.left + fit0.w / 2, y: fit0.top + fit0.h / 2 }
      await mouse('mouseMoved', rmFrom.x, rmFrom.y)
      await mouse('mousePressed', rmFrom.x, rmFrom.y, 1)
      for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', rmFrom.x - 50 * i, rmFrom.y, 1); await sleep(30) }
      const rmPan = await ev(ZGEO)
      await mouse('mouseReleased', rmFrom.x - 200, rmFrom.y)
      const rmMatrix = /matrix\(([^)]+)\)/.exec(rmPan ? rmPan.scale : '') 
      check('under reduced motion the zoom arrives without a transition and still pans', !!rmPan && rmPan.zoomed === 'true' && rmPan.transition === '0s' && !!rmMatrix && Number(rmMatrix[1].split(',')[4]) < -50, rmPan && { scale: rmPan.scale, transition: rmPan.transition })
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
    const mZoom = (await ev(boxesExpr('[data-gallery-zoom]')))[0]
    await clickAt(mZoom.x, mZoom.y)
    const mOpen = await waitFor(`!!document.querySelector(${JSON.stringify(LB)})`)
    const mFit = await ev('(() => { const d = document.querySelector(\'[data-lightbox-main]\'); if (!d) return null; const r = d.getBoundingClientRect(); return { fits: r.left >= -1 && r.right <= innerWidth + 1 && r.width >= innerWidth * 0.7, w: Math.round(r.width) } })()')
    check('lightbox on touch: opens from the photo and fills the viewport without overflow', mOpen && !!mFit && mFit.fits, { mFit })
    check('no horizontal overflow with the lightbox open @390', (await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    // Touch zoom + pan: a tap on the zoom control magnifies in place, and a finger drag
    // translates the magnified photo inside its own bounds — the page never scrolls sideways
    // because of it, which is the same overflow number re-read, now mid-zoom. (A tap on the
    // photo itself is the "keep the lightbox up, pull focus in" gesture, never a zoom.)
    const mzBtn = (await ev(boxesExpr('[data-lightbox-zoom]')))[0]
    await touch('touchStart', [{ x: mzBtn.x, y: mzBtn.y }])
    await touch('touchEnd', [])
    await sleep(400)
    const mZoomed = await ev('(() => { const ls = [...document.querySelectorAll(\'[data-lightbox] [data-lightbox-main]\')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; return i && i.getAttribute("data-zoomed") === "true" })()')
    check('a tap on the zoom control magnifies the lightbox photo on touch', mZoomed && !!mzBtn && mzBtn.w >= 36, { mZoomed, mzBtn })
    await touch('touchStart', [{ x: 195, y: 420 }])
    for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: 195 - 30 * i, y: 420 }]); await sleep(30) }
    const mPan = await ev('(() => { const ls = [...document.querySelectorAll(\'[data-lightbox] [data-lightbox-main]\')]; const i = ls.find(x => !/leave-(from|active|to)/.test(x.className)) || ls[ls.length - 1]; const t = getComputedStyle(i).transform; const m = /matrix\\(([^)]+)\\)/.exec(t); return { tx: m ? +m[1].split(",")[4] : 0, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    await touch('touchEnd', [])
    check('a finger drag pans the zoomed photo without moving the page', mPan.tx < -40 && mPan.overflow <= 1, { mPan })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape' })
    check('Escape closes the lightbox on mobile too', await waitFor(`!document.querySelector(${JSON.stringify(LB)})`))
    await metrics(1440, 900, false)

    // ---- product-detail header search: one lazy catalog fetch per visit, filtered locally ----
    const SB = '[data-catalog-search]'
    const SB_INPUT = `${SB} input`
    const productsReads = async () => (await allW()).filter(w => w.method === 'GET' && w.p === '/rest/v1/products').length

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

    // ---- sharing ------------------------------------------------------------------------------
    await clearFeedback()
    await armShare('ok')
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', 'true')
    await sleep(900) // the sheet mock settles on a 400ms timer; the outcome must be in by now
    const shared = await shares()
    const shareRow = row(G.manyId).product_translations[0]
    check('share goes through the Web Share API with the product name, its summary and the canonical URL', shared.length === 1 && shared[0].title === shareRow.name && shared[0].text === shareRow.short_description && shared[0].url === canonical(G.manyId), { shared })
    // Web Share only works when the call is made while the browser still holds the gesture. This is
    // the check that keeps a future `await` in front of it from silently killing mobile sharing.
    check('the sheet is opened from the click itself, while user activation is still live', shared.length === 1 && shared[0].activation === true, { activation: shared[0] && shared[0].activation })
    // A sheet a human could have used speaks for itself on their screen; a sentence after it
    // claims their private act, so the page stays silent — and copies nothing behind them.
    check('a share whose sheet had time to be real claims nothing and copies nothing', (await copies()).length === 0 && (await inlineMount()).feedback === '', { copies: await copies(), feedback: (await inlineMount()).feedback })

    await clearFeedback()
    await armShare('abort')
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', 'true')
    await sleep(1200) // the rejection is 400ms in; the silence must survive it, not merely lead it
    check('a dismissed share sheet is treated as a decision, not a failure', (await inlineMount()).feedback === '' && (await copies()).length === 0, { feedback: (await inlineMount()).feedback })

    // The phantom sheet, as reported from a real desktop browser: `share()` RESOLVES inside the
    // human window without ever painting. A success claim there is a lie ("Shared through the
    // sheet" with nothing shared), and silence is the dead button again — the clipboard is the
    // only thing that actually happened to the visitor.
    await clearFeedback()
    await armShare('resolve-fast')
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', expectFeedback(JSON.stringify(C.feedback.link)))
    const phantomCopied = await copies()
    check('a share that resolves instantly copies the link instead of claiming a phantom sheet', phantomCopied.length === 1 && phantomCopied[0] === canonical(G.manyId) && (await inlineMount()).feedback === C.feedback.link, { copied: phantomCopied })

    await clearFeedback()
    await armShare('resolve-fast')
    await armClipboard('missing')
    await clickSelector('[data-share-cta]', expectFeedback(JSON.stringify(C.feedback.shareFailed)))
    const phantomNoClip = await inlineMount()
    check('a phantom resolve with no clipboard reveals the manual link, not a success claim', phantomNoClip.shareLink === canonical(G.manyId) && phantomNoClip.feedback === C.feedback.shareFailed, { feedback: phantomNoClip.feedback })
    await armClipboard('ok')

    // The Phase 1.2 defect, as a check: a platform whose `share()` aborts instantly (desktop Chrome
    // on macOS answers exactly this way) must not read as "the visitor decided" — no sheet ever
    // painted, so the fallback is the only thing the visitor can be given.
    await clearFeedback()
    await armShare('abort-fast')
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', expectFeedback(JSON.stringify(C.feedback.link)))
    const fastAborted = await copies()
    check('an instantly-aborted share falls through to the clipboard instead of staying silent', fastAborted.length === 1 && fastAborted[0] === canonical(G.manyId) && (await inlineMount()).feedback === C.feedback.link, { copied: fastAborted })

    await clearFeedback()
    await armShare('abort-fast')
    await armClipboard('missing')
    await clickSelector('[data-share-cta]', expectFeedback(JSON.stringify(C.feedback.shareFailed)))
    const bothDead = await inlineMount()
    check('when the sheet aborts and there is no clipboard, the manual link is shown', bothDead.shareLink === canonical(G.manyId) && bothDead.feedback === C.feedback.shareFailed, { feedback: bothDead.feedback, shareLink: bothDead.shareLink })
    await armClipboard('ok')

    await clearFeedback()
    await armShare('absent')
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', expectFeedback(JSON.stringify(C.feedback.link)))
    const fallbackCopies = await copies()
    check('with no share sheet, share falls back to copying the canonical URL and says so', fallbackCopies.length === 1 && fallbackCopies[0] === canonical(G.manyId) && (await inlineMount()).feedback === C.feedback.link, { copied: fallbackCopies })

    // ---- metadata -----------------------------------------------------------------------------
    const head = await ev(HEAD)
    const headRow = row(G.manyId).product_translations[0]
    check('the page publishes a title, description and canonical for the current product', head.title === headRow.name + C.titleSuffix && head.desc === headRow.short_description && head.canonical === canonical(G.manyId), { title: head.title, desc: head.desc, canonical: head.canonical })
    const gallerySrc = await ev('(() => { const i = document.querySelector("[data-gallery-main]"); return i ? i.src : null })()')
    check('Open Graph carries the product, and its image is the same catalog-mapped photo the gallery shows', head.ogType === 'product' && head.ogSite === C.appName && head.ogTitle === headRow.name && head.ogDesc === headRow.short_description && head.ogUrl === canonical(G.manyId) && head.ogImage === gallerySrc && head.ogImageAlt === row(G.manyId).product_images[0].alt_text, { ogType: head.ogType, ogImage: head.ogImage, gallerySrc, ogImageAlt: head.ogImageAlt })
    check('the canonical in the head is the URL the message and the share both carried', head.canonical === wantIn.split('\n').pop() && head.canonical === fallbackCopies[0], { canonical: head.canonical })

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
    check('a shop with no configured contact offers no contact action and no sticky bar', !(await ev('!!document.querySelector("[data-contact-cta]")')) && !(await ev('!!document.querySelector("[data-sticky-cta]")')) && !!bare.find(m => m.where === 'inline'), { mounts: bare.map(m => m.where + ':' + m.visible) })
    check('nothing is invented in the missing channel’s place', !(await ev('document.body.innerHTML.includes("tel:")')) && !(await ev('document.body.innerText.includes("example.com")')) && (await ev('document.querySelector("main h1") ? (document.querySelector("main h1").textContent || "").trim() : ""')) === row(G.manyId).product_translations[0].name)
    await armShare('absent')
    await armClipboard('ok')
    await clickSelector('[data-share-cta]', expectFeedback(JSON.stringify(C.feedback.link)))
    check('sharing still works when there is no contact channel to configure', (await copies()).length === 1 && (await copies())[0] === canonical(G.manyId), { copied: await copies() })
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

    // ---- the mobile sticky bar -----------------------------------------------------------------
    await metrics(390, 844, true)
    await nav(detailUrl(G.manyId))
    await waitFor('!!document.querySelector(\'[data-sticky-cta] [data-contact-cta]\')')
    // One visible Contact CTA per breakpoint: the inline block is `hidden lg:block` on purpose,
    // so a second painted CTA at phone width means that contract broke and the visitor is being
    // asked to choose between two identical actions. `getClientRects()` reads painted layout,
    // which is what a `display: none` mount honestly does not have.
    const ctaCount = await ev('(() => { let n = 0; for (const el of document.querySelectorAll("[data-contact-cta]")) if (el.getClientRects().length) n++; return n })()')
    check('exactly one Contact to Order CTA is visible at mobile width', ctaCount === 1, { ctaCount })
    const geo = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); if (!bar) return null; const r = bar.getBoundingClientRect(); const c = getComputedStyle(bar); const inner = bar.querySelector("[data-product-actions]").getBoundingClientRect(); const ctl = bar.querySelector("[data-contact-cta]").getBoundingClientRect(); return { display: c.display, position: c.position, z: c.zIndex, pb: c.paddingBottom, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, vh: innerHeight, vw: innerWidth, insetLeft: Math.round(inner.left - r.left), insetRight: Math.round(r.right - inner.right), ctlH: Math.round(ctl.height), ctlW: Math.round(ctl.width), hasShare: !!bar.querySelector("[data-share-cta]"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()')
    check('the sticky bar is a fixed bottom row that stays inside the viewport', geo.position === 'fixed' && geo.display !== 'none' && Math.abs(geo.bottom - geo.vh) <= 1 && geo.left === 0 && geo.right === geo.vw, geo)
    check('the sticky bar does not widen the page, keeps the 44px control and its symmetric inset', geo.overflow <= 1 && geo.ctlH === C.sticky.controlHeight && geo.insetLeft === geo.insetRight && geo.ctlW + geo.insetLeft * 2 <= geo.vw, geo)
    check('the sticky bar reserves room for the home-indicator safe area', parseFloat(geo.pb) >= C.sticky.minPadding, { paddingBottom: geo.pb })
    check('the sticky bar carries the primary action alone', geo.hasShare === false, { carriesShare: geo.hasShare })

    await ev('window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); true')
    await sleep(450)
    // The last real content above the fold (the specifications block) is what the bar must leave
    // clear: the inline conversion block sits under it, but below `lg` that block is not painted
    // and the sticky bar *is* the conversion UI, so the page has to end in something readable.
    const clearance = await ev('(() => { const bar = document.querySelector("[data-sticky-cta]"); const dl = document.querySelector("main dl") || document.querySelector("main pre"); const b = bar.getBoundingClientRect(); const d = dl ? dl.getBoundingClientRect() : null; return { atEnd: window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2, barTop: Math.round(b.top), dlBottom: d ? Math.round(d.bottom) : null, gap: d ? Math.round(b.top - d.bottom) : null } })()')
    check('at the end of the page the sticky bar leaves the product content clear of itself', clearance.atEnd && clearance.dlBottom !== null && clearance.dlBottom <= clearance.barTop + 1, clearance)

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
    await clickSelector('[data-sticky-cta] [data-contact-cta]', '!!document.querySelector("[data-sticky-cta] [data-contact-panel]")')
    const stickyOpen = await stickyMount()
    check('the sticky panel offers the same channels and the same message as the inline block', JSON.stringify(stickyOpen.channels.map(c => c.href)) === JSON.stringify(inlineNow.channels.map(c => c.href)) && stickyOpen.message === inlineNow.message && stickyOpen.ctaText === inlineNow.ctaText, { channels: stickyOpen.channels.map(c => c.href), cta: stickyOpen.ctaText })
    // Two things the desktop-only geometry checks could not see, both found by looking at the page:
    // the floating panel must be opaque (a translucent wash over the product photo is unreadable,
    // and two background utilities in one class list resolve by stylesheet order, not by intent),
    // and the prepared message must fit its own field (the URL wraps at a phone width).
    const surface = await ev('(() => { const p = document.querySelector("[data-sticky-cta] [data-contact-panel]"); if (!p) return null; const c = getComputedStyle(p); const f = p.querySelector("[data-contact-message]"); const r = p.getBoundingClientRect(); return { bg: c.backgroundColor, fieldClip: f ? f.scrollHeight - f.clientHeight : null, fieldH: f ? Math.round(f.getBoundingClientRect().height) : 0, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight } })()')
    check('the floating mobile panel is opaque rather than a translucent wash', !!surface && !/\/\s*0\./.test(surface.bg), surface)
    check('the mobile panel shows the whole prepared message and stays entirely on screen', !!surface && surface.fieldClip <= 1 && surface.top >= 0 && surface.bottom <= surface.vh + 1, surface)
    const beforeStickyCopy = (await copies()).length
    const expectStickyFeedback = value => '((document.querySelector("[data-sticky-cta] [data-contact-feedback]") || {}).textContent || "").trim() === ' + value
    await clickSelector('[data-sticky-cta] [data-copy-message]', expectStickyFeedback(JSON.stringify(C.feedback.copied)))
    const afterStickyCopy = await copies()
    check('the sticky copy runs the shared action and writes the same message', afterStickyCopy.length === beforeStickyCopy + 1 && afterStickyCopy[afterStickyCopy.length - 1] === inlineNow.message, { added: afterStickyCopy.length - beforeStickyCopy, copied: norm(afterStickyCopy[afterStickyCopy.length - 1] || '') })
    const speakers = await mounts()
    const stickySpeaker = speakers.find(m => m.where === 'sticky') || { ...NO_MOUNT }
    const inlineSpeaker = speakers.find(m => m.where === 'inline') || { ...NO_MOUNT }
    check('only the mount the visitor used announces the copy', stickySpeaker.feedback === C.feedback.copied && inlineSpeaker.feedback === '', speakers.map(m => [m.where, m.feedback]))

    await press('Escape', 'Escape', 27)
    check('Escape closes the sticky panel and leaves focus on the control', !(await ev('!!document.querySelector("[data-sticky-cta] [data-contact-panel]")')) && await ev('(() => { const el = document.activeElement; return !!el && el.getAttribute("data-contact-cta") !== null })()'))
    // Escape has to hand focus back to the control that opened the panel rather than dropping the
    // visitor at the top of the tab order. The inline block is no longer painted at this width,
    // so the bar's own panel is the one that answers — and a hidden field cannot take focus to be
    // accidentally closed from anyway.
    await ev('(() => { const el = document.querySelector("[data-sticky-cta] [data-contact-message]"); if (el) el.focus(); return true })()')
    await press('Escape', 'Escape', 27)
    check('Escape closes the mobile panel and hands focus back to the control that opened it', await ev('(() => { const el = document.activeElement; return !!el && el.getAttribute("data-contact-cta") !== null && !document.querySelector("[data-sticky-cta] [data-contact-panel]") })()'), { active: await ev('(() => { const el = document.activeElement; return el ? el.tagName : null })()') })
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
        const r = await ev('(() => { const dark = document.documentElement.classList.contains("dark"); const bar = document.querySelector("[data-sticky-cta]"); const cta = (bar && bar.getClientRects().length && bar.querySelector("[data-contact-cta]")) || [...document.querySelectorAll("[data-contact-cta]")].find(el => el.getClientRects().length) || null; const share = document.querySelector("[data-share-cta]"); const cr = cta ? cta.getBoundingClientRect() : null; const cc = cta ? getComputedStyle(cta) : null; const sc = share ? getComputedStyle(share) : null; const bc = bar ? getComputedStyle(bar) : null; const br = bar ? bar.getBoundingClientRect() : null; return { dark, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth, ctaShown: !!cta && cta.getClientRects().length > 0, ctaH: cr ? Math.round(cr.height) : 0, ctaW: cr ? Math.round(cr.width) : 0, ctaBg: cc ? cc.backgroundColor : null, ctaFg: cc ? cc.color : null, shareBg: sc ? sc.backgroundColor : null, barShown: !!bar && br.width > 0 && bc.display !== "none", barBg: bc ? bc.backgroundColor : null, pageBg: getComputedStyle(document.body).backgroundColor, ctaText: cta ? (cta.textContent || "").trim() : null } })()')
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
        // dark mode it is a hairline with a button floating in nowhere.
        if (r.barShown && r.barBg === r.pageBg) faults.push('the sticky bar is the same surface as the page it sits on')
        if ((scheme === 'dark') !== r.dark) faults.push(`a ${scheme} colour scheme did not reach the theme`)
        check(`the conversion UI fits, keeps its hierarchy and obeys its breakpoint @${w} ${scheme}`, faults.length === 0, faults.length ? faults : { ctaH: r.ctaH, ctaW: r.ctaW, barShown: r.barShown })
      }
    }
    check('the sticky bar and both controls change surface between light and dark', !!surfaces.light && !!surfaces.dark && surfaces.light.bar !== surfaces.dark.bar && surfaces.light.cta !== surfaces.dark.cta && surfaces.light.share !== surfaces.dark.share, surfaces)
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'no-preference' }] })
    await metrics(1440, 900, false)
    collectErrors()
  }

  // ============================== ADMIN ==============================
  if (ONLY !== 'guest') {
    await metrics(1440, 900, false)
    await nav(appUrl + 'admin/login')
    const email = (await ev(boxesExpr('input[type="email"]')))[0]
    const pass = (await ev(boxesExpr('input[type="password"]')))[0]
    await clickAt(email.x, email.y)
    await cdp.send('Input.insertText', { text: 'verify@example.test' })
    await clickAt(pass.x, pass.y)
    await cdp.send('Input.insertText', { text: 'verify-password' })
    await resetW()
    await clickByText('form button[type="submit"]', 'Sign in')
    check('login lands back on the catalog', await waitFor('location.pathname === "/"'))
    const loginWrites = await allW()
    check('login read admin_users and wrote no data', loginWrites.some(w => w.p === '/rest/v1/admin_users') && (await writes()).length === 0, seqOf(loginWrites))
    // stay in the SPA: a hard reload would make the un-stubbed server validate the fake JWT
    check('admin mode turns on', await waitFor(`document.querySelectorAll(${JSON.stringify(EDIT_BTN)}).length === ${EXP.cards}`, 15000))
    check('admin banner labels the mode', await ev('!![...document.querySelectorAll("header span")].find(el => /admin\\s*mode/i.test(el.textContent || ""))'))
    // The admin affordances join the utility group, so this is the widest the masthead ever gets.
    const adminMast = await ev(MASTHEAD_EXPR)
    check('masthead holds with the admin affordances in the utility group', mastheadFaults(adminMast, 1440).length === 0, mastheadFaults(adminMast, 1440))

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
    check('add write order: product → translation → upload → image rows',
      JSON.stringify(addW.map(w => w.p.startsWith('/storage') ? 'UPLOAD' : `${w.method} ${w.p}`)) === JSON.stringify(['POST /rest/v1/products', 'POST /rest/v1/product_translations', 'UPLOAD', 'DELETE /rest/v1/product_images', 'POST /rest/v1/product_images']),
      seqOf(addW))
    const prodBody = JSON.parse(addW.find(w => w.p === '/rest/v1/products')?.body || '{}')
    check('product payload keeps exactly the products columns', Object.keys(prodBody).sort().join(',') === EXP.sortedPayloadColumns && prodBody.status === 'published' && Number(prodBody.price) === 99.99 && prodBody.sku === 'VERIFY-KB-99', prodBody)
    const trBody = JSON.parse(addW.find(w => w.p === '/rest/v1/product_translations')?.body || '{}')
    check('translation row carries the name and parsed specification pairs', trBody.locale === 'en' && trBody.name === 'Verify Keyboard 99' && JSON.stringify(trBody.specifications) === JSON.stringify([{ label: 'Switch', value: 'MX Black' }, { label: 'Ratio', value: '70:30' }]), { name: trBody.name, specs: trBody.specifications })
    const uploadPath = norm(addW.find(w => w.p.startsWith('/storage/v1/object'))?.p || '')
    check('upload path is object/<bucket>/products/<newId>/<uuid>-<file>', uploadPath === '/storage/v1/object/product-images/products/<uuid>/<uuid>-upload-probe.png', uploadPath)
    const rows = JSON.parse(addW.find(w => w.method === 'POST' && w.p === '/rest/v1/product_images')?.body || '[]')
    check('image rows replace all: existing first and primary, upload second, sort_order 0,1', Array.isArray(rows) && rows.length === 2 && rows[0].storage_path === 'products/verify/keep-me.png' && String(rows[1].storage_path).endsWith('upload-probe.png') && rows[0].is_primary === true && rows[1].is_primary === false && rows.map(r => r.sort_order).join(',') === '0,1', rows)
    check('previous image rows cleared by product_id', /^product_id=eq[.]/.test(addW.find(w => w.method === 'DELETE' && w.p === '/rest/v1/product_images')?.q || ''))
    check('catalog reloaded after the write', (await allW()).some(w => w.method === 'GET' && w.p === '/rest/v1/products'))

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
    check('update order: PATCH product → PATCH translation → rows replaced, no upload',
      JSON.stringify(editW.map(w => `${w.method} ${w.p}`)) === JSON.stringify(['PATCH /rest/v1/products', 'PATCH /rest/v1/product_translations', 'DELETE /rest/v1/product_images', 'POST /rest/v1/product_images']),
      seqOf(editW))
    const patchReq = editW.find(w => w.p === '/rest/v1/products')
    check('update targets one row and keeps the same column set', /^id=eq[.]/.test(patchReq?.q || '') && Object.keys(JSON.parse(patchReq.body || '{}')).sort().join(',') === EXP.sortedPayloadColumns, { q: norm(patchReq?.q) })
    check('update rewrites the translation with the new name', JSON.parse(editW.find(w => w.p === '/rest/v1/product_translations')?.body || '{}').name === 'Renamed By Harness')

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
    check('delete issues exactly one DELETE on the product row', delW.length === 1 && delW[0].method === 'DELETE' && delW[0].p === '/rest/v1/products' && /^id=eq[.]/.test(delW[0].q), seqOf(delW))
    check('no error alert surfaced by any admin flow', !(await ev('document.body.innerText.includes("could not be")')))

    // --- site info editor: open, seed, edit, add/toggle/reorder/remove links, save, reflect ---
    const SI = FIXTURES.siteSettings
    const SITE_FORM = '[data-site-info-form]'
    check('site info editor opens from the header', await clickByText('header button', 'Site info', `location.pathname === "/admin/site-info" && !!document.querySelector('${SITE_FORM}')`))
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
    check('save issues exactly one upsert on the singleton', siteW.length === 1 && siteW[0].method === 'POST' && siteW[0].p === '/rest/v1/site_settings', seqOf(siteW))
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
  const hydration = /Hydration completed but contains mismatches/
  const real = consoleErrors.filter(e => !hydration.test(e))
  console.log(`\nCONSOLE_ERRORS ${JSON.stringify(consoleErrors.slice(0, 4))}`)
  check('no exceptions or console errors beyond the known hydration warning', real.length === 0, real.slice(0, 3))

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) console.log('failed: ' + failed.map(f => f.name).join(' | '))
  await shutdown(failed.length ? 1 : 0)
}

run().catch(err => { console.error('\nharness error: ' + (err?.stack || err)); return shutdown(2) })
