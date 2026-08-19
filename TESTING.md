# Guide de test — VS0 (Injection) + VS1 (Theme + Design Tokens)

Ce guide explique comment vérifier que tout fonctionne **avant de continuer
vers la VS2**. Il y a deux niveaux :

1. **Les tests automatisés** (30 secondes) — à lancer après chaque modification.
2. **Le test manuel de bout en bout** (5 minutes) — le seul qui prouve que le
   Theme Engine pilote réellement votre Freebuff.

---

## 1. Tests automatisés (rapide, à faire à chaque modification)

Depuis le dossier du projet (`C:\Users\Utilisateur\Desktop\CustomFreebuff`) :

```bash
npm run check   # vérifie la syntaxe de tous les fichiers
npm test        # 4 suites de tests (~56 vérifications)
```

`npm test` lance un Chromium headless (Edge) contre une page qui imite le
renderer de Freebuff et vérifie : injection CSS, survie au rechargement, appel
de l'API native `setTheme`, panneau Theme Engine (VS0), **éditeur de tokens
avec aperçu en direct, sauvegarde et reset (VS1)**, watcher et détection de
déconnexion.

> Si un test échoue, les lignes `✗ ...` montrent exactement ce qui ne va pas.
> Toutes les suites doivent se terminer par « Toutes les vérifications sont
> passées. ✔ ».

---

## 2. Test manuel — méthode la plus simple : le `.exe`

Le fichier `dist\CustomFreebuff.exe` est autonome (aucun Node requis) :

1. **Fermez Freebuff s'il est déjà ouvert** (sinon le patch est refusé).
2. Double-cliquez sur `dist\CustomFreebuff.exe` — **aucune fenêtre de
   terminal** ne s'ouvre (l'exe est en mode GUI).
3. Une **toute petite fenêtre de lanceur** s'ouvre (mode application Edge,
   sans onglets ni barre d'adresse) : un statut, un bouton
   **🎯 Patch Freebuff (injection)** et un bouton de nettoyage si des
   processus restants sont détectés.

   Depuis le code source, `start.bat` lance la même chose en cachant aussi la
   console (via `start-hidden.vbs`).

## 3. Test manuel — depuis le code source (Node)

Même chose, mais depuis le code (utile quand vous développez) :

```bash
npm start        # ou : node themer.mjs   ou   double-clic sur start.bat
```

Le choix des thèmes ne se fait plus dans le lanceur : il se fait
**directement dans Freebuff** via le bouton 🎨 (Theme Engine).

---

## 4. Parcours VS0 — activer un thème depuis Freebuff

1. Dans le lanceur, cliquez **🎯 Patch Freebuff (injection)**.
   - Si Freebuff tourne déjà, le lanceur affiche : **« Freebuff est déjà en
     cours d'exécution : fermez-le, puis cliquez à nouveau sur Patch »**.
   - Attendez le message « Freebuff est lancé avec l'injection ». Le lancement
     peut prendre jusqu'à 45 s.
2. Dans **Freebuff**, un bouton rond **🎨** apparaît en bas à droite.
3. Cliquez **🎨** → le panneau **Theme Engine** s'ouvre :
   - le statut doit afficher **« Injection active — 1 fenêtre »** (vert),
   - la liste montre les thèmes : **Default, Dracula, Gruvbox, Nord,
     Paper Light, Solarized Dark, Tokyo Night**.
4. Cliquez **Activer** sur « Dracula » → **l'application change immédiatement**
   (fond violet, texte clair, accent vert).
5. Cliquez **Restaurer le look d'origine** → Freebuff redevient noir.

### À vérifier pendant le parcours VS0

| Vérification | Résultat attendu |
| --- | --- |
| Activation d'un thème | Changement visuel immédiat dans Freebuff |
| Le panneau liste les thèmes | 7 thèmes, avec pastilles de couleurs |
| Statut du panneau | « Injection active — 1 fenêtre » (point vert) |
| Restaurer | Freebuff retrouve son look d'origine |

---

## 5. Parcours VS1 — l'éditeur de thème (le cœur de la slice)

C'est ici que se prouve le Definition of Done : **modifier UNE valeur change
plusieurs endroits cohérents de Freebuff**.

1. Ouvrez le panneau **🎨** → cliquez **Modifier** sur « Default ».
2. L'**Éditeur de thème** s'ouvre avec 6 couleurs (tokens) :
   **Background, Surface, Text, Muted Text, Border, Accent**.
3. **Changez Accent** (cliquez sur la pastille et choisissez une autre couleur,
   par exemple un rouge).
4. **Sans rien sauvegarder**, regardez Freebuff : tout ce qui utilise
   l'accent change **en direct** — boutons, liens, focus, états actifs.
   Le texte « Aperçu en direct — non enregistré » s'affiche.
5. Cliquez **Enregistrer** :
   - le panneau revient à la liste,
   - un nouveau thème **« Default (custom) »** apparaît, marqué
     **« personnalisé »**, et il est **actif**,
   - le thème « Default » d'origine **n'a pas été modifié**.
6. Rouvrez **Modifier** sur « Default (custom) » → changez Background →
   **Enregistrer** → le thème personnalisé est mis à jour, pas un doublon.
7. Sur « Default (custom) », cliquez **Reset** → les couleurs reviennent à
   celles de la base (Default), avec aperçu appliqué.

### La preuve du DoD (à vérifier visuellement)

Changez **uniquement** le token Accent et observez que **plusieurs endroits
changent en même temps** dans Freebuff : c'est parce que le studio *génère*
`--brand`, `--brand-dim`, `--ok`… à partir d'un seul token (le CSS n'est pas
écrit à la main).

---

## 5 bis. Parcours VS2 — personnalisation par composants

Le but : passer du thème global à **contrôler l'interface composant par
composant**.

1. Ouvrez le panneau **🎨** → **Modifier** sur un thème.
2. Dans l'éditeur, descendez à la section **Components** :
   **Button, Input, Card, Sidebar, Modal**.
3. Cliquez **Button** → le détail du composant s'ouvre :
   - **Colors** : Background, Text, Border, Accent,
   - **Border** : épaisseur,
   - **Radius** : curseur 0–48 px,
   - **Shadow** : Aucune / Légère / Moyenne / Forte.
4. **Changez Background** (par exemple un rose) → **tous les boutons** de
   Freebuff changent **en direct**. Les inputs, les cards et le reste de
   l'application ne bougent pas : c'est l'**isolation entre composants**.
5. Changez le **Radius** et l'**ombre** → mêmes effets, scopés au bouton.
6. Revenez en arrière (←) et ouvrez **Input** → changez sa couleur → les
   boutons **restent tels quels** (preuve du DoD : personnaliser un composant
   n'affecte pas les autres).
7. **Enregistrer** → le thème mémorise les overrides de composants.
8. **Reset** → les composants reviennent aux tokens globaux du thème.

> **Note d'architecture** : un composant = toutes ses instances (tous les
> boutons ensemble) — c'est ce qui garantit la cohérence. La personnalisation
> d'une *variante* précise (bouton primaire vs fantôme) viendra dans une
> slice ultérieure. Les sélecteurs de composants sont regroupés dans
> `lib/theme-model.mjs` pour être affinés quand le vrai DOM de Freebuff sera
> connu.

---

## 6. Robustesse — persistance, reload, déconnexion

| Scénario | Manipulation | Résultat attendu |
| --- | --- | --- |
| **Reload** | Dans Freebuff, appuyez sur `Ctrl+R` (recharger la page) | Le thème, les composants **et** le bouton 🎨 reviennent automatiquement |
| **Fermeture** | Fermez Freebuff | Le studio indique « Freebuff is closed » |
| **Relance** | Recliquez **Launch Freebuff with theming** | Le même thème revient, bouton 🎨 présent |
| **Studio fermé** | Fermez l'onglet du studio puis relancez le `.exe`/`npm start` | Le thème actif est réappliqué tout seul |
| **Thème persistant** | Enregistrez un thème custom, fermez Freebuff ET le studio, relancez les deux | Votre thème « … (custom) » est dans la liste et toujours actif |
| **Déconnexion** | Fermez Freebuff pendant que le studio tourne | Le panneau du studio passe au jaune/rouge ; pas de plantage |

---

## 7. Checklist VS1 + VS2 (Definition of Done)

- [ ] Ouvrir Freebuff → 🎨 → activer un thème → changement immédiat
- [ ] Modifier un token (Accent) → plusieurs endroits cohérents changent
- [ ] Aperçu en direct avant d'enregistrer
- [ ] Enregistrer crée un thème « (custom) » sans écraser l'intégré
- [ ] Reset ramène le thème (tokens **et** composants) à sa base
- [ ] Customiser Button → les boutons changent, les inputs/cards non (VS2)
- [ ] Customiser Input → les boutons ne bougent pas (VS2)
- [ ] Changer le fond d'un bouton → les vrais boutons de Freebuff changent
      (fond, texte, accent pilotent chacune la famille de variables que l'app
      utilise réellement — vérifié sur le DOM réel : `--surface`/`--surface-2`/
      `--raised` pour les fonds, `--text`/`--muted`/`--faint` pour les textes)
- [ ] Le thème et ses composants survivent au rechargement de la page
- [ ] Restaurer le look d'origine fonctionne

---

## 8. Si quelque chose ne va pas

- **« Freebuff is already open »** : fermez Freebuff, attendez 2 s, relancez.
- **« Freebuff is running without the debug port »** : Freebuff a été lancé
  hors du studio. Fermez-le et relancez-le depuis le studio.
- **Le bouton 🎨 n'apparaît pas** : le lanceur affiche le message d'erreur du
  patch ; le détail de chaque étape est écrit dans
  `%APPDATA%\freebuff-themer\launch-trace.log`.
- **Processus fantômes** : le bouton **Clean up leftover Freebuff processes**
  du studio les supprime.
- **Le panneau affiche « Studio hors ligne »** : le studio n'est pas lancé.
  Relancez l'exe ou `npm start`.
- **Une fenêtre de terminal clignote toutes les ~2 s** : c'est l'ancienne
  détection « Freebuff tourne ? » qui lançait `tasklist` (une app console) à
  chaque sondage du lanceur — Windows Terminal s'ouvrait à chaque appel.
  Corrigé depuis (exécution invisible), mais : (1) assurez-vous d'utiliser la
  version reconstruite de l'exe, (2) fermez toutes les instances de
  `CustomFreebuff.exe` en double avant de relancer — le lanceur est
  mono-instance : un second double-clic sort silencieusement.

---

## 9. Reconstruire le `.exe` après une modification

Le `.exe` embarque le code **et** les thèmes/la page du studio. Après toute
modification du code ou des thèmes, reconstruisez-le :

```bash
node scripts/build-exe.mjs
```

→ produit `dist\CustomFreebuff.exe` (≈ 96 Mo, autonome). Le script trouve
Bun automatiquement dans les ressources de Freebuff Desktop ; sinon installez
Bun (`https://bun.sh`) ou définissez `BUN` en variable d'environnement.
