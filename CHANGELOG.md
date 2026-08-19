# Changelog

All notable changes to CustomFreebuff, one section per release. The release
notes on GitHub are generated from this file.

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
