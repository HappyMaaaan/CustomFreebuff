# CustomFreebuff

A small theme studio for Freebuff Desktop. It changes the look of the app, nothing else.

Freebuff Desktop ships with a dark interface and no way to pick your own colors. This tool adds that: pick a theme, or write your own CSS, and it is applied live to the running app.

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
It is a self-contained executable: everything is bundled inside, nothing to
install. Your browser opens the theme studio.

### Windows — from source

Double-click `start.bat` (requires Node.js).

### macOS / Linux

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

### In the studio

1. If Freebuff is already open, close it.
2. Click **Launch Freebuff with theming**. Freebuff starts normally, with one extra: a local debug port (127.0.0.1 only) that the studio uses to inject the theme.
3. Pick a theme. It applies instantly to every open window.
4. To go back to the original look, click **Restore original look**.

The studio remembers your choice, so the next time you launch Freebuff from the studio, the same theme comes back automatically.

### Custom CSS

The app's whole UI is driven by CSS variables defined on `:root`. If you want your own colors, paste rules into the **Custom CSS** box and hit **Apply my CSS**. Example:

```css
:root {
  --bg: #101014 !important;
  --brand: #ffd166 !important;
}
```

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

The studio does three things:

1. **Launch** — it starts Freebuff with `--remote-debugging-port=<port>`, a standard Chromium switch (the same mechanism as DevTools). The port only listens on `127.0.0.1`.
2. **Inject CSS** — over the DevTools protocol, it adds a `<style>` element to the app's page, exactly like a browser extension. The theme is re-applied whenever a window opens or the page reloads.
3. **Native window color** — the title bar color follows the app's own theme API (`window.freebuffDesktop.setTheme`), i.e. the built-in dark/light setting.

## Why this is safe

| Concern | Answer |
| --- | --- |
| Does it modify the app? | No. Not a single file of the installation is touched. |
| Is a debug port a security hole? | The port binds to 127.0.0.1 only, and is a stock Chromium/Electron feature used internally by the app itself. |
| Ban risk? | None that I can see. Theming is local and visual; nothing the app sends to its servers changes. |
| Is it reversible? | Yes. "Restore original look" removes the CSS and restores the native theme preference. |

Honest caveat: this is a third-party tool, use at your own risk. It is designed to be harmless, but no third-party tool can be guaranteed.

## Troubleshooting

- **"Freebuff is already open"** — click **Launch** once more. The studio now waits a few seconds for a closing instance to fully exit before giving up. If it still refuses, a window really is open: close it, or use **Clean up leftover Freebuff processes**. Electron's single-instance lock ignores new command-line arguments while an instance runs.
- **Freebuff processes stay in Task Manager without a window** — that is leftover helper processes from a previous session (GPU/utility) or an orphaned orchestrator (`bun.exe` from the Freebuff folder). They block a new launch. The studio detects both and cleans them up automatically when you click **Launch**, or you can use the **Clean up leftover Freebuff processes** button.
- **Freebuff runs but no window is visible** — this happened in an early release because the studio spawned Freebuff with Windows' `SW_HIDE` startup flag, so the OS created the app's window hidden (it existed, the theme applied, but nothing showed on screen). That flag is gone: the window is now created visible, exactly like launching Freebuff normally. On top of that, the studio still detects the window by its *process* (`Freebuff.exe`), brings it to the front if another window covers it, and logs its real OS state (visible or not, position, size) in the diagnostics panel.
- **Launching shows "no window appeared"** — open the **What happened (diagnostics)** panel below the buttons: it lists every step of the launch, what processes were found, whether the debug port came up, the window's real state, and what Freebuff's own logs say. Every launch is also written to `%APPDATA%\freebuff-themer\launch-trace.log` (macOS/Linux: `~/.config/freebuff-themer/`). Paste that content if you need help.
- **"Freebuff is running without the debug port"** — it was started some other way. Close it and relaunch from the studio.
- **The theme disappeared after an app update** — the app reloaded its page without the studio attached. Reopen the studio and launch Freebuff from it again.
- **Freebuff not found** — set the path to `Freebuff.exe` (Windows) or `Freebuff` (macOS/Linux) in the studio, or use the `FREEBUFF_EXE` environment variable.

## Development

```bash
npm run check   # syntax check
npm test        # end-to-end CDP tests (needs Edge or Chrome on the machine)
```

The tests launch a headless Chromium against a page that mimics the Freebuff renderer, and verify: CSS injection, persistence across reload, the native `setTheme` call, and automatic theming of newly opened windows.

## Project layout

```
start.bat / start.sh   # launchers (require Node.js)
themer.mjs             # local server + API + orchestration
lib/assets.mjs         # asset loading (embedded in the exe / disk in dev)
lib/cdp.mjs            # minimal CDP client + CSS injection
lib/launcher.mjs       # Freebuff discovery and launch
public/index.html      # the studio (single page, no build step)
themes/*.json          # built-in themes
scripts/build-exe.mjs  # builds the standalone .exe (Bun --compile)scripts/build-embed.mjs
scripts/make-icon.mjs
test/                  # e2e tests (headless Edge/Chrome)
```

Not affiliated with Freebuff, Inc.
