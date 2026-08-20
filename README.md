# CustomFreebuff

A small theme studio for Freebuff Desktop. It changes the look of the app, nothing else.

Freebuff Desktop ships with a dark interface and no way to pick your own colors. This tool adds that: pick a theme, edit it, or fine-tune individual components (buttons, inputs, cards…), and everything is applied live to the running app — from a small button inside Freebuff itself.

## What it does not do

- It does not modify any file of the Freebuff installation (no asar, no resources, no registry).
- It does not bypass anything. Theming is a stylesheet injected into the app's window, the same way a browser extension styles a page.
- It does not touch your account, your sessions, or your network traffic. Server-side, Freebuff sees exactly the same requests as before.
- It is fully reversible: one click restores the original look, and without the studio Freebuff is the original app, untouched.

## Requirements

- Node.js 22 or newer (tested with 24)
- Freebuff Desktop installed

Nothing else. The project uses only Node's built-in modules (`fetch`, `WebSocket`, `http`) — no dependencies, no install step.

## Usage

### Windows — standalone .exe (no Node needed)

Double-click `CustomFreebuff.exe` from the `dist/` folder (or from a release).
It is a self-contained GUI executable: everything is bundled inside, nothing
to install, and **no console window** — only the small launcher window appears
(the Theme Engine opens in Freebuff itself).

### Windows — from source

Double-click `start.bat` (requires Node.js). It launches the themer hidden (no
console window), so only the launcher window is visible.

### macOS — standalone app (no Node needed)

Download the zip that matches your Mac from a release page:

- **`CustomFreebuff-mac-arm64.zip`** — Apple Silicon (M1/M2/M3/M4…)
- **`CustomFreebuff-mac-x64.zip`** — Intel

Unzip (double-click the zip), drag **CustomFreebuff.app** to Applications,
then double-click it. No Node, no terminal, no commands — the studio opens in
your browser and the Theme Engine works exactly like on Windows.

First launch shows *"CustomFreebuff cannot be opened because the developer
cannot be verified"* — that is normal for an unsigned app downloaded from
the internet (same story as SmartScreen on Windows). Right-click the app →
**Open** → **Open** once, and it will run normally afterwards.

### macOS / Linux — from source

```bash
./start.sh
```

Or, if you prefer:

```bash
npm start
# or
node themer.mjs
```

## Building the standalone .exe

```bash
node scripts/build-exe.mjs
```

This produces `dist/CustomFreebuff.exe` (~90 MB, the Bun runtime is embedded).
The build uses Bun's `--compile`. Bun is picked up from, in order: the `BUN`
environment variable, `bun` on PATH, or the bun binary bundled with Freebuff
Desktop itself — so you usually do not need to install anything extra.
The studio page and the themes are inlined into the executable, so the file
works on its own, anywhere.

## Building the macOS app

```bash
node scripts/build-mac.mjs
```

Produces `dist/CustomFreebuff-mac-arm64.zip` and `dist/CustomFreebuff-mac-x64.zip`
(each a proper `CustomFreebuff.app` bundle). On a Mac the build compiles
natively and ad-hoc signs the bundle; from Windows/Linux it **cross-compiles**
genuine Mach-O binaries with Bun (`--target=bun-darwin-<arch>`), so you do not
need a Mac to produce the download. The zip stores the unix permissions, so
the app stays executable after extraction.

Like the exe, the app is **not notarized** (no Apple Developer account), hence
the right-click → Open on first launch. Real Developer ID signing +
notarization would remove it.

## Code signing & SmartScreen

The release exe is **not code-signed**, so Windows SmartScreen shows
*"Windows protected your PC"* the first time. That warning is normal for an
unsigned exe downloaded from the internet — it is not a virus alert, and
clicking **More info → Run anyway** is safe.

Removing the warning needs two things, and there is no shortcut:

1. **A code-signing certificate from a trusted CA.** A self-made
   (self-signed) certificate does *not* help — Windows does not trust it.
2. **Download reputation.** Even with a valid certificate, SmartScreen can
   keep warning for a while for a brand-new publisher, until enough people
   download and run the exe without issues. Reputation builds on its own.

### Getting a certificate

- **Cheapest legit option:** [Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/)
  (Microsoft's cloud signing, about $10/month for 5,000 signatures). Keys
  stay in the cloud, no USB token needed, and it works in GitHub Actions.
- **Classic option:** an OV/EV code-signing certificate from a CA (DigiCert,
  Sectigo, SSL.com, Certum…), roughly $100–500/year. EV requires a hardware
  token.
- **Free for open source:** some CAs and programs (e.g. SignPath) offer free
  signing for open-source projects.

### Signing once you have a certificate

Everything is already wired up. Locally, with a `.pfx` file:

```bash
# Windows
export CODESIGN_PFX_PATH=/path/to/cert.pfx
export CODESIGN_PFX_PASSWORD=its-password
npm run sign
```

(`CODESIGN_PFX_BASE64` works too — the pfx as base64, handy for CI secrets.
Or set `CODESIGN_THUMBPRINT` to use a certificate already installed in the
Windows certificate store.) The script finds `signtool` from the Windows SDK,
signs with SHA-256, adds an RFC3161 timestamp, and verifies the result.

On GitHub, the **Build, sign & release** workflow (Actions tab, "Run
workflow") builds the exe on a clean Windows machine and releases it. Add the
certificate as repository secrets `CODESIGN_PFX_BASE64` and
`CODESIGN_PFX_PASSWORD`, and the workflow signs automatically; without them
it builds and releases unsigned.

### The launcher window (VS2.5)

The standalone no longer shows a big studio page. Double-click the `.exe` (or
run `npm start`) and a **tiny launcher window** opens (Chromium `--app=` mode:
no tabs, no address bar) with essentially two buttons:

- **🎯 Patch Freebuff (injection)** — the main button: starts Freebuff with
  the local debug port and injects the Theme Engine. If Freebuff is already
  running, the launcher shows a clear warning: *close Freebuff, then patch
  again* (a live instance is never killed, because that could destroy an
  active session).
- **Nettoyer les processus restants** — appears only when leftover Freebuff
  processes are detected.

All theme management happens **inside Freebuff** (the 🎨 Themes button), not
in the launcher. The launcher remembers your choice, so the next time you
patch Freebuff, the same theme comes back automatically.

### Theme Engine inside Freebuff (VS0 → VS13)

Once Freebuff is patched from the launcher, a small **🎨 Themes** button appears
in the bottom-right corner of the app window — the first pieces of the future
Theme Engine, usable directly inside Freebuff. Click it to open the in-app
theme panel:

- pick a theme → it is applied instantly and remembered locally,
- the panel is a clean, navigable interface: a **bottom navigation** moves
  between *Themes* and *Editor*, and the editor has a **tab bar** (Colors /
  Components / Shape / Effects / Motion / Advanced) so every section has its
  own space — hidden tabs stay fully functional,
- **user themes can be deleted**: themes you created or imported get a delete
  button (first click asks *“Sure?”*), while official themes are protected;
  deleting the active theme returns Freebuff to its original look,
- **+ Create theme** (VS12): name a theme and pick its **base** — from
  **scratch**, from **Default**, or from **any existing theme** (built-in or
  your own) — and the editor opens on it right away. Each new theme gets its
  own unique id, so nothing is ever overwritten,
- **Edit** opens the **Theme Editor** (VS1): the six design tokens
  (Background, Surface, Text, Muted Text, Border, Accent) as color pickers,
  with **live preview** — change Accent and every place driven by `--brand`
  (buttons, links, active states) changes at once,
- **Components** (VS2): the editor exposes **Button, Input, Card, Sidebar and
  Modal**, each with **Colors, Border, Radius and Shadow**. Only the overridden
  settings are stored — so customizing a Button never leaks into Inputs,
  Cards or the rest of the app (component isolation),
- **States** (VS3): every component has **Hover, Active, Focus, Disabled and
  Loading** states, each editable with its own colors and glow — hovering
  restyles the hovered element without touching its normal look,
- **Shapes & Depth** (VS4): a global radius, border width and border opacity,
  plus **multi-layer shadows** (X, Y, blur, spread, color, opacity, inner),
  with 5 look presets (Flat, Soft, Floating, Deep, Neon),
- **Effects** (VS5): one **glass style** for every surface at once —
  transparency, backdrop blur, saturation, brightness, translucent borders,
  glow, gradients and noise — with 5 presets (None, Subtle, Frosted, Strong,
  Important). Heavy effects are detected and can be disabled or tuned down
  for performance, and a master switch turns everything off,
- **Motion** (VS6→VS7): a base duration / easing / delay for every surface,
  with **per-state transforms** (hover lifts and grows, press shrinks, focus)
  and **enter animations** for new messages — 4 presets (Minimal, Smooth,
  Snappy, Bouncy) and a live preview button. Minimal (no motion) is the
  default. A **global scale** then sets the app's personality: one **Speed**
  slider (0.25×–3×) accelerates or slows down everything at once, one
  **Intensity** slider makes motion discreet (0) or dynamic (2), and the
  theme respects the system's **reduced-motion** setting by default,
- **Element Inspector** (VS8): **Edit Element** lets you **pick any element
  in Freebuff** — it is highlighted under your cursor, and a click maps it
  to its theme component and opens a focused inspector (Appearance, Shape,
  Depth, Effects → new component **Glow**, Motion → Hover/Press). Every
  edit previews **live on the real element**, stays isolated from the other
  components, and **Reset this component** undoes it. Sensitive elements
  (the panel, the injection) are protected from picking,
- **Advanced** (VS9): **Custom CSS** — a code editor with **live syntax
  highlighting** lets power users write CSS that is injected into Freebuff
  in real time. The whole theme is exposed as **CSS variables**
  (`var(--theme-surface)`, `var(--theme-accent)`, `var(--theme-radius)`, …),
  rules are **validated** with line/column error reporting, and a **scope**
  option restricts them to the themed surfaces (or the whole app).
  **Reset custom CSS** clears everything. The chat stays protected: its
  messages (`.bubble`/`.msg`) are not themeable surfaces — no shadows,
  glass or hover growth on the conversation — and only interactive
  controls (buttons, inputs, selects) animate on hover, never the
  containers,
- **Undo / Redo + History** (VS10): every change — tokens, components,
  states, shapes, effects, motion, custom CSS, the element inspector — is
  recorded as a step, with **Undo/Redo buttons**, **Ctrl+Z / Ctrl+Shift+Z
  / Ctrl+Y shortcuts** and a **history list** that jumps back or forward
  to any step by name. One gesture = one step; **all resets** (the new
  per-property ↺ buttons, component, state, theme, custom CSS) are
  undoable. Saving is the new baseline,
- **Import / Export** (VS11): **Export** downloads the theme being edited
  as a portable **`.freebuff`** file (tokens, components, states, shape,
  effects, motion and custom CSS in one JSON document); **Import theme**
  in the list validates the file — JSON syntax, format, version and
  compatibility — then installs it as a new theme, never overwriting
  anything, with explicit error messages for invalid or newer files,
- **Save** saves the theme (editing a built-in theme never overwrites
  it: it creates a derived *custom* theme and activates it),
- **Reset** restores the base theme's tokens **and** components,
- **Restore the original look** removes the CSS everywhere,
- the header shows the live status (injection active, studio offline, …).

The panel lives in its own Shadow DOM and only talks to the local standalone
API on `127.0.0.1` (loopback origins only) — it never touches the app's
internals. If the app reloads or is relaunched, the theme and the panel come
back automatically.

> **VS0/VS1 scope note:** the entry point is a floating button, not yet a real
> row inside Freebuff's own Settings page. Hooking the app's actual Settings
> DOM is deliberately out of scope until the app's DOM structure is known — a
> risk already flagged in the PRD.

### Component colors map to the real app

The app's whole UI is driven by CSS variables defined on `:root`, and the
component editor targets the variables Freebuff actually uses — verified on
the real app DOM: buttons draw their background from the *surface* family
(`--surface` / `--surface-2` / `--raised`), text colors from
`--text` / `--muted` / `--faint`, and so on. That is why changing a component's
color visibly changes the real buttons, inputs and cards of the app.

## How it works

Freebuff Desktop is an Electron app. Its window shows a local web page, and every color in the UI comes from CSS variables:

```css
:root {
  --bg: #0e0e0e;        /* page background */
  --surface: #151517;   /* panels */
  --chrome: #0a0a0b;    /* tab bar */
  --text: #e7e7e8;      /* text */
  --brand: #7cff3f;     /* accent */
}
```

**A theme is data, not CSS (VS1).** Each theme is a set of *design tokens*
(background, surface, text, muted text, border, accent). The studio *generates*
the stylesheet from those tokens: `accent → --brand, --brand-dim, --ok, …`,
`surface → --surface, --surface-2, --raised`, and so on. That is why changing
one token changes several coherent places in Freebuff at once. User themes are
stored as JSON files in the studio's own config directory
(`%APPDATA%\freebuff-themer\themes\` on Windows) — never in Freebuff's files.

**Components override tokens locally (VS2).** A theme can carry a `components`
section — `button`, `input`, `card`, `sidebar`, `modal` — each able to override
Colors, Border, Radius and Shadow *within that component only* (the generator
emits scoped rules such as `button{--surface:…;border-radius:…}`). Only the
overridden settings are stored, so everything else keeps inheriting the global
tokens. Component selectors are generic on purpose (component theming = all
instances stay consistent); they live in one constant in
`lib/theme-model.mjs` to be refined once the real Freebuff DOM is known.

The standalone does four things:

1. **Launch** — it starts Freebuff with `--remote-debugging-port=<port>`, a standard Chromium switch (the same mechanism as DevTools). The port only listens on `127.0.0.1`.
2. **Inject CSS** — over the DevTools protocol, it adds a `<style>` element to the app's page, exactly like a browser extension. The theme is re-applied whenever a window opens or the page reloads.
3. **Theme Engine panel (VS0)** — it injects a small *Themes* button + panel into the app window, so themes can be activated from inside Freebuff itself. The panel is self-contained (Shadow DOM) and talks back to the launcher over the local API.
4. **Native window color** — the title bar color follows the app's own theme API (`window.freebuffDesktop.setTheme`), i.e. the built-in dark/light setting.

## Why this is safe

| Concern | Answer |
| --- | --- |
| Does it modify the app? | No. Not a single file of the installation is touched. |
| Is a debug port a security hole? | The port binds to 127.0.0.1 only, and is a stock Chromium/Electron feature used internally by the app itself. |
| Ban risk? | None that I can see. Theming is local and visual; nothing the app sends to its servers changes. |
| Is it reversible? | Yes. "Restore original look" removes the CSS and restores the native theme preference. |

Honest caveat: this is a third-party tool, use at your own risk. It is designed to be harmless, but no third-party tool can be guaranteed.

## Troubleshooting

- **"Freebuff is already open"** — click **Patch Freebuff** once more. The launcher waits a few seconds for a closing instance to fully exit before giving up. If it still refuses, a window really is open: close it (the app is never killed automatically), or use **Nettoyer les processus restants**. Electron's single-instance lock ignores new command-line arguments while an instance runs.
- **Freebuff processes stay in Task Manager without a window** — that is leftover helper processes from a previous session (GPU/utility) or an orphaned orchestrator (`bun.exe` from the Freebuff folder). They block a new launch. The studio detects both and cleans them up automatically when you click **Launch**, or you can use the **Clean up leftover Freebuff processes** button.
- **Freebuff runs but no window is visible** — this happened in an early release because the launcher spawned Freebuff with Windows' `SW_HIDE` startup flag, so the OS created the app's window hidden (it existed, the theme applied, but nothing showed on screen). That flag is gone: the window is now created visible, exactly like launching Freebuff normally.
- **Launching shows "no window appeared"** — every launch is traced to `%APPDATA%\freebuff-themer\launch-trace.log` (macOS/Linux: `~/.config/freebuff-themer/`): every step, the processes found, whether the debug port came up, and the window's real OS state. Paste that content if you need help.
- **"Freebuff is running without the debug port"** — it was started some other way. Close it and relaunch from the launcher.
- **The theme disappeared after an app update** — the app reloaded its page without the launcher attached. Reopen the launcher and patch Freebuff from it again.
- **Freebuff not found** — set the `FREEBUFF_EXE` environment variable to the path of `Freebuff.exe` (Windows) or `Freebuff` (macOS/Linux).

## Development

```bash
npm run check   # syntax check
npm test        # end-to-end CDP tests (needs Edge or Chrome on the machine)
```

**How to test everything end-to-end (VS0 + VS1), with the .exe or from the
source: see [TESTING.md](TESTING.md).** It walks through the in-app Theme
Engine, the token editor and its live preview, persistence, disconnection,
and how to rebuild the executable.

The tests launch a headless Chromium against a page that mimics the Freebuff renderer, and verify: CSS injection, persistence across reload, the native `setTheme` call, automatic theming of newly opened windows, the in-app Theme Engine panel (activate → visual change → restore, edit a token → several coherent places change → save → reset, customize a Button → it changes while Input/Card are untouched → save → reset, real hover restyles only the hovered button, Flat→Floating transforms the whole interface, Frosted makes several components glassy at once, a Motion preset really changes the animated behavior on hover and on message entry, a single Speed/Intensity slider accelerates or freezes the whole app, reduced-motion is injected and removable, Edit Element picks a real button → highlights it → maps it to its component → edits preview live on it only, and Custom CSS typed in the editor is injected live with the theme's variables (and validated/scoped/reset), undo/redo restores previous states step by step through every editor (tokens, components, resets, custom CSS) and the history list jumps back and forth, export produces a portable .freebuff file and import validates and installs it), disconnection detection, and the token/component/shape/effects/motion/custom-CSS→CSS generator (unit).

## Project layout

```
start.bat / start.sh   # launchers (require Node.js)
themer.mjs             # local server + API + orchestration
lib/assets.mjs         # asset loading (embedded in the exe / disk in dev)
lib/cdp.mjs            # minimal CDP client + CSS injection
lib/theme-model.mjs    # theme model: tokens + components + shape + effects + motion + custom CSS + .freebuff export/import → generated CSS (VS1→VS13)
lib/theme-store.mjs    # user-theme persistence (VS1)
lib/themeui.mjs        # in-app Theme Engine panel + editor injected into Freebuff (VS0→VS13, incl. undo/redo history)
lib/launcher.mjs       # Freebuff discovery and launch
public/index.html      # the small launcher window (single page, no build step)
themes/*.json          # built-in themes (tokens)
scripts/build-exe.mjs  # builds the standalone .exe (Bun --compile)
scripts/build-embed.mjs
scripts/make-icon.mjs
test/                  # unit + e2e tests (headless Edge/Chrome)
```

Not affiliated with Freebuff, Inc.
