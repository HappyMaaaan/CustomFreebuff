#!/usr/bin/env node
/**
 * scripts/gh-release.mjs — Creates a GitHub release and uploads
 * dist/FreebuffThemer.exe as the download asset.
 *
 * The GitHub token comes from the GITHUB_TOKEN environment variable or from
 * Git Credential Manager (the credentials already stored on this machine).
 * The token is never printed.
 *
 * Usage: node scripts/gh-release.mjs [tag]
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const ASSET = path.join(ROOT, 'dist', 'FreebuffThemer.exe')
const REPO = 'HappyMaaaan/CustomFreebuff'
const TAG = process.argv[2] || 'v1.0.0'

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  // Ask Git Credential Manager for the stored github.com credential.
  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  })
  if (res.status !== 0) return null
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith('password=')) return line.slice('password='.length)
  }
  return null
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { authorization: `Bearer ${token}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json }
}

async function ensureTag() {
  const hasLocal = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${TAG}`], { cwd: ROOT, encoding: 'utf8' }).status === 0
  if (!hasLocal) {
    const tag = spawnSync('git', ['tag', TAG], { cwd: ROOT, encoding: 'utf8' })
    if (tag.status !== 0) throw new Error(`could not create tag: ${tag.stderr}`)
    console.log(`Tag ${TAG} created locally.`)
  }
  spawnSync('git', ['push', 'origin', TAG], { cwd: ROOT, encoding: 'utf8' })
  console.log(`Tag ${TAG} is on GitHub.`)
}

async function findRelease(token, tag) {
  const { status, json } = await api(`/repos/${REPO}/releases/tags/${tag}`, { token })
  if (status === 200 && json) return { id: json.id, uploadUrl: json.upload_url, url: json.html_url }
  return null
}

async function createRelease(token, tag) {
  const notes = [
    '## Freebuff Themer v1.0.0',
    '',
    'A small theme studio for Freebuff Desktop: pick a theme (or write your own CSS) and it is applied live to the app — display only.',
    '',
    '### What is in the box',
    '',
    '- **FreebuffThemer.exe** — standalone Windows executable. Double-click it: no Node.js, nothing to install.',
    '',
    '### How to use',
    '',
    '1. Close Freebuff if it is already open.',
    '2. Run FreebuffThemer.exe — your browser opens the theme studio.',
    '3. Click **Launch Freebuff with theming**, then pick a theme.',
    '',
    '### Notes',
    '',
    '- Display only: no file of the Freebuff installation is modified, nothing is bypassed, everything is reversible.',
    '- The executable is not code-signed, so Windows SmartScreen may show a warning the first time.',
    '',
    'Source: https://github.com/titi62410/CustomFreebuff',
  ].join('\n')

  const { status, json } = await api(`/repos/${REPO}/releases`, {
    method: 'POST',
    token,
    body: {
      tag_name: tag,
      name: `Freebuff Themer ${tag}`,
      body: notes,
      draft: false,
      prerelease: false,
    },
  })
  if (status !== 201) throw new Error(`release creation failed (HTTP ${status}): ${JSON.stringify(json)}`)
  return { id: json.id, uploadUrl: json.upload_url, url: json.html_url }
}

async function uploadAsset(token, release) {
  const data = fs.readFileSync(ASSET)
  const uploadUrl = release.uploadUrl.replace('{?name,label}', '')
  const target = `${uploadUrl}?name=${encodeURIComponent('FreebuffThemer.exe')}&label=${encodeURIComponent('Freebuff Themer (Windows x64)')}`

  // GitHub redirects to a signed upload URL. Manual redirect keeps the POST
  // method and the body (automatic redirect would turn it into a GET).
  const res = await fetch(target, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: data,
    redirect: 'manual',
  })

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    if (!location) throw new Error('upload redirect without Location header')
    const res2 = await fetch(location, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: data,
    })
    if (res2.status !== 201) {
      throw new Error(`asset upload failed after redirect (HTTP ${res2.status}): ${await res2.text()}`)
    }
    const json = await res2.json()
    return json.browser_download_url
  }

  if (res.status !== 201) throw new Error(`asset upload failed (HTTP ${res.status}): ${await res.text()}`)
  const json = await res.json()
  return json.browser_download_url
}

if (!fs.existsSync(ASSET)) {
  console.error('dist/FreebuffThemer.exe not found. Run `node scripts/build-exe.mjs` first.')
  process.exit(1)
}

const token = getToken()
if (!token) {
  console.error('No GitHub credentials found (GITHUB_TOKEN env or git credential manager).')
  process.exit(1)
}

console.log(`Releasing ${TAG} -> ${REPO}`)
await ensureTag()

let release = await findRelease(token, TAG)
if (release) {
  console.log('Release already exists, uploading the asset to it.')
} else {
  release = await createRelease(token, TAG)
  console.log('Release created.')
}

const downloadUrl = await uploadAsset(token, release)
console.log('')
console.log(`Done. Release: ${release.url}`)
console.log(`Asset: ${downloadUrl}`)
