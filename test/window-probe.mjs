/**
 * test/window-probe.mjs — launch an ISOLATED Freebuff and probe the real
 * window state through CDP: visibility, position, size. This distinguishes
 * "the window does not exist" from "the window exists but is not visible".
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findFreebuff } from '../lib/launcher.mjs'
import { bringAppWindowToFront, listTargets, probeAppWindowState } from '../lib/cdp.mjs'

const EXE = findFreebuff()
if (!EXE) {
  console.error('Freebuff not found')
  process.exit(1)
}

const PORT = 9335
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-probe-'))
const userDataDir = path.join(tmpRoot, 'profile')
const stateFile = path.join(tmpRoot, 'state.json')
fs.mkdirSync(userDataDir, { recursive: true })

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, FREEBUFF_DESKTOP_STATE_PATH: stateFile },
})
if (child.unref) child.unref()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wait for a page target.
let target = null
for (let i = 0; i < 30; i++) {
  await sleep(1000)
  try {
    const targets = await listTargets(PORT)
    target = targets.find((t) => t.type === 'page') || null
    if (target) break
  } catch { /* not yet */ }
}

if (!target) {
  console.log('No page target appeared.')
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  process.exit(0)
}

const probe = await probeAppWindowState(PORT)
console.log('probeAppWindowState:', JSON.stringify(probe))

// Simulate an off-screen window, then check bringAppWindowToFront recovers it.
const moveAway = await import('../lib/cdp.mjs').then((m) => m.CdpClient.connect(target.webSocketDebuggerUrl))
await moveAway.send('Runtime.evaluate', { expression: `window.moveTo(4000, 4000); 'moved away'`, returnByValue: true })
await sleep(800)
moveAway.close()

console.log('Probe after moving off-screen:')
console.log('  ', JSON.stringify(await probeAppWindowState(PORT)))

const fix = await bringAppWindowToFront(PORT)
console.log('bringAppWindowToFront:', JSON.stringify(fix))
console.log('Probe after fix:')
console.log('  ', JSON.stringify(await probeAppWindowState(PORT)))

spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
await sleep(1500)
fs.rmSync(tmpRoot, { recursive: true, force: true })
console.log('done')
