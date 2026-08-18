/**
 * lib/launcher.mjs — Freebuff Desktop discovery, process detection, and launch.
 *
 * Launching is done with --remote-debugging-port=<port>: a standard Chromium
 * switch (the same mechanism as DevTools), accepted as-is by Electron.
 * No file of the application is modified: no asar, no resources, no system
 * shortcut. Launching Freebuff without this flag gives the strict original.
 */

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const EXE_NAME = process.platform === 'win32' ? 'Freebuff.exe' : 'Freebuff'

/** Likely install locations, most common first. */
export function candidateInstallPaths() {
  const candidates = []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    const pf = process.env['ProgramFiles']
    const pf86 = process.env['ProgramFiles(x86)']
    const roots = [local && path.join(local, 'Programs'), pf, pf86].filter(Boolean)
    for (const root of roots) {
      candidates.push(path.join(root, '@codebufffreebuff-desktop', 'Freebuff Desktop', EXE_NAME))
      candidates.push(path.join(root, '@codebufffreebuff-desktop', EXE_NAME))
      candidates.push(path.join(root, 'Freebuff', EXE_NAME))
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Freebuff.app/Contents/MacOS/Freebuff')
    candidates.push(path.join(os.homedir(), 'Applications', 'Freebuff.app', 'Contents', 'MacOS', 'Freebuff'))
  } else {
    candidates.push('/opt/Freebuff/Freebuff')
    candidates.push('/usr/bin/Freebuff')
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'Freebuff'))
  }
  return candidates
}

/** Path to the Freebuff executable, or null. Priority:
 *  1. FREEBUFF_EXE environment variable,
 *  2. config override (manually entered path),
 *  3. known install locations. */
export function findFreebuff(configOverride = null) {
  if (process.env.FREEBUFF_EXE && fs.existsSync(process.env.FREEBUFF_EXE)) {
    return process.env.FREEBUFF_EXE
  }
  if (configOverride && fs.existsSync(configOverride)) {
    return configOverride
  }
  for (const candidate of candidateInstallPaths()) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/* ---------------------------------------------------------------- */
/* Process detection                                                 */
/*                                                                   */
/* A Freebuff.exe in Task Manager is NOT necessarily the app: GPU,   */
/* utility and crashpad helpers show up too, and they can linger     */
/* after the app closed. "Running" means a process with a real       */
/* window — that is the instance that holds the UI and the           */
/* single-instance lock.                                             */
/* ---------------------------------------------------------------- */

function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else cur += ch
  }
  fields.push(cur)
  return fields
}

function listWindowsProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/V', '/FO', 'CSV', '/FI', `IMAGENAME eq ${EXE_NAME}`], (err, stdout) => {
      if (err) return resolve([])
      const rows = []
      for (const line of stdout.split(/\r?\n/).slice(1)) {
        if (!line.trim()) continue
        const fields = parseCsvLine(line)
        // Image Name, PID, ..., Window Title
        if (fields.length < 9 || !/Freebuff\.exe/i.test(fields[0] || '')) continue
        const title = (fields[8] || '').trim()
        rows.push({ pid: Number(fields[1]), hasWindow: title !== '' && title.toUpperCase() !== 'N/A' })
      }
      resolve(rows)
    })
  })
}

function listUnixProcesses() {
  return new Promise((resolve) => {
    execFile('pgrep', ['-x', EXE_NAME], (err, stdout) => {
      if (err) return resolve([])
      const pids = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((n) => Number(n))
      resolve(pids.map((pid) => ({ pid, hasWindow: true })))
    })
  })
}

/**
 * Freebuff's Bun orchestrator processes (the ones that hold the desktop-state
 * profile lock). Identified by their executable path: the bun.exe shipped in
 * the app's resources\bun folder. A leftover orchestrator from a dead session
 * makes the next launch fail with "Another Freebuff orchestrator is already
 * using this Desktop state profile" — so it must be cleaned up too.
 */
function listOrchestratorProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([])
    execFile('wmic', ['process', 'where', "name='bun.exe'", 'get', 'ProcessId,ExecutablePath', '/format:list'], (err, stdout) => {
      if (err) return resolve([])
      const rows = []
      let cur = {}
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^(\w+)=(.*)$/)
        if (!m) continue
        if (m[1] === 'ProcessId') {
          cur = { pid: Number(m[2]) }
          rows.push(cur)
        } else if (m[1] === 'ExecutablePath') {
          cur.path = m[2]
        }
      }
      const isFreebuffBun = (p) => p.path && /resources[\\/]bun[\\/]bun\.exe$/i.test(p.path.trim())
      resolve(rows.filter(isFreebuffBun).map((p) => ({ pid: p.pid, kind: 'orchestrator' })))
    })
  })
}

/** Detailed view of the running Freebuff processes. */
export async function freebuffProcessInfo() {
  const processes = process.platform === 'win32' ? await listWindowsProcesses() : await listUnixProcesses()
  const running = processes.some((p) => p.hasWindow)
  const staleCount = processes.filter((p) => !p.hasWindow).length
  if (!running) {
    // No live instance: leftover orchestrators count as stale too.
    const orchestrators = await listOrchestratorProcesses()
    return { running, staleCount: staleCount + orchestrators.length, total: processes.length + orchestrators.length, orchestrators }
  }
  return { running, staleCount, total: processes.length, orchestrators: [] }
}

/** Is a real (windowed) Freebuff instance running? */
export async function isRunning() {
  return (await freebuffProcessInfo()).running
}

/**
 * Removes leftover Freebuff processes from a previous session that did not
 * fully exit: windowless Freebuff.exe helpers AND the orphaned Bun
 * orchestrator (which holds the desktop-state profile lock).
 * Never touches a running instance: if any process has a window, nothing is
 * killed. Returns the number of processes removed.
 */
export async function killStaleProcesses() {
  if (process.platform !== 'win32') return 0
  const rows = await listWindowsProcesses()
  if (rows.some((p) => p.hasWindow)) return 0 // a real instance is running
  let killed = 0
  for (const row of rows) {
    if (row.hasWindow) continue
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(row.pid), '/F'], (err) => {
        if (!err) killed++
        resolve()
      })
    })
  }
  const orchestrators = await listOrchestratorProcesses()
  for (const o of orchestrators) {
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(o.pid), '/F'], (err) => {
        if (!err) killed++
        resolve()
      })
    })
  }
  return killed
}

/**
 * Launches Freebuff Desktop with the debug port. The app is detached: it
 * survives the studio closing (it is the normal user app).
 * If a real instance is already running, it will NOT be relaunched
 * (Electron's single-instance lock) — the caller reports that instead.
 */
export function launchFreebuff(exePath, debugPort) {
  const args = [`--remote-debugging-port=${debugPort}`]
  const child = spawnDetached(exePath, args)
  if (!child) {
    throw new Error(`Could not launch ${exePath}`)
  }
  return child
}

function spawnDetached(exePath, args) {
  const opts = {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }
  const child = spawn(exePath, args, opts)
  child.on('error', () => {})
  if (child.unref) child.unref()
  return child
}

/** Freebuff's native theme preference file (read-only). */
export function nativeThemeFile() {
  let dir
  if (process.platform === 'win32') dir = path.join(process.env.APPDATA || '', 'Freebuff')
  else if (process.platform === 'darwin')
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'Freebuff')
  else dir = path.join(os.homedir(), '.config', 'Freebuff')
  return path.join(dir, 'theme')
}

/** Current native theme preference ('dark' | 'light' | 'system' | null). */
export function readNativeThemePref() {
  try {
    const raw = fs.readFileSync(nativeThemeFile(), 'utf8').trim()
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    /* no preference saved yet */
  }
  return null
}

/** The studio's own config directory (ours, never Freebuff's). */
export function themerConfigDir() {
  const base = process.env.FREEBUFF_THEMER_CONFIG_DIR
  if (base) return base
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'freebuff-themer')
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'freebuff-themer')
  return path.join(os.homedir(), '.config', 'freebuff-themer')
}
