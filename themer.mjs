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
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadAssets } from './lib/assets.mjs'
import {
  bringAppWindowToFront,
  findFreePort,
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
    const trace = makeTrace()
    const exe = findFreebuff(config.appPath)
    if (!exe) {
      await finishTrace(trace, 'error', 'Freebuff executable not found.')
      return sendJson(res, 400, {
        error: 'freebuff-not-found',
        message: 'Freebuff Desktop was not found. Use the "Freebuff path" field in the studio, or the FREEBUFF_EXE environment variable.',
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
    if (!config.debugPort) config.debugPort = await findFreePort(DEBUG_PORT_START)
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
          const fb = osScan.windows.filter(
            (w) => /freebuff desktop/i.test(w.title || '') || (/freebuff/i.test(w.title || '') && w.vis && !w.min),
          )
          for (const w of fb.slice(0, 6)) {
            const sameDesk = osScan.fgDesk == null || w.desk === osScan.fgDesk
            traceLog(
              trace,
              `OS Freebuff window z=${w.z} pid=${w.pid} minimized=${w.min} rect=${w.rect} desk=${w.desk}${sameDesk ? '' : ' *** ON A DIFFERENT VIRTUAL DESKTOP ***'}`,
            )
          }
          const main = fb.find((w) => !w.min) || fb[0]
          if (main) {
            const forced = await forceWindowVisible(main.hwnd)
            traceLog(trace, `Force visible (hwnd ${main.hwnd}): ${JSON.stringify(forced)}`)
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
