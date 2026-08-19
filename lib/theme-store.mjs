/**
 * lib/theme-store.mjs — Persistence of user themes (VS1).
 *
 * Built-in themes ship with the project (themes/*.json, read-only). User
 * themes are JSON files in OUR config directory, never Freebuff's: one file
 * per theme, <configDir>/themes/<id>.json. A user theme always carries a
 * `base` (the theme it was derived from) so Reset can restore the defaults.
 */

import fs from 'node:fs'
import path from 'node:path'

import { themerConfigDir } from './launcher.mjs'

export function userThemesDir() {
  return path.join(themerConfigDir(), 'themes')
}

/** Safe filename fragment for a theme id (no path traversal, no weird chars). */
export function safeThemeId(id) {
  return String(id || 'theme').replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'theme'
}

export function listUserThemes() {
  const dir = userThemesDir()
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export function readUserTheme(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userThemesDir(), `${safeThemeId(id)}.json`), 'utf8'))
  } catch {
    return null
  }
}

export function saveUserTheme(theme) {
  const dir = userThemesDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${safeThemeId(theme.id)}.json`)
  fs.writeFileSync(file, JSON.stringify(theme, null, 2))
  return theme
}
