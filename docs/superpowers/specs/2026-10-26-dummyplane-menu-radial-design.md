# dummyPlane — Menu radial au clic droit (spec)

- **Date** : 2026-10-26
- **Statut** : validée en brainstorming par Mathieu, en attente de relecture écrite
- **Étend** : `docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md` (« spec fenêtre », registre de fonctions et palette) et `docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md` (« spec identité »). Tout ce que cette spec ne modifie pas reste régi par elles.
- **Référence** : l'image montrée par Mathieu le 2026-10-25 (8 boutons ronds autour d'un × central, ouverts sur la grille de points). dummyPlane en fait sa propre version, à son identité (mémoire « dummyPlane identité propre »).

## 1. Objectif

Atteindre les actions courantes d'un clic, là où se trouve la souris, sans traverser l'écran jusqu'aux rails : un clic droit ouvre sous le curseur un anneau de 8 boutons, propre à ce qui est dessous (fond du canvas, terminal, groupe, orchestrateur, dessin).

### Critère de succès

1. Clic droit sur le fond, « Lancer Claude » : Claude apparaît là où Mathieu a cliqué.
2. Clic droit maintenu sur un terminal, glisser vers le bas, relâcher : la fermeture est demandée (« Fermer Isis ? »).
3. Clic droit sur un rectangle, « Supprimer » ; sur un autre, « Plus… » : le menu complet d'Excalidraw s'ouvre au même endroit.
4. Chaque bouton fait exactement ce que fait la même fonction dans la palette (Ctrl+Maj+P) ou le bouton correspondant.

## 2. Périmètre

### Inclus

- L'anneau sur le canvas et dans les nœuds (terminaux, orchestrateurs) et les étiquettes de groupe ; ses cinq contenus (§4) ; ses deux gestes (§5.2).
- Le menu natif d'Excalidraw ne s'ouvre plus de lui-même ; il reste atteignable par « Plus… ».
- Les fonctions nouvelles que l'anneau demande, ajoutées au registre (donc aussi à la palette) : §6.2.
- La création au point du clic pour les fonctions qui créent.

### Hors périmètre

- Sous-anneaux, anneaux personnalisables, plus de 8 boutons.
- Navigation de l'anneau au clavier (la palette est la voie clavier).
- Clic droit hors du canvas (onglets, panneau Agents, rails, barre de commande) : leurs menus actuels restent.
- Tactile et stylet.

## 3. Décisions

| Sujet | Décision |
|---|---|
| Contenu | Selon ce qui est sous la souris : fond, terminal, groupe, orchestrateur, dessin ou sélection (§4). |
| Menu natif d'Excalidraw | Remplacé par l'anneau ; le 8e bouton de l'anneau des dessins, « Plus… », ouvre le menu complet au même endroit. |
| Terminal | L'anneau s'ouvre aussi dans le texte du terminal ; Copier et Coller sont parmi ses boutons. Les raccourcis clavier de copie et de collage du terminal sont inchangés. |
| Libellés | Icônes seules ; le nom du bouton survolé (ou la raison d'un bouton grisé) dans une pastille sous l'anneau. |
| Gestes | Les deux : clic droit bref puis clic gauche ; ou clic droit maintenu, glisser vers un bouton, relâcher. |
| Visée | dummyPlane décide à l'appui du bouton droit, partout, sans attendre Excalidraw (Windows ne déclenche `contextmenu` qu'au relâcher). |
| Une fonction, une commande | Chaque bouton est une commande du registre (spec fenêtre §3) : le bouton, la ligne de palette et l'entrée de l'anneau ne divergent jamais. |
| Positions | Fixes pour chaque anneau ; une fonction indisponible reste à sa place, grisée. |

## 4. Les anneaux

Positions lues dans le sens des aiguilles d'une montre depuis le haut : ↑ ↗ → ↘ ↓ ↙ ← ↖. « (rouge) » : icône en `--ov-danger`. Ce qui crée apparaît au point du clic (§6.3).

### 4.1 Fond du canvas

| ↑ | ↗ | → | ↘ | ↓ | ↙ | ← | ↖ |
|---|---|---|---|---|---|---|---|
| Lancer <agent par défaut> | Lancer Shell | Lancer 4 agents | Orchestrateur | Coller | Texte | Autre agent… | Vue d'ensemble |
| icône de l'agent | `Terminal` | `Layers` | `Network` | `ClipboardPaste` | `Type` | `Plus` | `Scan` |

- **Lancer <agent par défaut>** : l'agent par défaut du menu Agent (`defaultAgent`, Claude quand il est installé), avec son icône et son nom (« Lancer Claude ») ; la position porte la fonction « Lancer <agent> » de cet agent, résolue à l'ouverture.
- **Lancer Shell** : un shell nu (PowerShell). « Nouvelle console » lance l'agent par défaut (spec habillage §5.6) et ferait doublon avec ↑ (amendement à l'écriture du plan G1).
- **Texte** : un texte commence au point du clic, en édition, comme un double-clic sur le canvas.
- **Autre agent…** : ouvre le menu Agent du rail d'outils ; l'agent choisi est lancé au point du clic, sans passer par le mode pose. Ollama et la commande personnalisée gardent leur sous-panneau.
- **Coller** : ce que contient le presse-papiers, posé au point du clic (dessins copiés, texte, image).
- **Vue d'ensemble** : la fonction de Ctrl+Maj+A.

### 4.2 Terminal (en-tête ou texte)

| ↑ | ↗ | → | ↘ | ↓ | ↙ | ← | ↖ |
|---|---|---|---|---|---|---|---|
| Copier | Coller | Renommer | Relancer | Fermer (rouge) | Dupliquer | Mettre en pause / Reprendre | Arrêter le processus |
| `Copy` | `ClipboardPaste` | `Pencil` | `RotateCw` | `X` | `CopyPlus` | `Pause` / `Play` | `Square` |

- **Copier** : la sélection du terminal ; grisé « aucune sélection » sans sélection.
- **Coller** : le texte du presse-papiers, collé dans le terminal comme par Ctrl+V (collage encadré).
- **Mettre en pause / Reprendre** : « Mettre en pause » quand l'agent travaille, « Reprendre » quand il est prêt, grisé sinon (règles de `canPause` / `canResume`).
- Renommer, Relancer, Fermer, Dupliquer, Arrêter le processus : les fonctions « Terminal · <prénom> » de la palette (spec fenêtre §7.3), appliquées au terminal visé.

### 4.3 Groupe (son étiquette, ou un endroit vide de son cadre)

| ↑ | ↗ | → | ↘ | ↓ | ↙ | ← | ↖ |
|---|---|---|---|---|---|---|---|
| Ajouter un agent… | Renommer le groupe | Relier un orchestrateur | Mettre le groupe en pause | Fermer le groupe (rouge) | Dégrouper | Reprendre le groupe | Cadrer le groupe |
| `UserPlus` | `Pencil` | `Network` | `Pause` | `X` | `Ungroup` | `Play` | `Focus` |

- Les fonctions « Groupe · <nom> » de la palette, appliquées au groupe visé, plus :
- **Mettre le groupe en pause** / **Reprendre le groupe** : ce que font « Tout mettre en pause » et « Tout reprendre » du menu du groupe, pour ses membres.
- **Cadrer le groupe** : la vue cadre le groupe (`focusGroup`).

### 4.4 Orchestrateur

| ↑ | → | ↓ | ← | ↖ |
|---|---|---|---|---|
| Écrire une consigne | Renommer | Supprimer (rouge) | Relier | Coller |
| `MessageSquare` | `Pencil` | `Trash2` | `Link` | `ClipboardPaste` |

- Les positions ↗ ↘ ↙ restent vides.
- **Écrire une consigne** : le curseur dans le champ de l'orchestrateur. **Relier** : son mode « Relier ». **Coller** : le presse-papiers dans son champ. **Supprimer** : comme sa croix.

### 4.5 Dessin ou sélection

| ↑ | ↗ | → | ↘ | ↓ | ↙ | ← | ↖ |
|---|---|---|---|---|---|---|---|
| Copier | Coller | Dupliquer | Premier plan | Supprimer (rouge) | Arrière-plan | Verrouiller / Déverrouiller | Plus… |
| `Copy` | `ClipboardPaste` | `CopyPlus` | `BringToFront` | `Trash2` | `SendToBack` | `Lock` / `LockOpen` | `Ellipsis` |

- S'applique à la sélection d'Excalidraw. Un clic droit sur un dessin hors de la sélection le sélectionne seul d'abord (comme Excalidraw) ; un clic droit dans la sélection la garde.
- Une sélection qui contient des agents en cours passe par le garde des fermetures (spec habillage §7.5, amendement après J8b) : « Fermer 2 agents ? ».
- **Verrouiller / Déverrouiller** : selon l'état de la sélection.
- **Plus…** : ferme l'anneau et ouvre le menu complet d'Excalidraw au point du clic, pour la même sélection.

## 5. Apparence et interaction

### 5.1 Apparence

- Boutons ronds de 44 px en verre sombre (`ov-glass-strong`), icône Lucide de 18 px en `--ov-text`, centres répartis sur un cercle de 84 px de rayon autour du point du clic.
- Au centre, un disque de 32 px, × en `--ov-text-2` : le cliquer ferme.
- Survol (ou bouton visé par le geste) : contour 1 px `--ov-accent`, fond `--ov-accent-soft`, agrandissement à 106 %.
- Grisé : opacité 40 %, sans survol.
- Pastille sous l'anneau (verre, 12 px, `--ov-text`) : le nom du bouton survolé ou visé ; pour un bouton grisé, « <nom> · <raison> » (« Copier · aucune sélection »). Rien quand aucun bouton n'est visé.
- Ouverture : fondu et échelle de 85 % à 100 % en 120 ms ; sans animation quand Windows réduit les animations (`prefers-reduced-motion`).
- Près d'un bord de la fenêtre, l'anneau (pastille comprise) se décale pour rester entier, à 8 px du bord ; ce qui est créé l'est toujours au point du clic.
- Les icônes sont celles des tableaux de §4 (Lucide, version du projet).

### 5.2 Gestes

- **Ouverture** : à l'appui du bouton droit (`pointerdown`, bouton 2) au-dessus du canvas, d'un nœud ou d'une étiquette de groupe, ce qui est dessous décidé à cet instant (§6.4).
- **Clic bref** : relâché à moins de 6 px de l'appui, l'anneau reste ouvert ; un clic gauche sur un bouton l'exécute.
- **Glisser** : bouton droit tenu au-delà de 6 px, le bouton visé est celui de la direction du pointeur (huitièmes de cercle centrés sur chaque position), dès 24 px du centre ; relâcher exécute le bouton visé. Relâcher à moins de 24 px du centre après avoir glissé ferme sans rien faire. Une position vide ou grisée visée n'exécute rien. Anneau décalé d'un bord : rien n'est visé non plus à moins de 24 px du point d'appui (un tremblement n'exécute rien) ; au-delà, la direction se lit depuis le centre de l'anneau affiché (relecture finale du plan G1).
- **Fermeture** : Échap, le ×, un clic gauche hors de l'anneau, la molette. Un clic droit ailleurs, anneau ouvert, le rouvre là.
- Un bouton exécuté ferme l'anneau avant d'exécuter sa commande (comme la palette, spec fenêtre §7.1).
- Un appui sur l'anneau laisse le clavier où il était : après « Coller » dans un terminal, Entrée va au terminal. Le `contextmenu` qui suit un relâcher traité par l'anneau est absorbé, même hors du canvas : WebView2 n'ouvre pas son menu de page après un glisser (relecture finale du plan G1).
- **Inchangés** : en mode pose et en mode « Relier », le clic droit annule le mode ; dans un champ de texte (renommage, barre de commande, champ d'un orchestrateur, palette), le clic droit garde son comportement (le texte du terminal n'est pas un champ de texte au sens de cette règle).
- Ni anneau ni menu natif tant qu'un dialogue ou la palette est ouvert.

## 6. Architecture

### 6.1 Contexte des commandes

`CommandContext` (spec fenêtre §8) reçoit trois champs facultatifs :

- `at` : le point du clic, en coordonnées de scène ;
- `groupId` : le groupe visé (sinon celui du terminal courant, comme aujourd'hui) ;
- `orchestratorId` : l'orchestrateur visé.

L'anneau construit le contexte de sa cible : `terminalId` est le terminal visé, `groupId` le groupe visé, etc. Les fonctions « Terminal · <prénom> » et « Groupe · <nom> » existantes servent telles quelles. La palette ne remplit pas ces champs : son comportement ne change pas.

### 6.2 Fonctions nouvelles du registre

| Section | Fonctions | Condition |
|---|---|---|
| Terminal · <prénom> | Copier, Coller | terminal courant ; Copier : grisé sans sélection |
| Groupe · <nom> | Mettre le groupe en pause, Reprendre le groupe, Cadrer le groupe | groupe courant |
| Orchestrateur · <nom> | Écrire une consigne, Renommer, Relier, Coller, Supprimer | orchestrateur visé (anneau seulement) |
| Agents | Autre agent… | projet ouvert |
| Dessin | Copier, Coller, Dupliquer, Premier plan, Arrière-plan, Verrouiller / Déverrouiller, Supprimer, Plus… | projet ouvert ; sélection non vide sauf Coller ; Plus… : anneau seulement |
| Agents (existantes) | Lancer <agent>, Nouvelle console, Lancer 4 agents, Orchestrateur | inchangées ; créent à `at` quand il est donné |

- `launchAt`, `newConsole`, `launchFour`, `placeOrchestrator` acceptent un point facultatif ; sans point, le centre de la vue, comme aujourd'hui.
- Les fonctions marquées « anneau seulement » ne sont pas listées par la palette (leur `available` demande la cible ou le point).

### 6.3 Ponts vers Excalidraw

- **Dupliquer, Premier plan, Arrière-plan, Verrouiller, Supprimer** : les raccourcis d'Excalidraw (Ctrl+D, Ctrl+Maj+], Ctrl+Maj+[, Ctrl+Maj+L, Suppr), envoyés à son conteneur comme « Annuler » (plan F2).
- **Copier / Coller (dessins)** : les évènements `copy` et `paste` d'Excalidraw, le presse-papiers du système lu et écrit par l'application ; le collage se fait au point du clic.
- **Lecture du presse-papiers** : sans Ctrl+V, WebView2 la soumet à son invite (« tauri.localhost souhaite voir le texte et les images copiés… »). Choix de Mathieu à la vérification : la fenêtre principale est créée par l'application avec l'accès au presse-papiers de Tauri (`enable_clipboard_access`), sans invite et sans dépendance ajoutée.
- **Texte** : un double-clic synthétique au point du clic, après avoir pris l'outil de sélection et vidé la sélection (le double-clic d'Excalidraw n'écrit qu'avec cet outil et recadre une image seule sélectionnée).
- **Plus…** : la cible sélectionnée, un `contextmenu` synthétique au point du clic, marqué pour que l'écouteur de l'anneau le laisse passer.
- **Terminal** : Copier reprend la sélection d'xterm (comme ses raccourcis) ; Coller lit le presse-papiers et le colle dans xterm.
- Chaque pont est vérifié dans l'application réelle (profil de sonde, port de débogage de WebView2) dès la première tâche du plan ; un pont qui ne tient pas est soumis à Mathieu avant la suite.

### 6.4 Visée (pure)

Dans l'ordre :

1. Champ de texte (hors texte d'un terminal) : pas d'anneau.
2. Dans un terminal (`[data-terminal]`) : terminal. Dans un orchestrateur : orchestrateur. Sur une étiquette de groupe : groupe.
3. Sur le canvas, dans le cadre englobant de la sélection courante (non vide) : sélection.
4. Le dessin le plus haut sous le point : contour (pivoté) pour les formes, texte et images ; distance au tracé, à quelques pixels près à l'écran, pour lignes, flèches et traits de stylo. Comme le clic droit d'Excalidraw : le libellé d'une forme vise la forme, un dessin d'un groupe (Ctrl+G) vise tout son groupe le plus large.
5. Dans le cadre d'un groupe, sans membre ni dessin dessous : groupe. Dans un cadre ordinaire : dessin (le cadre). Le nom qu'Excalidraw dessine au-dessus d'un cadre compte comme ce cadre (l'étiquette d'un groupe, sinon le cadre).
6. Sinon : fond du canvas.

### 6.5 Fichiers

| Fichier | Rôle |
|---|---|
| `src/radial/rings.ts` | Les cinq anneaux : 8 positions, chacune un identifiant de commande et une icône (ou vide). |
| `src/radial/target.ts` | Visée (pure, §6.4). |
| `src/radial/gesture.ts` | Clic bref ou glisser, direction visée, zone morte, décalage aux bords (pur). |
| `src/radial/radialState.ts` | Magasin : ouvert, point écran, point de scène, cible, geste en cours. |
| `src/radial/RadialMenu.tsx` | L'anneau, sa pastille, ses fermetures. |
| `src/radial/install.ts` | Écouteurs en capture sur `window` : appui droit (ouverture, glisser), `contextmenu` bloqué hors passage marqué. |
| `src/radial/bridges.ts` | Ponts vers Excalidraw (§6.3). |
| `src/commands/catalog/*.ts` | Fonctions nouvelles (§6.2). |

## 7. Gestion des erreurs

- Une fonction qui échoue : le toast habituel « <Action> impossible : <raison> » (spec fenêtre §9).
- Presse-papiers vide : toast « Presse-papiers vide » ; lecture refusée : « Lecture du presse-papiers impossible ».
- Cible disparue entre l'ouverture et le clic : la commande est réévaluée au clic ; indisponible, rien ne se passe et l'anneau se ferme.
- Changement de workspace ou de projet, dialogue qui s'ouvre : l'anneau se ferme.

## 8. Jalon

| Jalon | Contenu | Vérification de Mathieu |
|---|---|---|
| J9 Menu radial | §4 à §7 | Les critères de §1.1 ; Copier puis Coller dans un terminal et entre deux dessins ; « Autre agent… » lance Codex au point du clic ; un anneau près d'un bord |

Un plan (G1), livré par une copie de test `dummyPlane-J9.exe`.

## 9. Tests

### Automatisés

- Visée : chaque cible de §6.4 ; forme pivotée ; ligne fine (près et loin du tracé) ; clic dans la sélection ; cadre de groupe vide et occupé ; cadre ordinaire ; champ de texte.
- Geste : clic bref sous 6 px ; glisser ; les huit directions et leurs limites ; zone morte ; position vide ou grisée ; décalage aux quatre bords.
- Anneaux : chaque identifiant existe dans le registre, sans doublon, 8 positions au plus.
- Contextes : création au point ; fonctions de groupe sur le groupe visé ; Mettre en pause / Reprendre selon l'état.
- L'anneau : ouverture au point, grisé avec sa raison, pastille, Échap, ×, clic dehors, molette, relâcher après glisser, clic sur un bouton, `contextmenu` bloqué sauf « Plus… ».

### Dans l'application réelle (profil de sonde, port de débogage)

- Un anneau sur chaque cible, captures.
- Plus… ouvre le menu d'Excalidraw ; Copier / Coller (terminal, dessins) ; Texte au point ; lancement au point ; glisser.

### Vérifications manuelles (Mathieu)

Celles du jalon (§8).
