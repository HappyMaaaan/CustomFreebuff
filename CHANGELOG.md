# Changelog

All notable changes to CustomFreebuff, one section per release. The release
notes on GitHub are generated from this file.

## v1.4.0 — 2026-08-19

### macOS app 🍎

- **CustomFreebuff now ships for Mac too**: download
  `CustomFreebuff-mac-arm64.zip` (Apple Silicon) or
  `CustomFreebuff-mac-x64.zip` (Intel), unzip, drag **CustomFreebuff.app** to
  Applications and double-click — no Node, no terminal, no commands.
- Built by cross-compiling genuine Mach-O binaries with Bun, so the Mac
  download is produced from any machine (and by the release workflow).

### Redesigned interface 🎨

- **A cleaner, more navigable panel**: new header with the app name, a
  **bottom navigation** between *Themes* and *Editor*, and a **tab bar**
  inside the editor (Colors / Components / Shape / Effects / Motion /
  Advanced) so each section gets its own space — no more scrolling through
  everything at once.
- **Hidden tabs stay live**: switching sections keeps every control
  functional, and the editor remembers the section you were on.
- **Fixed**: closing the editor now really closes it — the session and the
  bottom navigation return to the theme list consistently.

### Manage your themes ✂️

- **User themes can be deleted**: themes you created or imported get a
  delete button (first click asks *“Sure?”* — no accidental removal).
  Official themes are protected and never show the button.
- **Deleting the active theme** returns Freebuff to its original look
  automatically.

### Fresh official themes 🌈

- All built-in themes were rebuilt to use the full modern feature set
  (shapes & shadows, effects, motion).
- **2 new official themes**: **Neon Pink** 🌸 (a pink accent on dark) and
  **Midnight** 🌙 (a deep blue night look).

### Calmer surfaces 🌊

- **Chat messages are no longer themeable surfaces**: the AI chat (its
  messages are `.bubble`/`.msg` elements) keeps its own look — no more
  shadows on every message, no glass, no radius, no hover growth, no
  blurry text when the pointer moves over the conversation.
- **Only interactive controls animate on hover**: buttons, inputs,
  textareas and selects express the motion personality; containers
  (sidebars, cards, modals, panels) never scale or move on hover.
- **Softer official themes**: the built-in themes now use light elevation
  shadows and subtler glass instead of heavy floating shadows and strong
  blur — the interface stays readable and calm out of the box.

### Theme Creation ✨

- **Create a brand-new theme from the list**: a **+ Create theme** button
  opens a small dialog where you name the theme and pick its **base** —
  from **scratch**, from **Default**, or from **any existing theme**
  (built-in or your own).
- **The editor opens on the new theme immediately**, pre-filled with the
  base's values, ready to customize — then **Save** keeps it as a separate
  theme, next to the others.
- **Nothing is ever overwritten**: every new theme gets its own unique id
  and its own entry — creating a theme derived from Dracula leaves Dracula
  (and everything else) untouched.

### Undo / Redo + History ↩️

- **Undo and Redo everywhere**: every change in the editor — tokens,
  components, states, shape, effects, motion, custom CSS, the element
  inspector — is recorded as a step you can go back to, with the
  **Undo / Redo buttons** in the editor header or the
  **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** shortcuts.
- **One gesture = one step**: dragging a slider, picking a color or typing
  a burst of CSS records a single undo step — never one per pixel or per
  keystroke. Inside the CSS editor, Ctrl+Z keeps the textarea's native
  text undo, which lands in the history as a normal change.
- **History list**: a dropdown under the editor header lists every step by
  name (Accent, Button · Radius, Preset — Floating, Custom CSS, …) with
  the current state marked — click any step to jump back or forward to it.
- **All resets are undoable**: the new per-property **↺ Reset** buttons in
  the component editor and the inspector, plus Reset component, Reset
  state, Reset custom CSS and the theme Reset — experiment freely without
  fear of breaking a theme.
- Saving a theme is the new baseline: the history clears, and re-opening
  the editor starts fresh. The last CSS keystroke is never lost on save.

### Theme Import / Export 📦

- **Export any theme as a portable `.freebuff` file**: one click in the
  editor downloads the whole theme — tokens, components, states, shape,
  effects, motion and custom CSS — as a single JSON document.
- **Import themes from the list**: pick a `.freebuff` (or raw theme JSON)
  file and it is **validated** — JSON syntax, file format, version and
  compatibility — before being **installed** as a new theme, available in
  the list alongside the built-ins, never overwriting anything.
- **Clear error handling**: an invalid file, a foreign format or a theme
  created with a **newer version** of CustomFreebuff is rejected with an
  explicit message in the panel.
- **Backward compatible**: raw theme JSON shared before `.freebuff`
  existed is still accepted, and the format carries a version number for
  the future (assets are reserved in the envelope).

## v1.3.0 — 2026-08-19

### Motion Engine 🎬

- A new **Motion** section makes animations part of the theme: one base
  duration, easing and delay for every surface of the app.
- **Per-state transforms**: hover (lift + grow), press (shrink), focus —
  real behavior, felt on every button of Freebuff.
- **Enter animations**: new chat messages fade and slide in.
- **4 presets** — Minimal, Smooth, Snappy, Bouncy — change the whole feel
  of the app in one click, with a live hover/press preview inside the
  editor.
- **Minimal is the default**: activating a theme never silently adds motion
  to the app.

### Global Motion 🌍

- **One Speed slider scales the whole app**: 0.25× to 3× on every duration —
  transitions, presses and message entries all speed up or slow down together.
- **One Intensity slider sets the personality**: 0 makes hover/press motion
  disappear (discreet), 2 amplifies every transform (dynamic).
- **Reduced motion built-in**: by default the theme respects the system's
  `prefers-reduced-motion` setting and disables the animations it added;
  the toggle lets you opt out.
- The global scale survives preset changes and saves with the theme —
  change the preset and the personality stays.

### Element Inspector 🎯

- **Pick any element in Freebuff**: a new **Edit Element** mode highlights
  the element under your cursor and lets you click it — the engine maps it
  to its theme component (Button, Input, Card, Sidebar or Modal) and opens
  a focused inspector for it.
- The inspector shows the element's **current look** — Appearance
  (Background, Text, Border), Shape (Radius), Depth (Shadow), Effects
  (Glow) and Motion (Hover, Press) — and every edit previews **live on the
  real element**, with the same isolation as the component editor.
- **New component Glow**: an accent-colored neon halo, scoped to the
  component, combinable with its elevation shadow.
- The highlight stays pinned on the selected element while you edit;
  **Reset this component** undoes everything at once.
- **Sensitive elements are protected**: the panel, the injection and
  non-themeable parts of the app are never intercepted — a click there
  just tells you nothing is themeable.

### Advanced CSS 🛠

- **Write your own CSS inside Freebuff**: an **Advanced** section in the
  theme editor opens a code editor with **live syntax highlighting** — no
  need to leave the app to go further than the graphical editor.
- Your CSS is **injected into Freebuff in real time** as you type, appended
  last so it wins over the built-in styles (add `!important` to override
  the theme engine itself).
- **Theme tokens as CSS variables**: the whole theme is exposed as
  `var(--theme-surface)`, `var(--theme-accent)`, `var(--theme-radius)`, … —
  reference them in your rules and they follow the theme automatically.
- **Validation with error reporting**: unbalanced braces, unclosed strings,
  `@import` and any `<` are flagged with the exact **line and column**
  before they reach the app.
- **Scoping**: rules apply to the whole app, or can be restricted to the
  **themed surfaces only** (buttons, inputs, cards, sidebar, modal) — the
  panel itself is never touchable, and everything is removed when the
  theme is deactivated.
- **Reset custom CSS** clears the editor and restores the generated theme
  in one click.

## v1.2.0 — 2026-08-19

### Component states 🎯

- **Button, Input, Card, Sidebar and Modal now have 5 states each**: Hover,
  Active, Focus, Disabled and Loading.
- Each state has its own colors and glow, with a **live preview**: hover, press
  or focus a real button to see exactly what the state will look like.
- **Per-state isolation**: changing a button's hover style never affects its
  normal look — the base state stays intact unless you change it.

### Shapes & Depth 🎨

- A new **Shapes & Depth** section controls the visual physics of Freebuff:
  radius, borders and shadows, globally.
- **5 look presets** — Flat, Soft, Floating, Deep, Neon — transform the whole
  interface in one click.
- **Multi-layer shadows** with full control: X, Y, blur, spread, color,
  opacity, inner shadows, and as many layers as you want.
- Neon glows with the theme's accent color; elevation presets cast a natural
  shadow.
- Per-component radius and shadow still win over the global shape (isolation
  preserved).

### Glass & Visual Effects ✨

- **One coherent glass style applied to every surface of the app** — no CSS
  to write: transparency, backdrop blur, saturation, brightness and
  translucent borders.
- **Glow, gradients and noise/grain** to finish the look.
- **5 effect presets**: None, Subtle, Frosted, Strong, Important.
- **Performance control**: heavy effects (backdrop blur, noise) are detected
  and can be disabled in one click, or tuned down without losing the light
  effects — and a master switch turns everything off.

## v1.1.0 — 2026-08-19

### Theme Engine, right inside Freebuff 🎨

- A **🎨 Themes button** appears at the bottom-right of Freebuff: activating a
  theme, editing it or restoring the original look now happens **inside the
  app**.
- The big studio page is gone. The launcher is now a **tiny window** with one
  main button (🎯 Patch Freebuff) and a clear message when Freebuff is already
  open — a live instance is never closed.

### Theme editor

- **6 design tokens** (Background, Surface, Text, Muted Text, Border, Accent)
  with **live preview**: change one color and every coherent place in the app
  changes at once.
- Saving a modified built-in theme creates a derived **custom** theme, without
  ever overwriting the original.
- **Reset** returns the theme to its base.

### Component theming

- **Button, Input, Card, Sidebar and Modal** can be customized individually:
  colors, border, radius, shadow.
- **Isolation**: customizing a button never affects inputs, cards or the rest
  of the app.
- Component colors drive the variables Freebuff actually uses — changes are
  visible on the real buttons of the app.

### Experience

- **No terminal window**: the exe and the source launcher only open the tiny
  launcher window.
- **Single-instance launcher**: an extra double-click no longer stacks windows
  or multiplies ports.
- **Scrollable panel**: nothing is clipped anymore, even on a small window.
- **7 built-in themes**: Default (Freebuff's original look), Dracula, Nord,
  Gruvbox, Paper Light, Solarized Dark and Tokyo Night.

## v1.0.1 — 2026-08-18

- New logo: the studio header and the executable icon now show **CF**
  (CustomFreebuff) instead of FT.
- Releases now bump versions (v1.0.1, v1.0.2, …). `node scripts/gh-release.mjs`
  without a tag picks the next patch version after the latest release
  automatically, and package.json stays in sync.
- Release notes now describe what changed in this version (this changelog),
  instead of repeating the v1.0.0 description.

## v1.0.0 — 2026-08-18

- **Fix the invisible window.** Freebuff launched with its window created
  hidden (Windows `SW_HIDE` flag set by the studio's spawn): the app ran, the
  theme applied, but nothing showed on screen. The window is now created
  visible, exactly like a normal launch.
- **Reliable window detection.** The launch diagnostics identify the real
  Freebuff window by its process (`Freebuff.exe`), not by window title —
  titles containing "freebuff" (Chrome, Discord, Explorer) are no longer
  mistaken for the app, and the bring-to-front targets the right window.
- **Bring-to-front that works.** If another window covers Freebuff after
  launch, the studio restores and foregrounds it (SetWindowPos TOPMOST, which
  bypasses Windows' foreground lock), then logs its real OS state (visible,
  position, size).
- **Accurate status.** The studio badge shows "Theme active" once the theme is
  actually applied, instead of staying on "applying theme…".
- **Safer debug port.** The saved debug port is reused only when free;
  otherwise a fresh one is picked.
- **Rebranded to CustomFreebuff.** The executable is now `CustomFreebuff.exe`,
  matching the repo name.
