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
import path from 'node:path'

import { ROOT, findBun, step } from './build-common.mjs'

const DIST = path.join(ROOT, 'dist')
const OUT = path.join(DIST, 'CustomFreebuff.exe')
const ICON = path.join(ROOT, 'build', 'icon.ico')
const EMBEDDED = path.join(ROOT, 'lib', 'embedded-assets.mjs')

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
// --windows-hide-console: the exe is a GUI-subsystem app (PE Subsystem 2), so
// double-clicking it shows ONLY the little launcher window — no terminal/console
// window behind it. (--windows-gui does not exist in this Bun; it was silently
// ignored and produced a console-subsystem exe.)
const result = spawnSync(
  bun,
  ['build', 'themer.mjs', '--compile', '--minify', '--outfile', OUT, '--icon', ICON, '--windows-hide-console'],
  { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' },
)
if (result.status !== 0) {
  console.error('Build failed.')
  cleanup()
  process.exit(result.status ?? 1)
}

step('Hiding the console (PE subsystem CUI -> GUI)')
// Bun 1.3.14 accepts --windows-hide-console but does NOT apply it: the
// compiled exe is still a console-subsystem binary, so double-clicking it
// opens a terminal window. Fix it deterministically by patching the PE
// header: Subsystem field at optional-header offset 68 (3 = CUI/console,
// 2 = GUI/no console). Windows uses this byte to decide whether to create
// a console — the app itself is unaffected.
{
  const bin = fs.readFileSync(OUT)
  const peOff = bin.readUInt32LE(0x3c) // e_lfanew
  const subOff = peOff + 24 + 68 // optional header + Subsystem
  const subsystem = bin.readUInt16LE(subOff)
  if (subsystem === 3) {
    bin.writeUInt16LE(2, subOff)
    fs.writeFileSync(OUT, bin)
    console.log('  Patched PE subsystem: 3 (console) -> 2 (GUI). No terminal on double-click.')
  } else {
    console.log(`  Already GUI subsystem (${subsystem}) — nothing to do.`)
  }
}

const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0)
console.log(`\nDone. dist/CustomFreebuff.exe (${sizeKb} kB) — double-click it, no Node needed.`)

cleanup()

function cleanup() {
  // The embedded module is generated per build; keep the repo clean.
  fs.rmSync(EMBEDDED, { force: true })
}
