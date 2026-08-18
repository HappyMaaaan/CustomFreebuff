#!/usr/bin/env node
/**
 * scripts/gh-release.mjs — Creates a GitHub release and uploads
 * dist/CustomFreebuff.exe as the download asset.
 *
 * The GitHub token comes from the GITHUB_TOKEN environment variable or from
 * Git Credential Manager (the credentials already stored on this machine).
 * The token is never printed.
 *
 * Usage: node scripts/gh-release.mjs [tag] [notes-file.md]
 *
 * Without a tag, the next patch version after the latest GitHub release is
 * used automatically (v1.0.1, then v1.0.2, …).
 *
 * The release notes describe what CHANGED in this version: the CHANGELOG.md
 * section for the tag is used (or the notes file, when given) — never the
 * generic v1.0.0 description.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const ASSET = path.join(ROOT, 'dist', 'CustomFreebuff.exe')
const REPO = 'HappyMaaaan/CustomFreebuff'
const TAG_ARG = process.argv[2] || null
let TAG = TAG_ARG
const NOTES_FILE = process.argv[3] ? path.resolve(process.argv[3]) : null

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
  if (status === 200 && json) {
    return { id: json.id, uploadUrl: json.upload_url, url: json.html_url, assets: json.assets || [] }
  }
  return null
}

async function createRelease(token, tag, body) {
  const { status, json } = await api(`/repos/${REPO}/releases`, {
    method: 'POST',
    token,
    body: {
      tag_name: tag,
      name: `CustomFreebuff ${tag}`,
      body,
      draft: false,
      prerelease: false,
    },
  })
  if (status !== 201) throw new Error(`release creation failed (HTTP ${status}): ${JSON.stringify(json)}`)
  return { id: json.id, uploadUrl: json.upload_url, url: json.html_url }
}

async function deleteExistingAsset(token, release, name) {
  if (!release.assets) return
  const existing = release.assets.find((a) => a.name === name)
  if (existing) {
    await api(`/repos/${REPO}/releases/assets/${existing.id}`, { method: 'DELETE', token })
    console.log(`Removed previous asset ${name} (${existing.id}).`)
  }
}

/** Extracts the CHANGELOG.md section for `tag` — its content, without the
 *  heading. Returns null when the tag has no section yet. */
function changelogNotes(tag) {
  const file = path.join(ROOT, 'CHANGELOG.md')
  if (!fs.existsSync(file)) return null
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  let inSection = false
  const out = []
  for (const line of lines) {
    const isHeading = /^##\s/.test(line)
    if (isHeading) {
      if (inSection) break
      // "## v1.0.1 — 2026-08-18" / "## [v1.0.1]" → the tag token
      const bare = line.replace(/^##\s+/, '').replace(/^\[/, '').split(/[\]\s]/)[0]
      inSection = bare === tag
      continue
    }
    if (inSection) out.push(line)
  }
  return out.join('\n').trim() || null
}

/** Release body: the notes file when given, else the CHANGELOG section for
 *  the tag, else a short fallback. Never the generic v1.0.0 description. */
function releaseBody(tag) {
  if (NOTES_FILE && fs.existsSync(NOTES_FILE)) return fs.readFileSync(NOTES_FILE, 'utf8')
  const notes = changelogNotes(tag)
  if (notes) return `## CustomFreebuff ${tag}\n\n${notes}`
  return `## CustomFreebuff ${tag}\n\nSee CHANGELOG.md for what changed in this version.`
}

async function uploadAsset(token, release) {
  const data = fs.readFileSync(ASSET)
  await deleteExistingAsset(token, release, 'CustomFreebuff.exe')
  await deleteExistingAsset(token, release, 'FreebuffThemer.exe') // legacy name from earlier releases
  const uploadUrl = release.uploadUrl.replace('{?name,label}', '')
  const target = `${uploadUrl}?name=${encodeURIComponent('CustomFreebuff.exe')}&label=${encodeURIComponent('CustomFreebuff (Windows x64)')}`

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
  console.error('dist/CustomFreebuff.exe not found. Run `node scripts/build-exe.mjs` first.')
  process.exit(1)
}

const token = getToken()
if (!token) {
  console.error('No GitHub credentials found (GITHUB_TOKEN env or git credential manager).')
  process.exit(1)
}

// Version bumping: with no tag argument, release the next patch version
// after the latest GitHub release (the user asked to always bump).
let latestTag = null
if (!TAG) {
  const { status, json } = await api(`/repos/${REPO}/releases/latest`, { token })
  if (status === 200 && json && json.tag_name) latestTag = json.tag_name
  const m = latestTag ? String(latestTag).match(/v?(\d+)\.(\d+)\.(\d+)/) : null
  TAG = m ? `v${m[1]}.${m[2]}.${Number(m[3]) + 1}` : 'v1.0.0'
  console.log(`No tag given — bumping to ${TAG} (next after ${latestTag || 'nothing yet'}).`)
}

const body = releaseBody(TAG)
console.log(`Releasing ${TAG} -> ${REPO}`)
await ensureTag()

let release = await findRelease(token, TAG)
if (release) {
  console.log('Release already exists, replacing its asset and body.')
  release.assets = release.assets || []
  const { status } = await api(`/repos/${REPO}/releases/${release.id}`, {
    method: 'PATCH',
    token,
    body: { body },
  })
  if (status === 200) console.log('Release body updated from the changelog.')
} else {
  release = await createRelease(token, TAG, body)
  console.log('Release created.')
  release.assets = []
}

const downloadUrl = await uploadAsset(token, release)
console.log('')
console.log(`Done. Release: ${release.url}`)
console.log(`Asset: ${downloadUrl}`)
