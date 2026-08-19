/**
 * test/theme-model.mjs — Unit tests for the VS1 theme model.
 *
 * Verifies the architectural promise of VS1: a theme is DATA (tokens), the
 * CSS is a GENERATED representation, and editing ONE token produces coherent
 * changes in the generated variables (the Definition of Done at the CSS level)
 * — plus the storage round-trip and reset logic.
 *
 * Usage : node test/theme-model.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  COMPONENT_KEYS,
  COMPONENT_STATES,
  COMPONENT_STATE_SELECTORS,
  DEFAULT_SHAPE,
  DEFAULT_TOKENS,
  EFFECT_PRESETS,
  MOTION_PRESETS,
  SHAPE_PRESETS,
  TOKEN_KEYS,
  componentCss,
  componentDefaults,
  componentEffective,
  matchComponent,
  darken,
  effectCost,
  effectsActive,
  lighten,
  mixHex,
  motionActive,
  motionEffective,
  motionTransitionCss,
  normalizeComponentOverrides,
  normalizeEffects,
  normalizeMotion,
  normalizeShadowLayers,
  normalizeShape,
  normalizeStateOverrides,
  normalizeTheme,
  parseHex,
  resolveShapePreset,
  sanitizeCustomCss,
  scopeCss,
  shadowToCss,
  themeToCss,
  tokenVars,
  validEasing,
  validateCustomCss,
} from '../lib/theme-model.mjs'
import { listUserThemes, readUserTheme, safeThemeId, saveUserTheme, userThemesDir } from '../lib/theme-store.mjs'

// Isolated store: user themes written to a temp dir, never the real config.
process.env.FREEBUFF_THEMER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-themer-model-'))

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// 1. The 6 tokens exist and have defaults.
check('6 tokens de design définis', TOKEN_KEYS.length === 6, TOKEN_KEYS.join(','))
check('tous les tokens par défaut sont des hex valides', TOKEN_KEYS.every((k) => parseHex(DEFAULT_TOKENS[k])))

// 2. The generator maps every token to a coherent family of CSS variables.
const vars = tokenVars(DEFAULT_TOKENS, 'dark')
const expectedVars = ['--bg', '--chrome', '--surface', '--surface-2', '--raised', '--text', '--accent', '--muted', '--faint', '--accent-dim', '--border', '--brand', '--brand-dim', '--ok', '--green', '--danger', '--warn', '--premium', '--shadow']
check('le générateur produit toutes les variables de l\u2019app', expectedVars.every((v) => v in vars), Object.keys(vars).join(','))

// 3. DoD proof: ONE token change → several coherent places change.
const t1 = { ...DEFAULT_TOKENS, accent: '#ff0000' }
const t2 = { ...DEFAULT_TOKENS, accent: '#00ff88' }
const v1 = tokenVars(t1, 'dark')
const v2 = tokenVars(t2, 'dark')
const changed = Object.keys(v2).filter((k) => v1[k] !== v2[k])
check('changer le token accent modifie plusieurs variables à la fois', changed.length >= 4, changed.join(','))
check('--brand suit exactement le token accent', v2['--brand'] === '#00ff88', v2['--brand'])
check('--brand-dim est dérivé du token accent', v2['--brand-dim'] === darken('#00ff88', 0.22), v2['--brand-dim'])
check('--ok et --green suivent aussi le token accent', v2['--ok'] === '#00ff88' && v2['--green'] === '#00ff88')

// 4. The surface family derives from the surface token.
check('--surface-2 est dérivé de --surface', v2['--surface-2'] === lighten(DEFAULT_TOKENS.surface, 0.05), v2['--surface-2'])
check('--raised est dérivé de --surface', v2['--raised'] === lighten(DEFAULT_TOKENS.surface, 0.11), v2['--raised'])

// 5. Light scheme flips the derivation directions.
const lv = tokenVars({ ...DEFAULT_TOKENS, surface: '#ffffff', background: '#fafaf9' }, 'light')
check('thème clair : les surfaces s\u2019assombrissent au lieu de s\u2019éclaircir', lv['--surface-2'] === darken('#ffffff', 0.04), lv['--surface-2'])

// 6. themeToCss generates a :root stylesheet from the model.
const css = themeToCss({ colorScheme: 'dark', tokens: t2, extraCss: '/* x */' })
check('la CSS générée est un bloc :root', css.startsWith(':root{'), css.slice(0, 30))
check('color-scheme est généré', css.includes('color-scheme: dark !important'))
check('l\u2019extraCss est appendé', css.endsWith('/* x */'))
const css2 = themeToCss({ colorScheme: 'dark', tokens: t2 })
check('sans extraCss, aucune règle en plus', !css2.includes('/*'))

// 7. normalizeTheme validates and pads.
const n = normalizeTheme({ id: 'x', tokens: { accent: '#123456', background: 'not-a-color' } })
check('les tokens invalides retombent sur les valeurs par défaut', n.tokens.background === DEFAULT_TOKENS.background, n.tokens.background)
check('les tokens manquants sont complétés', n.tokens.text === DEFAULT_TOKENS.text)
check('les tokens valides sont conservés', n.tokens.accent === '#123456')

// 8. Storage round-trip.
const theme = {
  id: 'my-theme',
  name: 'My Theme',
  description: 'test',
  colorScheme: 'dark',
  base: 'default',
  tokens: { ...DEFAULT_TOKENS, accent: '#abcdef' },
  extraCss: '',
}
saveUserTheme(theme)
check('le thème est écrit dans notre répertoire', fs.existsSync(path.join(userThemesDir(), 'my-theme.json')))
const loaded = readUserTheme('my-theme')
check('lecture du thème sauvegardé', loaded && loaded.tokens.accent === '#abcdef' && loaded.base === 'default')
check('le thème apparaît dans la liste', listUserThemes().some((t) => t.id === 'my-theme'))
check('safeThemeId neutralise les chemins', safeThemeId('../../evil') === 'evil')

// 9. Reset: restore the base theme's tokens.
const reset = normalizeTheme({ ...theme, tokens: { ...DEFAULT_TOKENS, accent: '#999999' } })
check('reset ramène les tokens du thème de base', reset.tokens.accent === '#999999')

/* ------------------------------------------------------------------ */
/* VS2 — component theming                                             */
/* ------------------------------------------------------------------ */

// 10. The generator emits a scoped rule per component, only for overridden
//     properties — untouched components stay inherited.
const cc = componentCss({
  button: { background: '#ff00aa', radius: 12 },
  input: { background: '#00ff88' },
})
// A component color drives the WHOLE variable family the real app uses for
// that role (e.g. buttons draw their background from the surface family), so
// an override is visible on the real Freebuff — still scoped per component.
check(
  'le bouton émet une règle scopée avec ses overrides (famille de variables)',
  cc.includes('button{--surface: #ff00aa !important;--surface-2: #ff00aa !important;--raised: #ff00aa !important;border-radius: 12px !important}'),
  cc,
)
check(
  'l\u2019input émet sa propre règle scopée',
  cc.includes('input, textarea, select{--surface: #00ff88 !important;--surface-2: #00ff88 !important;--raised: #00ff88 !important}'),
  cc,
)
check('seules les propriétés surchargées sont émises', !cc.includes('border-width') && !cc.includes('box-shadow') && !cc.includes('--text'), cc)
check('sans override, aucun composant n\u2019émet de règle', componentCss({}) === '' && componentCss(undefined) === '' && componentCss(null) === '')

// 11. Shadow presets are data.
const ccShadow = componentCss({ card: { shadow: 'strong' } })
check('le preset shadow génère box-shadow', ccShadow.includes('.card, .bubble, .msg{box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important}'), ccShadow)
const ccNone = componentCss({ card: { shadow: 'none' } })
check('shadow "none" est explicite', ccNone.includes('box-shadow: none !important'), ccNone)

// 12. themeToCss includes the component rules after the :root block.
const css3 = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, components: { button: { radius: 10 } } })
check('themeToCss inclut la CSS des composants', css3.includes(':root{') && css3.includes('\nbutton{border-radius: 10px !important}'), css3)
const css4 = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS })
check('sans composants, aucune règle de composant', !css4.includes('button{') && !css4.includes('border-radius'))

// 13. Override validation.
const ov = normalizeComponentOverrides({
  background: 'not-a-color',
  radius: 999,
  borderWidth: -3,
  accent: '#123456',
  shadow: 'bogus',
  unknownProp: '#ffffff',
})
check('les overrides invalides sont filtrés', Object.keys(ov).length === 1 && ov.accent === '#123456', JSON.stringify(ov))
check('les 5 composants sont définis', COMPONENT_KEYS.length === 5, COMPONENT_KEYS.join(','))

// 14. normalizeTheme keeps valid component overrides, drops invalid ones.
const nt = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, components: { button: { radius: 8 }, card: { borderWidth: 2 }, modal: { radius: 500 } } })
check('les overrides valides sont conservés', nt.components.button.radius === 8 && nt.components.card.borderWidth === 2)
check('les overrides invalides sont ignorés', !('modal' in nt.components), JSON.stringify(nt.components))
check('sans composants, l\u2019objet est vide', Object.keys(normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).components).length === 0)

// 15. Component defaults derive from the global tokens (inheritance).
const cd = componentDefaults(DEFAULT_TOKENS)
check('les défauts dérivent des tokens globaux', cd.background === DEFAULT_TOKENS.surface && cd.accent === DEFAULT_TOKENS.accent && cd.radius === 6 && cd.borderWidth === 1)

/* ------------------------------------------------------------------ */
/* VS3 — component states                                              */
/* ------------------------------------------------------------------ */

// 16. The five states exist with their selector suffixes.
check('les 5 états sont définis', COMPONENT_STATES.join(',') === 'hover,active,focus,disabled,loading', COMPONENT_STATES.join(','))
check('le sélecteur hover est un pseudo-classe', COMPONENT_STATE_SELECTORS.hover === ':hover', COMPONENT_STATE_SELECTORS.hover)
check('le sélecteur focus couvre souris + clavier', COMPONENT_STATE_SELECTORS.focus === ':focus, :focus-visible', COMPONENT_STATE_SELECTORS.focus)
check('le sélecteur disabled couvre les deux formes', COMPONENT_STATE_SELECTORS.disabled === ':disabled, [disabled]', COMPONENT_STATE_SELECTORS.disabled)
check('le sélecteur loading couvre les marqueurs courants', COMPONENT_STATE_SELECTORS.loading.includes('.loading') && COMPONENT_STATE_SELECTORS.loading.includes('[aria-busy="true"]'), COMPONENT_STATE_SELECTORS.loading)

// 17. State overrides are validated like component overrides.
const st = normalizeStateOverrides({ background: '#ff00aa', text: 'not-a-color', shadow: 'bogus', unknown: '#ffffff' })
check('les overrides d\u2019état valides sont conservés', st.background === '#ff00aa' && Object.keys(st).length === 1, JSON.stringify(st))
check('les états sans override sont ignorés', normalizeStateOverrides({}) === null || Object.keys(normalizeStateOverrides({})).length === 0)
check('normalizeStateOverrides(undefined) est vide', Object.keys(normalizeStateOverrides(undefined)).length === 0)

// 18. normalizeComponentOverrides keeps the states sub-object (validated).
const ov2 = normalizeComponentOverrides({
  background: '#ff00aa',
  states: {
    hover: { background: '#00ff88', text: 'bogus', shadow: 'soft' },
    active: { text: '#0000ff' },
    loading: { background: '#123456' },
    bogus: { background: '#ffffff' },
    focus: {},
  },
})
check('seuls les états valides sont conservés', ov2.states && ov2.states.hover && ov2.states.active && ov2.states.loading && !ov2.states.bogus && !ov2.states.focus, JSON.stringify(ov2.states))
check('les valeurs d\u2019état invalides sont filtrées', ov2.states.hover.background === '#00ff88' && ov2.states.hover.shadow === 'soft' && !('text' in ov2.states.hover), JSON.stringify(ov2.states.hover))
check('sans état, pas de clé states', !('states' in normalizeComponentOverrides({ background: '#ff00aa' })))

// 19. VS3 CSS — DoD : l\u2019état hover modifie UNIQUEMENT le bouton survolé,
//     la règle de base (état normal) reste inchangée.
const cssStates = componentCss({
  button: {
    background: '#ff00aa',
    states: {
      hover: { background: '#00ff88', shadow: 'soft' },
      disabled: { text: '#999999' },
    },
  },
})
check(
  'l\u2019état hover émet une règle scopée (famille de variables + ombre)',
  cssStates.includes('button:hover{--surface: #00ff88 !important;--surface-2: #00ff88 !important;--raised: #00ff88 !important;box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25) !important}'),
  cssStates,
)
check(
  'la règle de base (état normal) est inchangée',
  cssStates.includes('button{--surface: #ff00aa !important;--surface-2: #ff00aa !important;--raised: #ff00aa !important}'),
  cssStates,
)
check(
  'l\u2019état disabled n\u2019émet que sa propriété surchargée',
  cssStates.includes('button:disabled, button[disabled]{--text: #999999 !important;--muted: #999999 !important;--faint: #999999 !important}'),
  cssStates,
)
check('les sélecteurs d\u2019état sont scopés au composant', cssStates.includes('button:active{') === false && cssStates.includes('button[data-loading]') === false, cssStates)

// 20. themeToCss includes the state rules after the base rule.
const css5 = themeToCss({
  colorScheme: 'dark',
  tokens: DEFAULT_TOKENS,
  components: { button: { states: { active: { background: '#ff0000' } } } },
})
check(
  'themeToCss inclut la règle d\u2019état',
  css5.includes('\nbutton:active{--surface: #ff0000 !important;--surface-2: #ff0000 !important;--raised: #ff0000 !important}'),
  css5,
)

// 21. Round-trip: normalizeTheme keeps the states.
const nt2 = normalizeTheme({
  id: 'x',
  tokens: DEFAULT_TOKENS,
  components: { button: { states: { hover: { background: '#abcdef', shadow: 'strong' } } } },
})
check(
  'normalizeTheme conserve les états',
  nt2.components.button.states.hover.background === '#abcdef' && nt2.components.button.states.hover.shadow === 'strong',
  JSON.stringify(nt2.components),
)
const nt3 = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, components: { button: { states: { hover: { background: 'bogus' } } } } })
// A component whose ONLY override is invalid is dropped entirely — nothing survives.
check(
  'les états invalides ne survivent pas au round-trip',
  !nt3.components.button || !('states' in nt3.components.button),
  JSON.stringify(nt3.components),
)

// 22. A state override equal to nothing is dropped: empty state \u2192 no CSS.
const cssEmpty = componentCss({ button: { states: { hover: {} } } })
check('un état sans override n\u2019émet aucune règle', !cssEmpty.includes(':hover'), cssEmpty)

/* ------------------------------------------------------------------ */
/* VS4 — shapes + shadows                                              */
/* ------------------------------------------------------------------ */

// 23. The global shape is validated + clamped.
const sh = normalizeShape({ radius: 999, borderWidth: -3, borderOpacity: 2 })
check('les valeurs shape hors bornes sont clampées', sh.radius === 48 && sh.borderWidth === 0 && sh.borderOpacity === 1, JSON.stringify(sh))
check('les valeurs par défaut (0 = héritage) sont préservées', normalizeShape(undefined).radius === DEFAULT_SHAPE.radius && normalizeShape(null).borderOpacity === 1)
check('un shape partiel est complété', normalizeShape({ radius: 12 }).borderWidth === 0 && normalizeShape({ radius: 12 }).borderOpacity === 1)

// 24. Shadow layers are validated; invalid ones are dropped.
const layers = normalizeShadowLayers([
  { x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.25, inner: false },
  { x: 'a', y: 1, blur: 4, spread: 0, color: '#ffffff', opacity: 0.5 },
  { x: 0, y: 0, blur: 4, spread: 0, color: 'not-a-color', opacity: 0.5 },
])
check('seules les couches valides survivent', layers.length === 1 && layers[0].color === '#000000', JSON.stringify(layers))
check('une liste vide → aucune couche', normalizeShadowLayers([]).length === 0 && normalizeShadowLayers(undefined).length === 0)
check('les valeurs hors bornes sont clampées', normalizeShadowLayers([{ x: 99, y: -99, blur: 200, spread: -99, color: '#000000', opacity: 5, inner: 1 }])[0].x === 40 && normalizeShadowLayers([{ x: 0, y: 0, blur: 0, spread: 0, color: '#000000', opacity: 0.3 }])[0].opacity === 0.3)

// 25. shadowToCss renders single / multiple / inner layers.
check('une couche simple → un box-shadow', shadowToCss([{ x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.25 }]) === '0px 2px 8px 0px rgba(0, 0, 0, 0.25)', shadowToCss([{ x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.25 }]))
check('plusieurs couches → ombres séparées par des virgules', shadowToCss([{ x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.3 }, { x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.2 }]).includes('0.3), 0px 4px 12px 0px rgba(0, 0, 0, 0.2)'))
check('inner → préfixe inset', shadowToCss([{ x: 0, y: 0, blur: 4, spread: 0, color: '#000000', opacity: 0.5, inner: true }]).startsWith('inset '))
check('aucune couche → none', shadowToCss([]) === 'none' && shadowToCss(undefined) === 'none')

// 26. The 5 named presets resolve to concrete shape + shadow data, and the
//     neon 'ACCENT' color becomes the theme's actual accent.
check('les 5 presets existent', Object.keys(SHAPE_PRESETS).join(',') === 'flat,soft,floating,deep,neon')
const flat = resolveShapePreset('flat', '#7cff3f')
check('flat → pas d\u2019ombre, petit rayon', flat.shadow.layers.length === 0 && flat.shape.radius === 2)
const neon = resolveShapePreset('neon', '#50fa7b')
check('neon → la couleur ACCENT devient l\u2019accent du thème', neon.shadow.layers.every((l) => l.color === '#50fa7b'), JSON.stringify(neon.shadow))
check('neon → inclut une couche inner', neon.shadow.layers.some((l) => l.inner))
const float = resolveShapePreset('floating', '#7cff3f')
check('floating → 2 couches, rayon 14', float.shadow.layers.length === 2 && float.shape.radius === 14)

// 27. themeToCss emits the --fbt-* variables + the global shape rule BEFORE
//     the component rules (so a component override wins by cascade).
const cssShape = themeToCss({
  colorScheme: 'dark',
  tokens: DEFAULT_TOKENS,
  shape: { radius: 14, borderWidth: 2, borderOpacity: 0.5 },
  shadow: { layers: [{ x: 0, y: 10, blur: 28, spread: -6, color: '#000000', opacity: 0.4, inner: false }] },
  components: { button: { radius: 4 } },
})
check('les variables --fbt-* sont émises dans :root', cssShape.includes('--fbt-radius: 14px') && cssShape.includes('--fbt-border-width: 2px') && cssShape.includes('--fbt-border-opacity: 0.5'), cssShape.slice(0, 200))
check('l\u2019ombre multi-couches est émise', cssShape.includes('--fbt-shadow: 0px 10px 28px -6px rgba(0, 0, 0, 0.4) !important'), cssShape)
check('la règle shape globale s\u2019applique aux surfaces', cssShape.includes('button,input,textarea,select,.card,.bubble,.msg,aside,.sidebar,.modal,[role="dialog"]{border-radius: var(--fbt-radius) !important;border-width: var(--fbt-border-width) !important;border-color: rgba(42, 42, 46, 0.5) !important;box-shadow: var(--fbt-shadow) !important}'), cssShape)
check('la règle shape est AVANT les règles composants', cssShape.indexOf('{border-radius: var(--fbt-radius)') < cssShape.indexOf('button{border-radius: 4px !important}'), cssShape)

// 28. 0 = inherit: with the default shape, NO shape rule is emitted — the app
//     keeps its own radius/border/shadow, so activating a theme never
//     silently restyles the app's look.
const cssFlat = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS })
check('shape par défaut → aucune règle shape globale', !cssFlat.includes('--fbt-radius') || !cssFlat.includes('border-radius: var(--fbt-radius)'), cssFlat)
const cssRadiusOnly = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, shape: { radius: 12 } })
check('seul le rayon est émis quand le reste est à l\u2019héritage', cssRadiusOnly.includes('border-radius: var(--fbt-radius) !important') && !cssRadiusOnly.includes('border-width: var(--fbt-border-width)') && !cssRadiusOnly.includes('box-shadow: var(--fbt-shadow)'), cssRadiusOnly)

// 29. Round-trip: normalizeTheme keeps shape + shadow.
const nt4 = normalizeTheme({
  id: 'x',
  tokens: DEFAULT_TOKENS,
  shape: { radius: 16, borderWidth: 2, borderOpacity: 0.7 },
  shadow: { layers: [{ x: 0, y: 0, blur: 12, spread: 0, color: '#ff00aa', opacity: 0.5, inner: true }] },
})
check('normalizeTheme conserve shape', nt4.shape.radius === 16 && nt4.shape.borderWidth === 2 && nt4.shape.borderOpacity === 0.7, JSON.stringify(nt4.shape))
check('normalizeTheme conserve l\u2019ombre', nt4.shadow.layers.length === 1 && nt4.shadow.layers[0].color === '#ff00aa' && nt4.shadow.layers[0].inner === true, JSON.stringify(nt4.shadow))
check('normalizeTheme remplit les défauts', normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).shape.radius === 0 && normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).shadow.layers.length === 0)
const nt5 = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, shadow: { layers: [{ x: 0, y: 0, blur: 5, spread: 0, color: 'bogus', opacity: 0.5 }] } })
check('une couche invalide ne survit pas au round-trip', nt5.shadow.layers.length === 0, JSON.stringify(nt5.shadow))

/* ------------------------------------------------------------------ */
/* VS5 — glass & visual effects                                        */
/* ------------------------------------------------------------------ */

// The glass rule targets the same surface selector list as the shape rule.
const SHAPE_SELECTORS_CHECK = 'button,input,textarea,select,.card,.bubble,.msg,aside,.sidebar,.modal,[role="dialog"]'

// 30. The five effect presets exist with the spec names.
check('les 5 presets d\u2019effets existent', Object.keys(EFFECT_PRESETS).join(',') === 'none,subtle,frosted,strong,important')
check('frosted est activé avec du flou', EFFECT_PRESETS.frosted.enabled && EFFECT_PRESETS.frosted.blur === 14 && EFFECT_PRESETS.frosted.transparency === 0.78)
check('none désactive les effets', EFFECT_PRESETS.none.enabled === false)

// 31. normalizeEffects validates + clamps.
const ef = normalizeEffects({ enabled: 1, transparency: 9, blur: -5, saturation: 0.1, brightness: 3, borderTranslucency: 0, glow: 2, gradient: -1, grain: 0.5, performance: 'bogus' })
check('les valeurs hors bornes sont clampées', ef.transparency === 1 && ef.blur === 0 && ef.saturation === 0.5 && ef.brightness === 1.5 && ef.borderTranslucency === 0 && ef.glow === 1 && ef.gradient === 0 && ef.grain === 0.5, JSON.stringify(ef))
check('un mode invalide retombe sur none', ef.mode === 'none' && ef.performance === 'auto')
check('les défauts sont remplis', normalizeEffects(undefined).transparency === 1 && normalizeEffects(null).enabled === false && normalizeEffects({}).blur === 0)
check('le mode est conservé s\u2019il est valide', normalizeEffects({ mode: 'frosted', blur: 10 }).mode === 'frosted')

// 32. effectsActive / effectCost detect the heavy effects.
check('désactivé → aucun effet actif', effectsActive({ enabled: false, blur: 14 }) === false)
check('transparence → effets actifs', effectsActive({ enabled: true, transparency: 0.8 }))
check('tout par défaut → inactif', effectsActive({ enabled: true }) === false)
check('blur → heavy', effectCost({ enabled: true, blur: 14 }).level === 'heavy' && effectCost({ enabled: true, blur: 14 }).heavy.includes('backdrop blur'))
check('grain → heavy', effectCost({ enabled: true, grain: 0.3 }).heavy.includes('noise grain'))
check('glow seul → light', effectCost({ enabled: true, glow: 0.2 }).level === 'light')
check('désactivé → none', effectCost({ enabled: false }).level === 'none')

// 33. VS5 DoD — one coherent glass style on several components, no CSS.
const cssGlass = themeToCss({
  colorScheme: 'dark',
  tokens: DEFAULT_TOKENS,
  effects: { enabled: true, mode: 'frosted', transparency: 0.78, blur: 14, saturation: 1.2, brightness: 1.05, borderTranslucency: 0.4 },
})
check('glass → fond translucide sur les surfaces', cssGlass.includes('background: rgba(21, 21, 23, 0.78) !important'), cssGlass)
check('glass → bordure translucide', cssGlass.includes('border-color: rgba(42, 42, 46, 0.4) !important'), cssGlass)
check('glass → backdrop blur + saturation + brightness', cssGlass.includes('backdrop-filter: blur(14px) saturate(1.2) brightness(1.05) !important') && cssGlass.includes('-webkit-backdrop-filter: blur(14px) saturate(1.2) brightness(1.05) !important'), cssGlass)
check('glass s\u2019applique à tous les composants à la fois', cssGlass.includes(SHAPE_SELECTORS_CHECK), cssGlass)

// 34. Effects off → no glass declaration at all.
const cssNoFx = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, effects: { enabled: false, blur: 14 } })
check('effets désactivés → aucune règle glass', !cssNoFx.includes('backdrop-filter') && !cssNoFx.includes('rgba(21, 21, 23'), cssNoFx)

// 35. performance 'off' neutralizes blur + grain but keeps light effects.
const cssPerf = themeToCss({
  colorScheme: 'dark',
  tokens: DEFAULT_TOKENS,
  effects: { enabled: true, mode: 'frosted', transparency: 0.8, blur: 14, saturation: 1.2, brightness: 1.05, grain: 0.3, performance: 'off' },
})
check('perf off → plus de backdrop blur', !cssPerf.includes('backdrop-filter'), cssPerf)
check('perf off → plus de grain', !cssPerf.includes('feTurbulence'), cssPerf)
check('perf off → la transparence reste', cssPerf.includes('background: rgba(21, 21, 23, 0.8) !important'), cssPerf)

// 36. Glow joins the elevation shadow; gradient + grain add layers.
const cssGlow = themeToCss({
  colorScheme: 'dark',
  tokens: { ...DEFAULT_TOKENS, accent: '#7cff3f' },
  shadow: { layers: [{ x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 0.3, inner: false }] },
  effects: { enabled: true, glow: 0.3, gradient: 0.4, grain: 0.2 },
})
check('glow → ombre combinée (élévation + halo accent)', cssGlow.includes('--fbt-shadow: 0px 4px 12px 0px rgba(0, 0, 0, 0.3), 0 0 8px rgba(124, 255, 63, 0.17) !important'), cssGlow)
check('gradient → dégradé accent sur le fond glass', cssGlow.includes('background: linear-gradient(135deg, rgba(124, 255, 63, 0.048), transparent 60%), rgba(21, 21, 23, 1) !important'), cssGlow)
check('grain → bruit SVG en background-image', cssGlow.includes('background-image: url("data:image/svg+xml;utf8,<svg') && cssGlow.includes('feTurbulence'), cssGlow)

// 37. Round-trip: normalizeTheme keeps the effects.
const nt6 = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, effects: { enabled: true, mode: 'frosted', transparency: 0.7, blur: 18, grain: 0.1, performance: 'off' } })
check('normalizeTheme conserve les effets', nt6.effects.enabled && nt6.effects.mode === 'frosted' && nt6.effects.blur === 18 && nt6.effects.performance === 'off', JSON.stringify(nt6.effects))
check('normalizeTheme remplit les défauts d\u2019effets', normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).effects.enabled === false)

/* ------------------------------------------------------------------ */
/* VS6 — motion engine                                                 */
/* ------------------------------------------------------------------ */

// 38. The four motion presets exist with the spec names.
check('les 4 presets motion existent', Object.keys(MOTION_PRESETS).join(',') === 'minimal,smooth,snappy,bouncy')
check('smooth : 200ms ease-out, hover translateY -2', MOTION_PRESETS.smooth.duration === 200 && MOTION_PRESETS.smooth.easing === 'ease-out' && MOTION_PRESETS.smooth.hover.translateY === -2)
check('minimal : durée 0, pas d\u2019entrée', MOTION_PRESETS.minimal.duration === 0 && MOTION_PRESETS.minimal.enter === false)
check('bouncy : courbe rebondissante', MOTION_PRESETS.bouncy.easing === 'cubic-bezier(0.34, 1.56, 0.64, 1)')

// 39. Easing validation accepts named + cubic-bezier, rejects garbage.
check('easing nommés acceptés', ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'].every((e) => validEasing(e)))
check('cubic-bezier accepté', validEasing('cubic-bezier(0.2, 0.8, 0.2, 1)') !== null)
check('easing invalide rejeté', validEasing('bouncy') === null && validEasing('') === null)

// 40. normalizeMotion validates + clamps.
const mo = normalizeMotion({ duration: 9999, easing: 'bogus', delay: -3, hover: { translateY: 99, scale: 5 }, active: { scale: 0 }, enter: 1 })
check('les valeurs hors bornes sont clampées', mo.duration === 2000 && mo.delay === 0 && mo.hover.translateY === 40 && mo.hover.scale === 2 && mo.active.scale === 0.5 && mo.enter === true, JSON.stringify(mo))
check('l\u2019easing invalide retombe sur ease', mo.easing === 'ease')
check('les défauts sont remplis (minimal)', normalizeMotion(undefined).duration === 0 && normalizeMotion(null).preset === 'minimal')
check('un preset valide est conservé', normalizeMotion({ preset: 'bouncy' }).preset === 'bouncy')

// 41. motionActive: Minimal emits nothing, Smooth emits.
check('minimal → aucun motion', motionActive(MOTION_PRESETS.minimal) === false)
check('smooth → motion actif', motionActive(MOTION_PRESETS.smooth) === true)
check('durée 0 → aucun motion même avec transforms', motionActive({ duration: 0, hover: { translateY: -4, scale: 1.04 } }) === false)

// 42. VS6 DoD — the motion preset changes the animated behavior of the
//     app's surfaces: one transition + per-state transforms + enter.
const cssMotion = themeToCss({
  colorScheme: 'dark',
  tokens: DEFAULT_TOKENS,
  motion: MOTION_PRESETS.smooth,
})
check('motion → transition sur les surfaces', cssMotion.includes('{transition: background-color 200ms ease-out, color 200ms ease-out, border-color 200ms ease-out, box-shadow 200ms ease-out, transform 200ms ease-out, backdrop-filter 200ms ease-out, opacity 200ms ease-out !important;transition-delay: 0ms !important}'), cssMotion)
check('motion → hover transformé (translateY + scale)', cssMotion.includes('button:hover, input:hover, textarea:hover, select:hover, .card:hover, .bubble:hover, .msg:hover, aside:hover, .sidebar:hover, .modal:hover, [role="dialog"]:hover{transform: translateY(-2px) scale(1.02) !important}'), cssMotion)
check('motion → active écrasé', cssMotion.includes('button:active, input:active, textarea:active, select:active, .card:active, .bubble:active, .msg:active, aside:active, .sidebar:active, .modal:active, [role="dialog"]:active{transform: scale(0.97) !important}'), cssMotion)
check('motion → focus (souris + clavier)', cssMotion.includes('button:focus, button:focus-visible, input:focus, input:focus-visible, textarea:focus, textarea:focus-visible, select:focus, select:focus-visible, .card:focus, .card:focus-visible, .bubble:focus, .bubble:focus-visible, .msg:focus, .msg:focus-visible, aside:focus, aside:focus-visible, .sidebar:focus, .sidebar:focus-visible, .modal:focus, .modal:focus-visible, [role="dialog"]:focus, [role="dialog"]:focus-visible{transform: scale(1.01) !important}'), cssMotion)
check('motion → animation d\u2019entrée des messages', cssMotion.includes('@keyframes fbt-enter') && cssMotion.includes('.bubble, .msg, [data-message]{animation: fbt-enter 200ms ease-out both !important}'), cssMotion)
check('les règles motion sont scopées aux surfaces', cssMotion.includes('\n:hover{') === false && cssMotion.includes('\n:active{') === false, cssMotion)

// 43. Minimal → no motion CSS at all.
const cssMinimal = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, motion: MOTION_PRESETS.minimal })
check('minimal → aucune règle motion', !cssMinimal.includes('transition-delay') && !cssMinimal.includes('fbt-enter') && !cssMinimal.includes(':hover{'), cssMinimal)

// 44. The transition helper carries duration/easing/delay.
check('motionTransitionCss reflète la durée et l\u2019easing', motionTransitionCss({ duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }).includes('transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)'))

// 45. Round-trip: normalizeTheme keeps the motion.
const nt7 = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, motion: { preset: 'snappy', duration: 90, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', hover: { translateY: -1, scale: 1.01 }, active: { scale: 0.95 }, focus: { scale: 1.01 }, enter: true } })
check('normalizeTheme conserve le motion', nt7.motion.preset === 'snappy' && nt7.motion.duration === 90 && nt7.motion.hover.translateY === -1, JSON.stringify(nt7.motion))
check('normalizeTheme remplit les défauts de motion (minimal)', normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).motion.duration === 0 && normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).motion.preset === 'minimal')
const nt8 = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, motion: { duration: 250, hover: { translateY: 'a', scale: 99 } } })
check('un motion invalide retombe sur les défauts (ou est clampé)', nt8.motion.hover.translateY === 0 && nt8.motion.hover.scale === 2, JSON.stringify(nt8.motion))

/* ------------------------------------------------------------------ */
/* VS7 — global motion (speed / intensity / reduced-motion)            */
/* ------------------------------------------------------------------ */

// 46. normalizeMotion carries the global scale with neutral defaults.
const gm = normalizeMotion({ preset: 'smooth' })
check('global par défaut : speed 1, intensity 1, reduced auto', gm.global.speed === 1 && gm.global.intensity === 1 && gm.global.reduced === 'auto', JSON.stringify(gm.global))
const gmClamped = normalizeMotion({ preset: 'smooth', global: { speed: 99, intensity: -1, reduced: 'bogus' } })
check('le global est clampé (speed ≤ 3, intensity ≥ 0, reduced→auto)', gmClamped.global.speed === 3 && gmClamped.global.intensity === 0 && gmClamped.global.reduced === 'auto', JSON.stringify(gmClamped.global))
check('reduced: off est conservé', normalizeMotion({ global: { reduced: 'off' } }).global.reduced === 'off')

// 47. motionEffective applies the global scale to every duration + transform.
// (The stored motion always carries the concrete preset values — like the
// editor's applyMotionPreset — so the tests spread the preset first.)
const effFast = motionEffective({ ...MOTION_PRESETS.smooth, global: { speed: 2 } })
check('speed ×2 → durée 400ms', effFast.duration === 400, String(effFast.duration))
const effQuiet = motionEffective({ ...MOTION_PRESETS.smooth, global: { intensity: 0 } })
check('intensity 0 → transforms neutres (discret)', effQuiet.hover.translateY === 0 && effQuiet.hover.scale === 1 && effQuiet.active.scale === 1, JSON.stringify(effQuiet.hover))
const effLoud = motionEffective({ ...MOTION_PRESETS.smooth, global: { intensity: 2 } })
check('intensity 2 → transforms amplifiés (dynamique)', effLoud.hover.translateY === -4 && effLoud.hover.scale === 1.04 && effLoud.active.scale === 0.94, JSON.stringify(effLoud.hover))
check('speed 3 sur la durée max → bornée à 5000ms', motionEffective({ duration: 2000, global: { speed: 3 } }).duration === 5000)

// 48. VS7 DoD — one setting changes the whole app: speed scales the emitted
//     transition + enter animation, intensity cancels the hover transform.
const cssFast = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, motion: { ...MOTION_PRESETS.smooth, global: { speed: 2 } } })
check('speed ×2 → transition 400ms dans le CSS', cssFast.includes('transform 400ms ease-out') && cssFast.includes('fbt-enter 400ms ease-out'), cssFast.includes('transform 400ms'))
const cssQuiet = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, motion: { ...MOTION_PRESETS.smooth, global: { intensity: 0 } } })
check('intensity 0 → plus de règle hover, transition conservée', cssQuiet.includes(':hover{transform:') === false && cssQuiet.includes('transition: background-color 200ms'), cssQuiet.includes(':hover{transform:'))

// 49. Reduced motion: the media query is emitted by default, dropped when off.
const cssReduced = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, motion: { ...MOTION_PRESETS.smooth } })
check('prefers-reduced-motion: reduce émis par défaut', cssReduced.includes('@media (prefers-reduced-motion: reduce)') && cssReduced.includes('transition: none !important'), cssReduced)
const cssNoReduced = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, motion: { ...MOTION_PRESETS.smooth, global: { reduced: 'off' } } })
check('reduced: off → pas de media query', cssNoReduced.includes('@media (prefers-reduced-motion: reduce)') === false)
check('minimal → pas de media query non plus', !cssMinimal.includes('prefers-reduced-motion'))

// 50. Round-trip: normalizeTheme keeps the global scale.
const nt9 = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, motion: { preset: 'smooth', global: { speed: 2, intensity: 0.5, reduced: 'off' } } })
check('normalizeTheme conserve le global', nt9.motion.global.speed === 2 && nt9.motion.global.intensity === 0.5 && nt9.motion.global.reduced === 'off', JSON.stringify(nt9.motion.global))

/* ------------------------------------------------------------------ */
/* VS8 — visual element inspector                                      */
/* ------------------------------------------------------------------ */

// 51. matchComponent maps a DOM element to its theme component (VS8 DoD).
//     Stub elements: nodeType 1 + matches() over the component selectors.
const makeEl = (tag, parent) => ({
  nodeType: 1,
  tag,
  parentElement: parent || null,
  getRootNode: () => ({ host: null }),
  matches: (sel) => sel.split(',').map((s) => s.trim()).indexOf(tag) !== -1,
})
const btn = makeEl('button')
check('un <button> → button', matchComponent(btn) === 'button')
check('un <input> → input', matchComponent(makeEl('input')) === 'input')
check('un <textarea> → input (sélecteur multi)', matchComponent(makeEl('textarea')) === 'input')
check('une .card → card', matchComponent(makeEl('.card')) === 'card')
check('un aside → sidebar', matchComponent(makeEl('aside')) === 'sidebar')
check('un [role=dialog] → modal', matchComponent(makeEl('[role="dialog"]')) === 'modal')
// Walk-up: a span inside a button maps to the button.
const span = makeEl('span', btn)
check('un <span> dans un <button> → button (remontée)', matchComponent(span) === 'button')
check('un élément non mappable → null', matchComponent(makeEl('h1')) === null)
// Shadow boundary: the walk crosses getRootNode().host.
const innerBtn = makeEl('button')
const shadowSpan = makeEl('span')
shadowSpan.getRootNode = () => ({ host: innerBtn })
check('un élément dans un shadow DOM remonte vers l\u2019hôte', matchComponent(shadowSpan) === 'button')
const cardEl = makeEl('.card')
const wrapper = makeEl('div', cardEl)
const inner = makeEl('span', wrapper)
check('sans racine, la remontée atteint la .card', matchComponent(inner) === 'card')
check('la remontée s\u2019arrête à la racine donnée', matchComponent(inner, wrapper) === null)

// 52. componentEffective: overrides win, otherwise the token fallbacks.
const ce = componentEffective({ tokens: { surface: '#111111', text: '#eeeeee', border: '#333333', accent: '#00ff88' } }, 'button')
check('les valeurs retombent sur les tokens', ce.background === '#111111' && ce.text === '#eeeeee' && ce.border === '#333333' && ce.accent === '#00ff88', JSON.stringify(ce))
const ce2 = componentEffective({ tokens: DEFAULT_TOKENS, components: { button: { background: '#ff0000', radius: 12, glow: 0.5, states: { hover: { background: '#00ff00' } } } } }, 'button')
check('les overrides gagnent sur les tokens', ce2.background === '#ff0000' && ce2.radius === 12 && ce2.glow === 0.5, JSON.stringify(ce2))
check('componentEffective expose les états', ce2.states.hover.background === '#00ff00')
check('componentEffective ne lit pas le composant voisin', componentEffective({ tokens: DEFAULT_TOKENS, components: { button: { background: '#ff0000' } } }, 'input').background === DEFAULT_TOKENS.surface)

// 53. Component glow: normalized 0–1, emitted as an accent neon shadow
//     scoped to the component, combinable with the elevation shadow.
const glowTheme = { colorScheme: 'dark', tokens: { ...DEFAULT_TOKENS, accent: '#00ff88' }, components: { button: { glow: 0.5 } } }
const glowCss = themeToCss(glowTheme)
check('glow → box-shadow accent sur le composant uniquement', glowCss.includes('button{box-shadow: 0 0 14px rgba(0, 255, 136, 0.28) !important}'), glowCss)
check('glow scopé : pas de règle sur les autres composants', glowCss.includes('input{box-shadow') === false, glowCss)
const glowShadowTheme = { colorScheme: 'dark', tokens: { ...DEFAULT_TOKENS, accent: '#00ff88' }, components: { button: { shadow: 'medium', glow: 0.5 } } }
const glowShadowCss = themeToCss(glowShadowTheme)
check('glow + ombre d\u2019élévation coexistent', glowShadowCss.includes('box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 0 14px rgba(0, 255, 136, 0.28)'), glowShadowCss)
check('glow 0 → pas de règle', themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, components: { button: { glow: 0 } } }).includes('box-shadow') === false)
const ng = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, components: { button: { glow: 0.5 } } })
check('glow valide conservé par normalisation', ng.components.button && ng.components.button.glow === 0.5, JSON.stringify(ng.components.button))
const ngBad = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, components: { button: { glow: 99 } } })
check('glow hors bornes rejeté (composant abandonné)', !ngBad.components.button, JSON.stringify(ngBad.components))

/* ------------------------------------------------------------------ */
/* VS9 — Advanced CSS                                                  */
/* ------------------------------------------------------------------ */

// 54. The theme tokens are exposed as stable --theme-* CSS variables, so
//     custom CSS can consume the theme without hardcoding colors.
const advCss = themeToCss({
  colorScheme: 'dark',
  tokens: { ...DEFAULT_TOKENS, surface: '#123456', accent: '#00ff88' },
  shape: { radius: 12, borderWidth: 2, borderOpacity: 0.5 },
})
check('--theme-surface suit le token surface', advCss.includes('--theme-surface: #123456 !important'))
check('--theme-accent suit le token accent', advCss.includes('--theme-accent: #00ff88 !important'))
check('--theme-radius suit la forme', advCss.includes('--theme-radius: 12px !important'))
check('--theme-border-width suit la forme', advCss.includes('--theme-border-width: 2px !important'))
check('--theme-shadow est défini dans :root', advCss.includes('--theme-shadow: '))

// 55. validateCustomCss: valid CSS passes, dangerous/invalid is flagged with
//     line/col positions.
check('CSS vide → ok', validateCustomCss('').ok && validateCustomCss('  ').ok)
check('CSS valide (règles + @media) → ok', validateCustomCss('.a { color: red } @media (min-width: 100px) { .b { color: blue } }').ok)
check('le "<" est refusé (pas de HTML dans le CSS)', !validateCustomCss('.a { content: "</style><script>" }').ok)
const ltErr = validateCustomCss('a {\n  color: red;\n  background: url(x<y)\n}').errors[0]
check('erreur "<" avec le bon numéro de ligne', ltErr.line === 3, JSON.stringify(ltErr))
check('@import est refusé', !validateCustomCss('@import url("x.css"); .a{}').ok)
check('javascript: est refusé', !validateCustomCss('.a { background: url(javascript:alert(1)) }').ok)
check('accolade non fermée → erreur', !validateCustomCss('.a { color: red').ok)
check('parenthèse non fermée → erreur', !validateCustomCss('.a { color: rgb(1, 2, 3 }').ok)
check('chaîne non fermée → erreur', !validateCustomCss(".a { content: 'oops }").ok)
check('accolades dans une chaîne ignorées', validateCustomCss('.a::after { content: "{}"; color: red }').ok)
check('commentaires ignorés par l\u2019équilibrage', validateCustomCss('/* { */ .a { color: red }').ok)

// 56. scopeCss prefixes the top-level selectors, recurses into block
//     at-rules, and leaves keyframes/font-face intact.
const scoped = scopeCss('.a { color: red }\n.b, .c:hover { color: blue }', 'button, .btn')
check('chaque sélecteur de premier niveau est préfixé', scoped.includes('button, .btn .a{ color: red }') && scoped.includes('button, .btn .b, button, .btn .c:hover{ color: blue }'), scoped)
const scopedMedia = scopeCss('@media (min-width: 100px) { .a { color: red } }\n@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }', 'button')
check('les @media sont parcourus récursivement', scopedMedia.includes('@media (min-width: 100px) { button .a{ color: red } }'), scopedMedia)
check('les @keyframes restent intacts', scopedMedia.includes('@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }'), scopedMedia)
check('les virgules dans :is() ne cassent pas la liste', scopeCss('.x:is(a, b) { color: red }', 'button') === 'button .x:is(a, b){ color: red }')
check('scopeCss sans scope → inchangé', scopeCss('.a { color: red }', '') === '.a { color: red }')

// 57. cssScope is persisted and applied by themeToCss.
const ntCss = normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, extraCss: '.a { color: red }', cssScope: 'surfaces' })
check('normalizeTheme conserve extraCss et cssScope', ntCss.extraCss === '.a { color: red }' && ntCss.cssScope === 'surfaces')
check('cssScope par défaut → app', normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS }).cssScope === 'app')
const scopedOut = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, extraCss: '.a { color: red }', cssScope: 'surfaces' })
check('themeToCss applique le scoping quand cssScope=surfaces', scopedOut.includes('button,input,textarea,select,.card,.bubble,.msg,aside,.sidebar,.modal,[role="dialog"] .a{ color: red }'), scopedOut.slice(-90))
const appOut = themeToCss({ colorScheme: 'dark', tokens: DEFAULT_TOKENS, extraCss: '.a { color: red }' })
check('cssScope=app → CSS tel quel, en fin de feuille', appOut.endsWith('.a { color: red }'))

// 58. sanitizeCustomCss strips the dangerous bits at save time.
const dirty = '<style>.a{color:red}</style>\n@import url("x.css");\n.a{background:url(javascript:alert(1))}'
const clean = sanitizeCustomCss(dirty)
check('le "<" est supprimé', !clean.includes('<'))
check('@import est supprimé', !clean.includes('@import'))
check('javascript: est supprimé', !clean.includes('javascript:'))
check('normalizeTheme nettoie l\u2019extraCss', !normalizeTheme({ id: 'x', tokens: DEFAULT_TOKENS, extraCss: dirty }).extraCss.includes('<'))

console.log('')
if (failures) {
  console.error(`${failures} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Toutes les vérifications sont passées. ✔')
