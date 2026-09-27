#!/usr/bin/env node
/**
 * scripts/verify-ui.mjs — the repository's UI regression harness.
 *
 * WHY THIS EXISTS
 * `bun run build` is the only gate CI runs, and it never starts the app, so every tuned
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
  const byLabel = (label, value) => '(() => { const dlg = document.querySelector(\'[role="dialog"]\'); if (!dlg) return "NODIALOG"; const lbl = [...dlg.querySelectorAll("label")].find(l => (l.textContent || "").trim().replace(/[*\\s]+$/, "").trim() === ' + JSON.stringify(label) + '); if (!lbl) return "NOLABEL"; const el = dlg.querySelector("#" + (window.CSS ? CSS.escape(lbl.htmlFor) : lbl.htmlFor)) || (lbl.parentElement && lbl.parentElement.querySelector("input, textarea")); if (!el) return "NOFIELD"; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return el.value })()'
  const allW = async () => (await ev('window.__W || []'))
  const writes = async () => (await allW()).filter(w => w.method !== 'GET' && !w.p.startsWith('/auth/'))
  const resetW = () => ev('window.__W = []; true')
  const norm = s => (typeof s === 'string' ? s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>') : s)
  const seqOf = list => list.map(w => `${w.method} ${w.p}${w.q ? '?' + w.q : ''}`)
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
    await clickSelector(SWITCH_2, SWITCH_ON)
    check('a social link can be enabled from its row', await ev(SWITCH_ON))
    check('a link can be reordered up', await clickSelector('[data-social-up="3"]', 'JSON.stringify([...document.querySelectorAll("[data-social-platform]")].map(i => i.value)) === "[\\"facebook\\",\\"telegram\\",\\"youtube\\",\\"tiktok\\"]"'))
    check('a link can be removed', await clickSelector('[data-social-remove="0"]', 'document.querySelectorAll("[data-social-row]").length === 3 && document.querySelectorAll("[data-social-platform]")[0].value === "telegram"'))
    await resetW()
    await clickByText('form button[type="submit"]', 'Save changes', 'document.body.textContent.includes("Site info saved")')
    const siteW = await writes()
    check('save issues exactly one upsert on the singleton', siteW.length === 1 && siteW[0].method === 'POST' && siteW[0].p === '/rest/v1/site_settings', seqOf(siteW))
    const siteBody = JSON.parse(siteW[0]?.body || '{}')
    check('saved phone, location label and link reflect the edits', siteBody.phone === '+855 99 888 777' && siteBody.location_url === 'https://maps.example/hq' && JSON.stringify(siteBody.location_translations) === JSON.stringify([{ locale: 'en', label: 'RGB Bin HQ' }, { locale: 'km', label: 'ភ្នំពេញ កម្ពុជា' }]), { phone: siteBody.phone, url: siteBody.location_url, labels: siteBody.location_translations })
    check('saved links reflect add, edit, disable, enable, reorder and remove', JSON.stringify(siteBody.social_links) === JSON.stringify([
      { platform: 'telegram', url: 'https://t.me/raccoongearbin', enabled: false, sort_order: 0 },
      { platform: 'youtube', url: 'https://youtube.com/@raccoongearbin', enabled: true, sort_order: 1 },
      { platform: 'tiktok', url: 'https://tiktok.com/@raccoongearbin.hidden', enabled: true, sort_order: 2 }
    ]), siteBody.social_links)
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

    // --- logout ---
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
