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
    card: '.card, .bubble, .msg',
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
    '#fbt-fab{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:linear-gradient(135deg,#7cff3f,#2f8f0a);color:#0c0d0f;font-size:19px;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;transition:transform .12s ease}',
    '#fbt-fab:hover{transform:scale(1.07)}',
    '#fbt-fab:active{transform:scale(.98)}',
    '#fbt-panel{position:fixed;right:18px;bottom:76px;z-index:2147483646;width:302px;max-height:72vh;display:flex;flex-direction:column;background:#151517;color:#e7e7e8;border:1px solid #2a2a2e;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden}',
    '#fbt-panel[hidden]{display:none}',
    // Flex chain so nothing is clipped: the header and the footer stay fixed,
    // the list/editor shrink and scroll instead of being cut off by max-height.
    '#fbt-view-list,#fbt-view-edit{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-view-list[hidden],#fbt-view-edit[hidden]{display:none}',
    '.fbt-head{padding:12px 14px;background:#0a0a0b;border-bottom:1px solid #2a2a2e;flex:none}',
    '.fbt-title{font-size:14px;font-weight:700}',
    '.fbt-sub{font-size:11px;color:#9a9aa0}',
    '.fbt-status{display:flex;align-items:center;gap:7px;margin-top:7px;font-size:11.5px;color:#9a9aa0}',
    '.fbt-dot{width:8px;height:8px;border-radius:50%;background:#6a6a70;flex:none}',
    '.fbt-dot.ok{background:#5ecb7b;box-shadow:0 0 6px #5ecb7b}',
    '.fbt-dot.warn{background:#c8a93f;box-shadow:0 0 6px #c8a93f}',
    '.fbt-dot.err{background:#d56a6a;box-shadow:0 0 6px #d56a6a}',
    '#fbt-themes{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}',
    '.fbt-empty{font-size:12px;color:#9a9aa0;padding:8px 2px;flex:none}',
    // flex:none is required: without it the cards are flex items with
    // flex-shrink:1 inside the column list, and since .fbt-theme has
    // overflow:hidden (which zeroes the automatic min-height), the browser
    // SQUISHES them to fit instead of overflowing — no overflow means no
    // scroll, and the cards look clipped with no way to see them in full.
    '.fbt-theme{flex:none;border:1px solid #2a2a2e;border-radius:9px;background:#1b1b1e;overflow:hidden}',
    '.fbt-theme.active{border-color:#7cff3f;box-shadow:0 0 0 1px #7cff3f}',
    '.fbt-swatches{display:flex;height:26px}',
    '.fbt-swatches span{flex:1}',
    '.fbt-theme-body{padding:8px 10px}',
    '.fbt-theme-name{font-size:12.5px;font-weight:700}',
    '.fbt-theme-desc{font-size:11px;color:#9a9aa0;margin-top:2px}',
    '.fbt-theme-meta{display:flex;align-items:center;gap:6px;margin-top:7px}',
    '.fbt-scheme{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid #2a2a2e;color:#9a9aa0;text-transform:capitalize}',
    '.fbt-badge{font-size:9.5px;padding:1px 6px;border-radius:999px;border:1px solid #2a2a2e;color:#9a9aa0}',
    '.fbt-theme-actions{margin-left:auto;display:flex;gap:6px}',
    '.fbt-theme button{font:inherit;font-size:11.5px;cursor:pointer;border:1px solid #2a2a2e;border-radius:6px;padding:4px 10px;background:#232327;color:#e7e7e8}',
    '.fbt-theme button:hover{background:#2a2a2e}',
    '.fbt-theme.active button.fbt-activate{background:#7cff3f;border-color:#7cff3f;color:#0c0d0f;font-weight:700}',
    '.fbt-foot{padding:10px 14px;border-top:1px solid #2a2a2e;display:flex;flex-direction:column;gap:8px;flex:none}',
    '.fbt-foot button{font:inherit;font-size:12px;cursor:pointer;width:100%;border:1px solid #2a2a2e;border-radius:7px;padding:7px 10px;background:#232327;color:#e7e7e8}',
    '.fbt-foot button:hover{border-color:#d56a6a;color:#d56a6a}',
    '.fbt-note{font-size:10px;color:#6a6a70;line-height:1.45}',
    '.fbt-edit-head{display:flex;align-items:center;gap:9px;padding:10px 12px;background:#0a0a0b;border-bottom:1px solid #2a2a2e;flex:none}',
    '.fbt-back{font:inherit;font-size:14px;cursor:pointer;border:1px solid #2a2a2e;border-radius:6px;background:#232327;color:#e7e7e8;padding:3px 9px}',
    '.fbt-back:hover{background:#2a2a2e}',
    '.fbt-edit-head .fbt-title{font-size:13px}',
    '.fbt-edit-name{font-size:11px;color:#9a9aa0}',
    '#fbt-edit-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '#fbt-edit-main{display:flex;flex-direction:column;flex:none}',
    '#fbt-edit-main[hidden],#fbt-comp-detail[hidden],#fbt-state-detail[hidden]{display:none}',
    '.fbt-section{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#9a9aa0;margin-bottom:8px;margin-top:14px}',
    '#fbt-color-rows{margin-bottom:2px}',
    '.fbt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #232327}',
    '.fbt-row:last-child{border-bottom:none}',
    '.fbt-row label{font-size:12.5px}',
    '.fbt-row input[type=color]{width:40px;height:27px;border:1px solid #2a2a2e;border-radius:6px;background:#1b1b1e;padding:2px;cursor:pointer}',
    '#fbt-components{display:flex;flex-direction:column;gap:6px}',
    '.fbt-comp-row{display:flex;align-items:center;gap:8px;width:100%;font:inherit;font-size:12px;cursor:pointer;border:1px solid #2a2a2e;border-radius:8px;background:#1b1b1e;color:#e7e7e8;padding:8px 10px;text-align:left}',
    '.fbt-comp-row:hover{border-color:#4a4a52}',
    '.fbt-comp-name{font-weight:700}',
    '.fbt-comp-summary{margin-left:auto;font-size:10.5px;color:#6a6a70}',
    '.fbt-comp-chevron{font-size:13px;color:#9a9aa0}',
    '#fbt-comp-detail{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-comp-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '.fbt-range-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #232327}',
    '.fbt-range-row label{font-size:12.5px;min-width:70px}',
    '.fbt-range-row input[type=range]{flex:1;accent-color:#7cff3f}',
    '.fbt-range-val{font-size:11px;color:#9a9aa0;min-width:30px;text-align:right}',
    '.fbt-number{width:58px;background:#1b1b1e;color:#e7e7e8;border:1px solid #2a2a2e;border-radius:6px;padding:4px 6px;font:inherit;font-size:12px}',
    // VS3 — states list + state editor.
    '#fbt-states{display:flex;flex-direction:column;gap:6px}',
    '.fbt-state-row{display:flex;align-items:center;gap:8px;width:100%;font:inherit;font-size:12px;cursor:pointer;border:1px solid #2a2a2e;border-radius:8px;background:#1b1b1e;color:#e7e7e8;padding:8px 10px;text-align:left}',
    '.fbt-state-row:hover{border-color:#4a4a52}',
    '.fbt-state-name{font-weight:700}',
    '.fbt-state-summary{margin-left:auto;font-size:10.5px;color:#6a6a70}',
    '.fbt-state-chevron{font-size:13px;color:#9a9aa0}',
    '#fbt-state-detail{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-state-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '#fbt-state-preview{display:block;width:100%;font:inherit;font-size:12.5px;font-weight:700;padding:10px 12px;border-radius:6px;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease,box-shadow .12s ease}',
    '#fbt-state-preview:disabled{cursor:not-allowed}',
    '#fbt-state-preview-note{font-size:10.5px;color:#6a6a70;margin-top:6px;line-height:1.45}',
    '.fbt-select{background:#1b1b1e;color:#e7e7e8;border:1px solid #2a2a2e;border-radius:6px;padding:5px 8px;font:inherit;font-size:12px;flex:1}',
    '.fbt-edit-hint{font-size:10.5px;color:#6a6a70;margin-top:10px;line-height:1.5}',
    '.fbt-edit-status{font-size:11px;color:#c8a93f;margin-top:10px;min-height:15px}',
    '.fbt-edit-foot{padding:10px 14px;border-top:1px solid #2a2a2e;display:flex;gap:8px;flex:none}',
    '.fbt-edit-foot[hidden]{display:none}',
    '.fbt-edit-foot button{flex:1;font:inherit;font-size:12px;cursor:pointer;border:1px solid #2a2a2e;border-radius:7px;padding:8px 10px;background:#232327;color:#e7e7e8}',
    '.fbt-edit-foot button:hover{background:#2a2a2e}',
    '.fbt-edit-foot #fbt-save{background:#7cff3f;border-color:#7cff3f;color:#0c0d0f;font-weight:700}',
    '.fbt-edit-foot #fbt-save:hover{background:#92ff5c}',
    '.fbt-edit-foot #fbt-reset:hover{border-color:#d56a6a;color:#d56a6a}',
    '#fbt-comp-reset:hover{border-color:#d56a6a;color:#d56a6a}',
    // VS4 — Shapes & Depth: preset chips, global sliders, shadow layers.
    '.fbt-preset-row{display:flex;flex-wrap:wrap;gap:6px}',
    '.fbt-preset{font:inherit;font-size:11px;cursor:pointer;border:1px solid #2a2a2e;border-radius:999px;padding:4px 10px;background:#232327;color:#e7e7e8}',
    '.fbt-preset:hover{background:#2a2a2e;border-color:#4a4a52}',
    '.fbt-shadow-layer{border:1px solid #2a2a2e;border-radius:8px;background:#1b1b1e;padding:8px 10px;margin-bottom:8px}',
    '.fbt-shadow-layer-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}',
    '.fbt-shadow-layer-head span{font-size:11px;font-weight:700}',
    '.fbt-layer-remove{font:inherit;font-size:13px;line-height:1;cursor:pointer;border:1px solid #2a2a2e;border-radius:5px;background:#232327;color:#d56a6a;padding:2px 7px}',
    '.fbt-layer-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}',
    '.fbt-layer-field{display:flex;flex-direction:column;gap:2px;padding:4px 0;border:none}',
    '.fbt-layer-field .fbt-layer-label{font-size:10px;color:#9a9aa0}',
    '.fbt-layer-slider-row{display:flex;align-items:center;gap:6px}',
    '.fbt-layer-slider-row input[type=range]{flex:1;accent-color:#7cff3f;min-width:0}',
    '.fbt-layer-slider-row .fbt-range-val{font-size:10px;min-width:34px;text-align:right}',
    '.fbt-layer-color-row{display:flex;align-items:center;gap:10px;padding:6px 0}',
    '.fbt-layer-color-row label{font-size:11px;min-width:44px}',
    '.fbt-layer-color-row input[type=color]{width:34px;height:24px;border:1px solid #2a2a2e;border-radius:6px;background:#1b1b1e;padding:2px;cursor:pointer}',
    '.fbt-layer-inner{display:flex;align-items:center;gap:6px;font-size:11px;color:#9a9aa0;cursor:pointer}',
    '#fbt-shadow-add{font:inherit;font-size:11px;cursor:pointer;border:1px dashed #4a4a52;border-radius:7px;padding:6px 10px;background:transparent;color:#9a9aa0;width:100%;margin-top:4px}',
    '#fbt-shadow-add:hover{border-color:#7cff3f;color:#7cff3f}',
    // VS5 — effects: preset chips, enable toggle, compact sliders, perf badge.
    '.fbt-preset.active{border-color:#7cff3f;color:#7cff3f;background:rgba(124,255,63,.08)}',
    '.fbt-toggle-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;cursor:pointer}',
    '.fbt-toggle-row input{accent-color:#7cff3f}',
    '.fbt-effects-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}',
    '.fbt-effects-grid .fbt-layer-field{min-width:0}',
    '.fbt-perf{font-size:10.5px;border-radius:6px;padding:4px 8px;margin-top:8px;line-height:1.4;background:#1b1b1e;color:#9a9aa0;border:1px solid #2a2a2e}',
    '.fbt-perf.warn{background:rgba(200,169,63,.12);color:#c8a93f;border-color:rgba(200,169,63,.35)}',
    '.fbt-perf.ok{background:rgba(94,203,123,.1);color:#5ecb7b;border-color:rgba(94,203,123,.3)}',
    '.fbt-perf-toggle{font:inherit;font-size:10.5px;cursor:pointer;border:1px solid #2a2a2e;border-radius:6px;background:#232327;color:#e7e7e8;padding:3px 8px;margin-top:6px}',
    '.fbt-perf-toggle:hover{border-color:#c8a93f;color:#c8a93f}',
    // VS6 — motion: preset chips, sliders, easing select, live preview button.
    '#fbt-motion-preview{display:block;width:100%;font:inherit;font-size:12.5px;font-weight:700;padding:10px 12px;border-radius:6px;border:1px solid #2a2a2e;background:#232327;color:#e7e7e8;cursor:pointer;will-change:transform}',
    '#fbt-motion-preview-note{font-size:10.5px;color:#6a6a70;margin-top:6px;line-height:1.45}',
    // VS8 — element inspector: pick button, hint banner, inspector view.
    '.fbt-pick{font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px dashed #4a4a52;border-radius:8px;padding:8px 10px;background:#1b1b1e;color:#e7e7e8;width:100%;margin-top:8px}',
    '.fbt-pick:hover{border-color:#7cff3f;color:#7cff3f}',
    '.fbt-pick.active{border-color:#d56a6a;color:#d56a6a;background:rgba(213,106,106,.08)}',
    '#fbt-inspect-hint{font-size:11px;color:#7cff3f;background:rgba(124,255,63,.08);border:1px solid rgba(124,255,63,.4);border-radius:8px;padding:8px 12px;margin:10px 12px 0;flex:none}',
    '#fbt-inspect-hint[hidden]{display:none}',
    '#fbt-inspector{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-inspector[hidden]{display:none}',
    '#fbt-inspector-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '.fbt-inspector-pick{font:inherit;font-size:11px;cursor:pointer;border:1px solid #2a2a2e;border-radius:6px;background:#232327;color:#e7e7e8;padding:5px 9px;margin-left:auto;flex:none}',
    '.fbt-inspector-pick:hover{border-color:#7cff3f;color:#7cff3f}',
    '.fbt-inspect-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1b1b1e}',
    '.fbt-inspect-row:last-child{border-bottom:none}',
    '.fbt-inspect-row .fbt-inspect-label{font-size:12px;min-width:72px}',
    '.fbt-inspect-row .fbt-inspect-summary{margin-left:auto;font-size:10.5px;color:#6a6a70}',
    '.fbt-inspect-row button{font:inherit;font-size:11px;cursor:pointer;border:1px solid #2a2a2e;border-radius:6px;background:#232327;color:#e7e7e8;padding:4px 10px}',
    '.fbt-inspect-row button:hover{border-color:#7cff3f;color:#7cff3f}',
    // VS9 — Advanced: code editor with syntax highlighting, validation banner,
    // scope select and the theme-token reference.
    '.fbt-code-wrap{position:relative;height:180px;margin:8px 0;border:1px solid #2a2a2e;border-radius:8px;overflow:hidden;background:#121215}',
    '.fbt-code-wrap:focus-within{border-color:#7cff3f}',
    '.fbt-code-highlight{position:absolute;inset:0;margin:0;padding:10px 12px;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;color:#c9c9ce;pointer-events:none}',
    '.fbt-code{position:absolute;inset:0;width:100%;height:100%;resize:none;border:none;outline:none;background:transparent;color:transparent;caret-color:#e7e7e8;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;padding:10px 12px;white-space:pre-wrap;word-wrap:break-word;overflow:auto;tab-size:2}',
    '.fbt-code::selection{background:rgba(124,255,63,.25)}',
    '.fbt-tok-c{color:#5f5f66;font-style:italic}',
    '.fbt-tok-s{color:#e5c07b}',
    '.fbt-tok-a{color:#c678dd}',
    '.fbt-tok-sel{color:#61afef}',
    '.fbt-tok-p{color:#e06c75}',
    '.fbt-tok-v{color:#c9c9ce}',
    '.fbt-tok-n{color:#d19a66}',
    '.fbt-tok-x{color:#9a9aa0}',
    '#fbt-adv-errors{font-size:11px;color:#e08787;background:rgba(213,106,106,.1);border:1px solid rgba(213,106,106,.35);border-radius:8px;padding:8px 12px;margin:4px 0 8px;line-height:1.5}',
    '#fbt-adv-errors[hidden]{display:none}',
    '#fbt-adv-ok{font-size:11px;color:#5ecb7b;margin:2px 0 6px}',
    '#fbt-adv-ok[hidden]{display:none}',
    '#fbt-adv-tokens summary{font-size:12px;cursor:pointer;color:#9a9aa0;padding:6px 0}',
    '#fbt-adv-tokens[open] summary{margin-bottom:6px}',
    '#fbt-adv-token-list{display:flex;flex-wrap:wrap;gap:6px}',
    '.fbt-token-chip{font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;cursor:pointer;border:1px solid #2a2a2e;border-radius:6px;background:#1b1b1e;color:#9a9aa0;padding:3px 8px}',
    '.fbt-token-chip:hover{border-color:#7cff3f;color:#7cff3f}',
    '.fbt-token-chip b{color:#e7e7e8;font-weight:600}',
    '#fbt-adv{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '#fbt-adv[hidden]{display:none}',
    '#fbt-adv-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px}',
    '.fbt-toast{position:fixed;right:18px;bottom:130px;z-index:2147483645;background:#232327;color:#e7e7e8;border:1px solid #2a2a2e;border-radius:8px;padding:8px 12px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .18s;pointer-events:none;max-width:280px}',
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
    fetch(API + '/api/state', { cache: 'no-store' })
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

  function openComponent(key) {
    editingComponentKey = key;
    var defs = compDefaults();
    var over = editingComponentOverrides(key);
    compTitle.textContent = COMPONENT_LABELS[key];
    COMPONENT_COLOR_PROPS.forEach(function (prop) {
      compInputs[prop].value = over[prop] !== undefined ? over[prop] : defs[prop];
    });
    compInputs.borderWidth.value = String(over.borderWidth !== undefined ? over.borderWidth : defs.borderWidth);
    compInputs.radius.value = String(over.radius !== undefined ? over.radius : defs.radius);
    compInputs.shadow.value = over.shadow !== undefined ? over.shadow : defs.shadow;
    radiusVal.textContent = compInputs.radius.value + ' px';
    setEditStatus('');
    renderStateList();
    editMain.hidden = true;
    editFoot.hidden = true;
    compStateDetail.hidden = true;
    compDetail.hidden = false;
  }

  function onComponentChange(prop, value) {
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
    if (editingTheme.components) delete editingTheme.components[editingComponentKey];
    var defs = compDefaults();
    COMPONENT_COLOR_PROPS.forEach(function (prop) { compInputs[prop].value = defs[prop]; });
    compInputs.borderWidth.value = String(defs.borderWidth);
    compInputs.radius.value = String(defs.radius);
    compInputs.shadow.value = defs.shadow;
    radiusVal.textContent = defs.radius + ' px';
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
    editingTheme.cssScope = advScopeSel.value;
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function resetAdvCss() {
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
    var layers = (editingTheme.shadow && editingTheme.shadow.layers) || [];
    if (!layers[idx]) return;
    layers[idx][field] = value;
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function addShadowLayer() {
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
    if (!editingTheme.effects) editingTheme.effects = effectsDefaults();
    editingTheme.effects.enabled = effectsEnable.checked;
    if (!effectsEnable.checked) editingTheme.effects.mode = 'none';
    renderEffectsInputs();
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function togglePerfMode() {
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

  function openState(key) {
    editingStateKey = key;
    var defs = stateDefaults();
    var st = stateOverrides(key);
    stateTitle.textContent = COMPONENT_LABELS[editingComponentKey] + ' \u00b7 ' + COMPONENT_STATE_LABELS[key];
    STATE_COLOR_PROPS.forEach(function (prop) {
      stateInputs[prop].value = st[prop] !== undefined ? st[prop] : defs[prop];
    });
    stateInputs.shadow.value = st.shadow !== undefined ? st.shadow : defs.shadow;
    setEditStatus('');
    wirePreviewSim(key);
    compDetail.hidden = true;
    compStateDetail.hidden = false;
  }

  function onStateChange(prop, value) {
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
    if (!editingTheme.components) editingTheme.components = {};
    var comp = editingTheme.components[editingComponentKey];
    if (comp && comp.states) {
      delete comp.states[editingStateKey];
      if (!Object.keys(comp.states).length) delete comp.states;
      if (!Object.keys(comp).length) delete editingTheme.components[editingComponentKey];
    }
    var defs = stateDefaults();
    STATE_COLOR_PROPS.forEach(function (prop) { stateInputs[prop].value = defs[prop]; });
    stateInputs.shadow.value = defs.shadow;
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
    showEditMain();
    viewList.hidden = true;
    viewEdit.hidden = false;
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
    editingTheme = null;
    editingDirty = false;
    editingComponentKey = null;
    showEditMain();
    viewEdit.hidden = true;
    viewList.hidden = false;
  }

  function onTokenInput(key) {
    editingTheme.tokens[key] = tokenInputs[key].value;
    editingDirty = true;
    setEditStatus('Live preview \u2014 not saved');
    schedulePreview();
  }

  function saveEditor() {
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
    head.appendChild(title);
    head.appendChild(sub);
    head.appendChild(status);

    list = document.createElement('div');
    list.id = 'fbt-themes';

    var foot = document.createElement('div');
    foot.className = 'fbt-foot';
    var restoreBtn = document.createElement('button');
    restoreBtn.id = 'fbt-restore';
    restoreBtn.type = 'button';
    restoreBtn.textContent = 'Restore the original look';
    restoreBtn.addEventListener('click', restore);
    var note = document.createElement('div');
    note.className = 'fbt-note';
    note.textContent = 'Local injection only: no Freebuff file is modified.';
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

    editMain.appendChild(colorsSection);
    editMain.appendChild(tokenRows);
    editMain.appendChild(shapesSection);
    editMain.appendChild(presetRow);
    editMain.appendChild(shapeRadiusRow);
    editMain.appendChild(shapeBorderRow);
    editMain.appendChild(shapeOpacityRow);
    editMain.appendChild(shapeHint);
    editMain.appendChild(shadowSection);
    editMain.appendChild(shadowLayersEl);
    editMain.appendChild(addShadowBtn);
    editMain.appendChild(effectsSection);
    editMain.appendChild(effectsPresetRow);
    editMain.appendChild(effectsToggleRow);
    editMain.appendChild(effectsGrid);
    editMain.appendChild(effectsPerfBadge);
    editMain.appendChild(effectsPerfToggle);
    editMain.appendChild(motionSection);
    editMain.appendChild(motionSpeedRow);
    editMain.appendChild(motionIntensityRow);
    editMain.appendChild(motionReducedRow);
    editMain.appendChild(motionPresetRow);
    editMain.appendChild(motionTiming);
    editMain.appendChild(motionDelayRow);
    editMain.appendChild(motionEasingRow);
    editMain.appendChild(motionTransformSection);
    editMain.appendChild(motionGrid);
    editMain.appendChild(motionEnterRow);
    editMain.appendChild(motionPreviewSection);
    editMain.appendChild(motionPreviewBtn);
    editMain.appendChild(motionPreviewNote);
    editMain.appendChild(compSection);
    editMain.appendChild(pickBtn);
    editMain.appendChild(componentsList);
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
    editMain.appendChild(advSection);
    editMain.appendChild(advOpenBtn);
    editMain.appendChild(hint);
    editMain.appendChild(editStatus);

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
    editFoot.appendChild(resetBtn);
    editFoot.appendChild(saveBtn);

    // VS8 — pick-mode banner, visible in every editor sub-view.
    inspectHint = document.createElement('div');
    inspectHint.id = 'fbt-inspect-hint';
    inspectHint.hidden = true;
    inspectHint.textContent = '\ud83c\udfaf Click any element in Freebuff to inspect it \u2014 Esc to cancel';

    viewEdit.appendChild(editHead);
    viewEdit.appendChild(inspectHint);
    viewEdit.appendChild(editBody);
    viewEdit.appendChild(editFoot);

    panel.appendChild(viewList);
    panel.appendChild(viewEdit);
    root.appendChild(fab);
    root.appendChild(panel);
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
      if (e.key !== 'Escape') return;
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
