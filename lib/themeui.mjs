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
  var COMPONENT_PROPS = ['background', 'text', 'border', 'accent', 'borderWidth', 'radius', 'shadow'];
  var COMPONENT_COLOR_PROPS = ['background', 'text', 'border', 'accent'];
  var COMPONENT_COLOR_LABELS = { background: 'Background', text: 'Text', border: 'Border', accent: 'Accent' };
  var SHADOW_LABELS = { none: 'None', soft: 'Soft', medium: 'Medium', forte: 'Strong' };
  var SHADOW_KEYS = ['none', 'soft', 'medium', 'forte'];
  var SHADOW_VALUE_MAP = {
    none: 'none',
    soft: '0 2px 8px rgba(0, 0, 0, 0.25)',
    medium: '0 4px 16px rgba(0, 0, 0, 0.35)',
    forte: '0 8px 32px rgba(0, 0, 0, 0.5)'
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
    '#fbt-edit-main[hidden],#fbt-comp-detail[hidden]{display:none}',
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
      var count = Object.keys(over).length;
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
    editMain.hidden = false;
    editFoot.hidden = false;
    editingComponentKey = null;
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
    editMain.hidden = true;
    editFoot.hidden = true;
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

  function previewPayload() {
    return {
      theme: {
        id: editingTheme.id,
        colorScheme: editingTheme.colorScheme,
        tokens: editingTheme.tokens,
        components: editingTheme.components || {}
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
    editingDirty = false;
    TOKEN_KEYS.forEach(function (k) {
      tokenInputs[k].value = editingTheme.tokens[k] || '#000000';
    });
    editName.textContent = (theme.name || theme.id) + (theme.builtin ? '' : '  (custom)');
    setEditStatus('');
    renderComponentsList();
    showEditMain();
    viewList.hidden = true;
    viewEdit.hidden = false;
  }

  function closeEditor(revertPreview) {
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
          // Keep the cached list fresh, so reopening the editor right after a
          // reset never shows stale values.
          if (themesById[editingTheme.id]) {
            themesById[editingTheme.id].tokens = res.theme.tokens;
            themesById[editingTheme.id].components = res.theme.components || {};
          }
          TOKEN_KEYS.forEach(function (k) {
            tokenInputs[k].value = editingTheme.tokens[k] || '#000000';
          });
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
      if (!compDetail.hidden) showEditMain();
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

    var compSection = document.createElement('div');
    compSection.className = 'fbt-section';
    compSection.textContent = 'Components';
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
    editMain.appendChild(compSection);
    editMain.appendChild(componentsList);
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

    var editBody = document.createElement('div');
    editBody.id = 'fbt-edit-body';
    editBody.appendChild(editMain);
    editBody.appendChild(compDetail);

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

    viewEdit.appendChild(editHead);
    viewEdit.appendChild(editBody);
    viewEdit.appendChild(editFoot);

    panel.appendChild(viewList);
    panel.appendChild(viewEdit);
    root.appendChild(fab);
    root.appendChild(panel);
    document.body.appendChild(host);

    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!compDetail.hidden) showEditMain();
      else if (!viewEdit.hidden) closeEditor(true);
      else panel.hidden = true;
    });
    document.addEventListener('click', function (e) {
      // Close when clicking anywhere outside (composedPath crosses the shadow
      // boundary). If the editor is open, revert any unsaved preview first.
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
