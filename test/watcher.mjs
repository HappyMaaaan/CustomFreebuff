/**
 * test/watcher.mjs — Vérifie que le watcher thème les fenêtres de l'app au fur
 * et à mesure qu'elles apparaissent (scénario « lancer Freebuff, puis le thème
 * s'applique automatiquement »), y compris une seconde fenêtre de thread.
 *
 * Usage : node test/watcher.mjs
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { listTargets, isAppPageTarget, watchAndTheme, CdpClient } from '../lib/cdp.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
].filter(Boolean)

const THEME_CSS = ':root{color-scheme: dark !important;--bg: #123456 !important}'
const staticPort = 8902
const cdpPort = 9337

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evalBg(wsUrl) {
  const client = await CdpClient.connect(wsUrl)
  try {
    const res = await client.send('Runtime.evaluate', {
      expression: `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`,
      returnByValue: true,
    })
    return res.result?.value
  } finally {
    client.close()
  }
}

async function main() {
  const edge = EDGE_CANDIDATES.find((c) => c && fs.existsSync(c))
  if (!edge) {
    console.error('Edge introuvable — test ignoré.')
    process.exit(0)
  }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(fs.readFileSync(path.join(__dirname, 'fixture.html')))
  })
  await new Promise((r) => server.listen(staticPort, '127.0.0.1', r))

  // Le watcher démarre AVANT l'app (comme après « Lancer Freebuff »).
  const watcher = watchAndTheme({ debugPort: cdpPort, css: THEME_CSS, colorScheme: 'dark', log: () => {} })

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-themer-watch-'))
  const child = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${staticPort}/fixture.html`,
    ],
    { stdio: 'ignore' },
  )

  try {
    // 1. La première fenêtre doit être thématisée automatiquement.
    const first = await (async () => {
      for (let i = 0; i < 80; i++) {
        try {
          const list = await listTargets(cdpPort)
          const t = list.find((x) => isAppPageTarget(x, null) && /fixture/.test(x.url))
          if (t) {
            const bg = await evalBg(t.webSocketDebuggerUrl).catch(() => null)
            if (bg === '#123456') return bg
          }
        } catch {}
        await sleep(250)
      }
      return null
    })()
    check('la 1re fenêtre est thématisée dès son apparition', first === '#123456', String(first))

    // 2. Une seconde fenêtre (ex. fenêtre de thread) doit l'être aussi.
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${staticPort}/fixture.html`)}`, {
      method: 'PUT',
    })
    const second = await (async () => {
      for (let i = 0; i < 80; i++) {
        try {
          const list = await listTargets(cdpPort)
          const pages = list.filter((x) => isAppPageTarget(x, null) && /fixture/.test(x.url))
          if (pages.length >= 2) {
            const bg = await evalBg(pages[1].webSocketDebuggerUrl).catch(() => null)
            if (bg === '#123456') return bg
          }
        } catch {}
        await sleep(250)
      }
      return null
    })()
    check('la 2e fenêtre est thématisée aussi', second === '#123456', String(second))
  } finally {
    watcher.stop()
    child.kill()
    server.close()
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break } catch { await sleep(300) }
    }
  }

  console.log('')
  if (failures) {
    console.error(`${failures} vérification(s) en échec.`)
    process.exit(1)
  }
  console.log('Toutes les vérifications sont passées. ✔')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
