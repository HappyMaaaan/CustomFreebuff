#!/usr/bin/env node
/**
 * CustomFreebuff — theme studio for Freebuff Desktop.
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
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadAssets } from './lib/assets.mjs'
import { DEFAULT_TOKENS, normalizeTheme, themeToCss } from './lib/theme-model.mjs'
import { listUserThemes, readUserTheme, saveUserTheme } from './lib/theme-store.mjs'
import {
  bringAppWindowToFront,
  findFreePort,
  isPortFree,
  listTargets,
  isAppPageTarget,
  probeAppWindowState,
  themeTarget,
  waitForAppWindow,
  watchAndTheme,
} from './lib/cdp.mjs'
import {
  findFreebuff,
  freebuffProcessInfo,
  isRunning,
  killStaleProcesses,
  launchFreebuff,
  processSnapshot,
  readNativeThemePref,
  themerConfigDir,
  waitForInstanceExit,
} from './lib/launcher.mjs'
import { captureDesktopPng, forceWindowVisible, scanOsWindows } from './lib/win.mjs'

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
/* Themes: the model (VS1). Built-in themes ship with the project;     */
/* user themes live in our config directory. The CSS injected into      */
/* Freebuff is GENERATED from the theme's tokens (lib/theme-model.mjs)  */
/* — never a hand-written rule set.                                     */
/* ------------------------------------------------------------------ */

const THEMES = assets.themes

function themeById(id) {
  return readUserTheme(id) ?? THEMES.find((t) => t.id === id) ?? null
}

function allThemes() {
  return [
    ...THEMES.map((t) => ({ ...t, builtin: true })),
    ...listUserThemes().map((t) => ({ ...t, builtin: false })),
  ]
}

/** A readable, unique id for a new user theme (never overwrites an existing one). */
function uniqueThemeId(name) {
  const base =
    String(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme'
  let id = base
  let n = 2
  while (themeById(id)) id = `${base}-${n++}`
  return id
}

/** The effective CSS to apply (built-in/user theme OR custom CSS). */
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
// Non-empty while a live preview (VS1) is applied but not yet saved.
let lastPreviewCss = null

function log(msg) {
  console.log(`[customfreebuff] ${msg}`)
}

function restartWatcher(cssOverride = null) {
  if (watcher) {
    watcher.stop()
    watcher = null
  }
  lastConnectCount = 0
  // The watcher runs as soon as a debug port is known (even with no active
  // theme): it keeps the Theme Engine panel alive in Freebuff and re-injects
  // automatically after reloads / restarts. An empty css removes any leftover
  // style — exactly the "retrait de l'injection" behavior.
  // `cssOverride` carries a transient live-preview (VS1): applied to the
  // windows but never persisted — the next apply/save/restore clears it.
  const css = cssOverride ?? effectiveCss() ?? ''
  const scheme = cssOverride ? null : effectiveColorScheme()
  lastCss = css
  lastScheme = scheme
  if (!config.debugPort) return
  watcher = watchAndTheme({
    debugPort: config.debugPort,
    css,
    colorScheme: scheme,
    themeUiPort: serverPort,
    onStatus: (n) => {
      lastConnectCount = n
    },
    log,
  })
  log(
    css
      ? `Applying theme live (debug port ${config.debugPort}).`
      : `Theme Engine active (debug port ${config.debugPort}) — no theme applied.`,
  )
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
        const client = await themeTarget(target.webSocketDebuggerUrl, css, colorScheme, log, serverPort)
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
  const proc = await freebuffProcessInfo()
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
    running: proc.running,
    staleCount: proc.staleCount,
    debugPort: config.debugPort ?? null,
    debugAlive,
    connected,
    uiPort: serverPort,
    mode: config.mode ?? 'theme',
    themeId: config.themeId ?? null,
    customCss: config.customCss ?? '',
    nativePref: readNativeThemePref(),
    lastTrace: tracePayload(lastLaunchTrace),
    appVersion: null,
    previewing: Boolean(lastPreviewCss),
    themes: allThemes().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      colorScheme: t.colorScheme,
      base: t.base,
      tokens: t.tokens,
      components: t.components,
      builtin: Boolean(t.builtin),
    })),
  }
}

let serverPort = null

/* ------------------------------------------------------------------ */
/* Launch diagnostics: every launch attempt is traced to a file AND   */
/* returned to the UI, so a failure can never be silent again.        */
/* ------------------------------------------------------------------ */

let lastLaunchTrace = null

function makeTrace() {
  return { at: new Date().toISOString(), lines: [] }
}

function traceLog(trace, line) {
  trace.lines.push(line)
  console.log(`[launch] ${line}`)
}

function tracePayload(trace) {
  return trace ? { at: trace.at, result: trace.result, message: trace.message, lines: trace.lines } : null
}

async function finishTrace(trace, result, message) {
  trace.result = result
  trace.message = message
  lastLaunchTrace = trace
  try {
    const dir = themerConfigDir()
    fs.mkdirSync(dir, { recursive: true })
    const text = trace.lines.map((l) => `    ${l}`).join('\n')
    fs.appendFileSync(
      path.join(dir, 'launch-trace.log'),
      `\n[${trace.at}] ${result.toUpperCase()}: ${message}\n${text}\n`,
    )
  } catch {
    /* best-effort */
  }
}

function freebuffUserDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'Freebuff')
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Freebuff')
  return path.join(os.homedir(), '.config', 'Freebuff')
}

/** Reads the files Freebuff leaves behind when a launch goes wrong. */
async function launchDiagnostics(debugPort) {
  const lines = []
  const snap = await processSnapshot()
  lines.push(`Processes now: ${JSON.stringify(snap)}`)
  try {
    const portFile = path.join(freebuffUserDataDir(), 'DevToolsActivePort')
    lines.push(`DevToolsActivePort: ${fs.readFileSync(portFile, 'utf8').trim().replace(/\n/g, ' | ')}`)
  } catch {
    lines.push('DevToolsActivePort: (absent — Chromium never started its debug port)')
  }
  try {
    const logFile = path.join(freebuffUserDataDir(), 'logs', 'orchestrator-stderr.log')
    const tail = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).slice(-8).join('\n    ')
    lines.push(`Orchestrator log tail:\n    ${tail}`)
  } catch {
    lines.push('Orchestrator log: (absent — the orchestrator never started)')
  }
  return { lines }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
  const p = url.pathname

  // CORS for the Theme Engine panel injected inside Freebuff (VS0): the app
  // page lives on another loopback origin and calls our /api/* endpoints.
  // Only loopback origins are allowed through, so a random website cannot
  // call the local API (DNS-rebinding / CSRF protection).
  const origin = req.headers.origin
  let corsOrigin = null
  if (origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase()
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') corsOrigin = origin
    } catch {
      /* not a URL */
    }
  }
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    // Preflight for the panel's cross-origin POST (content-type json).
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Max-Age', '600')
    res.writeHead(204)
    return res.end()
  }

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
    return sendJson(res, 200, { themes: allThemes() })
  }

  // VS1 — live preview: applies the edited tokens without persisting them.
  // The next apply / save / restore returns the app to the saved state.
  if (p === '/api/preview' && req.method === 'POST') {
    const body = await readBody(req)
    const theme = normalizeTheme(body.theme || {})
    const css = themeToCss(theme)
    lastPreviewCss = css
    restartWatcher(css)
    return sendJson(res, 200, { ok: true })
  }

  // VS1 — theme storage: saves a user theme. Editing a built-in theme NEVER
  // overwrites it: it creates a derived user theme (base = source theme), so
  // "créer un thème n'écrase pas les autres" holds from day one.
  if (p === '/api/themes/save' && req.method === 'POST') {
    const body = await readBody(req)
    const raw = body.theme || {}
    const source = themeById(raw.id)
    const isBuiltin = Boolean(source && THEMES.some((t) => t.id === source.id))
    let theme
    let isNew = false
    if (source && !isBuiltin) {
      theme = normalizeTheme(raw, source)
    } else {
      isNew = true
      // Editing a built-in theme NEVER overwrites it: it creates a derived
      // user theme, with an explicit "(custom)" suffix so the two are never
      // confused in the list.
      let name
      if (isBuiltin) name = `${source.name} (custom)`
      else if (!source) name = 'Custom theme'
      else name = String(raw.name || '').trim() || source.name
      theme = normalizeTheme({
        ...raw,
        id: uniqueThemeId(name),
        name,
        base: source?.id ?? 'default',
        colorScheme: raw.colorScheme || source?.colorScheme || 'dark',
      })
    }
    saveUserTheme(theme)
    log(`Theme "${theme.name}" saved (${theme.id}).`)
    if (body.activate) {
      lastPreviewCss = null
      if (config.nativePrefBefore == null && theme.colorScheme) {
        config.nativePrefBefore = readNativeThemePref()
      }
      config.mode = 'theme'
      config.themeId = theme.id
      saveConfig(config)
      restartWatcher()
      log(`Theme "${theme.name}" is now active.`)
    }
    return sendJson(res, 200, { ok: true, theme: { ...theme, builtin: false }, isNew })
  }

  // VS1/VS2 — theme reset: restores the base of the theme. A user theme goes
  // back to its base's tokens AND components (persisted); a built-in theme is
  // already its own default, so reset simply returns it unchanged.
  if (p === '/api/themes/reset' && req.method === 'POST') {
    const body = await readBody(req)
    const theme = themeById(body.themeId)
    if (!theme) return sendJson(res, 404, { error: 'unknown-theme', message: 'Unknown theme.' })
    const builtin = Boolean(THEMES.some((t) => t.id === theme.id))
    let tokens = theme.tokens
    let components = theme.components ?? {}
    if (!builtin) {
      const base = themeById(theme.base) ?? themeById('default')
      tokens = base?.tokens ?? DEFAULT_TOKENS
      components = base?.components ?? {}
    }
    const reset = normalizeTheme({ ...theme, tokens, components })
    if (!builtin) saveUserTheme(reset)
    return sendJson(res, 200, { ok: true, theme: { ...reset, builtin } })
  }

  if (p === '/api/launch' && req.method === 'POST') {
    const trace = makeTrace()
    const exe = findFreebuff(config.appPath)
    if (!exe) {
      await finishTrace(trace, 'error', 'Freebuff executable not found.')
      return sendJson(res, 400, {
        error: 'freebuff-not-found',
        message: 'Freebuff Desktop was not found. Set the FREEBUFF_EXE environment variable to its path.',
        trace: tracePayload(trace),
      })
    }
    traceLog(trace, `Launch requested. Exe: ${exe}`)
    traceLog(trace, `Processes before: ${JSON.stringify(await processSnapshot())}`)

    // A live windowed instance cannot be relaunched: Electron's single-instance
    // lock would make the new process quit silently. But the user often clicks
    // Launch right after closing Freebuff, while it is still quitting — so wait
    // a few seconds for it to exit before refusing.
    if (await isRunning()) {
      traceLog(trace, 'Windowed instance detected — waiting up to 8 s for it to fully exit.')
      const exited = await waitForInstanceExit(8000)
      if (!exited) {
        traceLog(trace, 'Instance still running after 8 s — refusing to launch (single-instance lock).')
        await finishTrace(trace, 'blocked', 'Freebuff is already open (window detected).')
        return sendJson(res, 409, {
          error: 'already-running',
          message:
            'Freebuff is still open (a window is detected) after waiting 8 seconds. Close its window, or if it is stuck use the Clean up button, or close every Freebuff.exe and bun.exe from the Freebuff folder in Task Manager, then click Launch again. The studio never kills a live instance on its own, because that could destroy an active session.',
          trace: tracePayload(trace),
        })
      }
      traceLog(trace, 'Previous instance exited — continuing the launch.')
    }

    // A previous session may have left windowless helper processes or an
    // orphaned orchestrator behind. They block a new launch (Electron's
    // single-instance lock and the desktop-state profile lock), so clear them
    // before starting. Never touches a running instance.
    const stale = await killStaleProcesses()
    traceLog(trace, `Removed ${stale} leftover Freebuff process(es).`)
    // Give a dying previous instance time to release its locks.
    const exited = await waitForInstanceExit(6000)
    traceLog(trace, `Previous instance fully exited: ${exited}`)
    if (await isRunning()) {
      traceLog(trace, 'A windowed instance (re)appeared during cleanup — refusing to launch.')
      await finishTrace(trace, 'blocked', 'A windowed Freebuff instance is running again.')
      return sendJson(res, 409, {
        error: 'already-running',
        message: 'Freebuff opened again during the cleanup. Close its window, wait for it to quit, then click Launch once more.',
        trace: tracePayload(trace),
      })
    }
    // Let the OS release file handles / locks before starting a fresh instance.
    await new Promise((r) => setTimeout(r, 1000))
    config.appPath = exe
    // Use the saved debug port only if it is actually free — a leftover
    // process holding it would make Chromium fail to bind and the launch
    // would look broken for no reason.
    if (!config.debugPort || !(await isPortFree(config.debugPort))) {
      config.debugPort = await findFreePort(DEBUG_PORT_START)
    }
    saveConfig(config)
    try {
      launchFreebuff(exe, config.debugPort)
      traceLog(trace, `Spawned Freebuff with debug port ${config.debugPort}.`)
    } catch (err) {
      traceLog(trace, `Spawn failed: ${err.message}`)
      await finishTrace(trace, 'error', err.message)
      return sendJson(res, 500, { error: 'launch-failed', message: err.message, trace: tracePayload(trace) })
    }
    restartWatcher()
    // Wait for an actual WINDOW (a page target), not just the debug port: the
    // port answers as soon as Chromium starts, even when boot later fails. A
    // cold orchestrator start plus the app's 10 s profile-lock wait can exceed
    // 25 s, so the budget is generous and every step is traced.
    const started = await waitForAppWindow(config.debugPort, 45000, (elapsed, port, win) => {
      traceLog(trace, `t+${elapsed}s: debug port ${port ? 'up' : 'not yet'}, app window ${win ? 'up' : 'not yet'}`)
    })
    if (started) {
      traceLog(trace, 'App window detected — launch successful.')
      // Ground truth on the real window: is it visible, on-screen, sized right?
      const probe = await probeAppWindowState(config.debugPort)
      if (probe) {
        traceLog(trace, `Window state: ${JSON.stringify(probe)}`)
        // A window opened by a background process can land BEHIND the studio's
        // browser/terminal (Windows foreground lock) — bring it into view.
        const fix = await bringAppWindowToFront(config.debugPort)
        if (fix) traceLog(trace, `Window brought into view: ${JSON.stringify(fix)}`)
      } else {
        traceLog(trace, 'Could not probe the window state.')
      }
      // OS-level ground truth: the renderer cannot tell us whether the window
      // is behind everything, minimized, or on another virtual desktop — the
      // OS can. Scan the real windows, log the Freebuff one, force it visible.
      if (process.platform === 'win32') {
        const osScan = await scanOsWindows()
        if (osScan) {
          const fg = osScan.windows.find((w) => w.fg)
          traceLog(
            trace,
            `OS scan: ${osScan.windows.length} top-level windows, foreground desk=${osScan.fgDesk}${fg ? ` (${(fg.title || '').slice(0, 40)})` : ''}`,
          )
          // Identify the REAL Freebuff window by its owning process
          // (Freebuff.exe), never by title: "Freebuff" appears in the titles
          // of Chrome, Discord, Explorer… and forcing THOSE windows to the
          // front is what kept hiding the actual app window.
          const isFbProc = (w) => /freebuff\.exe$/i.test((w.proc || '').trim())
          let fb = osScan.windows.filter((w) => isFbProc(w) && /freebuff desktop/i.test(w.title || ''))
          if (fb.length === 0) fb = osScan.windows.filter((w) => isFbProc(w))
          for (const w of fb.slice(0, 6)) {
            const sameDesk = osScan.fgDesk == null || w.desk === osScan.fgDesk
            traceLog(
              trace,
              `OS Freebuff window z=${w.z} pid=${w.pid} proc=${w.proc || '?'} vis=${w.vis} minimized=${w.min} rect=${w.rect} desk=${w.desk}${sameDesk ? '' : ' *** ON A DIFFERENT VIRTUAL DESKTOP ***'}`,
            )
          }
          // Prefer a visible, un-minimized window; fall back to any of them.
          const main = fb.find((w) => w.vis && !w.min) || fb.find((w) => !w.min) || fb[0]
          if (main) {
            const forced = await forceWindowVisible(main.hwnd)
            traceLog(trace, `Force visible (hwnd ${main.hwnd}): ${JSON.stringify(forced)}`)
            // A freshly opened window can still be settling (or was created
            // hidden); one more pass after a moment covers that.
            await new Promise((r) => setTimeout(r, 2000))
            const scan2 = await scanOsWindows()
            if (scan2) {
              const again = scan2.windows
                .filter((w) => isFbProc(w) && /freebuff desktop/i.test(w.title || ''))
                .find((w) => w.vis && !w.min)
              if (again && again.hwnd !== main.hwnd) {
                const forced2 = await forceWindowVisible(again.hwnd)
                traceLog(trace, `Force visible pass 2 (hwnd ${again.hwnd}): ${JSON.stringify(forced2)}`)
              }
            }
          }
        }
        // Screenshot of the primary screen for the record — the definitive
        // answer to "is the window really there or not".
        try {
          const shotPath = path.join(themerConfigDir(), 'launch-screenshot.png')
          const saved = await captureDesktopPng(shotPath)
          if (saved) traceLog(trace, `Desktop screenshot saved: ${shotPath}`)
        } catch {
          /* best-effort */
        }
      }
      await finishTrace(trace, 'ok', 'App window detected and brought into view.')
      return sendJson(res, 200, { ok: true, debugPort: config.debugPort, started: true, trace: tracePayload(trace) })
    }
    // No window within the budget: collect everything the app left behind so
    // the failure is explainable instead of silent.
    traceLog(trace, 'No window appeared within 45 s — collecting diagnostics.')
    const diag = await launchDiagnostics(config.debugPort)
    for (const line of diag.lines) traceLog(trace, line)
    await finishTrace(trace, 'no-window', 'Freebuff processes may be running, but no window appeared.')
    return sendJson(res, 200, {
      ok: true,
      debugPort: config.debugPort,
      started: false,
      trace: tracePayload(trace),
      diagnostics: diag,
    })
  }

  if (p === '/api/diagnostics' && req.method === 'GET') {
    const snap = await processSnapshot()
    const diag = await launchDiagnostics(config.debugPort)
    return sendJson(res, 200, {
      snapshot: snap,
      diagnostics: diag,
      lastTrace: tracePayload(lastLaunchTrace),
      debugPort: config.debugPort ?? null,
      hasScreenshot: fs.existsSync(path.join(themerConfigDir(), 'launch-screenshot.png')),
    })
  }

  if (p === '/api/screenshot' && req.method === 'GET') {
    const file = path.join(themerConfigDir(), 'launch-screenshot.png')
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(fs.readFileSync(file))
    }
    res.writeHead(404)
    return res.end()
  }

  if (p === '/api/cleanup' && req.method === 'POST') {
    const killed = await killStaleProcesses()
    log(`Cleanup: removed ${killed} leftover Freebuff process(es).`)
    return sendJson(res, 200, {
      ok: true,
      killed,
      message: killed > 0
        ? `Removed ${killed} leftover Freebuff process(es). You can launch it now.`
        : 'Nothing to clean up — either Freebuff is running normally, or no leftover process was found.',
    })
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
    lastPreviewCss = null
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
    lastPreviewCss = null
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

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

/**
 * Opens the launcher. On Windows we prefer Chromium's `--app=` mode: a small
 * standalone window (no tabs, no address bar) — the "toute petite fenêtre"
 * of VS2.5 — instead of a browser tab. Falls back to the default browser.
 */
async function openBrowser(url) {
  if (process.argv.includes('--no-open')) return
  const { spawn } = await import('node:child_process')
  if (process.platform === 'win32') {
    const edge = findEdge()
    if (edge) {
      try {
        const child = spawn(edge, [`--app=${url}`], { detached: true, stdio: 'ignore', windowsHide: true })
        if (child.unref) child.unref()
        return
      } catch {
        /* fall back to the default browser below */
      }
    }
  }
  const cmd =
    process.platform === 'win32'
      ? 'cmd'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    if (child.unref) child.unref()
  } catch {
    /* opening the launcher is a convenience, not a requirement */
  }
}

// Single-instance guard: if another themer already holds the canonical UI
// port (double-clicked twice, or Windows relaunched the exe), exit quietly
// instead of starting a second server + launcher window. Without this, each
// extra instance also polls /api/state every 2 s, which used to multiply the
// console-window flashes (see lib/launcher.mjs).
async function otherInstanceRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${UI_PORT_START}/api/state`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return false
    const body = await res.json()
    return (
      typeof body === 'object' &&
      body !== null &&
      'uiPort' in body &&
      'freebuffPath' in body
    )
  } catch {
    return false
  }
}

if (await otherInstanceRunning()) {
  // The launcher of the running instance is already on screen; there is
  // nothing useful a second instance could do. Silent exit (GUI exe: no
  // console, no flash).
  process.exit(0)
}

serverPort = await findFreePort(UI_PORT_START)
server.listen(serverPort, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${serverPort}`
  console.log('')
  console.log('  ┌──────────────────────────────────────────────────┐')
  console.log('  │   CustomFreebuff — theme injector for Freebuff    │')
  console.log('  └──────────────────────────────────────────────────┘')
  console.log(`  Launcher : ${url}`)
  console.log(`  Freebuff : ${findFreebuff(config.appPath) || 'not found (see the launcher)'}`)
  console.log('')
  console.log('  Click "Patch Freebuff" in the small launcher window:')
  console.log('  Freebuff starts with the injection, and a "🎨 Themes"')
  console.log('  button (Theme Engine) appears inside Freebuff, bottom-right.')
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
