/** Shared helpers for scripts/build-exe.mjs and scripts/build-mac.mjs. */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Locates the Bun binary, in order:
 *  1. the BUN environment variable,
 *  2. `bun` on PATH,
 *  3. the bun binary bundled with Freebuff Desktop. */
export function findBun() {
  if (process.env.BUN && fs.existsSync(process.env.BUN)) return process.env.BUN
  // bun on PATH
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bun'], { encoding: 'utf8' })
  if (onPath.status === 0 && onPath.stdout.trim()) {
    const p = onPath.stdout.trim().split(/[\r\n]+/)[0]
    if (fs.existsSync(p)) return p
  }
  // bun bundled with Freebuff Desktop
  const candidates = []
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop', 'Freebuff Desktop', 'resources', 'bun', 'bun.exe'),
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Freebuff', 'resources', 'bun', 'bun.exe'),
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Freebuff.app/Contents/Resources/bun/bun',
      path.join(os.homedir(), 'Applications', 'Freebuff.app', 'Contents', 'Resources', 'bun', 'bun'),
    )
  } else {
    candidates.push('/opt/Freebuff/resources/bun/bun', path.join(os.homedir(), '.local', 'bin', 'bun'))
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

export function step(label) {
  console.log(`\n==> ${label}`)
}
