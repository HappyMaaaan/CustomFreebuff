# Changelog

All notable changes to CustomFreebuff, one section per release. The release
notes on GitHub are generated from this file.

## v1.0.1 — 2026-08-18

- New logo: the studio header and the executable icon now show **CF** (CustomFreebuff) instead of FT.
- Releases now bump versions (v1.0.1, v1.0.2, …). `node scripts/gh-release.mjs` without a tag picks the next patch version after the latest release automatically, and package.json stays in sync.
- Release notes now describe what changed in this version (this changelog), instead of repeating the v1.0.0 description.

## v1.0.0 — 2026-08-18

- **Fix the invisible window.** Freebuff launched with its window created hidden (Windows `SW_HIDE` flag set by the studio's spawn): the app ran, the theme applied, but nothing showed on screen. The window is now created visible, exactly like a normal launch.
- **Reliable window detection.** The launch diagnostics identify the real Freebuff window by its process (`Freebuff.exe`), not by window title — titles containing "freebuff" (Chrome, Discord, Explorer) are no longer mistaken for the app, and the bring-to-front targets the right window.
- **Bring-to-front that works.** If another window covers Freebuff after launch, the studio restores and foregrounds it (SetWindowPos TOPMOST, which bypasses Windows' foreground lock), then logs its real OS state (visible, position, size).
- **Accurate status.** The studio badge shows "Theme active" once the theme is actually applied, instead of staying on "applying theme…".
- **Safer debug port.** The saved debug port is reused only when free; otherwise a fresh one is picked.
- **Rebranded to CustomFreebuff.** The executable is now `CustomFreebuff.exe`, matching the repo name.
