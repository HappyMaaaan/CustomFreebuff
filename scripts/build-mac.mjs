#!/usr/bin/env node
/**
 * scripts/build-mac.mjs — Builds a double-clickable macOS app from the theme
 * studio and zips it for download:
 *
 *   dist/CustomFreebuff-mac-arm64.zip   (Apple Silicon)
 *   dist/CustomFreebuff-mac-x64.zip     (Intel)
 *
 * Each zip contains a proper `CustomFreebuff.app` bundle (Info.plist, icon,
 * single executable) — no Node, no terminal, no commands: unzip, drag to
 * Applications, double-click.
 *
 * Works two ways:
 *   - ON macOS: compiles natively for the current machine and ad-hoc
 *     code-signs the bundle (codesign -s -). Use `ditto` for the zip when
 *     available, so Finder extraction is flawless.
 *   - ELSEWHERE: cross-compiles with Bun (--target=bun-darwin-<arch>), which
 *     produces genuine Mach-O binaries from any host. The zip is written by
 *     the small built-in writer below, which stores the unix permissions
 *     (executable bit) in the zip attributes — macOS restores them on
 *     extraction.
 *
 * Usage:
 *   node scripts/build-mac.mjs          # both architectures (arm64 + x64)
 *   node scripts/build-mac.mjs arm64    # one architecture
 *
 * Note: like the Windows exe, the app is NOT notarized (no Apple Developer
 * account), so the first launch shows Gatekeeper's "developer cannot be
 * verified" — right-click the app → Open → confirm, exactly like the
 * SmartScreen flow on Windows. Only a Developer ID certificate + notarization
 * removes that.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { ROOT, findBun, step } from './build-common.mjs'

const DIST = path.join(ROOT, 'dist')
const ICNS = path.join(ROOT, 'build', 'icon.icns')
const EMBEDDED = path.join(ROOT, 'lib', 'embedded-assets.mjs')
const TMP = path.join(DIST, '.mac-tmp')

const APP_NAME = 'CustomFreebuff'
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/* ---------------------------------------------------------------- */
/* Zip writer (no external tools): stores unix modes so the          */
/* executable bit survives extraction on macOS.                      */
/* ---------------------------------------------------------------- */

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  return { time, date }
}

/** Creates a zip containing `entries`: [{ name, data, mode }]. */
function makeZip(entries) {
  const { time, date } = dosDateTime()
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data) >>> 0
    const deflated = zlib.deflateRawSync(e.data, { level: 6 })
    const method = deflated.length < e.data.length ? 8 : 0
    const data = method === 8 ? deflated : e.data

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // version needed
    lh.writeUInt16LE(0x0800, 6) // UTF-8 names
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(time, 10)
    lh.writeUInt16LE(date, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18) // compressed size
    lh.writeUInt32LE(e.data.length, 22) // uncompressed size
    lh.writeUInt16LE(name.length, 26) // filename length
    lh.writeUInt16LE(0, 28) // extra length
    localParts.push(lh, name, data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(0x0314, 4) // made by: unix (3), version 2.0
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt16LE(time, 12)
    ch.writeUInt16LE(date, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(e.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(0, 30)
    ch.writeUInt16LE(0, 32)
    ch.writeUInt16LE(0, 34)
    ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38) // external attrs: unix file + mode
    ch.writeUInt32LE(offset, 42)
    centralParts.push(ch, name)
    offset += lh.length + name.length + data.length
  }
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, eocd])
}

/* ---------------------------------------------------------------- */
/* .app bundle                                                       */
/* ---------------------------------------------------------------- */

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>CustomFreebuff</string>
  <key>CFBundleIdentifier</key>
  <string>app.customfreebuff.themer</string>
  <key>CFBundleVersion</key>
  <string>${pkg.version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${pkg.version}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>CustomFreebuff — theme studio for Freebuff Desktop</string>
</dict>
</plist>
`
}

function adhocSign(appPath) {
  const res = spawnSync('codesign', ['--force', '--sign', '-', appPath], { encoding: 'utf8' })
  if (res.status === 0) {
    console.log('  Ad-hoc signed (codesign -s -).')
  } else {
    console.warn(`  codesign skipped: ${String(res.stderr || res.stdout).trim()}`)
  }
}

/** Builds one architecture. `cross` selects --target=bun-darwin-<arch>. */
function buildArch(bun, arch, cross) {
  step(`Compiling macOS ${arch} executable`)
  const appDir = path.join(TMP, `${APP_NAME}.app`)
  const macosDir = path.join(appDir, 'Contents', 'MacOS')
  const resDir = path.join(appDir, 'Contents', 'Resources')
  fs.mkdirSync(macosDir, { recursive: true })
  fs.mkdirSync(resDir, { recursive: true })

  const binary = path.join(macosDir, APP_NAME)
  const args = ['build', 'themer.mjs', '--compile', '--minify', '--outfile', binary]
  if (cross) args.push(`--target=bun-darwin-${arch}`)
  const result = spawnSync(bun, args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`macOS ${arch} build failed.`)

  fs.chmodSync(binary, 0o755)
  fs.writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), infoPlist())
  fs.copyFileSync(ICNS, path.join(resDir, 'icon.icns'))

  if (process.platform === 'darwin') {
    step(`Ad-hoc signing ${APP_NAME}-${arch}.app`)
    adhocSign(appDir)
  }

  step(`Zipping ${APP_NAME}-${arch}.app`)
  const zipPath = path.join(DIST, `${APP_NAME}-mac-${arch}.zip`)
  const onMac = process.platform === 'darwin'
  if (onMac) {
    // ditto (macOS-native) preserves permissions, symlinks and xattrs; the
    // built-in writer below is the fallback for cross-compiled builds.
    const ditto = spawnSync('ditto', ['-c', '-k', '--keepParent', appDir, zipPath], { encoding: 'utf8' })
    if (ditto.status !== 0) throw new Error(`ditto failed: ${ditto.stderr}`)
  } else {
    const root = path.basename(appDir)
    const entries = []
    const collect = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        const rel = path.join(root, path.relative(appDir, full))
        const st = fs.statSync(full)
        if (st.isDirectory()) {
          collect(full)
        } else {
          // Host filesystems (especially Windows) do not model unix modes, so
          // the mode comes from the bundle layout: the executable is the file
          // under Contents/MacOS, everything else is a plain data file.
          const name = rel.split(path.sep).join('/')
          const mode = name.includes('/Contents/MacOS/') ? 0o755 : 0o644
          entries.push({ name, data: fs.readFileSync(full), mode })
        }
      }
    }
    collect(appDir)
    fs.writeFileSync(zipPath, makeZip(entries))
  }
  const kb = (fs.statSync(zipPath).size / 1024).toFixed(0)
  console.log(`  -> ${path.relative(ROOT, zipPath)} (${kb} kB)`)
}

/* ---------------------------------------------------------------- */
/* Main                                                              */
/* ---------------------------------------------------------------- */

const bun = findBun()
if (!bun) {
  console.error('Bun was not found. Install it (https://bun.sh) or set the BUN environment variable.')
  process.exit(1)
}
console.log(`Bun: ${bun}`)

step('Generating embedded assets (lib/embedded-assets.mjs)')
await import('./build-embed.mjs')

step('Ensuring icon (build/icon.icns)')
if (!fs.existsSync(ICNS)) {
  await import('./make-icon.mjs')
} else {
  console.log('  (already present)')
}

// Architecture selection. On macOS, build for the machine you are on; from
// anywhere else, cross-compile both variants (the CI workflow does this).
const onMac = process.platform === 'darwin'
let arches
if (onMac) {
  arches = [process.arch === 'x64' ? 'x64' : 'arm64']
  console.log(`  Native build for ${arches[0]}.`)
} else {
  const asked = process.argv.slice(2)
  arches = asked.length === 0 || asked.includes('all') ? ['arm64', 'x64'] : asked.filter((a) => a === 'arm64' || a === 'x64')
  if (arches.length === 0) {
    console.error('Usage: node scripts/build-mac.mjs [arm64|x64|all]')
    process.exit(1)
  }
  console.log(`  Cross-compiling for: ${arches.join(', ')}`)
}

fs.mkdirSync(DIST, { recursive: true })
try {
  for (const arch of arches) {
    buildArch(bun, arch, !onMac)
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true })
  // The embedded module is generated per build; keep the repo clean.
  fs.rmSync(EMBEDDED, { force: true })
}

console.log('\nDone. The macOS apps are ready in dist/ — unzip, drag to Applications, double-click.')
