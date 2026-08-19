/**
 * test/theme-ui.mjs — Vertical Slices 0 + 1 : le Theme Engine dans Freebuff.
 *
 * VS0 : parcours complet « Freebuff → Thèmes → activation → changement
 * visuel immédiat » — panneau injecté, communication avec le studio (API
 * locale, CORS loopback), réinjection après reload, restauration.
 *
 * VS1 : le modèle de thème à tokens. Dans l'éditeur intégré à Freebuff :
 *   1. modifier le token accent → plusieurs variables CSS cohérentes changent
 *      (--brand, --brand-dim, --ok) ET plusieurs éléments de l'UI (#demo-btn,
 *      #demo-link) changent — le Definition of Done de la slice,
 *   2. l'aperçu est en direct avant d'enregistrer,
 *   3. Enregistrer crée un thème utilisateur dérivé (les thèmes intégrés ne
 *      sont jamais écrasés) et l'active,
 *   4. Reset ramène les tokens du thème de base.
 *
 * Le studio réel n'est pas démarré : un faux backend reproduit ses endpoints
 * et fait lui-même l'injection CDP, exactement comme themer.mjs en production
 * (il utilise le VRAI générateur de CSS, lib/theme-model.mjs).
 *
 * Usage : node test/theme-ui.mjs
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findFreePort, listTargets, isAppPageTarget, themeTarget } from '../lib/cdp.mjs'
import { DEFAULT_TOKENS, darken, normalizeTheme, themeToCss } from '../lib/theme-model.mjs'
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

// Built-in themes (token model), like themes/*.json.
const BUILTINS = [
  {
    id: 'default',
    name: 'Default',
    description: 'Freebuff original look.',
    colorScheme: 'dark',
    base: 'default',
    tokens: { ...DEFAULT_TOKENS },
    extraCss: '',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'The famous dark purple theme.',
    colorScheme: 'dark',
    base: 'default',
    tokens: { ...DEFAULT_TOKENS, background: '#282a36', surface: '#2d2f3a', text: '#f8f8f2', textMuted: '#bfc2d1', border: '#44475a', accent: '#50fa7b' },
    extraCss: '',
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Soft arctic palette.',
    colorScheme: 'dark',
    base: 'default',
    tokens: { ...DEFAULT_TOKENS, background: '#2e3440', surface: '#353b47', text: '#eceff4', textMuted: '#d8dee9', border: '#4c566a', accent: '#88c0d0' },
    extraCss: '',
  },
]

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

const SHADOW = `document.getElementById('freebuff-theme-engine-host').shadowRoot`

/**
 * Faux studio : reproduit les endpoints de themer.mjs (avec le CORS loopback)
 * et fait l'injection CDP lui-même, comme le fait le vrai studio. Il utilise
 * le VRAI générateur (themeToCss) — la seule partie simulée est le stockage
 * (en mémoire au lieu du disque).
 */
async function serveMock(port, targetProvider) {
  const state = {
    mode: 'theme',
    themeId: null,
    connected: 1,
    userThemes: new Map(), // id -> theme
  }

  const themeById = (id) => {
    if (state.userThemes.has(id)) return { ...state.userThemes.get(id), builtin: false }
    const b = BUILTINS.find((t) => t.id === id)
    return b ? { ...b, builtin: true } : null
  }
  const allThemes = () => [
    ...BUILTINS.map((t) => ({ ...t, builtin: true })),
    ...[...state.userThemes.values()].map((t) => ({ ...t, builtin: false })),
  ]
  const uniqueThemeId = (name) => {
    const base = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'theme'
    let id = base
    let n = 2
    while (themeById(id)) id = `${base}-${n++}`
    return id
  }
  const injectCss = async (css, scheme) => {
    if (targetProvider) await targetProvider((wsUrl) => themeTarget(wsUrl, css, scheme, () => {}))
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    if (origin) {
      let host = ''
      try {
        host = new URL(origin).hostname.toLowerCase()
      } catch {
        host = ''
      }
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'content-type')
      res.writeHead(204)
      return res.end()
    }
    const url = new URL(req.url, 'http://127.0.0.1')
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      let payload = {}
      try {
        payload = body ? JSON.parse(body) : {}
      } catch {
        /* ignore */
      }
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      if (url.pathname === '/api/state') {
        send(200, {
          freebuffFound: true,
          running: true,
          debugAlive: true,
          connected: state.connected,
          uiPort: port,
          mode: state.mode,
          themeId: state.themeId,
          themes: allThemes(),
        })
      } else if (url.pathname === '/api/themes') {
        send(200, { themes: allThemes() })
      } else if (url.pathname === '/api/preview' && req.method === 'POST') {
        // Live preview : applique sans persister.
        const theme = normalizeTheme(payload.theme || {})
        await injectCss(themeToCss(theme), theme.colorScheme)
        send(200, { ok: true })
      } else if (url.pathname === '/api/apply' && req.method === 'POST') {
        const theme = themeById(payload.themeId)
        if (!theme) return send(400, { error: 'unknown-theme', message: `Unknown theme: ${payload.themeId}` })
        state.mode = 'theme'
        state.themeId = theme.id
        await injectCss(themeToCss(theme), theme.colorScheme)
        send(200, { ok: true, themeId: theme.id })
      } else if (url.pathname === '/api/themes/save' && req.method === 'POST') {
        const raw = payload.theme || {}
        const source = themeById(raw.id)
        let theme
        let isNew = false
        if (source && !source.builtin) {
          theme = normalizeTheme(raw, source)
        } else {
          isNew = true
          let name
          if (source) name = `${source.name} (custom)`
          else name = 'Custom theme'
          theme = normalizeTheme({
            ...raw,
            id: uniqueThemeId(name),
            name,
            base: source?.id ?? 'default',
            colorScheme: raw.colorScheme || source?.colorScheme || 'dark',
          })
        }
        state.userThemes.set(theme.id, theme)
        if (payload.activate) {
          state.mode = 'theme'
          state.themeId = theme.id
          await injectCss(themeToCss(theme), theme.colorScheme)
        }
        send(200, { ok: true, theme: { ...theme, builtin: false }, isNew })
      } else if (url.pathname === '/api/themes/reset' && req.method === 'POST') {
        const theme = themeById(payload.themeId)
        if (!theme) return send(404, { error: 'unknown-theme', message: 'Unknown theme.' })
        let tokens = theme.tokens
        let components = theme.components ?? {}
        if (!theme.builtin) {
          const base = themeById(theme.base) ?? themeById('default')
          tokens = base?.tokens ?? DEFAULT_TOKENS
          components = base?.components ?? {}
        }
        const reset = normalizeTheme({ ...theme, tokens, components })
        if (!theme.builtin) state.userThemes.set(reset.id, reset)
        send(200, { ok: true, theme: { ...reset, builtin: theme.builtin } })
      } else if (url.pathname === '/api/restore' && req.method === 'POST') {
        state.mode = 'theme'
        state.themeId = null
        await injectCss('', 'dark')
        send(200, { ok: true })
      } else {
        send(404, { error: 'not-found' })
      }
    })
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, state }
}

async function main() {
  const edge = findEdge()
  if (!edge) {
    console.error('Edge (Chromium) introuvable — test ignoré.')
    process.exit(0)
  }

  const staticPort = await findFreePort(8905)
  const cdpPort = await findFreePort(9410)
  const mockPort = await findFreePort(9600)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-themer-ui-'))

  // Fixture : la « fenêtre Freebuff » (page loopback).
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(fs.readFileSync(path.join(__dirname, 'fixture.html')))
  })
  await new Promise((r) => fixture.listen(staticPort, '127.0.0.1', r))

  let target = null
  const mock = await serveMock(mockPort, async (fn) => {
    if (target) await fn(target.webSocketDebuggerUrl)
  })

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
    target = await waitFor(async () => {
      const list = await listTargets(cdpPort)
      return list.find((t) => isAppPageTarget(t, null) && /fixture/.test(t.url))
    })
    check('la fenêtre de l\u2019app est visible', Boolean(target), target?.url)

    // 1. Injection du panneau Theme Engine (aucun thème actif).
    const client = await themeTarget(target.webSocketDebuggerUrl, '', null, () => {}, mockPort)

    const hostOk = await evalOn(client, `Boolean(document.getElementById('freebuff-theme-engine-host'))`)
    check('le panneau Theme Engine est injecté dans Freebuff', hostOk === true)

    const fabOk = await evalOn(
      client,
      `Boolean(${SHADOW}.getElementById('fbt-fab')) && ${SHADOW}.getElementById('fbt-panel').hidden === true`,
    )
    check('le bouton « Thèmes » existe (panneau fermé par défaut)', fabOk === true)

    // 2. Ouvrir le panneau : la liste des thèmes arrive depuis l'API.
    await evalOn(client, `${SHADOW}.getElementById('fbt-fab').click()`)
    const themesRendered = await waitFor(async () => {
      const n = await evalOn(client, `${SHADOW}.querySelectorAll('.fbt-theme').length`)
      return n === BUILTINS.length ? n : null
    })
    check('le panneau liste les thèmes du studio', themesRendered === BUILTINS.length, String(themesRendered))

    // 3. VS0 — activer un thème depuis Freebuff → changement visuel immédiat.
    await evalOn(client, `${SHADOW}.querySelector('[data-theme="dracula"]').click()`)
    const bgApplied = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)
      return bg === '#282a36' ? bg : null
    })
    check('activer un thème change réellement la page (--bg)', bgApplied === '#282a36', bgApplied)
    check('le studio a stocké le thème actif', mock.state.themeId === 'dracula', mock.state.themeId)

    // 4. VS0 — rechargement : le thème ET le panneau reviennent automatiquement.
    await client.send('Page.reload', { ignoreCache: true })
    const afterReload = await waitFor(async () => {
      const ready = await evalOn(client, `document.readyState`).catch(() => '')
      if (ready !== 'complete') return null
      const bg = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`).catch(() => '')
      const host = await evalOn(client, `Boolean(document.getElementById('freebuff-theme-engine-host'))`).catch(() => false)
      return bg === '#282a36' && host ? { bg, host } : null
    })
    check('réinjection après reload : thème + panneau toujours là', Boolean(afterReload), JSON.stringify(afterReload))

    // 5. VS0 — retrait de l'injection depuis le panneau.
    await evalOn(client, `${SHADOW}.getElementById('fbt-restore').click()`)
    const bgRestored = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)
      return bg === '#0e0e0e' ? bg : null
    })
    check('« Restaurer » retire l\u2019injection (--bg d\u2019origine)', bgRestored === '#0e0e0e', bgRestored)
    check('le studio n\u2019a plus de thème actif', mock.state.themeId === null)

    /* ------------------------------------------------------------ */
    /* VS1 — le modèle de thème à tokens                             */
    /* ------------------------------------------------------------ */

    // 6. Ouvrir l'éditeur sur un thème intégré.
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula"]').click()`)
    const editorOpen = await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      const inputs = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-color-rows input').length`)
      return !hidden && inputs === 6 ? inputs : null
    })
    check('l\u2019éditeur de thème s\u2019ouvre avec les 6 tokens', editorOpen === 6, String(editorOpen))

    // 7. DoD : changer UN token (accent) → plusieurs variables cohérentes
    //    changent dans Freebuff, et plusieurs éléments de l'UI aussi.
    await evalOn(client, `(() => {
      const input = ${SHADOW}.querySelector('#fbt-color-rows input[data-token="accent"]');
      input.value = '#ff0000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`)
    const accentChange = await waitFor(async () => {
      const brand = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()`)
      if (brand !== '#ff0000') return null
      const brandDim = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--brand-dim').trim()`)
      const ok = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--ok').trim()`)
      const linkColor = await evalOn(client, `getComputedStyle(document.getElementById('demo-link')).color`)
      return { brand, brandDim, ok, linkColor }
    })
    check('l\u2019aperçu en direct est appliqué (--brand suit le token)', accentChange?.brand === '#ff0000', accentChange?.brand)
    check('--brand-dim est dérivé du token accent', accentChange?.brandDim === darken('#ff0000', 0.22), accentChange?.brandDim)
    check('--ok est dérivé du token accent', accentChange?.ok === '#ff0000', accentChange?.ok)
    check('le lien (--brand) change aussi — 1 token, plusieurs endroits', accentChange?.linkColor === 'rgb(255, 0, 0)', accentChange?.linkColor)

    const previewStatus = await evalOn(client, `${SHADOW}.getElementById('fbt-edit-status').textContent`)
    check('l\u2019état signale un aperçu non enregistré', /Aper\u00e7u en direct/.test(previewStatus || ''), previewStatus)

    // 8. Enregistrer → crée un thème utilisateur dérivé et l'active.
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const savedTheme = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t ? t : null
    })
    check('Enregistrer crée un thème utilisateur dérivé (jamais intégré)', Boolean(savedTheme), savedTheme?.id)
    const builtinDracula = BUILTINS.find((t) => t.id === 'dracula')
    check('le thème intégré n\u2019est pas écrasé', builtinDracula.tokens.accent === '#50fa7b', builtinDracula.tokens.accent)
    check('le thème sauvegardé garde le token accent édité', savedTheme?.tokens.accent === '#ff0000', savedTheme?.tokens.accent)
    check('le thème sauvegardé hérite de la base dracula', savedTheme?.base === 'dracula', savedTheme?.base)
    check('le thème dérivé est activé', mock.state.themeId === 'dracula-custom', mock.state.themeId)

    const cardMarked = await waitFor(async () => {
      const count = await evalOn(client, `${SHADOW}.querySelectorAll('.fbt-theme').length`)
      const active = await evalOn(client, `${SHADOW}.querySelector('.fbt-theme.active [data-theme]')?.getAttribute('data-theme')`)
      return count === BUILTINS.length + 1 && active === 'dracula-custom' ? { count, active } : null
    })
    check('le thème dérivé apparaît dans la liste et est actif', Boolean(cardMarked), JSON.stringify(cardMarked))

    // 9. Reset → ramène les tokens du thème de base (dracula).
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })
    await evalOn(client, `${SHADOW}.getElementById('fbt-reset').click()`)
    const resetProof = await waitFor(async () => {
      const brand = await evalOn(client, `getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()`)
      return brand === '#50fa7b' ? brand : null
    })
    check('Reset ramène le token accent de la base (aperçu appliqué)', resetProof === '#50fa7b', resetProof)
    const resetStored = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.tokens.accent === '#50fa7b' ? t : null
    })
    check('Reset persiste les tokens de base du thème utilisateur', Boolean(resetStored), resetStored?.tokens.accent)

    /* ------------------------------------------------------------ */
    /* VS2 — theming par composants                                 */
    /* ------------------------------------------------------------ */

    // L'éditeur est encore ouvert sur dracula-custom (reset) — retour à la liste.
    await evalOn(client, `${SHADOW}.getElementById('fbt-edit-back').click()`)
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })

    // 10. Section Components → détail du bouton.
    await evalOn(client, `${SHADOW}.querySelector('[data-comp="button"]').click()`)
    const compOpen = await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-comp-detail').hidden`)
      const rows = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-comp-colors input').length`)
      return !hidden && rows === 4 ? rows : null
    })
    check('le détail du composant Button s\u2019ouvre (4 couleurs)', compOpen === 4, String(compOpen))

    // 11. Changer le fond du bouton → le bouton change, l'input non (isolation).
    await evalOn(client, `(() => {
      const input = ${SHADOW}.querySelector('#fbt-comp-colors input[data-prop="background"]');
      input.value = '#ff00aa';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const btnBgChanged = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
      return bg === 'rgb(255, 0, 170)' ? bg : null
    })
    check('le fond du bouton change (aperçu en direct)', btnBgChanged === 'rgb(255, 0, 170)', btnBgChanged)
    const inputBg = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).backgroundColor`)
    check('l\u2019input n\u2019est PAS affecté par le bouton (isolation)', inputBg === 'rgb(45, 47, 58)', inputBg)

    // 12. Rayon du bouton → le bouton change, la card non.
    await evalOn(client, `(() => {
      const r = ${SHADOW}.querySelector('#fbt-comp-detail input[data-prop="radius"]');
      r.value = '12';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const btnRadius = await waitFor(async () => {
      const r = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).borderRadius`)
      return r === '12px' ? r : null
    })
    check('le rayon du bouton change', btnRadius === '12px', btnRadius)
    const cardRadius = await evalOn(client, `getComputedStyle(document.querySelector('.card')).borderRadius`)
    check('la card n\u2019est PAS affectée', cardRadius === '8px', cardRadius)

    // 13. Accent du bouton → --brand surchargé AU SEIN du bouton seulement.
    await evalOn(client, `(() => {
      const input = ${SHADOW}.querySelector('#fbt-comp-colors input[data-prop="accent"]');
      input.value = '#123456';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const btnBrand = await waitFor(async () => {
      const b = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).getPropertyValue('--brand').trim()`)
      return b === '#123456' ? b : null
    })
    check('le token accent est surchargé au sein du bouton', btnBrand === '#123456', btnBrand)
    const inputBrand = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).getPropertyValue('--brand').trim()`)
    check('l\u2019input garde l\u2019accent global du thème', inputBrand === '#50fa7b', inputBrand)

    // 14. Retour à la liste des composants : le résumé reflète les overrides.
    await evalOn(client, `${SHADOW}.getElementById('fbt-comp-back').click()`)
    const compSummary = await evalOn(client, `${SHADOW}.querySelector('[data-comp="button"] .fbt-comp-summary').textContent`)
    check('le résumé du bouton reflète les overrides', /3 r\u00e9glages modifi\u00e9s/.test(compSummary || ''), compSummary)

    // 15. Modifier l'input → le bouton ne bouge pas (DoD).
    await evalOn(client, `${SHADOW}.querySelector('[data-comp="input"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-comp-detail').hidden`)
      return hidden === false
    })
    await evalOn(client, `(() => {
      const input = ${SHADOW}.querySelector('#fbt-comp-colors input[data-prop="background"]');
      input.value = '#00ff88';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const inputBg2 = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).backgroundColor`)
      return bg === 'rgb(0, 255, 136)' ? bg : null
    })
    check('le fond de l\u2019input change', inputBg2 === 'rgb(0, 255, 136)', inputBg2)
    const btnBg2 = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
    check('le bouton n\u2019est PAS affecté par l\u2019input (DoD)', btnBg2 === 'rgb(255, 0, 170)', btnBg2)

    // 16. Enregistrer → le thème stocke les overrides de composants.
    await evalOn(client, `${SHADOW}.getElementById('fbt-comp-back').click()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const savedComp = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.components && t.components.button && t.components.input ? t : null
    })
    check('Enregistrer stocke les overrides de composants', Boolean(savedComp), JSON.stringify(savedComp?.components))
    check('les overrides du bouton sont sauvegardés', savedComp?.components.button.background === '#ff00aa' && savedComp?.components.button.radius === 12, JSON.stringify(savedComp?.components.button))

    // 17. Reset du thème → les composants reviennent à la base.
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })
    await evalOn(client, `${SHADOW}.getElementById('fbt-reset').click()`)
    const resetBtnBg = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
      return bg === 'rgb(45, 47, 58)' ? bg : null
    })
    check('Reset efface les composants (bouton → surface globale)', resetBtnBg === 'rgb(45, 47, 58)', resetBtnBg)
    const resetComp = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && (!t.components || !Object.keys(t.components).length) ? t : null
    })
    check('Reset persiste la disparition des composants', Boolean(resetComp))

    client.close()
  } finally {
    try { child.kill() } catch { /* déjà mort */ }
    // Sur Windows, Edge se relance seul : child.kill() ne touche pas le vrai
    // navigateur. On le termine par son profil, sinon les connexions CDP du
    // mock restent ouvertes et le processus de test ne se termine jamais.
    await killEdgeByProfile(profile)
    fixture.close()
    mock.server.close()
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
