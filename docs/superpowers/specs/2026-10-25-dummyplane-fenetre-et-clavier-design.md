# dummyPlane — Fenêtre, livraison et navigation au clavier (spec)

- **Date** : 2026-10-25
- **Statut** : validée en brainstorming par Mathieu, en attente de relecture écrite
- **Étend** : `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (« spec habillage »), elle-même extension de la spec V1. Tout ce que cette spec ne modifie pas reste régi par elles.

## 1. Objectif

Faire d'dummyPlane une application Windows à part entière et rendre la flotte pilotable sans souris :

1. Une fenêtre sans barre Windows, intégrée au thème, avec l'orbe pour icône et le projet dans son titre.
2. Un installateur, sans console au lancement.
3. Passer d'un terminal à l'autre au clavier, même en train de taper dans l'un d'eux.
4. Deux palettes : Ctrl+P pour aller à un terminal, un groupe, un orchestrateur, un workspace ou un projet ; Ctrl+Maj+P pour trouver toute fonction de l'application.

### Critère de succès

1. Mathieu installe dummyPlane par l'installateur, le lance depuis le menu Démarrer : aucune console, l'orbe dans la barre des tâches, « dummyPlane — <projet> » dans Alt+Tab.
2. Il déplace, agrandit, ancre et redimensionne la fenêtre comme n'importe quelle application.
3. En train d'écrire dans Isis, il passe à Thot par Ctrl+Tab ou par Ctrl+P « tho » Entrée, et tape aussitôt dans Thot.
4. Toute action de l'application se trouve par Ctrl+Maj+P.

## 2. Périmètre

### Inclus

- Fenêtre sans décorations : bande de déplacement, boutons Réduire / Agrandir / Fermer, titre dynamique, icône.
- Build release et installateur NSIS.
- Écouteur clavier global et ses raccourcis : terminal suivant / précédent, rendre la main au canvas, vue d'ensemble, palettes.
- Arrivée sur un terminal (clavier, vue, signal visuel).
- Palette « Aller à » et palette « Fonctions », adossées à un registre de fonctions.

### Hors périmètre

- Navigation par direction (Alt+flèches) et par numéros (Ctrl+1…9).
- Raccourcis personnalisables, liste des fonctions récentes en tête de palette.
- Recherche des dessins du canvas (textes, formes) dans Ctrl+P.
- Molette au-dessus de la bande de déplacement (elle n'agit pas sur le canvas).
- Menu d'ancrage de Windows 11 au survol du bouton Agrandir.
- Garde contre deux instances simultanées.

## 3. Décisions

| Sujet | Décision |
|---|---|
| Barre de titre | Supprimée. Les pastilles flottantes de la barre du haut restent ; leur rangée devient la zone de déplacement et reçoit les boutons de fenêtre. |
| Icône | L'orbe orange de l'application (`.ov-orb`). |
| Titre | « dummyPlane » à l'accueil, « dummyPlane — <projet> » dans un projet. |
| Livraison | Build release (sans console) emballé dans un installateur NSIS par utilisateur. |
| Raccourcis et palettes | Un registre unique de fonctions sert l'écouteur clavier et la palette : un raccourci et sa ligne de palette ne divergent jamais. |
| Palettes | Un seul composant à deux modes, comme VS Code : Ctrl+P « Aller à », Ctrl+Maj+P « Fonctions » (préfixe `>`). Bibliothèque `cmdk`, version figée. |
| Ordre de Ctrl+Tab | Ordre de lecture sur le canvas, par blocs : les cadres d'abord, membres ligne par ligne, puis les terminaux isolés. |
| Vue à l'arrivée | Ne bouge que si le terminal n'est pas entièrement visible à 100 %. |
| Portée de Ctrl+P | Tout le projet ouvert (tous ses workspaces) ; projets à l'accueil. |

## 4. Fenêtre

### 4.1 Décorations

- `tauri.conf.json` : fenêtre `main` en `decorations: false`. L'ombre, les coins arrondis de Windows 11 et le redimensionnement par les bords sont conservés (comportement de Tauri pour une fenêtre sans décorations sous Windows, à vérifier dans l'application ; voir §12).
- Fenêtre agrandie : pas de marge ni de coins, comme toute application.

### 4.2 Bande de déplacement

- Élément transparent couvrant toute la largeur de la fenêtre et les 56 premiers pixels (rangée des pastilles de la spec habillage §5.2 : 16 px de marge + 32 px de pastille + 8 px), posé au-dessus du canvas et sous les pastilles.
- Glisser la bande déplace la fenêtre (déplacement natif, donc avec l'ancrage aux bords de l'écran et Aero Snap). Double-clic : agrandir ou restaurer.
- Le canvas reste visible dessous (grille, éléments), mais on n'y dessine ni ne le déplace dans cette rangée ; l'étiquette d'un groupe ou l'en-tête d'un terminal qui passe sous la bande n'y est pas cliquable.
- Les pastilles, menus et boutons restent cliquables : seule la bande elle-même déclenche le déplacement, pas ses voisins posés au-dessus.

### 4.3 Boutons de fenêtre

- À droite de la barre du haut, après Réglages : **Réduire**, **Agrandir** / **Restaurer**, **Fermer**.
- Boutons de 32 × 32 px, rayon 8, sans fond ; survol `--ov-hover` ; Fermer au survol : fond `--ov-danger`, icône blanche. Icônes Lucide `Minus`, `Square` (agrandir) / `Copy` (restaurer), `X`. L'icône du milieu suit l'état réel de la fenêtre (agrandie ou non), y compris après un double-clic sur la bande, Win+↑ ou un ancrage.
- Info-bulles : « Réduire », « Agrandir », « Restaurer », « Fermer ».
- Fermer demande la fermeture de la fenêtre : la sauvegarde avant fermeture existante (`onCloseRequested` dans `src/app/boot.ts`) s'exécute comme avec la croix de Windows.

### 4.4 Accueil

- Même bande de 56 px et mêmes boutons, en haut à droite, à la même hauteur que dans un projet.
- L'en-tête de l'accueil (« dummyPlane », « Ajouter un projet ») ne passe jamais sous les boutons de fenêtre, quelle que soit la largeur de la fenêtre.

### 4.5 Titre

- « dummyPlane » à l'accueil ; « dummyPlane — <nom du projet> » quand un projet est ouvert (tiret cadratin entouré d'espaces). Mis à jour à l'ouverture, à la fermeture et au renommage du projet.
- Le titre n'est pas affiché dans la fenêtre : il sert à la barre des tâches, à Alt+Tab et au survol de la barre des tâches.

### 4.6 Icône

- Source : `src-tauri/icons/source/orb.svg`, 1024 × 1024, fond transparent : un disque occupant 92 % du carré, dégradé radial centré à 35 % / 30 % : `#FFD48A` (0 %), `#F4602E` (55 %), `#8A2A10` (100 %) — le dégradé de `.ov-orb`, sans la lueur, qui brouillerait les petites tailles.
- `pnpm tauri icon` génère depuis cette source toutes les icônes de `src-tauri/icons/` (`.ico`, `.icns`, PNG, logos Store) et remplace les icônes Tauri par défaut. Si la commande n'accepte pas le SVG, le SVG est d'abord rendu en PNG 1024.

### 4.7 Permissions

La capacité `default` reçoit les permissions de fenêtre nécessaires : déplacer (`start-dragging`), agrandir par double-clic (`internal-toggle-maximize`), réduire, agrandir / restaurer, lire l'état agrandi, changer le titre, fermer.

## 5. Livraison

- **Build** : `pnpm tauri build --bundles nsis`, profil release. `main.rs` porte déjà `windows_subsystem = "windows"` hors debug : pas de console. Les processus lancés par l'application hors terminaux (`git`, `ollama list`) passent déjà par `hide_window` : aucune fenêtre ne clignote.
- **Installateur** : `src-tauri/target/release/bundle/nsis/dummyPlane_<version>_x64-setup.exe`. Installation par utilisateur (sans droits administrateur), raccourci « dummyPlane » dans le menu Démarrer avec l'orbe, désinstallation par les Paramètres de Windows. Relancer un installateur plus récent met à jour.
- **Données** : l'identifiant reste `dev.dummyplane.app` ; la version installée ouvre la base actuelle.
- **Outils de développement** : absents du build release (pas d'« Inspecter » au clic droit). `pnpm tauri dev` et le profil `dev.dummyplane.probe` restent l'environnement de mise au point.
- Les exécutables autonomes `j1`, `j2`, `j5` du dossier `.superpowers/sdd/2026-10-24-dummyplane-plan-a-habillage-terminal/` deviennent inutiles une fois l'installation validée ; ils ne doivent pas tourner en même temps que la version installée (§12).

## 6. Clavier

### 6.1 Raccourcis

| Raccourci | Fonction | Disponible |
|---|---|---|
| Ctrl+Tab | Terminal suivant | projet ouvert, au moins un terminal dans le workspace affiché |
| Ctrl+Maj+Tab | Terminal précédent | idem |
| Ctrl+P | Aller à… | toujours |
| Ctrl+Maj+P | Fonctions | toujours |
| Maj+Échap | Rendre la main au canvas | projet ouvert |
| Ctrl+Maj+A | Vue d'ensemble | projet ouvert |

- Excalidraw 0.18 n'utilise aucune de ces combinaisons, sauf Ctrl+Maj+P (sa palette), qui reste accessible par Ctrl+/. Les touches à une lettre d'Excalidraw (V, R, O…) restent actives quand le canvas a le clavier.
- Côté terminaux : xterm ne distingue pas Ctrl+Maj+lettre de Ctrl+lettre ; seuls Ctrl+P (commande précédente dans bash et certains agents, que ↑ remplace), Ctrl+Tab (inutilisé) et Maj+Échap (transmis comme Échap) cessent d'atteindre les agents. Échap seul leur reste.

### 6.2 Capture

- Un écouteur `keydown` unique sur `window`, en phase de capture, installé au démarrage de l'application pour toute sa durée : il passe avant xterm, les champs, Excalidraw et les raccourcis de WebView2.
- Une touche reconnue dont la fonction est disponible est consommée (`preventDefault`, arrêt de la propagation) : elle n'atteint ni le terminal, ni l'agent, ni Excalidraw, ni WebView2 (Ctrl+P n'ouvre pas l'impression). Une touche reconnue dont la fonction n'est pas disponible n'est pas consommée.
- Reconnaissance : les lettres se lisent sur la touche telle qu'imprimée (`event.key`, insensible à la casse) — Ctrl+P est la touche P en AZERTY comme en QWERTY ; Tab et Échap par leur nom. Une combinaison avec Alt (donc AltGr) n'est jamais un raccourci.
- Ignorées : touches pendant une composition IME ; touches quand un dialogue modal est ouvert (confirmation de fermeture, dialogues d'Excalidraw). La palette n'est pas un dialogue au sens de cette règle : ouverte, elle reçoit Ctrl+P et Ctrl+Maj+P pour changer de mode (§7.1).
- La répétition automatique (touche maintenue) est permise pour Ctrl+Tab et Ctrl+Maj+Tab, ignorée pour les autres.

### 6.3 Terminal suivant / précédent

- Parcourt les terminaux du workspace affiché, y compris arrêtés et en démarrage ; pas les orchestrateurs (Ctrl+P les trouve).
- Ordre (`terminalOrder`, fonction pure sur les éléments de la scène, rotation ignorée) :
  1. **Blocs** : chaque cadre (de groupe ou de dessin) contenant au moins un terminal ; ses membres sont les terminaux dont le `frameId` est ce cadre.
  2. Les blocs sont rangés en **ordre de lecture**, puis, dans chaque bloc, ses membres en ordre de lecture.
  3. Viennent ensuite les terminaux **isolés** (sans cadre), en ordre de lecture.
- **Ordre de lecture** : les éléments sont pris par haut croissant et répartis en lignes ; un élément rejoint la ligne en cours si sa hauteur chevauche celle du premier élément de la ligne sur au moins la moitié de la plus petite des deux hauteurs, sinon il ouvre une nouvelle ligne. Dans une ligne, de gauche à droite. Exemple :

  ```
  ┌ Backend ──────────────┐   ┌ Front ──────┐
  │ ① Isis    ② Thot      │   │ ⑤ Horus     │
  │ ③ Anubis  ④ Osiris    │   │ ⑥ Bastet    │
  └───────────────────────┘   │ ⑦ Sekhmet   │
                              └─────────────┘
  ┌ Tests ──────┐
  │ ⑧ Ptah      │      ⑨ Ra (isolé)
  └─────────────┘
  ```

  Backend et Front se chevauchent : même ligne, Backend d'abord. Tests ne chevauche ni l'un ni l'autre : ligne suivante. Ra, isolé, vient après tous les blocs même s'il est à la hauteur de Tests.
- **Point de départ** : le terminal qui a le clavier ; sinon le dernier terminal du workspace affiché à l'avoir eu, s'il existe encore ; sinon aucun — Ctrl+Tab va alors au premier, Ctrl+Maj+Tab au dernier.
- Après le dernier, Ctrl+Tab revient au premier ; avant le premier, Ctrl+Maj+Tab va au dernier.

### 6.4 Arrivée sur un terminal

Commune à Ctrl+Tab, Ctrl+Maj+Tab et Ctrl+P (§7.2) :

1. **Vue** : si le zoom est de 100 % et que le rectangle du terminal tient entièrement dans la zone utile, la vue ne bouge pas. Sinon elle centre le terminal à 100 % (`fullSizeView`, comme le panneau Flotte). La zone utile est la surface du canvas moins la rangée du haut (56 px) et moins le bloc du bas (puces et barre de commande), mesurés à l'écran.
2. **Clavier** : le terminal est mis dans l'état d'un clic dans son corps — actif dans Excalidraw, xterm a le focus, on peut écrire aussitôt. Il n'est pas sélectionné (le déplacement reste à la prise par l'en-tête).
3. **Signal** : la bordure du terminal passe à `--ov-accent` puis revient à sa couleur en 600 ms (fondu). Un terminal qui attend garde sa lueur ambre ; le signal s'y superpose.

Le panneau Flotte garde son comportement (« Centrer » centre toujours, spec habillage §5.5).

### 6.5 Rendre la main au canvas (Maj+Échap)

- Le terminal (ou le champ) qui a le clavier le perd ; le terminal actif est désactivé ; aucune sélection n'est créée ; le clavier va au canvas : les raccourcis d'Excalidraw agissent de nouveau.
- Sans effet visible si le canvas avait déjà le clavier.

### 6.6 Vue d'ensemble (Ctrl+Maj+A)

- La vue s'ajuste, avec animation et une marge de 10 %, pour montrer tous les nœuds du workspace affiché (terminaux, orchestrateurs) et leurs cadres de groupe. Sans aucun nœud : toute la scène, comme « Ajuster » du rail gauche.
- Puis le clavier revient au canvas (§6.5).

## 7. Palette

### 7.1 Forme et modes

- Fenêtre flottante en haut au centre, à 64 px du haut, largeur 560 px (au plus la largeur de la fenêtre moins 32 px), fond `--ov-surface-2`, bord `--ov-line`, rayon 16, ombre des popovers. Pas de voile sur le reste de l'application.
- Un champ, puis la liste des résultats par sections (libellés en majuscules, comme les menus), hauteur au plus 420 px, défilable ; ligne survolée ou choisie au clavier sur `--ov-selected`. Pied : « ↑↓ naviguer · Entrée ouvrir · Échap fermer » en `--ov-text-2`.
- **Deux modes** du même champ :
  - **Aller à** (Ctrl+P) : champ vide, invite « Aller à un terminal, un groupe, un workspace… (> pour les fonctions) ».
  - **Fonctions** (Ctrl+Maj+P) : champ prérempli par `> `, invite « Rechercher une fonction… ».
  - Le mode suit le champ : texte commençant par `>` → Fonctions, sinon Aller à. Palette ouverte, Ctrl+P et Ctrl+Maj+P basculent de mode en conservant la recherche.
- **Recherche** : insensible à la casse et aux accents (« hermes » trouve Hermès) ; approximative (lettres dans l'ordre, pas forcément contiguës), les correspondances en début de mot d'abord ; à égalité, celle qui couvre la plus grande part du libellé (« renommer » : Renommer avant Renommer le workspace). Chaque élément porte des mots-clés en plus de son libellé (agent, groupe, workspace pour un terminal ; par exemple « isis cl » trouve Isis, agent Claude).
- Avec une recherche, la section qui contient la meilleure correspondance passe en tête (amendement après J8b : sinon « pause » choisissait « Masquer le panneau Agents », section Navigation, avant « Mettre en pause » du terminal) ; sans recherche, les sections gardent leur ordre.
- La première ligne est choisie à l'ouverture et après chaque frappe. Entrée exécute la ligne choisie ; la palette se ferme avant l'exécution.
- **Échap** ou clic hors de la palette : fermeture ; le clavier revient là où il était à l'ouverture (terminal, orchestrateur, champ ou canvas).

### 7.2 Aller à (Ctrl+P)

Dans un projet, sur tous ses workspaces, par sections et dans cet ordre :

| Section | Ligne | Entrée |
|---|---|---|
| Terminaux | logo de l'agent dans sa teinte, prénom, agent en gris, groupe (point de couleur du rôle), workspace s'il n'est pas celui affiché, pastille d'état (spec habillage §7.2) | arrivée (§6.4) |
| Groupes | point de couleur, nom, « 4 agents », workspace s'il n'est pas celui affiché | la vue s'ajuste sur le cadre (zoom au plus 100 %), clavier au canvas |
| Orchestrateurs | icône réseau, nom, « relié à 3 », workspace s'il n'est pas celui affiché | vue comme l'arrivée (§6.4, point 1), curseur dans son champ de consigne |
| Workspaces | nom, nombre d'agents vivants, « affiché » pour l'onglet courant | bascule sur l'onglet |
| Projets | les autres projets : nom, chemin en Geist Mono | ouvre le projet |

- **Ordre sans recherche** : terminaux du workspace affiché dans l'ordre de Ctrl+Tab, puis ceux des autres workspaces dans l'ordre des onglets (chacun dans l'ordre de Ctrl+Tab) ; même règle pour groupes et orchestrateurs ; workspaces dans l'ordre des onglets ; projets du plus récemment ouvert au plus ancien. Avec une recherche, le classement de pertinence prime dans chaque section, et la section de la meilleure correspondance passe en tête (§7.1).
- **Autres workspaces** : à l'ouverture de la palette, la scène de chaque workspace du projet est lue par le cache de scènes existant (`loadScene` : une lecture SQLite par workspace et par session, comme une visite de l'onglet). Les lignes apparaissent au fil des chargements ; une ligne « Chargement… » discrète signale ceux en cours.
- **Élément d'un autre workspace** : la palette bascule sur son onglet, attend que sa scène soit chargée à l'écran, puis exécute l'arrivée.
- **À l'accueil** : seulement la section Projets.

### 7.3 Fonctions (Ctrl+Maj+P)

- Chaque ligne : libellé, et à droite son raccourci en Geist Mono gris (« Ctrl+Maj+A »). Les touches à une lettre d'Excalidraw sont affichées pour les outils de dessin ; elles agissent quand le canvas a le clavier.
- Une fonction indisponible dans le contexte n'est pas listée. Le contexte est pris à l'ouverture de la palette : écran (accueil ou projet), workspace affiché, **terminal courant** (celui qui avait le clavier à l'ouverture, à défaut le dernier du workspace affiché à l'avoir eu) et son groupe.
- **Récentes** (amendement après J8b) : les 3 dernières fonctions lancées depuis la palette (hors « Aller à… »), gardées d'un lancement à l'autre, forment une première section « Récentes », la plus récente d'abord, chaque ligne suivie de sa section d'origine (« Renommer · Terminal · Isis ») ; Ctrl+Maj+P puis Entrée relance donc la dernière. Pendant une recherche, une fonction récente reste en tête si chaque mot tapé commence un de ses mots (pas pour une correspondance lâche). Elles ne sont pas répétées plus bas.

| Section | Fonctions | Condition |
|---|---|---|
| Navigation | Terminal suivant, Terminal précédent, Aller à…, Vue d'ensemble, Rendre la main au canvas, Ajuster à la scène, Zoom 100 %, Écrire une consigne (curseur dans la barre de commande), Afficher / Masquer le panneau Flotte, Accueil, Fermer le projet | projet ouvert (Aller à : toujours) |
| Workspaces | Nouveau workspace, Renommer le workspace (renommage dans l'onglet), Supprimer le workspace (confirmation existante) | projet ouvert ; Supprimer : pas le dernier workspace |
| Agents | Lancer Claude, Codex, Gemini, Qwen Code, Cursor, OpenCode, Aider, Ollama, Shell ; Lancer un agent personnalisé… (ouvre le menu Agent) ; Nouvelle console ; Lancer 4 agents ; Orchestrateur ; Composer un groupe… ; Tout mettre en pause ; Tout reprendre | projet ouvert |
| Terminal · <prénom> | Renommer, Dupliquer, Relancer, Arrêter le processus, Mettre en pause, Reprendre, Fermer | un terminal courant ; Arrêter : processus vivant ; Mettre en pause / Reprendre : mêmes règles que le survol du panneau Flotte |
| Groupe · <nom> | Renommer le groupe, Ajouter un agent… (ouvre le menu du groupe), Relier un orchestrateur, Dégrouper, Fermer le groupe | le terminal courant est membre d'un groupe |
| Dessin | Sélection, Rectangle, Ellipse, Losange, Ligne, Flèche, Cadre, Texte, Stylo, Gomme, Image, Annuler, Rétablir | projet ouvert |
| Scène | Exporter la scène…, Importer une scène…, Exporter en PNG… | projet ouvert |
| Projets | Ajouter un projet | accueil |
| Fenêtre | Réduire, Agrandir / Restaurer (selon l'état), Fermer dummyPlane | toujours |
| Aide | À propos d'dummyPlane | toujours |

- **Comportement** : chaque fonction fait exactement ce que fait déjà son bouton, sa puce ou son entrée de menu (mêmes dialogues de confirmation, mêmes toasts). Les lancements d'agent posent au centre de la vue avec la règle de « Nouvelle console » (dans le groupe sous le centre de la vue s'il y en a un, spec habillage §11.3), avec les options par défaut du menu Agent ; un agent non détecté apparaît comme dans le menu Agent. Un outil de dessin choisi rend le clavier au canvas.

## 8. Architecture front

| Fichier | Rôle |
|---|---|
| `src/commands/registry.ts` | Type `Command` (identifiant, libellé, section, mots-clés, raccourci, `available(ctx)`, `run(ctx)`) et liste des fonctions de §7.3 ; type du contexte. |
| `src/commands/shortcuts.ts` | `shortcutOf(event)` (pure) : combinaison reconnue ou rien, règles de §6.2 ; installation de l'écouteur global. |
| `src/commands/goTo.ts` | Éléments d'« Aller à » à partir des magasins et des scènes (pure). |
| `src/commands/search.ts` | Normalisation (casse, accents) et score de recherche (pur). |
| `src/commands/Palette.tsx` | La palette (`cmdk`), ses deux modes, le retour du clavier à la fermeture. |
| `src/canvas/terminalOrder.ts` | Ordre de lecture par blocs (pur). |
| `src/canvas/arrive.ts` | Arrivée : décision de vue (pure, `needsMove`), activation, focus, signal ; arrivée différée sur un autre workspace. |
| `src/shell/WindowControls.tsx` | Boutons de fenêtre et suivi de l'état agrandi. |
| `src/shell/DragStrip.tsx` | Bande de déplacement (projet et accueil). |
| `src/app/windowTitle.ts` | Titre de fenêtre (`titleFor(project)` pur + abonnement). |

- `uiStore` reçoit l'état de la palette (ouverte, texte) et l'arrivée en attente (`{ workspaceId, nodeId }`), consommée par le canvas une fois la scène du workspace chargée.
- Le terminal qui a eu le clavier en dernier, par workspace, est suivi par un écouteur `focusin` (registre des terminaux).
- Les boutons, puces et menus existants appellent les mêmes fonctions que le registre quand elles y sont extraites ; aucune action n'est dupliquée.

## 9. Gestion des erreurs

- Une fonction qui échoue affiche un toast « <Action> impossible : <raison> », comme les menus actuels.
- Arrivée différée dont la cible a disparu (fermée entre-temps) : toast « Isis n'existe plus ».
- Scène d'un workspace illisible à l'ouverture de la palette : ses éléments manquent, toast « Workspace <nom> illisible ».
- Échec d'une action de fenêtre (réduire, agrandir) : rien d'autre que le toast.

## 10. Jalons

| Jalon | Contenu | Vérification de Mathieu |
|---|---|---|
| J6 Fenêtre et livraison | §4, §5 | installer, lancer depuis le menu Démarrer : pas de console, orbe, titre ; déplacer, double-clic, ancrer, redimensionner, boutons |
| J7 Clavier | §6 | Ctrl+Tab et Ctrl+Maj+Tab dans un workspace à groupes en blocs, depuis un terminal Claude Code en train d'écrire ; Maj+Échap puis R dessine ; Ctrl+Maj+A |
| J8 Palette | §7 | Ctrl+P « tho » Entrée ; un terminal d'un autre workspace ; un groupe, un orchestrateur, un projet ; Ctrl+Maj+P : lancer un agent, mettre en pause, exporter ; Ctrl+P n'imprime pas |

Chaque jalon a son plan et se livre par un nouvel installateur.

## 11. Tests

### Automatisés

- `shortcutOf` : chaque raccourci de §6.1 ; P en AZERTY (`key` « p » avec `code` « KeyP ») ; Maj qui met la lettre en majuscule ; Alt / AltGr exclus ; composition IME ignorée ; répétition permise pour Ctrl+Tab seulement.
- `terminalOrder` : l'exemple de §6.3 ; deux blocs de hauteurs différentes qui se chevauchent à moitié (même ligne) et moins (lignes distinctes) ; isolés après les blocs ; cadre de dessin traité comme un bloc ; suivant / précédent avec retour au début et à la fin ; départ sans terminal courant.
- `needsMove` : zoom 100 % et terminal entièrement dans la zone utile → pas de mouvement ; partiellement sous la rangée du haut, sous le bloc du bas, hors écran, ou zoom différent → mouvement.
- Éléments d'« Aller à » : sections, ordre sans recherche, workspace affiché d'abord, mention du workspace seulement pour les autres, seulement les projets à l'accueil.
- Recherche : casse, accents, lettres non contiguës, priorité au début de mot, mots-clés.
- Registre : disponibilité de chaque section selon le contexte (accueil, projet sans terminal, terminal courant hors groupe, dans un groupe, processus arrêté) ; aucun identifiant ni raccourci en double.
- `titleFor` : accueil, projet, renommage.

### Vérifications manuelles (Mathieu)

Celles des jalons (§10), plus : les raccourcis depuis un terminal Codex et depuis un shell PowerShell ; la palette ouverte par-dessus un terminal qui attend (ATTEND) n'envoie rien à l'agent.

## 12. Risques

1. **Raccourcis de WebView2** : si `preventDefault` ne suffit pas à bloquer Ctrl+P (impression) ou un autre raccourci du navigateur, les raccourcis de navigateur de WebView2 sont désactivés côté Rust (`AreBrowserAcceleratorKeysEnabled = false`). Cela coupe aussi F5 (rechargement) et Ctrl+F (recherche du navigateur), ce qui convient à une application.
2. **Redimensionnement sans décorations** : si les bords ne redimensionnent pas, des poignées invisibles de 6 px sont ajoutées sur les bords et les coins (`startResizeDragging`).
3. **Deux instances** : la version installée et un ancien exécutable autonome (`j5`) partagent la base `dev.dummyplane.app` ; lancés ensemble, ils relanceraient deux fois les agents. Ne jamais les faire tourner ensemble ; supprimer les anciens exécutables après validation.
4. **Bande de déplacement** : les étiquettes de groupe et en-têtes de terminaux qui passent sous la rangée du haut n'y sont pas cliquables ; on fait défiler le canvas.
5. **Focus perdu à l'ouverture de la palette** : la palette prend le clavier ; le terminal courant est donc retenu à l'ouverture (§7.3) et le clavier lui est rendu à la fermeture.

## 13. Conventions

- Interface en français ; libellés des raccourcis avec « Ctrl », « Maj », « Échap », « Tab », « Entrée ».
- Commits en anglais au format conventionnel, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Dépendance ajoutée à version exacte : `cmdk`.
