# Freebuff Themer

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

### Windows

Double-click `start.bat`. Your browser opens the theme studio.

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

- **"Freebuff is already open"** — close it, then launch it again from the studio. Electron's single-instance lock ignores new command-line arguments when an instance is running.
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
start.bat / start.sh   # launchers
themer.mjs             # local server + API + orchestration
lib/cdp.mjs            # minimal CDP client + CSS injection
lib/launcher.mjs       # Freebuff discovery and launch
public/index.html      # the studio (single page, no build step)
themes/*.json          # built-in themes
test/                  # e2e tests (headless Edge/Chrome)
```

Not affiliated with Freebuff, Inc.
