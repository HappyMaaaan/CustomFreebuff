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
    if (targetProvider) await targetProvider((wsUrl) => themeTarget(wsUrl, css, scheme, () => {}).catch(() => {}))
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
        let shape = theme.shape ?? {}
        let shadow = theme.shadow ?? {}
        let effects = theme.effects ?? {}
        let motion = theme.motion ?? {}
        let extraCss = theme.extraCss ?? ''
        let cssScope = theme.cssScope ?? 'app'
        if (!theme.builtin) {
          const base = themeById(theme.base) ?? themeById('default')
          tokens = base?.tokens ?? DEFAULT_TOKENS
          components = base?.components ?? {}
          shape = base?.shape ?? {}
          shadow = base?.shadow ?? {}
          effects = base?.effects ?? {}
          motion = base?.motion ?? {}
          extraCss = base?.extraCss ?? ''
          cssScope = base?.cssScope ?? 'app'
        }
        const reset = normalizeTheme({ ...theme, tokens, components, shape, shadow, effects, motion, extraCss, cssScope })
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
    check('the state reports an unsaved live preview', /Live preview/.test(previewStatus || ''), previewStatus)

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
    check('the button summary reflects the overrides', /3 settings modified/.test(compSummary || ''), compSummary)

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

    /* ------------------------------------------------------------ */
    /* VS3 — component states                                       */
    /* ------------------------------------------------------------ */

    // Rouvrir l'éditeur sur dracula-custom (le reset VS2 a vidé les composants).
    await evalOn(client, `${SHADOW}.getElementById('fbt-edit-back').click()`)
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })

    // 18. Le détail du composant liste les 5 états.
    await evalOn(client, `${SHADOW}.querySelector('[data-comp="button"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-comp-detail').hidden`)
      return hidden === false
    })
    const stateRows = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-states .fbt-state-row').length`)
    check('le détail du composant liste les 5 états', stateRows === 5, String(stateRows))

    // 19. Ouvrir l'état Hover.
    await evalOn(client, `${SHADOW}.querySelector('#fbt-states [data-state="hover"]').click()`)
    const hoverOpen = await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-state-detail').hidden`)
      const title = await evalOn(client, `${SHADOW}.querySelector('#fbt-state-detail .fbt-title').textContent`)
      return !hidden && title === 'Button \u00b7 Hover' ? title : null
    })
    check('l\u2019éditeur de l\u2019état Hover s\u2019ouvre', hoverOpen === 'Button \u00b7 Hover', hoverOpen)

    // 20. DoD : changer le fond de l'état Hover → le bouton change UNIQUEMENT
    //     survolé, son état normal reste intact.
    await evalOn(client, `(() => {
      const input = ${SHADOW}.querySelector('#fbt-state-colors input[data-prop="background"]');
      input.value = '#00ff88';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const baseBg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
    check('état normal : le bouton garde sa surface globale (inchangé)', baseBg === 'rgb(45, 47, 58)', baseBg)

    // Vrai survol via CDP → la règle button:hover s'applique réellement.
    const rect = await evalOn(client, `(() => {
      const r = document.getElementById('demo-btn').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
    const hoverBg = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
      return bg === 'rgb(0, 255, 136)' ? bg : null
    })
    check('survolé : le bouton prend le fond de l\u2019état Hover', hoverBg === 'rgb(0, 255, 136)', hoverBg)
    const hoverInputBg = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).backgroundColor`)
    check('l\u2019input n\u2019est PAS affecté par le survol du bouton (isolation)', hoverInputBg === 'rgb(45, 47, 58)', hoverInputBg)

    // Sortir du survol → retour à l'état normal.
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    const backBg = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
      return bg === 'rgb(45, 47, 58)' ? bg : null
    })
    check('hors survol : le bouton revient à son état normal', backBg === 'rgb(45, 47, 58)', backBg)

    // 21. Le résumé de l'état reflète l'override.
    const hoverSummary = await evalOn(client, `${SHADOW}.querySelector('#fbt-states [data-state="hover"] .fbt-state-summary').textContent`)
    check('le résumé de l\u2019état Hover reflète l\u2019override', /1 setting modified/.test(hoverSummary || ''), hoverSummary)

    // 22. Reset de l'état → le survol ne change plus rien.
    await evalOn(client, `${SHADOW}.getElementById('fbt-state-reset').click()`)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
    const resetHover = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
      return bg === 'rgb(45, 47, 58)' ? bg : null
    })
    check('Reset de l\u2019état : le survol redevient l\u2019état normal', resetHover === 'rgb(45, 47, 58)', resetHover)

    /* ------------------------------------------------------------ */
    /* VS4 — shapes + shadows                                       */
    /* ------------------------------------------------------------ */

    // Retour à l'éditeur principal (état → composant → éditeur).
    await evalOn(client, `${SHADOW}.getElementById('fbt-state-back').click()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-comp-back').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })

    // 23. La section Shapes & Depth liste les 5 presets.
    const presets = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-shape-presets .fbt-preset').length`)
    check('la section Shapes & Depth liste les 5 presets', presets === 5, String(presets))

    // État initial : la card garde le look de l'app (rayon 8, pas d'ombre).
    const initialCard = await evalOn(client, `(() => {
      const c = getComputedStyle(document.querySelector('.card'));
      return { radius: c.borderRadius, shadow: c.boxShadow };
    })()`)
    check('par défaut la card garde son look (aucun shape appliqué)', initialCard.radius === '8px' && initialCard.shadow === 'none', JSON.stringify(initialCard))

    // 24. DoD — Flat → Floating depuis l'éditeur : la card devient flottante
    //     (rayon augmenté + ombre d'élévation), sans toucher aux tokens.
    await evalOn(client, `${SHADOW}.querySelector('#fbt-shape-presets [data-preset="floating"]').click()`)
    const floatingCard = await waitFor(async () => {
      const c = await evalOn(client, `(() => {
        const el = document.querySelector('.card');
        const s = getComputedStyle(el);
        return { radius: s.borderRadius, shadow: s.boxShadow };
      })()`)
      return c.radius === '14px' && c.shadow.includes('rgba(0, 0, 0, 0.4)') ? c : null
    })
    check('preset Floating → la card gagne le rayon 14px', floatingCard?.radius === '14px', floatingCard?.radius)
    check('preset Floating → la card gagne une ombre d\u2019élévation', floatingCard?.shadow.includes('rgba(0, 0, 0, 0.4)'), floatingCard?.shadow)
    const btnShape = await evalOn(client, `(() => {
      const s = getComputedStyle(document.getElementById('demo-btn'));
      return { radius: s.borderRadius, shadow: s.boxShadow };
    })()`)
    check('le bouton (surface) suit aussi le shape global', btnShape.radius === '14px' && btnShape.shadow.includes('rgba(0, 0, 0, 0.4)'), JSON.stringify(btnShape))
    const layerCount = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-shadow-layers .fbt-shadow-layer').length`)
    check('l\u2019éditeur d\u2019ombre liste les 2 couches du preset', layerCount === 2, String(layerCount))

    // 25. Opacité de bordure : 50 % → la bordure de la card devient translucide.
    await evalOn(client, `(() => {
      const input = ${SHADOW}.getElementById('fbt-shape-border-opacity');
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    // dracula's border token is #44475a → rgb(68, 71, 90).
    const cardBorder = await waitFor(async () => {
      const c = await evalOn(client, `getComputedStyle(document.querySelector('.card')).borderColor`)
      return c === 'rgba(68, 71, 90, 0.5)' ? c : null
    })
    check('opacité de bordure 50 % → bordure translucide', cardBorder === 'rgba(68, 71, 90, 0.5)', cardBorder)

    // 26. Sauvegarde → le thème stocke shape + shadow.
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const savedShape = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.shape && t.shape.radius === 14 && t.shadow && t.shadow.layers.length === 2 ? t : null
    })
    check('Enregistrer stocke le shape (rayon 14)', Boolean(savedShape), JSON.stringify(savedShape?.shape))
    check('Enregistrer stocke les couches d\u2019ombre', savedShape?.shadow.layers.length === 2, JSON.stringify(savedShape?.shadow))

    // 27. Reset → le shape revient à la base (plus de rayon, plus d'ombre).
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })
    await evalOn(client, `${SHADOW}.getElementById('fbt-reset').click()`)
    const resetCard = await waitFor(async () => {
      const c = await evalOn(client, `(() => {
        const s = getComputedStyle(document.querySelector('.card'));
        return { radius: s.borderRadius, shadow: s.boxShadow };
      })()`)
      return c.radius === '8px' && c.shadow === 'none' ? c : null
    })
    check('Reset ramène la card à son look d\u2019origine (8px, sans ombre)', Boolean(resetCard), JSON.stringify(resetCard))
    const resetStoredShape = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.shape && t.shape.radius === 0 && t.shadow.layers.length === 0 ? t : null
    })
    check('Reset persiste la disparition du shape', Boolean(resetStoredShape), JSON.stringify(resetStoredShape?.shape))

    /* ------------------------------------------------------------ */
    /* VS5 — glass & visual effects                                 */
    /* ------------------------------------------------------------ */

    // L'éditeur est resté ouvert sur dracula-custom (reset VS4).
    const fxPresets = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-effects-presets .fbt-preset').length`)
    check('la section Effects liste les 5 presets', fxPresets === 5, String(fxPresets))
    const initialFx = await evalOn(client, `(() => {
      const s = getComputedStyle(document.querySelector('.card'));
      return { bg: s.backgroundColor, blur: s.backdropFilter };
    })()`)
    check('au départ : pas d\u2019effets (fond opaque, aucun flou)', initialFx.bg === 'rgb(45, 47, 58)' && initialFx.blur === 'none', JSON.stringify(initialFx))

    // 28. DoD — Frosted : un style glass cohérent sur PLUSIEURS composants
    //     à la fois, sans écrire de CSS.
    await evalOn(client, `${SHADOW}.querySelector('#fbt-effects-presets [data-preset="frosted"]').click()`)
    const glassCard = await waitFor(async () => {
      const c = await evalOn(client, `(() => {
        const el = document.querySelector('.card');
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, blur: s.backdropFilter, border: s.borderColor };
      })()`)
      return c.bg === 'rgba(45, 47, 58, 0.78)' ? c : null
    })
    check('frosted → la card devient translucide', glassCard?.bg === 'rgba(45, 47, 58, 0.78)', glassCard?.bg)
    check('frosted → backdrop blur appliqué', glassCard?.blur === 'blur(14px) saturate(1.2) brightness(1.05)', glassCard?.blur)
    check('frosted → bordure translucide', glassCard?.border === 'rgba(68, 71, 90, 0.4)', glassCard?.border)
    const glassOthers = await evalOn(client, `(() => {
      const inp = getComputedStyle(document.getElementById('demo-input')).backgroundColor;
      const btn = getComputedStyle(document.getElementById('demo-btn')).backgroundColor;
      return { inp, btn };
    })()`)
    check('le bouton ET l\u2019input reçoivent le même glass (DoD multi-composants)', glassOthers.inp === 'rgba(45, 47, 58, 0.78)' && glassOthers.btn === 'rgba(45, 47, 58, 0.78)', JSON.stringify(glassOthers))

    // 29. Détection des effets coûteux + contrôle de performance.
    const perfBadge = await evalOn(client, `${SHADOW}.getElementById('fbt-effects-perf').textContent`)
    check('le badge détecte les effets coûteux (backdrop blur)', /Heavy effects/.test(perfBadge || '') && /backdrop blur/.test(perfBadge || ''), perfBadge)
    await evalOn(client, `${SHADOW}.getElementById('fbt-effects-perf-toggle').click()`)
    const perfOff = await waitFor(async () => {
      const c = await evalOn(client, `(() => {
        const s = getComputedStyle(document.querySelector('.card'));
        return { bg: s.backgroundColor, blur: s.backdropFilter };
      })()`)
      return c.blur === 'none' && c.bg === 'rgba(45, 47, 58, 0.78)' ? c : null
    })
    check('perf off → le flou disparaît, la transparence reste', Boolean(perfOff), JSON.stringify(perfOff))
    const perfBadge2 = await evalOn(client, `${SHADOW}.getElementById('fbt-effects-perf').textContent`)
    check('le badge confirme le mode performance', /Performance mode/.test(perfBadge2 || ''), perfBadge2)
    await evalOn(client, `${SHADOW}.getElementById('fbt-effects-perf-toggle').click()`)
    await waitFor(async () => {
      const blur = await evalOn(client, `getComputedStyle(document.querySelector('.card')).backdropFilter`)
      return blur === 'blur(14px) saturate(1.2) brightness(1.05)'
    })
    check('perf auto → le flou revient', true)

    // 30. Désactiver les effets depuis le panneau.
    await evalOn(client, `${SHADOW}.getElementById('fbt-effects-enable').click()`)
    const fxOff = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.querySelector('.card')).backgroundColor`)
      return bg === 'rgb(45, 47, 58)' ? bg : null
    })
    check('le toggle désactive tous les effets (fond opaque)', fxOff === 'rgb(45, 47, 58)', fxOff)
    await evalOn(client, `${SHADOW}.getElementById('fbt-effects-enable').click()`)
    await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.querySelector('.card')).backgroundColor`)
      return bg === 'rgba(45, 47, 58, 0.78)'
    })
    check('réactiver → le glass revient', true)

    // 31. Sauvegarde → le thème stocke les effets ; Reset → retour à la base.
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const savedFx = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.effects && t.effects.enabled && t.effects.blur === 14 ? t : null
    })
    check('Enregistrer stocke les effets (frosted)', Boolean(savedFx), JSON.stringify(savedFx?.effects))
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })
    await evalOn(client, `${SHADOW}.getElementById('fbt-reset').click()`)
    const fxReset = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.querySelector('.card')).backgroundColor`)
      return bg === 'rgb(45, 47, 58)' ? bg : null
    })
    check('Reset retire les effets (fond opaque)', fxReset === 'rgb(45, 47, 58)', fxReset)
    const fxResetStored = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.effects && t.effects.enabled === false ? t : null
    })
    check('Reset persiste la disparition des effets', Boolean(fxResetStored), JSON.stringify(fxResetStored?.effects))

    /* ------------------------------------------------------------ */
    /* VS6 — motion engine                                          */
    /* ------------------------------------------------------------ */

    // L'éditeur est resté ouvert sur dracula-custom (reset VS5).
    const motionPresets = await evalOn(client, `${SHADOW}.querySelectorAll('#fbt-motion-presets .fbt-preset').length`)
    check('la section Motion liste les 4 presets', motionPresets === 4, String(motionPresets))
    const noMotion = await evalOn(client, `(() => {
      const t = getComputedStyle(document.getElementById('demo-btn')).transition;
      return t.includes('transform');
    })()`)
    check('au départ : aucun motion (pas de transition)', noMotion === false)

    // 32. DoD — Smooth : le preset change réellement le comportement animé.
    await evalOn(client, `${SHADOW}.querySelector('#fbt-motion-presets [data-preset="smooth"]').click()`)
    const motionApplied = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transition`)
      return t.includes('transform') && t.includes('0.2s') ? t : null
    })
    check('Smooth → transition transform 200ms sur le bouton', Boolean(motionApplied), motionApplied)

    // Vrai survol via CDP → le bouton se transforme (translateY + scale).
    const btnRect = await evalOn(client, `(() => {
      const r = document.getElementById('demo-btn').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnRect.x, y: btnRect.y })
    const hoverTransform = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transform`)
      return t === 'matrix(1.02, 0, 0, 1.02, 0, -2)' ? t : null
    })
    check('survolé : le bouton glisse et grossit (translateY -2, scale 1.02)', hoverTransform === 'matrix(1.02, 0, 0, 1.02, 0, -2)', hoverTransform)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    const backTransform = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transform`)
      return t === 'none' ? t : null
    })
    check('hors survol : le bouton revient à la normale', backTransform === 'none', backTransform)

    // L'aperçu dans le panneau suit les valeurs (Hover Button → Preview).
    const previewTransition = await evalOn(client, `${SHADOW}.getElementById('fbt-motion-preview').style.transition`)
    check('le bouton de preview suit la durée et l\u2019easing', /transform 200ms ease-out/.test(previewTransition || ''), previewTransition)

    // 33. Enter : un nouveau message s\u2019anime à son apparition.
    await evalOn(client, `(() => {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = 'hello';
      document.body.appendChild(b);
      return b.className;
    })()`)
    const enterName = await evalOn(client, `getComputedStyle(document.querySelector('.bubble')).animationName`)
    check('les nouveaux messages s\u2019animent (fbt-enter)', enterName === 'fbt-enter', enterName)

    // 34. Sauvegarde → le thème stocke le motion ; Reset → retour à minimal.
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const savedMotion = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.motion && t.motion.duration === 200 && t.motion.hover.translateY === -2 ? t : null
    })
    check('Enregistrer stocke le motion (smooth)', Boolean(savedMotion), JSON.stringify(savedMotion?.motion))
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })
    await evalOn(client, `${SHADOW}.getElementById('fbt-reset').click()`)
    const motionReset = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transition`)
      return !t.includes('transform') ? t : null
    })
    check('Reset retire le motion (plus de transition)', Boolean(motionReset), motionReset)
    const motionResetStored = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.motion && t.motion.duration === 0 ? t : null
    })
    check('Reset persiste le retour à minimal', Boolean(motionResetStored), JSON.stringify(motionResetStored?.motion))

    /* ------------------------------------------------------------ */
    /* VS7 — global motion (speed / intensity / reduced-motion)      */
    /* ------------------------------------------------------------ */

    // 35. VS7 DoD — a single setting makes the whole app faster: Smooth ×2.
    await evalOn(client, `${SHADOW}.querySelector('#fbt-motion-presets [data-preset="smooth"]').click()`)
    await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transition`)
      return t.includes('transform') && t.includes('0.2s') ? t : null
    })
    await evalOn(client, `(() => {
      const s = ${SHADOW}.getElementById('fbt-motion-speed');
      s.value = '2';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return s.value;
    })()`)
    const fastTransition = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transition`)
      return t.includes('0.4s') ? t : null
    })
    check('Speed ×2 → l\u2019app entière est 2× plus rapide (400ms)', Boolean(fastTransition), fastTransition)
    const speedVal = await evalOn(client, `${SHADOW}.getElementById('fbt-motion-speed').nextElementSibling.textContent`)
    check('le slider Speed affiche 2.0×', speedVal === '2.0\u00d7', speedVal)

    // 36. Intensity — discreet (0) freezes the hover, dynamic (2) amplifies it.
    await evalOn(client, `(() => {
      const s = ${SHADOW}.getElementById('fbt-motion-intensity');
      s.value = '0';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const btnRect2 = await evalOn(client, `(() => {
      const r = document.getElementById('demo-btn').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnRect2.x, y: btnRect2.y })
    const quietHover = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transform`)
      return t === 'none' ? t : null
    })
    check('Intensity 0 → le survol ne bouge plus (discret)', quietHover === 'none', quietHover)
    await evalOn(client, `(() => {
      const s = ${SHADOW}.getElementById('fbt-motion-intensity');
      s.value = '2';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const loudHover = await waitFor(async () => {
      const t = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).transform`)
      return t === 'matrix(1.04, 0, 0, 1.04, 0, -4)' ? t : null
    })
    check('Intensity 2 → le survol est amplifié (dynamique)', loudHover === 'matrix(1.04, 0, 0, 1.04, 0, -4)', loudHover)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })

    // 37. Reduced motion — the media query is injected, removed when toggled.
    const reducedOn = await evalOn(client, `document.getElementById('freebuff-themer-style').textContent.includes('prefers-reduced-motion')`)
    check('reduced-motion : la media query est injectée par défaut', reducedOn === true)
    await evalOn(client, `(() => {
      const t = ${SHADOW}.getElementById('fbt-motion-reduced');
      t.checked = false;
      t.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    const reducedOff = await waitFor(async () => {
      const has = await evalOn(client, `document.getElementById('freebuff-themer-style').textContent.includes('prefers-reduced-motion')`)
      return has === false ? true : null
    })
    check('toggle off → la media query disparaît', Boolean(reducedOff))

    // 38. Sauvegarde → le thème stocke le global ; Reset → défauts neutres.
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const savedGlobal = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.motion && t.motion.global && t.motion.global.speed === 2 && t.motion.global.intensity === 2 && t.motion.global.reduced === 'off' ? t : null
    })
    check('Enregistrer stocke le global (speed 2, intensity 2, reduced off)', Boolean(savedGlobal), JSON.stringify(savedGlobal?.motion?.global))
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false
    })
    await evalOn(client, `${SHADOW}.getElementById('fbt-reset').click()`)
    const globalReset = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.motion && t.motion.global && t.motion.global.speed === 1 && t.motion.global.intensity === 1 && t.motion.global.reduced === 'auto' ? t : null
    })
    check('Reset remet le global à la neutralité (1 / 1 / auto)', Boolean(globalReset), JSON.stringify(globalReset?.motion?.global))

    /* ------------------------------------------------------------ */
    /* VS8 — visual element inspector                               */
    /* ------------------------------------------------------------ */

    // 39. Pick mode: the editor offers "Edit Element", the hint appears.
    const pickBtnBefore = await evalOn(client, `${SHADOW}.getElementById('fbt-pick').textContent`)
    check('le bouton Edit Element est dans l\u2019éditeur', pickBtnBefore === '🎯 Edit Element', pickBtnBefore)
    await evalOn(client, `${SHADOW}.getElementById('fbt-pick').click()`)
    const pickActive = await evalOn(client, `(() => {
      const p = ${SHADOW}.getElementById('fbt-pick');
      return p.classList.contains('active') && ${SHADOW}.getElementById('fbt-inspect-hint').hidden === false;
    })()`)
    check('le mode picking est actif (hint visible)', pickActive === true)

    // Survol → le highlight suit l'élément candidat.
    await evalOn(client, `document.getElementById('demo-btn').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))`)
    const hoverHighlight = await evalOn(client, `(() => {
      const h = document.getElementById('fbt-inspector-highlight');
      return { show: h.style.display === 'block', label: h.dataset.label };
    })()`)
    check('le survol du bouton affiche le highlight « Button »', hoverHighlight.show === true && hoverHighlight.label === 'Button', JSON.stringify(hoverHighlight))

    // 40. VS8 DoD — cliquer sur CE bouton : le Theme Engine sait qu'il s'agit
    //     du composant Button, l'inspecteur s'ouvre, le highlight reste épinglé.
    await evalOn(client, `document.getElementById('demo-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
    const inspectorOpen = await evalOn(client, `(() => {
      const v = ${SHADOW}.getElementById('fbt-inspector');
      const title = ${SHADOW}.querySelector('#fbt-inspector .fbt-title');
      const h = document.getElementById('fbt-inspector-highlight');
      return { open: v.hidden === false, title: title.textContent, pinned: h.style.display === 'block', pickDone: ${SHADOW}.getElementById('fbt-pick').classList.contains('active') === false };
    })()`)
    check('clic → inspecteur « Button » ouvert, highlight épinglé', inspectorOpen.open === true && inspectorOpen.title === 'Button' && inspectorOpen.pinned === true && inspectorOpen.pickDone === true, JSON.stringify(inspectorOpen))

    // 41. Modifier depuis l'inspecteur → preview live sur CE bouton, isolé.
    await evalOn(client, `(() => {
      const i = ${SHADOW}.querySelector('#fbt-inspector input[data-prop="background"]');
      i.value = '#3366ff';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const inspBg = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).backgroundColor`)
      return bg === 'rgb(51, 102, 255)' ? bg : null
    })
    check('Background édité → CE bouton change en direct', inspBg === 'rgb(51, 102, 255)', inspBg)
    const inspInputBg = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).backgroundColor`)
    check('l\u2019input voisin n\u2019est pas touché (isolation)', inspInputBg === 'rgb(45, 47, 58)', inspInputBg)

    // Shape → Radius, Effects → Glow (accent du thème).
    await evalOn(client, `(() => {
      const r = ${SHADOW}.querySelector('#fbt-inspector input[type="range"]');
      r.value = '24';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const inspRadius = await waitFor(async () => {
      const v = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).borderRadius`)
      return v === '24px' ? v : null
    })
    check('Radius édité → 24px sur le bouton', inspRadius === '24px', inspRadius)
    await evalOn(client, `(() => {
      const g = ${SHADOW}.querySelectorAll('#fbt-inspector input[type="range"]')[1];
      g.value = '50';
      g.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const inspGlow = await waitFor(async () => {
      const s = await evalOn(client, `getComputedStyle(document.getElementById('demo-btn')).boxShadow`)
      return s.includes('rgba(80, 250, 123, 0.28)') ? s : null
    })
    check('Glow édité → halo accent sur le bouton', Boolean(inspGlow), inspGlow)

    // Motion → Hover : l'inspecteur ouvre l'éditeur d'état Hover réel.
    await evalOn(client, `${SHADOW}.querySelector('#fbt-inspector .fbt-inspect-row button').click()`)
    const stateFromInspector = await evalOn(client, `(() => {
      const s = ${SHADOW}.getElementById('fbt-state-detail');
      return { open: s.hidden === false, title: ${SHADOW}.querySelector('#fbt-state-detail .fbt-title').textContent };
    })()`)
    check('Hover → l\u2019éditeur d\u2019état s\u2019ouvre (Button · Hover)', stateFromInspector.open === true && stateFromInspector.title === 'Button · Hover', JSON.stringify(stateFromInspector))
    await evalOn(client, `${SHADOW}.getElementById('fbt-state-back').click()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-edit-back').click()`)

    // 42. Pick another : cliquer un input → inspecteur « Input ».
    await evalOn(client, `${SHADOW}.getElementById('fbt-pick').click()`)
    await evalOn(client, `document.getElementById('demo-input').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
    const inputInspector = await evalOn(client, `(() => {
      const v = ${SHADOW}.getElementById('fbt-inspector');
      const title = ${SHADOW}.querySelector('#fbt-inspector .fbt-title');
      return { open: v.hidden === false, title: title.textContent };
    })()`)
    check('un clic sur l\u2019input → inspecteur « Input »', inputInspector.open === true && inputInspector.title === 'Input', JSON.stringify(inputInspector))

    // 43. Protection : les éléments sensibles (le panneau lui-même) ne sont
    //     jamais interceptés ni thématisés.
    await evalOn(client, `${SHADOW}.getElementById('fbt-inspector-pick').click()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-pick').click()`)
    const protectedPanel = await evalOn(client, `(() => {
      const v = ${SHADOW}.getElementById('fbt-inspector');
      const hint = ${SHADOW}.getElementById('fbt-inspect-hint');
      return { inspectorStillClosed: v.hidden === true, stillPicking: hint.hidden === false };
    })()`)
    check('un clic dans le panneau n\u2019est pas intercepté', protectedPanel.inspectorStillClosed === true && protectedPanel.stillPicking === true, JSON.stringify(protectedPanel))
    await evalOn(client, `document.querySelector('h1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
    const nonThemeable = await evalOn(client, `(() => {
      const v = ${SHADOW}.getElementById('fbt-inspector');
      const toast = ${SHADOW}.querySelector('.fbt-toast');
      return { inspectorClosed: v.hidden === true, toastShown: toast.classList.contains('show') };
    })()`)
    check('un élément non thématisable → toast, pas d\u2019inspecteur', nonThemeable.inspectorClosed === true && nonThemeable.toastShown === true, JSON.stringify(nonThemeable))

    // 44. Reset du composant depuis l'inspecteur → retour au look de base.
    await evalOn(client, `document.getElementById('demo-input').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
    await evalOn(client, `(() => {
      const i = ${SHADOW}.querySelector('#fbt-inspector input[data-prop="background"]');
      i.value = '#ffaa00';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const inputChanged = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).backgroundColor`)
      return bg === 'rgb(255, 170, 0)' ? bg : null
    })
    check('input édité → preview live isolée du bouton', inputChanged === 'rgb(255, 170, 0)', inputChanged)
    await evalOn(client, `${SHADOW}.getElementById('fbt-inspector-reset').click()`)
    const inputReset = await waitFor(async () => {
      const bg = await evalOn(client, `getComputedStyle(document.getElementById('demo-input')).backgroundColor`)
      return bg === 'rgb(45, 47, 58)' ? bg : null
    })
    check('Reset → l\u2019input revient à sa base', inputReset === 'rgb(45, 47, 58)', inputReset)

    // 45. Sauvegarde : le composant inspecté est stocké (button only).
    await evalOn(client, `${SHADOW}.getElementById('fbt-inspector-back').click()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const inspSavedComp = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      const b = t?.components?.button
      return t && b && b.background === '#3366ff' && b.radius === 24 && b.glow === 0.5 && !t.components.input ? t : null
    })
    check('Enregistrer stocke le composant inspecté (button, pas input)', Boolean(inspSavedComp), JSON.stringify(inspSavedComp?.components))

    /* ------------------------------------------------------------ */
    /* VS9 — Advanced CSS                                           */
    /* ------------------------------------------------------------ */

    // 46. The editor offers an Advanced entry; it opens the CSS editor.
    await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
    await waitFor(async () => {
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      return hidden === false ? true : null
    })
    const advEntry = await evalOn(client, `(() => {
      const b = ${SHADOW}.getElementById('fbt-advanced');
      return { label: b.querySelector('.fbt-comp-name').textContent, summary: b.querySelector('.fbt-comp-summary').textContent };
    })()`)
    check('la section Advanced est dans l\u2019éditeur', advEntry.label === 'Custom CSS' && advEntry.summary.includes('Tokens'), JSON.stringify(advEntry))
    await evalOn(client, `${SHADOW}.getElementById('fbt-advanced').click()`)
    const advOpen = await evalOn(client, `(() => {
      const v = ${SHADOW}.getElementById('fbt-adv');
      return { open: v.hidden === false, title: ${SHADOW}.querySelector('#fbt-adv .fbt-title').textContent, tokens: ${SHADOW}.querySelectorAll('.fbt-token-chip').length };
    })()`)
    check('clic → la vue Advanced s\u2019ouvre avec la référence de tokens', advOpen.open === true && advOpen.title === 'Custom CSS' && advOpen.tokens >= 10, JSON.stringify(advOpen))

    // A fixture element the custom CSS will target. Its base look lives in a
    // page style with :where() (zero specificity) so the theme's custom CSS
    // wins when active and the element reverts when it is scoped out/removed.
    await evalOn(client, `(() => {
      const st = document.createElement('style');
      st.id = 'custom-css-fixture-style';
      st.textContent = ':where(#custom-css-target) { background: rgb(255, 0, 0); width: 120px; height: 40px; }';
      document.head.appendChild(st);
      const d = document.createElement('div');
      d.id = 'custom-css-target';
      document.body.appendChild(d);
    })()`)

    // 47. VS9 DoD — CSS typed in the editor is injected live, and the theme
    //     tokens (var(--theme-*)) are consumed by the app.
    const customCss = '#custom-css-target {\n  background: var(--theme-surface);\n  border-radius: var(--theme-radius);\n  box-shadow: 0 0 0 2px var(--theme-accent);\n}'
    await evalOn(client, `(() => {
      const t = ${SHADOW}.getElementById('fbt-adv-editor');
      t.value = ${JSON.stringify(customCss)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const advApplied = await waitFor(async () => {
      const s = await evalOn(client, `(() => {
        const el = document.getElementById('custom-css-target');
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, shadow: cs.boxShadow };
      })()`)
      return s.bg === 'rgb(45, 47, 58)' && s.shadow.includes('rgb(80, 250, 123)') ? s : null
    })
    check('DoD : CSS écrit → injecté en direct (--theme-surface, --theme-accent)', Boolean(advApplied), JSON.stringify(advApplied))
    const advHighlighted = await evalOn(client, `${SHADOW}.getElementById('fbt-adv-editor').value.length > 0 && ${SHADOW}.querySelector('.fbt-code-highlight').innerHTML.includes('fbt-tok-sel')`)
    check('la syntaxe est surlignée (sélecteur coloré)', advHighlighted === true)
    const advOk = await evalOn(client, `${SHADOW}.getElementById('fbt-adv-ok').hidden === false`)
    check('« Valid CSS » affiché', advOk === true)

    // 48. The tokens follow the theme: a radius change updates
    //     var(--theme-radius) everywhere the custom CSS uses it.
    await evalOn(client, `${SHADOW}.getElementById('fbt-edit-back').click()`)
    await evalOn(client, `(() => {
      const r = ${SHADOW}.getElementById('fbt-shape-radius');
      r.value = '18';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const advRadiusFollows = await waitFor(async () => {
      const v = await evalOn(client, `getComputedStyle(document.getElementById('custom-css-target')).borderRadius`)
      return v === '18px' ? v : null
    })
    check('var(--theme-radius) suit le slider Shape', advRadiusFollows === '18px', advRadiusFollows)

    // 49. Scope « surfaces » → every selector is prefixed, the element outside
    //     the surfaces stops matching.
    await evalOn(client, `${SHADOW}.getElementById('fbt-advanced').click()`)
    await evalOn(client, `(() => {
      const s = ${SHADOW}.getElementById('fbt-adv-scope');
      s.value = 'surfaces';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    const scopedInjected = await waitFor(async () => {
      const sheet = await evalOn(client, `document.getElementById('freebuff-themer-style').textContent`)
      return sheet.includes('button,input,textarea,select,.card,.bubble,.msg,aside,.sidebar,.modal,[role="dialog"] #custom-css-target') ? sheet : null
    })
    check('scope « surfaces » → les sélecteurs sont préfixés', Boolean(scopedInjected))
    const scopedReverted = await evalOn(client, `getComputedStyle(document.getElementById('custom-css-target')).backgroundColor`)
    check('l\u2019élément hors des surfaces n\u2019est plus touché', scopedReverted === 'rgb(255, 0, 0)', scopedReverted)

    // 50. Invalid CSS → error reporting with the line number.
    const badCss = '#custom-css-target {\n  color: red'
    await evalOn(client, `(() => {
      const t = ${SHADOW}.getElementById('fbt-adv-editor');
      t.value = ${JSON.stringify(badCss)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const advErrors = await waitFor(async () => {
      const v = await evalOn(client, `(() => {
        const e = ${SHADOW}.getElementById('fbt-adv-errors');
        return { shown: e.hidden === false, text: e.textContent };
      })()`)
      return v.shown && v.text.includes('Line ') ? v : null
    })
    check('CSS invalide → erreurs affichées avec la ligne', Boolean(advErrors), JSON.stringify(advErrors))

    // 51. Save stores extraCss + cssScope (sanitized); reopening restores the
    //     text; Reset custom CSS removes it from the injection.
    await evalOn(client, `(() => {
      const t = ${SHADOW}.getElementById('fbt-adv-editor');
      t.value = '#custom-css-target { color: var(--theme-text); }';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-edit-back').click()`)
    await evalOn(client, `${SHADOW}.getElementById('fbt-save').click()`)
    const advSaved = await waitFor(async () => {
      const t = mock.state.userThemes.get('dracula-custom')
      return t && t.extraCss.includes('custom-css-target') && t.cssScope === 'surfaces' ? t : null
    })
    check('Enregistrer stocke extraCss + cssScope', Boolean(advSaved), JSON.stringify(advSaved?.extraCss))
    // Reopen → the saved CSS is restored. The list refresh after save is
    // async, so poll until the editor shows the value (the stale themesById
    // is replaced by the fresh one on the next open).
    const advRestored = await waitFor(async () => {
      await evalOn(client, `${SHADOW}.querySelector('[data-edit="dracula-custom"]').click()`)
      const hidden = await evalOn(client, `${SHADOW}.getElementById('fbt-view-edit').hidden`)
      if (hidden !== false) return null
      await evalOn(client, `${SHADOW}.getElementById('fbt-advanced').click()`)
      const v = await evalOn(client, `${SHADOW}.getElementById('fbt-adv-editor').value`)
      return v && v.includes('custom-css-target') ? v : null
    })
    check('réouverture → le CSS est restauré dans l\u2019éditeur', Boolean(advRestored), String(advRestored))
    await evalOn(client, `${SHADOW}.getElementById('fbt-adv-reset').click()`)
    const advResetApplied = await waitFor(async () => {
      const sheet = await evalOn(client, `document.getElementById('freebuff-themer-style').textContent`)
      return !sheet.includes('custom-css-target') ? true : null
    })
    check('Reset custom CSS → retiré de l\u2019injection', advResetApplied === true)

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
