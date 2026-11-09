# dummyPlane — Plan 2 : nœud Terminal et persistance SQLite (jalons 4 et 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le prototype par le vrai nœud Terminal (lancement, préréglages, sessions Claude, relance) et rendre tout l'espace de travail persistant en SQLite : workspaces, scènes, images, nœuds, scrollback. Au redémarrage, les terminaux reviennent arrêtés avec leur dernier écran, et « Reprendre la session » rouvre la conversation Claude.

**Architecture:**
- **Rust** possède la base. Un `Db` (une connexion `rusqlite` protégée par un mutex, migrations via `PRAGMA user_version`) est exposé par des commandes typées.
- **Le front** garde la scène en cache et la sauvegarde 500 ms après chaque vraie modification, via une file d'écritures ordonnée.
- **Les terminaux** vivent dans un registre hors React ; un module `session` décide au premier affichage de lancer, rattacher ou restaurer.
- **Le scrollback** est écrit par Rust toutes les 10 s, à la fin d'un processus et à la fermeture de l'app.

**Tech Stack:** Tauri 2, `rusqlite` 0.40 (feature `bundled`), `tauri-plugin-dialog` 2, `@tauri-apps/plugin-dialog` 2.8.3, `@xterm/addon-unicode11` 0.9.0, `@xterm/addon-web-links` 0.12.0, shadcn `dialog` / `select` / `label`, plus la stack du plan 1.

**Spec:** `docs/superpowers/specs/2026-10-23-dummyplane-v1-design.md` (§15 : décision A, Excalidraw comme canvas).

## Code de référence

Tout le code de ce plan a été écrit et validé dans une copie de travail du dépôt : **`%LOCALAPPDATA%\ovp2`** (`C:\Users\Spectrum\AppData\Local\ovp2`). Résultats de validation :
- `cargo test --lib` : 53 tests verts, aucun avertissement de compilation ;
- `pnpm test` : 69 tests verts ;
- `pnpm build` : réussi ;
- build debug lancé : la base SQLite a été créée, avec la migration v1, « Workspace 1 » et la première sauvegarde de scène.

Chaque tâche indique les fichiers à reprendre depuis cette copie (chemins relatifs à sa racine), dans l'ordre TDD : **tests d'abord, échec constaté, puis implémentation, succès constaté**. Pour un module Rust qui contient ses propres tests, l'étape « rouge » consiste à reprendre le fichier puis à remplacer temporairement le corps des fonctions publiques par `todo!()`. On lance les tests, on constate l'échec, puis on remet l'implémentation de référence.

**Ne jamais reprendre `src-tauri/tauri.conf.json` de la copie** : son identifiant a été changé en `dev.dummyplane.probe` pour ne pas toucher la vraie base. La copie est supprimée à la fin du plan 2.

## Global Constraints

- Toutes les contraintes du plan 1 restent valables : Windows 11, Tauri 2, pnpm, happy-dom (jamais jsdom), code en anglais et interface en français, aucun SQL côté front, sortie PTY en octets.
- `cargo fmt` est appliqué une fois à la tâche 1 ; tout le Rust ajouté ensuite est déjà formaté.
- `AppError` gagne le type `db` (erreurs SQLite). Le type front `AppErrorKind` le reprend.
- Toutes les écritures en base passent par une **file unique** (`src/lib/queue.ts`). Les commandes Tauri `async` s'exécutent en parallèle, et une sauvegarde de scène (qui purge des nœuds) ne doit jamais doubler la sauvegarde d'un nœud envoyée avant elle.
- La ligne d'un nœud est créée **immédiatement** (`nodes.create`), avant le lancement de son processus : le scrollback a besoin de cette ligne (clé étrangère).
- Un terminal passe à l'état « running » **avant** l'appel à `pty_spawn`. ConPTY envoie `ESC[6n` avant que la commande ne réponde, et la réponse d'Xterm doit passer.
- À la reconnexion (`pty_attach`), Rust envoie toujours le rejeu en premier message, même vide. Le front ignore la saisie tant que ce rejeu n'est pas écrit.
- `fit()` n'est jamais appelé sur un conteneur de taille 0 (sinon le PTY passe à 2×1).
- La fenêtre principale a la permission `core:window:allow-destroy` : `onCloseRequested` attend l'écriture des sauvegardes puis détruit la fenêtre.
- Commandes de test : `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

## Écarts assumés par rapport à la spec

| Spec | Ce plan | Raison |
|---|---|---|
| §8.2 `scene_files.data BLOB` | `data_url TEXT` | Excalidraw manipule des data URL : on évite une conversion aller-retour. |
| §8.2 tables `icon_packs` / `icons` | reportées à la migration 002 (plan 4) | Rien ne les utilise avant le jalon 9. |
| §9 `reorder_workspaces` | non implémentée | Aucune interface de réordonnancement en V1 pour l'instant. |
| §9 `get_settings()` | `get_setting(key)` / `set_setting(key, value)` | Un seul réglage en V1 (`ui.activeWorkspaceId`). |
| §9 `pty_spawn -> { pid }` | renvoie `pid` (nombre ou `null`) | Déjà le cas au plan 1 ; un champ unique n'apporte rien. |
| §6.3 réglage `terminal.zoomOnActivate` | toujours actif | Pas encore d'écran de réglages. |
| §10 `tauri-plugin-log` | toujours reporté | Les erreurs Rust vont sur `stderr` (`eprintln!`). |

## Review Focus

- **La webview se recharge pendant qu'un agent tourne.** Le terminal se rattache au processus vivant. Les réponses d'Xterm aux requêtes rejouées (position du curseur…) ne doivent pas être injectées dans Claude. Tests : `ignores input until the replay sent on re-attach has been written` (front), `attach_sends_the_replay_as_the_first_message` (Rust).
- **Une sauvegarde de scène en vol au moment où l'on crée un terminal.** Le nœud ne doit jamais être purgé. Test : `never lets a scene save overtake a node save sent before it`.
- **Fermer la fenêtre juste après une modification.** La modification est écrite avant la fermeture. Tests : `waits for every registered flush, even when one fails` et `flushes pending updates on demand`, plus la vérification manuelle 8.
- **« Relancer » sur un terminal qui tourne encore.** Pas d'erreur « tourne déjà » : on attend la fin du processus. Test : `relaunch waits for the old process to exit before spawning`.
- **Coller une image puis redémarrer.** L'image est toujours là. Tests : `saves each new image once, as a data URL` et `keeps_the_first_copy_of_each_file`, plus la vérification manuelle 6.

---

## Jalon 4/5 — Fondations

### Task 1 : Formatage Rust et dépendances

**Files:** Modify `src-tauri/**/*.rs` (formatage), `src-tauri/Cargo.toml`, `package.json`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` ; Create `src/components/ui/{dialog,select,label}.tsx`.

- [ ] **Step 1 :** `cargo fmt --manifest-path src-tauri/Cargo.toml`, puis `cargo test --manifest-path src-tauri/Cargo.toml --lib` → `34 passed`. Commit `style: format Rust code with rustfmt`.
- [ ] **Step 2 :** Ajouter les dépendances, en évitant `pnpm tauri add` : il reformate et sort en erreur sous Windows.
  - Rust : `cd src-tauri && cargo add tauri-plugin-dialog@2 && cargo add rusqlite@0.40 --features bundled && cd ..`
  - Front : `pnpm add @tauri-apps/plugin-dialog@2.8.3 @xterm/addon-unicode11@0.9.0 @xterm/addon-web-links@0.12.0`
  - Composants : `pnpm dlx shadcn@4.22.1 add dialog select label -y`
- [ ] **Step 3 :** Dans `lib.rs`, ajouter `.plugin(tauri_plugin_dialog::init())` avant le plugin opener. Dans `capabilities/default.json`, ajouter `"core:window:allow-destroy"` et `"dialog:default"` à `permissions`.
- [ ] **Step 4 :** `pnpm build` puis `cargo build --manifest-path src-tauri/Cargo.toml` → succès, aucun `warning:`. Commit `chore: add dialog plugin, SQLite and terminal addons`.

### Task 2 : Base SQLite — connexion, migrations, workspaces, réglages

**Files:** Modify `src-tauri/src/error.rs` (variante `Db(#[from] rusqlite::Error)`, kind `"db"`), `src-tauri/src/lib.rs` (`mod db;`) ; Create `src-tauri/src/db/mod.rs`, `db/migrations/001_initial.sql`, `db/workspaces.rs`, `db/settings.rs`.

**Interfaces (Produces):**
- `Db::open(path) -> AppResult<Db>`, `Db::open_in_memory()` (tests), `Db::with(|conn| -> AppResult<T>)`, `now_ms() -> i64`.
- `workspaces::{Workspace { id, name, position }, list, create(conn, name), rename(conn, id, name), delete(conn, id)}` : nom vide → `invalidInput` ; id inconnu → `notFound` ; supprimer le dernier → `invalidInput`.
- `settings::{get(conn, key) -> Option<serde_json::Value>, set(conn, key, &value)}`.

- [ ] **Step 1 (rouge) :** Reprendre les fichiers depuis la copie. Dans `db/mod.rs`, ne déclarer que `pub mod settings; pub mod workspaces;` (les trois autres modules arrivent à la tâche 3). Remplacer les corps de `workspaces::{list, create, rename, delete}` et `settings::{get, set}` par `todo!()`. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib db::` → échecs `not yet implemented` (seul `migrations_run_once_and_record_the_version` passe).
- [ ] **Step 2 (vert) :** Remettre les implémentations de référence. Run → `db::` : 7 tests verts. `error::tests` reste vert.
- [ ] **Step 3 :** Commit `feat(db): open SQLite with migrations, workspaces and settings`.

### Task 3 : Base SQLite — scènes, fichiers, nœuds, scrollback

**Files:** Create `src-tauri/src/db/{nodes,scenes,scrollback}.rs` ; Modify `db/mod.rs` (déclarer les trois modules).

**Interfaces (Produces):**
- `nodes::{NodeKind (terminal|note|kanban|git), save(conn, id, workspace_id, kind, payload_json)}` : upsert.
- `scenes::{SceneFile { id, mime_type, data_url, created }, StoredNode { id, kind, payload_json }, WorkspaceData { elements_json?, app_state_json?, files, nodes }, load(conn, ws), save(conn, ws, elements_json, app_state_json, node_ids)` (purge dans la même transaction, via `json_each`), `save_files(conn, ws, files)` (`INSERT OR IGNORE`)}.
- `scrollback::{save(conn, node_id, data) -> bool` (rien si le nœud n'existe pas), `load(conn, node_id) -> Option<Vec<u8>>}`.

- [ ] **Step 1 (rouge) :** Reprendre les trois fichiers et remplacer les corps des fonctions publiques par `todo!()`. Run `cargo test … --lib db::` → les 9 nouveaux tests échouent.
- [ ] **Step 2 (vert) :** Implémentations de référence. Run → `db::` : 16 tests verts.
- [ ] **Step 3 :** Commit `feat(db): store scenes, images, node payloads and scrollback`.

### Task 4 : PTY prêt pour la persistance

**Files:** Modify `src-tauri/src/pty/{scrollback,session,mod}.rs`, `src-tauri/src/commands.rs` (la fermeture `on_exit` reçoit désormais `ExitInfo` : `exit_code: info.code`).

**Interfaces (Produces):**
- `Scrollback::take_dirty()`. Le correctif du scrollback coupé s'applique : sans saut de ligne, le rejeu commence au premier `ESC`.
- `Session::take_dirty_scrollback() -> Option<Vec<u8>>`. `Session::attach` envoie toujours le rejeu, même vide.
- `ExitInfo { code: Option<u32>, scrollback: Vec<u8> }`, `PtyManager::spawn(…, on_exit: impl FnOnce(ExitInfo))`, `dirty_scrollbacks()`, `all_scrollbacks() -> Vec<(String, Vec<u8>)>`.

- [ ] **Step 1 (rouge) :** Reprendre d'abord les tests de la copie : le module `tests` de `pty/scrollback.rs` (ajouts `skips_a_cut_escape_sequence_when_there_is_no_newline` et `dirty_flag_is_set_by_output_and_cleared_on_take`) et le module `windows_tests` de `pty/mod.rs` (`reports_each_changed_scrollback_once`, `attach_sends_the_replay_as_the_first_message`, exit avec scrollback). Run → erreurs de compilation ou échecs sur les fonctions absentes.
- [ ] **Step 2 (vert) :** Reprendre les trois fichiers complets et adapter `commands.rs`. Run `cargo test … --lib` → `53 passed` (16 db + 1 erreur + 3 presets + 7 scrollback + 18 shell + 1 pty + 7 windows).
- [ ] **Step 3 :** Commit `feat(pty): track changed scrollback and report it on exit`.

### Task 5 : Commandes Tauri et démarrage de la base

**Files:** Delete `src-tauri/src/commands.rs` ; Create `src-tauri/src/commands/{mod,pty,workspace}.rs` ; Modify `src-tauri/src/lib.rs` (reprise complète).

**Interfaces (Produces):**
- **Commandes** : `list_workspaces`, `create_workspace(name)`, `rename_workspace(id, name)`, `delete_workspace(id)`, `load_workspace(id) -> WorkspaceData`, `save_scene(workspaceId, elementsJson, appStateJson, nodeIds)`, `save_files(workspaceId, files)`, `save_node(id, workspaceId, kind, payloadJson)`, `get_setting(key)`, `set_setting(key, value)`.
- **`get_scrollback`** renvoie le scrollback vivant, sinon celui de SQLite.
- **`pty_spawn`** écrit le scrollback en base avant d'émettre `pty-exit`.
- **`lib.rs`** :
  - au démarrage (`setup`), ouvre `app_data_dir()/dummyplane.db`, et en cas d'échec affiche une boîte bloquante avec le chemin ;
  - lance un thread qui écrit les scrollbacks modifiés toutes les 10 s ;
  - sur `RunEvent::Exit`, écrit tous les scrollbacks puis arrête les processus.

- [ ] **Step 1 :** Reprendre les fichiers. Run `cargo build … ` → aucun `warning:` ; `cargo test … --lib` → `53 passed`.
- [ ] **Step 2 (fumée) :** Arrêter toute instance `pnpm tauri dev` encore ouverte. Run `pnpm tauri build --debug --no-bundle`, lancer `src-tauri/target/debug/dummyplane.exe` 12 s, puis vérifier que `%APPDATA%\dev.dummyplane.app\dummyplane.db` existe. Le front n'étant pas encore branché, aucune ligne n'est attendue.
- [ ] **Step 3 :** Commit `feat(db): expose workspace persistence commands and flush scrollback`.

## Jalon 4/5 — Front

### Task 6 : Utilitaires et IPC base de données

**Files:** Create `src/lib/{debounce,queue,flush}.ts` + tests, `src/ipc/db.ts` + `db.test.ts` ; Modify `src/ipc/invoke.ts` (`AppErrorKind` + `"db"`).

**Interfaces (Produces):**
- `debounce(fn, ms)` avec `.flush()` (renvoie le résultat) et `.cancel()`.
- `createQueue()` renvoie une fonction `enqueue(task)`.
- `onFlushAll(flush) -> unregister`, `flushAll(): Promise<void>`.
- `ipc/db` : types `Workspace`, `StoredFile`, `StoredNode`, `WorkspaceData` et une fonction par commande. Toutes les écritures passent par la même file.

- [ ] **Step 1 (rouge) :** Reprendre les quatre fichiers `*.test.ts`. Run `pnpm test` → échecs `Failed to resolve import`.
- [ ] **Step 2 (vert) :** Reprendre les quatre modules et éditer `invoke.ts`. Run → `Tests 35 passed` (26 existants + 9).
- [ ] **Step 3 :** Commit `feat: add debounce, ordered write queue and database IPC`.

### Task 7 : Stores des nœuds et du statut des terminaux

**Files:** Create `src/nodes/types.ts`, `src/store/nodes.ts` + test, `src/store/terminalStatus.ts` + test.

**Interfaces (Produces):**
- `TerminalPayload { title, cwd, preset, command, shell, claudeSessionId? }`, `NodePayload`.
- `nodesStore` / `useNodes` avec les actions suivantes :
  - `hydrate(ws, stored)` ;
  - `create(id, record)`, sauvegarde immédiate ;
  - `update(id, patch)`, sauvegarde après 500 ms ;
  - `persist(id)` ;
  - `forgetWorkspace(ws)`, qui renvoie les ids oubliés.
  - Le store s'enregistre auprès de `onFlushAll`. `createNodesStore()` est exporté pour les tests.
- `TerminalStatus` (`running | stopped | exited(code) | error(message)`), `terminalStatusStore`, `statusOf`, `isRunning`, `useTerminalStatus`, `waitForExit(id, timeoutMs = 5000)`.

- [ ] **Step 1 (rouge) :** tests d'abord → `Failed to resolve import`.
- [ ] **Step 2 (vert) :** modules → `Tests 43 passed`.
- [ ] **Step 3 :** Commit `feat: add node payload and terminal status stores`.

### Task 8 : Logique du terminal

**Files:** Create `src/nodes/terminal/{launch,keys,session}.ts` + tests.

**Interfaces (Produces):**
- `launch` :
  - `LaunchMode`, `PRESET_LABELS`, `SHELL_LABELS` ;
  - `defaultTitle(preset, cwd)` ;
  - `newTerminalPayload(input)`, qui donne un UUID de session aux terminaux Claude ;
  - `buildSpawnSpec(payload, mode)`.
- `keys` : `keyAction(event, hasSelection)` renvoie `copy | paste | newline | default` ; `NEWLINE_SEQUENCE = "\x1b\r"`.
- `session` :
  - le type `TermSink { write(data, cb?), cols, rows }` ;
  - `acceptsInput(nodeId, state)` ;
  - `startSession` (statut « running » posé avant le lancement), `attachSession` (garde pendant le rejeu), `restoreSession`, `relaunchSession` (arrêt, attente de la fin, puis relance).

- [ ] **Step 1 (rouge) :** les trois fichiers de tests → `Failed to resolve import`.
- [ ] **Step 2 (vert) :** les trois modules → `Tests 59 passed`.
- [ ] **Step 3 :** Commit `feat(terminal): launch specs, Windows Terminal keys and session lifecycle`.

### Task 9 : Synchronisation de la scène

**Files:** Create `src/canvas/{sceneSync,activation}.ts` + tests, `src/canvas/sceneCache.ts`.

**Interfaces (Produces):**
- `sceneSync` :
  - `liveNodeIds(elements)` ;
  - `createSceneSync({ elements, savedFileIds }, deps)` renvoie `{ onChange(elements, appState, files, sceneVersion), flush() }`.
  - Les `deps` sont `saveScene`, `saveFiles`, `onSceneChanged(elements, view, files, savedFileIds)`, `onNodesAdded`, `onNodesRemoved`.
- `activation` : `createActivationTracker()` renvoie une fonction `(activeEmbeddable) => terminalId | null`.
- `sceneCache` : `loadScene(ws)` (lecture SQLite une seule fois par session, puis cache, hydrate le store des nœuds), `rememberScene(ws, elements, appState, files, savedFileIds)`, `forgetScene(ws)`.

- [ ] **Step 1 (rouge) :** tests → `Failed to resolve import`.
- [ ] **Step 2 (vert) :** modules → `Tests 67 passed`.
- [ ] **Step 3 :** Commit `feat(canvas): save scenes, images and node changes from Excalidraw`.

### Task 10 : Intégration — vrai nœud Terminal, workspaces persistants, suppression du prototype

**Files:**
- Modify : `src/store/workspaces.ts` + test (réécrits pour s'appuyer sur Rust), `src/nodes/NodeHost.tsx`, `src/canvas/Canvas.tsx`, `src/sidebar/WorkspaceSidebar.tsx`, `src/App.tsx`.
- Create : `src/nodes/terminal/{registry.ts,TerminalNode.tsx,LaunchDialog.tsx}`, `src/app/boot.ts`.
- Delete : `src/spike/`.

**Interfaces (Produces):**
- **Workspaces** :
  - `workspacesStore` : `{ workspaces, activeId, status, error, init, create, rename, remove, select }` ;
  - `nextDefaultName(workspaces)` donne le plus petit « Workspace N » libre ;
  - le workspace actif est mémorisé sous `ui.activeWorkspaceId`.
- **Registre des terminaux** : `setLivePtys`, `markForAutostart`, `mountTerminal(nodeId, host, payload)`, `fitTerminal`, `relaunchTerminal`, `stopTerminal`, `focusTerminal`, `disposeTerminal`.
- **Démarrage** : `boot()` est idempotent. L'ordre est le suivant : écoute de `pty-exit`, puis `ptyList`, puis `onCloseRequested(flushAll)`, puis `init`.

- [ ] **Step 1 (rouge) :** Reprendre `src/store/workspaces.test.ts` de la copie. Run `pnpm test` → échec sur l'ancien store en mémoire (`init` / `nextDefaultName` n'existent pas).
- [ ] **Step 2 (vert) :** Reprendre tous les fichiers listés et supprimer `src/spike/`. Run :
  - `pnpm test` → `Tests 69 passed` (le test des workspaces passe de 7 à 9 cas) ;
  - `pnpm build` → succès ;
  - `cargo test … --lib` → `53 passed`.
- [ ] **Step 3 (fumée) :** `pnpm tauri build --debug --no-bundle`, lancer l'exe 12 s, puis vérifier dans la base qu'il y a la migration 1, une ligne « Workspace 1 » et une ligne de scène (requête `python -I -c` comme lors de la validation).
- [ ] **Step 4 :** Commit `feat: real terminal node with persistent workspaces, scenes and sessions`.

### Task 11 : Vérification avec Mathieu et mise à jour de la spec

- [ ] **Step 1 :** `pnpm tauri dev`, puis dérouler avec Mathieu :

| # | Action | Attendu |
|---|---|---|
| 1 | Insérer → Terminal : choisir un dossier, préréglage Claude Code, titre « Agent test », puis Lancer | Le nœud apparaît. Claude démarre dans le dossier avec ton compte, et le nom de session « Agent test » est visible dans Claude |
| 2 | Dans Claude, Shift+Entrée, puis Échap pendant une réponse | Shift+Entrée fait un retour à la ligne sans envoyer le message ; Échap interrompt la réponse |
| 3 | Sélectionner du texte puis Ctrl+C, et Ctrl+C sans sélection ; Ctrl+V | Copie quand il y a une sélection, interruption sinon ; le collage fonctionne |
| 4 | Zoomer le canvas à 50 %, puis cliquer dans le terminal | La vue revient à 100 % centrée sur le terminal, et le texte est net |
| 5 | Créer un 2ᵉ workspace avec un terminal shell, puis revenir au 1ᵉʳ | Les terminaux ont continué à tourner, et le badge vert de la barre latérale compte les terminaux actifs |
| 6 | Coller une image (Ctrl+V d'une capture) et dessiner une forme | Visibles |
| 7 | Arrêter (■) le shell, puis Relancer | Le bandeau « Terminé (code …) » apparaît, puis le shell redémarre |
| 8 | Renommer un terminal (double-clic sur le titre) puis fermer immédiatement la fenêtre | — |
| 9 | Rouvrir l'app | Même workspace actif. Formes, image et nouveau titre conservés. Terminaux « Arrêté » avec leur dernier écran |
| 10 | Sur le terminal Claude : Relancer → Reprendre la session | La conversation précédente reprend |
| 11 | Supprimer le 2ᵉ workspace | Une confirmation est demandée ; le terminal est arrêté (rien ne reste dans le Gestionnaire des tâches) |
| 12 | Supprimer un nœud terminal puis Ctrl+Z | Le terminal revient, arrêté, avec son titre |

- [ ] **Step 2 :** Ajouter à la spec (§15, après la décision) une sous-section « Écarts du plan 2 » qui reprend le tableau des écarts ci-dessus. Corriger dans §9 la ligne de `pty_spawn` et la liste des commandes de réglages. Commit `docs: record plan 2 deviations in the spec`.
- [ ] **Step 3 :** Supprimer la copie de référence `%LOCALAPPDATA%\ovp2` et `%APPDATA%\dev.dummyplane.probe`.
