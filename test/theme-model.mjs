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
  DEFAULT_TOKENS,
  TOKEN_KEYS,
  componentCss,
  componentDefaults,
  darken,
  lighten,
  mixHex,
  normalizeComponentOverrides,
  normalizeTheme,
  parseHex,
  themeToCss,
  tokenVars,
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

console.log('')
if (failures) {
  console.error(`${failures} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Toutes les vérifications sont passées. ✔')
