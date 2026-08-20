/**
 * lib/themeui.mjs — The Theme Engine panel injected into Freebuff (VS0→VS2).
 *
 * The standalone remains the technical injection layer; the user experience
 * lives inside Freebuff. This module generates a self-contained script that
 * mounts a small "Themes" entry point (floating button + panel) in the app
 * window, inside a Shadow DOM so it never collides with the app's own styles
 * or selectors.
 *
 * VS0: pick a theme, restore the original look.
 * VS1: Theme Editor — the six design tokens with live preview, save, reset.
 * VS2: Component Theming — Button / Input / Card / Sidebar / Modal, each with
 *      Colors, Border, Radius and Shadow overrides. Only the overridden
 *      properties are stored, so untouched components keep inheriting the
 *      global tokens (that is the isolation: Button does not leak into Input).
 *
 * The panel talks to the standalone through its local HTTP API:
 *   /api/state, /api/apply, /api/restore, /api/preview,
 *   /api/themes/save, /api/themes/reset.
 * It never runs arbitrary JavaScript and never touches the app's internals.
 */

/**
 * Returns the JS source of the Theme Engine UI, to be executed inside the
 * app's page (via Page.addScriptToEvaluateOnNewDocument + Runtime.evaluate).
 * The source is idempotent: it mounts at most one panel per document and
 * only in the top frame.
 */
export function makeThemeUiSource(uiPort) {
  const port = Number(uiPort) || 0
  if (!port) throw new Error('makeThemeUiSource: a valid uiPort is required')

  return `(() => {
  'use strict';
  // Only the top frame: mounting the floating button in every iframe/webview
  // would litter the app with copies.
  try { if (window.top !== window) return; } catch (e) { return; }
  // Idempotent within a document: a full reload gives a fresh window and the
  // script re-runs via addScriptToEvaluateOnNewDocument.
  if (window.__freebuffThemeEngine) return;
  window.__freebuffThemeEngine = true;

  var API = 'http://127.0.0.1:${port}';

  var TOKEN_KEYS = ['background', 'surface', 'text', 'textMuted', 'border', 'accent'];
  var TOKEN_LABELS = {
    background: 'Background',
    surface: 'Surface',
    text: 'Text',
    textMuted: 'Muted Text',
    border: 'Border',
    accent: 'Accent'
  };
  var COMPONENT_KEYS = ['button', 'input', 'card', 'sidebar', 'modal'];
  var COMPONENT_LABELS = { button: 'Button', input: 'Input', card: 'Card', sidebar: 'Sidebar', modal: 'Modal' };
  // VS8 — which DOM nodes each component maps to (mirrors the model).
  var COMPONENT_SELECTORS = {
    button: 'button',
    input: 'input, textarea, select',
    card: '.card',
    sidebar: 'aside, .sidebar',
    modal: '.modal, [role="dialog"]'
  };

  // VS8 — DOM → theme component: walk up from the clicked element until a
  // node matches one of the component selectors, crossing shadow boundaries.
  function matchComponent(el, root) {
    var node = el;
    while (node && node.nodeType === 1) {
      for (var i = 0; i < COMPONENT_KEYS.length; i++) {
        var key = COMPONENT_KEYS[i];
        if (typeof node.matches === 'function' && node.matches(COMPONENT_SELECTORS[key])) return key;
      }
      if (root && node === root) break;
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return null;
  }
  var COMPONENT_PROPS = ['background', 'text', 'border', 'accent', 'borderWidth', 'radius', 'shadow'];
  var COMPONENT_COLOR_PROPS = ['background', 'text', 'border', 'accent'];
  var COMPONENT_COLOR_LABELS = { background: 'Background', text: 'Text', border: 'Border', accent: 'Accent' };
  // VS3 — component states. The keys match lib/theme-model.mjs so a saved
  // theme round-trips exactly.
  var COMPONENT_STATES = ['hover', 'active', 'focus', 'disabled', 'loading'];
  var COMPONENT_STATE_LABELS = { hover: 'Hover', active: 'Active', focus: 'Focus', disabled: 'Disabled', loading: 'Loading' };
  var STATE_COLOR_PROPS = ['background', 'text', 'border', 'accent'];
  // Shadow keys MUST match SHADOW_PRESETS in the model (none/soft/medium/
  // strong) — the model drops unknown keys on save. 'strong' not 'forte'.
  var SHADOW_LABELS = { none: 'None', soft: 'Soft', medium: 'Medium', strong: 'Strong' };
  var SHADOW_KEYS = ['none', 'soft', 'medium', 'strong'];
  var SHADOW_VALUE_MAP = {
    none: 'none',
    soft: '0 2px 8px rgba(0, 0, 0, 0.25)',
    medium: '0 4px 16px rgba(0, 0, 0, 0.35)',
    strong: '0 8px 32px rgba(0, 0, 0, 0.5)'
  };
  // VS5 — glass & effects presets. MUST match EFFECT_PRESETS in the model.
  var EFFECT_PRESETS = {
    none: { label: 'None', enabled: false, transparency: 1, blur: 0, saturation: 1, brightness: 1, borderTranslucency: 1, glow: 0, gradient: 0, grain: 0 },
    subtle: { label: 'Subtle', enabled: true, transparency: 0.92, blur: 6, saturation: 1.1, brightness: 1, borderTranslucency: 0.6, glow: 0, gradient: 0, grain: 0 },
    frosted: { label: 'Frosted', enabled: true, transparency: 0.78, blur: 14, saturation: 1.2, brightness: 1.05, borderTranslucency: 0.4, glow: 0, gradient: 0, grain: 0 },
    strong: { label: 'Strong', enabled: true, transparency: 0.6, blur: 24, saturation: 1.3, brightness: 1.1, borderTranslucency: 0.25, glow: 0.15, gradient: 0.25, grain: 0.12 },
    important: { label: 'Important', enabled: true, transparency: 0.45, blur: 32, saturation: 1.4, brightness: 1.15, borderTranslucency: 0.15, glow: 0.3, gradient: 0.4, grain: 0.28 }
  };
  var EFFECT_SLIDERS = [
    ['transparency', 'Transparency', 20, 100, '%'],
    ['blur', 'Backdrop blur', 0, 40, 'px'],
    ['saturation', 'Saturation', 50, 250, '%'],
    ['brightness', 'Brightness', 50, 150, '%'],
    ['borderTranslucency', 'Border translucency', 0, 100, '%'],
    ['glow', 'Glow', 0, 100, '%'],
    ['gradient', 'Gradient', 0, 100, '%'],
    ['grain', 'Noise', 0, 100, '%']
  ];
  // VS6 — motion presets. MUST match MOTION_PRESETS in the model.
  var MOTION_PRESETS = {
    minimal: { label: 'Minimal', duration: 0, easing: 'ease', hover: { translateY: 0, scale: 1 }, active: { scale: 1 }, focus: { scale: 1 }, enter: false },
    smooth: { label: 'Smooth', duration: 200, easing: 'ease-out', hover: { translateY: -2, scale: 1.02 }, active: { scale: 0.97 }, focus: { scale: 1.01 }, enter: true },
    snappy: { label: 'Snappy', duration: 90, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', hover: { translateY: -1, scale: 1.01 }, active: { scale: 0.95 }, focus: { scale: 1.01 }, enter: true },
    bouncy: { label: 'Bouncy', duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', hover: { translateY: -4, scale: 1.04 }, active: { scale: 0.94 }, focus: { scale: 1.02 }, enter: true }
  };
  var MOTION_EASING_LABELS = {
    'ease': 'Ease',
    'ease-in': 'Ease-in',
    'ease-out': 'Ease-out',
    'ease-in-out': 'Ease-in-out',
    'linear': 'Linear',
    'cubic-bezier(0.2, 0.8, 0.2, 1)': 'Snappy curve',
    'cubic-bezier(0.34, 1.56, 0.64, 1)': 'Bouncy curve'
  };
  // VS4 — global shape & shadow presets. MUST match SHAPE_PRESETS in the
  // model: a layer color of 'ACCENT' means "the theme's accent", resolved to
  // a concrete hex when the preset is applied.
  var SHAPE_PRESETS = {
    flat: { label: 'Flat', radius: 2, borderWidth: 1, borderOpacity: 1, shadow: [] },
    soft: { label: 'Soft', radius: 8, borderWidth: 1, borderOpacity: 1, shadow: [{ x: 0, y: 2, blur: 10, spread: 0, color: '#000000', opacity: 0.18, inner: false }] },
    floating: { label: 'Floating', radius: 14, borderWidth: 1, borderOpacity: 1, shadow: [{ x: 0, y: 10, blur: 28, spread: -6, color: '#000000', opacity: 0.4, inner: false }, { x: 0, y: 4, blur: 10, spread: -2, color: '#000000', opacity: 0.22, inner: false }] },
    deep: { label: 'Deep', radius: 6, borderWidth: 1, borderOpacity: 1, shadow: [{ x: 0, y: 2, blur: 4, spread: 0, color: '#000000', opacity: 0.4, inner: false }, { x: 0, y: 10, blur: 20, spread: 0, color: '#000000', opacity: 0.35, inner: false }] },
    neon: { label: 'Neon', radius: 10, borderWidth: 1, borderOpacity: 1, shadow: [{ x: 0, y: 0, blur: 10, spread: 0, color: 'ACCENT', opacity: 0.6, inner: false }, { x: 0, y: 0, blur: 24, spread: 0, color: 'ACCENT', opacity: 0.35, inner: false }, { x: 0, y: 0, blur: 4, spread: 0, color: 'ACCENT', opacity: 0.5, inner: true }] }
  };

  // Fixed, self-contained palette — deliberately independent from the app's
  // own CSS variables so the panel is readable in any theme.
  var CSS = [
    '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    // Floating action button (opens/closes the panel).
    '#fbt-fab{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:linear-gradient(135deg,#7cff3f,#27a11f);color:#08130a;font-size:19px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;transition:transform .12s ease,box-shadow .12s ease}',
    '#fbt-fab:hover{transform:scale(1.06);box-shadow:0 10px 30px rgba(124,255,63,.28)}',
    '#fbt-fab:active{transform:scale(.96)}',
    // Panel shell: dark, rounded, floating.
    '#fbt-panel{position:fixed;right:18px;bottom:76px;z-index:2147483646;width:324px;max-height:74vh;display:flex;flex-direction:column;background:#0f0f13;color:#ececf1;border:1px solid #26262f;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden}',
    '#fbt-panel[hidden]{display:none}',
    // Flex chain so nothing is clipped: header/footer stay fixed, the middle
    // scrolls instead of being cut off by max-height.
    '#fbt-view-list,#fbt-view-edit{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-view-list[hidden],#fbt-view-edit[hidden]{display:none}',
    // Brand header (shared by the two views).
    '.fbt-head{display:flex;align-items:center;gap:10px;padding:11px 14px;background:linear-gradient(180deg,#14141a,#0f0f13);border-bottom:1px solid #1f1f27;flex:none}',
    '.fbt-brand{display:flex;align-items:center;gap:9px;min-width:0}',
    '.fbt-brand-icon{width:27px;height:27px;border-radius:8px;background:linear-gradient(135deg,#7cff3f,#27a11f);display:flex;align-items:center;justify-content:center;font-size:14px;flex:none;box-shadow:0 2px 8px rgba(124,255,63,.3)}',
    '.fbt-title{font-size:13.5px;font-weight:800;letter-spacing:.2px}',
    '.fbt-sub{font-size:10.5px;color:#8f8f9c;margin-top:1px}',
    '.fbt-status{display:flex;align-items:center;gap:6px;margin-left:auto;font-size:10.5px;color:#8f8f9c;background:#16161c;border:1px solid #26262f;border-radius:999px;padding:3px 9px;flex:none;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fbt-dot{width:7px;height:7px;border-radius:50%;background:#62626e;flex:none}',
    '.fbt-dot.ok{background:#5ecb7b;box-shadow:0 0 6px #5ecb7b}',
    '.fbt-dot.warn{background:#e5c15c;box-shadow:0 0 6px #e5c15c}',
    '.fbt-dot.err{background:#ff6b6b;box-shadow:0 0 6px #ff6b6b}',
    // Themes list.
    '#fbt-themes{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:9px}',
    '.fbt-empty{font-size:12px;color:#8f8f9c;padding:10px 2px;flex:none}',
    // flex:none on the cards is required so they overflow (and scroll) instead
    // of being squished by the column flex layout.
    '.fbt-theme{flex:none;border:1px solid #26262f;border-radius:11px;background:#15151b;overflow:hidden;transition:border-color .12s ease,box-shadow .12s ease}',
    '.fbt-theme:hover{border-color:#34343f}',
    '.fbt-theme.active{border-color:#7cff3f;box-shadow:0 0 0 1px rgba(124,255,63,.45),0 6px 18px rgba(0,0,0,.35)}',
    '.fbt-swatches{display:flex;height:30px}',
    '.fbt-swatches span{flex:1;border-right:1px solid rgba(255,255,255,.06)}',
    '.fbt-swatches span:last-child{border-right:none}',
    '.fbt-theme-body{padding:9px 11px 10px}',
    '.fbt-theme-name{font-size:13px;font-weight:700}',
    '.fbt-theme-desc{font-size:11px;color:#8f8f9c;margin-top:2px;line-height:1.4}',
    '.fbt-theme-meta{display:flex;align-items:center;gap:6px;margin-top:8px}',
    '.fbt-scheme{font-size:9.5px;padding:1px 7px;border-radius:999px;border:1px solid #26262f;color:#8f8f9c;text-transform:capitalize;letter-spacing:.3px}',
    '.fbt-badge{font-size:9.5px;padding:1px 7px;border-radius:999px;border:1px solid #7cff3f;color:#7cff3f;background:rgba(124,255,63,.08);letter-spacing:.3px}',
    '.fbt-theme-actions{margin-left:auto;display:flex;gap:6px}',
    '.fbt-theme button{font:inherit;font-size:11px;cursor:pointer;border:1px solid #26262f;border-radius:7px;padding:4px 10px;background:#1c1c23;color:#ececf1;transition:background .1s ease,border-color .1s ease}',
    '.fbt-theme button:hover{background:#24242d;border-color:#34343f}',
    '.fbt-theme.active button.fbt-activate{background:#7cff3f;border-color:#7cff3f;color:#08130a;font-weight:700}',
    // VS13 — delete (user themes only): a danger ghost button, confirm state.
    '.fbt-delete{color:#ff6b6b !important;border-color:#3a2430 !important}',
    '.fbt-delete:hover{background:#2a1418 !important;border-color:#ff6b6b !important}',
    '.fbt-delete.confirm{background:#ff6b6b !important;border-color:#ff6b6b !important;color:#14070a !important;font-weight:700}',
    // List footer: create / import side by side, restore below.
    '.fbt-foot{padding:10px 12px;border-top:1px solid #1f1f27;display:flex;flex-direction:column;gap:8px;flex:none;background:#0d0d11}',
    '.fbt-foot-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '.fbt-foot button{font:inherit;font-size:12px;cursor:pointer;width:100%;border:1px solid #26262f;border-radius:8px;padding:7px 10px;background:#1c1c23;color:#ececf1;transition:background .1s ease,border-color .1s ease}',
    '.fbt-foot button:hover{border-color:#7cff3f;color:#7cff3f;background:#141a12}',
    '.fbt-foot #fbt-create-theme{background:rgba(124,255,63,.1);border-color:rgba(124,255,63,.4);color:#7cff3f;font-weight:700}',
    '.fbt-foot #fbt-create-theme:hover{background:rgba(124,255,63,.16)}',
    '.fbt-note{font-size:9.5px;color:#62626e;line-height:1.45}',
    // VS12 — the create-theme dialog: a modal overlay inside the panel.
    '.fbt-create{position:absolute;inset:0;z-index:5;background:rgba(6,6,9,.78);display:flex;align-items:flex-start;justify-content:center;padding:28px 14px;backdrop-filter:blur(2px)}',
    '.fbt-create[hidden]{display:none}',
    '.fbt-create-card{width:100%;background:#17171d;border:1px solid #34343f;border-radius:12px;padding:15px;display:flex;flex-direction:column;gap:11px;box-shadow:0 18px 44px rgba(0,0,0,.6)}',
    '.fbt-create-title{font-size:13.5px;font-weight:800}',
    '.fbt-create input[type=text]{font:inherit;font-size:12.5px;padding:7px 9px;border:1px solid #26262f;border-radius:8px;background:#101014;color:#ececf1;width:100%;box-sizing:border-box;outline:none}',
    '.fbt-create input[type=text]:focus{border-color:#7cff3f}',
    '.fbt-create-bases{display:flex;flex-direction:column;gap:3px;max-height:170px;overflow-y:auto}',
    '.fbt-create-bases label{font-size:12px;display:flex;align-items:flex-start;gap:8px;padding:6px 7px;border:1px solid transparent;border-radius:8px;cursor:pointer}',
    '.fbt-create-bases label:hover{background:#1c1c23}',
    '.fbt-create-bases input{accent-color:#7cff3f;margin-top:2px}',
    '.fbt-create-base-name{font-weight:600}',
    '.fbt-create-base-desc{font-size:10px;color:#62626e;margin-top:1px}',
    '.fbt-create-actions{display:flex;gap:8px;margin-top:2px}',
    '.fbt-create-actions button{flex:1;font:inherit;font-size:12px;cursor:pointer;border:1px solid #26262f;border-radius:8px;padding:8px 10px;background:#1c1c23;color:#ececf1}',
    '.fbt-create-actions button:hover{background:#24242d}',
    '.fbt-create-actions button.fbt-create-go{background:#7cff3f;border-color:#7cff3f;color:#08130a;font-weight:700}',
    '.fbt-create-actions button.fbt-create-go:hover{background:#92ff5c}',
    // Editor header.
    '.fbt-edit-head{display:flex;align-items:center;gap:9px;padding:10px 12px;background:linear-gradient(180deg,#14141a,#0f0f13);border-bottom:1px solid #1f1f27;flex:none}',
    '.fbt-back{font:inherit;font-size:14px;cursor:pointer;border:1px solid #26262f;border-radius:8px;background:#1c1c23;color:#ececf1;padding:3px 10px;flex:none}',
    '.fbt-back:hover{background:#24242d;border-color:#34343f}',
    '.fbt-edit-head .fbt-title{font-size:13px}',
    '.fbt-edit-name{font-size:10.5px;color:#8f8f9c;margin-top:1px}',
    '#fbt-edit-body{flex:1 1 auto;min-height:0;overflow-y:auto;background:#0f0f13}',
    '#fbt-edit-main{display:flex;flex-direction:column;flex:none}',
    '#fbt-edit-main[hidden],#fbt-comp-detail[hidden],#fbt-state-detail[hidden]{display:none}',
    // VS13 — section navigation: one tab bar, one section visible at a time.
    '.fbt-tabs{display:flex;gap:3px;padding:8px 10px;border-bottom:1px solid #1f1f27;background:#0d0d11;flex:none;position:sticky;top:0;z-index:4}',
    '.fbt-tab{flex:1;min-width:0;font:inherit;font-size:10px;font-weight:600;letter-spacing:.2px;cursor:pointer;border:none;border-radius:7px;padding:6px 2px;background:transparent;color:#62626e;transition:background .1s ease,color .1s ease}',
    '.fbt-tab:hover{color:#ececf1;background:#16161c}',
    '.fbt-tab.active{color:#7cff3f;background:rgba(124,255,63,.1)}',
    '.fbt-tab-panel{padding:12px 14px 14px}',
    '.fbt-section{font-size:10px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#62626e;margin-bottom:8px;margin-top:4px}',
    '.fbt-section:first-child{margin-top:0}',
    '#fbt-color-rows{margin-bottom:2px}',
    '.fbt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #1b1b22}',
    '.fbt-row:last-child{border-bottom:none}',
    '.fbt-row label{font-size:12.5px}',
    '.fbt-row input[type=color]{width:42px;height:28px;border:1px solid #26262f;border-radius:8px;background:#101014;padding:3px;cursor:pointer}',
    '#fbt-components{display:flex;flex-direction:column;gap:6px}',
    '.fbt-comp-row{display:flex;align-items:center;gap:8px;width:100%;font:inherit;font-size:12px;cursor:pointer;border:1px solid #26262f;border-radius:9px;background:#15151b;color:#ececf1;padding:9px 11px;text-align:left;transition:border-color .1s ease,background .1s ease}',
    '.fbt-comp-row:hover{border-color:#7cff3f;background:#171b12}',
    '.fbt-comp-name{font-weight:700}',
    '.fbt-comp-summary{margin-left:auto;font-size:10.5px;color:#62626e}',
    '.fbt-comp-chevron{font-size:13px;color:#8f8f9c}',
    '#fbt-comp-detail{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-comp-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '.fbt-range-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1b1b22}',
    '.fbt-range-row label{font-size:12.5px;min-width:74px}',
    '.fbt-range-row input[type=range]{flex:1;accent-color:#7cff3f;height:18px}',
    '.fbt-range-val{font-size:11px;color:#8f8f9c;min-width:32px;text-align:right}',
    '.fbt-number{width:60px;background:#101014;color:#ececf1;border:1px solid #26262f;border-radius:8px;padding:5px 7px;font:inherit;font-size:12px;outline:none}',
    '.fbt-number:focus{border-color:#7cff3f}',
    // VS3 — states list + state editor.
    '#fbt-states{display:flex;flex-direction:column;gap:6px}',
    '.fbt-state-row{display:flex;align-items:center;gap:8px;width:100%;font:inherit;font-size:12px;cursor:pointer;border:1px solid #26262f;border-radius:9px;background:#15151b;color:#ececf1;padding:9px 11px;text-align:left}',
    '.fbt-state-row:hover{border-color:#7cff3f}',
    '.fbt-state-name{font-weight:700}',
    '.fbt-state-summary{margin-left:auto;font-size:10.5px;color:#62626e}',
    '.fbt-state-chevron{font-size:13px;color:#8f8f9c}',
    '#fbt-state-detail{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-state-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '#fbt-state-preview{display:block;width:100%;font:inherit;font-size:12.5px;font-weight:700;padding:11px 12px;border-radius:9px;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease,box-shadow .12s ease}',
    '#fbt-state-preview:disabled{cursor:not-allowed;opacity:.5}',
    '#fbt-state-preview-note{font-size:10.5px;color:#62626e;margin-top:6px;line-height:1.45}',
    '.fbt-select{background:#101014;color:#ececf1;border:1px solid #26262f;border-radius:8px;padding:6px 8px;font:inherit;font-size:12px;flex:1;outline:none}',
    '.fbt-select:focus{border-color:#7cff3f}',
    '.fbt-edit-hint{font-size:10.5px;color:#62626e;margin-top:10px;line-height:1.5;padding:0 14px 4px}',
    '.fbt-edit-status{font-size:11px;color:#e5c15c;margin-top:10px;min-height:15px;padding:0 14px 8px}',
    '.fbt-edit-foot{padding:10px 12px;border-top:1px solid #1f1f27;display:flex;gap:8px;flex:none;background:#0d0d11}',
    '.fbt-edit-foot[hidden]{display:none}',
    '.fbt-edit-foot button{flex:1;font:inherit;font-size:12px;cursor:pointer;border:1px solid #26262f;border-radius:8px;padding:9px 10px;background:#1c1c23;color:#ececf1;transition:background .1s ease}',
    '.fbt-edit-foot button:hover{background:#24242d}',
    '.fbt-edit-foot #fbt-save{background:#7cff3f;border-color:#7cff3f;color:#08130a;font-weight:700}',
    '.fbt-edit-foot #fbt-save:hover{background:#92ff5c}',
    '.fbt-edit-foot #fbt-reset:hover{border-color:#ff6b6b;color:#ff6b6b}',
    '#fbt-comp-reset:hover{border-color:#ff6b6b;color:#ff6b6b}',
    // VS4 — Shapes & Depth: preset chips, global sliders, shadow layers.
    '.fbt-preset-row{display:flex;flex-wrap:wrap;gap:6px}',
    '.fbt-preset{font:inherit;font-size:11px;cursor:pointer;border:1px solid #26262f;border-radius:999px;padding:5px 11px;background:#1c1c23;color:#ececf1;transition:border-color .1s ease,color .1s ease,background .1s ease}',
    '.fbt-preset:hover{background:#24242d;border-color:#34343f}',
    '.fbt-preset.active{border-color:#7cff3f;color:#7cff3f;background:rgba(124,255,63,.1)}',
    '.fbt-shadow-layer{border:1px solid #26262f;border-radius:10px;background:#15151b;padding:9px 11px;margin-bottom:8px}',
    '.fbt-shadow-layer-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}',
    '.fbt-shadow-layer-head span{font-size:11px;font-weight:700}',
    '.fbt-layer-remove{font:inherit;font-size:13px;line-height:1;cursor:pointer;border:1px solid #26262f;border-radius:6px;background:#1c1c23;color:#ff6b6b;padding:2px 8px}',
    '.fbt-layer-remove:hover{border-color:#ff6b6b}',
    '.fbt-layer-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}',
    '.fbt-layer-field{display:flex;flex-direction:column;gap:2px;padding:4px 0;border:none}',
    '.fbt-layer-field .fbt-layer-label{font-size:10px;color:#8f8f9c}',
    '.fbt-layer-slider-row{display:flex;align-items:center;gap:6px}',
    '.fbt-layer-slider-row input[type=range]{flex:1;accent-color:#7cff3f;min-width:0;height:16px}',
    '.fbt-layer-slider-row .fbt-range-val{font-size:10px;min-width:34px;text-align:right}',
    '.fbt-layer-color-row{display:flex;align-items:center;gap:10px;padding:6px 0}',
    '.fbt-layer-color-row label{font-size:11px;min-width:44px}',
    '.fbt-layer-color-row input[type=color]{width:36px;height:25px;border:1px solid #26262f;border-radius:7px;background:#101014;padding:2px;cursor:pointer}',
    '.fbt-layer-inner{display:flex;align-items:center;gap:6px;font-size:11px;color:#8f8f9c;cursor:pointer}',
    '#fbt-shadow-add{font:inherit;font-size:11px;cursor:pointer;border:1px dashed #34343f;border-radius:8px;padding:7px 10px;background:transparent;color:#8f8f9c;width:100%;margin-top:4px}',
    '#fbt-shadow-add:hover{border-color:#7cff3f;color:#7cff3f}',
    // VS5 — effects: preset chips, enable toggle, compact sliders, perf badge.
    '.fbt-toggle-row{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:12px;cursor:pointer}',
    '.fbt-toggle-row input{accent-color:#7cff3f;width:15px;height:15px}',
    '.fbt-effects-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}',
    '.fbt-effects-grid .fbt-layer-field{min-width:0}',
    '.fbt-perf{font-size:10.5px;border-radius:8px;padding:5px 9px;margin-top:8px;line-height:1.4;background:#15151b;color:#8f8f9c;border:1px solid #26262f}',
    '.fbt-perf.warn{background:rgba(229,193,92,.1);color:#e5c15c;border-color:rgba(229,193,92,.35)}',
    '.fbt-perf.ok{background:rgba(94,203,123,.1);color:#5ecb7b;border-color:rgba(94,203,123,.3)}',
    '.fbt-perf-toggle{font:inherit;font-size:10.5px;cursor:pointer;border:1px solid #26262f;border-radius:7px;background:#1c1c23;color:#ececf1;padding:4px 9px;margin-top:6px}',
    '.fbt-perf-toggle:hover{border-color:#e5c15c;color:#e5c15c}',
    // VS6 — motion: preset chips, sliders, easing select, live preview button.
    '#fbt-motion-preview{display:block;width:100%;font:inherit;font-size:12.5px;font-weight:700;padding:11px 12px;border-radius:9px;border:1px solid #26262f;background:#1c1c23;color:#ececf1;cursor:pointer;will-change:transform}',
    '#fbt-motion-preview-note{font-size:10.5px;color:#62626e;margin-top:6px;line-height:1.45}',
    // VS8 — element inspector: pick button, hint banner, inspector view.
    '.fbt-pick{font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px dashed #34343f;border-radius:9px;padding:9px 10px;background:#15151b;color:#ececf1;width:100%;margin-top:10px;transition:border-color .1s ease,color .1s ease}',
    '.fbt-pick:hover{border-color:#7cff3f;color:#7cff3f}',
    '.fbt-pick.active{border-color:#ff6b6b;color:#ff6b6b;background:rgba(255,107,107,.08)}',
    '#fbt-inspect-hint{font-size:11px;color:#7cff3f;background:rgba(124,255,63,.08);border:1px solid rgba(124,255,63,.35);border-radius:9px;padding:8px 12px;margin:10px 12px 0;flex:none}',
    '#fbt-inspect-hint[hidden]{display:none}',
    '#fbt-inspector{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-inspector[hidden]{display:none}',
    '#fbt-inspector-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '.fbt-inspector-pick{font:inherit;font-size:11px;cursor:pointer;border:1px solid #26262f;border-radius:7px;background:#1c1c23;color:#ececf1;padding:5px 9px;margin-left:auto;flex:none}',
    '.fbt-inspector-pick:hover{border-color:#7cff3f;color:#7cff3f}',
    '.fbt-inspect-row{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #1b1b22}',
    '.fbt-inspect-row:last-child{border-bottom:none}',
    '.fbt-inspect-row .fbt-inspect-label{font-size:12px;min-width:72px}',
    '.fbt-inspect-row .fbt-inspect-summary{margin-left:auto;font-size:10.5px;color:#62626e}',
    '.fbt-inspect-row button{font:inherit;font-size:11px;cursor:pointer;border:1px solid #26262f;border-radius:7px;background:#1c1c23;color:#ececf1;padding:4px 10px}',
    '.fbt-inspect-row button:hover{border-color:#7cff3f;color:#7cff3f}',
    // VS9 — Advanced: code editor with syntax highlighting, validation banner,
    // scope select and the theme-token reference.
    '.fbt-code-wrap{position:relative;height:180px;margin:8px 0;border:1px solid #26262f;border-radius:9px;overflow:hidden;background:#0c0c10}',
    '.fbt-code-wrap:focus-within{border-color:#7cff3f}',
    '.fbt-code-highlight{position:absolute;inset:0;margin:0;padding:10px 12px;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;color:#c9c9ce;pointer-events:none}',
    '.fbt-code{position:absolute;inset:0;width:100%;height:100%;resize:none;border:none;outline:none;background:transparent;color:transparent;caret-color:#ececf1;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;padding:10px 12px;white-space:pre-wrap;word-wrap:break-word;overflow:auto;tab-size:2}',
    '.fbt-code::selection{background:rgba(124,255,63,.25)}',
    '.fbt-tok-c{color:#5f5f66;font-style:italic}',
    '.fbt-tok-s{color:#e5c07b}',
    '.fbt-tok-a{color:#c678dd}',
    '.fbt-tok-sel{color:#61afef}',
    '.fbt-tok-p{color:#e06c75}',
    '.fbt-tok-v{color:#c9c9ce}',
    '.fbt-tok-n{color:#d19a66}',
    '.fbt-tok-x{color:#8f8f9c}',
    '#fbt-adv-errors{font-size:11px;color:#ff9a9a;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.35);border-radius:9px;padding:8px 12px;margin:4px 0 8px;line-height:1.5}',
    '#fbt-adv-errors[hidden]{display:none}',
    '#fbt-adv-ok{font-size:11px;color:#5ecb7b;margin:2px 0 6px}',
    '#fbt-adv-ok[hidden]{display:none}',
    '#fbt-adv-tokens summary{font-size:12px;cursor:pointer;color:#8f8f9c;padding:6px 0}',
    '#fbt-adv-tokens[open] summary{margin-bottom:6px}',
    '#fbt-adv-token-list{display:flex;flex-wrap:wrap;gap:6px}',
    '.fbt-token-chip{font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;cursor:pointer;border:1px solid #26262f;border-radius:7px;background:#101014;color:#8f8f9c;padding:3px 8px}',
    '.fbt-token-chip:hover{border-color:#7cff3f;color:#7cff3f}',
    '.fbt-token-chip b{color:#ececf1;font-weight:600}',
    // VS10 — undo/redo + history bar and per-property reset buttons.
    '#fbt-history-bar{display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid #1f1f27;background:#0d0d11;flex:none}',
    '.fbt-history-btn{font:inherit;font-size:11px;cursor:pointer;border:1px solid #26262f;border-radius:7px;background:#1c1c23;color:#ececf1;padding:4px 9px}',
    '.fbt-history-btn:hover:not(:disabled){border-color:#7cff3f;color:#7cff3f}',
    '.fbt-history-btn:disabled{opacity:.4;cursor:default}',
    '#fbt-history{position:relative;margin-left:auto}',
    '#fbt-history summary{font-size:11px;cursor:pointer;color:#8f8f9c;padding:4px 8px;border:1px solid #26262f;border-radius:7px;background:#15151b;list-style:none}',
    '#fbt-history summary::-webkit-details-marker{display:none}',
    '#fbt-history[open] summary{border-color:#7cff3f;color:#7cff3f}',
    '#fbt-history-list{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:232px;max-height:240px;overflow-y:auto;background:#17171d;border:1px solid #34343f;border-radius:10px;padding:6px;box-shadow:0 12px 32px rgba(0,0,0,.5)}',
    '.fbt-history-item{display:block;width:100%;text-align:left;font:inherit;font-size:11.5px;cursor:pointer;border:none;border-radius:7px;background:transparent;color:#c9c9ce;padding:5px 9px}',
    '.fbt-history-item:hover{background:#1c1c23;color:#ececf1}',
    '.fbt-history-item.current{color:#7cff3f;cursor:default;font-weight:700}',
    '.fbt-history-item.future{color:#62626e}',
    '.fbt-prop-reset{font:inherit;font-size:12px;cursor:pointer;border:1px solid #26262f;border-radius:7px;background:#101014;color:#8f8f9c;padding:3px 8px;flex:none}',
    '.fbt-prop-reset:hover{border-color:#ff6b6b;color:#ff6b6b}',
    '#fbt-adv{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-adv[hidden]{display:none}',
    '#fbt-adv-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    // VS13 — bottom navigation between the two main views.
    '#fbt-nav{display:flex;border-top:1px solid #1f1f27;background:#0b0b0e;flex:none;padding:5px 6px;gap:5px}',
    '.fbt-nav-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;border:none;border-radius:8px;background:transparent;color:#62626e;padding:7px 6px;transition:background .1s ease,color .1s ease}',
    '.fbt-nav-btn:hover:not(:disabled){color:#ececf1;background:#16161c}',
    '.fbt-nav-btn.active{color:#7cff3f;background:rgba(124,255,63,.1)}',
    '.fbt-nav-btn:disabled{opacity:.35;cursor:default}',
    '.fbt-toast{position:fixed;right:18px;bottom:130px;z-index:2147483645;background:#1c1c23;color:#ececf1;border:1px solid #34343f;border-radius:10px;padding:9px 13px;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.5);opacity:0;transition:opacity .18s;pointer-events:none;max-width:284px}',
    '.fbt-toast.show{opacity:1}'
  ];

  // Element handles shared between mount() and the logic below.
  var panel = null, dot = null, statusText = null, list = null, toast = null, toastTimer = null;
  var viewList = null, viewEdit = null, editName = null, editStatus = null, compStatus = null;
  var editMain = null, compDetail = null, componentsList = null, compTitle = null;
  var compInputs = {};   // prop -> element (shared across components)
  var radiusVal = null;
  var editFoot = null;
  var tokenInputs = {};
  var themesById = {};
  var activeThemeId = null;
  var editingTheme = null;
  var editingDirty = false;
  var editingComponentKey = null;
  var previewTimer = null;
  // VS3 — state editor.
  var compStateDetail = null, stateList = null, stateTitle = null, statePreviewBtn = null, statePreviewNote = null;
  var stateStatus = null;
  var stateInputs = {};   // prop -> element (shared across states)
  var editingStateKey = null;
  var previewSim = null;  // which state the preview button is simulating
  // VS4 — global shape & shadow editor.
  var shapeInputs = {};   // field -> element (radius, borderWidth, borderOpacity)
  var shapeRadiusVal = null, shapeBorderVal = null, shapeOpacityVal = null;
  var shadowLayersEl = null;
  // VS5 — effects editor.
  var effectsInputs = {};  // field -> element
  var effectsVals = {};    // field -> value span
  var effectsEnable = null, effectsPerfBadge = null, effectsPerfToggle = null;
  var effectsPresetRow = null;
  // VS6 — motion editor.
  var motionInputs = {};   // field -> element (duration, delay, easing, hoverY, hoverScale, activeScale, focusScale)
  var motionVals = {};     // field -> value span
  var motionPresetRow = null, motionEnter = null, motionPreviewBtn = null, motionReduced = null;
  // VS8 — visual element inspector: pick an element in Freebuff → the theme
  // engine maps it to a component and opens a focused editor for it.
  var inspectorDetail = null, inspectorTitle = null, inspectorEl = null, inspectorKey = null;
  var inspectorInputs = {}, inspectorVals = {};
  var inspectorHoverVal = null, inspectorPressVal = null, pickBtn = null;
  var inspectMode = false, inspectHoverEl = null, inspectHighlight = null, inspectHint = null;
  var themerHost = null;   // the panel's shadow host (set in mount)
  // VS9 — Advanced: custom CSS editor, validation, scope, token reference.
  var advDetail = null, advEditor = null, advHighlight = null, advErrorsEl = null, advOkEl = null;
  var advScopeSel = null, advTokensEl = null, advTimer = null;
  var ADV_SCOPE_LABELS = { app: 'Whole app', surfaces: 'Themed surfaces only' };
  // VS10 — undo/redo + history: snapshot stacks, gesture tracking, UI handles.
  var undoStack = [], redoStack = [];
  var editGesture = false, editGestureTimer = null;
  var historyBar = null, historyListEl = null, undoBtn = null, redoBtn = null, historyCountEl = null;
  var fileInput = null; // VS11 — hidden file input for theme import
  // VS12 — theme creation: name + base dialog, opened from the list.
  var createBox = null, createName = null, createBases = null;
  // VS13 — redesigned navigation: section tabs inside the editor, a bottom
  // nav between the two main views, and user-theme deletion (confirm state).
  var tabBar = null, tabPanels = null, activeTab = 'colors';
  var navListBtn = null, navEditBtn = null;
  var deleteConfirmTimer = null, deleteConfirmId = null;
  var PROP_LABELS = { background: 'Background', text: 'Text', border: 'Border', accent: 'Accent', borderWidth: 'Border width', radius: 'Radius', shadow: 'Shadow', glow: 'Glow' };
  var SHAPE_FIELD_LABELS = { radius: 'Radius', borderWidth: 'Border width', borderOpacity: 'Border opacity' };
  var MOTION_FIELD_LABELS = { speed: 'Speed', intensity: 'Intensity', reduced: 'Reduced motion', duration: 'Duration', delay: 'Delay', easing: 'Easing', hoverY: 'Hover Y', hoverScale: 'Hover scale', activeScale: 'Press scale', focusScale: 'Focus scale', enter: 'Message enter animation' };

  function toastMsg(msg) {
    toast.textContent = msg;
    toast.className = 'fbt-toast show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.className = 'fbt-toast'; }, 2600);
  }

  function setStatus(kind, text) {
    dot.className = 'fbt-dot' + (kind ? ' ' + kind : '');
    statusText.textContent = text;
  }

  function setEditStatus(text) {
    if (editStatus) editStatus.textContent = text || '';
    if (compStatus) compStatus.textContent = text || '';
    if (stateStatus) stateStatus.textContent = text || '';
  }

  /* ------------------------------------------------------------ */
  /* List view                                                     */
  /* ------------------------------------------------------------ */

  function applyTheme(id, name) {
    fetch(API + '/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeId: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          toastMsg('Theme "' + name + '" activated \u2713');
          refresh();
        } else {
          toastMsg((res && res.message) || 'Could not activate the theme.');
        }
      })
      .catch(function () { toastMsg('Studio offline \u2014 activation failed.'); });
  }

  function restore() {
    fetch(API + '/api/restore', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          toastMsg('Original look restored.');
          refresh();
        } else {
          toastMsg((res && res.message) || 'Could not restore.');
        }
      })
      .catch(function () { toastMsg('Studio offline \u2014 restore failed.'); });
  }

  function renderThemes(themes, activeId) {
    list.textContent = '';
    themesById = {};
    if (!themes || !themes.length) {
      var empty = document.createElement('div');
      empty.className = 'fbt-empty';
      empty.textContent = 'No theme available.';
      list.appendChild(empty);
      return;
    }
    themes.forEach(function (t) {
      themesById[t.id] = t;
      var card = document.createElement('div');
      card.className = 'fbt-theme' + (t.id === activeId ? ' active' : '');

      var swatches = document.createElement('div');
      swatches.className = 'fbt-swatches';
      TOKEN_KEYS.forEach(function (k) {
        var s = document.createElement('span');
        s.style.background = (t.tokens && t.tokens[k]) || '#888';
        swatches.appendChild(s);
      });

      var body = document.createElement('div');
      body.className = 'fbt-theme-body';
      var name = document.createElement('div');
      name.className = 'fbt-theme-name';
      name.textContent = t.name || t.id;
      var desc = document.createElement('div');
      desc.className = 'fbt-theme-desc';
      desc.textContent = t.description || '';
      var meta = document.createElement('div');
      meta.className = 'fbt-theme-meta';

      var left = document.createElement('span');
      left.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0';
      if (!t.builtin) {
        var badge = document.createElement('span');
        badge.className = 'fbt-badge';
        badge.textContent = 'custom';
        left.appendChild(badge);
      }
      var scheme = document.createElement('span');
      scheme.className = 'fbt-scheme';
      scheme.textContent = t.colorScheme || '';
      left.appendChild(scheme);

      var actions = document.createElement('span');
      actions.className = 'fbt-theme-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'fbt-modify';
      editBtn.dataset.edit = t.id;
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () { openEditor(t.id); });
      var actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'fbt-activate';
      actBtn.dataset.theme = t.id;
      actBtn.textContent = t.id === activeId ? 'Active \u2713' : 'Activate';
      actBtn.addEventListener('click', function () { applyTheme(t.id, t.name || t.id); });
      actions.appendChild(editBtn);
      actions.appendChild(actBtn);
      // VS13 — user themes (created or imported) can be deleted; built-ins
      // ship with the app and never get the button.
      if (!t.builtin) {
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'fbt-delete';
        delBtn.dataset.del = t.id;
        delBtn.textContent = '\ud83d\uddd1';
        delBtn.title = 'Delete this theme';
        delBtn.addEventListener('click', function () { deleteTheme(t.id, delBtn); });
        actions.appendChild(delBtn);
      }

      meta.appendChild(left);
      meta.appendChild(actions);
      body.appendChild(name);
      body.appendChild(desc);
      body.appendChild(meta);

      card.appendChild(swatches);
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  function refresh() {
    return fetch(API + '/api/state', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (s) {
        if (!s || typeof s !== 'object') { setStatus('err', 'Studio offline'); return; }
        activeThemeId = s.mode === 'theme' ? s.themeId : null;
        if (s.debugAlive && s.connected > 0) {
          setStatus('ok', 'Injection active \u2014 ' + s.connected + (s.connected > 1 ? ' windows' : ' window'));
        } else if (s.debugAlive) {
          setStatus('warn', 'Waiting for connection\u2026');
        } else if (s.running) {
          setStatus('warn', 'Freebuff is running without the debug port');
        } else {
          setStatus('warn', 'Freebuff is closed');
        }
        renderThemes(s.themes || [], activeThemeId);
      })
      .catch(function () {
        setStatus('err', 'Studio offline \u2014 launch CustomFreebuff');
      });
  }

  /* ------------------------------------------------------------ */
  /* Theme editor (VS1: tokens) + components (VS2)                 */
  /* ------------------------------------------------------------ */

  function compDefaults() {
    var t = editingTheme.tokens || {};
    return {
      background: t.surface || '#000000',
      text: t.text || '#ffffff',
      border: t.border || '#888888',
      accent: t.accent || '#00ff00',
      borderWidth: 1,
      radius: 6,
      shadow: 'none'
    };
  }

  function editingComponentOverrides(key) {
    return (editingTheme.components && editingTheme.components[key]) || {};
  }

  function renderComponentsList() {
    componentsList.textContent = '';
    COMPONENT_KEYS.forEach(function (key) {
      var over = editingComponentOverrides(key);
      // VS3: a state with overrides counts as one "setting" in the summary.
      var count = Object.keys(over).filter(function (k) { return k !== 'states'; }).length
        + (over.states ? Object.keys(over.states).length : 0);
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'fbt-comp-row';
      row.dataset.comp = key;
      var label = document.createElement('span');
      label.className = 'fbt-comp-name';
      label.textContent = COMPONENT_LABELS[key];
      var summary = document.createElement('span');
      summary.className = 'fbt-comp-summary';
      summary.textContent = count ? (count + (count > 1 ? ' settings modified' : ' setting modified')) : 'Default';
      var chevron = document.createElement('span');
      chevron.className = 'fbt-comp-chevron';
      chevron.textContent = '\u203a';
      row.appendChild(label);
      row.appendChild(summary);
      row.appendChild(chevron);
      row.addEventListener('click', function () { openComponent(key); });
      componentsList.appendChild(row);
    });
  }

  function showEditMain() {
    compDetail.hidden = true;
    compStateDetail.hidden = true;
    if (inspectorDetail) inspectorDetail.hidden = true;
    if (advDetail) advDetail.hidden = true;
    editMain.hidden = false;
    editFoot.hidden = false;
    editingComponentKey = null;
    editingStateKey = null;
    hideInspectHighlight();
    renderComponentsList();
  }

  function syncComponentInputs() {
    var defs = compDefaults();
    var over = editingComponentOverrides(editingComponentKey);
    COMPONENT_COLOR_PROPS.forEach(function (prop) {
      compInputs[prop].value = over[prop] !== undefined ? over[prop] : defs[prop];
    });
    compInputs.borderWidth.value = String(over.borderWidth !== undefined ? over.borderWidth : defs.borderWidth);
    compInputs.radius.value = String(over.radius !== undefined ? over.radius : defs.radius);
    compInputs.shadow.value = over.shadow !== undefined ? over.shadow : defs.shadow;
    radiusVal.textContent = compInputs.radius.value + ' px';
  }

  function openComponent(key) {
    editingComponentKey = key;
    compTitle.textContent = COMPONENT_LABELS[key];
    syncComponentInputs();
    setEditStatus('');
    renderStateList();
    editMain.hidden = true;
    editFoot.hidden = true;
    compStateDetail.hidden = true;
    compDetail.hidden = false;
  }

  function onComponentChange(prop, value) {
    beginEdit(COMPONENT_LABELS[editingComponentKey] + ' \u00b7 ' + (PROP_LABELS[prop] || prop));
    var defs = compDefaults();
    var normalized = (prop === 'borderWidth' || prop === 'radius') ? Number(value) : String(value);
    if (!editingTheme.components) editingTheme.components = {};
    var over = editingTheme.components[editingComponentKey] || (editingTheme.components[editingComponentKey] = {});
    if (normalized === defs[prop]) {
      // Back to the default → inherit from the global tokens again.
      delete over[prop];
      if (!Object.keys(over).length) delete editingTheme.components[editingComponentKey];
    } else {
      over[prop] = normalized;
    }
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    renderComponentsList();
    schedulePreview();
  }

  function resetComponent() {
    beginEdit('Reset ' + COMPONENT_LABELS[editingComponentKey]);
    if (editingTheme.components) delete editingTheme.components[editingComponentKey];
    syncComponentInputs();
    renderComponentsList();
    editingDirty = true;
    setEditStatus('Component reset \u2014 preview applied');
    schedulePreview();
    toastMsg('Component reset.');
  }

  /* ------------------------------------------------------------ */
  /* VS8 — visual element inspector                                */
  /*                                                               */
  /* "I want to modify THIS button": pick mode captures clicks on */
  /* the app, maps the clicked element to its theme component      */
  /* (matchComponent), highlights it, and opens a focused editor   */
  /* whose changes preview live on the real element.               */
  /* ------------------------------------------------------------ */

  function isProtected(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el === document.documentElement || el === document.body) return true;
    if (el.id === 'freebuff-theme-engine-host' || el.id === 'freebuff-themer-style' || el.id === 'fbt-inspector-highlight') return true;
    if (el.closest && el.closest('#freebuff-theme-engine-host')) return true;
    return false;
  }

  function enterInspectMode() {
    if (inspectMode) return;
    inspectMode = true;
    pickBtn.textContent = 'Cancel picking';
    pickBtn.classList.add('active');
    inspectHint.hidden = false;
  }

  function exitInspectMode() {
    if (!inspectMode) return;
    inspectMode = false;
    pickBtn.textContent = '\ud83c\udfaf Edit Element';
    pickBtn.classList.remove('active');
    inspectHint.hidden = true;
    inspectHoverEl = null;
    hideInspectHighlight();
  }

  function paintHighlight(el, label) {
    if (!inspectHighlight) return;
    var r = el.getBoundingClientRect();
    inspectHighlight.style.display = 'block';
    inspectHighlight.style.left = Math.round(r.left) + 'px';
    inspectHighlight.style.top = Math.round(r.top) + 'px';
    inspectHighlight.style.width = Math.round(r.width) + 'px';
    inspectHighlight.style.height = Math.round(r.height) + 'px';
    inspectHighlight.dataset.label = label;
  }

  function hideInspectHighlight() {
    if (inspectHighlight) inspectHighlight.style.display = 'none';
  }

  // While the inspector is open, keep the highlight pinned on the selected
  // element (scrolls, resizes). In pick mode, follow the hovered element.
  function onInspectScroll() {
    if (inspectMode && inspectHoverEl) {
      var key = matchComponent(inspectHoverEl);
      paintHighlight(inspectHoverEl, key ? COMPONENT_LABELS[key] : '');
    } else if (inspectorEl && inspectorDetail && !inspectorDetail.hidden) {
      paintHighlight(inspectorEl, COMPONENT_LABELS[inspectorKey]);
    }
  }

  function onInspectOver(e) {
    if (!inspectMode) return;
    var target = e.target;
    if (isProtected(target)) { hideInspectHighlight(); inspectHoverEl = null; return; }
    var key = matchComponent(target);
    inspectHoverEl = key ? target : null;
    if (key) paintHighlight(target, COMPONENT_LABELS[key]);
    else hideInspectHighlight();
  }

  function onInspectClick(e) {
    if (!inspectMode) return;
    // Clicks inside the panel keep working (buttons, sliders…) — never
    // intercept our own UI.
    if (e.composedPath && e.composedPath().indexOf(themerHost) !== -1) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var target = e.target;
    var key = isProtected(target) ? null : matchComponent(target);
    if (key) {
      exitInspectMode();
      openInspector(key, target);
    } else {
      toastMsg('Nothing themeable here \u2014 click a button, input, card, sidebar or modal.');
    }
  }

  function openInspector(key, el) {
    inspectorKey = key;
    inspectorEl = el;
    editingComponentKey = key;
    editMain.hidden = true;
    compDetail.hidden = true;
    compStateDetail.hidden = true;
    inspectorDetail.hidden = false;
    editFoot.hidden = true;
    renderInspector();
    paintHighlight(el, COMPONENT_LABELS[key]);
    setEditStatus('');
    toastMsg('Inspecting this ' + COMPONENT_LABELS[key] + ' \u2014 edits preview live.');
  }

  function closeInspector() {
    inspectorEl = null;
    inspectorKey = null;
    inspectorDetail.hidden = true;
    showEditMain();
  }

  function inspectorStateSummary(key, states) {
    var s = states[key];
    return s && Object.keys(s).length ? Object.keys(s).length + ' setting' + (Object.keys(s).length > 1 ? 's' : '') : 'Default';
  }

  // The effective values of the inspected component: its overrides or the
  // global token fallbacks (what the element actually looks like).
  function componentEffectiveUi(key) {
    var defs = compDefaults();
    var over = editingComponentOverrides(key);
    return {
      background: over.background || defs.background,
      text: over.text || defs.text,
      border: over.border || defs.border,
      accent: over.accent || defs.accent,
      radius: over.radius !== undefined ? over.radius : defs.radius,
      shadow: over.shadow !== undefined ? over.shadow : defs.shadow,
      glow: over.glow !== undefined ? over.glow : 0,
      states: over.states || {}
    };
  }

  function renderInspector() {
    var eff = componentEffectiveUi(inspectorKey);
    inspectorTitle.textContent = COMPONENT_LABELS[inspectorKey];
    COMPONENT_COLOR_PROPS.forEach(function (prop) {
      inspectorInputs[prop].value = eff[prop];
    });
    inspectorInputs.radius.value = String(eff.radius);
    inspectorVals.radius.textContent = eff.radius + ' px';
    inspectorInputs.shadow.value = eff.shadow;
    inspectorInputs.glow.value = String(Math.round(eff.glow * 100));
    inspectorVals.glow.textContent = Math.round(eff.glow * 100) + '%';
    var states = eff.states || {};
    inspectorHoverVal.textContent = inspectorStateSummary('hover', states);
    inspectorPressVal.textContent = inspectorStateSummary('active', states);
  }

  // Writes a component override from the inspector. Reaching the effective
  // default again removes the override (inheritance) — same as the component
  // editor, so both editors stay in sync.
  function onInspectorChange(prop, value) {
    beginEdit('Inspector \u00b7 ' + (PROP_LABELS[prop] || prop));
    if (!editingTheme.components) editingTheme.components = {};
    var over = editingTheme.components[inspectorKey] || (editingTheme.components[inspectorKey] = {});
    var defs = compDefaults();
    if (COMPONENT_COLOR_PROPS.indexOf(prop) !== -1) {
      if (value === defs[prop]) delete over[prop];
      else over[prop] = value;
    } else if (prop === 'radius') {
      var r = Number(value);
      if (r === defs.radius) delete over.radius;
      else over.radius = r;
    } else if (prop === 'shadow') {
      if (value === 'none') delete over.shadow;
      else over.shadow = value;
    } else if (prop === 'glow') {
      var g = Math.round(Number(value)) / 100;
      if (g <= 0) delete over.glow;
      else over.glow = g;
    }
    if (!Object.keys(over).length) delete editingTheme.components[inspectorKey];
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    renderInspector();
    renderComponentsList();
    schedulePreview();
  }

  function resetInspectorComponent() {
    beginEdit('Reset ' + COMPONENT_LABELS[inspectorKey]);
    if (editingTheme.components) delete editingTheme.components[inspectorKey];
    renderInspector();
    renderComponentsList();
    editingDirty = true;
    setEditStatus('Component reset \u2014 preview applied');
    schedulePreview();
    toastMsg('Component reset.');
  }

  /* ------------------------------------------------------------ */
  /* VS9 — Advanced CSS                                            */
  /*                                                               */
  /* The escape hatch: raw CSS injected into Freebuff, validated,  */
  /* scoped, with the theme's tokens available as CSS variables    */
  /* (var(--theme-*)). Everything previews live.                   */
  /* ------------------------------------------------------------ */

  function openAdvanced() {
    if (!advEditor) return;
    advEditor.value = editingTheme.extraCss || '';
    advScopeSel.value = editingTheme.cssScope === 'surfaces' ? 'surfaces' : 'app';
    editMain.hidden = true;
    compDetail.hidden = true;
    compStateDetail.hidden = true;
    if (inspectorDetail) inspectorDetail.hidden = true;
    advDetail.hidden = false;
    editFoot.hidden = true;
    renderAdvEditor();
    renderAdvTokens();
    setEditStatus('');
    advEditor.focus();
  }

  function closeAdvanced() {
    advDetail.hidden = true;
    showEditMain();
  }

  function advEscapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function advLineCol(src, idx) {
    var line = 1, col = 1;
    for (var i = 0; i < idx && i < src.length; i++) {
      if (src[i] === '\\n') { line += 1; col = 1; } else col += 1;
    }
    return { line: line, col: col };
  }

  // Mirrors validateCustomCss in the model (the panel is a self-contained
  // script): safety checks + brace/quote balance. Returns a list of
  // { line, col, message } — empty means the CSS is usable.
  function validateAdvCssUi(src) {
    var errors = [];
    if (!src || !src.trim()) return errors;
    if (src.length > 20000) errors.push({ line: 1, col: 1, message: 'Custom CSS is limited to 20,000 characters.' });
    var lt = src.indexOf('<');
    if (lt !== -1) {
      var pos = advLineCol(src, lt);
      errors.push({ line: pos.line, col: pos.col, message: 'The "<" character is not allowed (no HTML inside CSS).' });
    }
    var imp = /@import\b/i.exec(src);
    if (imp) {
      var p2 = advLineCol(src, imp.index);
      errors.push({ line: p2.line, col: p2.col, message: '@import is not allowed (external stylesheets are blocked).' });
    }
    var js = /javascript\\s*:/i.exec(src);
    if (js) {
      var p3 = advLineCol(src, js.index);
      errors.push({ line: p3.line, col: p3.col, message: '"javascript:" URLs are not allowed.' });
    }
    var stack = [], quote = null, pairs = { '}': '{', ')': '(', ']': '[' };
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (quote) {
        if (ch === '\\\\') i += 1;
        else if (ch === quote) quote = null;
      } else if (ch === '/' && src[i + 1] === '*') {
        i += 1;
        while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
        i += 1;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{' || ch === '(' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ')' || ch === ']') {
        var last = stack.pop();
        if (!last || last !== pairs[ch]) {
          var pos4 = advLineCol(src, i);
          errors.push({ line: pos4.line, col: pos4.col, message: 'Unbalanced "' + ch + '" \u2014 check your braces and parentheses.' });
          return errors;
        }
      }
    }
    if (!errors.length && stack.length) {
      var pos5 = advLineCol(src, src.length);
      errors.push({ line: pos5.line, col: pos5.col, message: 'Unclosed "' + stack[0] + '" \u2014 a block is never closed.' });
    }
    if (!errors.length && quote) {
      errors.push({ line: 1, col: src.length, message: 'Unclosed string \u2014 check your quotes.' });
    }
    return errors;
  }

  // A small syntax highlighter (comments, strings, at-rules, selectors,
  // properties, values, numbers) rendered as HTML into the overlay <pre>.
  function highlightCssUi(src) {
    function tok(cls, text) { return cls ? '<span class="fbt-tok-' + cls + '">' + text + '</span>' : text; }
    var html = '';
    var i = 0, n = src.length, depth = 0;
    while (i < n) {
      var ch = src[i];
      if (ch === '/' && src[i + 1] === '*') {
        var ce = src.indexOf('*/', i + 2);
        var cst = ce === -1 ? n : ce + 2;
        html += tok('c', advEscapeHtml(src.slice(i, cst)));
        i = cst;
      } else if (ch === '"' || ch === "'") {
        var q = ch, j = i + 1;
        while (j < n && src[j] !== q) { if (src[j] === '\\\\') j += 1; j += 1; }
        html += tok('s', advEscapeHtml(src.slice(i, Math.min(j + 1, n))));
        i = Math.min(j + 1, n);
      } else if (ch === '{') { depth += 1; html += tok('x', '{'); i += 1; }
      else if (ch === '}') { depth = Math.max(0, depth - 1); html += tok('x', '}'); i += 1; }
      else if (ch === '@') {
        var k = i;
        while (k < n && /[a-zA-Z0-9-]/.test(src[k])) k += 1;
        html += tok('a', advEscapeHtml(src.slice(i, k)));
        i = k;
      } else if (/[a-zA-Z_-]/.test(ch)) {
        var m = i;
        while (m < n && /[a-zA-Z0-9_-]/.test(src[m])) m += 1;
        var word = src.slice(i, m);
        var look = m;
        while (look < n && /\\s/.test(src[look])) look += 1;
        html += tok(depth >= 1 && src[look] === ':' ? 'p' : (depth === 0 ? 'sel' : 'v'), advEscapeHtml(word));
        i = m;
      } else if (/[0-9]/.test(ch)) {
        var d = i;
        while (d < n && /[0-9.%a-zA-Z-]/.test(src[d])) d += 1;
        html += tok('n', advEscapeHtml(src.slice(i, d)));
        i = d;
      } else {
        html += tok('x', advEscapeHtml(ch));
        i += 1;
      }
    }
    return html;
  }

  function renderAdvEditor() {
    var css = advEditor.value;
    advHighlight.innerHTML = highlightCssUi(css) + (css && !css.endsWith('\\n') ? '\\n' : '');
    var errors = validateAdvCssUi(css);
    var hasContent = !!css.trim();
    advErrorsEl.hidden = !errors.length;
    advOkEl.hidden = !(hasContent && !errors.length);
    if (errors.length) {
      var lines = [];
      for (var i = 0; i < Math.min(3, errors.length); i++) {
        lines.push('Line ' + errors[i].line + ', col ' + errors[i].col + ': ' + errors[i].message);
      }
      if (errors.length > 3) lines.push('\u2026 and ' + (errors.length - 3) + ' more.');
      advErrorsEl.textContent = lines.join('\\n');
    } else if (hasContent) {
      advOkEl.textContent = 'Valid CSS \u2014 injected live \u2713';
    }
  }

  function onAdvInput() {
    // Snapshot BEFORE the debounce updates editingTheme, so the gesture
    // captures the pre-edit state (native text undo keeps working inside
    // the textarea: it fires input and lands here as a normal change).
    beginEdit('Custom CSS');
    clearTimeout(advTimer);
    advTimer = setTimeout(function () {
      editingTheme.extraCss = advEditor.value;
      editingDirty = true;
      setEditStatus('Live preview \u2014 not saved');
      renderAdvEditor();
      schedulePreview();
    }, 160);
  }

  function onAdvScopeChange() {
    beginEdit('CSS scope');
    editingTheme.cssScope = advScopeSel.value;
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function resetAdvCss() {
    beginEdit('Reset custom CSS');
    editingTheme.extraCss = '';
    advEditor.value = '';
    renderAdvEditor();
    editingDirty = true;
    setEditStatus('Custom CSS reset \u2014 preview applied');
    schedulePreview();
    toastMsg('Custom CSS reset.');
  }

  function advTokenEntries() {
    var t = editingTheme.tokens || {};
    var s = editingTheme.shape || shapeDefaults();
    return [
      ['--theme-background', t.background || '#000000'],
      ['--theme-surface', t.surface || '#000000'],
      ['--theme-text', t.text || '#000000'],
      ['--theme-text-muted', t.textMuted || '#000000'],
      ['--theme-border', t.border || '#000000'],
      ['--theme-accent', t.accent || '#000000'],
      ['--theme-radius', (s.radius || 0) + 'px'],
      ['--theme-border-width', (s.borderWidth || 0) + 'px'],
      ['--theme-border-opacity', String(s.borderOpacity !== undefined ? s.borderOpacity : 1)],
      ['--theme-shadow', 'the theme\u2019s shadow']
    ];
  }

  function renderAdvTokens() {
    advTokensEl.textContent = '';
    advTokenEntries().forEach(function (entry) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fbt-token-chip';
      chip.title = 'Click to copy ' + entry[0];
      var name = document.createElement('b');
      name.textContent = entry[0];
      var val = document.createElement('span');
      val.textContent = ' ' + entry[1];
      chip.appendChild(name);
      chip.appendChild(val);
      chip.addEventListener('click', function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(entry[0]).catch(function () {});
          }
        } catch (e) {}
        toastMsg('Copied ' + entry[0]);
      });
      advTokensEl.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------ */
  /* VS10 — undo / redo + history                                  */
  /*                                                               */
  /* The editor records a snapshot of the theme BEFORE every change  */
  /* (one snapshot per gesture: a slider drag or a burst of typing  */
  /* = one step). Undo / Redo restore previous / next states and    */
  /* re-render every editor view live. All resets (property,        */
  /* component, state, custom CSS, theme) are part of the history,  */
  /* so the user can experiment without fear of breaking a theme.   */
  /* ------------------------------------------------------------ */

  function snapshotTheme() {
    return JSON.parse(JSON.stringify(editingTheme));
  }

  // Records the state BEFORE a change. Called at the start of every mutation
  // (tokens, components, states, inspector, shape, effects, motion, custom
  // CSS, presets, resets). One gesture = one undo step.
  function beginEdit(label) {
    if (!editingTheme) return;
    if (!editGesture) {
      editGesture = true;
      undoStack.push({ label: label, theme: snapshotTheme() });
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      renderHistoryUi();
    }
    clearTimeout(editGestureTimer);
    editGestureTimer = setTimeout(function () {
      editGesture = false;
      renderHistoryUi();
    }, 350);
  }

  function cancelGesture() {
    editGesture = false;
    clearTimeout(editGestureTimer);
  }

  function applySnapshot(snap) {
    editingTheme = JSON.parse(JSON.stringify(snap.theme));
    if (!editingTheme.components) editingTheme.components = {};
    if (!editingTheme.shape) editingTheme.shape = shapeDefaults();
    if (!editingTheme.shadow) editingTheme.shadow = shadowDefaults();
    if (!editingTheme.effects) editingTheme.effects = effectsDefaults();
    if (!editingTheme.motion) editingTheme.motion = motionDefaults();
    editingDirty = true;
    setEditStatus('History \u2014 preview applied');
    syncEditors();
    schedulePreview();
    renderHistoryUi();
  }

  function undo() {
    if (!undoStack.length) return;
    cancelGesture();
    var snap = undoStack.pop();
    redoStack.push({ label: snap.label, theme: snapshotTheme() });
    applySnapshot(snap);
    toastMsg('Undo \u2014 ' + snap.label);
  }

  function redo() {
    if (!redoStack.length) return;
    cancelGesture();
    var snap = redoStack.pop();
    undoStack.push({ label: snap.label, theme: snapshotTheme() });
    applySnapshot(snap);
    toastMsg('Redo \u2014 ' + snap.label);
  }

  // History jump: a click on a past/future step undoes/redoes until it is
  // reached. Undo #k applies undoStack[len-k], so landing on undoStack[i]
  // needs len-i undos; symmetrically redoStack[i] needs len-i redos (the
  // stacks shrink as we walk, so the count is captured upfront). Bounded,
  // so a corrupt list can never loop forever.
  function jumpHistory(snap) {
    var i = undoStack.indexOf(snap);
    if (i !== -1) {
      var total = undoStack.length;
      for (var k = 0; k < total - i && undoStack.length; k++) undo();
      return;
    }
    i = redoStack.indexOf(snap);
    if (i !== -1) {
      var total2 = redoStack.length;
      for (var k2 = 0; k2 < total2 - i && redoStack.length; k2++) redo();
    }
  }

  // Re-syncs every editor view from editingTheme (after undo/redo/reset).
  function syncEditors() {
    TOKEN_KEYS.forEach(function (k) {
      tokenInputs[k].value = editingTheme.tokens[k] || '#000000';
    });
    renderShapeInputs();
    renderShadowLayers();
    renderEffectsInputs();
    renderMotionInputs();
    renderComponentsList();
    if (advEditor) {
      advEditor.value = editingTheme.extraCss || '';
      advScopeSel.value = editingTheme.cssScope === 'surfaces' ? 'surfaces' : 'app';
      renderAdvTokens();
      if (!advDetail.hidden) renderAdvEditor();
    }
    if (!compDetail.hidden && editingComponentKey) syncComponentInputs();
    if (!compStateDetail.hidden && editingStateKey) syncStateInputs();
    if (inspectorDetail && !inspectorDetail.hidden && inspectorKey) renderInspector();
  }

  function renderHistoryUi() {
    if (!historyBar) return;
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    historyCountEl.textContent = undoStack.length
      ? undoStack.length + (undoStack.length > 1 ? ' steps' : ' step')
      : (redoStack.length ? 'Redo available' : 'No changes yet');
    historyListEl.textContent = '';
    if (!undoStack.length && !redoStack.length) {
      var empty = document.createElement('div');
      empty.className = 'fbt-empty';
      empty.textContent = 'Every change is recorded here \u2014 undo, redo or jump back at any time.';
      historyListEl.appendChild(empty);
      return;
    }
    var current = document.createElement('div');
    current.className = 'fbt-history-item current';
    current.textContent = 'Current state';
    historyListEl.appendChild(current);
    // Past steps, most recent first.
    for (var i = undoStack.length - 1; i >= 0; i--) {
      var it = document.createElement('button');
      it.type = 'button';
      it.className = 'fbt-history-item';
      it.textContent = '\u21ba ' + undoStack[i].label;
      (function (snap) {
        it.addEventListener('click', function () { jumpHistory(snap); });
      })(undoStack[i]);
      historyListEl.appendChild(it);
    }
    // Future steps, in order.
    for (var j = 0; j < redoStack.length; j++) {
      var it2 = document.createElement('button');
      it2.type = 'button';
      it2.className = 'fbt-history-item future';
      it2.textContent = '\u21bb ' + redoStack[j].label;
      (function (snap) {
        it2.addEventListener('click', function () { jumpHistory(snap); });
      })(redoStack[j]);
      historyListEl.appendChild(it2);
    }
  }

  // Per-property reset ("Reset property"): removes the override of a single
  // property back to its effective default — undoable like any other change.
  function makePropResetBtn(prop, target) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fbt-prop-reset';
    b.title = 'Reset to default';
    b.textContent = '\u21ba';
    b.addEventListener('click', function () {
      if (target === 'inspector') resetInspectorProperty(prop);
      else resetComponentProperty(prop);
    });
    return b;
  }

  function resetComponentProperty(prop) {
    if (!editingComponentKey) return;
    beginEdit('Reset ' + (PROP_LABELS[prop] || prop));
    if (editingTheme.components && editingTheme.components[editingComponentKey]) {
      var over = editingTheme.components[editingComponentKey];
      delete over[prop];
      if (!Object.keys(over).length) delete editingTheme.components[editingComponentKey];
    }
    syncComponentInputs();
    renderComponentsList();
    editingDirty = true;
    setEditStatus('Property reset \u2014 preview applied');
    schedulePreview();
    toastMsg((PROP_LABELS[prop] || prop) + ' reset to default.');
  }

  function resetInspectorProperty(prop) {
    if (!inspectorKey) return;
    beginEdit('Inspector \u00b7 ' + (PROP_LABELS[prop] || prop));
    if (editingTheme.components && editingTheme.components[inspectorKey]) {
      var over = editingTheme.components[inspectorKey];
      delete over[prop];
      if (!Object.keys(over).length) delete editingTheme.components[inspectorKey];
    }
    renderInspector();
    renderComponentsList();
    editingDirty = true;
    setEditStatus('Property reset \u2014 preview applied');
    schedulePreview();
    toastMsg((PROP_LABELS[prop] || prop) + ' reset to default.');
  }

  /* ------------------------------------------------------------ */
  /* VS4 — global shape + multi-layer shadows                      */
  /* ------------------------------------------------------------ */

  function shapeDefaults() {
    return { radius: 0, borderWidth: 0, borderOpacity: 1 };
  }

  function shadowDefaults() {
    return { layers: [] };
  }

  function shapeValLabel(field, value) {
    var v = Number(value);
    if (v === 0) return 'App default';
    if (field === 'borderOpacity') return v + ' %';
    return v + ' px';
  }

  function renderShapeInputs() {
    if (!shapeInputs.radius) return;
    var s = editingTheme.shape || {};
    shapeInputs.radius.value = String(s.radius !== undefined ? s.radius : 0);
    shapeInputs.borderWidth.value = String(s.borderWidth !== undefined ? s.borderWidth : 0);
    shapeInputs.borderOpacity.value = String(Math.round((s.borderOpacity !== undefined ? s.borderOpacity : 1) * 100));
    shapeRadiusVal.textContent = shapeValLabel('radius', shapeInputs.radius.value);
    shapeBorderVal.textContent = shapeValLabel('borderWidth', shapeInputs.borderWidth.value);
    shapeOpacityVal.textContent = shapeValLabel('borderOpacity', shapeInputs.borderOpacity.value);
  }

  function onShapeChange(field, value) {
    beginEdit('Shape \u00b7 ' + (SHAPE_FIELD_LABELS[field] || field));
    if (!editingTheme.shape) editingTheme.shape = shapeDefaults();
    editingTheme.shape[field] = field === 'borderOpacity' ? Number(value) / 100 : Number(value);
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    renderShapeInputs();
    schedulePreview();
  }

  function renderShadowLayers() {
    shadowLayersEl.textContent = '';
    var layers = (editingTheme.shadow && editingTheme.shadow.layers) || [];
    if (!layers.length) {
      var empty = document.createElement('div');
      empty.className = 'fbt-empty';
      empty.textContent = 'No shadow \u2014 pick a preset or add a layer.';
      shadowLayersEl.appendChild(empty);
      return;
    }
    layers.forEach(function (layer, idx) {
      shadowLayersEl.appendChild(buildShadowLayer(layer, idx));
    });
  }

  function buildShadowLayer(layer, idx) {
    var box = document.createElement('div');
    box.className = 'fbt-shadow-layer';
    var head = document.createElement('div');
    head.className = 'fbt-shadow-layer-head';
    var headLabel = document.createElement('span');
    headLabel.textContent = 'Layer ' + (idx + 1);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fbt-layer-remove';
    remove.textContent = '\u00d7';
    remove.title = 'Remove this layer';
    remove.addEventListener('click', function () { removeShadowLayer(idx); });
    head.appendChild(headLabel);
    head.appendChild(remove);
    box.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'fbt-layer-grid';
    [['x', 'X'], ['y', 'Y'], ['blur', 'Blur'], ['spread', 'Spread']].forEach(function (f) {
      var field = f[0], fieldLabel = f[1];
      var wrap = document.createElement('label');
      wrap.className = 'fbt-layer-field';
      var lab = document.createElement('span');
      lab.className = 'fbt-layer-label';
      lab.textContent = fieldLabel;
      var sliderRow = document.createElement('span');
      sliderRow.className = 'fbt-layer-slider-row';
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.min = field === 'blur' ? '0' : '-40';
      slider.max = field === 'blur' ? '80' : '40';
      slider.value = String(layer[field] || 0);
      var val = document.createElement('span');
      val.className = 'fbt-range-val';
      val.textContent = slider.value + ' px';
      slider.addEventListener('input', function () {
        val.textContent = slider.value + ' px';
        updateShadowLayer(idx, field, Number(slider.value));
      });
      sliderRow.appendChild(slider);
      sliderRow.appendChild(val);
      wrap.appendChild(lab);
      wrap.appendChild(sliderRow);
      grid.appendChild(wrap);
    });
    box.appendChild(grid);

    var colorRow = document.createElement('div');
    colorRow.className = 'fbt-layer-color-row';
    var colorLabel = document.createElement('label');
    colorLabel.textContent = 'Color';
    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = layer.color || '#000000';
    colorInput.addEventListener('input', function () { updateShadowLayer(idx, 'color', colorInput.value); });
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInput);
    box.appendChild(colorRow);

    var opRow = document.createElement('div');
    opRow.className = 'fbt-range-row';
    opRow.style.borderBottom = 'none';
    opRow.style.padding = '4px 0';
    var opLabel = document.createElement('label');
    opLabel.textContent = 'Opacity';
    var opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.min = '0';
    opSlider.max = '100';
    opSlider.value = String(Math.round((layer.opacity || 0) * 100));
    var opVal = document.createElement('span');
    opVal.className = 'fbt-range-val';
    opVal.textContent = opSlider.value + ' %';
    opSlider.addEventListener('input', function () {
      opVal.textContent = opSlider.value + ' %';
      updateShadowLayer(idx, 'opacity', Number(opSlider.value) / 100);
    });
    opRow.appendChild(opLabel);
    opRow.appendChild(opSlider);
    opRow.appendChild(opVal);
    box.appendChild(opRow);

    var innerRow = document.createElement('div');
    innerRow.className = 'fbt-layer-inner';
    var innerCheck = document.createElement('input');
    innerCheck.type = 'checkbox';
    innerCheck.checked = Boolean(layer.inner);
    innerCheck.addEventListener('change', function () { updateShadowLayer(idx, 'inner', innerCheck.checked); });
    var innerLabel = document.createElement('span');
    innerLabel.textContent = 'Inner shadow';
    innerRow.appendChild(innerCheck);
    innerRow.appendChild(innerLabel);
    box.appendChild(innerRow);
    return box;
  }

  function updateShadowLayer(idx, field, value) {
    beginEdit('Shadow layer');
    var layers = (editingTheme.shadow && editingTheme.shadow.layers) || [];
    if (!layers[idx]) return;
    layers[idx][field] = value;
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function addShadowLayer() {
    beginEdit('Add shadow layer');
    if (!editingTheme.shadow) editingTheme.shadow = shadowDefaults();
    editingTheme.shadow.layers.push({
      x: 0,
      y: 2,
      blur: 8,
      spread: 0,
      color: (editingTheme.tokens && editingTheme.tokens.accent) || '#000000',
      opacity: 0.25,
      inner: false
    });
    renderShadowLayers();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function removeShadowLayer(idx) {
    beginEdit('Remove shadow layer');
    var layers = (editingTheme.shadow && editingTheme.shadow.layers) || [];
    layers.splice(idx, 1);
    renderShadowLayers();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function applyShapePreset(name) {
    var p = SHAPE_PRESETS[name];
    if (!p) return;
    beginEdit('Preset \u2014 ' + p.label);
    var accent = (editingTheme.tokens && editingTheme.tokens.accent) || '#7cff3f';
    editingTheme.shape = { radius: p.radius, borderWidth: p.borderWidth, borderOpacity: p.borderOpacity };
    editingTheme.shadow = {
      layers: p.shadow.map(function (l) {
        return {
          x: l.x,
          y: l.y,
          blur: l.blur,
          spread: l.spread,
          color: l.color === 'ACCENT' ? accent : l.color,
          opacity: l.opacity,
          inner: l.inner
        };
      })
    };
    renderShapeInputs();
    renderShadowLayers();
    editingDirty = true;
    setEditStatus('Preset "' + p.label + '" applied \u2014 not saved');
    schedulePreview();
    toastMsg('Preset "' + p.label + '" applied.');
  }

  /* ------------------------------------------------------------ */
  /* VS5 — glass & visual effects                                  */
  /* ------------------------------------------------------------ */

  function effectsDefaults() {
    return { enabled: false, mode: 'none', transparency: 1, blur: 0, saturation: 1, brightness: 1, borderTranslucency: 1, glow: 0, gradient: 0, grain: 0, performance: 'auto' };
  }

  function renderEffectsInputs() {
    if (!effectsInputs.transparency) return;
    var e = editingTheme.effects || {};
    effectsEnable.checked = Boolean(e.enabled);
    EFFECT_SLIDERS.forEach(function (f) {
      var field = f[0];
      var v = e[field] !== undefined ? e[field] : 1;
      var unit = f[4];
      if (unit === '%') v = Math.round(v * 100);
      effectsInputs[field].value = String(v);
      effectsVals[field].textContent = v + (unit === '%' ? ' %' : ' px');
    });
    renderEffectsPerf();
    // Highlight the preset that produced the current values.
    var current = effectsPresetRow.querySelector('.active');
    if (current) current.classList.remove('active');
    var mode = EFFECT_PRESETS[e.mode] ? e.mode : null;
    if (mode) {
      var chip = effectsPresetRow.querySelector('[data-preset="' + mode + '"]');
      if (chip) chip.classList.add('active');
    }
  }

  // Performance report: detect the heavy effects (backdrop blur, noise) and
  // expose a switch to neutralize them — the "performance control" of VS5.
  function renderEffectsPerf() {
    if (!effectsPerfBadge) return;
    var e = editingTheme.effects || {};
    var heavy = [];
    if (e.enabled && e.blur > 0) heavy.push('backdrop blur');
    if (e.enabled && e.grain > 0) heavy.push('noise grain');
    if (e.performance === 'off') {
      effectsPerfBadge.textContent = 'Performance mode: heavy effects off';
      effectsPerfBadge.className = 'fbt-perf ok';
      effectsPerfToggle.textContent = 'Re-enable heavy effects';
      effectsPerfToggle.style.display = '';
    } else if (heavy.length) {
      effectsPerfBadge.textContent = 'Heavy effects: ' + heavy.join(', ');
      effectsPerfBadge.className = 'fbt-perf warn';
      effectsPerfToggle.textContent = 'Disable heavy effects';
      effectsPerfToggle.style.display = '';
    } else if (!e.enabled) {
      effectsPerfBadge.textContent = 'Effects disabled';
      effectsPerfBadge.className = 'fbt-perf';
      effectsPerfToggle.style.display = 'none';
    } else {
      effectsPerfBadge.textContent = 'Light effects \u2014 no performance impact';
      effectsPerfBadge.className = 'fbt-perf ok';
      effectsPerfToggle.style.display = 'none';
    }
  }

  function onEffectChange(field, value) {
    var effLabel = field;
    EFFECT_SLIDERS.forEach(function (f) { if (f[0] === field) effLabel = f[1]; });
    beginEdit('Effects \u00b7 ' + effLabel);
    if (!editingTheme.effects) editingTheme.effects = effectsDefaults();
    var unit = null;
    EFFECT_SLIDERS.forEach(function (f) { if (f[0] === field) unit = f[4]; });
    editingTheme.effects[field] = unit === '%' ? Number(value) / 100 : Number(value);
    editingTheme.effects.enabled = true;
    editingTheme.effects.mode = 'none';
    renderEffectsInputs();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function toggleEffectsEnabled() {
    beginEdit(effectsEnable.checked ? 'Effects on' : 'Effects off');
    if (!editingTheme.effects) editingTheme.effects = effectsDefaults();
    editingTheme.effects.enabled = effectsEnable.checked;
    if (!effectsEnable.checked) editingTheme.effects.mode = 'none';
    renderEffectsInputs();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function togglePerfMode() {
    beginEdit('Performance mode');
    if (!editingTheme.effects) editingTheme.effects = effectsDefaults();
    editingTheme.effects.performance = editingTheme.effects.performance === 'off' ? 'auto' : 'off';
    renderEffectsPerf();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function applyEffectsPreset(name) {
    var p = EFFECT_PRESETS[name];
    if (!p) return;
    beginEdit('Preset \u2014 ' + p.label);
    editingTheme.effects = {
      enabled: p.enabled,
      mode: name,
      transparency: p.transparency,
      blur: p.blur,
      saturation: p.saturation,
      brightness: p.brightness,
      borderTranslucency: p.borderTranslucency,
      glow: p.glow,
      gradient: p.gradient,
      grain: p.grain,
      performance: (editingTheme.effects && editingTheme.effects.performance) || 'auto'
    };
    renderEffectsInputs();
    editingDirty = true;
    setEditStatus('Preset "' + p.label + '" applied \u2014 not saved');
    schedulePreview();
    toastMsg('Effects preset "' + p.label + '" applied.');
  }

  /* ------------------------------------------------------------ */
  /* VS6 — motion engine                                           */
  /* ------------------------------------------------------------ */

  function motionDefaults() {
    return { preset: 'minimal', duration: 0, easing: 'ease', delay: 0, hover: { translateY: 0, scale: 1 }, active: { scale: 1 }, focus: { scale: 1 }, enter: false, global: { speed: 1, intensity: 1, reduced: 'auto' } };
  }

  // VS7 — the global scale, mirrored from motionEffective in the model: speed
  // multiplies every duration, intensity scales the per-state transforms.
  function motionEffectiveUi(m) {
    var g = m.global || {};
    var speed = g.speed !== undefined ? g.speed : 1;
    var intensity = g.intensity !== undefined ? g.intensity : 1;
    var intScale = function (v) { return Math.round((1 + (v - 1) * intensity) * 100) / 100; };
    return {
      duration: Math.max(0, Math.round((m.duration !== undefined ? m.duration : 0) * speed)),
      easing: m.easing || 'ease',
      hover: { translateY: Math.round((m.hover ? m.hover.translateY : 0) * intensity), scale: intScale(m.hover ? m.hover.scale : 1) },
      active: { scale: intScale(m.active ? m.active.scale : 1) }
    };
  }

  function motionTransformCss(hover) {
    var parts = [];
    if (hover.translateY) parts.push('translateY(' + hover.translateY + 'px)');
    if (hover.scale !== 1) parts.push('scale(' + hover.scale + ')');
    return parts.join(' ') || 'none';
  }

  function renderMotionInputs() {
    if (!motionInputs.duration) return;
    var m = editingTheme.motion || {};
    motionInputs.duration.value = String(m.duration !== undefined ? m.duration : 0);
    motionInputs.delay.value = String(m.delay !== undefined ? m.delay : 0);
    motionInputs.easing.value = m.easing !== undefined ? m.easing : 'ease';
    motionInputs.hoverY.value = String(m.hover ? m.hover.translateY : 0);
    motionInputs.hoverScale.value = String(m.hover ? m.hover.scale : 1);
    motionInputs.activeScale.value = String(m.active ? m.active.scale : 1);
    motionInputs.focusScale.value = String(m.focus ? m.focus.scale : 1);
    motionEnter.checked = Boolean(m.enter);
    var mg = m.global || {};
    motionInputs.speed.value = String(mg.speed !== undefined ? mg.speed : 1);
    motionInputs.intensity.value = String(mg.intensity !== undefined ? mg.intensity : 1);
    motionReduced.checked = mg.reduced !== 'off';
    motionVals.duration.textContent = motionInputs.duration.value + ' ms';
    motionVals.delay.textContent = motionInputs.delay.value + ' ms';
    motionVals.hoverY.textContent = motionInputs.hoverY.value + ' px';
    motionVals.hoverScale.textContent = Number(motionInputs.hoverScale.value).toFixed(2);
    motionVals.activeScale.textContent = Number(motionInputs.activeScale.value).toFixed(2);
    motionVals.focusScale.textContent = Number(motionInputs.focusScale.value).toFixed(2);
    motionVals.speed.textContent = Number(motionInputs.speed.value).toFixed(1) + '\u00d7';
    motionVals.intensity.textContent = Number(motionInputs.intensity.value).toFixed(1);
    var current = motionPresetRow.querySelector('.active');
    if (current) current.classList.remove('active');
    // Highlight the preset whose VALUES match the current ones — a manual
    // tweak removes the highlight even if the preset field was left behind.
    var matched = null;
    Object.keys(MOTION_PRESETS).forEach(function (k) {
      var p = MOTION_PRESETS[k];
      if (p.duration === m.duration && p.easing === m.easing && p.hover.translateY === (m.hover || {}).translateY && p.hover.scale === (m.hover || {}).scale && p.active.scale === (m.active || {}).scale && p.focus.scale === (m.focus || {}).scale && p.enter === m.enter) matched = k;
    });
    if (matched) {
      var chip = motionPresetRow.querySelector('[data-preset="' + matched + '"]');
      if (chip) chip.classList.add('active');
    }
    paintMotionPreview();
  }

  function onMotionChange(field, value) {
    beginEdit('Motion \u00b7 ' + (MOTION_FIELD_LABELS[field] || field));
    if (!editingTheme.motion) editingTheme.motion = motionDefaults();
    var m = editingTheme.motion;
    if (field === 'duration' || field === 'delay') m[field] = Number(value);
    else if (field === 'enter') m.enter = Boolean(value);
    else if (field === 'easing') m.easing = value;
    else if (field === 'hoverY' || field === 'hoverScale') { if (!m.hover) m.hover = { translateY: 0, scale: 1 }; m.hover[field === 'hoverY' ? 'translateY' : 'scale'] = Number(value); }
    else if (field === 'activeScale') { if (!m.active) m.active = { scale: 1 }; m.active.scale = Number(value); }
    else if (field === 'focusScale') { if (!m.focus) m.focus = { scale: 1 }; m.focus.scale = Number(value); }
    else if (field === 'speed' || field === 'intensity') { if (!m.global) m.global = { speed: 1, intensity: 1, reduced: 'auto' }; m.global[field] = Number(value); }
    else if (field === 'reduced') { if (!m.global) m.global = { speed: 1, intensity: 1, reduced: 'auto' }; m.global.reduced = value ? 'auto' : 'off'; }
    renderMotionInputs();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function applyMotionPreset(name) {
    var p = MOTION_PRESETS[name];
    if (!p) return;
    beginEdit('Preset \u2014 ' + p.label);
    // VS7 — the global scale survives a preset change: Speed / Intensity /
    // Reduced are the "personality", the preset is just the base behavior.
    var g = (editingTheme.motion && editingTheme.motion.global) || { speed: 1, intensity: 1, reduced: 'auto' };
    editingTheme.motion = {
      preset: name,
      duration: p.duration,
      easing: p.easing,
      delay: 0,
      hover: { translateY: p.hover.translateY, scale: p.hover.scale },
      active: { scale: p.active.scale },
      focus: { scale: p.focus.scale },
      enter: p.enter,
      global: g
    };
    renderMotionInputs();
    editingDirty = true;
    setEditStatus('Preset "' + p.label + '" applied \u2014 not saved');
    schedulePreview();
    toastMsg('Motion preset "' + p.label + '" applied.');
  }

  // Live preview: a real button inside the panel whose transition + transforms
  // follow the current motion values (hover it, press it).
  function paintMotionPreview() {
    if (!motionPreviewBtn) return;
    var m = motionEffectiveUi(editingTheme.motion || motionDefaults());
    var duration = m.duration !== undefined ? m.duration : 0;
    var easing = m.easing || 'ease';
    motionPreviewBtn.style.transition = 'transform ' + duration + 'ms ' + easing + ', box-shadow ' + duration + 'ms ' + easing;
    motionPreviewBtn.onmouseenter = function () {
      motionPreviewBtn.style.transform = motionTransformCss(m.hover || {});
      motionPreviewBtn.style.boxShadow = duration > 0 ? '0 6px 16px rgba(0, 0, 0, 0.35)' : 'none';
    };
    motionPreviewBtn.onmouseleave = function () {
      motionPreviewBtn.style.transform = 'none';
      motionPreviewBtn.style.boxShadow = 'none';
    };
    motionPreviewBtn.onmousedown = function () {
      motionPreviewBtn.style.transform = motionTransformCss({ translateY: 0, scale: (m.active && m.active.scale) || 1 });
    };
    motionPreviewBtn.onmouseup = function () {
      motionPreviewBtn.style.transform = 'none';
    };
  }

  /* ------------------------------------------------------------ */
  /* VS3 — component states                                        */
  /* ------------------------------------------------------------ */

  function stateOverrides(stateKey) {
    var over = editingComponentOverrides(editingComponentKey);
    return (over.states && over.states[stateKey]) || {};
  }

  // What a state falls back to when not overridden: the component's OWN
  // effective values (its override or the global token), so the editor
  // starts from what the button currently looks like.
  function stateDefaults() {
    var d = compDefaults();
    var over = editingComponentOverrides(editingComponentKey);
    return {
      background: over.background !== undefined ? over.background : d.background,
      text: over.text !== undefined ? over.text : d.text,
      border: over.border !== undefined ? over.border : d.border,
      accent: over.accent !== undefined ? over.accent : d.accent,
      shadow: over.shadow !== undefined ? over.shadow : d.shadow
    };
  }

  function renderStateList() {
    stateList.textContent = '';
    COMPONENT_STATES.forEach(function (key) {
      var st = stateOverrides(key);
      var count = Object.keys(st).length;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'fbt-state-row';
      row.dataset.state = key;
      var label = document.createElement('span');
      label.className = 'fbt-state-name';
      label.textContent = COMPONENT_STATE_LABELS[key];
      var summary = document.createElement('span');
      summary.className = 'fbt-state-summary';
      summary.textContent = count ? (count + (count > 1 ? ' settings modified' : ' setting modified')) : 'Default';
      var chevron = document.createElement('span');
      chevron.className = 'fbt-state-chevron';
      chevron.textContent = '\u203a';
      row.appendChild(label);
      row.appendChild(summary);
      row.appendChild(chevron);
      row.addEventListener('click', function () { openState(key); });
      stateList.appendChild(row);
    });
  }

  function syncStateInputs() {
    var defs = stateDefaults();
    var st = stateOverrides(editingStateKey);
    STATE_COLOR_PROPS.forEach(function (prop) {
      stateInputs[prop].value = st[prop] !== undefined ? st[prop] : defs[prop];
    });
    stateInputs.shadow.value = st.shadow !== undefined ? st.shadow : defs.shadow;
  }

  function openState(key) {
    editingStateKey = key;
    stateTitle.textContent = COMPONENT_LABELS[editingComponentKey] + ' \u00b7 ' + COMPONENT_STATE_LABELS[key];
    syncStateInputs();
    setEditStatus('');
    wirePreviewSim(key);
    compDetail.hidden = true;
    compStateDetail.hidden = false;
  }

  function onStateChange(prop, value) {
    beginEdit(COMPONENT_LABELS[editingComponentKey] + ' \u00b7 ' + COMPONENT_STATE_LABELS[editingStateKey] + ' \u00b7 ' + (PROP_LABELS[prop] || prop));
    var defs = stateDefaults();
    var normalized = String(value);
    if (!editingTheme.components) editingTheme.components = {};
    var comp = editingTheme.components[editingComponentKey] || (editingTheme.components[editingComponentKey] = {});
    if (!comp.states) comp.states = {};
    var st = comp.states[editingStateKey] || (comp.states[editingStateKey] = {});
    if (normalized === defs[prop]) {
      // Back to the effective component value \u2192 no visual change in this
      // state \u2192 drop the override (inheritance again).
      delete st[prop];
      if (!Object.keys(st).length) {
        delete comp.states[editingStateKey];
        if (!Object.keys(comp.states).length) delete comp.states;
        if (!Object.keys(comp).length) delete editingTheme.components[editingComponentKey];
      }
    } else {
      st[prop] = normalized;
    }
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    renderComponentsList();
    renderStateList();
    paintPreview();
    schedulePreview();
  }

  function resetState() {
    beginEdit('Reset ' + COMPONENT_LABELS[editingComponentKey] + ' \u00b7 ' + COMPONENT_STATE_LABELS[editingStateKey]);
    if (!editingTheme.components) editingTheme.components = {};
    var comp = editingTheme.components[editingComponentKey];
    if (comp && comp.states) {
      delete comp.states[editingStateKey];
      if (!Object.keys(comp.states).length) delete comp.states;
      if (!Object.keys(comp).length) delete editingTheme.components[editingComponentKey];
    }
    syncStateInputs();
    renderComponentsList();
    renderStateList();
    editingDirty = true;
    setEditStatus('State reset \u2014 preview applied');
    paintPreview();
    schedulePreview();
    toastMsg('State reset.');
  }

  // Live state preview: a real button showing the component's base look, whose
  // state style is applied by the browser's own events (hover, press, focus)
  // or permanently for disabled/loading.
  function paintPreview() {
    if (!statePreviewBtn) return;
    var defs = stateDefaults();
    var st = previewSim ? stateOverrides(previewSim) : {};
    var eff = {
      background: st.background !== undefined ? st.background : defs.background,
      text: st.text !== undefined ? st.text : defs.text,
      border: st.border !== undefined ? st.border : defs.border,
      shadow: st.shadow !== undefined ? st.shadow : defs.shadow
    };
    statePreviewBtn.style.cssText =
      'background:' + eff.background + ';color:' + eff.text + ';border:1px solid ' + eff.border
      + ';box-shadow:' + (SHADOW_VALUE_MAP[eff.shadow] || 'none');
  }

  function wirePreviewSim(state) {
    var btn = statePreviewBtn;
    btn.onmouseenter = btn.onmouseleave = btn.onmousedown = btn.onmouseup = btn.onfocus = btn.onblur = null;
    btn.disabled = false;
    btn.textContent = 'Preview button';
    previewSim = null;
    if (state === 'hover') {
      btn.onmouseenter = function () { previewSim = 'hover'; paintPreview(); };
      btn.onmouseleave = function () { previewSim = null; paintPreview(); };
      statePreviewNote.textContent = 'Hover this button to preview the hover style; move away to compare with the normal state.';
    } else if (state === 'active') {
      btn.onmousedown = function () { previewSim = 'active'; paintPreview(); };
      btn.onmouseup = function () { previewSim = null; paintPreview(); };
      btn.onmouseleave = function () { previewSim = null; paintPreview(); };
      statePreviewNote.textContent = 'Press and hold to preview the active style; release to compare with the normal state.';
    } else if (state === 'focus') {
      btn.onfocus = function () { previewSim = 'focus'; paintPreview(); };
      btn.onblur = function () { previewSim = null; paintPreview(); };
      statePreviewNote.textContent = 'Click (or Tab to) this button to preview the focus style; click elsewhere to compare.';
    } else if (state === 'disabled') {
      btn.disabled = true;
      previewSim = 'disabled';
      statePreviewNote.textContent = 'Disabled buttons look like this \u2014 they ignore clicks.';
    } else if (state === 'loading') {
      previewSim = 'loading';
      btn.textContent = 'Loading\u2026';
      statePreviewNote.textContent = 'Buttons look like this while loading.';
    }
    paintPreview();
  }

  function previewPayload() {
    return {
      theme: {
        id: editingTheme.id,
        colorScheme: editingTheme.colorScheme,
        tokens: editingTheme.tokens,
        components: editingTheme.components || {},
        shape: editingTheme.shape,
        shadow: editingTheme.shadow,
        effects: editingTheme.effects,
        motion: editingTheme.motion,
        extraCss: editingTheme.extraCss || '',
        cssScope: editingTheme.cssScope === 'surfaces' ? 'surfaces' : 'app'
      }
    };
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      fetch(API + '/api/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previewPayload()),
      }).catch(function () {});
    }, 140);
  }

  function openEditor(id) {
    var theme = themesById[id];
    if (!theme) return;
    editingTheme = JSON.parse(JSON.stringify(theme));
    if (!editingTheme.components) editingTheme.components = {};
    if (!editingTheme.shape) editingTheme.shape = shapeDefaults();
    if (!editingTheme.shadow) editingTheme.shadow = shadowDefaults();
    if (!editingTheme.effects) editingTheme.effects = effectsDefaults();
    if (!editingTheme.motion) editingTheme.motion = motionDefaults();
    editingDirty = false;
    // VS10 — a fresh edit session starts with an empty history.
    undoStack.length = 0;
    redoStack.length = 0;
    cancelGesture();
    renderHistoryUi();
    TOKEN_KEYS.forEach(function (k) {
      tokenInputs[k].value = editingTheme.tokens[k] || '#000000';
    });
    editName.textContent = (theme.name || theme.id) + (theme.builtin ? '' : '  (custom)');
    setEditStatus('');
    renderShapeInputs();
    renderShadowLayers();
    renderEffectsInputs();
    renderMotionInputs();
    if (advEditor) {
      advEditor.value = editingTheme.extraCss || '';
      advScopeSel.value = editingTheme.cssScope === 'surfaces' ? 'surfaces' : 'app';
    }
    renderComponentsList();
    switchEditorTab(activeTab);
    showEditMain();
    viewList.hidden = true;
    viewEdit.hidden = false;
    updateNav();
  }

  function closeEditor(revertPreview) {
    if (inspectMode) exitInspectMode();
    if (inspectorEl) { inspectorEl = null; inspectorKey = null; }
    hideInspectHighlight();
    if (revertPreview && editingDirty) {
      // Return the app to the saved state: the theme that was active when the
      // editor opened, or the original look if none.
      if (activeThemeId && themesById[activeThemeId]) {
        fetch(API + '/api/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ themeId: activeThemeId }),
        }).catch(function () {});
      } else {
        fetch(API + '/api/restore', { method: 'POST' }).catch(function () {});
      }
    }
    editingComponentKey = null;
    undoStack.length = 0;
    redoStack.length = 0;
    cancelGesture();
    renderHistoryUi();
    // showEditMain() re-renders the component list, which still reads
    // editingTheme — so it must run before the session is dropped.
    showEditMain();
    editingTheme = null;
    editingDirty = false;
    viewEdit.hidden = true;
    viewList.hidden = false;
    updateNav();
  }

  function onTokenInput(key) {
    beginEdit(TOKEN_LABELS[key]);
    editingTheme.tokens[key] = tokenInputs[key].value;
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  // VS11 — export the current editing theme as a portable .freebuff file:
  // the standalone serializes it, the panel turns the text into a download.
  function exportTheme() {
    if (!editingTheme) return;
    fetch(API + '/api/themes/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: editingTheme }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok && res.content) {
          downloadTheme(res.content, res.filename || 'theme.freebuff');
          toastMsg('Theme exported \u2014 ' + (res.filename || 'theme.freebuff'));
        } else {
          toastMsg((res && res.message) || 'Could not export the theme.');
        }
      })
      .catch(function () { toastMsg('Studio offline \u2014 export failed.'); });
  }

  function downloadTheme(content, filename) {
    try {
      var blob = new Blob([content], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      toastMsg('Export failed \u2014 ' + e.message);
    }
  }

  // VS11 — import: read the picked file, let the standalone validate and
  // install it, then refresh the list (the theme appears without touching
  // the built-ins).
  function importThemeFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      fetch(API + '/api/themes/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: String(file.name || '').replace(/\.(freebuff|json)$/i, ''), content: String(reader.result || '') }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok && res.theme) {
            toastMsg('Theme "' + res.theme.name + '" imported \u2713');
            refresh();
          } else {
            toastMsg((res && res.message) || 'Could not import the theme.');
          }
        })
        .catch(function () { toastMsg('Studio offline \u2014 import failed.'); });
    };
    reader.onerror = function () { toastMsg('Could not read the file.'); };
    reader.readAsText(file);
  }

  // VS12 — theme creation: pick a name and a base, the standalone installs a
  // brand-new user theme (never overwrites the base) and we open it in the
  // editor. The whole dialog lives inside the panel's shadow root.
  function openCreate() {
    createName.value = '';
    createBases.textContent = '';
    var seen = {};
    function addBase(id, label, desc) {
      seen[id] = true;
      var wrap = document.createElement('label');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'fbt-create-base';
      radio.value = id;
      var txt = document.createElement('span');
      var nameLine = document.createElement('span');
      nameLine.className = 'fbt-create-base-name';
      nameLine.textContent = label;
      txt.appendChild(nameLine);
      if (desc) {
        var d = document.createElement('div');
        d.className = 'fbt-create-base-desc';
        d.textContent = desc;
        txt.appendChild(d);
      }
      wrap.appendChild(radio);
      wrap.appendChild(txt);
      createBases.appendChild(wrap);
      return radio;
    }
    addBase('scratch', 'From scratch', 'Start from the default tokens, no lineage');
    addBase('default', 'From Default', 'Start from Freebuff\u2019s original look');
    Object.keys(themesById).forEach(function (id) {
      if (seen[id]) return;
      var t = themesById[id];
      addBase(t.id, t.name + (t.builtin ? '' : '  (custom)'), t.description || '');
    });
    var first = createBases.querySelector('input');
    if (first) first.checked = true;
    createBox.hidden = false;
    setTimeout(function () { createName.focus(); }, 30);
  }

  function closeCreate() {
    createBox.hidden = true;
  }

  function submitCreate() {
    var name = createName.value.trim();
    if (!name) { toastMsg('Give your theme a name first.'); createName.focus(); return; }
    var sel = createBases.querySelector('input:checked');
    var baseId = sel ? sel.value : 'default';
    fetch(API + '/api/themes/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, baseId: baseId }),
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !res.theme) { toastMsg('Could not create the theme.'); return; }
        closeCreate();
        toastMsg('Theme "' + res.theme.name + '" created \u2713');
        refresh().then(function () { openEditor(res.theme.id); });
      })
      .catch(function () { toastMsg('Studio offline \u2014 could not create the theme.'); });
  }

  // VS13 — section navigation inside the editor: one tab bar, one section
  // visible at a time (Colors / Components / Shape / Effects / Motion /
  // Advanced). Hidden panels stay in the DOM, so programmatic access and
  // the keyboard shortcuts keep working from any tab.
  function switchEditorTab(name) {
    activeTab = name;
    if (!tabBar) return;
    tabBar.querySelectorAll('.fbt-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    Object.keys(tabPanels).forEach(function (k) {
      tabPanels[k].hidden = k !== name;
    });
  }

  // VS13 — bottom navigation: highlight the current view, enable the Editor
  // entry only while an edit session is alive.
  function updateNav() {
    if (!navListBtn) return;
    var editing = !viewEdit.hidden;
    navListBtn.classList.toggle('active', !editing);
    navEditBtn.classList.toggle('active', editing);
    navEditBtn.disabled = !editing;
  }

  // VS13 — delete a user theme (created or imported). Built-ins never get
  // the button. The first click arms a short confirm state, the second
  // actually deletes — no accidental removal.
  function deleteTheme(id, btn) {
    if (deleteConfirmId !== id) {
      deleteConfirmId = id;
      btn.textContent = 'Sure?';
      btn.classList.add('confirm');
      clearTimeout(deleteConfirmTimer);
      deleteConfirmTimer = setTimeout(function () {
        deleteConfirmId = null;
        var b = list.querySelector('[data-del="' + id + '"]');
        if (b) { b.textContent = '\ud83d\uddd1'; b.classList.remove('confirm'); }
      }, 2600);
      return;
    }
    clearTimeout(deleteConfirmTimer);
    deleteConfirmId = null;
    fetch(API + '/api/themes/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeId: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          toastMsg('Theme deleted.');
          refresh();
        } else {
          toastMsg((res && res.message) || 'Could not delete the theme.');
        }
      })
      .catch(function () { toastMsg('Studio offline \u2014 could not delete the theme.'); });
  }

  function saveEditor() {
    // VS9 — flush any pending custom-CSS debounce so the very last keystroke
    // is part of the saved theme (Save right after typing must not lose it).
    if (advTimer) {
      clearTimeout(advTimer);
      advTimer = null;
      editingTheme.extraCss = advEditor.value;
    }
    fetch(API + '/api/themes/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: editingTheme, activate: true }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          toastMsg('Theme saved and activated \u2713');
          editingDirty = false;
          // Saving is the new baseline: the history is cleared.
          undoStack.length = 0;
          redoStack.length = 0;
          cancelGesture();
          renderHistoryUi();
          refresh();
          viewEdit.hidden = true;
          viewList.hidden = false;
        } else {
          toastMsg((res && res.message) || 'Could not save the theme.');
        }
      })
      .catch(function () { toastMsg('Studio offline \u2014 could not save.'); });
  }

  function resetEditor() {
    beginEdit('Theme reset');
    fetch(API + '/api/themes/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeId: editingTheme.id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok && res.theme) {
          editingTheme.tokens = res.theme.tokens;
          editingTheme.components = res.theme.components || {};
          editingTheme.shape = res.theme.shape || shapeDefaults();
          editingTheme.shadow = res.theme.shadow || shadowDefaults();
          editingTheme.effects = res.theme.effects || effectsDefaults();
          editingTheme.motion = res.theme.motion || motionDefaults();
          editingTheme.extraCss = res.theme.extraCss || '';
          editingTheme.cssScope = res.theme.cssScope === 'surfaces' ? 'surfaces' : 'app';
          // Keep the cached list fresh, so reopening the editor right after a
          // reset never shows stale values.
          if (themesById[editingTheme.id]) {
            themesById[editingTheme.id].tokens = res.theme.tokens;
            themesById[editingTheme.id].components = res.theme.components || {};
            themesById[editingTheme.id].shape = res.theme.shape;
            themesById[editingTheme.id].shadow = res.theme.shadow;
            themesById[editingTheme.id].effects = res.theme.effects;
            themesById[editingTheme.id].motion = res.theme.motion;
            themesById[editingTheme.id].extraCss = res.theme.extraCss || '';
            themesById[editingTheme.id].cssScope = res.theme.cssScope === 'surfaces' ? 'surfaces' : 'app';
          }
          TOKEN_KEYS.forEach(function (k) {
            tokenInputs[k].value = editingTheme.tokens[k] || '#000000';
          });
          renderShapeInputs();
          renderShadowLayers();
          renderEffectsInputs();
          renderMotionInputs();
          if (advEditor) {
            advEditor.value = editingTheme.extraCss;
            advScopeSel.value = editingTheme.cssScope;
            renderAdvEditor();
            renderAdvTokens();
          }
          renderComponentsList();
          editingDirty = true;
          setEditStatus('Theme reset \u2014 preview applied');
          schedulePreview();
          toastMsg('Theme reset.');
        } else {
          toastMsg((res && res.message) || 'Reset failed.');
        }
      })
      .catch(function () { toastMsg('Studio offline \u2014 reset failed.'); });
  }

  /* ------------------------------------------------------------ */
  /* Mount                                                        */
  /* ------------------------------------------------------------ */

  function mount() {
    if (document.getElementById('freebuff-theme-engine-host')) return;

    var host = document.createElement('div');
    host.id = 'freebuff-theme-engine-host';
    themerHost = host;
    var root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS.join(' ');
    root.appendChild(style);

    toast = document.createElement('div');
    toast.className = 'fbt-toast';
    root.appendChild(toast);

    var fab = document.createElement('button');
    fab.id = 'fbt-fab';
    fab.type = 'button';
    fab.title = 'Theme Engine — Themes';
    fab.textContent = '🎨';
    fab.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refresh();
    });

    panel = document.createElement('div');
    panel.id = 'fbt-panel';
    panel.hidden = true;

    /* -------- List view (Themes) -------- */
    viewList = document.createElement('div');
    viewList.id = 'fbt-view-list';

    var head = document.createElement('div');
    head.className = 'fbt-head';
    var title = document.createElement('div');
    title.className = 'fbt-title';
    title.textContent = 'Theme Engine';
    var sub = document.createElement('div');
    sub.className = 'fbt-sub';
    sub.textContent = 'Themes — CustomFreebuff';
    var status = document.createElement('div');
    status.className = 'fbt-status';
    dot = document.createElement('span');
    dot.id = 'fbt-dot';
    dot.className = 'fbt-dot';
    statusText = document.createElement('span');
    statusText.id = 'fbt-status-text';
    statusText.textContent = 'Connecting…';
    status.appendChild(dot);
    status.appendChild(statusText);
    // VS13 — brand header: icon + name/sub stacked on the left, status pill
    // on the right.
    var brand = document.createElement('div');
    brand.className = 'fbt-brand';
    var brandIcon = document.createElement('span');
    brandIcon.className = 'fbt-brand-icon';
    brandIcon.textContent = '\ud83c\udfa8';
    brand.appendChild(brandIcon);
    var brandTxt = document.createElement('div');
    brandTxt.appendChild(title);
    brandTxt.appendChild(sub);
    brand.appendChild(brandTxt);
    head.appendChild(brand);
    head.appendChild(status);

    list = document.createElement('div');
    list.id = 'fbt-themes';

    var foot = document.createElement('div');
    foot.className = 'fbt-foot';
    // VS11 — import a .freebuff theme from the list: pick a file, validate,
    // install, and the theme appears in the list.
    fileInput = document.createElement('input');
    fileInput.id = 'fbt-import-file';
    fileInput.type = 'file';
    fileInput.accept = '.freebuff,.json,application/json';
    fileInput.hidden = true;
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (f) importThemeFile(f);
      fileInput.value = '';
    });
    // VS12 — create a brand-new theme: name + base, opens the editor after.
    var createBtn = document.createElement('button');
    createBtn.id = 'fbt-create-theme';
    createBtn.type = 'button';
    createBtn.textContent = '+ Create theme';
    createBtn.title = 'Create a new theme from scratch or from an existing one';
    createBtn.addEventListener('click', openCreate);
    var importBtn = document.createElement('button');
    importBtn.id = 'fbt-import';
    importBtn.type = 'button';
    importBtn.textContent = 'Import theme (\u2026.freebuff)';
    importBtn.title = 'Import a theme from a .freebuff file';
    importBtn.addEventListener('click', function () { fileInput.click(); });
    var restoreBtn = document.createElement('button');
    restoreBtn.id = 'fbt-restore';
    restoreBtn.type = 'button';
    restoreBtn.textContent = 'Restore the original look';
    restoreBtn.addEventListener('click', restore);
    var note = document.createElement('div');
    note.className = 'fbt-note';
    note.textContent = 'Local injection only: no Freebuff file is modified.';
    // VS13 — create / import sit side by side in a two-column toolbar.
    var footActions = document.createElement('div');
    footActions.className = 'fbt-foot-actions';
    footActions.appendChild(createBtn);
    footActions.appendChild(importBtn);
    foot.appendChild(footActions);
    foot.appendChild(restoreBtn);
    foot.appendChild(note);

    viewList.appendChild(head);
    viewList.appendChild(list);
    viewList.appendChild(foot);

    /* -------- Editor view -------- */
    viewEdit = document.createElement('div');
    viewEdit.id = 'fbt-view-edit';
    viewEdit.hidden = true;

    var editHead = document.createElement('div');
    editHead.className = 'fbt-edit-head';
    var backBtn = document.createElement('button');
    backBtn.id = 'fbt-edit-back';
    backBtn.type = 'button';
    backBtn.className = 'fbt-back';
    backBtn.textContent = '\u2190';
    backBtn.title = 'Back to themes';
    backBtn.addEventListener('click', function () {
      if (!compStateDetail.hidden) openComponent(editingComponentKey);
      else if (!compDetail.hidden) showEditMain();
      else if (!inspectorDetail.hidden) closeInspector();
      else if (!advDetail.hidden) closeAdvanced();
      else closeEditor(true);
    });
    var editTitleBox = document.createElement('div');
    var editTitle = document.createElement('div');
    editTitle.className = 'fbt-title';
    editTitle.textContent = 'Theme editor';
    editName = document.createElement('div');
    editName.className = 'fbt-edit-name';
    editTitleBox.appendChild(editTitle);
    editTitleBox.appendChild(editName);
    editHead.appendChild(backBtn);
    editHead.appendChild(editTitleBox);

    /* Main edit panel: Colors (VS1) + Components (VS2) */
    editMain = document.createElement('div');
    editMain.id = 'fbt-edit-main';

    var colorsSection = document.createElement('div');
    colorsSection.className = 'fbt-section';
    colorsSection.textContent = 'Colors';
    var tokenRows = document.createElement('div');
    tokenRows.id = 'fbt-color-rows';
    TOKEN_KEYS.forEach(function (k) {
      var row = document.createElement('div');
      row.className = 'fbt-row';
      var label = document.createElement('label');
      label.textContent = TOKEN_LABELS[k];
      var input = document.createElement('input');
      input.type = 'color';
      input.dataset.token = k;
      input.value = '#000000';
      input.addEventListener('input', function () { onTokenInput(k); });
      tokenInputs[k] = input;
      row.appendChild(label);
      row.appendChild(input);
      tokenRows.appendChild(row);
    });

    /* Shapes & Depth (VS4): presets + global radius/border/shadow. */
    var shapesSection = document.createElement('div');
    shapesSection.className = 'fbt-section';
    shapesSection.textContent = 'Shapes & Depth';
    var presetRow = document.createElement('div');
    presetRow.id = 'fbt-shape-presets';
    presetRow.className = 'fbt-preset-row';
    Object.keys(SHAPE_PRESETS).forEach(function (k) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fbt-preset';
      chip.dataset.preset = k;
      chip.textContent = SHAPE_PRESETS[k].label;
      chip.addEventListener('click', function () { applyShapePreset(k); });
      presetRow.appendChild(chip);
    });

    var shapeRadiusRow = document.createElement('div');
    shapeRadiusRow.className = 'fbt-range-row';
    var shapeRadiusLabel = document.createElement('label');
    shapeRadiusLabel.textContent = 'Radius';
    var shapeRadiusInput = document.createElement('input');
    shapeRadiusInput.id = 'fbt-shape-radius';
    shapeRadiusInput.type = 'range';
    shapeRadiusInput.min = '0';
    shapeRadiusInput.max = '48';
    shapeRadiusInput.addEventListener('input', function () { onShapeChange('radius', shapeRadiusInput.value); });
    shapeInputs.radius = shapeRadiusInput;
    shapeRadiusVal = document.createElement('span');
    shapeRadiusVal.className = 'fbt-range-val';
    shapeRadiusRow.appendChild(shapeRadiusLabel);
    shapeRadiusRow.appendChild(shapeRadiusInput);
    shapeRadiusRow.appendChild(shapeRadiusVal);

    var shapeBorderRow = document.createElement('div');
    shapeBorderRow.className = 'fbt-range-row';
    var shapeBorderLabel = document.createElement('label');
    shapeBorderLabel.textContent = 'Border width';
    var shapeBorderInput = document.createElement('input');
    shapeBorderInput.id = 'fbt-shape-border-width';
    shapeBorderInput.type = 'range';
    shapeBorderInput.min = '0';
    shapeBorderInput.max = '8';
    shapeBorderInput.addEventListener('input', function () { onShapeChange('borderWidth', shapeBorderInput.value); });
    shapeInputs.borderWidth = shapeBorderInput;
    shapeBorderVal = document.createElement('span');
    shapeBorderVal.className = 'fbt-range-val';
    shapeBorderRow.appendChild(shapeBorderLabel);
    shapeBorderRow.appendChild(shapeBorderInput);
    shapeBorderRow.appendChild(shapeBorderVal);

    var shapeOpacityRow = document.createElement('div');
    shapeOpacityRow.className = 'fbt-range-row';
    var shapeOpacityLabel = document.createElement('label');
    shapeOpacityLabel.textContent = 'Border opacity';
    var shapeOpacityInput = document.createElement('input');
    shapeOpacityInput.id = 'fbt-shape-border-opacity';
    shapeOpacityInput.type = 'range';
    shapeOpacityInput.min = '0';
    shapeOpacityInput.max = '100';
    shapeOpacityInput.addEventListener('input', function () { onShapeChange('borderOpacity', shapeOpacityInput.value); });
    shapeInputs.borderOpacity = shapeOpacityInput;
    shapeOpacityVal = document.createElement('span');
    shapeOpacityVal.className = 'fbt-range-val';
    shapeOpacityRow.appendChild(shapeOpacityLabel);
    shapeOpacityRow.appendChild(shapeOpacityInput);
    shapeOpacityRow.appendChild(shapeOpacityVal);

    var shapeHint = document.createElement('div');
    shapeHint.className = 'fbt-edit-hint';
    shapeHint.textContent = '0 keeps the app\u2019s own radius and border. Presets apply a full look at once.';

    var shadowSection = document.createElement('div');
    shadowSection.className = 'fbt-section';
    shadowSection.textContent = 'Shadow';
    shadowLayersEl = document.createElement('div');
    shadowLayersEl.id = 'fbt-shadow-layers';
    var addShadowBtn = document.createElement('button');
    addShadowBtn.id = 'fbt-shadow-add';
    addShadowBtn.type = 'button';
    addShadowBtn.textContent = '+ Add shadow layer';
    addShadowBtn.addEventListener('click', addShadowLayer);

    /* Effects (VS5): glass + visual effects with performance control. */
    var effectsSection = document.createElement('div');
    effectsSection.className = 'fbt-section';
    effectsSection.textContent = 'Effects';
    effectsPresetRow = document.createElement('div');
    effectsPresetRow.id = 'fbt-effects-presets';
    effectsPresetRow.className = 'fbt-preset-row';
    Object.keys(EFFECT_PRESETS).forEach(function (k) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fbt-preset';
      chip.dataset.preset = k;
      chip.textContent = EFFECT_PRESETS[k].label;
      chip.addEventListener('click', function () { applyEffectsPreset(k); });
      effectsPresetRow.appendChild(chip);
    });

    var effectsToggleRow = document.createElement('label');
    effectsToggleRow.className = 'fbt-toggle-row';
    effectsEnable = document.createElement('input');
    effectsEnable.id = 'fbt-effects-enable';
    effectsEnable.type = 'checkbox';
    effectsEnable.addEventListener('change', toggleEffectsEnabled);
    var effectsToggleLabel = document.createElement('span');
    effectsToggleLabel.textContent = 'Enable effects';
    effectsToggleRow.appendChild(effectsEnable);
    effectsToggleRow.appendChild(effectsToggleLabel);

    var effectsGrid = document.createElement('div');
    effectsGrid.className = 'fbt-effects-grid';
    EFFECT_SLIDERS.forEach(function (f) {
      var field = f[0];
      var wrap = document.createElement('label');
      wrap.className = 'fbt-layer-field';
      var lab = document.createElement('span');
      lab.className = 'fbt-layer-label';
      lab.textContent = f[1];
      var sliderRow = document.createElement('span');
      sliderRow.className = 'fbt-layer-slider-row';
      var input = document.createElement('input');
      input.type = 'range';
      input.min = String(f[2]);
      input.max = String(f[3]);
      input.dataset.effect = field;
      input.addEventListener('input', function () { onEffectChange(field, input.value); });
      effectsInputs[field] = input;
      var val = document.createElement('span');
      val.className = 'fbt-range-val';
      effectsVals[field] = val;
      sliderRow.appendChild(input);
      sliderRow.appendChild(val);
      wrap.appendChild(lab);
      wrap.appendChild(sliderRow);
      effectsGrid.appendChild(wrap);
    });

    effectsPerfBadge = document.createElement('div');
    effectsPerfBadge.id = 'fbt-effects-perf';
    effectsPerfBadge.className = 'fbt-perf';
    effectsPerfToggle = document.createElement('button');
    effectsPerfToggle.id = 'fbt-effects-perf-toggle';
    effectsPerfToggle.type = 'button';
    effectsPerfToggle.className = 'fbt-perf-toggle';
    effectsPerfToggle.addEventListener('click', togglePerfMode);

    /* Motion (VS6): animation preset + duration/easing/transforms. */
    var motionSection = document.createElement('div');
    motionSection.className = 'fbt-section';
    motionSection.textContent = 'Motion';

    // VS7 — global motion scale: one slider makes the whole app faster or
    // slower, the other makes it more discreet or more dynamic.
    var motionSpeedRow = document.createElement('div');
    motionSpeedRow.className = 'fbt-range-row';
    var motionSpeedLabel = document.createElement('label');
    motionSpeedLabel.textContent = 'Speed';
    var motionSpeed = document.createElement('input');
    motionSpeed.id = 'fbt-motion-speed';
    motionSpeed.type = 'range';
    motionSpeed.min = '0.25';
    motionSpeed.max = '3';
    motionSpeed.step = '0.05';
    motionSpeed.addEventListener('input', function () { onMotionChange('speed', motionSpeed.value); });
    motionInputs.speed = motionSpeed;
    motionVals.speed = document.createElement('span');
    motionVals.speed.className = 'fbt-range-val';
    motionSpeedRow.appendChild(motionSpeedLabel);
    motionSpeedRow.appendChild(motionSpeed);
    motionSpeedRow.appendChild(motionVals.speed);

    var motionIntensityRow = document.createElement('div');
    motionIntensityRow.className = 'fbt-range-row';
    var motionIntensityLabel = document.createElement('label');
    motionIntensityLabel.textContent = 'Intensity';
    var motionIntensity = document.createElement('input');
    motionIntensity.id = 'fbt-motion-intensity';
    motionIntensity.type = 'range';
    motionIntensity.min = '0';
    motionIntensity.max = '2';
    motionIntensity.step = '0.1';
    motionIntensity.addEventListener('input', function () { onMotionChange('intensity', motionIntensity.value); });
    motionInputs.intensity = motionIntensity;
    motionVals.intensity = document.createElement('span');
    motionVals.intensity.className = 'fbt-range-val';
    motionIntensityRow.appendChild(motionIntensityLabel);
    motionIntensityRow.appendChild(motionIntensity);
    motionIntensityRow.appendChild(motionVals.intensity);

    var motionReducedRow = document.createElement('label');
    motionReducedRow.className = 'fbt-toggle-row';
    motionReduced = document.createElement('input');
    motionReduced.id = 'fbt-motion-reduced';
    motionReduced.type = 'checkbox';
    motionReduced.checked = true;
    motionReduced.addEventListener('change', function () { onMotionChange('reduced', motionReduced.checked); });
    var motionReducedLabel = document.createElement('span');
    motionReducedLabel.textContent = 'Respect reduced-motion (accessibility)';
    motionReducedRow.appendChild(motionReduced);
    motionReducedRow.appendChild(motionReducedLabel);

    motionPresetRow = document.createElement('div');
    motionPresetRow.id = 'fbt-motion-presets';
    motionPresetRow.className = 'fbt-preset-row';
    Object.keys(MOTION_PRESETS).forEach(function (k) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fbt-preset';
      chip.dataset.preset = k;
      chip.textContent = MOTION_PRESETS[k].label;
      chip.addEventListener('click', function () { applyMotionPreset(k); });
      motionPresetRow.appendChild(chip);
    });

    var motionTiming = document.createElement('div');
    motionTiming.className = 'fbt-range-row';
    var motionDurLabel = document.createElement('label');
    motionDurLabel.textContent = 'Duration';
    var motionDur = document.createElement('input');
    motionDur.id = 'fbt-motion-duration';
    motionDur.type = 'range';
    motionDur.min = '0';
    motionDur.max = '1000';
    motionDur.step = '10';
    motionDur.addEventListener('input', function () { onMotionChange('duration', motionDur.value); });
    motionInputs.duration = motionDur;
    motionVals.duration = document.createElement('span');
    motionVals.duration.className = 'fbt-range-val';
    motionTiming.appendChild(motionDurLabel);
    motionTiming.appendChild(motionDur);
    motionTiming.appendChild(motionVals.duration);

    var motionDelayRow = document.createElement('div');
    motionDelayRow.className = 'fbt-range-row';
    var motionDelayLabel = document.createElement('label');
    motionDelayLabel.textContent = 'Delay';
    var motionDelay = document.createElement('input');
    motionDelay.id = 'fbt-motion-delay';
    motionDelay.type = 'range';
    motionDelay.min = '0';
    motionDelay.max = '500';
    motionDelay.step = '10';
    motionDelay.addEventListener('input', function () { onMotionChange('delay', motionDelay.value); });
    motionInputs.delay = motionDelay;
    motionVals.delay = document.createElement('span');
    motionVals.delay.className = 'fbt-range-val';
    motionDelayRow.appendChild(motionDelayLabel);
    motionDelayRow.appendChild(motionDelay);
    motionDelayRow.appendChild(motionVals.delay);

    var motionEasingRow = document.createElement('div');
    motionEasingRow.className = 'fbt-range-row';
    var motionEasingLabel = document.createElement('label');
    motionEasingLabel.textContent = 'Easing';
    var motionEasing = document.createElement('select');
    motionEasing.id = 'fbt-motion-easing';
    motionEasing.className = 'fbt-select';
    Object.keys(MOTION_EASING_LABELS).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = MOTION_EASING_LABELS[k];
      motionEasing.appendChild(opt);
    });
    motionEasing.addEventListener('change', function () { onMotionChange('easing', motionEasing.value); });
    motionInputs.easing = motionEasing;
    motionEasingRow.appendChild(motionEasingLabel);
    motionEasingRow.appendChild(motionEasing);

    var motionTransformSection = document.createElement('div');
    motionTransformSection.className = 'fbt-section';
    motionTransformSection.textContent = 'Transforms';
    var motionGrid = document.createElement('div');
    motionGrid.className = 'fbt-effects-grid';
    [
      ['hoverY', 'Hover Y', -8, 8, 'px', 1],
      ['hoverScale', 'Hover scale', 0.9, 1.2, '', 0.01],
      ['activeScale', 'Press scale', 0.9, 1.2, '', 0.01],
      ['focusScale', 'Focus scale', 0.9, 1.2, '', 0.01]
    ].forEach(function (f) {
      var field = f[0];
      var wrap = document.createElement('label');
      wrap.className = 'fbt-layer-field';
      var lab = document.createElement('span');
      lab.className = 'fbt-layer-label';
      lab.textContent = f[1];
      var sliderRow = document.createElement('span');
      sliderRow.className = 'fbt-layer-slider-row';
      var input = document.createElement('input');
      input.type = 'range';
      input.min = String(f[2]);
      input.max = String(f[3]);
      input.step = String(f[5]);
      input.addEventListener('input', function () { onMotionChange(field, input.value); });
      motionInputs[field] = input;
      var val = document.createElement('span');
      val.className = 'fbt-range-val';
      motionVals[field] = val;
      sliderRow.appendChild(input);
      sliderRow.appendChild(val);
      wrap.appendChild(lab);
      wrap.appendChild(sliderRow);
      motionGrid.appendChild(wrap);
    });

    var motionEnterRow = document.createElement('label');
    motionEnterRow.className = 'fbt-toggle-row';
    motionEnter = document.createElement('input');
    motionEnter.id = 'fbt-motion-enter';
    motionEnter.type = 'checkbox';
    motionEnter.addEventListener('change', function () { onMotionChange('enter', motionEnter.checked); });
    var motionEnterLabel = document.createElement('span');
    motionEnterLabel.textContent = 'Animate new messages (enter)';
    motionEnterRow.appendChild(motionEnter);
    motionEnterRow.appendChild(motionEnterLabel);

    var motionPreviewSection = document.createElement('div');
    motionPreviewSection.className = 'fbt-section';
    motionPreviewSection.textContent = 'Preview';
    motionPreviewBtn = document.createElement('button');
    motionPreviewBtn.id = 'fbt-motion-preview';
    motionPreviewBtn.type = 'button';
    motionPreviewBtn.textContent = 'Hover or press me';
    var motionPreviewNote = document.createElement('div');
    motionPreviewNote.id = 'fbt-motion-preview-note';
    motionPreviewNote.textContent = 'Hover this button to preview the hover transform, press it for the press scale.';

    var compSection = document.createElement('div');
    compSection.className = 'fbt-section';
    compSection.textContent = 'Components';
    // VS8 — "Edit Element": pick a real element in Freebuff to inspect it.
    pickBtn = document.createElement('button');
    pickBtn.id = 'fbt-pick';
    pickBtn.type = 'button';
    pickBtn.className = 'fbt-pick';
    pickBtn.textContent = '\ud83c\udfaf Edit Element';
    pickBtn.addEventListener('click', enterInspectMode);
    componentsList = document.createElement('div');
    componentsList.id = 'fbt-components';

    var hint = document.createElement('div');
    hint.className = 'fbt-edit-hint';
    hint.textContent = 'Every color is a design token: it drives several CSS variables at once. Components can override these tokens locally \u2014 a button can be customized without touching inputs.';
    editStatus = document.createElement('div');
    editStatus.id = 'fbt-edit-status';
    editStatus.className = 'fbt-edit-status';

    // VS13 — the editor body is organized behind a section navigation: a tab
    // bar (Colors / Components / Shape / Effects / Motion / Advanced) with
    // one section panel visible at a time. Hidden panels stay in the DOM so
    // every control remains reachable (programmatically and via shortcuts).
    tabBar = document.createElement('div');
    tabBar.className = 'fbt-tabs';
    tabPanels = {};
    [
      ['colors', 'Colors'],
      ['components', 'Components'],
      ['shape', 'Shape'],
      ['effects', 'Effects'],
      ['motion', 'Motion'],
      ['advanced', 'Advanced'],
    ].forEach(function (def) {
      var key = def[0];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fbt-tab' + (key === activeTab ? ' active' : '');
      btn.dataset.tab = key;
      btn.textContent = def[1];
      btn.addEventListener('click', function () { switchEditorTab(key); });
      tabBar.appendChild(btn);
      var panel = document.createElement('div');
      panel.className = 'fbt-tab-panel';
      panel.dataset.tab = key;
      panel.hidden = key !== activeTab;
      tabPanels[key] = panel;
      editMain.appendChild(panel);
    });
    editMain.appendChild(tabBar);

    var colorsPanel = tabPanels.colors;
    colorsPanel.appendChild(colorsSection);
    colorsPanel.appendChild(tokenRows);
    var shapePanel = tabPanels.shape;
    shapePanel.appendChild(shapesSection);
    shapePanel.appendChild(presetRow);
    shapePanel.appendChild(shapeRadiusRow);
    shapePanel.appendChild(shapeBorderRow);
    shapePanel.appendChild(shapeOpacityRow);
    shapePanel.appendChild(shapeHint);
    shapePanel.appendChild(shadowSection);
    shapePanel.appendChild(shadowLayersEl);
    shapePanel.appendChild(addShadowBtn);
    var effectsPanel = tabPanels.effects;
    effectsPanel.appendChild(effectsSection);
    effectsPanel.appendChild(effectsPresetRow);
    effectsPanel.appendChild(effectsToggleRow);
    effectsPanel.appendChild(effectsGrid);
    effectsPanel.appendChild(effectsPerfBadge);
    effectsPanel.appendChild(effectsPerfToggle);
    var motionPanel = tabPanels.motion;
    motionPanel.appendChild(motionSection);
    motionPanel.appendChild(motionSpeedRow);
    motionPanel.appendChild(motionIntensityRow);
    motionPanel.appendChild(motionReducedRow);
    motionPanel.appendChild(motionPresetRow);
    motionPanel.appendChild(motionTiming);
    motionPanel.appendChild(motionDelayRow);
    motionPanel.appendChild(motionEasingRow);
    motionPanel.appendChild(motionTransformSection);
    motionPanel.appendChild(motionGrid);
    motionPanel.appendChild(motionEnterRow);
    motionPanel.appendChild(motionPreviewSection);
    motionPanel.appendChild(motionPreviewBtn);
    motionPanel.appendChild(motionPreviewNote);
    var componentsPanel = tabPanels.components;
    componentsPanel.appendChild(compSection);
    componentsPanel.appendChild(pickBtn);
    componentsPanel.appendChild(componentsList);
    /* Advanced (VS9): custom CSS — the escape hatch for power users. */
    var advSection = document.createElement('div');
    advSection.className = 'fbt-section';
    advSection.textContent = 'Advanced';
    var advOpenBtn = document.createElement('button');
    advOpenBtn.id = 'fbt-advanced';
    advOpenBtn.type = 'button';
    advOpenBtn.className = 'fbt-comp-row';
    var advOpenLabel = document.createElement('span');
    advOpenLabel.className = 'fbt-comp-name';
    advOpenLabel.textContent = 'Custom CSS';
    var advOpenSummary = document.createElement('span');
    advOpenSummary.className = 'fbt-comp-summary';
    advOpenSummary.textContent = 'Tokens · scoping · validation';
    var advOpenChevron = document.createElement('span');
    advOpenChevron.className = 'fbt-comp-chevron';
    advOpenChevron.textContent = '\u203a';
    advOpenBtn.appendChild(advOpenLabel);
    advOpenBtn.appendChild(advOpenSummary);
    advOpenBtn.appendChild(advOpenChevron);
    advOpenBtn.addEventListener('click', openAdvanced);
    var advancedPanel = tabPanels.advanced;
    advancedPanel.appendChild(advSection);
    advancedPanel.appendChild(advOpenBtn);
    // The hint + live-preview status are appended to editBody below (after it
    // exists) so they stay visible under every tab.

    /* Component detail (VS2) */
    compDetail = document.createElement('div');
    compDetail.id = 'fbt-comp-detail';
    compDetail.hidden = true;

    var compHead = document.createElement('div');
    compHead.className = 'fbt-edit-head';
    var compBack = document.createElement('button');
    compBack.id = 'fbt-comp-back';
    compBack.type = 'button';
    compBack.className = 'fbt-back';
    compBack.textContent = '\u2190';
    compBack.title = 'Back to components';
    compBack.addEventListener('click', showEditMain);
    var compTitleBox = document.createElement('div');
    compTitle = document.createElement('div');
    compTitle.className = 'fbt-title';
    var compSub = document.createElement('div');
    compSub.className = 'fbt-edit-name';
    compSub.textContent = 'Colors / Border / Radius / Shadow';
    compTitleBox.appendChild(compTitle);
    compTitleBox.appendChild(compSub);
    compHead.appendChild(compBack);
    compHead.appendChild(compTitleBox);

    var compBody = document.createElement('div');
    compBody.id = 'fbt-comp-body';

    var compColorsSection = document.createElement('div');
    compColorsSection.className = 'fbt-section';
    compColorsSection.textContent = 'Colors';
    var compColorRows = document.createElement('div');
    compColorRows.id = 'fbt-comp-colors';
    COMPONENT_COLOR_PROPS.forEach(function (prop) {
      var row = document.createElement('div');
      row.className = 'fbt-row';
      var label = document.createElement('label');
      label.textContent = COMPONENT_COLOR_LABELS[prop];
      var input = document.createElement('input');
      input.type = 'color';
      input.dataset.prop = prop;
      input.value = '#000000';
      input.addEventListener('input', function () { onComponentChange(prop, input.value); });
      compInputs[prop] = input;
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(makePropResetBtn(prop));
      compColorRows.appendChild(row);
    });

    var borderSection = document.createElement('div');
    borderSection.className = 'fbt-section';
    borderSection.textContent = 'Border';
    var widthRow = document.createElement('div');
    widthRow.className = 'fbt-range-row';
    var widthLabel = document.createElement('label');
    widthLabel.textContent = 'Width';
    var widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.min = '0';
    widthInput.max = '16';
    widthInput.dataset.prop = 'borderWidth';
    widthInput.className = 'fbt-number';
    widthInput.addEventListener('input', function () { onComponentChange('borderWidth', widthInput.value); });
    compInputs.borderWidth = widthInput;
    widthRow.appendChild(widthLabel);
    widthRow.appendChild(widthInput);
    widthRow.appendChild(makePropResetBtn('borderWidth'));

    var radiusSection = document.createElement('div');
    radiusSection.className = 'fbt-section';
    radiusSection.textContent = 'Radius';
    var radiusRow = document.createElement('div');
    radiusRow.className = 'fbt-range-row';
    var radiusLabel = document.createElement('label');
    radiusLabel.textContent = 'Radius';
    var radiusInput = document.createElement('input');
    radiusInput.type = 'range';
    radiusInput.min = '0';
    radiusInput.max = '48';
    radiusInput.dataset.prop = 'radius';
    radiusInput.addEventListener('input', function () {
      radiusVal.textContent = radiusInput.value + ' px';
      onComponentChange('radius', radiusInput.value);
    });
    radiusVal = document.createElement('span');
    radiusVal.className = 'fbt-range-val';
    compInputs.radius = radiusInput;
    radiusRow.appendChild(radiusLabel);
    radiusRow.appendChild(radiusInput);
    radiusRow.appendChild(radiusVal);
    radiusRow.appendChild(makePropResetBtn('radius'));

    var shadowSection = document.createElement('div');
    shadowSection.className = 'fbt-section';
    shadowSection.textContent = 'Shadow';
    var shadowRow = document.createElement('div');
    shadowRow.className = 'fbt-range-row';
    var shadowLabel = document.createElement('label');
    shadowLabel.textContent = 'Shadow';
    var shadowSelect = document.createElement('select');
    shadowSelect.className = 'fbt-select';
    shadowSelect.dataset.prop = 'shadow';
    SHADOW_KEYS.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = SHADOW_LABELS[k];
      shadowSelect.appendChild(opt);
    });
    shadowSelect.addEventListener('change', function () { onComponentChange('shadow', shadowSelect.value); });
    compInputs.shadow = shadowSelect;
    shadowRow.appendChild(shadowLabel);
    shadowRow.appendChild(shadowSelect);
    shadowRow.appendChild(makePropResetBtn('shadow'));

    // VS3 — per-state customization (Hover / Active / Focus / Disabled / Loading).
    var statesSection = document.createElement('div');
    statesSection.className = 'fbt-section';
    statesSection.textContent = 'States';
    stateList = document.createElement('div');
    stateList.id = 'fbt-states';

    compStatus = document.createElement('div');
    compStatus.id = 'fbt-comp-status';
    compStatus.className = 'fbt-edit-status';

    compBody.appendChild(compColorsSection);
    compBody.appendChild(compColorRows);
    compBody.appendChild(borderSection);
    compBody.appendChild(widthRow);
    compBody.appendChild(radiusSection);
    compBody.appendChild(radiusRow);
    compBody.appendChild(shadowSection);
    compBody.appendChild(shadowRow);
    compBody.appendChild(statesSection);
    compBody.appendChild(stateList);
    compBody.appendChild(compStatus);

    var compFoot = document.createElement('div');
    compFoot.className = 'fbt-edit-foot';
    var compResetBtn = document.createElement('button');
    compResetBtn.id = 'fbt-comp-reset';
    compResetBtn.type = 'button';
    compResetBtn.textContent = 'Reset this component';
    compResetBtn.addEventListener('click', resetComponent);
    compFoot.appendChild(compResetBtn);

    compDetail.appendChild(compHead);
    compDetail.appendChild(compBody);
    compDetail.appendChild(compFoot);

    /* Component STATE detail (VS3) */
    compStateDetail = document.createElement('div');
    compStateDetail.id = 'fbt-state-detail';
    compStateDetail.hidden = true;

    var stHead = document.createElement('div');
    stHead.className = 'fbt-edit-head';
    var stBack = document.createElement('button');
    stBack.id = 'fbt-state-back';
    stBack.type = 'button';
    stBack.className = 'fbt-back';
    stBack.textContent = '\u2190';
    stBack.title = 'Back to the component';
    stBack.addEventListener('click', function () { openComponent(editingComponentKey); });
    var stTitleBox = document.createElement('div');
    stateTitle = document.createElement('div');
    stateTitle.className = 'fbt-title';
    var stSub = document.createElement('div');
    stSub.className = 'fbt-edit-name';
    stSub.textContent = 'Colors / Shadow';
    stTitleBox.appendChild(stateTitle);
    stTitleBox.appendChild(stSub);
    stHead.appendChild(stBack);
    stHead.appendChild(stTitleBox);

    var stBody = document.createElement('div');
    stBody.id = 'fbt-state-body';

    var stColorsSection = document.createElement('div');
    stColorsSection.className = 'fbt-section';
    stColorsSection.textContent = 'Colors';
    var stColorRows = document.createElement('div');
    stColorRows.id = 'fbt-state-colors';
    STATE_COLOR_PROPS.forEach(function (prop) {
      var row = document.createElement('div');
      row.className = 'fbt-row';
      var label = document.createElement('label');
      label.textContent = COMPONENT_COLOR_LABELS[prop];
      var input = document.createElement('input');
      input.type = 'color';
      input.dataset.prop = prop;
      input.value = '#000000';
      input.addEventListener('input', function () { onStateChange(prop, input.value); });
      stateInputs[prop] = input;
      row.appendChild(label);
      row.appendChild(input);
      stColorRows.appendChild(row);
    });

    var stShadowSection = document.createElement('div');
    stShadowSection.className = 'fbt-section';
    stShadowSection.textContent = 'Shadow';
    var stShadowRow = document.createElement('div');
    stShadowRow.className = 'fbt-range-row';
    var stShadowLabel = document.createElement('label');
    stShadowLabel.textContent = 'Shadow';
    var stShadowSelect = document.createElement('select');
    stShadowSelect.className = 'fbt-select';
    stShadowSelect.dataset.prop = 'shadow';
    SHADOW_KEYS.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = SHADOW_LABELS[k];
      stShadowSelect.appendChild(opt);
    });
    stShadowSelect.addEventListener('change', function () { onStateChange('shadow', stShadowSelect.value); });
    stateInputs.shadow = stShadowSelect;
    stShadowRow.appendChild(stShadowLabel);
    stShadowRow.appendChild(stShadowSelect);

    var stPreviewSection = document.createElement('div');
    stPreviewSection.className = 'fbt-section';
    stPreviewSection.textContent = 'Preview';
    statePreviewBtn = document.createElement('button');
    statePreviewBtn.id = 'fbt-state-preview';
    statePreviewBtn.type = 'button';
    statePreviewBtn.textContent = 'Preview button';
    statePreviewNote = document.createElement('div');
    statePreviewNote.id = 'fbt-state-preview-note';

    stateStatus = document.createElement('div');
    stateStatus.id = 'fbt-state-status';
    stateStatus.className = 'fbt-edit-status';

    stBody.appendChild(stColorsSection);
    stBody.appendChild(stColorRows);
    stBody.appendChild(stShadowSection);
    stBody.appendChild(stShadowRow);
    stBody.appendChild(stPreviewSection);
    stBody.appendChild(statePreviewBtn);
    stBody.appendChild(statePreviewNote);
    stBody.appendChild(stateStatus);

    var stFoot = document.createElement('div');
    stFoot.className = 'fbt-edit-foot';
    var stResetBtn = document.createElement('button');
    stResetBtn.id = 'fbt-state-reset';
    stResetBtn.type = 'button';
    stResetBtn.textContent = 'Reset this state';
    stResetBtn.addEventListener('click', resetState);
    stFoot.appendChild(stResetBtn);

    compStateDetail.appendChild(stHead);
    compStateDetail.appendChild(stBody);
    compStateDetail.appendChild(stFoot);

    /* Inspector (VS8): the focused editor for the element just picked in
       Freebuff — Appearance / Shape / Depth / Effects / Motion. */
    inspectorDetail = document.createElement('div');
    inspectorDetail.id = 'fbt-inspector';
    inspectorDetail.hidden = true;

    var inspHead = document.createElement('div');
    inspHead.className = 'fbt-edit-head';
    var inspBack = document.createElement('button');
    inspBack.id = 'fbt-inspector-back';
    inspBack.type = 'button';
    inspBack.className = 'fbt-back';
    inspBack.textContent = '\u2190';
    inspBack.title = 'Back to the editor';
    inspBack.addEventListener('click', closeInspector);
    var inspTitleBox = document.createElement('div');
    inspTitleBox.className = 'fbt-title-box';
    var inspTitleSmall = document.createElement('div');
    inspTitleSmall.className = 'fbt-sub';
    inspTitleSmall.textContent = 'Inspector';
    inspectorTitle = document.createElement('div');
    inspectorTitle.className = 'fbt-title';
    var inspPickAgain = document.createElement('button');
    inspPickAgain.id = 'fbt-inspector-pick';
    inspPickAgain.type = 'button';
    inspPickAgain.className = 'fbt-inspector-pick';
    inspPickAgain.textContent = '\ud83c\udfaf Pick another';
    inspPickAgain.addEventListener('click', function () {
      inspectorDetail.hidden = true;
      enterInspectMode();
    });
    inspTitleBox.appendChild(inspTitleSmall);
    inspTitleBox.appendChild(inspectorTitle);
    inspHead.appendChild(inspBack);
    inspHead.appendChild(inspTitleBox);
    inspHead.appendChild(inspPickAgain);

    var inspBody = document.createElement('div');
    inspBody.id = 'fbt-inspector-body';

    var inspAppearanceSection = document.createElement('div');
    inspAppearanceSection.className = 'fbt-section';
    inspAppearanceSection.textContent = 'Appearance';
    COMPONENT_COLOR_PROPS.forEach(function (prop) {
      var row = document.createElement('div');
      row.className = 'fbt-row';
      var label = document.createElement('label');
      label.textContent = COMPONENT_COLOR_LABELS[prop];
      var input = document.createElement('input');
      input.type = 'color';
      input.dataset.prop = prop;
      input.value = '#000000';
      input.addEventListener('input', function () { onInspectorChange(prop, input.value); });
      inspectorInputs[prop] = input;
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(makePropResetBtn(prop, 'inspector'));
      inspBody.appendChild(row);
    });

    var inspShapeSection = document.createElement('div');
    inspShapeSection.className = 'fbt-section';
    inspShapeSection.textContent = 'Shape';
    var inspRadiusRow = document.createElement('div');
    inspRadiusRow.className = 'fbt-range-row';
    var inspRadiusLabel = document.createElement('label');
    inspRadiusLabel.textContent = 'Radius';
    var inspRadius = document.createElement('input');
    inspRadius.type = 'range';
    inspRadius.min = '0';
    inspRadius.max = '48';
    inspRadius.step = '1';
    inspRadius.addEventListener('input', function () {
      inspectorVals.radius.textContent = inspRadius.value + ' px';
      onInspectorChange('radius', inspRadius.value);
    });
    inspectorInputs.radius = inspRadius;
    inspectorVals.radius = document.createElement('span');
    inspectorVals.radius.className = 'fbt-range-val';
    inspRadiusRow.appendChild(inspRadiusLabel);
    inspRadiusRow.appendChild(inspRadius);
    inspRadiusRow.appendChild(inspectorVals.radius);
    inspRadiusRow.appendChild(makePropResetBtn('radius', 'inspector'));

    var inspDepthSection = document.createElement('div');
    inspDepthSection.className = 'fbt-section';
    inspDepthSection.textContent = 'Depth';
    var inspShadowRow = document.createElement('div');
    inspShadowRow.className = 'fbt-range-row';
    var inspShadowLabel = document.createElement('label');
    inspShadowLabel.textContent = 'Shadow';
    var inspShadow = document.createElement('select');
    inspShadow.className = 'fbt-select';
    SHADOW_KEYS.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = SHADOW_LABELS[k];
      inspShadow.appendChild(opt);
    });
    inspShadow.addEventListener('change', function () { onInspectorChange('shadow', inspShadow.value); });
    inspectorInputs.shadow = inspShadow;
    inspShadowRow.appendChild(inspShadowLabel);
    inspShadowRow.appendChild(inspShadow);
    inspShadowRow.appendChild(makePropResetBtn('shadow', 'inspector'));

    var inspEffectsSection = document.createElement('div');
    inspEffectsSection.className = 'fbt-section';
    inspEffectsSection.textContent = 'Effects';
    var inspGlowRow = document.createElement('div');
    inspGlowRow.className = 'fbt-range-row';
    var inspGlowLabel = document.createElement('label');
    inspGlowLabel.textContent = 'Glow';
    var inspGlow = document.createElement('input');
    inspGlow.type = 'range';
    inspGlow.min = '0';
    inspGlow.max = '100';
    inspGlow.step = '5';
    inspGlow.addEventListener('input', function () {
      inspectorVals.glow.textContent = inspGlow.value + '%';
      onInspectorChange('glow', inspGlow.value);
    });
    inspectorInputs.glow = inspGlow;
    inspectorVals.glow = document.createElement('span');
    inspectorVals.glow.className = 'fbt-range-val';
    inspGlowRow.appendChild(inspGlowLabel);
    inspGlowRow.appendChild(inspGlow);
    inspGlowRow.appendChild(inspectorVals.glow);
    inspGlowRow.appendChild(makePropResetBtn('glow', 'inspector'));

    var inspMotionSection = document.createElement('div');
    inspMotionSection.className = 'fbt-section';
    inspMotionSection.textContent = 'Motion';
    var inspHoverRow = document.createElement('div');
    inspHoverRow.className = 'fbt-inspect-row';
    var inspHoverLabel = document.createElement('span');
    inspHoverLabel.className = 'fbt-inspect-label';
    inspHoverLabel.textContent = 'Hover';
    inspectorHoverVal = document.createElement('span');
    inspectorHoverVal.className = 'fbt-inspect-summary';
    var inspHoverEdit = document.createElement('button');
    inspHoverEdit.type = 'button';
    inspHoverEdit.textContent = 'Edit';
    inspHoverEdit.addEventListener('click', function () {
      editingComponentKey = inspectorKey;
      inspectorDetail.hidden = true;
      openState('hover');
    });
    inspHoverRow.appendChild(inspHoverLabel);
    inspHoverRow.appendChild(inspectorHoverVal);
    inspHoverRow.appendChild(inspHoverEdit);
    var inspPressRow = document.createElement('div');
    inspPressRow.className = 'fbt-inspect-row';
    var inspPressLabel = document.createElement('span');
    inspPressLabel.className = 'fbt-inspect-label';
    inspPressLabel.textContent = 'Press';
    inspectorPressVal = document.createElement('span');
    inspectorPressVal.className = 'fbt-inspect-summary';
    var inspPressEdit = document.createElement('button');
    inspPressEdit.type = 'button';
    inspPressEdit.textContent = 'Edit';
    inspPressEdit.addEventListener('click', function () {
      editingComponentKey = inspectorKey;
      inspectorDetail.hidden = true;
      openState('active');
    });
    inspPressRow.appendChild(inspPressLabel);
    inspPressRow.appendChild(inspectorPressVal);
    inspPressRow.appendChild(inspPressEdit);

    var inspNote = document.createElement('div');
    inspNote.className = 'fbt-edit-hint';
    inspNote.textContent = 'Changes preview live on the picked element. The panel and the injection are never themeable.';

    inspBody.appendChild(inspAppearanceSection);
    inspBody.appendChild(inspShapeSection);
    inspBody.appendChild(inspRadiusRow);
    inspBody.appendChild(inspDepthSection);
    inspBody.appendChild(inspShadowRow);
    inspBody.appendChild(inspEffectsSection);
    inspBody.appendChild(inspGlowRow);
    inspBody.appendChild(inspMotionSection);
    inspBody.appendChild(inspHoverRow);
    inspBody.appendChild(inspPressRow);
    inspBody.appendChild(inspNote);

    var inspFoot = document.createElement('div');
    inspFoot.className = 'fbt-edit-foot';
    var inspResetBtn = document.createElement('button');
    inspResetBtn.id = 'fbt-inspector-reset';
    inspResetBtn.type = 'button';
    inspResetBtn.textContent = 'Reset this component';
    inspResetBtn.addEventListener('click', resetInspectorComponent);
    inspFoot.appendChild(inspResetBtn);

    inspectorDetail.appendChild(inspHead);
    inspectorDetail.appendChild(inspBody);
    inspectorDetail.appendChild(inspFoot);

    /* Advanced (VS9): the custom-CSS editor — code area with syntax
       highlighting, validation with line/col errors, a scope select and the
       theme-token reference (var(--theme-*)). */
    advDetail = document.createElement('div');
    advDetail.id = 'fbt-adv';
    advDetail.hidden = true;

    var advHead = document.createElement('div');
    advHead.className = 'fbt-edit-head';
    var advBack = document.createElement('button');
    advBack.id = 'fbt-adv-back';
    advBack.type = 'button';
    advBack.className = 'fbt-back';
    advBack.textContent = '\u2190';
    advBack.title = 'Back to the editor';
    advBack.addEventListener('click', closeAdvanced);
    var advTitleBox = document.createElement('div');
    advTitleBox.className = 'fbt-title-box';
    var advSub = document.createElement('div');
    advSub.className = 'fbt-sub';
    advSub.textContent = 'Advanced';
    var advTitle = document.createElement('div');
    advTitle.className = 'fbt-title';
    advTitle.textContent = 'Custom CSS';
    advTitleBox.appendChild(advSub);
    advTitleBox.appendChild(advTitle);
    advHead.appendChild(advBack);
    advHead.appendChild(advTitleBox);

    var advBody = document.createElement('div');
    advBody.id = 'fbt-adv-body';

    var advHint = document.createElement('div');
    advHint.className = 'fbt-edit-hint';
    advHint.textContent = 'Write CSS that is injected into Freebuff. It wins over the app\u2019s own styles; add !important to override the theme engine. This CSS never touches the panel and is removed when the theme is deactivated.';

    var advCodeWrap = document.createElement('div');
    advCodeWrap.className = 'fbt-code-wrap';
    advHighlight = document.createElement('pre');
    advHighlight.className = 'fbt-code-highlight';
    advHighlight.setAttribute('aria-hidden', 'true');
    advEditor = document.createElement('textarea');
    advEditor.id = 'fbt-adv-editor';
    advEditor.className = 'fbt-code';
    advEditor.spellcheck = false;
    advEditor.placeholder = '/* Example */\\n.my-custom-style {\\n  background: var(--theme-surface);\\n  border-radius: var(--theme-radius);\\n}';
    advEditor.addEventListener('input', onAdvInput);
    advEditor.addEventListener('scroll', function () {
      advHighlight.scrollTop = advEditor.scrollTop;
      advHighlight.scrollLeft = advEditor.scrollLeft;
    });
    advCodeWrap.appendChild(advHighlight);
    advCodeWrap.appendChild(advEditor);

    advErrorsEl = document.createElement('div');
    advErrorsEl.id = 'fbt-adv-errors';
    advErrorsEl.hidden = true;
    advOkEl = document.createElement('div');
    advOkEl.id = 'fbt-adv-ok';
    advOkEl.hidden = true;

    var advScopeRow = document.createElement('div');
    advScopeRow.className = 'fbt-range-row';
    var advScopeLabel = document.createElement('label');
    advScopeLabel.textContent = 'Scope';
    advScopeSel = document.createElement('select');
    advScopeSel.id = 'fbt-adv-scope';
    advScopeSel.className = 'fbt-select';
    Object.keys(ADV_SCOPE_LABELS).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = ADV_SCOPE_LABELS[k];
      advScopeSel.appendChild(opt);
    });
    advScopeSel.addEventListener('change', onAdvScopeChange);
    advScopeRow.appendChild(advScopeLabel);
    advScopeRow.appendChild(advScopeSel);

    var advScopeHint = document.createElement('div');
    advScopeHint.className = 'fbt-edit-hint';
    advScopeHint.textContent = 'Whole app: the CSS applies anywhere in Freebuff. Themed surfaces only: every selector is restricted to the app\u2019s surfaces (buttons, inputs, cards, sidebar, modal).';

    var advTokens = document.createElement('details');
    advTokens.id = 'fbt-adv-tokens';
    var advTokensSummary = document.createElement('summary');
    advTokensSummary.textContent = 'Theme tokens (CSS variables)';
    advTokensEl = document.createElement('div');
    advTokensEl.id = 'fbt-adv-token-list';
    advTokens.appendChild(advTokensSummary);
    advTokens.appendChild(advTokensEl);

    var advTokenHint = document.createElement('div');
    advTokenHint.className = 'fbt-edit-hint';
    advTokenHint.textContent = 'Use these variables in your CSS \u2014 they follow the theme. Click a token to copy its name.';

    advBody.appendChild(advHint);
    advBody.appendChild(advCodeWrap);
    advBody.appendChild(advErrorsEl);
    advBody.appendChild(advOkEl);
    advBody.appendChild(advScopeRow);
    advBody.appendChild(advScopeHint);
    advBody.appendChild(advTokens);
    advBody.appendChild(advTokenHint);

    var advFoot = document.createElement('div');
    advFoot.className = 'fbt-edit-foot';
    var advResetBtn = document.createElement('button');
    advResetBtn.id = 'fbt-adv-reset';
    advResetBtn.type = 'button';
    advResetBtn.textContent = 'Reset custom CSS';
    advResetBtn.addEventListener('click', resetAdvCss);
    advFoot.appendChild(advResetBtn);

    advDetail.appendChild(advHead);
    advDetail.appendChild(advBody);
    advDetail.appendChild(advFoot);

    var editBody = document.createElement('div');
    editBody.id = 'fbt-edit-body';
    editBody.appendChild(editMain);
    // The hint + live-preview status stay visible under every editor tab.
    editBody.appendChild(hint);
    editBody.appendChild(editStatus);
    editBody.appendChild(compDetail);
    editBody.appendChild(compStateDetail);
    editBody.appendChild(inspectorDetail);
    editBody.appendChild(advDetail);

    editFoot = document.createElement('div');
    editFoot.className = 'fbt-edit-foot';
    var resetBtn = document.createElement('button');
    resetBtn.id = 'fbt-reset';
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', resetEditor);
    var saveBtn = document.createElement('button');
    saveBtn.id = 'fbt-save';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', saveEditor);
    // VS11 — export the current editing theme as a .freebuff download.
    var exportBtn = document.createElement('button');
    exportBtn.id = 'fbt-export';
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export';
    exportBtn.title = 'Download this theme as a .freebuff file';
    exportBtn.addEventListener('click', exportTheme);
    editFoot.appendChild(resetBtn);
    editFoot.appendChild(exportBtn);
    editFoot.appendChild(saveBtn);

    // VS8 — pick-mode banner, visible in every editor sub-view.
    inspectHint = document.createElement('div');
    inspectHint.id = 'fbt-inspect-hint';
    inspectHint.hidden = true;
    inspectHint.textContent = '\ud83c\udfaf Click any element in Freebuff to inspect it \u2014 Esc to cancel';

    // VS10 — undo / redo + history bar, visible in every editor view.
    historyBar = document.createElement('div');
    historyBar.id = 'fbt-history-bar';
    undoBtn = document.createElement('button');
    undoBtn.id = 'fbt-undo';
    undoBtn.type = 'button';
    undoBtn.className = 'fbt-history-btn';
    undoBtn.textContent = '\u21ba Undo';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.disabled = true;
    undoBtn.addEventListener('click', undo);
    redoBtn = document.createElement('button');
    redoBtn.id = 'fbt-redo';
    redoBtn.type = 'button';
    redoBtn.className = 'fbt-history-btn';
    redoBtn.textContent = '\u21bb Redo';
    redoBtn.title = 'Redo (Ctrl+Shift+Z / Ctrl+Y)';
    redoBtn.disabled = true;
    redoBtn.addEventListener('click', redo);
    var histDetails = document.createElement('details');
    histDetails.id = 'fbt-history';
    var histSummary = document.createElement('summary');
    histSummary.textContent = 'History \u2014 ';
    historyCountEl = document.createElement('span');
    historyCountEl.id = 'fbt-history-count';
    histSummary.appendChild(historyCountEl);
    historyListEl = document.createElement('div');
    historyListEl.id = 'fbt-history-list';
    histDetails.appendChild(histSummary);
    histDetails.appendChild(historyListEl);
    historyBar.appendChild(undoBtn);
    historyBar.appendChild(redoBtn);
    historyBar.appendChild(histDetails);

    viewEdit.appendChild(editHead);
    viewEdit.appendChild(historyBar);
    viewEdit.appendChild(inspectHint);
    viewEdit.appendChild(editBody);
    viewEdit.appendChild(editFoot);

    panel.appendChild(viewList);
    panel.appendChild(viewEdit);

    // VS12 — the create-theme dialog (modal overlay inside the panel).
    createBox = document.createElement('div');
    createBox.id = 'fbt-create';
    createBox.className = 'fbt-create';
    createBox.hidden = true;
    var createCard = document.createElement('div');
    createCard.className = 'fbt-create-card';
    var createTitle = document.createElement('div');
    createTitle.className = 'fbt-create-title';
    createTitle.textContent = 'Create a new theme';
    createCard.appendChild(createTitle);
    createName = document.createElement('input');
    createName.type = 'text';
    createName.placeholder = 'Theme name';
    createName.maxLength = 60;
    createName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitCreate();
    });
    createCard.appendChild(createName);
    createBases = document.createElement('div');
    createBases.className = 'fbt-create-bases';
    createCard.appendChild(createBases);
    var createActions = document.createElement('div');
    createActions.className = 'fbt-create-actions';
    var createCancel = document.createElement('button');
    createCancel.type = 'button';
    createCancel.textContent = 'Cancel';
    createCancel.addEventListener('click', closeCreate);
    var createGo = document.createElement('button');
    createGo.type = 'button';
    createGo.className = 'fbt-create-go';
    createGo.textContent = 'Create';
    createGo.addEventListener('click', submitCreate);
    createActions.appendChild(createCancel);
    createActions.appendChild(createGo);
    createCard.appendChild(createActions);
    createBox.appendChild(createCard);
    panel.appendChild(createBox);

    // VS13 — bottom navigation between the two main views: Themes (list) and
    // Editor (only while an edit session is alive).
    var nav = document.createElement('div');
    nav.id = 'fbt-nav';
    navListBtn = document.createElement('button');
    navListBtn.type = 'button';
    navListBtn.className = 'fbt-nav-btn active';
    navListBtn.dataset.nav = 'list';
    navListBtn.textContent = '\ud83c\udfa8  Themes';
    navListBtn.title = 'Back to the theme list';
    navListBtn.addEventListener('click', function () {
      if (!viewEdit.hidden) closeEditor(true);
      updateNav();
    });
    navEditBtn = document.createElement('button');
    navEditBtn.type = 'button';
    navEditBtn.className = 'fbt-nav-btn';
    navEditBtn.dataset.nav = 'edit';
    navEditBtn.textContent = '\u270f\ufe0f  Editor';
    navEditBtn.title = 'Back to the theme editor';
    navEditBtn.disabled = true;
    navEditBtn.addEventListener('click', function () {
      if (navEditBtn.disabled) return;
      viewList.hidden = true;
      viewEdit.hidden = false;
      updateNav();
    });
    nav.appendChild(navListBtn);
    nav.appendChild(navEditBtn);
    panel.appendChild(nav);

    root.appendChild(fab);
    root.appendChild(panel);
    if (fileInput) root.appendChild(fileInput);
    document.body.appendChild(host);

    // VS8 — the highlight overlay lives in the PAGE (not the shadow root):
    // it must overlay Freebuff's elements while the user picks or inspects.
    var overlayStyle = document.createElement('style');
    overlayStyle.id = 'freebuff-themer-inspector-style';
    overlayStyle.textContent = '#fbt-inspector-highlight{position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7cff3f;border-radius:6px;background:rgba(124,255,63,.10);box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 14px rgba(124,255,63,.45);display:none;transition:left .06s ease,top .06s ease,width .06s ease,height .06s ease}#fbt-inspector-highlight::after{content:attr(data-label);position:absolute;top:-24px;left:-2px;background:#0c0d0f;color:#7cff3f;font:600 10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:0 8px;border:1px solid rgba(124,255,63,.5);border-radius:4px;white-space:nowrap;letter-spacing:.4px}';
    document.head.appendChild(overlayStyle);
    inspectHighlight = document.createElement('div');
    inspectHighlight.id = 'fbt-inspector-highlight';
    document.body.appendChild(inspectHighlight);

    // Pick mode: hover highlights the candidate element, click confirms it.
    // Capture phase + stopImmediatePropagation so Freebuff never reacts to
    // the click while we are picking.
    document.addEventListener('mouseover', onInspectOver, true);
    document.addEventListener('click', onInspectClick, true);
    window.addEventListener('scroll', onInspectScroll, true);
    window.addEventListener('resize', onInspectScroll);

    host.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) { e.preventDefault(); redo(); return; }
        // Inside the CSS editor, keep the textarea's native text undo — it
        // fires input, which lands in the history as a normal change.
        if (document.activeElement === advEditor) return;
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key !== 'Escape') return;
      if (!createBox.hidden) { closeCreate(); return; }
      if (inspectMode) { exitInspectMode(); return; }
      if (!compStateDetail.hidden) openComponent(editingComponentKey);
      else if (!compDetail.hidden) showEditMain();
      else if (!inspectorDetail.hidden) closeInspector();
      else if (!advDetail.hidden) closeAdvanced();
      else if (!viewEdit.hidden) closeEditor(true);
      else panel.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && inspectMode) exitInspectMode();
    });
    document.addEventListener('click', function (e) {
      // Close when clicking anywhere outside (composedPath crosses the shadow
      // boundary). If the editor is open, revert any unsaved preview first.
      // While picking an element, the capture listener stops the event first.
      if (inspectMode) return;
      if (!createBox.hidden) return; // keep the modal open
      if (!e.composedPath || e.composedPath().indexOf(host) === -1) {
        if (!viewEdit.hidden) closeEditor(true);
        else panel.hidden = true;
      }
    });

    refresh();
    setInterval(refresh, 2000);
  }

  // addScriptToEvaluateOnNewDocument runs before <body> exists; wait for it.
  if (document.body) mount();
  else {
    var timer = setInterval(function () {
      if (document.body) { clearInterval(timer); mount(); }
    }, 100);
    setTimeout(function () { clearInterval(timer); }, 15000);
  }
})();`
}
