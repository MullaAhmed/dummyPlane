# dummyPlane V1 — Spécification de design

- **Date** : 2026-10-23
- **Statut** : validée en conversation, en attente de relecture écrite
- **Auteur** : Mathieu Kerbel (avec Claude)

## 1. Objectif

dummyPlane est une alternative open-source, auto-hébergée et *local-first* aux outils de productivité pour agents IA. C'est un tableau blanc infini sur lequel on dessine (style Excalidraw, avec les icônes des grands clouds) et sur lequel on instancie de **vrais terminaux locaux** pour faire tourner des agents CLI (Claude Code, Aider, Codex…), accompagnés de widgets (Notes, Kanban, Git Watcher).

### Critère de succès V1

Mathieu utilise dummyPlane **au quotidien sur Windows 11** (via `pnpm tauri dev` ou un installeur construit localement) pour piloter ses sessions Claude Code. La CI et les releases multi-OS viennent après la V1.

## 2. Périmètre

### Inclus en V1

- Canvas infini **Excalidraw** (dessin libre : formes, flèches, texte, crayon) avec **plusieurs workspaces**.
- **Nœud Terminal** : vrai PTY, lancement manuel (dossier + commande) assisté de préréglages ; reprise exacte des sessions Claude Code.
- **Nœud Note** (Markdown), **nœud Kanban**, **nœud Git Watcher**.
- **Liens entre nœuds** : un Git Watcher relié par une flèche à un terminal suit son dossier ; une carte Kanban ou une note glissée sur un terminal y est collée comme prompt.
- **Icônes cloud** AWS / Azure / GCP importées depuis les packs officiels, insérables dans les schémas.
- **Persistance SQLite** de tout l'espace de travail, scrollback des terminaux compris ; restauration des terminaux à l'état « arrêté ».

### Hors périmètre V1

- Nœud navigateur web.
- CI, installeurs multi-OS, mise à jour automatique.
- Gestion ou injection de clés API (les terminaux héritent de l'environnement).
- Détection d'agents au-delà de la présence dans le PATH.
- Suivi du `cd` en direct dans un terminal (on suit le dossier configuré).
- Envoi automatique de la touche Entrée après un collage.
- Collaboration, synchronisation multi-appareils.
- Correctif du PATH des apps graphiques macOS (Windows d'abord).

## 3. Stack technique

| Couche | Choix |
|---|---|
| Shell applicatif | Tauri 2 (≥ 2.5.1, correctif des messages binaires des Channels) |
| Backend | Rust : `portable-pty` (ConPTY sous Windows), `rusqlite` (feature `bundled`), `serde`, `thiserror`, `uuid`, `which`, `zip`, `tauri-plugin-dialog`, `tauri-plugin-log` |
| Frontend | React 19 (React 18 si la version d'Excalidraw retenue ne le supporte pas, vérifié au jalon 1), TypeScript strict, Vite, pnpm |
| Canvas | `@excalidraw/excalidraw` (MIT) — remplace React Flow, voir §15 |
| Terminaux | `@xterm/xterm` + addons `fit`, `webgl`, `unicode11`, `web-links` |
| UI | Tailwind CSS v4 + shadcn/ui (Radix), `lucide-react`, `sonner` (toasts) |
| État front | `zustand` |
| Markdown | `react-markdown` + `remark-gfm` |
| Tests | `cargo test`, Vitest |

**tldraw est écarté** : le SDK ne fonctionne en production qu'avec une clé de licence, la licence gratuite impose un filigrane, et chaque utilisateur d'un fork doit obtenir sa propre clé. Il n'est pas open-source.

## 4. Architecture et responsabilités

Chaque donnée a un seul propriétaire :

```
┌──────────────────────────── Webview (React) ────────────────────────────┐
│  Excalidraw ── géométrie : positions, tailles, dessins, flèches, icônes  │
│  Stores zustand ── contenu des nœuds (payloads), workspaces, réglages    │
│  Registre Xterm (hors React) ── instances de terminaux vivantes          │
└───────────────┬──────────────────────────────────────▲──────────────────┘
                │ invoke (commandes typées)             │ Channel binaire (sortie PTY)
                ▼                                       │ events (pty-exit)
┌──────────────────────────── Rust (Tauri) ───────────────────────────────┐
│  PtyManager ── processus, tampons de scrollback                          │
│  Db (SQLite) ── workspaces, scènes, nœuds, fichiers, scrollback, icônes  │
│  Git ── appels à git.exe     Icons ── import et index des packs          │
└──────────────────────────────────────────────────────────────────────────┘
```

- Le front ne contient **aucun SQL** : il passe par des commandes typées.
- La sortie des PTY passe par un **Channel Tauri 2 en binaire brut** : côté Rust `Channel<tauri::ipc::Response>` alimenté par `Response::new(bytes)`, côté JS un `Channel<ArrayBuffer>`. Le front accepte aussi un `number[]` par sécurité (régression corrigée en 2.5.1).
- Les events globaux ne servent qu'aux signaux ponctuels (`pty-exit`).

## 5. Terminaux

### 5.1 Lancement

- Rust ouvre un pseudo-terminal (`portable-pty`, ConPTY sous Windows) et lance **le shell de l'utilisateur, profil chargé** :
  - Windows : `powershell.exe -NoLogo` par défaut ; au choix `pwsh.exe -NoLogo` (si présent), `cmd.exe`, Git Bash (`bash.exe --login -i`).
  - Unix : `$SHELL -l`.
- Puis Rust écrit la commande du préréglage suivie de `\r` dans le PTY. Raisons : sous Windows, `claude` est un script `.cmd`/`.ps1` installé par npm, qu'on ne peut pas lancer directement sans shell ; et quand l'agent quitte, on retombe dans le shell.
- **Environnement** : hérité tel quel (`USERPROFILE`, `PATH`, etc.), plus `TERM=xterm-256color`, `COLORTERM=truecolor`, `DUMMYPLANE=1`, `DUMMYPLANE_NODE_ID=<id>`. Claude Code utilise donc la connexion et le dossier `~/.claude` existants (réglages, MCP, plugins, hooks).

### 5.2 Préréglages

`list_presets()` vérifie la présence de chaque outil dans le PATH (crate `which`, qui respecte `PATHEXT`) :

| Préréglage | Commande |
|---|---|
| Claude Code | voir §5.3 |
| Aider | `aider` |
| Codex | `codex` |
| Shell | aucune commande |
| Personnalisé | texte libre |

Un préréglage absent est grisé dans le dialogue de lancement.

### 5.3 Sessions Claude Code

Chaque nœud Claude reçoit un UUID `claudeSessionId` à sa création.

| Mode | Ligne de commande |
|---|---|
| Nouvelle session (premier lancement) | `claude --session-id <uuid> -n "<titre du nœud>"` |
| Reprendre la session (défaut de « Relancer ») | `claude --resume <uuid>` |
| Plus récente du dossier (secours) | `claude --continue` |
| Nouvelle session (depuis « Relancer ») | nouvel UUID, puis comme le premier lancement |

Limite connue : après un `/clear`, Claude change d'identifiant de session ; « Reprendre la session » revient alors à l'ancienne conversation. Le mode « Plus récente du dossier » couvre ce cas.

Les arguments sont échappés selon le shell (PowerShell, cmd, bash), avec des tests unitaires.

### 5.4 Fidélité attendue

Comme dans Windows Terminal :

- couleurs 24 bits, Unicode et emojis (addon `unicode11`), liens cliquables (`web-links`), souris, écran alternatif ;
- Ctrl+C copie s'il y a une sélection, sinon il envoie l'interruption ; Ctrl+V colle ;
- Shift+Entrée envoie `ESC+CR` (retour à la ligne dans Claude Code) ;
- Échap doit atteindre le processus (Claude Code s'en sert pour interrompre l'agent) ;
- redimensionner le nœud redimensionne le PTY.

### 5.5 Cycle de vie

- `pty_spawn` crée la session ; un thread lit le PTY en continu (lectures de 16 Kio), envoie chaque bloc au Channel et l'ajoute au tampon de scrollback.
- Un second thread attend la fin du processus, puis : vide le tampon en SQLite, émet `pty-exit {nodeId, exitCode}`.
- `pty_attach(nodeId, channel)` remplace le Channel d'une session vivante et renvoie d'abord le contenu du tampon. Cela couvre un rechargement de la webview sans tuer les agents.
- À la fermeture de l'app (`RunEvent::ExitRequested`) : tous les tampons sont écrits, puis tous les processus sont arrêtés.
- Changer de workspace **n'arrête pas** les terminaux : ils continuent en arrière-plan.

### 5.6 Scrollback

- Tampon circulaire de **512 Kio** par terminal, en mémoire côté Rust, avec un indicateur « modifié ».
- Un thread unique écrit en SQLite les tampons modifiés **toutes les 10 s** ; écriture aussi à la fin du processus et à la fermeture de l'app.
- Restauration : on rejoue le contenu **à partir du premier saut de ligne**, précédé de `ESC[0m`, pour ne jamais rejouer une séquence d'échappement coupée.

## 6. Canvas et nœuds

### 6.1 Disposition

- À gauche : barre latérale shadcn repliable (workspaces : créer, renommer, supprimer, réordonner ; badge du nombre de terminaux actifs).
- Le reste : Excalidraw, thème sombre. En haut à droite (`renderTopRightUI`) : menu **Insérer** (Terminal, Note, Kanban, Git Watcher) et bouton **Icônes cloud**.
- Les polices et ressources d'Excalidraw sont servies localement (`EXCALIDRAW_ASSET_PATH`), pour un fonctionnement hors ligne.
- La fenêtre Tauri a `dragDropEnabled: false` : sinon, sous Windows, Tauri capte tous les glisser-déposer et casse ceux du HTML.

### 6.2 Représentation d'un nœud

- Un nœud dummyPlane est un **élément intégré** (*embeddable*) Excalidraw avec :
  - `customData.kind` ∈ `terminal | note | kanban | git` ;
  - `link = "dummyplane://<kind>/<id>"`.
- `validateEmbeddable` n'accepte que les liens `dummyplane://` (aucune iframe arbitraire).
- L'`id` de l'élément Excalidraw est la clé du nœud dans la table `nodes`.
- `renderEmbeddable(element)` rend `<NodeHost>`, qui choisit le composant selon `customData.kind` et fournit un cadre commun : barre de titre éditable, indicateur d'état, actions.
- L'insertion crée l'élément au centre de la vue, avec une taille par défaut par type.

### 6.3 Activation

Excalidraw demande un clic pour activer un élément intégré. À l'activation d'un terminal : focus sur Xterm et recalage de la vue à 100 % centré sur le nœud (réglage `terminal.zoomOnActivate`, activé par défaut ; toujours actif tant que les réglages n'ont pas d'écran). Raison : au zoom ≠ 100 %, le texte Xterm devient flou et la sélection se décale.

### 6.4 Registre des terminaux

- Module hors React : `Map<nodeId, { term, fit, webgl?, channel, status }>`.
- Au montage de `TerminalNode` : si une entrée existe, on **déplace** l'élément DOM existant de Xterm dans le nouveau conteneur ; sinon on crée le terminal (`term.open`).
- Au démontage (élément hors écran, changement de workspace) : rien n'est détruit.
- Destruction uniquement à la suppression du nœud (§8.5) ou de son workspace.
- WebGL : on utilise l'addon `webgl` ; s'il perd son contexte (le navigateur en limite le nombre à environ 16), on le libère et Xterm repasse au rendu DOM.
- Redimensionnement : `ResizeObserver` → `fit` → `pty_resize`, après 50 ms d'attente.

### 6.5 Nœud Terminal

- **Dialogue de lancement** (à l'insertion) : sélecteur de dossier (`tauri-plugin-dialog`), préréglage, commande personnalisée, shell.
- **Barre de titre** : titre, préréglage, état (actif / arrêté / terminé avec code / erreur), actions **Relancer ▾** (Reprendre la session · Nouvelle session · Plus récente du dossier) et **Arrêter**.
- **Au chargement d'un workspace**, pour chaque terminal :
  - entrée présente dans le registre : réutilisée telle quelle ;
  - absente du registre mais présente dans `pty_list()` (cas d'un rechargement de la webview) : nouveau Xterm + `pty_attach` ;
  - sinon : affiché arrêté, avec son scrollback rejoué (`get_scrollback`) et un bandeau « Arrêté — Relancer ».

### 6.6 Nœud Note

- Zone de texte avec bascule vers un aperçu Markdown (`react-markdown` + `remark-gfm`).
- Poignée « ⇢ » dans la barre de titre, à faire glisser vers un terminal.

### 6.7 Nœud Kanban

- Colonnes et cartes (titre + description), ajout, renommage, suppression.
- Déplacement des cartes entre colonnes et vers un terminal avec le **glisser-déposer natif HTML** (pas de `dnd-kit`, incompatible avec le glisser-déposer natif).
- Une carte envoyée à un terminal produit le texte `titre\n\ndescription`.

### 6.8 Nœud Git Watcher

- Rust exécute `git -C <dossier> status --porcelain=v2 --branch -z` et `git -C <dossier> diff --numstat HEAD` (modifications indexées et non indexées ; sans `HEAD` dans un dépôt sans commit), avec le `git.exe` et la configuration Git de l'utilisateur.
- Rafraîchissement **toutes les 3 s**, uniquement si le nœud est monté et la fenêtre visible.
- Affichage : branche, avance/retard sur la branche distante, fichiers modifiés avec statut et lignes ajoutées/supprimées.
- Clic sur un fichier : `git_diff` (`git diff HEAD -- <fichier>`) → boîte de dialogue avec le diff coloré. Pour un fichier non suivi, la boîte affiche son contenu entièrement en ajout.
- **Dossier suivi** : si une flèche Excalidraw relie le Git Watcher à un terminal (`startBinding` / `endBinding`), on utilise le `cwd` de ce terminal et on affiche « Suit : <titre> ». Sinon, le dossier choisi à la main (`payload.path`).
- Cas d'erreur affichés dans le nœud : « Pas un dépôt Git » (avec sélecteur de dossier), « git introuvable ».

### 6.9 Glisser-déposer vers un terminal et sur le canvas

Problème : un élément intégré inactif ne reçoit pas les événements de la souris, et Excalidraw transforme tout texte déposé en élément texte.

Solution : **un intercepteur unique** en phase *capture* sur le conteneur du canvas, qui ne traite que nos types de données :

| Type | Origine | Effet du dépôt |
|---|---|---|
| `application/x-dummyplane-snippet` | carte Kanban, poignée de note | si un terminal est sous le point : `term.paste(texte)` puis focus ; sinon rien |
| `application/x-dummyplane-icon` | barre latérale des icônes | insertion de l'icône au point de dépôt |

- Position → coordonnées de scène via `viewportCoordsToSceneCoords`, puis recherche du terminal le plus haut contenant le point.
- Pendant le survol (`dragover`), le terminal visé est surligné.
- `term.paste()` utilise le *bracketed paste* quand le programme l'a activé : un texte sur plusieurs lignes n'est pas envoyé ligne par ligne. **Aucune touche Entrée n'est envoyée.**
- Tous les autres glisser-déposer suivent le comportement normal d'Excalidraw.

## 7. Icônes cloud

### 7.1 Import

- Dialogue « Importer un pack » : choix du fournisseur (AWS, Azure, GCP), liens vers les pages officielles de téléchargement, sélection de l'archive `.zip`.
- `import_icon_pack(provider, zipPath)` :
  - extrait **uniquement les `.svg`** dans `<app_data>/icons/<provider>/<pack_id>/` ;
  - déduit le nom (depuis le nom de fichier, normalisation propre à chaque fournisseur : préfixes `Arch_`/`Res_`, numéros Azure, suffixes de taille…) et la catégorie (depuis le dossier) ;
  - ne garde qu'une taille par icône (la plus grande disponible) ;
  - enregistre le pack et les icônes en base ; renvoie le nombre d'icônes importées.
- Rien n'est embarqué dans le dépôt : aucune question de licence pour le projet.

### 7.2 Recherche et insertion

- Barre latérale Excalidraw (`<Sidebar>`) : champ de recherche, filtre par fournisseur, grille de vignettes servies par le protocole `asset` de Tauri (portée limitée à `$APPDATA/icons/**`).
- `search_icons(query, provider?, limit=200)` : recherche `LIKE` sur nom et catégorie.
- Clic (insertion au centre de la vue) ou glisser (insertion au point de dépôt) :
  - `read_icon_svg(id)` → data URL → `excalidrawAPI.addFiles(...)` ;
  - création d'un élément image + d'un texte (nom du service) en dessous, **groupés**.

## 8. Persistance

### 8.1 Base de données

- Fichier `dummyplane.db` dans le dossier de données de l'app (`%APPDATA%\<identifiant>\` sous Windows).
- `rusqlite` avec SQLite embarqué, mode WAL, `foreign_keys = ON`.
- Migrations SQL embarquées, appliquées au démarrage selon `PRAGMA user_version`.
- Une connexion unique protégée par un `Mutex` dans l'état Tauri.

### 8.2 Schéma

```sql
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE scenes (
  workspace_id   TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  elements_json  TEXT NOT NULL,
  app_state_json TEXT NOT NULL,   -- sous-ensemble : scrollX, scrollY, zoom, gridModeEnabled
  updated_at     INTEGER NOT NULL
);

CREATE TABLE scene_files (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  data_url     TEXT NOT NULL,     -- data URL fournie par Excalidraw (écart du plan 2)
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, file_id)
);

CREATE TABLE nodes (
  id           TEXT PRIMARY KEY,  -- = id de l'élément Excalidraw
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('terminal', 'note', 'kanban', 'git')),
  payload_json TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE terminal_scrollback (
  node_id    TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  data       BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Tables des icônes : reportées à la migration du plan des icônes (écart du plan 2).
CREATE TABLE icon_packs (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL CHECK (provider IN ('aws', 'azure', 'gcp')),
  source_name TEXT NOT NULL,      -- nom de l'archive importée
  imported_at INTEGER NOT NULL
);

CREATE TABLE icons (
  id       TEXT PRIMARY KEY,
  pack_id  TEXT NOT NULL REFERENCES icon_packs(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  svg_path TEXT NOT NULL          -- relatif au dossier du pack
);
CREATE INDEX icons_name ON icons(name);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

Les horodatages sont en millisecondes Unix.

### 8.3 Contenu des nœuds (`payload_json`)

```ts
type TerminalPayload = {
  title: string;
  cwd: string;
  preset: 'claude' | 'aider' | 'codex' | 'shell' | 'custom';
  command: string;            // utilisé pour 'custom' ; ignoré sinon
  shell: 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'default';
  claudeSessionId?: string;   // uniquement pour preset = 'claude'
};
type NotePayload   = { title: string; markdown: string };
type KanbanPayload = { title: string; columns: { id: string; title: string;
                       cards: { id: string; title: string; body: string }[] }[] };
type GitPayload    = { title: string; path?: string };
```

### 8.4 Flux de sauvegarde

- **Scène** : `onChange` d'Excalidraw → on compare `getSceneVersion(elements)` à la dernière version vue (les mouvements de souris seuls sont ignorés) → `save_scene` 500 ms après la dernière modification. Seuls les éléments **non supprimés** (`isDeleted = false`) sont enregistrés. La commande reçoit aussi la liste des `id` des nœuds dummyPlane non supprimés, et supprime dans la même transaction les lignes `nodes` absentes (le scrollback suit par `ON DELETE CASCADE`).
- **Contenu d'un nœud** : chaque modification met à jour le store, qui appelle `save_node` 500 ms après la dernière modification de ce nœud.
- **Fichiers** : `save_files` n'envoie que les `file_id` pas encore enregistrés.
- **Viewport et workspace actif** : sauvegardés avec la scène et dans `settings` (`ui.activeWorkspaceId`).
- **Fermeture de l'app** : les sauvegardes en attente sont envoyées immédiatement.

### 8.5 Suppression et annulation

- Un élément marqué supprimé (`isDeleted`) par Excalidraw : son PTY est arrêté (s'il s'agit d'un terminal) et son entrée de registre détruite. Sa ligne `nodes` est purgée à la sauvegarde suivante (§8.4).
- Le store front garde en mémoire le contenu des nœuds supprimés jusqu'à la fermeture de l'app. Un Ctrl+Z qui restaure l'élément le fait donc réapparaître **arrêté**, avec son contenu, qui est réenregistré par `save_node`. Pour un terminal, l'écran est vide mais « Reprendre la session » fonctionne : la conversation Claude est stockée par Claude Code lui-même.
- Supprimer un workspace : arrêt de ses terminaux, puis suppression en cascade.

## 9. Interface IPC

### Commandes

| Domaine | Commande | Rôle |
|---|---|---|
| Base | `ping() -> String` | test du socle |
| Workspaces | `list_workspaces`, `create_workspace(name)`, `rename_workspace(id, name)`, `delete_workspace(id)` | gestion de la barre latérale ; `delete_workspace` arrête aussi les terminaux du workspace |
| Scène | `load_workspace(id) -> { scene, files, nodes }` | chargement complet sauf scrollback |
| | `save_scene(workspaceId, elementsJson, appStateJson, nodeIds)` | sauvegarde + purge |
| | `save_files(workspaceId, files)` | images ajoutées |
| | `save_node(id, workspaceId, kind, payload)` | contenu d'un nœud |
| PTY | `pty_spawn(nodeId, spec, cols, rows, onData: Channel) -> pid` (ou `null`) | lance shell + commande |
| | `pty_attach(nodeId, onData: Channel) -> bool` | rattache une session vivante |
| | `pty_write(nodeId, data)`, `pty_resize(nodeId, cols, rows)`, `pty_kill(nodeId)` | interaction |
| | `pty_list() -> nodeId[]` | sessions vivantes (badges, rattachement) |
| | `get_scrollback(nodeId) -> octets bruts` | restauration d'un terminal arrêté |
| Préréglages | `list_presets()`, `list_shells()` | dialogue de lancement |
| Git | `git_status(path) -> GitStatus`, `git_diff(path, file) -> String` | Git Watcher |
| Icônes | `import_icon_pack(provider, zipPath)`, `list_icon_packs()`, `delete_icon_pack(id)`, `search_icons(query, provider?, limit)`, `read_icon_svg(id)` | icônes cloud |
| Réglages | `get_setting(key)`, `set_setting(key, value)` | réglages |

`spec` de `pty_spawn` : `{ cwd, shell, preset, command, claude?: { mode: 'new' | 'resume' | 'continue', sessionId, title } }`.

### Événements

- `pty-exit` : `{ nodeId, exitCode }`.

## 10. Gestion des erreurs

- Côté Rust : un `AppError` (`thiserror`) sérialisé en `{ kind, message }` ; toutes les commandes renvoient `Result<T, AppError>`.
- Côté front : un wrapper autour de `invoke` relance une erreur typée ; affichage par toast (`sonner`) sauf cas ci-dessous.
- Cas affichés dans le nœud plutôt qu'en toast :
  - échec de `pty_spawn` (dossier introuvable, shell absent) → état **Erreur** avec message et action Relancer ;
  - Git Watcher → « Pas un dépôt Git », « git introuvable ».
- Échec d'ouverture de la base au démarrage → boîte de dialogue bloquante avec le chemin du fichier.
- Import d'icônes sans aucun SVG reconnu → toast d'erreur, rien n'est enregistré.
- Les logs Rust vont dans un fichier via `tauri-plugin-log` (reporté, voir les écarts du plan 2).

## 11. Arborescence cible

```
dummyplane/
├─ docs/superpowers/specs/            # cette spec
├─ public/excalidraw-assets/          # polices Excalidraw locales
├─ src/
│  ├─ main.tsx, App.tsx               # disposition : barre latérale + canvas
│  ├─ components/ui/                  # composants shadcn
│  ├─ ipc/commands.ts, ipc/types.ts   # wrappers typés autour de invoke
│  ├─ store/workspaces.ts, store/nodes.ts, store/settings.ts
│  ├─ sidebar/WorkspaceSidebar.tsx
│  ├─ canvas/Canvas.tsx               # <Excalidraw>, onChange, renderEmbeddable
│  ├─ canvas/insert.ts, canvas/InsertMenu.tsx
│  ├─ canvas/dropInterceptor.ts       # §6.9
│  ├─ canvas/links.ts                 # flèche Git Watcher ↔ terminal
│  ├─ nodes/NodeHost.tsx
│  ├─ nodes/terminal/{TerminalNode.tsx, registry.ts, LaunchDialog.tsx, keys.ts}
│  ├─ nodes/note/NoteNode.tsx
│  ├─ nodes/kanban/KanbanNode.tsx
│  ├─ nodes/git/{GitWatcherNode.tsx, DiffDialog.tsx}
│  └─ icons/{IconSidebar.tsx, ImportPackDialog.tsx, insertIcon.ts}
└─ src-tauri/
   ├─ tauri.conf.json, capabilities/default.json
   └─ src/
      ├─ main.rs, lib.rs              # builder, état, enregistrement des commandes
      ├─ error.rs                     # AppError
      ├─ db/{mod.rs, migrations.rs, workspaces.rs, scenes.rs, nodes.rs, icons.rs, settings.rs}
      ├─ pty/{mod.rs, session.rs, shell.rs, scrollback.rs}
      ├─ presets.rs
      ├─ git.rs
      └─ icons.rs
```

## 12. Jalons

Chaque jalon se termine par un résultat utilisable et vérifiable, et par un commit. Pour chaque jalon, le compte rendu donne l'arborescence touchée et les commandes d'installation ; le code est écrit directement dans le dépôt.

Le plan d'implémentation est rédigé en deux temps : d'abord les jalons 1 à 3 (le jalon 3 ne dépend pas du moteur de canvas), puis les jalons 4 à 9 une fois la décision du prototype prise (§15).

| # | Jalon | Vérification de fin |
|---|---|---|
| 1 | **Socle** : Tauri 2, Vite, React, TS strict, Tailwind v4, shadcn, commande `ping`, polices Excalidraw locales, `dragDropEnabled: false` | l'app s'ouvre, `ping` répond |
| 2 | **Canvas** : Excalidraw plein écran, barre latérale des workspaces (en mémoire), **prototype des éléments intégrés** (§15) | décision A/B consignée en §15, avec les mesures |
| 3 | **Pont PTY Rust** : `PtyManager`, Channel binaire, `pty-exit`, shells, préréglages, options Claude, scrollback | tests Rust verts : sortie de `cmd /c echo` reçue, lignes de commande Claude correctes |
| 4 | **Nœud Terminal** : registre, addons, dialogue de lancement, clavier, activation | une vraie session `claude` utilisable sur le canvas |
| 5 | **Persistance** : SQLite, migrations, toutes les tables, restauration « arrêté », Relancer (`--resume`, nouvelle, `--continue`) | fermer/rouvrir l'app et reprendre la conversation Claude |
| 6 | **Notes** + intercepteur de dépôt vers terminal | une note collée dans Claude, sans Entrée |
| 7 | **Kanban** + carte vers terminal | une carte envoyée à un agent |
| 8 | **Git Watcher** + lien par flèche + diff | le statut se met à jour quand l'agent modifie des fichiers |
| 9 | **Icônes cloud** : import, recherche, insertion | un schéma AWS dessiné entre deux terminaux |

## 13. Stratégie de test

### Tests automatisés

- **Rust (unitaires)** :
  - migrations et accès à la base, sur SQLite en mémoire ; purge des nœuds dans `save_scene` ;
  - construction des lignes de commande : options Claude par mode, échappement PowerShell / cmd / bash ;
  - tampon circulaire : capacité, troncature, rejeu à partir du premier saut de ligne ;
  - parseur de `git status --porcelain=v2 --branch -z` et de `git diff --numstat` ;
  - normalisation des noms d'icônes par fournisseur et import d'une archive de test.
- **Rust (intégration, Windows)** : lancement d'un vrai PTY avec `cmd /c echo hello`, lecture de la sortie, redimensionnement.
- **Front (Vitest)** :
  - filtre `getSceneVersion` (pas de sauvegarde sur simple mouvement) ;
  - recherche du terminal sous un point de dépôt ;
  - résolution du lien par flèche Git Watcher ↔ terminal ;
  - délai de sauvegarde des contenus de nœuds ;
  - gestion d'un message de Channel en `ArrayBuffer` ou `number[]`.

### Vérifications manuelles (à chaque jalon concerné)

- Claude Code démarre avec la connexion existante ; couleurs et emojis corrects.
- Échap interrompt Claude ; Shift+Entrée fait un retour à la ligne ; Ctrl+C copie ou interrompt selon la sélection.
- Redimensionner un nœud redessine correctement Claude Code.
- 10 terminaux actifs : déplacement et zoom du canvas restent fluides.
- Changer de workspace puis revenir : les terminaux ont continué à tourner.
- Fermer et rouvrir l'app : tout est restauré, terminaux arrêtés avec leur scrollback, « Reprendre la session » rouvre la bonne conversation.

Pas d'automatisation de bout en bout en V1.

## 14. Risques

| Risque | Conséquence | Mitigation |
|---|---|---|
| Les éléments intégrés d'Excalidraw sont prévus pour des iframes | interactions difficiles dans les nœuds | prototype go/no-go au jalon 2, repli sur l'option B (§15) |
| Excalidraw intercepte Échap ou d'autres touches | impossible d'interrompre Claude | arrêt de la propagation dans le conteneur du terminal ; vérifié en premier dans le prototype |
| Excalidraw retire les éléments hors écran du DOM | perte de l'état Xterm | registre hors React et déplacement de l'élément DOM (§6.4) |
| Limite d'environ 16 contextes WebGL | terminaux noirs au-delà | repli automatique vers le rendu DOM |
| Formats des archives d'icônes changeant d'une version à l'autre | import partiel | normalisation testée sur des archives réelles ; noms bruts conservés en dernier recours |
| `/clear` dans Claude change l'identifiant de session | reprise de l'ancienne conversation | mode « Plus récente du dossier » |

## 15. Prototype du jalon 2 et option de repli

### Critères go/no-go (option A : Excalidraw comme canvas)

Avec un nœud de test contenant un Xterm relié à un shell local :

1. La saisie dans Xterm fonctionne après activation, sans déclencher les raccourcis d'Excalidraw.
2. Échap atteint le processus (éventuellement après arrêt de la propagation).
3. La molette fait défiler le terminal quand il est actif, et zoome le canvas sinon.
4. Redimensionner l'élément ajuste correctement `fit` à 100 %.
5. Un élément sorti puis revenu à l'écran conserve son Xterm (déplacement de l'élément DOM).
6. L'intercepteur de dépôt reçoit un `application/x-dummyplane-snippet` lâché sur un terminal, et Excalidraw ne crée pas d'élément texte.
7. Une flèche s'accroche à un élément intégré, et la liaison se lit dans les éléments de la scène.
8. Avec 10 terminaux actifs, déplacement et zoom restent fluides.

Un échec non corrigible sur 1, 2, 6 ou 8 entraîne le passage à l'option B.

### Option B (repli)

React Flow pour les nœuds, au-dessus d'une couche Excalidraw dont la vue (déplacement, zoom) est synchronisée, avec un bouton « Dessin / Nœuds ». Les dessins restent sous les nœuds ; le lien Git Watcher ↔ terminal devient une arête React Flow (table `edges` ajoutée au schéma). Le reste de la spec est inchangé.

### Décision

Prototype passé par Mathieu le 2026-10-24 sur Windows 11 (WebView2), avec l'outillage de la tâche 6 du plan 1 et le vrai PowerShell de la tâche 12.

| Critère | Observation | OK ? |
|---|---|---|
| 1. Saisie dans Xterm sans raccourcis Excalidraw | Texte affiché ; aucun changement d'outil ; le nœud n'est pas supprimé par Suppr | ✔ |
| 2. Échap atteint le processus | « Échap reçu par le terminal », sans contournement | ✔ |
| 3. Molette : terminal actif / canvas | Le terminal défile quand il est actif, le canvas sinon | ✔ |
| 4. Redimensionnement à 100 % | Le texte se réorganise, sans flou | ✔ |
| 5. Hors écran puis retour ; changement de workspace | Contenu conservé ; « remonté avec son état » au retour de workspace | ✔ |
| 6. Dépôt d'un snippet | Collé dans le terminal sans Entrée ; ignoré sur le canvas vide, aucun élément texte créé | ✔ |
| 7. Flèche liée à un élément intégré | `terminal:xxxx → terminal:yyyy` lu dans la scène | ✔ |
| 8. 10 terminaux + flood | 50 img/s ou plus pendant déplacement et zoom ; aucun terminal noir | ✔ |
| Pont PTY (jalon 3) | PowerShell réel avec accents corrects ; `claude` démarre avec le compte existant ; `pty-exit` reçu ; aucun processus orphelin après fermeture | ✔ |

**Décision : option A (Excalidraw comme canvas).** Aucun contournement n'a été nécessaire (le blocage de propagation des touches est resté désactivé).

### Écarts du plan 2

| Point de la spec | Réalisé | Raison |
|---|---|---|
| `scene_files.data BLOB` (§8.2) | `data_url TEXT` | Excalidraw fournit et relit des data URL ; aucune conversion à faire |
| Tables `icon_packs` et `icons` dans la migration 001 | reportées à la migration du plan des icônes | rien ne les utilise avant ce plan |
| `reorder_workspaces(ids)` (§9) | absent | l'ordre de création suffit ; à ajouter avec le glisser des onglets |
| `get_settings()` (§9) | `get_setting(key)` | lecture ciblée d'un réglage, valeur JSON |
| `pty_spawn -> { pid }` (§9) | renvoie le pid nu, ou `null` si le système ne le fournit pas | rien d'autre à transmettre |
| réglage `terminal.zoomOnActivate` (§6.3) | toujours actif | pas encore d'écran de réglages |
| `tauri-plugin-log` (§3, §10) | reporté | aucun besoin de diagnostic sur fichier pour l'instant |
| erreurs `{ kind, message }` (§10) | ajout du kind `db` | distinguer une erreur SQLite d'une erreur d'entrée |
| suppression d'un workspace | Rust arrête aussi ses terminaux | après un rechargement de la webview, le front ne connaît pas les agents des workspaces jamais affichés |

## 16. Conventions

- Code et commentaires en anglais (projet open-source) ; spec et documentation en français.
- Gestionnaire de paquets : pnpm.
- Commits au format Conventional Commits, au moins un par jalon.
