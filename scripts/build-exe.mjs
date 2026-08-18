#!/usr/bin/env node
/**
 * scripts/build-exe.mjs — Builds a standalone Windows .exe for the theme
 * studio, so it can be double-clicked without Node installed.
 *
 * Uses Bun's `build --compile`. The bun binary is looked up, in order:
 *   1. the BUN environment variable,
 *   2. `bun` on PATH,
 *   3. the bun binary bundled with Freebuff Desktop.
 *
 * Usage: node scripts/build-exe.mjs
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(DIST, 'FreebuffThemer.exe')
const ICON = path.join(ROOT, 'build', 'icon.ico')
const EMBEDDED = path.join(ROOT, 'lib', 'embedded-assets.mjs')

function findBun() {
  if (process.env.BUN && fs.existsSync(process.env.BUN)) return process.env.BUN
  // bun on PATH
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bun'], { encoding: 'utf8' })
  if (onPath.status === 0 && onPath.stdout.trim()) {
    const p = onPath.stdout.trim().split(/\r?\n/)[0]
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

function step(label) {
  console.log(`\n==> ${label}`)
}

const bun = findBun()
if (!bun) {
  console.error('Bun was not found. Install it (https://bun.sh) or set the BUN environment variable.')
  process.exit(1)
}
console.log(`Bun: ${bun}`)

step('Generating embedded assets (lib/embedded-assets.mjs)')
await import('./build-embed.mjs')

step('Ensuring icon (build/icon.ico)')
if (!fs.existsSync(ICON)) {
  await import('./make-icon.mjs')
} else {
  console.log('  (already present)')
}

step(`Compiling standalone executable -> ${path.relative(ROOT, OUT)}`)
fs.mkdirSync(DIST, { recursive: true })
const result = spawnSync(
  bun,
  ['build', 'themer.mjs', '--compile', '--minify', '--outfile', OUT, '--icon', ICON],
  { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' },
)
if (result.status !== 0) {
  console.error('Build failed.')
  cleanup()
  process.exit(result.status ?? 1)
}

const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0)
console.log(`\nDone. dist/FreebuffThemer.exe (${sizeKb} kB) — double-click it, no Node needed.`)

cleanup()

function cleanup() {
  // The embedded module is generated per build; keep the repo clean.
  fs.rmSync(EMBEDDED, { force: true })
}
