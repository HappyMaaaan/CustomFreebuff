#!/usr/bin/env node
/**
 * scripts/sign-exe.mjs — Signs dist/CustomFreebuff.exe with a Windows code
 * signing certificate, using signtool from the Windows SDK.
 *
 * Certificate sources (first one set wins):
 *   1. CODESIGN_PFX_BASE64   — the .pfx file encoded as base64 (safe for CI
 *                              secrets; see the GitHub Actions workflow),
 *   2. CODESIGN_PFX_PATH     — path to a .pfx file on disk,
 *   3. CODESIGN_THUMBPRINT   — SHA-1 thumbprint of a code-signing certificate
 *                              already in the CurrentUser\My store.
 * CODESIGN_PFX_PASSWORD     — password for a protected .pfx file.
 *
 * Flags:
 *   --self-signed  generate a throwaway self-signed certificate and sign with
 *                  it, so you can watch the whole pipeline work end to end.
 *                  This does NOT remove the SmartScreen warning — only a
 *                  certificate from a trusted CA (plus download reputation)
 *                  does that.
 *   --require      fail instead of skipping when no certificate is configured.
 *
 * Usage: node scripts/sign-exe.mjs [--self-signed] [--require]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const EXE = path.join(ROOT, 'dist', 'CustomFreebuff.exe')
const REPO_URL = 'https://github.com/HappyMaaaan/CustomFreebuff'
const TIMESTAMP_URL = 'http://timestamp.digicert.com'

const args = process.argv.slice(2)
const selfSigned = args.includes('--self-signed')
const requireCert = args.includes('--require')

function findSigntool() {
  if (process.platform !== 'win32') return null
  // Highest Windows SDK version first.
  const kitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  let found = []
  try {
    for (const ver of fs.readdirSync(kitsRoot)) {
      const p = path.join(kitsRoot, ver, 'x64', 'signtool.exe')
      if (fs.existsSync(p)) found.push(p)
    }
  } catch {
    /* not installed */
  }
  if (found.length) {
    found.sort((a, b) => {
      const va = path.basename(path.dirname(path.dirname(a))).split('.').map(Number)
      const vb = path.basename(path.dirname(path.dirname(b))).split('.').map(Number)
      for (let i = 0; i < 4; i++) {
        if ((va[i] || 0) !== (vb[i] || 0)) return (vb[i] || 0) - (va[i] || 0)
      }
      return 0
    })
    return found[0]
  }
  // Fall back to PATH.
  const onPath = spawnSync('where', ['signtool'], { encoding: 'utf8' })
  if (onPath.status === 0 && onPath.stdout.trim()) {
    const p = onPath.stdout.trim().split(/\r?\n/)[0]
    if (fs.existsSync(p)) return p
  }
  return null
}

function makeSelfSignedPfx() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-sign-'))
  const pfx = path.join(tmpDir, 'test.pfx')
  const ps = `
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=CustomFreebuff (self-signed test)" -CertStoreLocation Cert:\\CurrentUser\\My -KeyUsage DigitalSignature -KeyExportPolicy Exportable -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
$pwd = ConvertTo-SecureString -String "test" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "${pfx}" -Password $pwd | Out-Null
Write-Output $cert.Thumbprint
`
  const res = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  if (res.status !== 0 || !fs.existsSync(pfx)) {
    console.error('Could not create a self-signed certificate.')
    console.error(res.stderr || res.stdout)
    process.exit(1)
  }
  return { pfx, thumbprint: res.stdout.trim().split(/\r?\n/).pop() }
}

function sign(signtool, args) {
  console.log(`\n==> Signing ${path.relative(ROOT, EXE)}`)
  const res = spawnSync(signtool, args, { encoding: 'utf8' })
  if (res.status !== 0) {
    console.error(res.stdout || res.stderr)
    console.error('Signing failed.')
    process.exit(1)
  }
  console.log(res.stdout)
}

function verify(signtool) {
  console.log('==> Verifying signature')
  const res = spawnSync(signtool, ['verify', '/pa', '/v', EXE], { encoding: 'utf8' })
  if (res.status !== 0) {
    console.error(res.stdout || res.stderr)
    console.error('Verification failed — the signature is NOT valid.')
    process.exit(1)
  }
  console.log(res.stdout.split(/\r?\n/).slice(0, 12).join('\n'))
  return res.stdout
}

if (!fs.existsSync(EXE)) {
  console.error('dist/CustomFreebuff.exe not found. Run `node scripts/build-exe.mjs` first.')
  process.exit(1)
}

const signtool = findSigntool()
if (!signtool) {
  console.error('signtool not found. Install the Windows SDK (or set PATH to signtool.exe).')
  process.exit(1)
}
console.log(`signtool: ${signtool}`)

// --- pick a certificate source -----------------------------------------
let tmpPfx = null
let cleanupCert = null
let source = null

if (selfSigned) {
  console.log('\nSelf-signed mode: generating a throwaway certificate…')
  const made = makeSelfSignedPfx()
  tmpPfx = made.pfx
  cleanupCert = made.thumbprint
  source = { kind: 'pfx', path: tmpPfx, password: 'test' }
} else if (process.env.CODESIGN_PFX_BASE64) {
  tmpPfx = path.join(os.tmpdir(), `fb-codesign-${Date.now()}.pfx`)
  fs.writeFileSync(tmpPfx, Buffer.from(process.env.CODESIGN_PFX_BASE64, 'base64'))
  source = { kind: 'pfx', path: tmpPfx, password: process.env.CODESIGN_PFX_PASSWORD || '' }
} else if (process.env.CODESIGN_PFX_PATH) {
  if (!fs.existsSync(process.env.CODESIGN_PFX_PATH)) {
    console.error(`CODESIGN_PFX_PATH does not exist: ${process.env.CODESIGN_PFX_PATH}`)
    process.exit(1)
  }
  source = { kind: 'pfx', path: process.env.CODESIGN_PFX_PATH, password: process.env.CODESIGN_PFX_PASSWORD || '' }
} else if (process.env.CODESIGN_THUMBPRINT) {
  source = { kind: 'store', thumbprint: process.env.CODESIGN_THUMBPRINT }
}

if (!source) {
  const msg =
    'No certificate configured (CODESIGN_PFX_BASE64 / CODESIGN_PFX_PATH / CODESIGN_THUMBPRINT).\n' +
    'Skipping the signing step. Use --self-signed to test the pipeline with a throwaway cert.'
  if (requireCert) {
    console.error(msg)
    process.exit(1)
  }
  console.log(`\n${msg}`)
  process.exit(0)
}

// --- sign ---------------------------------------------------------------
const common = ['sign', '/fd', 'SHA256', '/tr', TIMESTAMP_URL, '/td', 'SHA256', '/d', 'CustomFreebuff', '/du', REPO_URL]
if (source.kind === 'pfx') {
  const withPwd = source.password ? ['/f', source.path, '/p', source.password] : ['/f', source.path]
  sign(signtool, [...common, ...withPwd, EXE])
} else {
  sign(signtool, [...common, '/sha1', source.thumbprint, EXE])
}

const output = verify(signtool)
const trusted = /Signing Certificate Chain:\s*Issued to:/.test(output) && /Verified:/.test(output)

// --- report -------------------------------------------------------------
if (selfSigned) {
  console.log('\n⚠️  Signed with a SELF-SIGNED certificate. This only proves the pipeline works.')
  console.log('   SmartScreen will still warn: Windows does not trust a self-made certificate.')
} else if (trusted) {
  console.log('\n✅ Signature is valid and chains to a trusted root.')
  console.log('   Note: SmartScreen also uses download reputation. For a brand-new publisher the')
  console.log('   warning can still appear for a while, until enough people download and run the')
  console.log('   exe without issues. It will disappear on its own as reputation builds.')
} else {
  console.log('\n⚠️  Signature verified, but the chain does not end at a trusted root.')
  console.log('   SmartScreen will keep warning. Use a certificate from a trusted CA.')
}

// --- cleanup ------------------------------------------------------------
try {
  if (tmpPfx) fs.rmSync(path.dirname(tmpPfx), { recursive: true, force: true })
} catch {
  /* best-effort */
}
if (cleanupCert) {
  spawnSync('powershell', ['-NoProfile', '-Command', `Remove-Item "Cert:\\CurrentUser\\My\\${cleanupCert}" -ErrorAction SilentlyContinue`])
}
