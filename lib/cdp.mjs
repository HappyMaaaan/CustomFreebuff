/**
 * lib/cdp.mjs — Minimal Chrome DevTools Protocol client (zero dependency).
 *
 * We connect the way DevTools does: the Electron app exposes a loopback debug
 * port (--remote-debugging-port). We only ever:
 *   1. list the app's targets (windows),
 *   2. inject a stylesheet into the displayed page,
 *   3. use the app's OFFICIAL theme API (window.freebuffDesktop).
 * No file of the application is read, modified, or written.
 */

import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

const LOOPBACK = '127.0.0.1'

/** Finds the first free port in [start, start + maxTries). */
export async function findFreePort(start, maxTries = 8) {
  for (let port = start; port < start + maxTries; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port found near ${start}`)
}

export function isPortFree(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: LOOPBACK, port })
    sock.once('connect', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => resolve(true))
  })
}

/** Lists the targets (windows / pages) exposed by the debug port. */
export async function listTargets(debugPort) {
  const res = await fetch(`http://${LOOPBACK}:${debugPort}/json/list`)
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`)
  return res.json()
}

/** Waits until the debug port answers, or the timeout elapses. */
export async function waitForDebugPort(debugPort, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await listTargets(debugPort)
      if (targets.length > 0) return true
    } catch {
      /* app not up yet */
    }
    await sleep(500)
  }
  return false
}

/**
 * Waits until the app's WINDOW (a page target on a loopback origin) actually
 * shows up. The debug port answers as soon as Chromium starts, even when the
 * app later fails to boot — this is the check that matches "is there a window".
 *
 * `onProgress(seconds, seenPort, seenWindow)` is called every ~2 s so the UI
 * can show the wait instead of hanging silently. The default timeout is long:
 * a cold orchestrator start plus the app's own 10 s profile-lock wait can
 * easily exceed 25 s.
 */
export async function waitForAppWindow(debugPort, timeoutMs = 45000, onProgress = null) {
  const start = Date.now()
  let lastReport = 0
  let seenPort = false
  let seenWindow = false
  while (Date.now() - start < timeoutMs) {
    let portOk = false
    let windowOk = false
    try {
      const targets = await listTargets(debugPort)
      portOk = targets.length > 0
      windowOk = targets.some((t) => isAppPageTarget(t, null))
    } catch {
      /* app not up yet */
    }
    seenPort = seenPort || portOk
    seenWindow = seenWindow || windowOk
    if (windowOk) return true
    const elapsed = Math.round((Date.now() - start) / 1000)
    if (onProgress && elapsed - lastReport >= 2) {
      lastReport = elapsed
      onProgress(elapsed, seenPort, seenWindow)
    }
    await sleep(500)
  }
  if (onProgress) onProgress(Math.round((Date.now() - start) / 1000), seenPort, seenWindow)
  return false
}

/** Page targets that belong to the app (loopback origin, unknown a priori). */
export function isAppPageTarget(target, knownOrigin) {
  if (!target || target.type !== 'page') return false
  if (!target.url) return false
  let parsed
  try {
    parsed = new URL(target.url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase()
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false
  // Once the main window's origin is known, stick to it (preview webviews
  // run on other loopback ports).
  if (knownOrigin && parsed.origin !== knownOrigin) return false
  return true
}

/**
 * Connects to the first app page target and reads its REAL window state:
 * visibility, position, size, title. This distinguishes "no window" from
 * "window exists but is hidden / off-screen / behind other windows".
 * Returns null when the app is not reachable.
 */
export async function probeAppWindowState(debugPort) {
  try {
    const targets = await listTargets(debugPort)
    const target = targets.find((t) => isAppPageTarget(t, null))
    if (!target) return null
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    try {
      const { result } = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify((() => {
          const onScreen = window.screenX >= -80 && window.screenY >= -80 &&
            window.screenX < screen.availWidth - 120 && window.screenY < screen.availHeight - 120;
          return {
            visibility: document.visibilityState,
            readyState: document.readyState,
            screenX: window.screenX,
            screenY: window.screenY,
            outerW: window.outerWidth,
            outerH: window.outerHeight,
            screenAvailW: screen.availWidth,
            screenAvailH: screen.availHeight,
            onScreen,
            title: document.title,
            href: location.href.slice(0, 80),
          };
        })())`,
        returnByValue: true,
      })
      return result?.value ? JSON.parse(result.value) : null
    } finally {
      client.close()
    }
  } catch {
    return null
  }
}

/**
 * Brings the app window into view and to the foreground, best-effort:
 * focus the renderer, move the OS window into the visible area if it is
 * off-screen (window.moveTo works for the top window in Electron), and
 * resize it down if it overflows the screen.
 * Returns true when something was corrected.
 */
export async function bringAppWindowToFront(debugPort) {
  try {
    const targets = await listTargets(debugPort)
    const target = targets.find((t) => isAppPageTarget(t, null))
    if (!target) return false
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    try {
      const { result } = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify((() => {
          const maxX = Math.max(0, screen.availWidth - 200);
          const maxY = Math.max(0, screen.availHeight - 120);
          const onScreen = window.screenX >= -80 && window.screenY >= -80 &&
            window.screenX <= maxX && window.screenY <= maxY;
          const fits = window.outerWidth <= screen.availWidth && window.outerHeight <= screen.availHeight;
          if (!onScreen) window.moveTo(Math.min(Math.max(40, window.screenX), maxX), Math.min(Math.max(40, window.screenY), maxY));
          if (!fits) window.resizeTo(Math.min(window.outerWidth, screen.availWidth - 60), Math.min(window.outerHeight, screen.availHeight - 60));
          window.focus();
          return JSON.stringify({ moved: !onScreen, resized: !fits, screenX: window.screenX, screenY: window.screenY });
        })())`,
        returnByValue: true,
      })
      return result?.value ? JSON.parse(result.value) : null
    } finally {
      client.close()
    }
  } catch {
    return null
  }
}

/**
 * Generates the small script executed inside the page. It only:
 *   - stores the CSS on window (for re-application),
 *   - puts a <style> in <head>,
 *   - delegates the native window color to the app's official API.
 * Nothing else. An empty `css` removes the style (restore).
 */
export function makeInjector(css, colorScheme) {
  const cssJson = JSON.stringify(css ?? '')
  const schemeJson = JSON.stringify(colorScheme ?? '')
  return `(() => {
    const css = ${cssJson};
    window.__freebuffThemerCss = css;
    const id = 'freebuff-themer-style';
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    if (!css) return;
    // document.head can be missing during the very first phase of parsing
    // (scripts injected via addScriptToEvaluateOnNewDocument run early):
    // fall back to <html> and retry if needed.
    const mount = () => {
      if (document.getElementById(id)) return true;
      const host = document.head || document.documentElement;
      if (!host) return false;
      const el = document.createElement('style');
      el.id = id;
      el.textContent = css;
      host.appendChild(el);
      return true;
    };
    if (!mount()) {
      const timer = setInterval(() => { if (mount()) clearInterval(timer); }, 25);
      setTimeout(() => clearInterval(timer), 6000);
    }
    if (${schemeJson} && window.freebuffDesktop && typeof window.freebuffDesktop.setTheme === 'function') {
      window.freebuffDesktop.setTheme(${schemeJson});
    }
  })();`
}

/** Minimal JSON-RPC client over a CDP WebSocket. */
export class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.onEvent = null
    this.closed = false
    ws.addEventListener('close', () => {
      this.closed = true
    })
    ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.id != null) {
        const entry = this.pending.get(msg.id)
        if (!entry) return
        this.pending.delete(msg.id)
        if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`))
        else entry.resolve(msg.result)
      } else if (this.onEvent) {
        this.onEvent(msg)
      }
    })
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      let ws
      try {
        ws = new WebSocket(wsUrl)
      } catch (err) {
        reject(err)
        return
      }
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error(`CDP connection timed out: ${wsUrl}`))
      }, 5000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(new CdpClient(ws))
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(`Could not connect to ${wsUrl}`))
      })
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

/**
 * Applies the CSS to a target: immediately, then on every new document
 * (SPA reloads, thread windows). Returns the connected client.
 */
export async function themeTarget(wsUrl, css, colorScheme, log = () => {}) {
  const client = await CdpClient.connect(wsUrl)
  await client.send('Page.enable')
  const source = makeInjector(css, colorScheme)
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source })
  await client.send('Runtime.evaluate', { expression: source, returnByValue: true })
  log('Theme injected into a Freebuff window.')
  return client
}

/**
 * Applying loop: watches the debug port and themes each app window as it
 * appears. Stops when the app is closed. Returns a control object { stop() }.
 */
export function watchAndTheme({ debugPort, css, colorScheme, onStatus, log = () => {} }) {
  let stopped = false
  const themed = new Set() // wsUrls already themed (or being themed)
  const clients = new Set()
  let knownOrigin = null
  let timer = null

  async function tick() {
    if (stopped) return
    // Drop connections whose target window is gone (app reload, window closed)
    // so the UI status reflects the real number of styled windows.
    for (const client of clients) if (client.closed) clients.delete(client)
    if (onStatus) onStatus(clients.size)
    try {
      const targets = await listTargets(debugPort)
      if (!knownOrigin) {
        const main = targets.find((t) => isAppPageTarget(t, null))
        if (main) knownOrigin = new URL(main.url).origin
      }
      for (const target of targets) {
        if (!isAppPageTarget(target, knownOrigin)) continue
        if (themed.has(target.webSocketDebuggerUrl)) continue
        themed.add(target.webSocketDebuggerUrl)
        themeTarget(target.webSocketDebuggerUrl, css, colorScheme, log)
          .then((client) => {
            clients.add(client)
            client.onEvent = (msg) => {
              // An app reload does not restart our session; the CSS is
              // re-applied by addScriptToEvaluateOnNewDocument. We re-assert it
              // anyway after each document load / navigation.
              if (
                msg.method === 'Page.frameNavigated' ||
                msg.method === 'Page.navigatedWithinDocument' ||
                msg.method === 'Page.loadEventFired'
              ) {
                client
                  .send('Runtime.evaluate', {
                    expression: makeInjector(css, colorScheme),
                    returnByValue: true,
                  })
                  .catch(() => {})
              }
            }
          })
          .catch((err) => {
            themed.delete(target.webSocketDebuggerUrl)
            log(`Failed to connect to a window: ${err.message}`)
          })
      }
    } catch {
      /* the app is not ready yet or just closed */
    }
  }

  timer = setInterval(async () => {
    try {
      await tick()
    } catch {
      /* keep polling */
    }
  }, 800)
  tick()

  return {
    stop() {
      stopped = true
      clearInterval(timer)
      for (const client of clients) client.close()
      clients.clear()
    },
    get connectedCount() {
      return clients.size
    },
  }
}
