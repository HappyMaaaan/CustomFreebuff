/**
 * lib/theme-model.mjs — The theme model and CSS generator (VS1).
 *
 * The PRD's key architectural decision: a theme is DATA (design tokens), and
 * the CSS injected into Freebuff is a GENERATED representation of that data —
 * never a hand-written collection of rules.
 *
 * VS1 keeps the model deliberately small: six semantic tokens. The generator
 * maps each token to the CSS variables the app's UI actually uses, and derives
 * the remaining ones (hover states, nested surfaces, …) from those tokens —
 * so editing ONE token changes several coherent places in Freebuff.
 *
 * The mapping is deterministic: the same tokens always produce the same CSS,
 * and each token drives a coherent family of variables:
 *   background  -> --bg, --chrome
 *   surface     -> --surface, --surface-2, --raised
 *   text        -> --text, --accent
 *   textMuted   -> --muted, --faint, --accent-dim
 *   border      -> --border
 *   accent      -> --brand, --brand-dim, --ok, --green
 */

export const TOKEN_KEYS = ['background', 'surface', 'text', 'textMuted', 'border', 'accent']

export const TOKEN_LABELS = {
  background: 'Background',
  surface: 'Surface',
  text: 'Text',
  textMuted: 'Muted Text',
  border: 'Border',
  accent: 'Accent',
}

/** The stock Freebuff look — the base every theme derives from. */
export const DEFAULT_TOKENS = {
  background: '#0e0e0e',
  surface: '#151517',
  text: '#e7e7e8',
  textMuted: '#9a9aa0',
  border: '#2a2a2e',
  accent: '#7cff3f',
}

/** Non-token semantic colors, per color scheme (they become tokens in later slices). */
const SCHEME_CONSTANTS = {
  dark: {
    '--danger': '#d56a6a',
    '--warn': '#c8a93f',
    '--premium': '#b48ead',
    '--shadow': '#000000',
  },
  light: {
    '--danger': '#b91c1c',
    '--warn': '#a16207',
    '--premium': '#a16207',
    '--shadow': 'rgb(0 0 0 / 0.35)',
  },
}

/* ------------------------------------------------------------------ */
/* Components (VS2)                                                    */
/*                                                                     */
/* Theming moves from "the whole app" to "one component at a time".    */
/* Each component can override a few settings locally — the rest stays  */
/* inherited from the global tokens. Only the OVERRIDDEN properties    */
/* are emitted, so changing the global accent still cascades into a    */
/* component that did not override it.                                 */
/*                                                                     */
/* Selectors are generic on purpose: they restyle every instance of a  */
/* component (that IS component theming — consistency). Per-variant    */
/* targeting (primary vs ghost button…) is a later slice. The mapping  */
/* is a single constant so it can be refined once the real Freebuff    */
/* DOM structure is known (a risk already flagged in the PRD).         */
/* ------------------------------------------------------------------ */

export const COMPONENT_KEYS = ['button', 'input', 'card', 'sidebar', 'modal']

export const COMPONENT_LABELS = {
  button: 'Button',
  input: 'Input',
  card: 'Card',
  sidebar: 'Sidebar',
  modal: 'Modal',
}

/** Which DOM nodes each component maps to (verified against the real
 *  Freebuff DOM: 1000+ real <button>s, the chat box is a <textarea>, and
 *  the app's cards are .bubble/.msg elements). */
export const COMPONENT_SELECTORS = {
  button: 'button',
  input: 'input, textarea, select',
  card: '.card, .bubble, .msg',
  sidebar: 'aside, .sidebar',
  modal: '.modal, [role="dialog"]',
}

/** The settings a component can override (Colors / Border / Radius / Shadow). */
export const COMPONENT_PROPS = ['background', 'text', 'border', 'accent', 'borderWidth', 'radius', 'shadow']

/** The CSS variables each component color drives, scoped to the component.
 *  Each color maps to the WHOLE family the real app draws that role from —
 *  the app's buttons take their background from --surface/--surface-2/--raised
 *  (verified on the real Freebuff DOM: 114 background rules consume the
 *  surface family), so overriding only --surface changed almost nothing.
 *  Everything stays scoped to the component selector: other components keep
 *  inheriting the global tokens (VS2 isolation DoD). */
const COMPONENT_VAR_SETS = {
  background: ['--surface', '--surface-2', '--raised'],
  text: ['--text', '--muted', '--faint'],
  border: ['--border'],
  accent: ['--brand', '--accent'],
}

/** Shadow presets offered by the editor (data, not code). */
export const SHADOW_PRESETS = {
  none: 'none',
  soft: '0 2px 8px rgba(0, 0, 0, 0.25)',
  medium: '0 4px 16px rgba(0, 0, 0, 0.35)',
  strong: '0 8px 32px rgba(0, 0, 0, 0.5)',
}

/** The values a component falls back to when not overridden. */
export function componentDefaults(tokens) {
  return {
    background: tokens.surface,
    text: tokens.text,
    border: tokens.border,
    accent: tokens.accent,
    borderWidth: 1,
    radius: 6,
    shadow: 'none',
  }
}

/** Keeps only the valid overrides of a component (never throws). */
export function normalizeComponentOverrides(over) {
  const out = {}
  if (!over || typeof over !== 'object') return out
  for (const prop of ['background', 'text', 'border', 'accent']) {
    if (parseHex(over[prop])) out[prop] = String(over[prop]).trim()
  }
  const w = Number(over.borderWidth)
  if (Number.isFinite(w) && w >= 0 && w <= 16) out.borderWidth = w
  const r = Number(over.radius)
  if (Number.isFinite(r) && r >= 0 && r <= 48) out.radius = r
  if (over.shadow === 'none' || over.shadow in SHADOW_PRESETS) out.shadow = over.shadow
  return out
}

/**
 * Generates the component-scoped CSS from a theme's components section.
 * Only components with at least one override emit a rule, and only the
 * overridden properties are declared — everything else stays inherited.
 */
export function componentCss(components) {
  let css = ''
  for (const key of COMPONENT_KEYS) {
    const over = normalizeComponentOverrides(components?.[key])
    if (!Object.keys(over).length) continue
    const decls = []
    for (const [prop, value] of Object.entries(over)) {
      if (prop in COMPONENT_VAR_SETS) {
        for (const v of COMPONENT_VAR_SETS[prop]) decls.push(`${v}: ${value} !important`)
      } else if (prop === 'borderWidth') decls.push(`border-width: ${value}px !important`)
      else if (prop === 'radius') decls.push(`border-radius: ${value}px !important`)
      else if (prop === 'shadow') decls.push(`box-shadow: ${SHADOW_PRESETS[value]} !important`)
    }
    if (decls.length) css += `\n${COMPONENT_SELECTORS[key]}{${decls.join(';')}}`
  }
  return css
}

/* ------------------------------------------------------------------ */
/* Color helpers (hex only — the tokens are hex).                      */
/* ------------------------------------------------------------------ */

export function parseHex(hex) {
  let h = String(hex || '').trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Linear mix: t = 0 → a, t = 1 → b. */
export function mixHex(a, b, t) {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return a
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  })
}

export function lighten(hex, amt) {
  return mixHex(hex, '#ffffff', amt)
}

export function darken(hex, amt) {
  return mixHex(hex, '#000000', amt)
}

/* ------------------------------------------------------------------ */
/* Token → CSS variables.                                              */
/* ------------------------------------------------------------------ */

/**
 * Maps a token set to the full CSS-variable set Freebuff uses. `dark` flips
 * the derivation directions (light themes darken surfaces instead of
 * lightening them). Deterministic: same tokens → same variables.
 */
export function tokenVars(tokens, colorScheme = 'dark') {
  const t = { ...DEFAULT_TOKENS, ...tokens }
  const dark = colorScheme !== 'light'
  const vars = {
    '--bg': t.background,
    '--chrome': dark ? darken(t.background, 0.12) : darken(t.background, 0.05),
    '--surface': t.surface,
    '--surface-2': dark ? lighten(t.surface, 0.05) : darken(t.surface, 0.04),
    '--raised': dark ? lighten(t.surface, 0.11) : darken(t.surface, 0.08),
    '--text': t.text,
    '--accent': t.text,
    '--muted': t.textMuted,
    '--faint': dark ? mixHex(t.textMuted, t.background, 0.5) : mixHex(t.textMuted, t.background, 0.36),
    '--accent-dim': t.textMuted,
    '--border': t.border,
    '--brand': t.accent,
    '--brand-dim': dark ? darken(t.accent, 0.22) : darken(t.accent, 0.28),
    '--ok': t.accent,
    '--green': t.accent,
    ...SCHEME_CONSTANTS[dark ? 'dark' : 'light'],
  }
  return vars
}

/**
 * Turns a theme (tokens + colorScheme) into the stylesheet injected into
 * Freebuff. CSS is purely a generated representation of the model.
 */
export function themeToCss(theme) {
  const t = theme || {}
  const vars = tokenVars(t.tokens, t.colorScheme)
  const parts = [`color-scheme: ${t.colorScheme === 'light' ? 'light' : 'dark'} !important`]
  for (const [key, value] of Object.entries(vars)) parts.push(`${key}: ${value} !important`)
  let css = `:root{${parts.join(';')}}`
  if (t.extraCss) css += `\n${t.extraCss}`
  css += componentCss(t.components)
  return css
}

/**
 * Validates + normalizes an incoming theme (from the editor or a file):
 * fills missing tokens with the fallback (or defaults), and coerces the
 * fields to the model's shape. Never throws.
 */
export function normalizeTheme(raw, fallback = {}) {
  const tokens = {}
  for (const key of TOKEN_KEYS) {
    const v = raw?.tokens?.[key] ?? fallback.tokens?.[key] ?? DEFAULT_TOKENS[key]
    tokens[key] = parseHex(v) ? String(v).trim() : DEFAULT_TOKENS[key]
  }
  const components = {}
  for (const key of COMPONENT_KEYS) {
    const over = normalizeComponentOverrides(raw?.components?.[key] ?? fallback.components?.[key])
    if (Object.keys(over).length) components[key] = over
  }
  return {
    id: String(raw?.id || fallback.id || 'theme'),
    name: String(raw?.name || fallback.name || 'Theme'),
    description: String(raw?.description || fallback.description || ''),
    colorScheme: raw?.colorScheme === 'light' ? 'light' : 'dark',
    base: String(raw?.base || fallback.base || 'default'),
    tokens,
    components,
    extraCss: String(raw?.extraCss || fallback.extraCss || ''),
  }
}
