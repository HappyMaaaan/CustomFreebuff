#!/usr/bin/env node
/**
 * Freebuff Themer — theme studio for Freebuff Desktop.
 *
 * A small local server (127.0.0.1) that:
 *   - opens a web page to pick / edit a theme,
 *   - can launch Freebuff Desktop with a local debug port (a standard
 *     Chromium switch, like DevTools),
 *   - injects ONLY a stylesheet into the page being displayed, and
 *   - delegates the native window color to the app's official API.
 *
 * No Freebuff file is modified; the application is not patched.
 * Everything is reversible: without the studio, Freebuff is 100 % original.
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadAssets } from './lib/assets.mjs'
import { findFreePort, listTargets, isAppPageTarget, themeTarget, watchAndTheme } from './lib/cdp.mjs'
import {
  findFreebuff,
  isRunning,
  launchFreebuff,
  readNativeThemePref,
  themerConfigDir,
} from './lib/launcher.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')

const UI_PORT_START = Number(process.env.FREEBUFF_THEMER_PORT) || 8765
const DEBUG_PORT_START = 9333

// The studio page and built-in themes. In a compiled executable these come
// from the embedded bundle; in dev they are read from the project directory.
const assets = await loadAssets()

/* ------------------------------------------------------------------ */
/* Persisted config (in OUR directory, never Freebuff's).              */
/* ------------------------------------------------------------------ */

function loadConfig() {
  const dir = themerConfigDir()
  const file = path.join(dir, 'config.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  const dir = themerConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2))
}

let config = loadConfig()

/* ------------------------------------------------------------------ */
/* Built-in themes.                                                    */
/* ------------------------------------------------------------------ */

const THEMES = assets.themes

function themeById(id) {
  return THEMES.find((t) => t.id === id) ?? null
}

/** Turns a theme (JSON) into a stylesheet. */
export function themeToCss(theme) {
  const parts = [`color-scheme: ${theme.colorScheme} !important`]
  for (const [key, value] of Object.entries(theme.colors)) {
    parts.push(`${key}: ${value} !important`)
  }
  let css = `:root{${parts.join(';')}}`
  if (theme.extraCss) css += `\n${theme.extraCss}`
  return css
}

/** The effective CSS to apply (built-in theme OR custom CSS). */
function effectiveCss() {
  if (config.mode === 'custom' && config.customCss) return config.customCss
  const theme = themeById(config.themeId)
  return theme ? themeToCss(theme) : null
}

/** The colorScheme to push to the native side (null when no theme is active). */
function effectiveColorScheme() {
  if (config.mode === 'custom') {
    // In free-CSS mode we leave the app's native theme alone.
    return null
  }
  const theme = themeById(config.themeId)
  return theme ? theme.colorScheme : null
}

/* ------------------------------------------------------------------ */
/* CDP watcher.                                                        */
/* ------------------------------------------------------------------ */

let watcher = null
let lastCss = null
let lastScheme = null
let lastConnectCount = 0

function log(msg) {
  console.log(`[themer] ${msg}`)
}

function restartWatcher() {
  if (watcher) {
    watcher.stop()
    watcher = null
  }
  lastConnectCount = 0
  const css = effectiveCss()
  const scheme = effectiveColorScheme()
  lastCss = css
  lastScheme = scheme
  if (!css || !config.debugPort) return
  watcher = watchAndTheme({
    debugPort: config.debugPort,
    css,
    colorScheme: scheme,
    onStatus: (n) => {
      lastConnectCount = n
    },
    log,
  })
  log(`Applying theme live (debug port ${config.debugPort}).`)
}

/** Applies once to windows already open (used by "restore"). */
async function applyOnceToOpenTargets(css, colorScheme) {
  if (!config.debugPort) return 0
  let applied = 0
  try {
    const targets = await listTargets(config.debugPort)
    for (const target of targets) {
      if (!isAppPageTarget(target, null)) continue
      try {
        const client = await themeTarget(target.webSocketDebuggerUrl, css, colorScheme, log)
        client.close()
        applied++
      } catch {
        /* window closed in the meantime */
      }
    }
  } catch {
    /* app not reachable */
  }
  return applied
}

/* ------------------------------------------------------------------ */
/* Local HTTP server.                                                  */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

async function statePayload() {
  const running = await isRunning()
  let connected = 0
  let debugAlive = false
  if (config.debugPort) {
    try {
      const targets = await listTargets(config.debugPort)
      debugAlive = targets.length > 0
      connected = lastConnectCount
    } catch {
      debugAlive = false
    }
  }
  return {
    freebuffPath: findFreebuff(config.appPath),
    freebuffFound: Boolean(findFreebuff(config.appPath)),
    running,
    debugPort: config.debugPort ?? null,
    debugAlive,
    connected,
    uiPort: serverPort,
    mode: config.mode ?? 'theme',
    themeId: config.themeId ?? null,
    customCss: config.customCss ?? '',
    nativePref: readNativeThemePref(),
    appVersion: null,
    themes: THEMES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      colorScheme: t.colorScheme,
      colors: t.colors,
    })),
  }
}

let serverPort = null
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
  const p = url.pathname

  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(assets.indexHtml)
  }

  if (p.startsWith('/static/')) {
    const file = path.join(PUBLIC_DIR, url.pathname.slice('/static/'.length))
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403)
      return res.end()
    }
    return serveStatic(res, file)
  }

  if (p === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, await statePayload())
  }

  if (p === '/api/themes' && req.method === 'GET') {
    return sendJson(res, 200, { themes: THEMES })
  }

  if (p === '/api/launch' && req.method === 'POST') {
    const exe = findFreebuff(config.appPath)
    if (!exe) {
      return sendJson(res, 400, {
        error: 'freebuff-not-found',
        message: 'Freebuff Desktop was not found. Use the "Freebuff path" field in the studio, or the FREEBUFF_EXE environment variable.',
      })
    }
    if (await isRunning()) {
      return sendJson(res, 409, {
        error: 'already-running',
        message: 'Freebuff is already open. Close it, then launch it again from this studio so the theme can apply.',
      })
    }
    config.appPath = exe
    if (!config.debugPort) config.debugPort = await findFreePort(DEBUG_PORT_START)
    saveConfig(config)
    try {
      launchFreebuff(exe, config.debugPort)
    } catch (err) {
      return sendJson(res, 500, { error: 'launch-failed', message: err.message })
    }
    restartWatcher()
    log(`Freebuff launched (${path.basename(exe)}) with debug port ${config.debugPort}.`)
    return sendJson(res, 200, { ok: true, debugPort: config.debugPort })
  }

  if (p === '/api/apply' && req.method === 'POST') {
    const body = await readBody(req)
    const theme = themeById(body.themeId)
    if (!theme) {
      return sendJson(res, 400, { error: 'unknown-theme', message: `Unknown theme: ${body.themeId}` })
    }
    // Remember the native preference BEFORE any switch, so it can be restored
    // later (the app's file is never touched directly).
    if (config.nativePrefBefore == null && theme.colorScheme) {
      config.nativePrefBefore = readNativeThemePref()
    }
    config.mode = 'theme'
    config.themeId = theme.id
    saveConfig(config)
    restartWatcher()
    log(`Theme "${theme.name}" is now active.`)
    return sendJson(res, 200, { ok: true, themeId: theme.id })
  }

  if (p === '/api/custom' && req.method === 'POST') {
    const body = await readBody(req)
    const css = String(body.css ?? '').trim()
    config.mode = 'custom'
    config.customCss = css
    saveConfig(config)
    restartWatcher()
    log(css ? 'Custom CSS is active.' : 'Custom CSS cleared.')
    return sendJson(res, 200, { ok: true })
  }

  if (p === '/api/restore' && req.method === 'POST') {
    // Remove the CSS everywhere, restore the previous native preference.
    const restorePref = config.nativePrefBefore ?? 'dark'
    await applyOnceToOpenTargets('', restorePref)
    config.mode = 'theme'
    config.themeId = null
    config.customCss = ''
    config.nativePrefBefore = null
    saveConfig(config)
    restartWatcher()
    log('Theme disabled — Freebuff is back to its original look.')
    return sendJson(res, 200, { ok: true })
  }

  if (p === '/api/path' && req.method === 'POST') {
    const body = await readBody(req)
    const pth = String(body.path ?? '').trim()
    config.appPath = pth || null
    saveConfig(config)
    return sendJson(res, 200, { ok: true, freebuffPath: findFreebuff(config.appPath) })
  }

  res.writeHead(404)
  res.end('Not found')
})

function serveStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end('Not found')
    }
    const ext = path.extname(file).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

/* ------------------------------------------------------------------ */
/* Startup.                                                            */
/* ------------------------------------------------------------------ */

async function openBrowser(url) {
  if (process.argv.includes('--no-open')) return
  const cmd =
    process.platform === 'win32'
      ? 'cmd'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const { spawn } = await import('node:child_process')
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    if (child.unref) child.unref()
  } catch {
    /* opening the browser is a convenience, not a requirement */
  }
}

serverPort = await findFreePort(UI_PORT_START)
server.listen(serverPort, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${serverPort}`
  console.log('')
  console.log('  ┌──────────────────────────────────────────────────┐')
  console.log('  │   Freebuff Themer — theme studio                 │')
  console.log('  └──────────────────────────────────────────────────┘')
  console.log(`  Studio   : ${url}`)
  console.log(`  Freebuff : ${findFreebuff(config.appPath) || 'not found (see the studio)'}`)
  console.log('')
  console.log('  For the theme to apply, Freebuff must be launched')
  console.log('  from this studio (button "Launch Freebuff").')
  console.log('  Nothing in the application is modified: everything')
  console.log('  is reversible and limited to the display.')
  console.log('')
  if (process.env.FREEBUFF_THEMER_NO_OPEN !== '1') {
    void openBrowser(url)
  }
})

async function shutdown() {
  if (watcher) {
    watcher.stop()
    watcher = null
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Re-apply the theme at startup if one was active and Freebuff is already
// running with the right port (the "studio closed then reopened while
// Freebuff stayed open" case).
restartWatcher()
