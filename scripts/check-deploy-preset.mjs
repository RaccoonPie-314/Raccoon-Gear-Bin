#!/usr/bin/env node
/**
 * Refuses to hand wrangler a `.output` that is not a Workers build (plans/010 C4).
 *
 * The local loop — `bun run build`, `bun run verify` — deliberately leaves a **node-server**
 * bundle on disk (it is what the CDP harness boots with `node`). `bun run deploy` rebuilds with
 * `NITRO_PRESET=cloudflare_module` and runs this check before `wrangler deploy`, so a raw
 * `wrangler deploy` on a stale artifact fails loudly here instead of uploading a bundle whose
 * entry imports `node:http` (and whose CF-only `_headers` are missing).
 */
import { readFileSync } from 'node:fs'

const { preset } = JSON.parse(readFileSync(new URL('../.output/nitro.json', import.meta.url), 'utf8'))
// Nitro records the preset with a hyphen (`cloudflare-module`) even though NITRO_PRESET spells it
// with an underscore (`cloudflare_module`) — normalize, or this refuses the valid build too.
if (String(preset).replace(/-/g, '_') !== 'cloudflare_module') {
  console.error(`[deploy] refusing: .output preset is "${preset}", not a Workers build — run \`bun run deploy\`, never \`wrangler deploy\` on a local build.`)
  process.exit(1)
}
console.log('[deploy] .output is a cloudflare_module build')
