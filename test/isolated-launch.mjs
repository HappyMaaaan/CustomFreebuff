/**
 * test/isolated-launch.mjs — launch an ISOLATED Freebuff instance with our
 * exact launch method (debug port flag, detached spawn) but a separate
 * Chromium profile + orchestrator state, so the single-instance lock and the
 * profile lock of any live instance cannot interfere.
 *
 * Answers: does `Freebuff.exe --remote-debugging-port=N` produce a visible
 * window at all? We then kill the test instance and clean up.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findFreebuff } from '../lib/launcher.mjs'

const EXE = findFreebuff()
if (!EXE) {
  console.error('Freebuff not found')
  process.exit(1)
}

const PORT = 9334
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-isolated-'))
const userDataDir = path.join(tmpRoot, 'profile')
const stateFile = path.join(tmpRoot, 'state.json')
fs.mkdirSync(userDataDir, { recursive: true })

console.log('EXE        :', EXE)
console.log('profile    :', userDataDir)
console.log('state file :', stateFile)

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: {
    ...process.env,
    FREEBUFF_DESKTOP_STATE_PATH: stateFile,
  },
})
console.log('spawned pid:', child.pid)
if (child.unref) child.unref()

// Poll for CDP + window presence over ~25s.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let cdpUp = false
let windows = []
for (let i = 0; i < 25; i++) {
  await sleep(1000)
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    if (res.ok) {
      cdpUp = true
      console.log(`t+${i + 1}s: CDP is UP on ${PORT}`)
    }
  } catch { /* not yet */ }
  if (cdpUp) {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
    windows = list.filter((t) => t.type === 'page').map((t) => t.title || t.url)
    if (windows.length) {
      console.log(`t+${i + 1}s: page targets:`, windows)
      break
    }
  }
}

console.log('--- final state ---')
console.log('CDP up      :', cdpUp)
console.log('page targets:', windows.length ? windows : 'NONE')

// Also check the Chromium DevToolsActivePort of the test profile.
const portFile = path.join(userDataDir, 'DevToolsActivePort')
console.log('DevToolsActivePort:', fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').trim().replace(/\n/g, ' | ') : '(absent)')

// Cleanup: kill the whole detached tree.
console.log('--- cleanup ---')
spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
await sleep(2000)
fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log('done')
