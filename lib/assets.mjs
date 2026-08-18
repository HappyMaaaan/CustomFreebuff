/**
 * lib/assets.mjs — Loads the studio UI and built-in themes.
 *
 * Two sources:
 *   - embedded: when the project is compiled into a standalone executable,
 *     scripts/build-embed.mjs inlines public/index.html and themes/*.json into
 *     lib/embedded-assets.mjs, which Bun bundles into the exe.
 *   - disk: in development (plain `node themer.mjs`), files are read from the
 *     project directory.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function readThemesFromDisk() {
  const dir = path.join(ROOT, 'themes')
  const themes = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const theme = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (theme && theme.id && theme.colors) themes.push(theme)
    } catch {
      /* skip malformed theme files */
    }
  }
  themes.sort((a, b) => (a.id < b.id ? -1 : 1))
  return themes
}

export async function loadAssets() {
  // Compiled executable: the generated module is bundled in.
  try {
    const embedded = await import('./embedded-assets.mjs')
    if (embedded && typeof embedded.indexHtml === 'string' && Array.isArray(embedded.themes)) {
      return { indexHtml: embedded.indexHtml, themes: embedded.themes }
    }
  } catch {
    /* not bundled — dev mode */
  }
  // Development: read from the project directory.
  try {
    return {
      indexHtml: fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'),
      themes: readThemesFromDisk(),
    }
  } catch (err) {
    console.error(`[themer] could not load assets: ${err.message}`)
    return { indexHtml: '<h1>Freebuff Themer — assets missing</h1>', themes: [] }
  }
}
