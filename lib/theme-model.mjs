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

/* ------------------------------------------------------------------ */
/* Component states (VS3)                                              */
/*                                                                     */
/* A component can restyle itself per STATE (hover, active, focus,      */
/* disabled, loading) without touching its normal look. Each state      */
/* overrides a few properties the same way the component does — the     */
/* generator emits a scoped rule with the state selector appended       */
/* (button:hover, button:active, …). Because a state selector has a     */
/* higher specificity than the plain component selector, the state      */
/* wins while it applies and the base look returns automatically        */
/* afterwards — that is the VS3 DoD: hovering restyles the button       */
/* without modifying its normal state.                                 */
/* ------------------------------------------------------------------ */

export const COMPONENT_STATES = ['hover', 'active', 'focus', 'disabled', 'loading']

export const COMPONENT_STATE_LABELS = {
  hover: 'Hover',
  active: 'Active',
  focus: 'Focus',
  disabled: 'Disabled',
  loading: 'Loading',
}

/** The selector suffix that targets each state, appended to the component
 *  selector. `:focus` is included next to `:focus-visible` so the focus
 *  state is visible on mouse click too (not only keyboard navigation). */
export const COMPONENT_STATE_SELECTORS = {
  hover: ':hover',
  active: ':active',
  focus: ':focus, :focus-visible',
  disabled: ':disabled, [disabled]',
  loading: '[data-loading], [aria-busy="true"], .loading',
}

/** The props a state can override: the color roles + the shadow (glow). */
export const STATE_PROPS = ['background', 'text', 'border', 'accent', 'shadow']

/** Keeps only the valid overrides of a component STATE (never throws). */
export function normalizeStateOverrides(s) {
  const out = {}
  if (!s || typeof s !== 'object') return out
  for (const prop of ['background', 'text', 'border', 'accent']) {
    if (parseHex(s[prop])) out[prop] = String(s[prop]).trim()
  }
  if (s.shadow === 'none' || s.shadow in SHADOW_PRESETS) out.shadow = s.shadow
  return out
}

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
  // VS8 — component glow: an accent-colored neon shadow, scoped to the
  // component (0 = off). Kept separate from `shadow` (elevation presets).
  const glow = Number(over.glow)
  if (Number.isFinite(glow) && glow >= 0 && glow <= 1) out.glow = Math.round(glow * 100) / 100
  const states = {}
  for (const key of COMPONENT_STATES) {
    const s = normalizeStateOverrides(over.states?.[key])
    if (Object.keys(s).length) states[key] = s
  }
  if (Object.keys(states).length) out.states = states
  return out
}

/**
 * Generates the component-scoped CSS from a theme's components section.
 * Only components with at least one override emit a rule, and only the
 * overridden properties are declared — everything else stays inherited.
 */
export function componentCss(components, tokens) {
  let css = ''
  const accent = tokens?.accent || DEFAULT_TOKENS.accent
  for (const key of COMPONENT_KEYS) {
    const over = normalizeComponentOverrides(components?.[key])
    if (!Object.keys(over).length) continue
    const decls = []
    for (const [prop, value] of Object.entries(over)) {
      if (prop === 'states') continue
      if (prop in COMPONENT_VAR_SETS) {
        for (const v of COMPONENT_VAR_SETS[prop]) decls.push(`${v}: ${value} !important`)
      } else if (prop === 'borderWidth') decls.push(`border-width: ${value}px !important`)
      else if (prop === 'radius') decls.push(`border-radius: ${value}px !important`)
      else if (prop === 'shadow') decls.push(`box-shadow: ${SHADOW_PRESETS[value]} !important`)
      else if (prop === 'glow' && value > 0) {
        // VS8 — neon glow: joins the elevation shadow (if any) so both coexist.
        const glow = `0 0 ${Math.round(value * 28)}px ${rgba(over.accent || accent, (value * 0.55).toFixed(2))}`
        const base = over.shadow && over.shadow !== 'none' ? SHADOW_PRESETS[over.shadow] : null
        decls.push(`box-shadow: ${base ? `${base}, ${glow}` : glow} !important`)
      }
    }
    if (decls.length) css += `\n${COMPONENT_SELECTORS[key]}{${decls.join(';')}}`
    // VS3 — one scoped rule per state, with the state selector appended.
    // A comma-separated suffix (e.g. ':disabled, [disabled]') is expanded so
    // EVERY alternative stays scoped to the component (button:disabled,
    // button[disabled]) — VS2 isolation: nothing leaks outside the component.
    for (const stateKey of COMPONENT_STATES) {
      const s = normalizeStateOverrides(over.states?.[stateKey])
      if (!Object.keys(s).length) continue
      const stateDecls = []
      for (const [prop, value] of Object.entries(s)) {
        if (prop in COMPONENT_VAR_SETS) {
          for (const v of COMPONENT_VAR_SETS[prop]) stateDecls.push(`${v}: ${value} !important`)
        } else if (prop === 'shadow') stateDecls.push(`box-shadow: ${SHADOW_PRESETS[value]} !important`)
      }
      if (stateDecls.length) {
        const selector = COMPONENT_STATE_SELECTORS[stateKey]
          .split(',')
          .map((part) => COMPONENT_SELECTORS[key] + part.trim())
          .join(', ')
        css += `\n${selector}{${stateDecls.join(';')}}`
      }
    }
  }
  return css
}

/* ------------------------------------------------------------------ */
/* VS8 — visual element inspector                                     */
/*                                                                     */
/* The DOM → component mapping: given any clicked element, find the     */
/* theme component it belongs to (button, input, card, sidebar, modal)  */
/* by walking up until a node matches the component selectors. The walk */
/* crosses shadow boundaries (getRootNode().host) so elements inside    */
/* nested shadow DOM are still mapped to the right component.           */
/* ------------------------------------------------------------------ */

export function matchComponent(el, root) {
  let node = el
  while (node && node.nodeType === 1) {
    for (const key of COMPONENT_KEYS) {
      if (typeof node.matches === 'function' && node.matches(COMPONENT_SELECTORS[key])) return key
    }
    if (root && node === root) break
    node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null
  }
  return null
}

/** The effective values of a component (its overrides or the global token
 *  fallbacks) — what the element actually looks like. Used by the inspector
 *  to display the current state of the picked element. */
export function componentEffective(theme, key) {
  const t = theme || {}
  const tokens = { ...DEFAULT_TOKENS, ...(t.tokens || {}) }
  const defs = componentDefaults(tokens)
  const over = normalizeComponentOverrides(t.components?.[key])
  return {
    background: over.background || defs.background,
    text: over.text || defs.text,
    border: over.border || defs.border,
    accent: over.accent || defs.accent,
    borderWidth: over.borderWidth !== undefined ? over.borderWidth : defs.borderWidth,
    radius: over.radius !== undefined ? over.radius : defs.radius,
    shadow: over.shadow !== undefined ? over.shadow : defs.shadow,
    glow: over.glow !== undefined ? over.glow : 0,
    states: over.states || {},
  }
}

/* ------------------------------------------------------------------ */
/* VS4 — global shape + multi-layer shadows                            */
/*                                                                     */
/* The "visual physics" of the app: a global radius, border weight /   */
/* opacity and a multi-layer box-shadow (x, y, blur, spread, color,    */
/* opacity, inner, several layers). It is data like everything else —  */
/* the CSS is generated from it. Named presets (Flat, Soft, Floating,  */
/* Deep, Neon) resolve to concrete shape + shadow values.              */
/*                                                                     */
/* 0 = inherit: the global radius/border only start overriding the     */
/* app once the user sets a value (or picks a preset), so activating   */
/* a theme never silently restyles the app's own radii.                */
/* ------------------------------------------------------------------ */

export const DEFAULT_SHAPE = { radius: 0, borderWidth: 0, borderOpacity: 1 }

/** One shadow layer: offset, blur/spread, color+opacity, inner. */
export const DEFAULT_SHADOW = {
  layers: [{ x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.25, inner: false }],
}

/** The app's surfaces the global shape applies to (same family as the
 *  component selectors, so per-component overrides win by cascade). */
export const SHAPE_SELECTORS =
  'button,input,textarea,select,.card,.bubble,.msg,aside,.sidebar,.modal,[role="dialog"]'

/** Named looks. A layer color of 'ACCENT' means "the theme's accent" — it
 *  is resolved at preset-application time so the stored shadow stays a
 *  concrete list of hex layers. */
export const SHAPE_PRESETS = {
  // Elevation presets cast a neutral (black) shadow; only Neon glows with
  // the theme's accent color.
  flat: { radius: 2, borderWidth: 1, borderOpacity: 1, shadow: [] },
  soft: {
    radius: 8,
    borderWidth: 1,
    borderOpacity: 1,
    shadow: [{ x: 0, y: 2, blur: 10, spread: 0, color: '#000000', opacity: 0.18, inner: false }],
  },
  floating: {
    radius: 14,
    borderWidth: 1,
    borderOpacity: 1,
    shadow: [
      { x: 0, y: 10, blur: 28, spread: -6, color: '#000000', opacity: 0.4, inner: false },
      { x: 0, y: 4, blur: 10, spread: -2, color: '#000000', opacity: 0.22, inner: false },
    ],
  },
  deep: {
    radius: 6,
    borderWidth: 1,
    borderOpacity: 1,
    shadow: [
      { x: 0, y: 2, blur: 4, spread: 0, color: '#000000', opacity: 0.4, inner: false },
      { x: 0, y: 10, blur: 20, spread: 0, color: '#000000', opacity: 0.35, inner: false },
    ],
  },
  neon: {
    radius: 10,
    borderWidth: 1,
    borderOpacity: 1,
    shadow: [
      { x: 0, y: 0, blur: 10, spread: 0, color: 'ACCENT', opacity: 0.6, inner: false },
      { x: 0, y: 0, blur: 24, spread: 0, color: 'ACCENT', opacity: 0.35, inner: false },
      { x: 0, y: 0, blur: 4, spread: 0, color: 'ACCENT', opacity: 0.5, inner: true },
    ],
  },
}

/** Resolves a preset name to concrete { shape, shadow } data, replacing the
 *  'ACCENT' layer color with the theme's actual accent hex. */
export function resolveShapePreset(name, accent) {
  const p = SHAPE_PRESETS[name] || SHAPE_PRESETS.soft
  const accentHex = parseHex(accent) ? String(accent).trim() : DEFAULT_TOKENS.accent
  return {
    shape: { radius: p.radius, borderWidth: p.borderWidth, borderOpacity: p.borderOpacity },
    shadow: {
      layers: p.shadow.map((l) => ({
        x: l.x,
        y: l.y,
        blur: l.blur,
        spread: l.spread,
        color: l.color === 'ACCENT' ? accentHex : l.color,
        opacity: l.opacity,
        inner: l.inner,
      })),
    },
  }
}

/** Validates + clamps the global shape (never throws). */
export function normalizeShape(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const num = (v, lo, hi, dflt) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
  }
  return {
    radius: num(r.radius, 0, 48, DEFAULT_SHAPE.radius),
    borderWidth: num(r.borderWidth, 0, 8, DEFAULT_SHAPE.borderWidth),
    borderOpacity: num(r.borderOpacity, 0, 1, DEFAULT_SHAPE.borderOpacity),
  }
}

/** Keeps only the valid shadow layers (never throws). */
export function normalizeShadowLayers(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(raw.layers)
      ? raw.layers
      : []
  const layers = []
  for (const l of list) {
    if (!l || typeof l !== 'object') continue
    const x = Number(l.x)
    const y = Number(l.y)
    const blur = Number(l.blur)
    const spread = Number(l.spread)
    const opacity = Number(l.opacity)
    if (![x, y, blur, spread, opacity].every(Number.isFinite)) continue
    if (!parseHex(l.color)) continue
    layers.push({
      x: Math.max(-40, Math.min(40, x)),
      y: Math.max(-40, Math.min(40, y)),
      blur: Math.max(0, Math.min(80, blur)),
      spread: Math.max(-30, Math.min(40, spread)),
      color: String(l.color).trim(),
      opacity: Math.max(0, Math.min(1, opacity)),
      inner: Boolean(l.inner),
    })
  }
  return layers
}

function rgba(hex, opacity) {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/** Renders the layer list to a single box-shadow value ('none' when empty). */
export function shadowToCss(layers, accent) {
  const list = normalizeShadowLayers(layers)
  if (!list.length) return 'none'
  return list
    .map((l) => {
      const { r, g, b } = parseHex(l.color)
      const inset = l.inner ? 'inset ' : ''
      return `${inset}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px rgba(${r}, ${g}, ${b}, ${l.opacity})`
    })
    .join(', ')
}

/* ------------------------------------------------------------------ */
/* VS5 — glass & visual effects                                        */
/*                                                                     */
/* One coherent glass style applied to every surface of the app from   */
/* the editor — no CSS to write. The effects are data: transparency,   */
/* backdrop blur, saturation, brightness, translucent borders, glow,   */
/* gradient and noise/grain. Named presets (None, Subtle, Frosted,     */
/* Strong, Important) resolve to concrete values.                      */
/*                                                                     */
/* Performance: backdrop blur and noise are GPU-heavy on a real app,   */
/* so the model can flag them (effectCost) and 'performance: off'      */
/* neutralizes them while keeping the light effects.                   */
/* ------------------------------------------------------------------ */

export const EFFECT_PRESETS = {
  none: { enabled: false, transparency: 1, blur: 0, saturation: 1, brightness: 1, borderTranslucency: 1, glow: 0, gradient: 0, grain: 0 },
  subtle: { enabled: true, transparency: 0.92, blur: 6, saturation: 1.1, brightness: 1, borderTranslucency: 0.6, glow: 0, gradient: 0, grain: 0 },
  frosted: { enabled: true, transparency: 0.78, blur: 14, saturation: 1.2, brightness: 1.05, borderTranslucency: 0.4, glow: 0, gradient: 0, grain: 0 },
  strong: { enabled: true, transparency: 0.6, blur: 24, saturation: 1.3, brightness: 1.1, borderTranslucency: 0.25, glow: 0.15, gradient: 0.25, grain: 0.12 },
  important: { enabled: true, transparency: 0.45, blur: 32, saturation: 1.4, brightness: 1.15, borderTranslucency: 0.15, glow: 0.3, gradient: 0.4, grain: 0.28 },
}

export const EFFECT_PROPS = [
  'transparency', 'blur', 'saturation', 'brightness', 'borderTranslucency', 'glow', 'gradient', 'grain',
]

/** Validates + clamps the effects section (never throws). */
export function normalizeEffects(raw) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const num = (v, lo, hi, dflt) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
  }
  return {
    enabled: Boolean(e.enabled),
    mode: EFFECT_PRESETS[e.mode] ? String(e.mode) : 'none',
    transparency: num(e.transparency, 0.2, 1, 1),
    blur: num(e.blur, 0, 40, 0),
    saturation: num(e.saturation, 0.5, 2.5, 1),
    brightness: num(e.brightness, 0.5, 1.5, 1),
    borderTranslucency: num(e.borderTranslucency, 0, 1, 1),
    glow: num(e.glow, 0, 1, 0),
    gradient: num(e.gradient, 0, 1, 0),
    grain: num(e.grain, 0, 1, 0),
    performance: e.performance === 'off' ? 'off' : 'auto',
  }
}

/** Whether the effects section actually changes anything visually. */
export function effectsActive(effects) {
  const e = normalizeEffects(effects)
  if (!e.enabled) return false
  return (
    e.transparency < 1 ||
    e.blur > 0 ||
    e.saturation !== 1 ||
    e.brightness !== 1 ||
    e.borderTranslucency < 1 ||
    e.glow > 0 ||
    e.gradient > 0 ||
    e.grain > 0
  )
}

/** Performance report: which effects are GPU-heavy. Blur and noise apply a
 *  backdrop-filter / feTurbulence on every surface — costly on a real app. */
export function effectCost(effects) {
  const e = normalizeEffects(effects)
  if (!effectsActive(e)) return { level: 'none', heavy: [] }
  const heavy = []
  if (e.blur > 0) heavy.push('backdrop blur')
  if (e.grain > 0) heavy.push('noise grain')
  return { level: heavy.length ? 'heavy' : 'light', heavy }
}

/* ------------------------------------------------------------------ */
/* VS6 — motion engine                                                 */
/*                                                                     */
/* Animations become part of the theme: base duration / easing / delay */
/* plus per-state transforms (hover, active, focus) and enter          */
/* animations for new chat messages. Named presets (Minimal, Smooth,   */
/* Snappy, Bouncy) resolve to concrete values — changing the preset    */
/* really changes the animated behavior of the app's surfaces.         */
/* The "exit" side is the base transition itself: leaving hover /      */
/* releasing the press transitions back with the same duration/easing. */
/* ------------------------------------------------------------------ */

export const MOTION_PRESETS = {
  minimal: { duration: 0, easing: 'ease', hover: { translateY: 0, scale: 1 }, active: { scale: 1 }, focus: { scale: 1 }, enter: false },
  smooth: { duration: 200, easing: 'ease-out', hover: { translateY: -2, scale: 1.02 }, active: { scale: 0.97 }, focus: { scale: 1.01 }, enter: true },
  snappy: { duration: 90, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', hover: { translateY: -1, scale: 1.01 }, active: { scale: 0.95 }, focus: { scale: 1.01 }, enter: true },
  bouncy: { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', hover: { translateY: -4, scale: 1.04 }, active: { scale: 0.94 }, focus: { scale: 1.02 }, enter: true },
}

/** Named easings + cubic-bezier/steps functions (validated on input). */
const NAMED_EASINGS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'])

export function validEasing(v) {
  const s = String(v || '').trim()
  if (NAMED_EASINGS.has(s)) return s
  if (/^cubic-bezier\([0-9.]+,\s*[0-9.]+,\s*[0-9.]+,\s*[0-9.]+\)$/.test(s)) return s
  if (/^steps\(\d+(,\s*(start|end))?\)$/.test(s)) return s
  return null
}

/** Validates + clamps the motion section (never throws). The defaults are
 *  the Minimal preset: a theme that never touches motion animates nothing —
 *  activating a theme never silently adds motion to the app. */
export function normalizeMotion(raw) {
  const m = raw && typeof raw === 'object' ? raw : {}
  const num = (v, lo, hi, dflt) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
  }
  const scale = (v) => Math.round(num(v, 0.5, 2, 1) * 100) / 100
  const two = (v) => Math.round(num(v, 0, 2, 1) * 100) / 100
  return {
    preset: MOTION_PRESETS[m.preset] ? String(m.preset) : 'minimal',
    duration: num(m.duration, 0, 2000, 0),
    easing: validEasing(m.easing) || 'ease',
    delay: num(m.delay, 0, 2000, 0),
    hover: { translateY: num(m.hover?.translateY, -40, 40, 0), scale: scale(m.hover?.scale) },
    active: { scale: scale(m.active?.scale) },
    focus: { scale: scale(m.focus?.scale) },
    enter: Boolean(m.enter),
    // VS7 — global motion scale: speed multiplies every duration, intensity
    // scales the per-state transforms (0 = flat/discreet, 2 = amplified),
    // reduced emits the prefers-reduced-motion media query (auto) or not (off).
    global: {
      speed: Math.round(num(m.global?.speed, 0.25, 3, 1) * 100) / 100,
      intensity: two(m.global?.intensity),
      reduced: m.global?.reduced === 'off' ? 'off' : 'auto',
    },
  }
}

/** Applies the global motion scale (VS7): `speed` multiplies every duration
 *  (transitions + enter animation) and `intensity` scales the per-state
 *  transforms. The result is the normalized motion with the EFFECTIVE values
 *  used to generate CSS — a theme that never touches motion stays minimal
 *  (0 duration × any speed is still 0). */
export function motionEffective(raw) {
  const m = normalizeMotion(raw)
  const g = m.global
  const int = (v) => Math.round(v * g.intensity)
  const intScale = (v) => Math.round((1 + (v - 1) * g.intensity) * 100) / 100
  return {
    ...m,
    duration: Math.max(0, Math.min(5000, Math.round(m.duration * g.speed))),
    delay: Math.max(0, Math.min(2000, Math.round(m.delay * g.speed))),
    hover: { translateY: int(m.hover.translateY), scale: intScale(m.hover.scale) },
    active: { scale: intScale(m.active.scale) },
    focus: { scale: intScale(m.focus.scale) },
  }
}

/** Whether the motion section produces any CSS (Minimal emits nothing). */
export function motionActive(raw) {
  const m = normalizeMotion(raw)
  if (m.duration <= 0) return false
  return (
    m.hover.translateY !== 0 ||
    m.hover.scale !== 1 ||
    m.active.scale !== 1 ||
    m.focus.scale !== 1 ||
    m.enter
  )
}

function motionTransform(hover) {
  const parts = []
  if (hover.translateY) parts.push(`translateY(${hover.translateY}px)`)
  if (hover.scale !== 1) parts.push(`scale(${hover.scale})`)
  return parts.join(' ') || 'none'
}

/** Appends a state suffix to every surface selector, keeping each scoped. */
function surfaceStateSelector(suffix) {
  return SHAPE_SELECTORS.split(',')
    .map((s) => suffix.split(',').map((part) => `${s.trim()}${part.trim()}`).join(', '))
    .join(', ')
}

/** The transition applied to the surfaces: every animated property with the
 *  theme's duration / easing / delay. Expects a NORMALIZED motion object
 *  (use `motionEffective` for the global-scaled values) — no re-normalization
 *  here so the effective duration (already clamped) is preserved. */
export function motionTransitionCss(m) {
  const props = ['background-color', 'color', 'border-color', 'box-shadow', 'transform', 'backdrop-filter', 'opacity']
  return `${props.map((p) => `${p} ${m.duration}ms ${m.easing}`).join(', ')} !important`
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

/* ------------------------------------------------------------------ */
/* VS9 — Advanced CSS                                                  */
/*                                                                     */
/* The escape hatch for advanced users: raw CSS injected into Freebuff */
/* (appended last, so it wins over the generated rules). It is          */
/* validated for safety (no HTML, no @import, no javascript:) and can   */
/* be scoped to the app's themed surfaces. The theme's own tokens are   */
/* exposed as CSS variables (--theme-*) for custom rules to consume.    */
/* ------------------------------------------------------------------ */

export const CUSTOM_CSS_MAX_LENGTH = 20000

function lineCol(src, idx) {
  let line = 1
  let col = 1
  const stop = Math.min(idx, src.length)
  for (let i = 0; i < stop; i++) {
    if (src[i] === '\n') { line += 1; col = 1 } else col += 1
  }
  return { line, col }
}

/** Index of the '{' that opens a rule's block, skipping strings and parens
 *  (selectors may contain :not(...), attribute selectors, …). -1 if none. */
function findOpenBrace(src, from) {
  let quote = null
  for (let i = from; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') return i
  }
  return -1
}

/** Index of the '}' matching the '{' at openIdx (nested-aware, strings and
 *  comments skipped). -1 if never closed. */
function matchingBrace(src, openIdx) {
  let depth = 0
  let quote = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === '/' && src[i + 1] === '*') {
      i += 1
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 1
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Prefixes every selector of a selector list with `scope` (descendant
 *  semantics), splitting on top-level commas only. */
function scopeSelectors(selectors, scope) {
  const parts = []
  let cur = ''
  let depth = 0
  let quote = null
  for (let i = 0; i < selectors.length; i++) {
    const ch = selectors[i]
    if (quote) {
      cur += ch
      if (ch === '\\') { cur += selectors[i + 1] || ''; i += 1 }
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") { quote = ch; cur += ch }
    else if (ch === '(') { depth += 1; cur += ch }
    else if (ch === ')') { depth -= 1; cur += ch }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = '' }
    else cur += ch
  }
  parts.push(cur)
  return parts
    .map((s) => {
      const t = s.trim()
      if (!t || t.startsWith('@')) return t
      return `${scope} ${t}`
    })
    .join(', ')
}

/** Best-effort scoping: prefixes every top-level selector with `scope` so
 *  the rules only match inside the app's surfaces. Block at-rules
 *  (@media/@supports/@container/@layer) are recursed into; keyframes,
 *  font-face and friends are kept as-is. If parsing fails, the original CSS
 *  is returned unchanged (fail safe). */
export function scopeCss(css, scope) {
  if (!scope || typeof css !== 'string' || !css.trim()) return css
  const RECURSE = /^(?:@media|@supports|@container|@layer)\b/i
  let out = ''
  let i = 0
  const n = css.length
  while (i < n) {
    while (i < n && /\s/.test(css[i])) { out += css[i]; i += 1 }
    if (i >= n) break
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += css.slice(i, stop)
      i = stop
      continue
    }
    if (css[i] === '@') {
      let j = i
      let prelude = ''
      while (j < n && css[j] !== '{' && css[j] !== ';') { prelude += css[j]; j += 1 }
      if (j >= n || css[j] === ';') {
        out += prelude + (css[j] === ';' ? ';' : '')
        i = j + (css[j] === ';' ? 1 : 0)
        continue
      }
      const close = matchingBrace(css, j)
      if (close === -1) return css
      const inner = css.slice(j + 1, close)
      const body = RECURSE.test(prelude.trim()) ? scopeCss(inner, scope) : inner
      out += prelude + '{' + body + '}'
      i = close + 1
      continue
    }
    const open = findOpenBrace(css, i)
    if (open === -1) return css
    const close = matchingBrace(css, open)
    if (close === -1) return css
    out += scopeSelectors(css.slice(i, open), scope) + '{' + css.slice(open + 1, close) + '}'
    i = close + 1
  }
  return out
}

/** Strips anything that could break out of the injected <style> element or
 *  pull external resources. Applied at save time (normalizeTheme). */
export function sanitizeCustomCss(css) {
  return String(css || '')
    .replace(/</g, '')
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/javascript\s*:/gi, '')
    .slice(0, CUSTOM_CSS_MAX_LENGTH)
}

/** Validates custom CSS without executing anything. Returns
 *  { ok, errors: [{ line, col, message }] } — line/col point at the first
 *  offending character (or where the problem was detected). */
export function validateCustomCss(css) {
  const errors = []
  const src = String(css || '')
  if (!src.trim()) return { ok: true, errors, warnings: [] }
  if (src.length > CUSTOM_CSS_MAX_LENGTH) {
    errors.push({ line: 1, col: 1, message: `Custom CSS is limited to ${CUSTOM_CSS_MAX_LENGTH.toLocaleString('en-US')} characters.` })
  }
  const lt = src.indexOf('<')
  if (lt !== -1) {
    const pos = lineCol(src, lt)
    errors.push({ line: pos.line, col: pos.col, message: 'The "<" character is not allowed (no HTML inside CSS).' })
  }
  const imp = /@import\b/i.exec(src)
  if (imp) {
    const pos = lineCol(src, imp.index)
    errors.push({ line: pos.line, col: pos.col, message: '@import is not allowed (external stylesheets are blocked).' })
  }
  const js = /javascript\s*:/i.exec(src)
  if (js) {
    const pos = lineCol(src, js.index)
    errors.push({ line: pos.line, col: pos.col, message: '"javascript:" URLs are not allowed.' })
  }
  // Structural check: balanced braces/parens/brackets, comments and strings
  // skipped so false positives stay rare.
  const stack = []
  const pairs = { '}': '{', ')': '(', ']': '[' }
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === '/' && src[i + 1] === '*') {
      i += 1
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 1
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '(' || ch === '[') stack.push([ch, i])
    else if (ch === '}' || ch === ')' || ch === ']') {
      const last = stack.pop()
      if (!last || last[0] !== pairs[ch]) {
        const pos = lineCol(src, i)
        errors.push({ line: pos.line, col: pos.col, message: `Unbalanced "${ch}" — check your braces and parentheses.` })
        return { ok: false, errors, warnings: [] }
      }
    }
  }
  if (stack.length) {
    const pos = lineCol(src, stack[0][1])
    errors.push({ line: pos.line, col: pos.col, message: `Unclosed "${stack[0][0]}" — a block is never closed.` })
  }
  if (quote) {
    const pos = lineCol(src, src.length)
    errors.push({ line: pos.line, col: pos.col, message: 'Unclosed string — check your quotes.' })
  }
  return { ok: errors.length === 0, errors, warnings: [] }
}

/**
 * Turns a theme (tokens + colorScheme) into the stylesheet injected into
 * Freebuff. CSS is purely a generated representation of the model.
 */
export function themeToCss(theme) {
  const t = theme || {}
  const vars = tokenVars(t.tokens, t.colorScheme)
  const shape = normalizeShape(t.shape)
  const shadowLayers = normalizeShadowLayers(t.shadow)
  const effects = normalizeEffects(t.effects)
  const effectsOn = effectsActive(effects)
  // 'performance: off' neutralizes the GPU-heavy effects (blur, grain) while
  // keeping the light ones — the editor can detect and offer this.
  const perfOff = effects.performance === 'off'
  const blur = perfOff ? 0 : effects.blur
  const grain = perfOff ? 0 : effects.grain

  // The glow joins the elevation shadow inside --fbt-shadow, so both coexist.
  let fbtShadow = shadowToCss(t.shadow, t.tokens?.accent)
  if (effectsOn && effects.glow > 0) {
    const glow = `0 0 ${Math.round(effects.glow * 28)}px ${rgba(vars['--brand'], (effects.glow * 0.55).toFixed(2))}`
    fbtShadow = fbtShadow === 'none' ? glow : `${fbtShadow}, ${glow}`
  }

  const parts = [`color-scheme: ${t.colorScheme === 'light' ? 'light' : 'dark'} !important`]
  for (const [key, value] of Object.entries(vars)) parts.push(`${key}: ${value} !important`)
  parts.push(`--fbt-radius: ${shape.radius}px !important`)
  parts.push(`--fbt-border-width: ${shape.borderWidth}px !important`)
  parts.push(`--fbt-border-opacity: ${shape.borderOpacity} !important`)
  parts.push(`--fbt-shadow: ${fbtShadow} !important`)
  // VS9 — the theme tokens exposed as stable CSS variables for the Advanced
  // editor: `background: var(--theme-surface)`, `border-radius: var(--theme-radius)`,
  // etc. This is the documented API between custom CSS and the theme model.
  parts.push(`--theme-background: ${vars['--bg']} !important`)
  parts.push(`--theme-surface: ${vars['--surface']} !important`)
  parts.push(`--theme-text: ${vars['--text']} !important`)
  parts.push(`--theme-text-muted: ${vars['--muted']} !important`)
  parts.push(`--theme-border: ${vars['--border']} !important`)
  parts.push(`--theme-accent: ${vars['--brand']} !important`)
  parts.push(`--theme-radius: ${shape.radius}px !important`)
  parts.push(`--theme-border-width: ${shape.borderWidth}px !important`)
  parts.push(`--theme-border-opacity: ${shape.borderOpacity} !important`)
  parts.push(`--theme-shadow: ${fbtShadow} !important`)
  let css = `:root{${parts.join(';')}}`

  // The global surface rule — shape (VS4) + effects (VS5) contribute their
  // declarations to the same rule, on the app's surfaces. Only the properties
  // the user actually set are emitted (0 = inherit). It comes BEFORE the
  // component rules: a component override wins by cascade (same !important,
  // later in the sheet).
  const decls = {}
  if (shape.radius > 0) decls['border-radius'] = 'var(--fbt-radius) !important'
  if (shape.borderWidth > 0) decls['border-width'] = 'var(--fbt-border-width) !important'
  if (shape.borderOpacity < 1) decls['border-color'] = `${rgba(vars['--border'], shape.borderOpacity)} !important`
  if (shadowLayers.length || (effectsOn && effects.glow > 0)) decls['box-shadow'] = 'var(--fbt-shadow) !important'
  if (effectsOn) {
    // Glass surfaces: translucent background + backdrop blur (when allowed).
    const bg = effects.gradient > 0
      ? `linear-gradient(135deg, ${rgba(vars['--brand'], (effects.gradient * 0.12).toFixed(3))}, transparent 60%), ${rgba(vars['--surface'], effects.transparency)}`
      : rgba(vars['--surface'], effects.transparency)
    decls['background'] = `${bg} !important`
    if (effects.borderTranslucency < 1) {
      decls['border-color'] = `${rgba(vars['--border'], effects.borderTranslucency)} !important`
    }
    if (blur > 0) {
      const bf = `blur(${blur}px) saturate(${effects.saturation}) brightness(${effects.brightness})`
      decls['-webkit-backdrop-filter'] = `${bf} !important`
      decls['backdrop-filter'] = `${bf} !important`
    }
    if (grain > 0) {
      decls['background-image'] =
        `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncA type='linear' slope='${(grain * 0.18).toFixed(3)}'/></feComponentTransfer></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>") !important`
    }
  }
  const declEntries = Object.entries(decls)
  if (declEntries.length) css += `\n${SHAPE_SELECTORS}{${declEntries.map(([k, v]) => `${k}: ${v}`).join(';')}}`
  // VS6 — motion: one transition for every surface + per-state transforms
  // + enter animations for new chat messages. Minimal (or an all-default
  // motion) emits nothing, so the app keeps its own behavior.
  // VS7 — the global scale (speed × duration, intensity × transforms) is
  // applied here: one setting makes the whole app faster/slower/discreeter.
  const motionRaw = normalizeMotion(t.motion)
  const motion = motionEffective(motionRaw)
  if (motionActive(motion)) {
    css += `\n${SHAPE_SELECTORS}{transition: ${motionTransitionCss(motion)};transition-delay: ${motion.delay}ms !important}`
    if (motion.hover.translateY !== 0 || motion.hover.scale !== 1) {
      css += `\n${surfaceStateSelector(':hover')}{transform: ${motionTransform(motion.hover)} !important}`
    }
    if (motion.active.scale !== 1) {
      css += `\n${surfaceStateSelector(':active')}{transform: ${motionTransform(motion.active)} !important}`
    }
    if (motion.focus.scale !== 1) {
      css += `\n${surfaceStateSelector(':focus, :focus-visible')}{transform: ${motionTransform(motion.focus)} !important}`
    }
    if (motion.enter) {
      css += '\n@keyframes fbt-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'
      css += `\n.bubble, .msg, [data-message]{animation: fbt-enter ${motion.duration}ms ${motion.easing} both !important}`
    }
    // Reduced motion (VS7): when the OS asks for less motion, kill the
    // transitions/animations we added — the app keeps its own behavior.
    if (motionRaw.global.reduced !== 'off') {
      css += `\n@media (prefers-reduced-motion: reduce){${SHAPE_SELECTORS}, .bubble, .msg, [data-message]{animation: none !important;transition: none !important;transition-delay: 0ms !important}}`
    }
  }
  css += componentCss(t.components, t.tokens)
  // VS9 — the user's own CSS, appended LAST so it wins over the generated
  // rules. It lives inside the injected <style>, so it is scoped to the
  // Freebuff document and removed when the theme is deactivated. The
  // 'surfaces' scope restricts it to the app's themed surfaces.
  const extra = t.extraCss || ''
  if (extra) css += `\n${t.cssScope === 'surfaces' ? scopeCss(extra, SHAPE_SELECTORS) : extra}`
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
    shape: normalizeShape(raw?.shape ?? fallback.shape),
    shadow: { layers: normalizeShadowLayers(raw?.shadow ?? fallback.shadow) },
    effects: normalizeEffects(raw?.effects ?? fallback.effects),
    motion: normalizeMotion(raw?.motion ?? fallback.motion),
    extraCss: sanitizeCustomCss(raw?.extraCss ?? fallback.extraCss ?? ''),
    cssScope: (raw?.cssScope ?? fallback?.cssScope) === 'surfaces' ? 'surfaces' : 'app',
  }
}
