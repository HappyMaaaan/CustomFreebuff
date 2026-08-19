# Testing guide — VS0 (Injection) + VS1 (Theme + Design Tokens) + VS2 (Components)

This guide explains how to verify that everything works **before moving on**.
There are two levels:

1. **Automated tests** (30 seconds) — run after every change.
2. **Manual end-to-end test** (5 minutes) — the only one that proves the
   Theme Engine actually drives your Freebuff.

---

## 1. Automated tests (quick, after every change)

From the project folder (`C:\Users\Utilisateur\Desktop\CustomFreebuff`):

```bash
npm run check   # syntax-check every file
npm test        # 4 test suites (~90 checks)
```

`npm test` runs a headless Chromium (Edge) against a page that mimics the
Freebuff renderer and verifies: CSS injection, survival across reload, the
native `setTheme` API call, the Theme Engine panel (VS0), **token editor with
live preview, save and reset (VS1)**, **component customization with
isolation (VS2)**, the watcher and disconnection detection.

> If a test fails, the `✗ ...` lines show exactly what went wrong. Every suite
> must end with "Toutes les vérifications sont passées. ✔" (all checks passed).

---

## 2. Manual test — easiest way: the `.exe`

`dist\CustomFreebuff.exe` is self-contained (no Node needed):

1. **Close Freebuff if it is already open** (otherwise the patch is refused).
2. Double-click `dist\CustomFreebuff.exe` — **no terminal window** opens
   (the exe is a GUI app).
3. A **tiny launcher window** opens (Edge application mode, no tabs, no
   address bar): a status, a **🎯 Patch Freebuff (injection)** button, and a
   cleanup button when leftover processes are detected.

   From the source code, `start.bat` launches the same thing while hiding the
   console too (via `start-hidden.vbs`).

## 3. Manual test — from the source code (Node)

Same thing, but from the code (useful while developing):

```bash
npm start        # or: node themer.mjs   or   double-click start.bat
```

Theme selection no longer happens in the launcher: it happens **directly in
Freebuff** via the 🎨 button (Theme Engine).

---

## 4. VS0 walkthrough — activate a theme from Freebuff

1. In the launcher, click **🎯 Patch Freebuff (injection)**.
   - If Freebuff is already running, the launcher shows: **"Freebuff is
     already running: close it, then click Patch again"**.
   - Wait for the "Freebuff launched with the injection" message. Launching
     can take up to 45 s.
2. In **Freebuff**, a round **🎨** button appears at the bottom-right.
3. Click **🎨** → the **Theme Engine** panel opens:
   - the status must show **"Injection active — 1 window"** (green),
   - the list shows the themes: **Default, Dracula, Gruvbox, Nord,
     Paper Light, Solarized Dark, Tokyo Night**.
4. Click **Activate** on "Dracula" → **the app changes immediately**
   (purple background, light text, green accent).
5. Click **Restore the original look** → Freebuff goes back to black.

### What to check during the VS0 walkthrough

| Check | Expected result |
| --- | --- |
| Activating a theme | Immediate visual change in Freebuff |
| The panel lists the themes | 7 themes, with color swatches |
| Panel status | "Injection active — 1 window" (green dot) |
| Restore | Freebuff gets its original look back |

---

## 5. VS1 walkthrough — the theme editor (the heart of the slice)

This is where the Definition of Done is proven: **changing ONE value changes
several coherent places in Freebuff**.

1. Open the **🎨** panel → click **Edit** on "Default".
2. The **Theme Editor** opens with 6 colors (tokens):
   **Background, Surface, Text, Muted Text, Border, Accent**.
3. **Change Accent** (click the swatch and pick another color, e.g. red).
4. **Without saving anything**, look at Freebuff: everything driven by the
   accent changes **live** — buttons, links, focus, active states. The
   "Live preview — not saved" text appears.
5. Click **Save**:
   - the panel goes back to the list,
   - a new **"Default (custom)"** theme appears, marked **"custom"**, and it
     is **active**,
   - the original "Default" theme **has not been modified**.
6. Reopen **Edit** on "Default (custom)" → change Background → **Save** →
   the custom theme is updated, not duplicated.
7. On "Default (custom)", click **Reset** → the colors go back to the base
   (Default), with the preview applied.

### The DoD proof (check visually)

Change **only** the Accent token and watch **several places change at the
same time** in Freebuff: that is because the studio *generates*
`--brand`, `--brand-dim`, `--ok`… from a single token (the CSS is not written
by hand).

---

## 5 bis. VS2 walkthrough — component customization

The goal: move from the global theme to **controlling the UI component by
component**.

1. Open the **🎨** panel → **Edit** on a theme.
2. In the editor, scroll down to the **Components** section:
   **Button, Input, Card, Sidebar, Modal**.
3. Click **Button** → the component detail opens:
   - **Colors**: Background, Text, Border, Accent,
   - **Border**: width,
   - **Radius**: 0–48 px slider,
   - **Shadow**: None / Soft / Medium / Strong.
4. **Change Background** (e.g. pink) → **all the buttons** in Freebuff change
   **live**. Inputs, cards and the rest of the app do not move: that is
   **isolation between components**.
5. Change **Radius** and **Shadow** → same effect, scoped to buttons.
6. Go back (←) and open **Input** → change its color → the buttons **stay as
   they are** (DoD proof: customizing one component does not affect others).
7. **Save** → the theme remembers the component overrides.
8. **Reset** → the components go back to the theme's global tokens.

> **Architecture note**: a component = all its instances (all the buttons
> together) — that is what keeps things consistent. Customizing a specific
> *variant* (primary vs ghost button) will come in a later slice. The
> component selectors live in `lib/theme-model.mjs` so they can be refined
> once the real Freebuff DOM is known.

---

## 6. Robustness — persistence, reload, disconnection

| Scenario | Action | Expected result |
| --- | --- | --- |
| **Reload** | In Freebuff, press `Ctrl+R` (reload the page) | The theme, the components **and** the 🎨 button come back automatically |
| **Close** | Close Freebuff | The panel shows "Freebuff is closed" |
| **Relaunch** | Click **Patch Freebuff** again | The same theme comes back, 🎨 button present |
| **Launcher closed** | Close the launcher, then relaunch the `.exe`/`npm start` | The active theme is re-applied by itself |
| **Persistent theme** | Save a custom theme, close Freebuff AND the launcher, relaunch both | Your "… (custom)" theme is in the list and still active |
| **Disconnection** | Close Freebuff while the launcher runs | The panel turns yellow/red; no crash |

---

## 7. VS1 + VS2 checklist (Definition of Done)

- [ ] Open Freebuff → 🎨 → activate a theme → immediate change
- [ ] Edit a token (Accent) → several coherent places change
- [ ] Live preview before saving
- [ ] Saving creates a "(custom)" theme without overwriting the built-in
- [ ] Reset returns the theme (tokens **and** components) to its base
- [ ] Customize Button → buttons change, inputs/cards do not (VS2)
- [ ] Customize Input → buttons do not move (VS2)
- [ ] Change a button's background → the real Freebuff buttons change
      (background, text and accent each drive the family of variables the app
      actually uses — verified on the real DOM: `--surface`/`--surface-2`/
      `--raised` for backgrounds, `--text`/`--muted`/`--faint` for texts)
- [ ] The theme and its components survive a page reload
- [ ] Restore the original look works

---

## 8. If something goes wrong

- **"Freebuff is already open"** : close Freebuff, wait 2 s, try again.
- **"Freebuff is running without the debug port"** : Freebuff was started
  outside the launcher. Close it and relaunch it from the launcher.
- **The 🎨 button does not appear** : the launcher shows the patch error
  message; every step is written to
  `%APPDATA%\freebuff-themer\launch-trace.log`.
- **Ghost processes** : the **Clean up leftover processes** button in the
  launcher removes them.
- **The panel shows "Studio offline"** : the launcher is not running.
  Relaunch the exe or `npm start`.
- **A terminal window flashes every ~2 s** : that was the old "is Freebuff
  running?" check spawning `tasklist` (a console app) on every launcher
  poll — Windows Terminal opened every time. Fixed since (invisible
  execution), but: (1) make sure you use the rebuilt exe, (2) close any
  duplicate `CustomFreebuff.exe` instances before relaunching — the launcher
  is single-instance: a second double-click exits silently.

---

## 9. Rebuilding the `.exe` after a change

The `.exe` embeds the code **and** the themes/launcher page. After any code
or theme change, rebuild it:

```bash
node scripts/build-exe.mjs
```

→ produces `dist\CustomFreebuff.exe` (≈ 96 MB, self-contained). The script
finds Bun automatically in the Freebuff Desktop resources; otherwise install
Bun (`https://bun.sh`) or set the `BUN` environment variable.
