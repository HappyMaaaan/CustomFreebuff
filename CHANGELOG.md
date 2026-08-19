# Changelog

All notable changes to CustomFreebuff, one section per release. The release
notes on GitHub are generated from this file.

## v1.1.0 — 2026-08-19

### Theme Engine, directement dans Freebuff 🎨

- Un bouton **🎨 Thèmes** apparaît en bas à droite de Freebuff : activer un
  thème, l'éditer ou restaurer le look d'origine se fait désormais
  **dans l'application**.
- L'ancienne grande page studio a disparu. Le lanceur est une **petite
  fenêtre** avec un bouton principal (🎯 Patch Freebuff) et un message clair
  si Freebuff est déjà ouvert — une instance vivante n'est jamais fermée.

### Éditeur de thème

- **6 tokens de design** (Background, Surface, Text, Muted Text, Border,
  Accent) en **aperçu en direct** : changez une couleur, tous les endroits
  cohérents de l'app changent d'un coup.
- Enregistrer un thème intégré modifié crée un thème **« custom » dérivé**,
  sans jamais écraser l'original.
- **Reset** ramène le thème à sa base.

### Thèmes par composants

- **Button, Input, Card, Sidebar et Modal** se personnalisent
  individuellement : couleurs, bordure, rayon, ombre.
- **Isolation** : personnaliser un bouton n'affecte ni les inputs, ni les
  cartes, ni le reste de l'app.
- Les couleurs des composants pilotent les variables que Freebuff utilise
  réellement — les changements sont visibles sur les vrais boutons de l'app.

### Expérience

- **Aucune fenêtre de terminal** : l'exe et le lanceur source n'ouvrent que
  la petite fenêtre.
- **Lanceur mono-instance** : un double-clic de plus ne crée plus de
  fenêtres empilées ni de ports qui se multiplient.
- **Panneau défilant** : plus rien n'est rogné, même sur une petite fenêtre.
- **7 thèmes inclus** : Default (le look d'origine de Freebuff), Dracula,
  Nord, Gruvbox, Paper Light, Solarized Dark et Tokyo Night.

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
