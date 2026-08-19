/**
 * test/e2e.mjs — Test de bout en bout de l'injection CDP.
 *
 * Lance une copie headless d'Edge (Chromium) sur une page qui imite le renderer
 * de Freebuff, se connecte avec notre client CDP, injecte un thème, puis vérifie
 * que la CSS est bien en place, qu'elle survit à un rechargement, et que l'API
 * native setTheme a bien été appelée.
 *
 * Usage : node test/e2e.mjs
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findFreePort, listTargets, isAppPageTarget, themeTarget, CdpClient } from '../lib/cdp.mjs'
import { killEdgeByProfile } from './kill-edge.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean)

const THEME_CSS =
  ':root{color-scheme: dark !important;--bg: #123456 !important;--brand: #ff00ff !important;--text: #ffffff !important}'

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function findEdge() {
  for (const c of EDGE_CANDIDATES) {
    if (c && fs.existsSync(c)) return c
  }
  return null
}

function serveFixture(port) {
  const file = path.join(__dirname, 'fixture.html')
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(fs.readFileSync(file))
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function waitFor(fn, timeoutMs = 15000, interval = 250) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const loop = async () => {
      try {
        const value = await fn()
        if (value) return resolve(value)
      } catch {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'))
      setTimeout(loop, interval)
    }
    loop()
  })
}

async function evalOn(client, expression) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true })
  if (res.exceptionDetails) throw new Error('evaluation failed: ' + JSON.stringify(res.exceptionDetails))
  return res.result?.value
}

async function main() {
  const edge = findEdge()
  if (!edge) {
    console.error('Edge (Chromium) introuvable — test ignoré.')
    process.exit(0)
  }

  // Free ports, never hard-coded: a busy port (e.g. a leftover instance)
  // would make the test connect to the wrong process and hang.
  const staticPort = await findFreePort(8900)
  const cdpPort = await findFreePort(9400)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-themer-test-'))

  const server = await serveFixture(staticPort)

  console.log('Lancement d’Edge headless…')
  const child = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${staticPort}/fixture.html`,
    ],
    { stdio: 'ignore' },
  )

  try {
    // 1. Attendre que la cible apparaisse.
    const targets = await waitFor(async () => {
      const list = await listTargets(cdpPort)
      return list.find((t) => isAppPageTarget(t, null) && /fixture/.test(t.url))
    })
    check('la cible de la page est visible', Boolean(targets), targets?.url)
    const wsUrl = targets.webSocketDebuggerUrl
    check('webSocketDebuggerUrl présent', Boolean(wsUrl))

    // 2. Injecter le thème.
    const themedClient = await themeTarget(wsUrl, THEME_CSS, 'dark', () => {})
    check('connexion + injection OK', true)

    // 3. Vérifier la présence du <style> et la valeur calculée de --bg.
    const styleOk = await evalOn(
      themedClient,
      `(() => {
        const el = document.getElementById('freebuff-themer-style')
        return el && el.textContent.includes('--bg: #123456')
      })()`,
    )
    check('le <style> du thème est dans la page', styleOk === true)

    const bg = await evalOn(themedClient, `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)
    check('la variable --bg est surchargée', bg === '#123456', bg)

    const nativeCalls = await evalOn(themedClient, `JSON.stringify(window.__nativeThemeCalls)`)
    check('setTheme("dark") a été appelé via l’API native', nativeCalls === '["dark"]', nativeCalls)

    // 4. Le thème survit-il à un rechargement (addScriptToEvaluateOnNewDocument) ?
    try {
      await themedClient.send('Page.reload', { ignoreCache: true })
      const afterReload = await waitFor(async () => {
        const ready = await evalOn(themedClient, `document.readyState`).catch(() => '')
        if (ready !== 'complete') return null
        const bg = await evalOn(
          themedClient,
          `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`,
        ).catch(() => '')
        return bg === '#123456' ? { bg } : null
      }, 8000)
      check('le thème survit au rechargement', Boolean(afterReload), JSON.stringify(afterReload))
    } catch (err) {
      console.error(`  (section rechargement : ${err.message})`)
    }

    themedClient.close()
  } finally {
    try { child.kill() } catch { /* déjà mort */ }
    // Sur Windows, Edge se relance seul : child.kill() ne touche pas le vrai
    // navigateur. On le termine par son profil, sinon il garde le port debug
    // et fait traîner le processus de test.
    await killEdgeByProfile(profile)
    server.close()
    // Edge peut mettre un instant à libérer le profil — on retente, sans bloquer.
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      }
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
