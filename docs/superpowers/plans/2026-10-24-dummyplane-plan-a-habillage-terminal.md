# dummyPlane — Plan A : thème, coquille et terminaux (jalons J1 et J2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à dummyPlane le look et l'usage de Symvibe autour du canvas (thème, barres flottantes, projets, accueil) et des terminaux restylés avec catalogue d'agents, prénoms mythologiques et reprise des conversations.

**Architecture:** Excalidraw 0.18.1 reste le moteur de scène ; son interface d'origine est masquée par CSS et pilotée par son API depuis une coquille React (barre du haut, rails, panneaux). Un store `canvasStore` expose l'API et la vue d'Excalidraw à la coquille. Côté Rust, une migration 002 introduit les projets (un dossier de dépôt contient des workspaces) et le catalogue de préréglages devient un catalogue d'agents.

**Tech Stack:** Tauri 2, Rust (rusqlite 0.40, portable-pty), React 19, TypeScript, Vite 8, Tailwind 4, shadcn (radix-ui 1.8), zustand 5, Excalidraw 0.18.1, xterm 6, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (« spec habillage »), qui étend `docs/superpowers/specs/2026-10-23-dummyplane-v1-design.md` (« spec V1 »).

## Global Constraints

- Excalidraw est figé en `0.18.1` ; toute surcharge CSS cible ses classes 0.18.1 et vit dans `src/theme/excalidraw.css`.
- Interface entièrement en français ; code et commentaires en anglais ; spec et documentation en français.
- Thème sombre uniquement ; couleurs prises dans les jetons `--ov-*` de la spec habillage §4.1 (jamais de couleur en dur hors `tokens.css`, sauf les teintes d'agent et de panthéon des catalogues).
- Polices : Geist (interface), Geist Mono (`@fontsource-variable/geist-mono`, nombres, heures, chemins, branche, états), Comic Shanns pour les textes du canvas.
- Rayons : 16 px fenêtres, 12 px nœuds et popovers, 8 à 10 px cartes et champs, pilule pour boutons et puces ; icônes Lucide.
- Tout processus enfant lancé par Rust hors PTY (git, ollama) l'est avec `CREATE_NO_WINDOW` (`crate::process::hide_window`).
- Les réglages de l'utilisateur (`~/.claude`, `~/.codex`) ne sont jamais modifiés.
- pnpm ; Conventional Commits, chaque message de commit se termine par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; supprimer les `*.stackdump` à la racine avant chaque commit.
- Vérifications de fin de tâche : `pnpm test`, `pnpm exec tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` (les commandes Rust seulement si la tâche touche `src-tauri`).
- zustand 5 : un sélecteur `useStore(store, selector)` ne renvoie jamais un objet ou un tableau construit à la volée (boucle de rendu infinie) ; sélectionner des primitives ou des références stables.
- Ne jamais éditer un fichier avec `Get-Content`/`Set-Content` de PowerShell 5.1 (encodage).

## Review Focus

1. **Un terminal restauré arrêté dont l'écran sauvegardé contient des requêtes de terminal** (curseur, attributs) : xterm y répond par `onData` ; seules de vraies frappes clavier (`onKey`) doivent relancer l'agent, jamais la restauration elle-même. Test : `startsOnKeystroke` (Tâche 11) + vérification manuelle J2.
2. **Des terminaux enregistrés avant ce plan** (`preset` au lieu d'`agent`, pas de `name`) se chargent sans erreur, gardent leur agent et reçoivent un prénom dans l'ordre de la scène. Tests : `readTerminalPayload` (Tâche 9), `assignMissingNames` (Tâche 10).
3. **Le dossier d'un projet supprimé ou renommé pendant que l'application est fermée** : au lancement, l'accueil s'affiche avec « Dossier introuvable » au lieu d'ouvrir un projet vide. Test : store des projets (Tâche 3).
4. **Copier-coller ou Ctrl+D d'un terminal, y compris d'un workspace à l'autre** : un vrai nouvel agent apparaît, jamais un nœud « Terminal introuvable ». Test : `classifyAddedNodes` (Tâche 12).
5. **Le même dossier ajouté deux fois** avec une autre casse ou d'autres séparateurs (`C:\code\api` et `c:/code/API/`) est refusé. Test : `projects::create` (Tâche 1).

## Fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `src-tauri/src/db/mod.rs` | migrations par étapes SQL ou Rust, clés étrangères coupées pendant une étape | 1 |
| `src-tauri/src/db/migrations/002_projects.sql`, `src-tauri/src/db/migrate_v2.rs` | migration 002 (projets, reconstruction de `workspaces` et `nodes`) | 1 |
| `src-tauri/src/db/projects.rs` | CRUD des projets, normalisation des chemins | 1 |
| `src-tauri/src/db/workspaces.rs` | workspaces rattachés à un projet, panthéon | 1 |
| `src-tauri/src/commands/project.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/git.rs`, `src-tauri/src/process.rs` | commandes projets, git, processus cachés | 2 |
| `src/ipc/db.ts`, `src/ipc/git.ts` | IPC projets, workspaces par projet, git | 3 |
| `src/store/projects.ts`, `src/store/workspaces.ts`, `src/app/forget.ts`, `src/app/boot.ts` | stores et démarrage | 3 |
| `src/index.css`, `src/theme/tokens.css`, `src/theme/excalidraw.css`, `src/theme/sceneColors.ts` | thème | 4 |
| `src/canvas/canvasStore.ts`, `src/canvas/sceneDefaults.ts`, `src/canvas/overlay/dotGrid.ts`, `src/canvas/overlay/DotGrid.tsx`, `src/canvas/zoom.ts`, `src/shell/ZoomControl.tsx`, `src/shell/ui.tsx`, `src/store/ui.ts` | vue du canvas, grille, zoom | 5 |
| `src/components/ui/popover.tsx`, `src/shell/tools.ts`, `src/shell/LeftRail.tsx`, `src/shell/ShapesMenu.tsx`, `src/shell/PenMenu.tsx` | rail gauche | 6 |
| `src/lib/time.ts`, `src/home/HomeScreen.tsx`, `src/home/ProjectCard.tsx`, `src/shell/ProjectView.tsx`, `src/App.tsx` | accueil et routage | 7 |
| `src/shell/TopBar.tsx`, `src/shell/ProjectPicker.tsx`, `src/shell/WorkspaceTabs.tsx`, `src/shell/LiveCount.tsx`, `src/shell/SettingsMenu.tsx`, `src/shell/sceneFiles.ts`, `src/shell/GitChip.tsx`, `src/store/running.ts` | barre du haut, puce git | 8 |
| `src-tauri/src/agents.rs` (ex-`presets.rs`), `src-tauri/src/pty/shell.rs`, `src/ipc/pty.ts`, `src/fleet/catalog.ts`, `src/nodes/types.ts`, `src/nodes/terminal/launch.ts` | catalogue d'agents, Ollama, charges utiles | 9 |
| `src/fleet/names.ts`, `src/fleet/naming.ts` | prénoms mythologiques | 10 |
| `src/nodes/terminal/pill.ts`, `TerminalNode.tsx`, `TerminalHeader.tsx`, `StatusPill.tsx`, `ResumeCard.tsx`, `registry.ts` | nœud terminal | 11 |
| `src/canvas/nodeCopies.ts`, `src/fleet/terminals.ts`, `src/shell/CloseAgentDialog.tsx` | fermer, dupliquer, copies | 12 |
| `src/fleet/resumable.ts`, `src/fleet/ResumeAllToast.tsx` | reprise globale | 13 |
| `src/fleet/placement.ts`, `src/fleet/agentsStore.ts`, `src/fleet/AgentMenu.tsx`, `src/fleet/LaunchOptionsForm.tsx`, `src/fleet/OllamaPicker.tsx`, `src/fleet/PlacementGhost.tsx`, `src/shell/ActionChips.tsx` | lancement d'agents | 14 |

Supprimés : `src/sidebar/WorkspaceSidebar.tsx` (Tâche 8), `src/canvas/InsertMenu.tsx` (Tâche 5), `src/nodes/terminal/LaunchDialog.tsx` (Tâche 14), `src-tauri/src/presets.rs` (Tâche 9).

## Outil de contrôle visuel (hors dépôt)

Les tâches d'interface se terminent par une capture de la fenêtre pour comparer avec les images de référence de Symvibe (`%TEMP%\claude\…\scratchpad\frames\`). Créer une fois `.superpowers/sdd/2026-10-24-dummyplane-plan-a-habillage-terminal/shot.ps1` (dossier ignoré par git) :

```powershell
param([string]$Out = "$PSScriptRoot\shot.png")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class OvWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process dummyplane -ErrorAction Stop | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
[OvWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400
$r = New-Object OvWin+RECT
[OvWin]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($Out)
"$Out"
```

Usage : `pnpm tauri dev` en arrière-plan, puis `powershell -NoProfile -File .superpowers\sdd\2026-10-24-dummyplane-plan-a-habillage-terminal\shot.ps1`, puis lire l'image. La capture met la fenêtre au premier plan : prévenir Mathieu avant.

---

# Jalon J1 — Thème et coquille

### Task 1: Migration 002 et projets en base

**Files:**
- Modify: `src-tauri/src/db/mod.rs` (remplacement complet)
- Create: `src-tauri/src/db/migrations/002_projects.sql`, `src-tauri/src/db/migrate_v2.rs`, `src-tauri/src/db/projects.rs`
- Modify: `src-tauri/src/db/workspaces.rs` (remplacement complet)
- Modify (tests seulement): `src-tauri/src/db/nodes.rs`, `src-tauri/src/db/scenes.rs`, `src-tauri/src/db/scrollback.rs`, `src-tauri/src/commands/workspace.rs`

**Interfaces:**
- Consumes: `crate::error::{AppError, AppResult}`, `db::now_ms()`.
- Produces:
  - `db::home_dir() -> String`
  - `db::projects::{Project { id, name, path, position, last_opened_at, workspace_count }, Deleted { workspace_ids, node_ids }, normalize_path(&str) -> String, path_key(&str) -> String, name_from_path(&str) -> String, list(&Connection) -> AppResult<Vec<Project>>, get(&Connection, id) -> AppResult<Project>, create(&Connection, path) -> AppResult<Project>, rename(&Connection, id, name), relocate(&Connection, id, path), touch(&Connection, id), delete(&Connection, id) -> AppResult<Deleted>, node_ids(&Connection, id) -> AppResult<Vec<String>>}`
  - `db::workspaces::{Workspace { id, project_id, name, position, pantheon: Option<String> }, list(&Connection, project_id), create(&Connection, project_id, name), rename, delete, set_pantheon(&Connection, id, pantheon)}`
  - `#[cfg(test)] db::test_workspace(&Connection, name) -> AppResult<Workspace>` (workspace dans un projet de test partagé)

- [ ] **Step 1: Écrire les tests de la migration 002**

Créer `src-tauri/src/db/migrations/002_projects.sql` vide pour l'instant (une ligne de commentaire `-- filled in step 3`) et `src-tauri/src/db/migrate_v2.rs` avec seulement les tests et une fonction vide :

```rust
//! Migration 002 (spec habillage §15.1).

use rusqlite::Transaction;

pub fn run(_tx: &Transaction, _home: &str) -> rusqlite::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::super::migrate_up_to;

    fn v1_database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate_up_to(&mut conn, 1, "unused").unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO workspaces VALUES ('w1', 'API', 0, 1, 1), ('w2', 'API bis', 1, 2, 2),
                                          ('w3', 'Notes', 2, 3, 3), ('w4', 'Vide', 3, 4, 4);
            INSERT INTO nodes VALUES
              ('t1', 'w1', 'terminal', '{"cwd":"C:\\code\\api\\","title":"a"}', 10),
              ('t2', 'w2', 'terminal', '{"cwd":"c:/code/API","title":"b"}', 11),
              ('n3', 'w3', 'note', '{}', 12),
              ('t4', 'w4', 'terminal', '{"cwd":"  "}', 13);
            INSERT INTO scenes VALUES ('w1', '[]', '{}', 20);
            INSERT INTO terminal_scrollback VALUES ('t1', x'41', 21);
            "#,
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn groups_workspaces_into_projects_by_the_folder_of_their_first_terminal() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, r"C:\Users\me").unwrap();
        let projects: Vec<(String, String)> = conn
            .prepare("SELECT name, path FROM projects ORDER BY position")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            projects,
            vec![
                ("api".to_string(), r"C:\code\api".to_string()),
                ("me".to_string(), r"C:\Users\me".to_string()),
            ]
        );
        let project_of = |workspace: &str| -> String {
            conn.query_row(
                "SELECT p.name FROM workspaces w JOIN projects p ON p.id = w.project_id WHERE w.id = ?1",
                [workspace],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            [project_of("w1"), project_of("w2"), project_of("w3"), project_of("w4")],
            ["api", "api", "me", "me"]
        );
    }

    #[test]
    fn keeps_nodes_scenes_and_scrollbacks() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, r"C:\Users\me").unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM nodes"), 4);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM scenes"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM terminal_scrollback"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    }

    #[test]
    fn deleting_a_project_cascades_to_the_content_of_its_workspaces() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, r"C:\Users\me").unwrap();
        conn.execute("DELETE FROM projects WHERE name = 'api'", []).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM workspaces"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM scenes"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM terminal_scrollback"), 0);
    }

    #[test]
    fn accepts_orchestrator_nodes() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, "C:/home").unwrap();
        conn.execute("INSERT INTO nodes VALUES ('o1', 'w1', 'orchestrator', '{}', 1)", [])
            .unwrap();
    }

    #[test]
    fn a_failed_migration_leaves_version_1_untouched() {
        let mut conn = v1_database();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO nodes VALUES ('ghost', 'missing', 'note', '{}', 1);
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
        assert!(migrate_up_to(&mut conn, 2, "C:/home").is_err());
        assert_eq!(count(&conn, "PRAGMA user_version"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'projects'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM workspaces"), 4);
    }

    /// `DUMMYPLANE_DB_COPY=<copie de dummyplane.db> cargo test --lib -- --ignored --nocapture`
    #[test]
    #[ignore = "needs DUMMYPLANE_DB_COPY, a copy of a real dummyplane.db"]
    fn migrates_a_copy_of_the_real_database() {
        let path = std::env::var("DUMMYPLANE_DB_COPY").expect("DUMMYPLANE_DB_COPY");
        let mut conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate_up_to(&mut conn, 2, &crate::db::home_dir()).unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT p.name, p.path, COUNT(w.id) FROM projects p
                 LEFT JOIN workspaces w ON w.project_id = p.id GROUP BY p.id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
            })
            .unwrap();
        for row in rows {
            println!("{:?}", row.unwrap());
        }
    }
}
```

Remplacer `src-tauri/src/db/mod.rs` par la version à étapes (le test de la migration en a besoin) :

```rust
mod migrate_v2;
pub mod nodes;
pub mod projects;
pub mod scenes;
pub mod scrollback;
pub mod settings;
pub mod workspaces;

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, Transaction};

use crate::error::AppResult;

/// One schema upgrade. Rust steps do what SQL alone cannot (read JSON payloads,
/// know the user's home folder).
enum Step {
    Sql(&'static str),
    Rust(fn(&Transaction, &str) -> rusqlite::Result<()>),
}

/// Each entry upgrades the schema by one version; `PRAGMA user_version` records how
/// many have run. Never edit a shipped entry: append a new one.
const MIGRATIONS: &[Step] = &[
    Step::Sql(include_str!("migrations/001_initial.sql")),
    Step::Rust(migrate_v2::run),
];

/// The single SQLite connection shared by every command (spec V1 §8.1).
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        migrate(&mut conn, &home_dir())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Runs `f` with exclusive access to the connection.
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut conn = self.conn.lock().unwrap();
        f(&mut conn)
    }
}

/// The user's home folder: the project of workspaces that had no terminal (migration 002).
pub fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}

fn migrate(conn: &mut Connection, home: &str) -> rusqlite::Result<()> {
    migrate_up_to(conn, MIGRATIONS.len(), home)
}

/// Applies the migrations not yet run, up to version `target`. Foreign keys are
/// off during a step: rebuilding a table drops it while others still reference it,
/// so the copied rows are checked before the step commits.
fn migrate_up_to(conn: &mut Connection, target: usize, home: &str) -> rusqlite::Result<()> {
    let applied: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for index in (applied as usize)..target.min(MIGRATIONS.len()) {
        conn.execute_batch("PRAGMA foreign_keys = OFF")?;
        let result = apply(conn, index, home);
        conn.execute_batch("PRAGMA foreign_keys = ON")?;
        result?;
    }
    Ok(())
}

fn apply(conn: &mut Connection, index: usize, home: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    match &MIGRATIONS[index] {
        Step::Sql(sql) => tx.execute_batch(sql)?,
        Step::Rust(run) => run(&tx, home)?,
    }
    let orphans: i64 =
        tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0))?;
    if orphans > 0 {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
            Some(format!("migration {} : {orphans} ligne(s) orpheline(s)", index + 1)),
        ));
    }
    tx.pragma_update(None, "user_version", index as i64 + 1)?;
    tx.commit()
}

/// Unix time in milliseconds, the unit of every `*_at` column.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// Test-only: a workspace in a shared test project, for tests that do not care which.
#[cfg(test)]
pub fn test_workspace(conn: &Connection, name: &str) -> AppResult<workspaces::Workspace> {
    use rusqlite::OptionalExtension;
    const PATH: &str = "C:/dummyplane-tests";
    let existing: Option<String> = conn
        .query_row("SELECT id FROM projects WHERE path = ?1", [PATH], |row| row.get(0))
        .optional()?;
    let project_id = match existing {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO projects (id, name, path, position, created_at, last_opened_at)
                 VALUES (?1, 'tests', ?2, 0, 0, 0)",
                rusqlite::params![id, PATH],
            )?;
            id
        }
    };
    workspaces::create(conn, &project_id, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_once_and_record_the_version() {
        let db = Db::open_in_memory().unwrap();
        db.with(|conn| {
            migrate(conn, "C:/Users/me")?;
            let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            assert_eq!(version, MIGRATIONS.len() as i64);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn foreign_keys_are_back_on_after_migrating() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let on: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
                assert_eq!(on, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn reopening_a_database_file_keeps_its_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("dummyplane.db");
        let created = Db::open(&path)
            .unwrap()
            .with(|conn| test_workspace(conn, "Persisté"))
            .unwrap();
        let names: Vec<String> = Db::open(&path)
            .unwrap()
            .with(|conn| workspaces::list(conn, &created.project_id))
            .unwrap()
            .into_iter()
            .map(|w| w.name)
            .collect();
        assert_eq!(names, vec!["Persisté".to_string()]);
    }
}
```

Écrire aussi les tests de `projects.rs` et de `workspaces.rs` (fonctions encore absentes). Créer `src-tauri/src/db/projects.rs` avec seulement :

```rust
#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;
    use crate::db::{Db, nodes, workspaces};

    fn names(conn: &Connection) -> Vec<String> {
        list(conn).unwrap().into_iter().map(|p| p.name).collect()
    }

    #[test]
    fn normalizes_paths_keeping_roots() {
        assert_eq!(normalize_path("  C:\\code\\api\\ "), "C:\\code\\api");
        assert_eq!(normalize_path("C:\\"), "C:\\");
        assert_eq!(normalize_path("/"), "/");
        assert_eq!(path_key("c:/code/API/"), path_key("C:\\code\\api"));
    }

    #[test]
    fn names_a_project_after_its_last_folder() {
        assert_eq!(name_from_path("C:\\code\\api\\"), "api");
        assert_eq!(name_from_path("/home/me/web"), "web");
        assert_eq!(name_from_path("C:\\"), "C:");
    }

    #[test]
    fn creates_a_project_with_its_first_workspace() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let project = create(conn, "C:\\code\\api\\")?;
                assert_eq!((project.name.as_str(), project.path.as_str()), ("api", "C:\\code\\api"));
                assert_eq!(project.workspace_count, 1);
                let first: Vec<String> = workspaces::list(conn, &project.id)?
                    .into_iter()
                    .map(|w| w.name)
                    .collect();
                assert_eq!(first, vec!["Workspace 1"]);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn refuses_a_folder_that_is_already_a_project() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                create(conn, "C:\\code\\api")?;
                let err = create(conn, "c:/code/API/").unwrap_err();
                assert_eq!(err.kind(), "invalidInput");
                assert_eq!(create(conn, "   ").unwrap_err().kind(), "invalidInput");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn renames_relocates_and_touches() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let a = create(conn, "C:\\a")?;
                let b = create(conn, "C:\\b")?;
                rename(conn, &a.id, "  Front ")?;
                assert_eq!(names(conn), vec!["Front", "b"]);
                relocate(conn, &a.id, "C:\\A\\")?;
                assert_eq!(get(conn, &a.id)?.path, "C:\\A");
                assert_eq!(relocate(conn, &a.id, "c:\\B").unwrap_err().kind(), "invalidInput");
                touch(conn, &b.id)?;
                assert!(get(conn, &b.id)?.last_opened_at > 0);
                assert_eq!(rename(conn, "nope", "x").unwrap_err().kind(), "notFound");
                assert_eq!(rename(conn, &a.id, " ").unwrap_err().kind(), "invalidInput");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn deletes_a_project_and_reports_what_went_with_it() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let project = create(conn, "C:\\a")?;
                let first = workspaces::list(conn, &project.id)?.remove(0);
                nodes::save(conn, "t1", &first.id, nodes::NodeKind::Terminal, "{}")?;
                assert_eq!(node_ids(conn, &project.id)?, vec!["t1".to_string()]);
                let deleted = delete(conn, &project.id)?;
                assert_eq!(deleted.workspace_ids, vec![first.id]);
                assert_eq!(deleted.node_ids, vec!["t1".to_string()]);
                assert!(names(conn).is_empty());
                assert_eq!(delete(conn, "nope").unwrap_err().kind(), "notFound");
                Ok(())
            })
            .unwrap();
    }
}
```

Remplacer le module `tests` de `src-tauri/src/db/workspaces.rs` par :

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn project(conn: &Connection, path: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO projects (id, name, path, position, created_at, last_opened_at) VALUES (?1, 'p', ?2, 0, 0, 0)",
            params![id, path],
        )
        .unwrap();
        id
    }

    fn names(conn: &Connection, project_id: &str) -> Vec<String> {
        list(conn, project_id).unwrap().into_iter().map(|w| w.name).collect()
    }

    #[test]
    fn creates_workspaces_in_order_within_their_project() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let p = project(conn, "C:/p");
                let q = project(conn, "C:/q");
                let first = create(conn, &p, "  Front  ")?;
                let other = create(conn, &q, "Ailleurs")?;
                let second = create(conn, &p, "API")?;
                assert_eq!((first.position, second.position, other.position), (0, 1, 0));
                assert_eq!(names(conn, &p), vec!["Front", "API"]);
                assert_eq!(first.project_id, p);
                assert_eq!(first.pantheon, None);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn rejects_blank_names() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let p = project(conn, "C:/p");
                assert_eq!(create(conn, &p, "   ").unwrap_err().kind(), "invalidInput");
                let w = create(conn, &p, "A")?;
                assert_eq!(rename(conn, &w.id, " ").unwrap_err().kind(), "invalidInput");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn renames_and_reports_unknown_ids() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let p = project(conn, "C:/p");
                let w = create(conn, &p, "A")?;
                rename(conn, &w.id, "B")?;
                assert_eq!(names(conn, &p), vec!["B"]);
                assert_eq!(rename(conn, "nope", "C").unwrap_err().kind(), "notFound");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn deletes_a_workspace_but_never_the_last_of_its_project() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let p = project(conn, "C:/p");
                let q = project(conn, "C:/q");
                let a = create(conn, &p, "A")?;
                let b = create(conn, &p, "B")?;
                create(conn, &q, "Q")?;
                delete(conn, &a.id)?;
                assert_eq!(names(conn, &p), vec!["B"]);
                assert_eq!(delete(conn, &b.id).unwrap_err().kind(), "invalidInput");
                assert_eq!(delete(conn, "nope").unwrap_err().kind(), "notFound");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn remembers_the_pantheon_of_ungrouped_agents() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let p = project(conn, "C:/p");
                let w = create(conn, &p, "A")?;
                set_pantheon(conn, &w.id, "egyptian")?;
                assert_eq!(list(conn, &p)?[0].pantheon.as_deref(), Some("egyptian"));
                assert_eq!(set_pantheon(conn, &w.id, " ").unwrap_err().kind(), "invalidInput");
                assert_eq!(set_pantheon(conn, "nope", "greek").unwrap_err().kind(), "notFound");
                Ok(())
            })
            .unwrap();
    }
}
```

Dans les modules de test de `nodes.rs`, `scenes.rs`, `scrollback.rs` : remplacer `workspaces` par `test_workspace` dans la ligne `use crate::db::{…}` (`use crate::db::{Db, test_workspace};`, et pour `scenes.rs` `use crate::db::{Db, scrollback, test_workspace};`), puis chaque appel `workspaces::create(conn, ` par `test_workspace(conn, `. Dans `commands/workspace.rs` (module `tests`), remplacer `workspaces::create(conn, ` par `crate::db::test_workspace(conn, `.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -30`
Expected: échec de compilation : `cannot find function normalize_path`, `create` attend 3 arguments, `set_pantheon` introuvable, etc.

- [ ] **Step 3: Écrire la migration 002**

`src-tauri/src/db/migrations/002_projects.sql` :

```sql
-- Schema v2 (spec habillage §15.1): projects, workspaces scoped to a project, and
-- the 'orchestrator' node kind. migrate_v2.rs runs this file, fills the new tables
-- and swaps them in, with foreign keys off (see db::migrate_up_to).
CREATE TABLE projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  path           TEXT NOT NULL UNIQUE,
  position       INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);

CREATE TABLE workspaces_new (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  pantheon   TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE nodes_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('terminal', 'orchestrator', 'note', 'kanban', 'git')),
  payload_json TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

Dans `src-tauri/src/db/migrate_v2.rs`, remplacer l'en-tête et `run` (garder le module `tests`) :

```rust
//! Migration 002 (spec habillage §15.1): workspaces move into projects — one per
//! folder, taken from each workspace's first terminal — and nodes accept the
//! `orchestrator` kind. Both tables are rebuilt: SQLite cannot add a NOT NULL
//! foreign key or change a CHECK constraint in place.

use std::collections::HashMap;

use rusqlite::{Transaction, params};

use super::now_ms;
use super::projects::{name_from_path, normalize_path, path_key};

pub fn run(tx: &Transaction, home: &str) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/002_projects.sql"))?;
    let workspaces = {
        let mut stmt = tx.prepare(
            "SELECT id, name, position, created_at, updated_at FROM workspaces ORDER BY position, created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let now = now_ms();
    let mut projects: HashMap<String, String> = HashMap::new();
    for (id, name, position, created_at, updated_at) in workspaces {
        let path = first_terminal_folder(tx, &id)?.unwrap_or_else(|| normalize_path(home));
        let project_id = match projects.get(&path_key(&path)) {
            Some(project_id) => project_id.clone(),
            None => {
                let project_id = uuid::Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO projects (id, name, path, position, created_at, last_opened_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![project_id, name_from_path(&path), path, projects.len() as i64, now],
                )?;
                projects.insert(path_key(&path), project_id.clone());
                project_id
            }
        };
        tx.execute(
            "INSERT INTO workspaces_new (id, project_id, name, position, pantheon, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)",
            params![id, project_id, name, position, created_at, updated_at],
        )?;
    }
    tx.execute_batch(
        "INSERT INTO nodes_new (id, workspace_id, kind, payload_json, updated_at)
           SELECT id, workspace_id, kind, payload_json, updated_at FROM nodes;
         DROP TABLE nodes;
         DROP TABLE workspaces;
         ALTER TABLE workspaces_new RENAME TO workspaces;
         ALTER TABLE nodes_new RENAME TO nodes;
         CREATE INDEX nodes_workspace ON nodes(workspace_id);
         CREATE INDEX workspaces_project ON workspaces(project_id);",
    )
}

/// The folder of the oldest-saved terminal of a workspace that names one.
fn first_terminal_folder(tx: &Transaction, workspace_id: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = tx.prepare(
        "SELECT payload_json FROM nodes WHERE workspace_id = ?1 AND kind = 'terminal' ORDER BY updated_at",
    )?;
    let payloads = stmt.query_map([workspace_id], |row| row.get::<_, String>(0))?;
    for payload in payloads {
        let payload = payload?;
        let folder = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .and_then(|value| {
                value
                    .get("cwd")?
                    .as_str()
                    .map(str::trim)
                    .filter(|cwd| !cwd.is_empty())
                    .map(normalize_path)
            });
        if folder.is_some() {
            return Ok(folder);
        }
    }
    Ok(None)
}
```

- [ ] **Step 4: Écrire `projects.rs` et `workspaces.rs`**

Ajouter avant le module `tests` de `src-tauri/src/db/projects.rs` :

```rust
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use super::{now_ms, workspaces};
use crate::error::{AppError, AppResult};

/// A project is a repository folder holding workspaces (spec habillage §6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub position: i64,
    pub last_opened_at: i64,
    pub workspace_count: i64,
}

/// What deleting a project took with it: its workspaces and their nodes.
pub struct Deleted {
    pub workspace_ids: Vec<String>,
    pub node_ids: Vec<String>,
}

/// Trims spaces and trailing separators, keeping a drive or filesystem root intact.
pub fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    let bare = trimmed.trim_end_matches(['\\', '/']);
    if bare.is_empty() || bare.ends_with(':') {
        trimmed.to_string()
    } else {
        bare.to_string()
    }
}

/// Two paths name the same folder when their keys match: Windows ignores case and
/// accepts either separator.
pub fn path_key(path: &str) -> String {
    normalize_path(path).replace('/', "\\").to_lowercase()
}

/// The last folder of a path ("C:\code\api" gives "api"), or the root itself.
pub fn name_from_path(path: &str) -> String {
    let path = normalize_path(path);
    path.rsplit(['\\', '/'])
        .find(|part| !part.is_empty())
        .unwrap_or(&path)
        .to_string()
}

const SELECT: &str = "SELECT p.id, p.name, p.path, p.position, p.last_opened_at,
  (SELECT COUNT(*) FROM workspaces w WHERE w.project_id = p.id) FROM projects p";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        position: row.get(3)?,
        last_opened_at: row.get(4)?,
        workspace_count: row.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY p.position, p.created_at"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Project> {
    conn.query_row(&format!("{SELECT} WHERE p.id = ?1"), [id], from_row)
        .optional()?
        .ok_or_else(|| not_found(id))
}

/// Adds a project for `path`, with its first workspace.
pub fn create(conn: &Connection, path: &str) -> AppResult<Project> {
    let path = valid_path(conn, path, None)?;
    let id = uuid::Uuid::new_v4().to_string();
    let tx = conn.unchecked_transaction()?;
    let position: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM projects",
        [],
        |row| row.get(0),
    )?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO projects (id, name, path, position, created_at, last_opened_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, name_from_path(&path), path, position, now],
    )?;
    workspaces::create(&tx, &id, "Workspace 1")?;
    tx.commit()?;
    get(conn, &id)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("le nom du projet est vide".into()));
    }
    changed(
        conn.execute("UPDATE projects SET name = ?2 WHERE id = ?1", params![id, name])?,
        id,
    )
}

pub fn relocate(conn: &Connection, id: &str, path: &str) -> AppResult<()> {
    let path = valid_path(conn, path, Some(id))?;
    changed(
        conn.execute("UPDATE projects SET path = ?2 WHERE id = ?1", params![id, path])?,
        id,
    )
}

/// Records that the project was just opened (recent projects come first).
pub fn touch(conn: &Connection, id: &str) -> AppResult<()> {
    changed(
        conn.execute(
            "UPDATE projects SET last_opened_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?,
        id,
    )
}

/// Ids of the nodes of every workspace of the project.
pub fn node_ids(conn: &Connection, id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT n.id FROM nodes n JOIN workspaces w ON w.id = n.workspace_id WHERE w.project_id = ?1",
    )?;
    let ids = stmt.query_map([id], |row| row.get(0))?;
    Ok(ids.collect::<rusqlite::Result<_>>()?)
}

/// Deletes a project and, by cascade, its workspaces and their content.
pub fn delete(conn: &Connection, id: &str) -> AppResult<Deleted> {
    let tx = conn.unchecked_transaction()?;
    let workspace_ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM workspaces WHERE project_id = ?1")?;
        let ids = stmt.query_map([id], |row| row.get(0))?;
        ids.collect::<rusqlite::Result<_>>()?
    };
    let node_ids = node_ids(&tx, id)?;
    changed(tx.execute("DELETE FROM projects WHERE id = ?1", [id])?, id)?;
    tx.commit()?;
    Ok(Deleted {
        workspace_ids,
        node_ids,
    })
}

fn valid_path(conn: &Connection, path: &str, except: Option<&str>) -> AppResult<String> {
    let path = normalize_path(path);
    if path.is_empty() {
        return Err(AppError::InvalidInput("le dossier du projet est vide".into()));
    }
    let key = path_key(&path);
    let mut stmt = conn.prepare("SELECT id, path FROM projects")?;
    let others = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if others
        .iter()
        .any(|(id, other)| Some(id.as_str()) != except && path_key(other) == key)
    {
        return Err(AppError::InvalidInput(format!(
            "ce dossier est déjà un projet : {path}"
        )));
    }
    Ok(path)
}

fn changed(rows: usize, id: &str) -> AppResult<()> {
    if rows == 0 {
        Err(not_found(id))
    } else {
        Ok(())
    }
}

fn not_found(id: &str) -> AppError {
    AppError::NotFound(format!("projet introuvable : {id}"))
}
```

Remplacer tout ce qui précède le module `tests` de `src-tauri/src/db/workspaces.rs` par :

```rust
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use super::now_ms;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub position: i64,
    /// Pantheon of the agents outside any group (spec habillage §9.2).
    pub pantheon: Option<String>,
}

pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, name, position, pantheon FROM workspaces
         WHERE project_id = ?1 ORDER BY position, created_at",
    )?;
    let rows = stmt.query_map([project_id], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            position: row.get(3)?,
            pantheon: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn create(conn: &Connection, project_id: &str, name: &str) -> AppResult<Workspace> {
    let name = valid_name(name)?;
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM workspaces WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )?;
    let workspace = Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        name,
        position,
        pantheon: None,
    };
    let now = now_ms();
    conn.execute(
        "INSERT INTO workspaces (id, project_id, name, position, pantheon, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)",
        params![workspace.id, workspace.project_id, workspace.name, workspace.position, now],
    )?;
    Ok(workspace)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    let name = valid_name(name)?;
    let changed = conn.execute(
        "UPDATE workspaces SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now_ms()],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

/// Deletes a workspace and, by cascade, its scene, files, nodes and scrollback.
/// The last workspace of a project cannot be deleted: a project always shows one.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let project_id: String = conn
        .query_row("SELECT project_id FROM workspaces WHERE id = ?1", [id], |row| row.get(0))
        .optional()?
        .ok_or_else(|| not_found(id))?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspaces WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )?;
    if count <= 1 {
        return Err(AppError::InvalidInput(
            "impossible de supprimer le dernier workspace du projet".into(),
        ));
    }
    conn.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_pantheon(conn: &Connection, id: &str, pantheon: &str) -> AppResult<()> {
    let pantheon = pantheon.trim();
    if pantheon.is_empty() {
        return Err(AppError::InvalidInput("panthéon vide".into()));
    }
    let changed = conn.execute(
        "UPDATE workspaces SET pantheon = ?2 WHERE id = ?1",
        params![id, pantheon],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

fn valid_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("le nom du workspace est vide".into()));
    }
    Ok(name.to_string())
}

fn not_found(id: &str) -> AppError {
    AppError::NotFound(format!("workspace introuvable : {id}"))
}
```

Les commandes de `src-tauri/src/commands/workspace.rs` qui appellent `workspaces::list(conn)` et `workspaces::create(conn, &name)` ne compilent plus : les adapter dès maintenant (la Tâche 2 les enrichit) :

```rust
#[tauri::command]
pub async fn list_workspaces(db: State<'_, Db>, project_id: String) -> AppResult<Vec<Workspace>> {
    db.with(|conn| workspaces::list(conn, &project_id))
}

#[tauri::command]
pub async fn create_workspace(
    db: State<'_, Db>,
    project_id: String,
    name: String,
) -> AppResult<Workspace> {
    db.with(|conn| workspaces::create(conn, &project_id, &name))
}
```

- [ ] **Step 5: Lancer les tests et les voir passer**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -5`
Expected: `test result: ok.` (environ 70 tests, 1 ignoré).

- [ ] **Step 6: Tester la migration sur une copie de la vraie base**

Run (Git Bash) : `cp "$APPDATA/dev.dummyplane.app/dummyplane.db" /tmp/ovcopy.db && DUMMYPLANE_DB_COPY=/tmp/ovcopy.db cargo test --manifest-path src-tauri/Cargo.toml --lib migrates_a_copy_of_the_real_database -- --ignored --nocapture`
Expected: PASS, et une ligne du type `("mk-webapp", "C:\\Users\\Spectrum\\Documents\\02_Code_Projects\\mk-webapp", 1)`. Supprimer `/tmp/ovcopy.db` ensuite. La vraie base n'est pas touchée.

- [ ] **Step 7: Format, lint, commit**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: aucun avertissement.

```bash
rm -f *.stackdump
git add src-tauri/src/db src-tauri/src/commands/workspace.rs
git commit -m "feat(db): projects and migration 002

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Commandes Rust des projets, des workspaces et de git

**Files:**
- Create: `src-tauri/src/process.rs`, `src-tauri/src/git.rs`, `src-tauri/src/commands/project.rs`, `src-tauri/src/commands/git.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/workspace.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Tâche 1 (`projects::*`, `workspaces::set_pantheon`).
- Produces (commandes Tauri, arguments en camelCase côté JS) :
  - `list_projects() -> ProjectView[]` avec `ProjectView = Project + { missing: bool, liveAgents: number }`
  - `create_project(path) -> ProjectView` (refuse un dossier inexistant : `notFound`)
  - `rename_project(id, name)`, `relocate_project(id, path)`, `open_project(id)`
  - `delete_project(id) -> string[]` (ids des workspaces supprimés ; arrête les terminaux)
  - `list_workspaces(projectId)`, `create_workspace(projectId, name)`, `set_workspace_pantheon(id, pantheon)`
  - `git_status(path) -> { branch: string, changed: number } | null`
  - `crate::process::hide_window(&mut Command) -> &mut Command`
  - `crate::git::{GitStatus, parse_status(&str) -> GitStatus, status(&Path) -> Option<GitStatus>}`

- [ ] **Step 1: Écrire les tests de git et des commandes de projet**

`src-tauri/src/process.rs` :

```rust
use std::process::Command;

/// A GUI app on Windows opens a console window for every child process unless it
/// asks not to; git and ollama are run this way.
pub fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}
```

`src-tauri/src/git.rs`, tests d'abord (avec des fonctions vides qui renvoient des valeurs fausses) :

```rust
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub changed: u32,
}

pub fn parse_status(_output: &str) -> GitStatus {
    GitStatus {
        branch: String::new(),
        changed: 0,
    }
}

pub fn status(_path: &Path) -> Option<GitStatus> {
    None
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn reads_the_branch_and_counts_changed_paths() {
        let status = parse_status("## main...origin/main [ahead 1]\n M src/a.ts\n?? b.txt\n");
        assert_eq!(
            status,
            GitStatus {
                branch: "main".into(),
                changed: 2
            }
        );
        assert_eq!(parse_status("## feat/x\n").branch, "feat/x");
        assert_eq!(parse_status("## No commits yet on main\n").branch, "main");
        assert_eq!(parse_status("## HEAD (no branch)\n").branch, "HEAD");
        assert_eq!(parse_status("").changed, 0);
    }

    #[test]
    fn is_none_outside_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(status(dir.path()), None);
    }

    #[test]
    fn counts_the_changes_of_a_real_repository() {
        let dir = tempfile::tempdir().unwrap();
        let init = Command::new("git").arg("-C").arg(dir.path()).arg("init").output();
        if init.is_err() {
            return; // git is not installed on this machine
        }
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let read = status(dir.path()).unwrap();
        assert_eq!(read.changed, 1);
        assert!(!read.branch.is_empty());
    }
}
```

Créer `src-tauri/src/commands/test_support.rs` en y déplaçant `NullSink` et `run_terminal` du module de test de `commands/workspace.rs` (les rendre `pub`, garder leur code), avec l'en-tête :

```rust
//! Helpers shared by the command tests that run real terminals (Windows only).

use std::sync::mpsc;

use crate::pty::session::OutputSink;
use crate::pty::shell::SpawnPlan;
use crate::pty::{PtyManager, pty_size};

pub struct NullSink;

impl OutputSink for NullSink {
    fn send(&self, _bytes: &[u8]) -> bool {
        true
    }
}

/// Starts an idle cmd.exe for `node_id`; the receiver fires when it exits.
pub fn run_terminal(pty: &PtyManager, node_id: &str) -> mpsc::Receiver<()> {
    let plan = SpawnPlan {
        program: "cmd.exe".into(),
        args: vec![],
        cwd: std::env::temp_dir(),
        env: vec![],
        initial_input: None,
    };
    let (tx, rx) = mpsc::channel();
    pty.spawn(
        node_id,
        plan,
        pty_size(80, 24),
        Box::new(NullSink),
        move |_| {
            let _ = tx.send(());
        },
    )
    .unwrap();
    rx
}
```

Dans `commands/workspace.rs`, le module `tests` ne garde que ses deux tests, précédés de :

```rust
#[cfg(all(test, windows))]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::commands::test_support::run_terminal;
```

Dans `src-tauri/src/commands/mod.rs`, ajouter :

```rust
pub mod git;
pub mod project;
#[cfg(all(test, windows))]
mod test_support;
```

`src-tauri/src/commands/project.rs`, tests d'abord (corps de commandes à écrire à l'étape 3) :

```rust
#[cfg(all(test, windows))]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::commands::test_support::run_terminal;
    use crate::db::{nodes, workspaces};

    #[test]
    fn deleting_a_project_stops_the_terminals_of_all_its_workspaces() {
        let db = Db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let project = db
            .with(|conn| projects::create(conn, &dir.path().to_string_lossy()))
            .unwrap();
        let second = db
            .with(|conn| workspaces::create(conn, &project.id, "B"))
            .unwrap();
        db.with(|conn| nodes::save(conn, "t", &second.id, nodes::NodeKind::Terminal, "{}"))
            .unwrap();
        let pty = PtyManager::default();
        let exited = run_terminal(&pty, "t");
        let deleted = delete_project_and_stop(&db, &pty, &project.id).unwrap();
        assert_eq!(deleted.len(), 2);
        exited
            .recv_timeout(Duration::from_secs(20))
            .expect("the terminals of a deleted project must stop");
    }

    #[test]
    fn counts_live_agents_and_missing_folders() {
        let db = Db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let project = db
            .with(|conn| projects::create(conn, &dir.path().to_string_lossy()))
            .unwrap();
        let first = db.with(|conn| workspaces::list(conn, &project.id)).unwrap().remove(0);
        db.with(|conn| nodes::save(conn, "t", &first.id, nodes::NodeKind::Terminal, "{}"))
            .unwrap();
        let pty = PtyManager::default();
        let _exited = run_terminal(&pty, "t");
        let views = project_views(&db, &pty).unwrap();
        assert_eq!((views[0].live_agents, views[0].missing), (1, false));
        pty.kill_all();
        drop(dir);
        let views = project_views(&db, &pty).unwrap();
        assert!(views[0].missing);
    }
}
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -20`
Expected: échec de compilation (`delete_project_and_stop`, `project_views` introuvables) ; une fois l'étape 3 commencée par `project.rs`, les tests de `git.rs` échouent sur `parse_status`.

- [ ] **Step 3: Écrire git, les commandes et l'enregistrement**

Corps réels de `src-tauri/src/git.rs` (remplacer les deux fonctions vides) :

```rust
use std::process::Command;

use crate::process::hide_window;

/// Reads `git status --porcelain=v1 -b`: the first line names the branch, every
/// other line is one changed path.
pub fn parse_status(output: &str) -> GitStatus {
    let mut lines = output.lines();
    let header = lines.next().unwrap_or("").trim_start_matches("## ");
    let branch = if let Some(rest) = header.strip_prefix("No commits yet on ") {
        rest
    } else if let Some(rest) = header.strip_prefix("Initial commit on ") {
        rest
    } else if header.starts_with("HEAD (no branch)") {
        "HEAD"
    } else {
        header
            .split("...")
            .next()
            .unwrap_or(header)
            .split(' ')
            .next()
            .unwrap_or("")
    };
    let changed = lines.filter(|line| !line.trim().is_empty()).count() as u32;
    GitStatus {
        branch: branch.to_string(),
        changed,
    }
}

/// None when `path` is not inside a git repository or git is not installed.
pub fn status(path: &Path) -> Option<GitStatus> {
    let output = hide_window(
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["status", "--porcelain=v1", "-b", "--untracked-files=normal"]),
    )
    .output()
    .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(parse_status(&String::from_utf8_lossy(&output.stdout)))
}
```

(`use std::process::Command;` et `use crate::process::hide_window;` vont en tête du fichier, à côté des autres `use`.)

`src-tauri/src/commands/git.rs` :

```rust
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::{self, GitStatus};

/// Branch and changed-file count of the project folder (spec habillage §5.6).
#[tauri::command]
pub async fn git_status(path: String) -> AppResult<Option<GitStatus>> {
    tauri::async_runtime::spawn_blocking(move || git::status(Path::new(&path)))
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))
}
```

Haut de `src-tauri/src/commands/project.rs` (au-dessus du module `tests`) :

```rust
use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::db::projects::{self, Project};
use crate::error::{AppError, AppResult};
use crate::pty::PtyManager;

/// A project as the home screen shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    /// Its folder no longer exists (moved or deleted while the app was closed).
    pub missing: bool,
    /// Terminals of its workspaces whose process runs.
    pub live_agents: usize,
}

pub fn project_views(db: &Db, pty: &PtyManager) -> AppResult<Vec<ProjectView>> {
    let live: HashSet<String> = pty.list().into_iter().collect();
    db.with(|conn| {
        projects::list(conn)?
            .into_iter()
            .map(|project| {
                let live_agents = projects::node_ids(conn, &project.id)?
                    .iter()
                    .filter(|id| live.contains(*id))
                    .count();
                let missing = !Path::new(&project.path).is_dir();
                Ok(ProjectView {
                    project,
                    missing,
                    live_agents,
                })
            })
            .collect()
    })
}

fn existing_folder(path: &str) -> AppResult<()> {
    if Path::new(path.trim()).is_dir() {
        Ok(())
    } else {
        Err(AppError::NotFound(format!(
            "dossier introuvable : {}",
            path.trim()
        )))
    }
}

#[tauri::command]
pub async fn list_projects(
    db: State<'_, Db>,
    pty: State<'_, PtyManager>,
) -> AppResult<Vec<ProjectView>> {
    project_views(&db, &pty)
}

#[tauri::command]
pub async fn create_project(db: State<'_, Db>, path: String) -> AppResult<ProjectView> {
    existing_folder(&path)?;
    let project = db.with(|conn| projects::create(conn, &path))?;
    Ok(ProjectView {
        project,
        missing: false,
        live_agents: 0,
    })
}

#[tauri::command]
pub async fn rename_project(db: State<'_, Db>, id: String, name: String) -> AppResult<()> {
    db.with(|conn| projects::rename(conn, &id, &name))
}

#[tauri::command]
pub async fn relocate_project(db: State<'_, Db>, id: String, path: String) -> AppResult<()> {
    existing_folder(&path)?;
    db.with(|conn| projects::relocate(conn, &id, &path))
}

#[tauri::command]
pub async fn open_project(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.with(|conn| projects::touch(conn, &id))
}

#[tauri::command]
pub async fn delete_project(
    db: State<'_, Db>,
    pty: State<'_, PtyManager>,
    id: String,
) -> AppResult<Vec<String>> {
    delete_project_and_stop(&db, &pty, &id)
}

/// Deletes a project, then stops the terminals of all its workspaces, including
/// those the front never displayed. Returns the ids of the deleted workspaces.
pub fn delete_project_and_stop(db: &Db, pty: &PtyManager, id: &str) -> AppResult<Vec<String>> {
    let deleted = db.with(|conn| projects::delete(conn, id))?;
    for node_id in deleted.node_ids {
        pty.kill(&node_id);
    }
    Ok(deleted.workspace_ids)
}
```

Ajouter à `src-tauri/src/commands/workspace.rs` :

```rust
#[tauri::command]
pub async fn set_workspace_pantheon(
    db: State<'_, Db>,
    id: String,
    pantheon: String,
) -> AppResult<()> {
    db.with(|conn| workspaces::set_pantheon(conn, &id, &pantheon))
}
```

Dans `src-tauri/src/lib.rs` : ajouter `mod git;` et `mod process;` aux déclarations de modules, et dans `generate_handler!` les lignes :

```rust
            commands::project::list_projects,
            commands::project::create_project,
            commands::project::rename_project,
            commands::project::relocate_project,
            commands::project::open_project,
            commands::project::delete_project,
            commands::workspace::set_workspace_pantheon,
            commands::git::git_status,
```

- [ ] **Step 4: Lancer les tests et les voir passer**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -5`
Expected: `test result: ok.`

- [ ] **Step 5: Format, lint, commit**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: aucun avertissement.

```bash
rm -f *.stackdump
git add src-tauri/src
git commit -m "feat: project, workspace and git commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: IPC et stores du front pour les projets

**Files:**
- Modify: `src/ipc/db.ts`, `src/store/workspaces.ts`, `src/store/workspaces.test.ts`, `src/app/boot.ts`
- Create: `src/ipc/git.ts`, `src/store/projects.ts`, `src/store/projects.test.ts`, `src/app/forget.ts`

**Interfaces:**
- Consumes: commandes de la Tâche 2.
- Produces:
  - `ipc/db.ts` : `Project { id, name, path, position, lastOpenedAt, workspaceCount, missing, liveAgents }`, `Workspace { id, projectId, name, position, pantheon: string | null }`, `listProjects()`, `createProject(path)`, `renameProject(id, name)`, `relocateProject(id, path)`, `openProject(id)`, `deleteProject(id): Promise<string[]>`, `listWorkspaces(projectId)`, `createWorkspace(projectId, name)`, `setWorkspacePantheon(id, pantheon)`.
  - `ipc/git.ts` : `GitStatus { branch, changed }`, `gitStatus(path): Promise<GitStatus | null>`.
  - `store/projects.ts` : `projectsStore`, `useProjects(selector)`, `createProjectsStore(deps)`, état `{ projects, activeId, view: "loading" | "home" | "project" | "error", error? }`, actions `init()`, `open(id)`, `add(path)`, `goHome()`, `close()`, `rename(id, name)`, `relocate(id, path)`, `remove(id)`, `refresh()`.
  - `store/workspaces.ts` : `load(projectId)` remplace `init()` ; `projectId: string | null` dans l'état ; `ensurePantheon(id): Promise<string>` (implémenté en Tâche 10, déclaré ici comme `setPantheon(id, pantheon): Promise<void>`).
  - `app/forget.ts` : `forgetWorkspaces(ids: string[]): void`.

- [ ] **Step 1: Écrire les tests**

Remplacer `src/store/workspaces.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Workspace } from "@/ipc/db";
import { createWorkspacesStore, nextDefaultName } from "./workspaces";

/** In-memory stand-in for the Rust workspace commands of project "p1". */
function fakeBackend(initial: string[] = [], activeSetting: string | null = null) {
  let counter = 0;
  const make = (name: string, position: number): Workspace => ({
    id: `w${++counter}`,
    projectId: "p1",
    name,
    position,
    pantheon: null,
  });
  const db = {
    workspaces: initial.map(make),
    settings: new Map<string, unknown>(activeSetting ? [["ui.activeWorkspaceId.p1", activeSetting]] : []),
  };
  mockIPC((cmd, raw) => {
    const args = raw as Record<string, string>;
    switch (cmd) {
      case "list_workspaces":
        return db.workspaces.filter((w) => w.projectId === args.projectId).map((w) => ({ ...w }));
      case "create_workspace": {
        const w = make(args.name, db.workspaces.length);
        db.workspaces.push(w);
        return w;
      }
      case "rename_workspace":
        db.workspaces = db.workspaces.map((w) => (w.id === args.id ? { ...w, name: args.name } : w));
        return;
      case "delete_workspace":
        db.workspaces = db.workspaces.filter((w) => w.id !== args.id);
        return;
      case "set_workspace_pantheon":
        db.workspaces = db.workspaces.map((w) => (w.id === args.id ? { ...w, pantheon: args.pantheon } : w));
        return;
      case "get_setting":
        return db.settings.get(args.key) ?? null;
      case "set_setting":
        db.settings.set(args.key, (raw as { value: unknown }).value);
        return;
    }
  });
  return db;
}

let store: ReturnType<typeof createWorkspacesStore>;
const state = () => store.getState();
const names = () => state().workspaces.map((w) => w.name);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store = createWorkspacesStore();
});
afterEach(() => clearMocks());

describe("nextDefaultName", () => {
  it("uses the smallest free number", () => {
    const ws = (...n: string[]) =>
      n.map((name, i) => ({ id: String(i), projectId: "p1", name, position: i, pantheon: null }));
    expect(nextDefaultName([])).toBe("Workspace 1");
    expect(nextDefaultName(ws("Workspace 2"))).toBe("Workspace 1");
    expect(nextDefaultName(ws("Workspace 1", "Workspace 2"))).toBe("Workspace 3");
  });
});

describe("workspaces store", () => {
  it("creates a first workspace when a project has none", async () => {
    const db = fakeBackend();
    await state().load("p1");
    expect(names()).toEqual(["Workspace 1"]);
    expect(db.workspaces).toHaveLength(1);
    expect(state().status).toBe("ready");
    expect(state().projectId).toBe("p1");
  });

  it("reopens the workspace that was active last time in this project", async () => {
    fakeBackend(["A", "B"], "w2");
    await state().load("p1");
    expect(state().activeId).toBe("w2");
  });

  it("falls back to the first workspace when the saved one is gone", async () => {
    fakeBackend(["A"], "deleted");
    await state().load("p1");
    expect(state().activeId).toBe("w1");
  });

  it("creates a workspace in the project, makes it active and remembers it", async () => {
    const db = fakeBackend(["Workspace 1"]);
    await state().load("p1");
    await state().create();
    await settled();
    expect(names()).toEqual(["Workspace 1", "Workspace 2"]);
    expect(db.workspaces[1].projectId).toBe("p1");
    expect(db.settings.get("ui.activeWorkspaceId.p1")).toBe(state().activeId);
  });

  it("renames with trimming and ignores blank names", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().rename("w1", "  Front  ");
    await state().rename("w1", "   ");
    expect(names()).toEqual(["Front"]);
    expect(db.workspaces[0].name).toBe("Front");
  });

  it("never removes the last workspace", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().remove("w1");
    expect(names()).toEqual(["A"]);
    expect(db.workspaces).toHaveLength(1);
  });

  it("selects the next workspace when the active one is removed, or the previous when it was last", async () => {
    fakeBackend(["A", "B", "C"]);
    await state().load("p1");
    state().select("w2");
    await state().remove("w2");
    expect(state().activeId).toBe("w3");
    await state().remove("w3");
    expect(state().activeId).toBe("w1");
  });

  it("saves the pantheon of a workspace", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().setPantheon("w1", "greek");
    expect(state().workspaces[0].pantheon).toBe("greek");
    expect(db.workspaces[0].pantheon).toBe("greek");
  });

  it("reports a backend failure", async () => {
    mockIPC(() => {
      throw { kind: "db", message: "disk I/O error" };
    });
    await state().load("p1");
    expect(state().status).toBe("error");
    expect(state().error).toContain("disk I/O error");
  });
});
```

Créer `src/store/projects.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Project } from "@/ipc/db";
import { createProjectsStore } from "./projects";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    path: `C:\\${id}`,
    position: 0,
    lastOpenedAt: 0,
    workspaceCount: 1,
    missing: false,
    liveAgents: 0,
    ...overrides,
  };
}

function fakeBackend(projects: Project[], active: string | null = null) {
  const db = {
    projects: [...projects],
    settings: new Map<string, unknown>(active !== null ? [["ui.activeProjectId", active]] : []),
    opened: [] as string[],
  };
  mockIPC((cmd, raw) => {
    const args = raw as Record<string, string>;
    switch (cmd) {
      case "list_projects":
        return db.projects.map((p) => ({ ...p }));
      case "create_project": {
        const created = project(`p${db.projects.length + 1}`, { path: args.path, name: "new" });
        db.projects.push(created);
        return created;
      }
      case "open_project":
        db.opened.push(args.id);
        return;
      case "rename_project":
        db.projects = db.projects.map((p) => (p.id === args.id ? { ...p, name: args.name } : p));
        return;
      case "relocate_project":
        db.projects = db.projects.map((p) => (p.id === args.id ? { ...p, path: args.path } : p));
        return;
      case "delete_project":
        db.projects = db.projects.filter((p) => p.id !== args.id);
        return ["w1", "w2"];
      case "get_setting":
        return db.settings.get(args.key) ?? null;
      case "set_setting":
        db.settings.set(args.key, (raw as { value: unknown }).value);
        return;
    }
  });
  return db;
}

const deps = { loadWorkspaces: vi.fn(async () => undefined), forgetWorkspaces: vi.fn() };
let store: ReturnType<typeof createProjectsStore>;
const state = () => store.getState();

beforeEach(() => {
  deps.loadWorkspaces.mockClear();
  deps.forgetWorkspaces.mockClear();
  store = createProjectsStore(deps);
});
afterEach(() => clearMocks());

describe("projects store", () => {
  it("reopens the last project and loads its workspaces", async () => {
    const db = fakeBackend([project("a"), project("b")], "b");
    await state().init();
    expect(state().view).toBe("project");
    expect(state().activeId).toBe("b");
    expect(deps.loadWorkspaces).toHaveBeenCalledWith("b");
    expect(db.opened).toEqual(["b"]);
  });

  it("shows the home screen when the saved project's folder is gone", async () => {
    fakeBackend([project("a", { missing: true })], "a");
    await state().init();
    expect(state().view).toBe("home");
    expect(deps.loadWorkspaces).not.toHaveBeenCalled();
  });

  it("opens the most recent project when none was ever chosen", async () => {
    fakeBackend([project("a", { lastOpenedAt: 1 }), project("b", { lastOpenedAt: 5 }), project("c", { lastOpenedAt: 9, missing: true })]);
    await state().init();
    expect(state().activeId).toBe("b");
  });

  it("shows the home screen after the project was closed", async () => {
    fakeBackend([project("a")], "");
    await state().init();
    expect(state().view).toBe("home");
  });

  it("adds a folder as a project and opens it", async () => {
    const db = fakeBackend([], "");
    await state().init();
    await state().add("C:\\code\\web");
    expect(state().projects.map((p) => p.path)).toEqual(["C:\\code\\web"]);
    expect(state().view).toBe("project");
    expect(db.settings.get("ui.activeProjectId")).toBe(state().activeId);
  });

  it("goes home keeping the last project, or closes it", async () => {
    const db = fakeBackend([project("a")], "a");
    await state().init();
    state().goHome();
    expect(state().view).toBe("home");
    expect(db.settings.get("ui.activeProjectId")).toBe("a");
    await state().open("a");
    await state().close();
    expect(state().view).toBe("home");
    expect(db.settings.get("ui.activeProjectId")).toBe("");
  });

  it("removes a project, forgets its workspaces and leaves it if it was open", async () => {
    fakeBackend([project("a"), project("b")], "a");
    await state().init();
    await state().remove("a");
    expect(state().projects.map((p) => p.id)).toEqual(["b"]);
    expect(deps.forgetWorkspaces).toHaveBeenCalledWith(["w1", "w2"]);
    expect(state().view).toBe("home");
    expect(state().activeId).toBeNull();
  });

  it("renames and relocates", async () => {
    fakeBackend([project("a")]);
    await state().init();
    await state().rename("a", "  API ");
    await state().relocate("a", "D:\\api");
    expect(state().projects[0]).toMatchObject({ name: "API", path: "D:\\api" });
  });

  it("reports a backend failure at startup", async () => {
    mockIPC(() => {
      throw { kind: "db", message: "disk I/O error" };
    });
    await state().init();
    expect(state().view).toBe("error");
    expect(state().error).toContain("disk I/O error");
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm test 2>&1 | tail -15`
Expected: FAIL — `./projects` introuvable ; `state().load is not a function`.

- [ ] **Step 3: Écrire l'IPC et les stores**

Dans `src/ipc/db.ts`, remplacer l'interface `Workspace` et les fonctions de workspace par :

```ts
export interface Project {
  id: string;
  name: string;
  path: string;
  position: number;
  lastOpenedAt: number;
  workspaceCount: number;
  /** Its folder no longer exists. */
  missing: boolean;
  /** Terminals of its workspaces whose process runs. */
  liveAgents: number;
}

export interface Workspace {
  id: string;
  projectId: string;
  name: string;
  position: number;
  /** Pantheon of the agents outside any group (spec habillage §9.2). */
  pantheon: string | null;
}
```

et, à la place des anciennes lignes `listWorkspaces`/`createWorkspace` :

```ts
export const listProjects = () => call<Project[]>("list_projects");
export const createProject = (path: string) => write(() => call<Project>("create_project", { path }));
export const renameProject = (id: string, name: string) => write(() => call<void>("rename_project", { id, name }));
export const relocateProject = (id: string, path: string) =>
  write(() => call<void>("relocate_project", { id, path }));
export const openProject = (id: string) => write(() => call<void>("open_project", { id }));
/** Resolves with the ids of the deleted workspaces. */
export const deleteProject = (id: string) => write(() => call<string[]>("delete_project", { id }));

export const listWorkspaces = (projectId: string) => call<Workspace[]>("list_workspaces", { projectId });
export const createWorkspace = (projectId: string, name: string) =>
  write(() => call<Workspace>("create_workspace", { projectId, name }));
export const setWorkspacePantheon = (id: string, pantheon: string) =>
  write(() => call<void>("set_workspace_pantheon", { id, pantheon }));
```

Créer `src/ipc/git.ts` :

```ts
import { call } from "./invoke";

export interface GitStatus {
  branch: string;
  changed: number;
}

/** Null outside a git repository or without git. */
export const gitStatus = (path: string) => call<GitStatus | null>("git_status", { path });
```

Remplacer `src/store/workspaces.ts` :

```ts
import { createStore, useStore } from "zustand";
import {
  createWorkspace,
  deleteWorkspace,
  getSetting,
  listWorkspaces,
  renameWorkspace,
  setSetting,
  setWorkspacePantheon,
  type Workspace,
} from "@/ipc/db";

export type { Workspace };

/** Plan 2 kept a single active workspace; it seeds the first project opened. */
const LEGACY_ACTIVE_KEY = "ui.activeWorkspaceId";
const activeKey = (projectId: string) => `ui.activeWorkspaceId.${projectId}`;

export interface WorkspacesState {
  projectId: string | null;
  workspaces: Workspace[];
  activeId: string | null;
  status: "loading" | "ready" | "error";
  error?: string;
  /** Loads the workspaces of a project, creating one if it has none. */
  load: (projectId: string) => Promise<void>;
  create: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  /** Deletes a workspace (never the last one) and selects its neighbor if it was active. */
  remove: (id: string) => Promise<void>;
  select: (id: string) => void;
  setPantheon: (id: string, pantheon: string) => Promise<void>;
}

/** "Workspace N" with the smallest N not already taken. */
export function nextDefaultName(workspaces: Workspace[]): string {
  const taken = new Set(workspaces.map((w) => w.name));
  let n = 1;
  while (taken.has(`Workspace ${n}`)) n++;
  return `Workspace ${n}`;
}

export function createWorkspacesStore() {
  return createStore<WorkspacesState>()((set, get) => {
    const rememberActive = (id: string) => {
      const projectId = get().projectId;
      if (!projectId) return;
      setSetting(activeKey(projectId), id).catch((error: unknown) => console.warn("active workspace not saved", error));
    };

    return {
      projectId: null,
      workspaces: [],
      activeId: null,
      status: "loading",

      load: async (projectId) => {
        set({ projectId, workspaces: [], activeId: null, status: "loading", error: undefined });
        try {
          let workspaces = await listWorkspaces(projectId);
          if (workspaces.length === 0) workspaces = [await createWorkspace(projectId, nextDefaultName([]))];
          const saved = (await getSetting<string>(activeKey(projectId))) ?? (await getSetting<string>(LEGACY_ACTIVE_KEY));
          const activeId = workspaces.some((w) => w.id === saved) ? saved! : workspaces[0].id;
          if (get().projectId === projectId) set({ workspaces, activeId, status: "ready" });
        } catch (error) {
          set({ status: "error", error: String(error) });
        }
      },

      create: async () => {
        const projectId = get().projectId;
        if (!projectId) return;
        const workspace = await createWorkspace(projectId, nextDefaultName(get().workspaces));
        set((s) => ({ workspaces: [...s.workspaces, workspace], activeId: workspace.id }));
        rememberActive(workspace.id);
      },

      rename: async (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        await renameWorkspace(id, trimmed);
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) }));
      },

      remove: async (id) => {
        const { workspaces, activeId } = get();
        const index = workspaces.findIndex((w) => w.id === id);
        if (index === -1 || workspaces.length === 1) return;
        await deleteWorkspace(id);
        const remaining = workspaces.filter((w) => w.id !== id);
        const nextActive = id === activeId ? remaining[Math.min(index, remaining.length - 1)].id : activeId;
        set({ workspaces: remaining, activeId: nextActive });
        if (nextActive && nextActive !== activeId) rememberActive(nextActive);
      },

      select: (id) => {
        if (id === get().activeId || !get().workspaces.some((w) => w.id === id)) return;
        set({ activeId: id });
        rememberActive(id);
      },

      setPantheon: async (id, pantheon) => {
        await setWorkspacePantheon(id, pantheon);
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, pantheon } : w)) }));
      },
    };
  });
}

export const workspacesStore = createWorkspacesStore();

export function useWorkspaces<T>(selector: (state: WorkspacesState) => T): T {
  return useStore(workspacesStore, selector);
}
```

Créer `src/app/forget.ts` :

```ts
import { forgetScene } from "@/canvas/sceneCache";
import { disposeTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";

/** Drops everything the front keeps about deleted workspaces (their rows are gone). */
export function forgetWorkspaces(ids: string[]) {
  for (const id of ids) {
    nodesStore.getState().forgetWorkspace(id).forEach(disposeTerminal);
    forgetScene(id);
  }
}
```

Créer `src/store/projects.ts` :

```ts
import { createStore, useStore } from "zustand";
import {
  createProject,
  deleteProject,
  getSetting,
  listProjects,
  openProject,
  relocateProject,
  renameProject,
  setSetting,
  type Project,
} from "@/ipc/db";
import { flushAll } from "@/lib/flush";

export type { Project };

const ACTIVE_KEY = "ui.activeProjectId";
/** Stored when the user closed the project: the next launch shows the home screen. */
const CLOSED = "";

export type ProjectsView = "loading" | "home" | "project" | "error";

/**
 * The project to reopen at launch (spec habillage §5.1): the saved one if its
 * folder still exists; the most recently opened one when none was ever saved
 * (first launch after migration 002); none after "Fermer" or if it is gone.
 */
export function startupProject(projects: readonly Project[], saved: string | null): string | null {
  if (saved === CLOSED) return null;
  if (saved !== null) {
    const last = projects.find((p) => p.id === saved);
    return last && !last.missing ? last.id : null;
  }
  const recent = projects.filter((p) => !p.missing).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
  return recent?.id ?? null;
}

export interface ProjectsDeps {
  loadWorkspaces: (projectId: string) => Promise<void>;
  forgetWorkspaces: (workspaceIds: string[]) => void;
}

export interface ProjectsState {
  projects: Project[];
  activeId: string | null;
  view: ProjectsView;
  error?: string;
  /** Reopens the last project, or shows the home screen (spec habillage §5.1). */
  init: () => Promise<void>;
  open: (id: string) => Promise<void>;
  /** Adds a folder as a project and opens it. */
  add: (path: string) => Promise<void>;
  /** Shows the home screen; the project stays the one reopened at next launch. */
  goHome: () => void;
  /** Shows the home screen and forgets the project for the next launch. */
  close: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  relocate: (id: string, path: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function createProjectsStore(deps: ProjectsDeps) {
  return createStore<ProjectsState>()((set, get) => ({
    projects: [],
    activeId: null,
    view: "loading",

    init: async () => {
      try {
        const projects = await listProjects();
        const saved = await getSetting<string>(ACTIVE_KEY);
        set({ projects });
        const target = startupProject(projects, saved);
        if (target) await get().open(target);
        else set({ view: "home" });
      } catch (error) {
        set({ view: "error", error: String(error) });
      }
    },

    open: async (id) => {
      await flushAll();
      await openProject(id);
      await deps.loadWorkspaces(id);
      const now = Date.now();
      set((s) => ({
        activeId: id,
        view: "project",
        projects: s.projects.map((p) => (p.id === id ? { ...p, lastOpenedAt: now } : p)),
      }));
      await setSetting(ACTIVE_KEY, id);
    },

    add: async (path) => {
      const project = await createProject(path);
      set((s) => ({ projects: [...s.projects, project] }));
      await get().open(project.id);
    },

    goHome: () => {
      set({ view: "home" });
      void get().refresh();
    },

    close: async () => {
      set({ view: "home", activeId: null });
      await setSetting(ACTIVE_KEY, CLOSED);
      void get().refresh();
    },

    rename: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await renameProject(id, trimmed);
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) }));
    },

    relocate: async (id, path) => {
      await relocateProject(id, path);
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, path, missing: false } : p)) }));
    },

    remove: async (id) => {
      await flushAll();
      const workspaceIds = await deleteProject(id);
      deps.forgetWorkspaces(workspaceIds);
      const wasActive = get().activeId === id;
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        ...(wasActive ? { activeId: null, view: "home" as const } : {}),
      }));
      if (wasActive) await setSetting(ACTIVE_KEY, CLOSED);
    },

    refresh: async () => {
      try {
        set({ projects: await listProjects() });
      } catch (error) {
        console.warn("projects not refreshed", error);
      }
    },
  }));
}
```

Puis, à la fin du même fichier, l'instance partagée. Elle n'importe pas `app/forget.ts` (qui charge xterm) : `boot.ts` lui fournit cette fonction au démarrage.

```ts
let forgetHook: (workspaceIds: string[]) => void = () => undefined;

/** Called once by boot(): forgetting workspaces needs the terminal registry. */
export function setForgetWorkspaces(forget: (workspaceIds: string[]) => void) {
  forgetHook = forget;
}

export const projectsStore = createProjectsStore({
  loadWorkspaces: (projectId) => workspacesStore.getState().load(projectId),
  forgetWorkspaces: (workspaceIds) => forgetHook(workspaceIds),
});

export function useProjects<T>(selector: (state: ProjectsState) => T): T {
  return useStore(projectsStore, selector);
}
```

avec, en tête du fichier, `import { workspacesStore } from "./workspaces";`.

Dans `src/app/boot.ts`, remplacer `import { workspacesStore } from "@/store/workspaces";` par `import { projectsStore, setForgetWorkspaces } from "@/store/projects";` et `import { forgetWorkspaces } from "./forget";`, puis `await workspacesStore.getState().init();` par :

```ts
    setForgetWorkspaces(forgetWorkspaces);
    await projectsStore.getState().init();
```

Dans `src/App.tsx`, l'ancien `useWorkspaces((s) => s.status)` reste valable ; seul le chargement change (il passe par `boot`). La sidebar appelle encore `workspacesStore.getState().create()` : inchangé.

- [ ] **Step 4: Lancer les tests et les voir passer**

Run: `pnpm test 2>&1 | tail -8 && pnpm exec tsc --noEmit`
Expected: tous les tests passent ; `tsc` sans erreur.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/ipc src/store src/app
git commit -m "feat: projects store and workspaces scoped to a project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Thème, polices et couleurs de scène

**Files:**
- Modify: `src/index.css` (remplacement complet), `package.json` (dépendance)
- Create: `src/theme/tokens.css`, `src/theme/excalidraw.css`, `src/theme/sceneColors.ts`, `src/theme/sceneColors.test.ts`

**Interfaces:**
- Produces:
  - classes Tailwind `bg-ov-*`, `text-ov-*`, `border-ov-*` (canvas, dot, surface, surface-2, card, command, line, hover, selected, text, text-2, accent, accent-soft, danger, terminal, terminal-head, working, waiting, idle, done, live), `shadow-ov`, `font-mono` (Geist Mono), classe utilitaire `.ov-label`, `.ov-chip`, `.ov-orb`.
  - `toSceneColor(displayHex: string): string`, `toDisplayColor(sceneHex: string): string`.

- [ ] **Step 1: Écrire le test des couleurs de scène**

`src/theme/sceneColors.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { toDisplayColor, toSceneColor } from "./sceneColors";

describe("scene colors under Excalidraw's dark filter", () => {
  it("matches reference values", () => {
    expect(toDisplayColor("#1e1e1e")).toBe("#d3d3d3");
    expect(toDisplayColor("#ffffff")).toBe("#121212");
    expect(toSceneColor("#5E9A55")).toBe("#448a3a");
    expect(toSceneColor("#EDE8DF")).toBe("#0b0500");
  });

  it("round-trips colors the filter can show", () => {
    for (const color of ["#5e9a55", "#4b5675", "#12110e"]) {
      expect(toDisplayColor(toSceneColor(color))).toBe(color === "#12110e" ? "#121210" : color);
    }
  });

  it("leaves non-hex values alone", () => {
    expect(toSceneColor("transparent")).toBe("transparent");
    expect(toDisplayColor("transparent")).toBe("transparent");
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/theme 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "./sceneColors"`.

- [ ] **Step 3: Écrire les couleurs, les jetons et les surcharges**

`src/theme/sceneColors.ts` :

```ts
// Excalidraw's dark theme draws the canvas through `invert(93%) hue-rotate(180deg)`
// (spec habillage §4.3). These convert between a stored element color and the
// color seen on screen; saturated colors cannot all be shown and come out duller.
type Rgb = [number, number, number];

// hue-rotate(180deg) as defined by the Filter Effects spec; it is its own inverse.
const HUE_180: Rgb[] = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

function apply(v: Rgb): Rgb {
  return HUE_180.map((row) => clamp(row[0] * v[0] + row[1] * v[1] + row[2] * v[2])) as Rgb;
}

function parse(hex: string): Rgb {
  let digits = hex.replace("#", "");
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb;
}

function format(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(clamp(c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The color to store so that the canvas shows `displayHex`, or the closest it can. */
export function toSceneColor(displayHex: string): string {
  if (!HEX.test(displayHex)) return displayHex;
  return format(apply(parse(displayHex).map((d) => (0.93 - d) / 0.86) as Rgb));
}

/** The color the canvas shows for a stored element color. */
export function toDisplayColor(sceneHex: string): string {
  if (!HEX.test(sceneHex)) return sceneHex;
  return format(apply(parse(sceneHex).map((c) => 0.93 - 0.86 * c) as Rgb));
}
```

Ajouter la police : `pnpm add @fontsource-variable/geist-mono` (puis vérifier dans `package.json` que la version ajoutée est une `5.x`).

`src/theme/tokens.css` :

```css
/* Design tokens (spec habillage §4.1). dummyPlane has a single, dark theme. */
:root {
  color-scheme: dark;
  --ov-canvas: #12110e;
  --ov-dot: #2a2a22;
  --ov-surface: #14140f;
  --ov-surface-2: #18150f;
  --ov-card: #1a1914;
  --ov-command: #252724;
  --ov-line: #2a2a22;
  --ov-hover: #301e12;
  --ov-selected: #2a1c11;
  --ov-text: #edeae2;
  --ov-text-2: #8a8a80;
  --ov-accent: #f4602e;
  --ov-accent-soft: #3a1d14;
  --ov-danger: #ef4444;
  --ov-terminal: #161712;
  --ov-terminal-head: #0b0b09;
  --ov-working: #e8553a;
  --ov-waiting: #d9b35a;
  --ov-idle: #8a8a80;
  --ov-done: #6a8e51;
  --ov-live: #4caf6a;
  --ov-shadow: 0 8px 32px rgb(0 0 0 / 0.45);
}
```

`src/theme/excalidraw.css` :

```css
/* Excalidraw 0.18.1 under the dummyPlane shell (spec habillage §5.4, §5.7).
   The selectors below are those of 0.18.1: re-check every one of them when
   upgrading Excalidraw. */

.excalidraw {
  --ui-font: "Geist Variable", sans-serif;
}

.excalidraw.theme--dark {
  --color-selection: var(--ov-accent);
  --color-primary: var(--ov-accent);
  --color-primary-darker: #d94f22;
  --color-primary-darkest: #b94019;
  --color-primary-light: var(--ov-accent-soft);
  --color-primary-light-darker: #4a2416;
  --color-primary-hover: #ff7445;
  --color-brand-hover: #ff7445;
  --color-brand-active: #d94f22;
  --color-surface-primary-container: var(--ov-accent-soft);
  --color-on-primary-container: var(--ov-text);
  --island-bg-color: var(--ov-surface-2);
  --popup-secondary-bg-color: var(--ov-card);
  --input-bg-color: var(--ov-card);
  --input-border-color: var(--ov-line);
  --input-hover-bg-color: var(--ov-hover);
  --button-gray-1: var(--ov-card);
  --button-gray-2: var(--ov-hover);
  --button-gray-3: #3a2a1e;
  --color-surface-high: var(--ov-hover);
  --color-surface-mid: var(--ov-card);
  --color-surface-low: var(--ov-surface-2);
  --color-surface-lowest: var(--ov-surface);
  --color-on-surface: var(--ov-text);
  --color-border-outline: var(--ov-line);
  --color-border-outline-variant: var(--ov-line);
  --dialog-border-color: var(--ov-line);
  --overlay-bg-color: rgb(0 0 0 / 0.6);
  --shadow-island: var(--ov-shadow);
  --modal-shadow: var(--ov-shadow);
  --color-slider-track: var(--ov-line);
  --focus-highlight-color: var(--ov-accent-soft);
}

/* The dot grid and the canvas color are painted under a transparent canvas. */
.excalidraw,
.excalidraw .excalidraw-container {
  background: transparent !important;
}

/* Excalidraw's own UI is replaced by the shell. */
.excalidraw .shapes-section,
.excalidraw .main-menu-trigger,
.excalidraw .layer-ui__wrapper__top-right,
.excalidraw .layer-ui__wrapper__footer,
.excalidraw .App-bottom-bar,
.excalidraw .HintViewer,
.excalidraw .welcome-screen-center,
.excalidraw .welcome-screen-decor,
.excalidraw .default-sidebar-trigger,
.excalidraw .sidebar-trigger {
  display: none !important;
}

/* The properties panel is kept, restyled and docked next to the left rail. */
.excalidraw .App-menu__left {
  position: fixed;
  left: 76px;
  top: 50%;
  transform: translateY(-50%);
  width: 232px;
  max-height: calc(100vh - 160px) !important;
  padding: 12px !important;
  border: 1px solid var(--ov-line);
  border-radius: 12px;
  background: var(--ov-surface-2);
  box-shadow: var(--ov-shadow);
}

.excalidraw .App-menu__left legend,
.excalidraw .App-menu__left h3 {
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ov-text-2);
}

.excalidraw .App-menu__left .buttonList label,
.excalidraw .App-menu__left .ToolIcon__icon {
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--ov-card);
}

.excalidraw .App-menu__left .buttonList label.active,
.excalidraw .App-menu__left .ToolIcon_type_radio:checked + .ToolIcon__icon {
  border-color: var(--ov-accent);
  background: var(--ov-accent-soft);
}

.excalidraw .App-menu__left input[type="range"] {
  accent-color: var(--ov-accent);
}

.excalidraw .context-menu {
  border: 1px solid var(--ov-line);
  border-radius: 12px;
  background: var(--ov-surface-2);
  box-shadow: var(--ov-shadow);
}
```

Remplacer `src/index.css` :

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";
@import "./theme/tokens.css";
@import "./theme/excalidraw.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-heading: var(--font-sans);
  --font-sans: "Geist Variable", sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, monospace;
  --color-ov-canvas: var(--ov-canvas);
  --color-ov-dot: var(--ov-dot);
  --color-ov-surface: var(--ov-surface);
  --color-ov-surface-2: var(--ov-surface-2);
  --color-ov-card: var(--ov-card);
  --color-ov-command: var(--ov-command);
  --color-ov-line: var(--ov-line);
  --color-ov-hover: var(--ov-hover);
  --color-ov-selected: var(--ov-selected);
  --color-ov-text: var(--ov-text);
  --color-ov-text-2: var(--ov-text-2);
  --color-ov-accent: var(--ov-accent);
  --color-ov-accent-soft: var(--ov-accent-soft);
  --color-ov-danger: var(--ov-danger);
  --color-ov-terminal: var(--ov-terminal);
  --color-ov-terminal-head: var(--ov-terminal-head);
  --color-ov-working: var(--ov-working);
  --color-ov-waiting: var(--ov-waiting);
  --color-ov-idle: var(--ov-idle);
  --color-ov-done: var(--ov-done);
  --color-ov-live: var(--ov-live);
  --shadow-ov: var(--ov-shadow);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

/* shadcn components read these; they are mapped onto the dummyPlane tokens. */
:root {
  --background: var(--ov-canvas);
  --foreground: var(--ov-text);
  --card: var(--ov-surface);
  --card-foreground: var(--ov-text);
  --popover: var(--ov-surface-2);
  --popover-foreground: var(--ov-text);
  --primary: var(--ov-accent);
  --primary-foreground: #ffffff;
  --secondary: var(--ov-card);
  --secondary-foreground: var(--ov-text);
  --muted: var(--ov-card);
  --muted-foreground: var(--ov-text-2);
  --accent: var(--ov-hover);
  --accent-foreground: var(--ov-text);
  --destructive: var(--ov-danger);
  --border: var(--ov-line);
  --input: var(--ov-line);
  --ring: var(--ov-accent);
  --radius: 0.75rem;
  --sidebar: var(--ov-surface);
  --sidebar-foreground: var(--ov-text);
  --sidebar-primary: var(--ov-accent);
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: var(--ov-hover);
  --sidebar-accent-foreground: var(--ov-text);
  --sidebar-border: var(--ov-line);
  --sidebar-ring: var(--ov-accent);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}

@layer components {
  /* Section titles of menus and panels. */
  .ov-label {
    @apply text-[11px] font-medium tracking-[0.06em] text-ov-text-2 uppercase;
  }

  /* Pills of the bottom row: dark fill, multicolor gradient outline. */
  .ov-chip {
    border: 1px solid transparent;
    background:
      linear-gradient(var(--ov-surface), var(--ov-surface)) padding-box,
      linear-gradient(90deg, #4fc2c2, #d9b35a, #f4602e, #e07a9a, #a57be0) border-box;
  }

  /* The orange orb of the home screen, the command bar and the orchestrator. */
  .ov-orb {
    border-radius: 9999px;
    background: radial-gradient(circle at 35% 30%, #ffd48a, #f4602e 55%, #8a2a10);
    box-shadow: 0 0 18px rgb(244 96 46 / 0.45);
  }
}
```

- [ ] **Step 4: Tests, types et build**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit && pnpm build 2>&1 | tail -3`
Expected: tests verts ; build Vite réussi.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add package.json pnpm-lock.yaml src/index.css src/theme
git commit -m "feat(theme): dummyPlane tokens, Geist Mono and Excalidraw overrides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Vue du canvas, fond transparent, grille de points et zoom

**Files:**
- Create: `src/canvas/canvasStore.ts`, `src/canvas/canvasStore.test.ts`, `src/canvas/sceneDefaults.ts`, `src/canvas/sceneDefaults.test.ts`, `src/canvas/overlay/dotGrid.ts`, `src/canvas/overlay/dotGrid.test.ts`, `src/canvas/overlay/DotGrid.tsx`, `src/canvas/zoom.ts`, `src/canvas/zoom.test.ts`, `src/store/ui.ts`, `src/shell/ui.tsx`, `src/shell/ZoomControl.tsx`
- Modify: `src/canvas/Canvas.tsx`, `src/App.tsx`
- Delete: `src/canvas/InsertMenu.tsx`

**Interfaces:**
- Consumes: `toSceneColor` (Tâche 4).
- Produces:
  - `canvasStore` / `useCanvas(selector)` : état `{ api: ExcalidrawImperativeAPI | null; view: CanvasView; setApi(api); setView(view) }` ; `CanvasView = { scrollX, scrollY, zoom, width, height, offsetLeft, offsetTop, tool: string, selectedIds: string[] }` ; `viewFrom(appState): CanvasView` ; `sameView(a, b): boolean` ; `EMPTY_VIEW`.
  - `withSceneDefaults(initial)`, `SCENE_DEFAULTS`, `EXCALIDRAW_UI_OPTIONS`.
  - `dotGrid(view) -> { step, x, y }`, `DOT_STEP = 32` ; composants `DotGrid` (suit le canvas) et `DotGridBackground({ step, x, y })`.
  - `stepZoom(zoom, 1 | -1)`, `zoomAroundCenter(view, zoom) -> { zoom, scrollX, scrollY }`.
  - `uiStore` / `useUi(selector)` : `{ launchOpen: boolean; setLaunchOpen(open) }` (remplacé en Tâche 14).
  - `PillButton`, `RoundButton({ label, active? })` dans `src/shell/ui.tsx` ; `ZoomControl`.

- [ ] **Step 1: Écrire les tests**

`src/canvas/canvasStore.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import type { AppState } from "@excalidraw/excalidraw/types";
import { canvasStore, EMPTY_VIEW, sameView, viewFrom } from "./canvasStore";

const appState = (overrides: Record<string, unknown> = {}) =>
  ({
    scrollX: 10,
    scrollY: -5,
    zoom: { value: 0.5 },
    width: 800,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    activeTool: { type: "rectangle" },
    selectedElementIds: { b: true, a: true },
    ...overrides,
  }) as unknown as AppState;

describe("viewFrom", () => {
  it("keeps what the shell shows, with sorted selected ids", () => {
    expect(viewFrom(appState())).toEqual({
      scrollX: 10,
      scrollY: -5,
      zoom: 0.5,
      width: 800,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
      tool: "rectangle",
      selectedIds: ["a", "b"],
    });
  });
});

describe("canvasStore", () => {
  it("only notifies when the view really changes", () => {
    const listener = vi.fn();
    const unsubscribe = canvasStore.subscribe(listener);
    canvasStore.getState().setView(viewFrom(appState()));
    canvasStore.getState().setView(viewFrom(appState({ selectedElementIds: { a: true, b: true } })));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sameView(EMPTY_VIEW, canvasStore.getState().view)).toBe(false);
    unsubscribe();
  });
});
```

`src/canvas/sceneDefaults.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { FONT_FAMILY } from "@excalidraw/excalidraw";
import { SCENE_DEFAULTS, withSceneDefaults } from "./sceneDefaults";

describe("withSceneDefaults", () => {
  it("adds the dummyPlane defaults and keeps the saved viewport", () => {
    const data = withSceneDefaults({ elements: [], appState: { scrollX: 4, scrollY: 2 } });
    expect(data.appState).toMatchObject({ scrollX: 4, scrollY: 2, viewBackgroundColor: "transparent" });
    expect(data.appState?.currentItemFontFamily).toBe(FONT_FAMILY["Comic Shanns"]);
    expect(SCENE_DEFAULTS.currentItemStrokeColor).toBe("#0b0500");
  });
});
```

`src/canvas/overlay/dotGrid.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { dotGrid } from "./dotGrid";

describe("dotGrid", () => {
  it("spaces dots 32 scene units apart and follows the scroll", () => {
    expect(dotGrid({ scrollX: 0, scrollY: 0, zoom: 1 })).toEqual({ step: 32, x: 0, y: 0 });
    expect(dotGrid({ scrollX: 40, scrollY: -8, zoom: 1 })).toEqual({ step: 32, x: 8, y: 24 });
  });

  it("never draws dots closer than 16 px", () => {
    expect(dotGrid({ scrollX: 0, scrollY: 0, zoom: 0.25 }).step).toBe(16);
    expect(dotGrid({ scrollX: 0, scrollY: 0, zoom: 0.1 }).step).toBeCloseTo(25.6);
    expect(dotGrid({ scrollX: 0, scrollY: 0, zoom: 2 }).step).toBe(64);
  });
});
```

`src/canvas/zoom.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { stepZoom, zoomAroundCenter } from "./zoom";

describe("stepZoom", () => {
  it("moves by 10 % and stays between 10 % and 3000 %", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(0.56, 1)).toBe(0.7);
    expect(stepZoom(0.1, -1)).toBe(0.1);
    expect(stepZoom(30, 1)).toBe(30);
  });
});

describe("zoomAroundCenter", () => {
  it("keeps the scene point at the center of the viewport in place", () => {
    const view = { scrollX: 100, scrollY: 50, zoom: 1, width: 800, height: 600 };
    const next = zoomAroundCenter(view, 2);
    expect({ x: 400 / 2 - next.scrollX, y: 300 / 2 - next.scrollY }).toEqual({ x: 400 - 100, y: 300 - 50 });
    expect(next.zoom).toBe(2);
  });
});
```

- [ ] **Step 2: Les voir échouer**

Run: `pnpm test 2>&1 | tail -10`
Expected: FAIL — modules `./canvasStore`, `./sceneDefaults`, `./dotGrid`, `./zoom` introuvables.

- [ ] **Step 3: Écrire les modules**

`src/canvas/canvasStore.ts` :

```ts
import { createStore, useStore } from "zustand";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** The part of Excalidraw's state that the shell around the canvas shows. */
export interface CanvasView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  /** Excalidraw's active tool type ("selection", "rectangle", "freedraw"…). */
  tool: string;
  selectedIds: string[];
}

export const EMPTY_VIEW: CanvasView = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 0,
  height: 0,
  offsetLeft: 0,
  offsetTop: 0,
  tool: "selection",
  selectedIds: [],
};

export function viewFrom(appState: AppState): CanvasView {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom.value,
    width: appState.width,
    height: appState.height,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    tool: appState.activeTool.type,
    selectedIds: Object.keys(appState.selectedElementIds)
      .filter((id) => appState.selectedElementIds[id])
      .sort(),
  };
}

export function sameView(a: CanvasView, b: CanvasView): boolean {
  return (
    a.scrollX === b.scrollX &&
    a.scrollY === b.scrollY &&
    a.zoom === b.zoom &&
    a.width === b.width &&
    a.height === b.height &&
    a.offsetLeft === b.offsetLeft &&
    a.offsetTop === b.offsetTop &&
    a.tool === b.tool &&
    a.selectedIds.length === b.selectedIds.length &&
    a.selectedIds.every((id, i) => id === b.selectedIds[i])
  );
}

interface CanvasState {
  /** The Excalidraw instance of the workspace on screen. */
  api: ExcalidrawImperativeAPI | null;
  view: CanvasView;
  setApi: (api: ExcalidrawImperativeAPI | null) => void;
  /** Called on every Excalidraw onChange; listeners only hear real changes. */
  setView: (view: CanvasView) => void;
}

export const canvasStore = createStore<CanvasState>()((set, get) => ({
  api: null,
  view: EMPTY_VIEW,
  setApi: (api) => set({ api }),
  setView: (view) => {
    if (!sameView(get().view, view)) set({ view });
  },
}));

export function useCanvas<T>(selector: (state: CanvasState) => T): T {
  return useStore(canvasStore, selector);
}
```

`src/canvas/sceneDefaults.ts` :

```ts
import { FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState, UIOptions } from "@excalidraw/excalidraw/types";
import { toSceneColor } from "@/theme/sceneColors";

/**
 * New elements get cream strokes and Comic Shanns text; the canvas itself is
 * transparent so the dot grid shows through (spec habillage §4.2, §5.7).
 */
export const SCENE_DEFAULTS = {
  viewBackgroundColor: "transparent",
  currentItemStrokeColor: toSceneColor("#EDE8DF"),
  currentItemFontFamily: FONT_FAMILY["Comic Shanns"],
  gridModeEnabled: false,
};

export function withSceneDefaults(initial: ExcalidrawInitialDataState): ExcalidrawInitialDataState {
  return { ...initial, appState: { ...SCENE_DEFAULTS, ...initial.appState } };
}

/** Excalidraw's canvas actions all move to the shell's menus. */
export const EXCALIDRAW_UI_OPTIONS: UIOptions = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: false,
    saveAsImage: false,
  },
  tools: { image: true },
};
```

`src/canvas/overlay/dotGrid.ts` :

```ts
import type { CanvasView } from "../canvasStore";

/** Scene distance between two dots (spec habillage §5.7). */
export const DOT_STEP = 32;
const MIN_SCREEN_STEP = 16;

const mod = (value: number, n: number) => ((value % n) + n) % n;

/**
 * Screen spacing of the dots and offset of the first one. Zoomed out, the step
 * doubles until dots are at least 16 px apart, like Excalidraw's own grid.
 */
export function dotGrid(view: Pick<CanvasView, "scrollX" | "scrollY" | "zoom">): { step: number; x: number; y: number } {
  let step = DOT_STEP * view.zoom;
  while (step < MIN_SCREEN_STEP) step *= 2;
  return { step, x: mod(view.scrollX * view.zoom, step), y: mod(view.scrollY * view.zoom, step) };
}
```

`src/canvas/overlay/DotGrid.tsx` :

```tsx
import { useCanvas } from "../canvasStore";
import { dotGrid } from "./dotGrid";

/** The canvas color and its dots, painted under Excalidraw's transparent canvas. */
export function DotGridBackground({ step, x, y }: { step: number; x: number; y: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-ov-canvas"
      style={{
        backgroundImage: "radial-gradient(circle, var(--ov-dot) 1.2px, transparent 1.6px)",
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${x - step / 2}px ${y - step / 2}px`,
      }}
    />
  );
}

export function DotGrid() {
  const scrollX = useCanvas((s) => s.view.scrollX);
  const scrollY = useCanvas((s) => s.view.scrollY);
  const zoom = useCanvas((s) => s.view.zoom);
  return <DotGridBackground {...dotGrid({ scrollX, scrollY, zoom })} />;
}
```

`src/canvas/zoom.ts` :

```ts
import type { CanvasView } from "./canvasStore";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

/** Zoom of the − and + buttons: 10 % steps, like Excalidraw's own controls. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = Math.round((zoom + direction * 0.1) * 10) / 10;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/** New zoom and scroll that keep the scene point at the viewport center in place. */
export function zoomAroundCenter(
  view: Pick<CanvasView, "scrollX" | "scrollY" | "zoom" | "width" | "height">,
  zoom: number,
): { zoom: number; scrollX: number; scrollY: number } {
  const centerX = view.width / 2 / view.zoom - view.scrollX;
  const centerY = view.height / 2 / view.zoom - view.scrollY;
  return { zoom, scrollX: view.width / 2 / zoom - centerX, scrollY: view.height / 2 / zoom - centerY };
}
```

`src/store/ui.ts` :

```ts
import { createStore, useStore } from "zustand";

interface UiState {
  /** The terminal launch dialog (replaced by the agent menu in task 14). */
  launchOpen: boolean;
  setLaunchOpen: (open: boolean) => void;
}

export const uiStore = createStore<UiState>()((set) => ({
  launchOpen: false,
  setLaunchOpen: (launchOpen) => set({ launchOpen }),
}));

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}
```

`src/shell/ui.tsx` :

```tsx
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A floating pill of the shell: buttons of the top bar, chips (spec habillage §5). */
export function PillButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-ov-line bg-ov-surface px-3 text-[13px] font-medium text-ov-text shadow-ov transition-colors hover:bg-ov-card disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** A round icon button of the rails and controls; `active` fills it in orange. */
export function RoundButton({
  className,
  active,
  label,
  ...props
}: ComponentProps<"button"> & { active?: boolean; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full text-ov-text-2 transition-colors hover:bg-ov-card hover:text-ov-text [&_svg]:size-4",
        active && "bg-ov-accent text-white hover:bg-ov-accent hover:text-white",
        className,
      )}
      {...props}
    />
  );
}
```

`src/shell/ZoomControl.tsx` :

```tsx
import { Minus, Plus } from "lucide-react";
import type { NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { stepZoom, zoomAroundCenter } from "@/canvas/zoom";
import { RoundButton } from "./ui";

/** "− 56 % +" at the bottom right (spec habillage §5.6); the percentage resets to 100 %. */
export function ZoomControl() {
  const zoom = useCanvas((s) => s.view.zoom);

  const apply = (next: number) => {
    const { api, view } = canvasStore.getState();
    if (!api) return;
    const target = zoomAroundCenter(view, next);
    api.updateScene({
      appState: {
        zoom: { value: target.zoom as NormalizedZoomValue },
        scrollX: target.scrollX,
        scrollY: target.scrollY,
      },
    });
  };

  return (
    <div className="pointer-events-auto flex h-8 items-center rounded-full border border-ov-line bg-ov-surface px-0.5 shadow-ov">
      <RoundButton label="Dézoomer" className="size-7" onClick={() => apply(stepZoom(zoom, -1))}>
        <Minus />
      </RoundButton>
      <button
        type="button"
        title="Revenir à 100 %"
        className="w-12 text-center font-mono text-xs text-ov-text-2 hover:text-ov-text"
        onClick={() => apply(1)}
      >
        {Math.round(zoom * 100)} %
      </button>
      <RoundButton label="Zoomer" className="size-7" onClick={() => apply(stepZoom(zoom, 1))}>
        <Plus />
      </RoundButton>
    </div>
  );
}
```

Dans `src/canvas/Canvas.tsx` :

1. Imports : retirer `InsertMenu` et `type NodeKind` ; ajouter :

```ts
import { uiStore, useUi } from "@/store/ui";
import { canvasStore, viewFrom } from "./canvasStore";
import { DotGrid } from "./overlay/DotGrid";
import { EXCALIDRAW_UI_OPTIONS, withSceneDefaults } from "./sceneDefaults";
```

2. `Centered` rend `<div className="absolute inset-0 grid place-items-center text-sm text-ov-text-2">{children}</div>`.

3. Dans `LoadedCanvas`, remplacer `const [launching, setLaunching] = useState(false);` par :

```ts
  const launchOpen = useUi((s) => s.launchOpen);
  const initialData = useMemo(() => withSceneDefaults(scene.initialData), [scene]);

  // The shell (rails, zoom, panels) drives the Excalidraw instance on screen.
  useEffect(() => {
    canvasStore.getState().setApi(api);
    return () => {
      if (canvasStore.getState().api === api) canvasStore.getState().setApi(null);
    };
  }, [api]);
```

4. Dans `onChange`, juste après `sync.onChange(...)` : `canvasStore.getState().setView(viewFrom(appState));`

5. Supprimer le callback `insert`.

6. Le rendu devient :

```tsx
  return (
    <div className="absolute inset-0">
      <DotGrid />
      <div className="absolute inset-0">
        <Excalidraw
          theme="dark"
          langCode="fr-FR"
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={onChange}
          UIOptions={EXCALIDRAW_UI_OPTIONS}
          validateEmbeddable={isdummyPlaneLink}
          renderEmbeddable={(element) => <NodeHost element={element} />}
        />
      </div>
      <LaunchDialog
        open={launchOpen}
        onOpenChange={uiStore.getState().setLaunchOpen}
        onLaunch={(payload) => void launch(payload)}
      />
    </div>
  );
```

Supprimer `src/canvas/InsertMenu.tsx`.

Dans `src/App.tsx` : `<main className="min-w-0 flex-1">` devient `<main className="relative min-w-0 flex-1">`, et ajouter dans `main`, après `<Canvas … />` :

```tsx
            <div className="pointer-events-none absolute bottom-4 right-4 z-30">
              <ZoomControl />
            </div>
```

avec `import { ZoomControl } from "@/shell/ZoomControl";`.

- [ ] **Step 4: Tests, types, contrôle visuel**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: tests verts, aucune erreur de type.

Lancer `pnpm tauri dev` (arrière-plan), capturer la fenêtre (`shot.ps1`) : canvas noir chaud `#12110E` avec sa grille de points, plus de barre d'outils, de menu ni de pied de page d'Excalidraw, zoom `− 100 % +` en bas à droite. Si un élément d'Excalidraw reste visible, ajouter son sélecteur 0.18.1 dans `src/theme/excalidraw.css` (en mode dev, clic droit → Inspecter ouvre les outils de WebView2).

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(canvas): transparent canvas on a dot grid, view store and zoom control

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Rail gauche, menus Formes et Stylo

**Files:**
- Create: `src/components/ui/popover.tsx`, `src/shell/tools.ts`, `src/shell/tools.test.ts`, `src/shell/LeftRail.tsx`, `src/shell/ShapesMenu.tsx`, `src/shell/PenMenu.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `canvasStore`, `useCanvas`, `uiStore.setLaunchOpen`, `RoundButton` (Tâche 5) ; `toSceneColor`, `toDisplayColor` (Tâche 4).
- Produces:
  - `Popover`, `PopoverTrigger`, `PopoverContent` (radix-ui).
  - `railToolOf(tool: string): RailTool | null` ; `RailTool = "selection" | "shapes" | "text" | "pen" | "eraser" | "image"` ; `ShapeTool = "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "frame"` ; `PEN_COLORS: { label; display }[]` ; `PEN_WIDTHS: number[]`.
  - `LeftRail({ agentButton?: ReactNode })` : la Tâche 14 y passe le menu des agents.

- [ ] **Step 1: Écrire le test des outils**

`src/shell/tools.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { toSceneColor } from "@/theme/sceneColors";
import { PEN_COLORS, PEN_WIDTHS, railToolOf } from "./tools";

describe("railToolOf", () => {
  it("lights the rail button of Excalidraw's active tool", () => {
    expect(railToolOf("selection")).toBe("selection");
    expect(railToolOf("lasso")).toBe("selection");
    for (const shape of ["rectangle", "ellipse", "diamond", "line", "arrow", "frame"]) {
      expect(railToolOf(shape)).toBe("shapes");
    }
    expect(railToolOf("text")).toBe("text");
    expect(railToolOf("freedraw")).toBe("pen");
    expect(railToolOf("eraser")).toBe("eraser");
    expect(railToolOf("image")).toBe("image");
    expect(railToolOf("hand")).toBeNull();
  });
});

describe("pen palette", () => {
  it("offers 8 colors that all convert to scene colors, and 5 widths", () => {
    expect(PEN_COLORS).toHaveLength(8);
    for (const { display } of PEN_COLORS) expect(toSceneColor(display)).toMatch(/^#[0-9a-f]{6}$/);
    expect(PEN_WIDTHS).toEqual([1, 2, 4, 6, 8]);
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/shell 2>&1 | tail -5`
Expected: FAIL — `./tools` introuvable.

- [ ] **Step 3: Écrire le popover, les outils et le rail**

`src/components/ui/popover.tsx` :

```tsx
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 10,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-xl border border-ov-line bg-ov-surface-2 p-3 text-ov-text shadow-ov outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
```

`src/shell/tools.ts` :

```ts
/** Buttons of the left rail (spec habillage §5.3). */
export type RailTool = "selection" | "shapes" | "text" | "pen" | "eraser" | "image";

/** Excalidraw tools of the SHAPES menu. */
export type ShapeTool = "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "frame";

/** The rail button that shows Excalidraw's active tool, if any. */
export function railToolOf(tool: string): RailTool | null {
  switch (tool) {
    case "selection":
    case "lasso":
      return "selection";
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "line":
    case "arrow":
    case "frame":
      return "shapes";
    case "text":
      return "text";
    case "freedraw":
      return "pen";
    case "eraser":
      return "eraser";
    case "image":
      return "image";
    default:
      return null;
  }
}

/** Pen colors as they should look on the canvas (spec habillage §4.3). */
export const PEN_COLORS: { label: string; display: string }[] = [
  { label: "Crème", display: "#EDE8DF" },
  { label: "Orange", display: "#F2612E" },
  { label: "Vert", display: "#5E9A55" },
  { label: "Or", display: "#C9A34E" },
  { label: "Rouge", display: "#EF4444" },
  { label: "Cyan", display: "#5CC8F0" },
  { label: "Lavande", display: "#A47CF0" },
  { label: "Ardoise", display: "#4B5675" },
];

export const PEN_WIDTHS = [1, 2, 4, 6, 8];
```

`src/shell/ShapesMenu.tsx` :

```tsx
import { useState } from "react";
import { Circle, Diamond, Frame, Minus, MoveUpRight, Shapes, Square, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ShapeTool } from "./tools";
import { RoundButton } from "./ui";

const SHAPES: { tool: ShapeTool; label: string; Icon: LucideIcon }[] = [
  { tool: "rectangle", label: "Rectangle", Icon: Square },
  { tool: "ellipse", label: "Ellipse", Icon: Circle },
  { tool: "diamond", label: "Losange", Icon: Diamond },
  { tool: "line", label: "Ligne", Icon: Minus },
  { tool: "arrow", label: "Flèche", Icon: MoveUpRight },
  { tool: "frame", label: "Cadre", Icon: Frame },
];

/** The SHAPES menu of the rail; `current` is Excalidraw's active tool. */
export function ShapesMenu(props: { active: boolean; current: string; onPick: (tool: ShapeTool) => void }) {
  const { active, current, onPick } = props;
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <RoundButton label="Formes" active={active}>
          <Shapes />
        </RoundButton>
      </PopoverTrigger>
      <PopoverContent side="right" className="w-60">
        <p className="ov-label mb-2">Formes</p>
        <div className="grid grid-cols-3 gap-1.5">
          {SHAPES.map(({ tool, label, Icon }) => (
            <button
              key={tool}
              type="button"
              onClick={() => {
                onPick(tool);
                setOpen(false);
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border border-transparent bg-ov-card py-2 text-[11px] text-ov-text-2 hover:text-ov-text",
                tool === current && "border-ov-accent bg-ov-accent-soft text-ov-text",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

`src/shell/PenMenu.tsx` :

```tsx
import { useState } from "react";
import { PenLine } from "lucide-react";
import { canvasStore } from "@/canvas/canvasStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toDisplayColor, toSceneColor } from "@/theme/sceneColors";
import { PEN_COLORS, PEN_WIDTHS } from "./tools";
import { RoundButton } from "./ui";

/** Pen tool with its COLOR and WIDTH menu (spec habillage §5.3). */
export function PenMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(PEN_COLORS[0].display);
  const [width, setWidth] = useState(2);

  const choose = (next: { color?: string; width?: number }) => {
    const api = canvasStore.getState().api;
    if (!api) return;
    const nextColor = next.color ?? color;
    const nextWidth = next.width ?? width;
    setColor(nextColor);
    setWidth(nextWidth);
    api.updateScene({
      appState: { currentItemStrokeColor: toSceneColor(nextColor), currentItemStrokeWidth: nextWidth },
    });
    api.setActiveTool({ type: "freedraw" });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) choose({});
      }}
    >
      <PopoverTrigger asChild>
        <RoundButton label="Stylo (P)" active={active}>
          <PenLine />
        </RoundButton>
      </PopoverTrigger>
      <PopoverContent side="right" className="w-60">
        <p className="ov-label mb-2">Couleur</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {PEN_COLORS.map(({ label, display }) => (
            <button
              key={display}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => choose({ color: display })}
              className={cn(
                "size-6 rounded-full ring-offset-2 ring-offset-ov-surface-2",
                display === color && "ring-2 ring-ov-accent",
              )}
              style={{ backgroundColor: toDisplayColor(toSceneColor(display)) }}
            />
          ))}
          <label
            title="Couleur personnalisée"
            className="relative size-6 cursor-pointer overflow-hidden rounded-full border border-ov-line bg-[conic-gradient(#ef4444,#d9b35a,#5e9a55,#5cc8f0,#a47cf0,#ef4444)]"
          >
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => choose({ color: e.target.value })}
            />
          </label>
        </div>
        <p className="ov-label mb-2">Épaisseur</p>
        <div className="flex gap-1.5">
          {PEN_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`Épaisseur ${w}`}
              onClick={() => choose({ width: w })}
              className={cn(
                "grid size-8 place-items-center rounded-lg border border-transparent bg-ov-card",
                w === width && "border-ov-accent bg-ov-accent-soft",
              )}
            >
              <span className="rounded-full bg-ov-text" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

`src/shell/LeftRail.tsx` :

```tsx
import type { ReactNode } from "react";
import { Asterisk, Eraser, Image as ImageIcon, Maximize, MousePointer2, Type } from "lucide-react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { uiStore } from "@/store/ui";
import { PenMenu } from "./PenMenu";
import { ShapesMenu } from "./ShapesMenu";
import { railToolOf, type ShapeTool } from "./tools";
import { RoundButton } from "./ui";

type Tool = "selection" | "text" | "eraser" | "image" | ShapeTool;

const setTool = (type: Tool) => canvasStore.getState().api?.setActiveTool({ type });

function fitAll() {
  const api = canvasStore.getState().api;
  const elements = api?.getSceneElements() ?? [];
  if (api && elements.length > 0) {
    api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
  }
}

const Separator = () => <span aria-hidden className="my-1 h-px w-5 bg-ov-line" />;

/**
 * The vertical tool pill on the left (spec habillage §5.3). It replaces
 * Excalidraw's toolbar and follows its active tool, keyboard shortcuts included.
 */
export function LeftRail({ agentButton }: { agentButton?: ReactNode }) {
  const tool = useCanvas((s) => s.view.tool);
  const active = railToolOf(tool);

  return (
    <nav className="pointer-events-auto absolute left-4 top-1/2 z-30 flex w-11 -translate-y-1/2 flex-col items-center gap-1 rounded-full border border-ov-line bg-ov-surface py-2 shadow-ov">
      <RoundButton label="Sélection (V)" active={active === "selection"} onClick={() => setTool("selection")}>
        <MousePointer2 />
      </RoundButton>
      {agentButton ?? (
        <RoundButton label="Lancer un agent" onClick={() => uiStore.getState().setLaunchOpen(true)}>
          <Asterisk className="text-ov-accent" />
        </RoundButton>
      )}
      <ShapesMenu active={active === "shapes"} current={tool} onPick={setTool} />
      <RoundButton label="Texte (T)" active={active === "text"} onClick={() => setTool("text")}>
        <Type />
      </RoundButton>
      <PenMenu active={active === "pen"} />
      <RoundButton label="Gomme (E)" active={active === "eraser"} onClick={() => setTool("eraser")}>
        <Eraser />
      </RoundButton>
      <Separator />
      <RoundButton label="Image" active={active === "image"} onClick={() => setTool("image")}>
        <ImageIcon />
      </RoundButton>
      <Separator />
      <RoundButton label="Ajuster la vue" onClick={fitAll}>
        <Maximize />
      </RoundButton>
    </nav>
  );
}
```

Dans `src/App.tsx`, ajouter `<LeftRail />` dans `main`, juste après `<Canvas … />` (avec `import { LeftRail } from "@/shell/LeftRail";`).

- [ ] **Step 4: Tests, types, contrôle visuel**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

Capture (`shot.ps1`) : la pilule verticale à gauche ; Formes ouvre son menu à droite du rail ; choisir Rectangle allume le bouton en orange ; R au clavier l'allume aussi ; le panneau de propriétés restylé apparaît accolé au rail ; le stylo dessine en crème par défaut.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(shell): left tool rail with shapes and pen menus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Écran d'accueil et routage par projet

**Files:**
- Create: `src/lib/format.ts`, `src/lib/format.test.ts`, `src/home/HomeScreen.tsx`, `src/home/ProjectCard.tsx`, `src/shell/ProjectView.tsx`
- Modify: `src/App.tsx` (remplacement complet)

**Interfaces:**
- Consumes: `projectsStore`, `useProjects` (Tâche 3) ; `DotGridBackground`, `dotGrid`, `ZoomControl`, `PillButton` (Tâche 5) ; `LeftRail` (Tâche 6).
- Produces: `formatAgo(timestampMs, nowMs?)`, `plural(count, one, many)` ; `HomeScreen` ; `ProjectView` (version finale en Tâche 8).

- [ ] **Step 1: Écrire le test des formats**

`src/lib/format.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { formatAgo, plural } from "./format";

describe("formatAgo", () => {
  const now = 1_000_000_000;
  it("says how long ago, in French", () => {
    expect(formatAgo(now - 20_000, now)).toBe("à l'instant");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("il y a 5 min");
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe("il y a 2 h");
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe("il y a 3 j");
    expect(formatAgo(now + 5_000, now)).toBe("à l'instant");
  });
});

describe("plural", () => {
  it("uses the singular for 0 and 1, as French does", () => {
    expect(plural(0, "workspace", "workspaces")).toBe("0 workspace");
    expect(plural(1, "agent actif", "agents actifs")).toBe("1 agent actif");
    expect(plural(3, "agent actif", "agents actifs")).toBe("3 agents actifs");
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/lib 2>&1 | tail -5`
Expected: FAIL — `./format` introuvable.

- [ ] **Step 3: Écrire les formats, l'accueil et le routage**

`src/lib/format.ts` :

```ts
/** "à l'instant", "il y a 5 min", "il y a 2 h", "il y a 3 j" (spec habillage §5.1). */
export function formatAgo(timestampMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

/** "1 agent actif", "3 agents actifs"; French uses the singular for 0 and 1. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}
```

`src/home/ProjectCard.tsx` :

```tsx
import { useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { Ellipsis, Folder } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatAgo, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { projectsStore, type Project } from "@/store/projects";

const fail = (what: string) => (error: unknown) => toast.error(`${what} : ${String(error)}`);

async function relocate(project: Project) {
  const picked = await open({ directory: true, defaultPath: project.path, title: "Nouveau dossier du projet" });
  if (typeof picked === "string") await projectsStore.getState().relocate(project.id, picked);
}

async function remove(project: Project) {
  const confirmed = await ask(
    `Retirer « ${project.name} » de la liste ? Ses workspaces seront supprimés et ses agents arrêtés. Le dossier n'est pas touché.`,
    { title: "Retirer le projet", kind: "warning", okLabel: "Retirer", cancelLabel: "Annuler" },
  );
  if (confirmed) await projectsStore.getState().remove(project.id);
}

/** A project of the home screen (spec habillage §5.1). */
export function ProjectCard({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const openable = !project.missing && !editing;
  const openProject = () => {
    if (openable) void projectsStore.getState().open(project.id).catch(fail("Ouverture impossible"));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openProject}
      onKeyDown={(e) => e.key === "Enter" && openProject()}
      className={cn(
        "group rounded-2xl border border-ov-line bg-ov-surface p-4 shadow-ov transition-colors",
        openable && "cursor-pointer hover:border-ov-accent/60",
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-ov-accent-soft text-ov-accent">
          <Folder className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              defaultValue={project.name}
              className="h-7"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                void projectsStore.getState().rename(project.id, e.currentTarget.value).catch(fail("Renommage impossible"));
                setEditing(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <p className="truncate font-semibold text-ov-text">{project.name}</p>
          )}
          <p className="truncate font-mono text-[11px] text-ov-text-2" title={project.path}>
            {project.path}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Actions du projet"
              onClick={(e) => e.stopPropagation()}
              className="grid size-7 place-items-center rounded-full text-ov-text-2 opacity-0 group-hover:opacity-100 hover:bg-ov-card hover:text-ov-text data-[state=open]:opacity-100"
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => setEditing(true)}>Renommer</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void relocate(project).catch(fail("Changement impossible"))}>
              Changer de dossier
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => void remove(project).catch(fail("Retrait impossible"))}>
              Retirer de la liste
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {project.missing ? (
        <p className="text-xs text-ov-danger">Dossier introuvable</p>
      ) : (
        <div className="flex items-center gap-3 font-mono text-[11px] text-ov-text-2">
          <span>{plural(project.workspaceCount, "workspace", "workspaces")}</span>
          {project.liveAgents > 0 && (
            <span className="flex items-center gap-1 text-ov-live">
              <span className="size-1.5 rounded-full bg-ov-live" />
              {plural(project.liveAgents, "agent actif", "agents actifs")}
            </span>
          )}
          <span className="ml-auto">{formatAgo(project.lastOpenedAt)}</span>
        </div>
      )}
    </div>
  );
}
```

`src/home/HomeScreen.tsx` :

```tsx
import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { DotGridBackground } from "@/canvas/overlay/DotGrid";
import { dotGrid } from "@/canvas/overlay/dotGrid";
import { PillButton } from "@/shell/ui";
import { projectsStore, useProjects } from "@/store/projects";
import { ProjectCard } from "./ProjectCard";

async function addProject() {
  const picked = await open({ directory: true, title: "Dossier du projet" });
  if (typeof picked !== "string") return;
  await projectsStore
    .getState()
    .add(picked)
    .catch((error: unknown) => toast.error(`Ajout impossible : ${String(error)}`));
}

/** Projects as cards; a click opens one on its last workspace (spec habillage §5.1). */
export function HomeScreen() {
  const projects = useProjects((s) => s.projects);

  useEffect(() => {
    void projectsStore.getState().refresh();
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-auto">
      <DotGridBackground {...dotGrid({ scrollX: 0, scrollY: 0, zoom: 1 })} />
      <div className="relative mx-auto max-w-5xl px-8 py-12">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="ov-orb size-8" aria-hidden />
            <h1 className="text-xl font-semibold text-ov-text">dummyPlane</h1>
          </div>
          <PillButton
            className="border-ov-accent bg-ov-accent text-white hover:bg-ov-accent/90"
            onClick={() => void addProject()}
          >
            <FolderPlus /> Ajouter un projet
          </PillButton>
        </header>
        {projects.length === 0 ? (
          <div className="mt-24 grid place-items-center gap-3 text-center">
            <p className="text-lg font-semibold text-ov-text">Aucun projet</p>
            <p className="max-w-sm text-sm text-ov-text-2">
              Un projet est un dossier de dépôt : tes agents y démarrent et la puce git le suit.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

`src/shell/ProjectView.tsx` (version intermédiaire : la barre latérale reste jusqu'à la Tâche 8) :

```tsx
import { Canvas } from "@/canvas/Canvas";
import { WorkspaceSidebar } from "@/sidebar/WorkspaceSidebar";
import { useWorkspaces } from "@/store/workspaces";
import { LeftRail } from "./LeftRail";
import { ZoomControl } from "./ZoomControl";

export function ProjectView() {
  const status = useWorkspaces((s) => s.status);
  const error = useWorkspaces((s) => s.error);
  const activeId = useWorkspaces((s) => s.activeId);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <WorkspaceSidebar />
      <main className="relative min-w-0 flex-1">
        {status === "ready" && activeId ? (
          <>
            <Canvas key={activeId} workspaceId={activeId} />
            <LeftRail />
            <div className="pointer-events-none absolute bottom-4 right-4 z-30">
              <ZoomControl />
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-ov-text-2">
            {status === "error" ? `Impossible de charger les workspaces : ${error}` : "Chargement…"}
          </div>
        )}
      </main>
    </div>
  );
}
```

Remplacer `src/App.tsx` :

```tsx
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { boot } from "@/app/boot";
import { HomeScreen } from "@/home/HomeScreen";
import { ProjectView } from "@/shell/ProjectView";
import { useProjects } from "@/store/projects";

export default function App() {
  const view = useProjects((s) => s.view);
  const error = useProjects((s) => s.error);

  useEffect(() => {
    void boot();
  }, []);

  return (
    <>
      {view === "home" && <HomeScreen />}
      {view === "project" && <ProjectView />}
      {(view === "loading" || view === "error") && (
        <div className="grid h-screen place-items-center bg-ov-canvas text-sm text-ov-text-2">
          {view === "error" ? `Impossible de charger les projets : ${error}` : "Chargement…"}
        </div>
      )}
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}
```

- [ ] **Step 4: Tests, types, contrôle visuel**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

Au premier lancement, la base est migrée et le projet le plus récent s'ouvre (`mk-webapp` chez Mathieu). Pour voir l'accueil avant la Tâche 8 (qui ajoute le bouton « Accueil »), ouvrir la console de WebView2 (`Ctrl+Maj+I` en mode dev), exécuter `(await import("/src/store/projects.ts")).projectsStore.getState().goHome()`, puis capturer (`shot.ps1`).

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(home): project cards home screen and routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Barre du haut, onglets de workspace, réglages et puce git

**Files:**
- Create: `src/store/running.ts`, `src/store/running.test.ts`, `src/shell/TopBar.tsx`, `src/shell/ProjectPicker.tsx`, `src/shell/WorkspaceTabs.tsx`, `src/shell/LiveCount.tsx`, `src/shell/SettingsMenu.tsx`, `src/shell/sceneFiles.ts`, `src/shell/GitChip.tsx`
- Modify: `src/shell/ProjectView.tsx` (remplacement complet)
- Delete: `src/sidebar/WorkspaceSidebar.tsx`

**Interfaces:**
- Consumes: Tâches 3, 5, 6, 7 ; `gitStatus` (Tâche 3) ; `forgetWorkspaces` (Tâche 3).
- Produces: `countRunning(nodes, statuses, workspaceIds)`, `useRunningCount(workspaceIds)` ; `TopBar` ; `GitChip` ; `exportScene(api, name)`, `importScene(api)`, `exportPng(api, name)` ; `ProjectView` final, dans lequel les Tâches 11 à 14 ajoutent leurs éléments.

- [ ] **Step 1: Écrire le test du compteur**

`src/store/running.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { NodeRecord } from "./nodes";
import { countRunning } from "./running";
import type { TerminalStatus } from "./terminalStatus";

const node = (workspaceId: string) => ({ workspaceId, kind: "terminal", payload: {} }) as unknown as NodeRecord;

describe("countRunning", () => {
  it("counts the running terminals of the given workspaces", () => {
    const nodes = { a: node("w1"), b: node("w1"), c: node("w2"), d: node("w3") };
    const statuses: Record<string, TerminalStatus> = {
      a: { state: "running" },
      b: { state: "exited", code: 0 },
      c: { state: "running" },
      d: { state: "running" },
    };
    expect(countRunning(nodes, statuses, ["w1"])).toBe(1);
    expect(countRunning(nodes, statuses, ["w1", "w2"])).toBe(2);
    expect(countRunning(nodes, statuses, [])).toBe(0);
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/store/running 2>&1 | tail -5`
Expected: FAIL — `./running` introuvable.

- [ ] **Step 3: Écrire la barre du haut et la coquille finale**

`src/store/running.ts` :

```ts
import { useStore } from "zustand";
import { useNodes, type NodeRecord } from "./nodes";
import { terminalStatusStore, type TerminalStatus } from "./terminalStatus";

/** Terminals of these workspaces whose process runs (tab badges, "N actifs"). */
export function countRunning(
  nodes: Record<string, NodeRecord>,
  statuses: Record<string, TerminalStatus>,
  workspaceIds: readonly string[],
): number {
  const wanted = new Set(workspaceIds);
  return Object.entries(nodes).filter(([id, node]) => wanted.has(node.workspaceId) && statuses[id]?.state === "running")
    .length;
}

export function useRunningCount(workspaceIds: readonly string[]): number {
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  return countRunning(nodes, statuses, workspaceIds);
}
```

`src/shell/WorkspaceTabs.tsx` (reprend la suppression de l'ancienne barre latérale) :

```tsx
import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Ellipsis, Plus } from "lucide-react";
import { toast } from "sonner";
import { forgetWorkspaces } from "@/app/forget";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { flushAll } from "@/lib/flush";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRunningCount } from "@/store/running";
import { useWorkspaces, workspacesStore, type Workspace } from "@/store/workspaces";
import { PillButton } from "./ui";

const fail = (what: string) => (error: unknown) => toast.error(`${what} : ${String(error)}`);

/** Deletes a workspace after confirmation, stopping its terminals (spec V1 §8.5). */
async function removeWorkspace(workspace: Workspace, running: number) {
  const consequence =
    running > 0
      ? `${plural(running, "agent sera arrêté", "agents seront arrêtés")} et son contenu effacé.`
      : "Son contenu sera effacé.";
  const confirmed = await ask(`Supprimer « ${workspace.name} » ? ${consequence}`, {
    title: "Supprimer le workspace",
    kind: "warning",
    okLabel: "Supprimer",
    cancelLabel: "Annuler",
  });
  if (!confirmed) return;
  // Pending saves are written first: once the row is gone they would fail.
  await flushAll();
  await workspacesStore.getState().remove(workspace.id);
  forgetWorkspaces([workspace.id]);
}

function WorkspaceTab(props: { workspace: Workspace; active: boolean; canRemove: boolean }) {
  const { workspace, active, canRemove } = props;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const running = useRunningCount([workspace.id]);

  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={workspace.name}
        className="h-8 w-40 rounded-full"
        onBlur={(e) => {
          void workspacesStore.getState().rename(workspace.id, e.currentTarget.value).catch(fail("Renommage impossible"));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        "group flex h-8 shrink-0 items-center rounded-full border pl-3 pr-1 text-[13px] font-medium shadow-ov",
        active
          ? "border-ov-accent bg-ov-accent-soft text-ov-text"
          : "border-ov-line bg-ov-surface text-ov-text-2 hover:text-ov-text",
      )}
    >
      <button
        type="button"
        className="max-w-40 truncate"
        onClick={() => workspacesStore.getState().select(workspace.id)}
        onDoubleClick={() => setEditing(true)}
      >
        {workspace.name}
      </button>
      {(active || running > 0) && (
        <span
          title={plural(running, "agent actif", "agents actifs")}
          className={cn(
            "ml-2 rounded-full px-1.5 font-mono text-[10px]",
            active ? "bg-ov-accent text-white" : "bg-ov-card text-ov-text-2",
          )}
        >
          {running}
        </span>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Actions du workspace"
            className="ml-0.5 grid size-6 place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-ov-card data-[state=open]:opacity-100"
          >
            <Ellipsis className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Renommer</DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canRemove}
            variant="destructive"
            onSelect={() => void removeWorkspace(workspace, running).catch(fail("Suppression impossible"))}
          >
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Workspace tabs of the open project, then "+" (spec habillage §5.2). */
export function WorkspaceTabs() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
      {workspaces.map((workspace) => (
        <WorkspaceTab
          key={workspace.id}
          workspace={workspace}
          active={workspace.id === activeId}
          canRemove={workspaces.length > 1}
        />
      ))}
      <PillButton
        aria-label="Nouveau workspace"
        title="Nouveau workspace"
        className="w-8 justify-center px-0"
        onClick={() => void workspacesStore.getState().create().catch(fail("Création impossible"))}
      >
        <Plus />
      </PillButton>
    </div>
  );
}
```

`src/shell/ProjectPicker.tsx` :

```tsx
import { Check, ChevronDown, Folder } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { projectsStore, useProjects } from "@/store/projects";
import { PillButton } from "./ui";

/** "▭ mk-webapp ⌄": recent projects, then the home screen. */
export function ProjectPicker() {
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const active = projects.find((p) => p.id === activeId);
  const recent = [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 8);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PillButton>
          <Folder className="text-ov-text-2" />
          <span className="max-w-40 truncate">{active?.name ?? "Projet"}</span>
          <ChevronDown className="text-ov-text-2" />
        </PillButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {recent.map((project) => (
          <DropdownMenuItem
            key={project.id}
            disabled={project.missing}
            onSelect={() => void projectsStore.getState().open(project.id)}
          >
            <Folder />
            <span className="truncate">{project.name}</span>
            {project.id === activeId && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => projectsStore.getState().goHome()}>Tous les projets…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/shell/LiveCount.tsx` :

```tsx
import { plural } from "@/lib/format";
import { useRunningCount } from "@/store/running";
import { useWorkspaces } from "@/store/workspaces";

/** "● 3 actifs": running agents of the whole project (spec habillage §5.2). */
export function LiveCount() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const running = useRunningCount(workspaces.map((w) => w.id));
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-full border border-ov-line bg-ov-surface px-3 font-mono text-xs text-ov-text shadow-ov">
      <span className="size-1.5 rounded-full bg-ov-live" />
      {plural(running, "actif", "actifs")}
    </div>
  );
}
```

`src/shell/sceneFiles.ts` :

```ts
import { CaptureUpdateAction, exportToBlob, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { nodeKindOf } from "@/canvas/nodeElement";
import { toSceneColor } from "@/theme/sceneColors";

type SavePicker = (options: unknown) => Promise<FileSystemFileHandle>;

/** Saves with WebView2's native save dialog when it offers one, else as a download. */
async function saveBlob(blob: Blob, suggestedName: string, accept: Record<string, string[]>, description: string) {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description, accept }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return false;
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: suggestedName }).click();
  URL.revokeObjectURL(url);
  return true;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function exportScene(api: ExcalidrawImperativeAPI, name: string) {
  const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
  return saveBlob(
    new Blob([json], { type: "application/json" }),
    `${name}.excalidraw`,
    { "application/json": [".excalidraw", ".json"] },
    "Scène Excalidraw",
  );
}

export async function exportPng(api: ExcalidrawImperativeAPI, name: string) {
  const blob = await exportToBlob({
    elements: api.getSceneElements(),
    appState: {
      ...api.getAppState(),
      exportBackground: true,
      exportWithDarkMode: true,
      viewBackgroundColor: toSceneColor("#12110E"),
    },
    files: api.getFiles(),
    mimeType: "image/png",
  });
  return saveBlob(blob, `${name}.png`, { "image/png": [".png"] }, "Image PNG");
}

/**
 * Adds the drawings of a scene file to the canvas. Elements already present and
 * dummyPlane nodes (their content lives in the database, not in the file) are skipped.
 */
export async function importScene(api: ExcalidrawImperativeAPI) {
  const file = await pickFile(".excalidraw,.json,application/json");
  if (!file) return false;
  const scene = await loadFromBlob(file, api.getAppState(), api.getSceneElements());
  const existing = new Set(api.getSceneElementsIncludingDeleted().map((e) => e.id));
  const added = scene.elements.filter((e) => !existing.has(e.id) && nodeKindOf(e) === null);
  api.addFiles(Object.values(scene.files));
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...added],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return true;
}
```

`src/shell/SettingsMenu.tsx` :

```tsx
import { getVersion } from "@tauri-apps/api/app";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Download, ImageDown, Info, Settings, Upload } from "lucide-react";
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaces } from "@/store/workspaces";
import { exportPng, exportScene, importScene } from "./sceneFiles";
import { RoundButton } from "./ui";

function run(action: (api: ExcalidrawImperativeAPI) => Promise<boolean>, failure: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  action(api).catch((error: unknown) => toast.error(`${failure} : ${String(error)}`));
}

/** Gear menu: what Excalidraw's hidden main menu used to offer (spec habillage §5.2). */
export function SettingsMenu() {
  const name = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeId)?.name ?? "scene");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <RoundButton label="Réglages" className="border border-ov-line bg-ov-surface shadow-ov">
          <Settings />
        </RoundButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => run((api) => exportScene(api, name), "Export impossible")}>
          <Download /> Exporter la scène…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(importScene, "Import impossible")}>
          <Upload /> Importer une scène…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run((api) => exportPng(api, name), "Export impossible")}>
          <ImageDown /> Exporter en PNG…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void getVersion().then((version) =>
              toast(`dummyPlane ${version}`, { description: "Canvas d'agents local et open source." }),
            )
          }
        >
          <Info /> À propos d'dummyPlane
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/shell/GitChip.tsx` :

```tsx
import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { gitStatus, type GitStatus } from "@/ipc/git";
import { useProjects } from "@/store/projects";

const POLL_MS = 5000;

/** "⑂ main 7": branch and changed files of the project folder (spec habillage §5.6). */
export function GitChip() {
  const path = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.path);
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    const read = () =>
      gitStatus(path).then(
        (next) => alive && setStatus(next),
        () => alive && setStatus(null),
      );
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path]);

  // An empty span keeps the zoom control on the right of the bottom row.
  if (!status) return <span />;
  return (
    <div
      title={path}
      className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border border-ov-line bg-ov-surface px-3 font-mono text-xs text-ov-text shadow-ov"
    >
      <GitBranch className="size-3.5 text-ov-text-2" />
      {status.branch}
      {status.changed > 0 && (
        <span className="rounded-full bg-ov-accent px-1.5 text-[10px] text-white">{status.changed}</span>
      )}
    </div>
  );
}
```

`src/shell/TopBar.tsx` :

```tsx
import { ArrowLeft, X } from "lucide-react";
import { projectsStore } from "@/store/projects";
import { LiveCount } from "./LiveCount";
import { ProjectPicker } from "./ProjectPicker";
import { SettingsMenu } from "./SettingsMenu";
import { PillButton } from "./ui";
import { WorkspaceTabs } from "./WorkspaceTabs";

/** Floating pills over the canvas, no band (spec habillage §5.2). */
export function TopBar() {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-4">
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        <PillButton onClick={() => projectsStore.getState().goHome()}>
          <ArrowLeft /> Accueil
        </PillButton>
        <ProjectPicker />
        <WorkspaceTabs />
        <PillButton onClick={() => void projectsStore.getState().close()}>
          <X /> Fermer
        </PillButton>
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        <LiveCount />
        <SettingsMenu />
      </div>
    </div>
  );
}
```

Remplacer `src/shell/ProjectView.tsx` :

```tsx
import { Canvas } from "@/canvas/Canvas";
import { useWorkspaces } from "@/store/workspaces";
import { GitChip } from "./GitChip";
import { LeftRail } from "./LeftRail";
import { TopBar } from "./TopBar";
import { ZoomControl } from "./ZoomControl";

/** The open project: the canvas under the floating shell (spec habillage §5). */
export function ProjectView() {
  const status = useWorkspaces((s) => s.status);
  const error = useWorkspaces((s) => s.error);
  const activeId = useWorkspaces((s) => s.activeId);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-ov-canvas">
      {status === "ready" && activeId ? (
        <>
          <Canvas key={activeId} workspaceId={activeId} />
          <LeftRail />
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 flex items-end justify-between gap-4">
            <GitChip />
            <ZoomControl />
          </div>
        </>
      ) : (
        <div className="grid h-full place-items-center text-sm text-ov-text-2">
          {status === "error" ? `Impossible de charger les workspaces : ${error}` : "Chargement…"}
        </div>
      )}
      <TopBar />
    </div>
  );
}
```

Supprimer `src/sidebar/WorkspaceSidebar.tsx` et le dossier `src/sidebar`.

- [ ] **Step 4: Tests, types, build**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit && pnpm build 2>&1 | tail -3`
Expected: verts, build réussi.

- [ ] **Step 5: Vérification manuelle J1 (Mathieu)**

Lancer `pnpm tauri dev`. Capture de contrôle (`shot.ps1`) à comparer avec `tour\t005.6.jpg`, puis Mathieu vérifie :

1. La base est migrée : le workspace existant apparaît dans le projet `mk-webapp`, ses terminaux restaurés arrêtés comme avant.
2. Plus aucune trace de l'interface d'origine d'Excalidraw (barre d'outils, menu, pied de page, aide, bibliothèque).
3. Rail gauche : formes, flèches, texte, stylo (couleurs, épaisseurs), gomme, image ; R, O, T, P, E au clavier allument le bon bouton ; Ctrl+Z et Ctrl+Y fonctionnent.
4. Le panneau de propriétés restylé apparaît accolé au rail et change bien la couleur, la police et la taille d'un texte.
5. Barre du haut : Accueil, sélecteur de projet, onglets (renommer par double-clic, menu au clic droit, suppression confirmée), `+`, Fermer, `N actifs`, Réglages (exporter, importer, PNG, à propos).
6. Accueil : cartes, « Ajouter un projet », ouvrir, renommer, changer de dossier, retirer.
7. Puce git en bas à gauche (branche, nombre de fichiers modifiés) ; zoom en bas à droite.
8. « Fermer » puis relancer l'application : l'accueil s'affiche. « Accueil » puis relancer : le projet se rouvre.

Consigner chaque résultat dans le journal. Les écarts se corrigent dans cette tâche, avec un test quand le défaut vient de la logique.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(shell): floating top bar with projects, workspace tabs, settings and git chip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Jalon J2 — Terminal et catalogue

### Task 9: Catalogue d'agents et Ollama

**Files:**
- Rename: `src-tauri/src/presets.rs` → `src-tauri/src/agents.rs` (`git mv`), puis remplacement complet
- Modify: `src-tauri/src/pty/shell.rs`, `src-tauri/src/commands/pty.rs`, `src-tauri/src/lib.rs`
- Modify: `src/ipc/pty.ts`, `src/nodes/types.ts`, `src/nodes/terminal/launch.ts`, `src/nodes/terminal/launch.test.ts`, `src/nodes/terminal/session.test.ts`, `src/store/nodes.ts`, `src/store/nodes.test.ts`, `src/nodes/terminal/TerminalNode.tsx`, `src/nodes/terminal/LaunchDialog.tsx`
- Create: `src/fleet/catalog.ts`, `src/fleet/catalog.test.ts`, `src/nodes/types.test.ts`

**Interfaces:**
- Consumes: `crate::process::hide_window` (Tâche 2).
- Produces:
  - Rust : `pty::shell::{Agent, OllamaMode, OllamaLaunch, agent_command(&SpawnSpec, ShellSyntax), binary(Agent) -> &'static str}` ; `SpawnSpec.agent` (alias JSON `preset`) et `SpawnSpec.ollama` ; `agents::{AgentInfo { id, available }, list_agents(Locate), list_shells(Locate), parse_ollama_list(&str), ollama_models()}` ; commandes `list_agents`, `list_ollama_models` (remplacent `list_presets`).
  - TS : `AGENT_IDS`, `AgentId`, `OllamaMode`, `OllamaLaunch { model, mode }`, `AgentInfo { id, available }`, `SpawnSpec { cwd, shell, agent, command, claude?, ollama? }`, `listAgents()`, `listOllamaModels()` dans `src/ipc/pty.ts` ; `AGENTS: Record<AgentId, { label, vendor, tint, binary, Icon }>`, `AGENT_ORDER`, `defaultAgent(agents)` dans `src/fleet/catalog.ts` ; `TerminalPayload { title, name, agent, cwd, shell, command, claudeSessionId?, ollama? }` et `readTerminalPayload(raw)` dans `src/nodes/types.ts` ; `defaultTitle(agent, cwd)`, `LaunchInput { title, cwd, agent, command, shell, ollama? }`, `newTerminalPayload(input, name = "")`, `buildSpawnSpec(payload, mode)` dans `launch.ts`.

- [ ] **Step 1: Écrire les tests Rust**

`git mv src-tauri/src/presets.rs src-tauri/src/agents.rs`. Dans `src-tauri/src/pty/shell.rs` :

1. Renommer dans tout le fichier `Preset::` en `Agent::` et `preset_command` en `agent_command` (`sed -i 's/Preset::/Agent::/g; s/preset_command/agent_command/g' src-tauri/src/pty/shell.rs`).
2. Remplacer l'aide de test `spec` par :

```rust
    fn spec(agent: Agent, claude: Option<ClaudeLaunch>) -> SpawnSpec {
        SpawnSpec {
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            shell: ShellKind::Cmd,
            agent,
            command: String::new(),
            claude,
            ollama: None,
        }
    }
```

3. Ajouter ces tests au module `tests` :

```rust
    #[test]
    fn each_agent_types_its_own_command() {
        let agents = [
            (Agent::Codex, "codex"),
            (Agent::Gemini, "gemini"),
            (Agent::Qwen, "qwen"),
            (Agent::Cursor, "cursor-agent"),
            (Agent::Opencode, "opencode"),
            (Agent::Aider, "aider"),
        ];
        for (agent, command) in agents {
            assert_eq!(
                agent_command(&spec(agent, None), ShellSyntax::PowerShell)
                    .unwrap()
                    .as_deref(),
                Some(command)
            );
        }
    }

    #[test]
    fn ollama_runs_a_model_in_chat_or_through_aider() {
        let mut s = spec(Agent::Ollama, None);
        s.ollama = Some(OllamaLaunch {
            model: "qwen2.5-coder:7b".into(),
            mode: OllamaMode::Chat,
        });
        assert_eq!(
            agent_command(&s, ShellSyntax::PowerShell).unwrap().as_deref(),
            Some("ollama run 'qwen2.5-coder:7b'")
        );
        s.ollama = Some(OllamaLaunch {
            model: "qwen2.5-coder:7b".into(),
            mode: OllamaMode::Code,
        });
        assert_eq!(
            agent_command(&s, ShellSyntax::Cmd).unwrap().as_deref(),
            Some("aider --model \"ollama_chat/qwen2.5-coder:7b\"")
        );
    }

    #[test]
    fn rejects_a_missing_or_unsafe_ollama_model() {
        let mut s = spec(Agent::Ollama, None);
        assert_eq!(
            agent_command(&s, ShellSyntax::Cmd).unwrap_err().kind(),
            "invalidInput"
        );
        s.ollama = Some(OllamaLaunch {
            model: "llama3 & del *".into(),
            mode: OllamaMode::Chat,
        });
        assert_eq!(
            agent_command(&s, ShellSyntax::Cmd).unwrap_err().kind(),
            "invalidInput"
        );
    }

    #[test]
    fn deserializes_the_agent_and_its_ollama_options() {
        let json = serde_json::json!({
            "cwd": "C:/code", "shell": "cmd", "agent": "ollama", "command": "",
            "ollama": { "model": "llama3", "mode": "code" }
        });
        let s: SpawnSpec = serde_json::from_value(json).unwrap();
        assert_eq!(s.agent, Agent::Ollama);
        assert_eq!(s.ollama.unwrap().mode, OllamaMode::Code);
    }
```

(Le test existant `deserializes_spawn_spec_from_frontend_json`, qui envoie `"preset": "claude"`, reste tel quel : il vérifie l'alias.)

Remplacer `src-tauri/src/agents.rs` par ses tests (le code vient à l'étape 3) :

```rust
#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn marks_agents_available_only_when_found_on_path() {
        let locate = |name: &str| {
            matches!(name, "claude" | "cursor-agent").then(|| PathBuf::from(format!("C:/bin/{name}.cmd")))
        };
        let available: Vec<_> = list_agents(&locate)
            .into_iter()
            .filter(|a| a.available)
            .map(|a| a.id)
            .collect();
        assert_eq!(
            available,
            vec![Agent::Claude, Agent::Cursor, Agent::Shell, Agent::Custom]
        );
    }

    #[test]
    fn lists_the_whole_catalog_in_menu_order() {
        let agents = list_agents(&|_| None);
        assert_eq!(agents.len(), 10);
        assert_eq!(agents[0].id, Agent::Claude);
        assert_eq!(agents[9].id, Agent::Custom);
    }

    #[test]
    fn serializes_agent_ids_in_lowercase() {
        let json = serde_json::to_value(AgentInfo {
            id: Agent::Opencode,
            available: true,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "id": "opencode", "available": true })
        );
    }

    #[test]
    fn reads_model_names_from_ollama_list() {
        let output = "NAME                ID              SIZE      MODIFIED\n\
                      qwen2.5-coder:7b    2b0496514337    4.7 GB    2 days ago\n\
                      llama3:latest       365c0bd3c000    4.7 GB    3 weeks ago\n\n";
        assert_eq!(
            parse_ollama_list(output),
            vec!["qwen2.5-coder:7b", "llama3:latest"]
        );
        assert!(parse_ollama_list("NAME ID SIZE MODIFIED\n").is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn lists_builtin_windows_shells_and_optional_pwsh() {
        assert_eq!(
            list_shells(&|_| None),
            vec![ShellKind::PowerShell, ShellKind::Cmd]
        );
        let with_pwsh =
            list_shells(&|name: &str| (name == "pwsh").then(|| PathBuf::from("C:/pwsh.exe")));
        assert_eq!(
            with_pwsh,
            vec![ShellKind::PowerShell, ShellKind::Cmd, ShellKind::Pwsh]
        );
    }
}
```

- [ ] **Step 2: Les voir échouer**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -20`
Expected: échec de compilation — `Agent`, `OllamaLaunch`, `list_agents`, `parse_ollama_list` introuvables.

- [ ] **Step 3: Écrire le catalogue Rust**

Dans `src-tauri/src/pty/shell.rs`, remplacer l'enum `Preset` par :

```rust
/// The agents of the launch menu (spec habillage §8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
    Gemini,
    Qwen,
    Cursor,
    Opencode,
    Aider,
    Ollama,
    Shell,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OllamaMode {
    /// `ollama run <model>`: a conversation, no access to the repository.
    Chat,
    /// Aider driven by the local model: edits the repository.
    Code,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaLaunch {
    pub model: String,
    pub mode: OllamaMode,
}
```

Dans `SpawnSpec`, remplacer `pub preset: Preset,` par :

```rust
    /// Saved terminals of plan 2 send `preset`; the ids are the same.
    #[serde(alias = "preset")]
    pub agent: Agent,
```

et ajouter après `pub claude: Option<ClaudeLaunch>,` :

```rust
    #[serde(default)]
    pub ollama: Option<OllamaLaunch>,
```

Remplacer la fonction `agent_command` (ex-`preset_command`) par :

```rust
/// The program an agent runs; `list_agents` looks for it on the PATH.
pub fn binary(agent: Agent) -> &'static str {
    match agent {
        Agent::Claude => "claude",
        Agent::Codex => "codex",
        Agent::Gemini => "gemini",
        Agent::Qwen => "qwen",
        Agent::Cursor => "cursor-agent",
        Agent::Opencode => "opencode",
        Agent::Aider => "aider",
        Agent::Ollama => "ollama",
        Agent::Shell | Agent::Custom => "",
    }
}

/// The command typed into the shell for an agent, or `None` for a plain shell.
pub fn agent_command(spec: &SpawnSpec, syntax: ShellSyntax) -> AppResult<Option<String>> {
    Ok(match spec.agent {
        Agent::Shell => None,
        Agent::Custom => {
            let command = spec.command.trim();
            if command.is_empty() {
                return Err(AppError::InvalidInput(
                    "la commande personnalisée est vide".into(),
                ));
            }
            Some(command.to_string())
        }
        Agent::Claude => Some(claude_command(spec.claude.as_ref(), syntax)?),
        Agent::Ollama => Some(ollama_command(spec.ollama.as_ref(), syntax)?),
        other => Some(binary(other).into()),
    })
}

/// Model names are typed into a shell: only the characters Ollama uses in them
/// ("qwen2.5-coder:7b", "hf.co/user/model:tag") are accepted.
fn ollama_command(launch: Option<&OllamaLaunch>, syntax: ShellSyntax) -> AppResult<String> {
    let launch =
        launch.ok_or_else(|| AppError::InvalidInput("options Ollama manquantes".into()))?;
    let model = launch.model.trim();
    let valid = !model.is_empty()
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c));
    if !valid {
        return Err(AppError::InvalidInput(format!(
            "modèle Ollama invalide : {model}"
        )));
    }
    Ok(match launch.mode {
        OllamaMode::Chat => format!("ollama run {}", quote(syntax, model)),
        OllamaMode::Code => format!(
            "aider --model {}",
            quote(syntax, &format!("ollama_chat/{model}"))
        ),
    })
}
```

(`build_plan` appelle déjà `agent_command` après le `sed`.)

Écrire le haut de `src-tauri/src/agents.rs` (au-dessus des tests) :

```rust
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::process::hide_window;
use crate::pty::shell::{Agent, Locate, ShellKind, binary, find_git_bash};

/// Availability of an agent; labels, logos and tints live in the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: Agent,
    pub available: bool,
}

/// Menu order of the catalog (spec habillage §8).
const CATALOG: [Agent; 10] = [
    Agent::Claude,
    Agent::Codex,
    Agent::Gemini,
    Agent::Qwen,
    Agent::Cursor,
    Agent::Opencode,
    Agent::Aider,
    Agent::Ollama,
    Agent::Shell,
    Agent::Custom,
];

pub fn list_agents(locate: Locate) -> Vec<AgentInfo> {
    CATALOG
        .iter()
        .map(|&id| AgentInfo {
            id,
            available: matches!(id, Agent::Shell | Agent::Custom) || locate(binary(id)).is_some(),
        })
        .collect()
}

/// Shells that can actually be started on this machine, default first.
pub fn list_shells(locate: Locate) -> Vec<ShellKind> {
    let mut shells = if cfg!(windows) {
        vec![ShellKind::PowerShell, ShellKind::Cmd]
    } else {
        vec![ShellKind::Default]
    };
    if locate("pwsh").is_some() {
        shells.push(ShellKind::Pwsh);
    }
    if cfg!(windows) && locate("git").and_then(|git| find_git_bash(&git)).is_some() {
        shells.push(ShellKind::GitBash);
    }
    shells
}

/// Model names of `ollama list`: the first column, header line skipped.
pub fn parse_ollama_list(output: &str) -> Vec<String> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().next())
        .map(str::to_string)
        .collect()
}

/// The models installed in Ollama (spec habillage §8.1).
pub fn ollama_models() -> AppResult<Vec<String>> {
    let output = hide_window(Command::new("ollama").arg("list"))
        .output()
        .map_err(|err| AppError::NotFound(format!("ollama introuvable : {err}")))?;
    if !output.status.success() {
        return Err(AppError::Io(std::io::Error::other(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        )));
    }
    Ok(parse_ollama_list(&String::from_utf8_lossy(&output.stdout)))
}
```

Dans `src-tauri/src/commands/pty.rs`, remplacer `use crate::presets::{self, PresetInfo};` par `use crate::agents::{self, AgentInfo};`, ajouter `AppError` à l'import de `crate::error`, et remplacer `list_presets` / `list_shells` par :

```rust
#[tauri::command]
pub async fn list_agents() -> AppResult<Vec<AgentInfo>> {
    Ok(agents::list_agents(&which_locate))
}

#[tauri::command]
pub async fn list_ollama_models() -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(agents::ollama_models)
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
}

#[tauri::command]
pub async fn list_shells() -> AppResult<Vec<ShellKind>> {
    Ok(agents::list_shells(&which_locate))
}
```

Dans `src-tauri/src/lib.rs` : `mod presets;` devient `mod agents;` ; dans `generate_handler!`, `commands::pty::list_presets,` devient `commands::pty::list_agents,` et ajouter `commands::pty::list_ollama_models,`.

- [ ] **Step 4: Tests Rust verts**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -5 && cargo fmt --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: `test result: ok.` et aucun avertissement.

- [ ] **Step 5: Écrire les tests du front**

`src/nodes/types.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { readTerminalPayload } from "./types";

describe("readTerminalPayload", () => {
  it("reads a payload saved before agents and names existed", () => {
    expect(readTerminalPayload({ title: "Claude Code · api", cwd: "C:/api", preset: "claude", command: "", shell: "cmd", claudeSessionId: "s1" })).toEqual({
      title: "Claude Code · api",
      name: "",
      agent: "claude",
      cwd: "C:/api",
      shell: "cmd",
      command: "",
      claudeSessionId: "s1",
    });
  });

  it("keeps a current payload as it is", () => {
    const payload = {
      title: "Ollama · api",
      name: "Isis",
      agent: "ollama",
      cwd: "C:/api",
      shell: "powershell",
      command: "",
      ollama: { model: "llama3", mode: "code" },
    };
    expect(readTerminalPayload(payload)).toEqual(payload);
  });

  it("rejects what cannot be launched", () => {
    expect(readTerminalPayload(null)).toBeNull();
    expect(readTerminalPayload({ agent: "vim", cwd: "C:/" })).toBeNull();
    expect(readTerminalPayload({ agent: "shell" })).toBeNull();
    expect(readTerminalPayload({ agent: "shell", cwd: "C:/", shell: "zsh" })?.shell).toBe("default");
  });
});
```

`src/fleet/catalog.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { AGENT_IDS } from "@/ipc/pty";
import { AGENT_ORDER, AGENTS, defaultAgent } from "./catalog";

describe("agent catalog", () => {
  it("describes every agent, in menu order", () => {
    expect(AGENT_ORDER).toEqual([...AGENT_IDS]);
    for (const id of AGENT_IDS) expect(AGENTS[id].label).not.toBe("");
  });

  it("picks Claude, then Codex, then Shell as the default agent", () => {
    const info = (...ids: string[]) =>
      AGENT_IDS.map((id) => ({ id, available: ids.includes(id) || id === "shell" || id === "custom" }));
    expect(defaultAgent(info("claude", "codex"))).toBe("claude");
    expect(defaultAgent(info("codex"))).toBe("codex");
    expect(defaultAgent(info())).toBe("shell");
    expect(defaultAgent([])).toBe("shell");
  });
});
```

Remplacer `src/nodes/terminal/launch.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { buildSpawnSpec, defaultTitle, newTerminalPayload } from "./launch";

const base = { title: "", cwd: "C:\\code\\dummyplane", agent: "shell" as const, command: "", shell: "default" as const };

describe("defaultTitle", () => {
  it("names the terminal after the agent and the folder", () => {
    expect(defaultTitle("claude", "C:\\code\\dummyplane\\")).toBe("Claude · dummyplane");
    expect(defaultTitle("shell", "/home/me/api")).toBe("Shell · api");
    expect(defaultTitle("aider", "")).toBe("Aider");
  });
});

describe("newTerminalPayload", () => {
  it("fills a blank title, trims the custom command and keeps the given name", () => {
    const payload = newTerminalPayload({ ...base, agent: "custom", command: "  npm run dev " }, "Thot");
    expect(payload.title).toBe("Personnalisé · dummyplane");
    expect(payload.command).toBe("npm run dev");
    expect(payload.name).toBe("Thot");
    expect(payload.claudeSessionId).toBeUndefined();
  });

  it("gives every Claude terminal its own session id", () => {
    const a = newTerminalPayload({ ...base, agent: "claude", title: "Agent" });
    const b = newTerminalPayload({ ...base, agent: "claude", title: "Agent" });
    expect(a.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.claudeSessionId).not.toBe(b.claudeSessionId);
    expect(a.title).toBe("Agent");
  });

  it("keeps the Ollama model and mode", () => {
    const payload = newTerminalPayload({ ...base, agent: "ollama", ollama: { model: "llama3", mode: "chat" } });
    expect(payload.ollama).toEqual({ model: "llama3", mode: "chat" });
  });
});

describe("buildSpawnSpec", () => {
  it("passes Claude options with the requested mode", () => {
    const payload = newTerminalPayload({ ...base, agent: "claude", title: "Agent" });
    expect(buildSpawnSpec(payload, "resume")).toEqual({
      cwd: base.cwd,
      shell: "default",
      agent: "claude",
      command: "",
      claude: { mode: "resume", sessionId: payload.claudeSessionId, title: "Agent" },
    });
  });

  it("passes Ollama options", () => {
    const payload = newTerminalPayload({ ...base, agent: "ollama", ollama: { model: "llama3", mode: "code" } });
    expect(buildSpawnSpec(payload, "new").ollama).toEqual({ model: "llama3", mode: "code" });
  });

  it("sends nothing agent-specific for a shell", () => {
    const spec = buildSpawnSpec(newTerminalPayload(base), "new");
    expect(spec.claude).toBeUndefined();
    expect(spec.ollama).toBeUndefined();
  });
});
```

Dans `src/nodes/terminal/session.test.ts` : la constante `payload` devient `{ title: "A", name: "", cwd: "C:/code", agent: "shell", command: "", shell: "default" }` et l'attente `spec: { preset: "shell" }` devient `spec: { agent: "shell" }`. Dans `src/store/nodes.test.ts`, la constante `payload` devient `{ title: "A", name: "", cwd: "C:/code", agent: "shell", command: "", shell: "default" }`, et ajouter :

```ts
it("reads payloads saved with a preset instead of an agent", () => {
  const store = createNodesStore().store;
  store.getState().hydrate("w1", [
    { id: "old", kind: "terminal", payloadJson: JSON.stringify({ title: "T", cwd: "C:/", preset: "codex", command: "", shell: "cmd" }) },
    { id: "bad", kind: "terminal", payloadJson: "{" },
  ]);
  expect(store.getState().nodes.old.payload.agent).toBe("codex");
  expect(store.getState().nodes.bad).toBeUndefined();
});
```

(importer `createNodesStore` depuis `./nodes` si le fichier ne l'importe pas déjà.)

- [ ] **Step 6: Les voir échouer**

Run: `pnpm test 2>&1 | tail -15`
Expected: FAIL — `readTerminalPayload`, `./catalog` introuvables ; `defaultTitle("claude", …)` renvoie encore `Claude Code · dummyplane`.

- [ ] **Step 7: Écrire le catalogue et les charges utiles**

Dans `src/ipc/pty.ts`, remplacer `Preset`, `PresetInfo`, `SpawnSpec` et `listPresets` par :

```ts
/** Agents of the launch menu (spec habillage §8), in menu order. */
export const AGENT_IDS = ["claude", "codex", "gemini", "qwen", "cursor", "opencode", "aider", "ollama", "shell", "custom"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type OllamaMode = "chat" | "code";

export interface OllamaLaunch {
  model: string;
  mode: OllamaMode;
}

/** Mirrors Rust's `SpawnSpec`. */
export interface SpawnSpec {
  cwd: string;
  shell: ShellKind;
  agent: AgentId;
  command: string;
  claude?: ClaudeLaunch;
  ollama?: OllamaLaunch;
}

export interface AgentInfo {
  id: AgentId;
  available: boolean;
}
```

et, à la place de `export const listPresets = …` :

```ts
export const listAgents = () => call<AgentInfo[]>("list_agents");
export const listOllamaModels = () => call<string[]>("list_ollama_models");
```

`src/fleet/catalog.ts` :

```ts
import {
  Asterisk,
  Bot,
  Code,
  Cpu,
  Hexagon,
  MousePointer2,
  Sparkle,
  SquareCode,
  SquareTerminal,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { AGENT_IDS, type AgentId, type AgentInfo } from "@/ipc/pty";

export interface AgentMeta {
  label: string;
  vendor: string;
  /** Border and logo color of the agent's terminals (spec habillage §8). */
  tint: string;
  /** The program looked for on the PATH ("" for shell and custom). */
  binary: string;
  Icon: LucideIcon;
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  claude: { label: "Claude", vendor: "Anthropic", tint: "#e8603a", binary: "claude", Icon: Asterisk },
  codex: { label: "Codex", vendor: "OpenAI", tint: "#707de3", binary: "codex", Icon: SquareTerminal },
  gemini: { label: "Gemini", vendor: "Google", tint: "#5c86e0", binary: "gemini", Icon: Sparkle },
  qwen: { label: "Qwen Code", vendor: "Alibaba", tint: "#a57be0", binary: "qwen", Icon: Hexagon },
  cursor: { label: "Cursor", vendor: "cursor-agent", tint: "#d4d4cc", binary: "cursor-agent", Icon: MousePointer2 },
  opencode: { label: "OpenCode", vendor: "sst", tint: "#77b7c0", binary: "opencode", Icon: Code },
  aider: { label: "Aider", vendor: "aider", tint: "#86a174", binary: "aider", Icon: Bot },
  ollama: { label: "Ollama", vendor: "modèle local", tint: "#ede8df", binary: "ollama", Icon: Cpu },
  shell: { label: "Shell", vendor: "par défaut", tint: "#8a8a80", binary: "", Icon: Terminal },
  custom: { label: "Personnalisé", vendor: "commande", tint: "#8a8a80", binary: "", Icon: SquareCode },
};

export const AGENT_ORDER: AgentId[] = [...AGENT_IDS];

/** The agent of "Nouvelle console": the first available of Claude, Codex, Shell. */
export function defaultAgent(agents: readonly AgentInfo[]): AgentId {
  for (const id of ["claude", "codex"] as const) {
    if (agents.some((agent) => agent.id === id && agent.available)) return id;
  }
  return "shell";
}
```

Remplacer `src/nodes/types.ts` :

```ts
import { AGENT_IDS, type AgentId, type OllamaLaunch, type ShellKind } from "@/ipc/pty";

/** Content of a terminal node (spec habillage §15.2). */
export interface TerminalPayload {
  /** Full title: tooltip of the header, and the session name given to Claude. */
  title: string;
  /** Mythological first name shown in the header ("" until one is given). */
  name: string;
  agent: AgentId;
  cwd: string;
  shell: ShellKind;
  /** Used by the "custom" agent only. */
  command: string;
  /** The Claude Code conversation of this node, for `--session-id` / `--resume`. */
  claudeSessionId?: string;
  ollama?: OllamaLaunch;
}

/** Plan B adds the orchestrator payload. */
export type NodePayload = TerminalPayload;

const SHELLS = new Set<string>(["default", "powershell", "pwsh", "cmd", "gitbash"]);

/**
 * Reads a stored terminal payload, including those saved before agents and names
 * existed (`preset` instead of `agent`, no `name`). Null when it cannot be launched.
 */
export function readTerminalPayload(raw: unknown): TerminalPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const agent = typeof r.agent === "string" ? r.agent : r.preset;
  if (typeof agent !== "string" || !(AGENT_IDS as readonly string[]).includes(agent) || typeof r.cwd !== "string") {
    return null;
  }
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const payload: TerminalPayload = {
    title: text(r.title),
    name: text(r.name),
    agent: agent as AgentId,
    cwd: r.cwd,
    shell: (typeof r.shell === "string" && SHELLS.has(r.shell) ? r.shell : "default") as ShellKind,
    command: text(r.command),
  };
  if (typeof r.claudeSessionId === "string") payload.claudeSessionId = r.claudeSessionId;
  const ollama = r.ollama as Record<string, unknown> | undefined;
  if (ollama && typeof ollama.model === "string" && (ollama.mode === "chat" || ollama.mode === "code")) {
    payload.ollama = { model: ollama.model, mode: ollama.mode };
  }
  return payload;
}
```

Remplacer `src/nodes/terminal/launch.ts` :

```ts
import type { AgentId, OllamaLaunch, ShellKind, SpawnSpec } from "@/ipc/pty";
import { AGENTS } from "@/fleet/catalog";
import type { TerminalPayload } from "@/nodes/types";

/** How "Relancer" starts a Claude terminal (spec V1 §5.3); other agents ignore it. */
export type LaunchMode = "new" | "resume" | "continue";

export const SHELL_LABELS: Record<ShellKind, string> = {
  default: "Par défaut",
  powershell: "PowerShell",
  pwsh: "PowerShell 7",
  cmd: "Invite de commandes",
  gitbash: "Git Bash",
};

/** "Claude · dummyplane": the agent and the last folder of the working directory. */
export function defaultTitle(agent: AgentId, cwd: string): string {
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop();
  return folder ? `${AGENTS[agent].label} · ${folder}` : AGENTS[agent].label;
}

export interface LaunchInput {
  title: string;
  cwd: string;
  agent: AgentId;
  command: string;
  shell: ShellKind;
  ollama?: OllamaLaunch;
}

/** The payload of a new terminal; a Claude terminal gets its own conversation id. */
export function newTerminalPayload(input: LaunchInput, name = ""): TerminalPayload {
  const payload: TerminalPayload = {
    title: input.title.trim() || defaultTitle(input.agent, input.cwd),
    name,
    agent: input.agent,
    cwd: input.cwd,
    shell: input.shell,
    command: input.command.trim(),
  };
  if (input.agent === "claude") payload.claudeSessionId = crypto.randomUUID();
  if (input.agent === "ollama" && input.ollama) payload.ollama = input.ollama;
  return payload;
}

export function buildSpawnSpec(payload: TerminalPayload, mode: LaunchMode): SpawnSpec {
  const spec: SpawnSpec = { cwd: payload.cwd, shell: payload.shell, agent: payload.agent, command: payload.command };
  if (payload.agent === "claude") {
    spec.claude = { mode, sessionId: payload.claudeSessionId ?? crypto.randomUUID(), title: payload.title };
  }
  if (payload.agent === "ollama" && payload.ollama) spec.ollama = payload.ollama;
  return spec;
}
```

Dans `src/store/nodes.ts`, importer `readTerminalPayload` depuis `@/nodes/types` et remplacer la boucle de `hydrate` par :

```ts
        for (const node of stored) {
          let payload: NodePayload | null = null;
          try {
            payload = readTerminalPayload(JSON.parse(node.payloadJson));
          } catch {
            payload = null;
          }
          if (payload) loaded[node.id] = { workspaceId, kind: node.kind, payload };
          else console.warn(`node ${node.id}: unreadable payload, skipped`);
        }
```

Dans `src/nodes/terminal/TerminalNode.tsx` : remplacer l'import `PRESET_LABELS` par `import { AGENTS } from "@/fleet/catalog";`, `PRESET_LABELS[payload.preset]` par `AGENTS[payload.agent].label` et `payload.preset === "claude"` par `payload.agent === "claude"` (le composant est réécrit en Tâche 11).

Dans `src/nodes/terminal/LaunchDialog.tsx` (supprimé en Tâche 14) :
- imports : `listPresets, type Preset, type PresetInfo` deviennent `listAgents, type AgentId, type AgentInfo` ; `PRESET_LABELS` devient `AGENTS` importé de `@/fleet/catalog` ;
- états : `const [presets, setPresets] = useState<PresetInfo[]>([]);` devient `const [agents, setAgents] = useState<AgentInfo[]>([]);` et `const [preset, setPreset] = useState<Preset>("claude");` devient `const [agent, setAgent] = useState<AgentId>("claude");` ;
- l'effet appelle `listAgents().then((list) => { const usable = list.filter((a) => a.id !== "ollama"); setAgents(usable); setAgent((current) => (usable.find((a) => a.id === current)?.available ? current : "shell")); })` ;
- partout ailleurs, `preset` devient `agent`, `presets` devient `agents`, `setPreset` devient `setAgent`, `PRESET_LABELS[p.id]` devient `AGENTS[p.id].label`, et `value as Preset` devient `value as AgentId` ;
- `newTerminalPayload({ title, cwd: cwd.trim(), preset, command, shell })` devient `newTerminalPayload({ title, cwd: cwd.trim(), agent, command, shell })`.

- [ ] **Step 8: Tous les tests verts, commit**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

```bash
rm -f *.stackdump
git add -A src src-tauri/src
git commit -m "feat: agent catalog with Ollama replaces launch presets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Prénoms mythologiques

**Files:**
- Create: `src/fleet/names.ts`, `src/fleet/names.test.ts`, `src/fleet/naming.ts`, `src/fleet/naming.test.ts`
- Modify: `src/store/workspaces.ts`, `src/store/workspaces.test.ts`, `src/canvas/Canvas.tsx`

**Interfaces:**
- Consumes: `TerminalPayload.name` (Tâche 9), `workspacesStore.setPantheon` (Tâche 3), `liveNodeIds` (`src/canvas/sceneSync.ts`).
- Produces:
  - `PantheonId`, `PANTHEONS: { id, label, names }[]`, `nextPantheon(used)`, `nextName(pantheon, taken)`.
  - `workspacesStore.ensurePantheon(id): Promise<string>`.
  - `namesInWorkspace(workspaceId): string[]`, `nameForNewAgent(workspaceId): Promise<string>`, `assignMissingNames(workspaceId, orderedIds): Promise<void>`.

- [ ] **Step 1: Écrire les tests**

`src/fleet/names.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { nextName, nextPantheon, PANTHEONS } from "./names";

describe("pantheons", () => {
  it("has 12 pantheons of 16 distinct names", () => {
    expect(PANTHEONS.map((p) => p.id)).toEqual([
      "egyptian",
      "greek",
      "norse",
      "japanese",
      "celtic",
      "hindu",
      "aztec",
      "mesopotamian",
      "slavic",
      "chinese",
      "roman",
      "yoruba",
    ]);
    for (const pantheon of PANTHEONS) {
      expect(pantheon.names).toHaveLength(16);
      expect(new Set(pantheon.names.map((n) => n.toLowerCase())).size).toBe(16);
      for (const name of pantheon.names) expect(name).not.toMatch(/\s/);
    }
  });
});

describe("nextPantheon", () => {
  it("takes the first pantheon not used in the workspace, then starts over", () => {
    expect(nextPantheon([])).toBe("egyptian");
    expect(nextPantheon(["egyptian", null, undefined])).toBe("greek");
    expect(nextPantheon(PANTHEONS.map((p) => p.id))).toBe("egyptian");
  });
});

describe("nextName", () => {
  it("takes the first free name, ignoring case", () => {
    expect(nextName("egyptian", [])).toBe("Isis");
    expect(nextName("egyptian", ["isis", "Horus"])).toBe("Osiris");
    expect(nextName("greek", [])).toBe("Athéna");
  });

  it("adds 2, then 3, once every name is taken", () => {
    const egyptian = PANTHEONS[0].names;
    expect(nextName("egyptian", [...egyptian])).toBe("Isis 2");
    expect(nextName("egyptian", [...egyptian, "Isis 2"])).toBe("Osiris 2");
    expect(nextName("egyptian", [...egyptian, ...egyptian.map((n) => `${n} 2`)])).toBe("Isis 3");
  });

  it("falls back to the first pantheon for an unknown id", () => {
    expect(nextName("atlantean", [])).toBe("Isis");
  });
});
```

`src/fleet/naming.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { flushAll } from "@/lib/flush";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { assignMissingNames, nameForNewAgent } from "./naming";

const terminal = (name?: string) =>
  JSON.stringify({ title: "t", cwd: "C:/code", agent: "claude", shell: "default", command: "", ...(name ? { name } : {}) });

let pantheonSaves: string[] = [];

beforeEach(async () => {
  pantheonSaves = [];
  mockIPC((cmd, raw) => {
    const args = raw as Record<string, string>;
    if (cmd === "list_workspaces") return [{ id: "w1", projectId: "p1", name: "A", position: 0, pantheon: null }];
    if (cmd === "set_workspace_pantheon") pantheonSaves.push(args.pantheon);
    if (cmd === "get_setting") return null;
    return undefined;
  });
  await workspacesStore.getState().load("p1");
  nodesStore.getState().forgetWorkspace("w1");
  nodesStore.getState().hydrate("w1", [
    { id: "a", kind: "terminal", payloadJson: terminal() },
    { id: "b", kind: "terminal", payloadJson: terminal("Isis") },
    { id: "c", kind: "terminal", payloadJson: terminal() },
  ]);
});

afterEach(async () => {
  await flushAll(); // debounced node saves must not outlive the IPC mock
  clearMocks();
});

const nameOf = (id: string) => nodesStore.getState().nodes[id].payload.name;

it("names the terminals saved before names existed, in scene order", async () => {
  await assignMissingNames("w1", ["c", "b", "a"]);
  expect([nameOf("c"), nameOf("b"), nameOf("a")]).toEqual(["Osiris", "Isis", "Horus"]);
  expect(pantheonSaves).toEqual(["egyptian"]);
});

it("gives a new agent the next free name of the workspace's pantheon", async () => {
  await assignMissingNames("w1", ["a", "b", "c"]);
  expect(await nameForNewAgent("w1")).toBe("Anubis");
  expect(pantheonSaves).toEqual(["egyptian"]);
});
```

Ajouter à `src/store/workspaces.test.ts`, dans `describe("workspaces store")` :

```ts
  it("chooses the pantheon of a workspace once", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    expect(await state().ensurePantheon("w1")).toBe("egyptian");
    expect(await state().ensurePantheon("w1")).toBe("egyptian");
    expect(db.workspaces[0].pantheon).toBe("egyptian");
  });
```

- [ ] **Step 2: Les voir échouer**

Run: `pnpm test 2>&1 | tail -10`
Expected: FAIL — `./names`, `./naming` introuvables ; `ensurePantheon is not a function`.

- [ ] **Step 3: Écrire les panthéons et l'attribution**

`src/fleet/names.ts` :

```ts
/** Spec habillage §9.1: each group draws its agents' names from its own pantheon. */
export type PantheonId =
  | "egyptian"
  | "greek"
  | "norse"
  | "japanese"
  | "celtic"
  | "hindu"
  | "aztec"
  | "mesopotamian"
  | "slavic"
  | "chinese"
  | "roman"
  | "yoruba";

export interface Pantheon {
  id: PantheonId;
  label: string;
  names: readonly string[];
}

export const PANTHEONS: readonly Pantheon[] = [
  { id: "egyptian", label: "Égyptien", names: ["Isis", "Osiris", "Horus", "Anubis", "Thot", "Rê", "Bastet", "Sekhmet", "Ptah", "Hathor", "Nout", "Seth", "Maât", "Amon", "Khnoum", "Sobek"] },
  { id: "greek", label: "Grec", names: ["Athéna", "Apollon", "Artémis", "Hermès", "Héra", "Zeus", "Poséidon", "Déméter", "Héphaïstos", "Arès", "Aphrodite", "Dionysos", "Hestia", "Perséphone", "Hadès", "Éos"] },
  { id: "norse", label: "Nordique", names: ["Odin", "Thor", "Freyja", "Loki", "Frigg", "Baldr", "Týr", "Heimdall", "Idunn", "Njörd", "Freyr", "Skadi", "Bragi", "Sif", "Vidar", "Hel"] },
  { id: "japanese", label: "Japonais", names: ["Amaterasu", "Susanoo", "Tsukuyomi", "Inari", "Raijin", "Fūjin", "Hachiman", "Benzaiten", "Izanagi", "Izanami", "Ebisu", "Kannon", "Daikoku", "Ryūjin", "Sarutahiko", "Ōkuninushi"] },
  { id: "celtic", label: "Celte", names: ["Lugh", "Brigid", "Dagda", "Morrigan", "Cernunnos", "Epona", "Ogma", "Nuada", "Belenos", "Danu", "Taranis", "Rhiannon", "Arawn", "Manannán", "Aengus", "Boann"] },
  { id: "hindu", label: "Hindou", names: ["Shiva", "Vishnu", "Brahma", "Lakshmi", "Ganesh", "Saraswati", "Parvati", "Durga", "Indra", "Agni", "Hanuman", "Kali", "Surya", "Varuna", "Krishna", "Rama"] },
  { id: "aztec", label: "Aztèque", names: ["Quetzalcoatl", "Tezcatlipoca", "Huitzilopochtli", "Tlaloc", "Xochiquetzal", "Chalchiuhtlicue", "Mictlantecuhtli", "Coatlicue", "Xipe", "Mixcoatl", "Tonatiuh", "Ehecatl", "Centeotl", "Xolotl", "Metztli", "Coyolxauhqui"] },
  { id: "mesopotamian", label: "Mésopotamien", names: ["Inanna", "Enki", "Enlil", "Marduk", "Ishtar", "Shamash", "Nanna", "Ninurta", "Ereshkigal", "Tiamat", "Anu", "Nabu", "Nergal", "Ninhursag", "Dumuzi", "Ashur"] },
  { id: "slavic", label: "Slave", names: ["Perun", "Veles", "Mokosh", "Svarog", "Dazhbog", "Stribog", "Lada", "Jarilo", "Morana", "Zorya", "Triglav", "Svetovid", "Kupala", "Rod", "Dodola", "Simargl"] },
  { id: "chinese", label: "Chinois", names: ["Guanyin", "Nüwa", "Fuxi", "Pangu", "Houyi", "Nezha", "Erlang", "Mazu", "Shennong", "Zhurong", "Gonggong", "Leigong", "Caishen", "Xiwangmu", "Yandi", "Huangdi"] },
  { id: "roman", label: "Romain", names: ["Jupiter", "Junon", "Minerve", "Mars", "Vénus", "Mercure", "Neptune", "Vulcain", "Diane", "Cérès", "Janus", "Vesta", "Bacchus", "Pluton", "Aurore", "Faunus"] },
  { id: "yoruba", label: "Yoruba", names: ["Obatala", "Oshun", "Shango", "Yemoja", "Ogun", "Eshu", "Orunmila", "Oya", "Olokun", "Osanyin", "Oshosi", "Babalu", "Aganju", "Obba", "Yewa", "Ibeji"] },
];

/** The first pantheon not used in the workspace; past the twelfth, the first one again. */
export function nextPantheon(used: readonly (string | null | undefined)[]): PantheonId {
  const taken = new Set(used.filter(Boolean));
  return (PANTHEONS.find((p) => !taken.has(p.id)) ?? PANTHEONS[0]).id;
}

/** The first name of the pantheon nobody in the workspace has; then "Isis 2", "Osiris 2"… */
export function nextName(pantheon: string, taken: readonly string[]): string {
  const names = (PANTHEONS.find((p) => p.id === pantheon) ?? PANTHEONS[0]).names;
  const used = new Set(taken.map((name) => name.toLocaleLowerCase("fr")));
  for (let round = 1; ; round++) {
    for (const name of names) {
      const candidate = round === 1 ? name : `${name} ${round}`;
      if (!used.has(candidate.toLocaleLowerCase("fr"))) return candidate;
    }
  }
}
```

Ajouter à `src/store/workspaces.ts` : l'import `import { nextPantheon } from "@/fleet/names";`, dans l'interface `ensurePantheon: (id: string) => Promise<string>;` (avec le commentaire `/** The pantheon of the agents outside any group, chosen and saved on first use. */`), et dans le store :

```ts
      ensurePantheon: async (id) => {
        const workspace = get().workspaces.find((w) => w.id === id);
        if (workspace?.pantheon) return workspace.pantheon;
        // Groups (plan B) will pass the pantheons they already use.
        const pantheon = nextPantheon([]);
        await get().setPantheon(id, pantheon);
        return pantheon;
      },
```

`src/fleet/naming.ts` :

```ts
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { nextName } from "./names";

/** Names already carried by the terminals of a workspace. */
export function namesInWorkspace(workspaceId: string): string[] {
  return Object.values(nodesStore.getState().nodes)
    .filter((node) => node.workspaceId === workspaceId && node.kind === "terminal" && node.payload.name)
    .map((node) => node.payload.name);
}

/** The name of an agent about to be created outside any group (spec habillage §9.2). */
export async function nameForNewAgent(workspaceId: string): Promise<string> {
  const pantheon = await workspacesStore.getState().ensurePantheon(workspaceId);
  return nextName(pantheon, namesInWorkspace(workspaceId));
}

/** Names the terminals saved before names existed, in scene order. */
export async function assignMissingNames(workspaceId: string, orderedIds: readonly string[]): Promise<void> {
  const nodes = nodesStore.getState().nodes;
  const unnamed = orderedIds.filter((id) => nodes[id]?.kind === "terminal" && !nodes[id].payload.name);
  if (unnamed.length === 0) return;
  const pantheon = await workspacesStore.getState().ensurePantheon(workspaceId);
  const taken = namesInWorkspace(workspaceId);
  for (const id of unnamed) {
    const name = nextName(pantheon, taken);
    taken.push(name);
    nodesStore.getState().update(id, { name });
  }
}
```

Dans `src/canvas/Canvas.tsx` :

- importer `import { assignMissingNames, nameForNewAgent } from "@/fleet/naming";` et `liveNodeIds` depuis `./sceneSync` ;
- dans `LoadedCanvas`, ajouter :

```ts
  // Terminals saved before plan A have no name yet (spec habillage §9.2).
  useEffect(() => {
    void assignMissingNames(workspaceId, liveNodeIds(scene.initialData.elements ?? [])).catch(reportSaveError);
  }, [workspaceId, scene]);
```

- dans `launch`, avant `nodesStore.getState().create(…)` : `payload = { ...payload, name: await nameForNewAgent(workspaceId) };` (et déclarer le paramètre `payload` modifiable : `async (input: TerminalPayload) => { let payload = input; … }`), le tout dans le `try`.

- [ ] **Step 4: Tests verts, commit**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(fleet): mythological names drawn from one pantheon per group

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Nœud terminal restylé

**Files:**
- Create: `src/nodes/terminal/pill.ts`, `src/nodes/terminal/pill.test.ts`, `src/nodes/terminal/TerminalHeader.tsx`, `src/nodes/terminal/StatusPill.tsx`, `src/nodes/terminal/ResumeCard.tsx`
- Modify: `src/nodes/terminal/TerminalNode.tsx` (remplacement complet), `src/nodes/terminal/registry.ts`

**Interfaces:**
- Consumes: `AGENTS`, `AGENT_ORDER` (Tâche 9), `useCanvas` (Tâche 5), `relaunchTerminal`, `stopTerminal`.
- Produces:
  - `pillOf(status): { label, tone: "live" | "stopped" | "done" | "failed" }`, `resumeOfferOf(status, agent, hasSession): "resume" | "relaunch" | null`, `startsOnKeystroke(status): boolean`.
  - `TerminalHeader({ nodeId, payload, status, actions? })` : `actions` est un emplacement que la Tâche 12 remplit (dupliquer, fermer).

- [ ] **Step 1: Écrire le test des états affichés**

`src/nodes/terminal/pill.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { pillOf, resumeOfferOf, startsOnKeystroke } from "./pill";

describe("pillOf", () => {
  it("labels each process state (spec habillage §7.2)", () => {
    expect(pillOf({ state: "running" })).toEqual({ label: "ACTIF", tone: "live" });
    expect(pillOf({ state: "stopped" })).toEqual({ label: "ARRÊTÉ", tone: "stopped" });
    expect(pillOf({ state: "exited", code: 0 })).toEqual({ label: "TERMINÉ · 0", tone: "done" });
    expect(pillOf({ state: "exited", code: 2 })).toEqual({ label: "TERMINÉ · 2", tone: "failed" });
    expect(pillOf({ state: "exited", code: null })).toEqual({ label: "TERMINÉ", tone: "done" });
    expect(pillOf({ state: "error", message: "x" })).toEqual({ label: "ERREUR", tone: "failed" });
  });
});

describe("resumeOfferOf", () => {
  it("offers to resume a Claude conversation, to relaunch anything else, never while running", () => {
    expect(resumeOfferOf({ state: "stopped" }, "claude", true)).toBe("resume");
    expect(resumeOfferOf({ state: "stopped" }, "claude", false)).toBe("relaunch");
    expect(resumeOfferOf({ state: "exited", code: 0 }, "codex", false)).toBe("relaunch");
    expect(resumeOfferOf({ state: "running" }, "claude", true)).toBeNull();
  });
});

describe("startsOnKeystroke", () => {
  it("starts a terminal from the keyboard only when nothing runs in it", () => {
    expect(startsOnKeystroke({ state: "stopped" })).toBe(true);
    expect(startsOnKeystroke({ state: "exited", code: 1 })).toBe(true);
    expect(startsOnKeystroke({ state: "error", message: "x" })).toBe(true);
    expect(startsOnKeystroke({ state: "running" })).toBe(false);
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/nodes/terminal/pill 2>&1 | tail -5`
Expected: FAIL — `./pill` introuvable.

- [ ] **Step 3: Écrire les états, l'en-tête et le nœud**

`src/nodes/terminal/pill.ts` :

```ts
import type { AgentId } from "@/ipc/pty";
import type { TerminalStatus } from "@/store/terminalStatus";

export type PillTone = "live" | "stopped" | "done" | "failed";

/**
 * The status pill of a terminal header (spec habillage §7.2). Until agent
 * activity is detected (plan B), a running process reads ACTIF.
 */
export function pillOf(status: TerminalStatus): { label: string; tone: PillTone } {
  switch (status.state) {
    case "running":
      return { label: "ACTIF", tone: "live" };
    case "stopped":
      return { label: "ARRÊTÉ", tone: "stopped" };
    case "exited":
      return {
        label: status.code === null ? "TERMINÉ" : `TERMINÉ · ${status.code}`,
        tone: status.code === null || status.code === 0 ? "done" : "failed",
      };
    case "error":
      return { label: "ERREUR", tone: "failed" };
  }
}

/** What the card over a stopped terminal offers (spec habillage §7.3). */
export function resumeOfferOf(status: TerminalStatus, agent: AgentId, hasSession: boolean): "resume" | "relaunch" | null {
  if (status.state === "running") return null;
  return agent === "claude" && hasSession ? "resume" : "relaunch";
}

/**
 * Typing in a terminal where nothing runs starts it again. Only real keystrokes
 * count: a restored screen makes xterm answer old terminal queries by itself.
 */
export function startsOnKeystroke(status: TerminalStatus): boolean {
  return status.state !== "running";
}
```

`src/nodes/terminal/StatusPill.tsx` :

```tsx
import { cn } from "@/lib/utils";
import type { TerminalStatus } from "@/store/terminalStatus";
import { pillOf, type PillTone } from "./pill";

const TONES: Record<PillTone, string> = {
  live: "bg-[#322f28] text-ov-text",
  stopped: "bg-ov-card text-ov-text-2",
  done: "border border-ov-done/60 text-ov-done",
  failed: "border border-ov-danger/60 text-ov-danger",
};

const DOTS: Record<PillTone, string> = {
  live: "bg-ov-live",
  stopped: "bg-ov-text-2/60",
  done: "bg-ov-done",
  failed: "bg-ov-danger",
};

export function StatusPill({ status }: { status: TerminalStatus }) {
  const pill = pillOf(status);
  return (
    <span
      title={status.state === "error" ? status.message : undefined}
      className={cn(
        "flex h-4 items-center gap-1 rounded-full px-1.5 font-mono text-[9px] font-medium tracking-wide",
        TONES[pill.tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOTS[pill.tone])} />
      {pill.label}
    </span>
  );
}
```

`src/nodes/terminal/ResumeCard.tsx` :

```tsx
import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import type { TerminalPayload } from "@/nodes/types";
import type { TerminalStatus } from "@/store/terminalStatus";
import { resumeOfferOf } from "./pill";
import { relaunchTerminal } from "./registry";

/** Floating card over a stopped terminal (spec habillage §7.3). */
export function ResumeCard(props: { nodeId: string; payload: TerminalPayload; status: TerminalStatus }) {
  const { nodeId, payload, status } = props;
  const [dismissed, setDismissed] = useState(false);
  const offer = resumeOfferOf(status, payload.agent, Boolean(payload.claudeSessionId));

  useEffect(() => {
    if (status.state === "running") setDismissed(false);
  }, [status.state]);

  if (!offer || dismissed) return null;
  const resume = offer === "resume";
  return (
    <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-ov-line bg-ov-surface-2/95 px-3 py-2 text-xs shadow-ov">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => relaunchTerminal(nodeId, payload, resume ? "resume" : "new")}
      >
        <History className="size-4 shrink-0 text-ov-accent" />
        <span className="min-w-0">
          <span className="block font-medium text-ov-text">
            {resume ? "Reprendre la dernière conversation ?" : "Relancer ?"}
          </span>
          <span className="block truncate text-ov-text-2">
            {resume ? "Cliquer pour reprendre · taper démarre à neuf" : "Cliquer pour relancer · taper démarre à neuf"}
          </span>
        </span>
      </button>
      <button type="button" aria-label="Masquer" className="text-ov-text-2 hover:text-ov-text" onClick={() => setDismissed(true)}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}
```

`src/nodes/terminal/TerminalHeader.tsx` :

```tsx
import { useState, type ReactNode } from "react";
import { ChevronDown, RotateCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { AGENT_ORDER, AGENTS } from "@/fleet/catalog";
import type { AgentId } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import type { LaunchMode } from "./launch";
import { relaunchTerminal, stopTerminal } from "./registry";
import { StatusPill } from "./StatusPill";

/** Agents that need no options can be switched to from the header. */
const SWITCHABLE = AGENT_ORDER.filter((id) => id !== "ollama" && id !== "custom");

export function HeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      className="grid size-5 place-items-center rounded text-ov-text-2 hover:bg-ov-card hover:text-ov-text [&_svg]:size-3.5"
    >
      {props.children}
    </button>
  );
}

function switchAgent(nodeId: string, payload: TerminalPayload, agent: AgentId) {
  const needsSession = agent === "claude" && !payload.claudeSessionId;
  nodesStore.getState().update(nodeId, needsSession ? { agent, claudeSessionId: crypto.randomUUID() } : { agent });
}

function RelaunchMenu(props: { nodeId: string; payload: TerminalPayload; running: boolean }) {
  const { nodeId, payload, running } = props;
  const relaunch = (mode: LaunchMode) => relaunchTerminal(nodeId, payload, mode);
  const newSession = () => {
    const claudeSessionId = crypto.randomUUID();
    nodesStore.getState().update(nodeId, { claudeSessionId });
    relaunchTerminal(nodeId, { ...payload, claudeSessionId }, "new");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Relancer"
          aria-label="Relancer"
          className="grid size-5 place-items-center rounded text-ov-text-2 hover:bg-ov-card hover:text-ov-text [&_svg]:size-3.5"
        >
          <RotateCw />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {payload.agent === "claude" ? (
          <>
            <DropdownMenuItem onSelect={() => relaunch("resume")}>Reprendre la session</DropdownMenuItem>
            <DropdownMenuItem onSelect={newSession}>Nouvelle session</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => relaunch("continue")}>Plus récente du dossier</DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => relaunch("new")}>Relancer</DropdownMenuItem>
        )}
        {running && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => stopTerminal(nodeId)}>
              Arrêter le processus
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Header of a terminal node (spec habillage §7.1). */
export function TerminalHeader(props: {
  nodeId: string;
  payload: TerminalPayload;
  status: TerminalStatus;
  actions?: ReactNode;
}) {
  const { nodeId, payload, status, actions } = props;
  const [editing, setEditing] = useState(false);
  const meta = AGENTS[payload.agent];

  return (
    <header
      title={payload.title}
      className="flex h-7 shrink-0 items-center gap-1.5 border-b border-ov-line bg-ov-terminal-head px-2 text-xs"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Agent" className="flex items-center gap-0.5 rounded px-0.5 hover:bg-ov-card">
            <meta.Icon className="size-3.5" style={{ color: meta.tint }} />
            <ChevronDown className="size-3 text-ov-text-2" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {SWITCHABLE.map((id) => {
            const Icon = AGENTS[id].Icon;
            return (
              <DropdownMenuItem key={id} onSelect={() => switchAgent(nodeId, payload, id)}>
                <Icon style={{ color: AGENTS[id].tint }} /> {AGENTS[id].label}
                {id === payload.agent && <span className="ml-auto text-ov-text-2">actuel</span>}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ov-idle" />
      {editing ? (
        <Input
          autoFocus
          defaultValue={payload.name}
          className="h-5 w-32 px-1 text-xs"
          onBlur={(e) => {
            const name = e.currentTarget.value.trim();
            if (name) nodesStore.getState().update(nodeId, { name });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span
          className="truncate font-semibold text-ov-text"
          onDoubleClick={() => setEditing(true)}
          title="Double-clic pour renommer"
        >
          {payload.name || meta.label}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <StatusPill status={status} />
        <RelaunchMenu nodeId={nodeId} payload={payload} running={status.state === "running"} />
        {actions}
      </div>
    </header>
  );
}
```

Remplacer `src/nodes/terminal/TerminalNode.tsx` :

```tsx
import { useEffect, useRef } from "react";
import { useCanvas } from "@/canvas/canvasStore";
import { AGENTS } from "@/fleet/catalog";
import { nodesStore, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { createFitScheduler } from "./fitScheduler";
import { fitTerminal, mountTerminal } from "./registry";
import { ResumeCard } from "./ResumeCard";
import { TerminalHeader } from "./TerminalHeader";

export function TerminalNode({ nodeId }: { nodeId: string }) {
  const payload = useNodes((s) => s.nodes[nodeId]?.payload);
  const status = useTerminalStatus(nodeId);
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  const hostRef = useRef<HTMLDivElement>(null);
  const hasPayload = payload !== undefined;

  useEffect(() => {
    const host = hostRef.current;
    const current = nodesStore.getState().nodes[nodeId]?.payload;
    if (!host || !current) return;
    mountTerminal(nodeId, host, current);
    const fit = createFitScheduler(() => fitTerminal(nodeId, host));
    const observer = new ResizeObserver(fit.schedule);
    observer.observe(host);
    return () => {
      observer.disconnect();
      fit.cancel();
    };
  }, [nodeId, hasPayload]);

  if (!payload) {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-ov-line bg-ov-surface text-sm text-ov-text-2">
        Terminal introuvable
      </div>
    );
  }

  const tint = AGENTS[payload.agent].tint;
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl bg-ov-terminal"
      style={{
        border: selected ? "1.5px solid var(--ov-accent)" : `1px solid color-mix(in srgb, ${tint} 45%, transparent)`,
        boxShadow: selected ? "0 0 0 3px color-mix(in srgb, var(--ov-accent) 15%, transparent)" : undefined,
      }}
    >
      <TerminalHeader nodeId={nodeId} payload={payload} status={status} />
      {/* The padding sits on a wrapper: FitAddon measures the host's border-box
          height, so padding on the host itself would clip the last row. */}
      <div className="relative min-h-0 flex-1 px-1 pt-1">
        <div ref={hostRef} className="h-full w-full" />
        <ResumeCard nodeId={nodeId} payload={payload} status={status} />
      </div>
    </div>
  );
}
```

Dans `src/nodes/terminal/registry.ts` :

1. Imports : ajouter `import { nodesStore } from "@/store/nodes";`, `import { startsOnKeystroke } from "./pill";` et `statusOf` à l'import de `@/store/terminalStatus`.
2. Dans `create()`, le thème devient `theme: { background: "#161712", cursor: "#f4602e", selectionBackground: "#f4602e55" },`.
3. Après `term.onData(…)`, ajouter :

```ts
  // Spec habillage §7.3: typing in a terminal where nothing runs starts it again.
  // onKey, not onData: xterm also answers the queries of a restored screen.
  term.onKey(() => {
    if (!entry.session.replaying && startsOnKeystroke(statusOf(nodeId))) startFresh(nodeId);
  });
```

4. Ajouter, avant `relaunchTerminal` :

```ts
/** Starts a terminal again from a keystroke: a new conversation for Claude. */
function startFresh(nodeId: string) {
  const record = nodesStore.getState().nodes[nodeId];
  if (!record) return;
  let payload = record.payload;
  if (payload.agent === "claude") {
    const claudeSessionId = crypto.randomUUID();
    nodesStore.getState().update(nodeId, { claudeSessionId });
    payload = { ...payload, claudeSessionId };
  }
  relaunchTerminal(nodeId, payload, "new");
}
```

(`relaunchTerminal` est une déclaration de fonction : l'appeler depuis `startFresh` défini plus haut est valide.)

- [ ] **Step 4: Tests, types, contrôle visuel**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

Capture (`shot.ps1`) d'un terminal Claude à comparer avec `tour\t004.8.jpg` : en-tête sombre de 28 px, logo orange, point, prénom, pastille `ACTIF`, ↻ ; bordure orangée ; une fois arrêté, l'encart « Reprendre la dernière conversation ? ».

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(terminal): Symvibe-style header, status pill and resume card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Fermer, dupliquer et copier un terminal

**Files:**
- Create: `src/canvas/nodeCopies.ts`, `src/canvas/nodeCopies.test.ts`, `src/fleet/clone.ts`, `src/fleet/clone.test.ts`, `src/fleet/terminals.ts`, `src/shell/CloseAgentDialog.tsx`
- Modify: `src/store/ui.ts`, `src/canvas/Canvas.tsx`, `src/nodes/terminal/TerminalNode.tsx`, `src/shell/ProjectView.tsx`

**Interfaces:**
- Consumes: `canvasStore` (Tâche 5), `createNodeElement`, `markForAutostart`, `nameForNewAgent` (Tâche 10), `HeaderButton` (Tâche 11).
- Produces:
  - `sourceIdOf(link)`, `classifyAddedNodes(ids, elements, hasRecord) -> { restored, copies: { id, sourceId }[], orphans }`.
  - `cloneTerminalPayload(source, name)` (module pur `src/fleet/clone.ts`) ; `addTerminal(workspaceId, payload, center): Promise<string | null>`, `duplicateTerminal(workspaceId, nodeId)`, `adoptCopies(workspaceId, copies)`, `requestClose(nodeId)`, `removeNode(nodeId)`.
  - `uiStore` gagne `closing: string | null` et `setClosing(id)`.

- [ ] **Step 1: Écrire les tests**

`src/canvas/nodeCopies.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { classifyAddedNodes, sourceIdOf } from "./nodeCopies";

const element = (id: string, link: string) => ({ id, link }) as unknown as ExcalidrawElement;

describe("sourceIdOf", () => {
  it("reads the node id of an dummyPlane link", () => {
    expect(sourceIdOf("dummyplane://terminal/abc-1")).toBe("abc-1");
    expect(sourceIdOf("https://example.com")).toBeNull();
    expect(sourceIdOf(null)).toBeNull();
  });
});

describe("classifyAddedNodes", () => {
  const records = new Set(["t1", "t2"]);
  const has = (id: string) => records.has(id);

  it("tells undone deletions, Excalidraw copies and orphans apart", () => {
    const elements = [
      element("t1", "dummyplane://terminal/t1"),
      element("copy", "dummyplane://terminal/t2"),
      element("ghost", "dummyplane://terminal/gone"),
      element("pasted", "dummyplane://terminal/pasted"),
    ];
    expect(classifyAddedNodes(["t1", "copy", "ghost", "pasted"], elements, has)).toEqual({
      restored: ["t1"],
      copies: [{ id: "copy", sourceId: "t2" }],
      orphans: ["ghost", "pasted"],
    });
  });

  it("treats a copy whose source lives in another workspace as a copy", () => {
    expect(classifyAddedNodes(["c"], [element("c", "dummyplane://terminal/t1")], has).copies).toEqual([
      { id: "c", sourceId: "t1" },
    ]);
  });
});
```

`src/fleet/clone.test.ts` (module pur : son test ne charge ni xterm ni Excalidraw) :

```ts
import { describe, expect, it } from "vitest";
import type { TerminalPayload } from "@/nodes/types";
import { cloneTerminalPayload } from "./clone";

const claude: TerminalPayload = {
  title: "Claude · api",
  name: "Isis",
  agent: "claude",
  cwd: "C:/api",
  shell: "cmd",
  command: "",
  claudeSessionId: "s1",
};

describe("cloneTerminalPayload", () => {
  it("keeps agent, folder and shell; gives a new name and a new conversation", () => {
    const copy = cloneTerminalPayload(claude, "Osiris");
    expect(copy).toMatchObject({ title: "Claude · api", agent: "claude", cwd: "C:/api", shell: "cmd", name: "Osiris" });
    expect(copy.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(copy.claudeSessionId).not.toBe("s1");
  });

  it("gives no conversation to other agents", () => {
    const copy = cloneTerminalPayload({ ...claude, agent: "codex", claudeSessionId: undefined }, "Horus");
    expect(copy.claudeSessionId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Les voir échouer**

Run: `pnpm test 2>&1 | tail -8`
Expected: FAIL — `./nodeCopies`, `./clone` introuvables.

- [ ] **Step 3: Écrire les copies, la duplication et la fermeture**

`src/canvas/nodeCopies.ts` :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const LINK = /^dummyplane:\/\/[a-z]+\/([\w-]+)$/;

/** The node id an dummyPlane embeddable points to, or null. */
export function sourceIdOf(link: string | null | undefined): string | null {
  return LINK.exec(link ?? "")?.[1] ?? null;
}

export interface AddedNodes {
  /** Undo of a deletion: the node's record is still in memory. */
  restored: string[];
  /** Ctrl+D, copy-paste or Alt+drag: a new element pointing to an existing node. */
  copies: { id: string; sourceId: string }[];
  /** Nothing to show (pasted from another session, imported). */
  orphans: string[];
}

/** How new node elements arrived on the canvas (spec habillage §7.5). */
export function classifyAddedNodes(
  ids: readonly string[],
  elements: readonly ExcalidrawElement[],
  hasRecord: (id: string) => boolean,
): AddedNodes {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const result: AddedNodes = { restored: [], copies: [], orphans: [] };
  for (const id of ids) {
    if (hasRecord(id)) {
      result.restored.push(id);
      continue;
    }
    const sourceId = sourceIdOf(byId.get(id)?.link);
    if (sourceId && sourceId !== id && hasRecord(sourceId)) result.copies.push({ id, sourceId });
    else result.orphans.push(id);
  }
  return result;
}
```

Remplacer `src/store/ui.ts` :

```ts
import { createStore, useStore } from "zustand";

interface UiState {
  /** The terminal launch dialog (replaced by the agent menu in task 14). */
  launchOpen: boolean;
  setLaunchOpen: (open: boolean) => void;
  /** The running terminal whose closing waits for confirmation. */
  closing: string | null;
  setClosing: (nodeId: string | null) => void;
}

export const uiStore = createStore<UiState>()((set) => ({
  launchOpen: false,
  setLaunchOpen: (launchOpen) => set({ launchOpen }),
  closing: null,
  setClosing: (closing) => set({ closing }),
}));

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}
```

`src/fleet/clone.ts` :

```ts
import type { TerminalPayload } from "@/nodes/types";

/** A new agent copying another: same agent, folder and shell; its own name and conversation. */
export function cloneTerminalPayload(source: TerminalPayload, name: string): TerminalPayload {
  const copy: TerminalPayload = { ...source, name };
  delete copy.claudeSessionId;
  if (copy.agent === "claude") copy.claudeSessionId = crypto.randomUUID();
  return copy;
}
```

`src/fleet/terminals.ts` :

```ts
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { markForAutostart } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { cloneTerminalPayload } from "./clone";
import { nameForNewAgent } from "./naming";

export interface Point {
  x: number;
  y: number;
}

/** Adds a terminal node centered on `center` (scene coordinates) and starts it when shown. */
export async function addTerminal(workspaceId: string, payload: TerminalPayload, center: Point): Promise<string | null> {
  const api = canvasStore.getState().api;
  if (!api) return null;
  const element = createNodeElement("terminal", center);
  // The node row must exist before the process can save its scrollback.
  await nodesStore.getState().create(element.id, { workspaceId, kind: "terminal", payload });
  markForAutostart(element.id);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element.id;
}

/** "Dupliquer" of the header: a copy of the agent to the right of the node. */
export async function duplicateTerminal(workspaceId: string, nodeId: string) {
  const element = canvasStore.getState().api?.getSceneElements().find((e) => e.id === nodeId);
  const source = nodesStore.getState().nodes[nodeId]?.payload;
  if (!element || !source) return;
  const center = { x: element.x + element.width * 1.5 + 24, y: element.y + element.height / 2 };
  await addTerminal(workspaceId, cloneTerminalPayload(source, await nameForNewAgent(workspaceId)), center);
}

/**
 * Gives terminal elements copied by Excalidraw (Ctrl+D, copy-paste) a node of
 * their own, then points their link at it. They start like any new agent.
 */
export async function adoptCopies(workspaceId: string, copies: readonly { id: string; sourceId: string }[]) {
  const api = canvasStore.getState().api;
  if (!api) return;
  for (const { id, sourceId } of copies) {
    const source = nodesStore.getState().nodes[sourceId]?.payload;
    if (!source) continue;
    markForAutostart(id);
    const name = await nameForNewAgent(workspaceId);
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload: cloneTerminalPayload(source, name) });
  }
  const ids = new Set(copies.map((copy) => copy.id));
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (ids.has(e.id) ? newElementWith(e, { link: `dummyplane://terminal/${e.id}` }) : e)),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

/** Deletes a node element; undo brings it back (spec V1 §8.5). */
export function removeNode(nodeId: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (e.id === nodeId ? newElementWith(e, { isDeleted: true }) : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** "Fermer" of the header: a running agent asks for confirmation first (spec habillage §7.5). */
export function requestClose(nodeId: string) {
  if (isRunning(nodeId)) uiStore.getState().setClosing(nodeId);
  else removeNode(nodeId);
}
```

`src/shell/CloseAgentDialog.tsx` :

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { removeNode } from "@/fleet/terminals";
import { useNodes } from "@/store/nodes";
import { uiStore, useUi } from "@/store/ui";

/** "Fermer Isis ?" before closing a running agent (spec habillage §7.5). */
export function CloseAgentDialog() {
  const closing = useUi((s) => s.closing);
  const name = useNodes((s) => (closing ? s.nodes[closing]?.payload.name : undefined)) || "cet agent";
  const close = () => uiStore.getState().setClosing(null);

  return (
    <Dialog open={closing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Fermer {name} ?</DialogTitle>
          <DialogDescription>{name} tourne encore. La fermer met fin à sa session.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button
            className="bg-ov-danger text-white hover:bg-ov-danger/90"
            onClick={() => {
              if (closing) removeNode(closing);
              close();
            }}
          >
            Fermer l'agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Dans `src/nodes/terminal/TerminalNode.tsx`, importer `Copy` et `X` de `lucide-react`, `duplicateTerminal`, `requestClose` de `@/fleet/terminals`, `HeaderButton` de `./TerminalHeader`, `toast` de `sonner`, et `useNodes` déjà présent ; lire l'espace de travail du nœud : `const workspaceId = useNodes((s) => s.nodes[nodeId]?.workspaceId);` ; passer à `TerminalHeader` :

```tsx
        actions={
          <>
            <HeaderButton
              label="Dupliquer"
              onClick={() =>
                workspaceId &&
                void duplicateTerminal(workspaceId, nodeId).catch((error: unknown) =>
                  toast.error(`Duplication impossible : ${String(error)}`),
                )
              }
            >
              <Copy />
            </HeaderButton>
            <HeaderButton label="Fermer" onClick={() => requestClose(nodeId)}>
              <X />
            </HeaderButton>
          </>
        }
```

Dans `src/canvas/Canvas.tsx` :

- importer `classifyAddedNodes` de `./nodeCopies` et `addTerminal, adoptCopies` de `@/fleet/terminals` ;
- `onNodesAdded` devient :

```ts
          onNodesAdded: (ids) => {
            const elements = canvasStore.getState().api?.getSceneElementsIncludingDeleted() ?? [];
            const added = classifyAddedNodes(ids, elements, (id) => id in nodesStore.getState().nodes);
            // An undo can bring back a node whose row the last scene save purged.
            added.restored.forEach((id) => void nodesStore.getState().persist(id).catch(reportSaveError));
            if (added.copies.length) void adoptCopies(workspaceId, added.copies).catch(reportSaveError);
          },
```

- `launch` délègue à `addTerminal` (le centre et le prénom restent calculés ici) :

```ts
  const launch = useCallback(
    async (input: TerminalPayload) => {
      if (!api) return;
      const { scrollX, scrollY, zoom, width, height } = api.getAppState();
      const center = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
      try {
        const payload = { ...input, name: await nameForNewAgent(workspaceId) };
        await addTerminal(workspaceId, payload, center);
      } catch (error) {
        reportSaveError(error);
      }
    },
    [api, workspaceId],
  );
```

  et retirer les imports devenus inutiles (`createNodeElement`, `markForAutostart`, `CaptureUpdateAction` s'il n'est plus utilisé).

Dans `src/shell/ProjectView.tsx`, ajouter `<CloseAgentDialog />` juste après `<TopBar />` (avec son import).

- [ ] **Step 4: Tests, types, contrôle manuel rapide**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

En dev : Ctrl+D sur un terminal crée un nouvel agent nommé (pas de « Terminal introuvable ») ; ⧉ duplique à droite ; × sur un agent actif ouvre « Fermer Isis ? » ; Ctrl+Z fait revenir un terminal fermé.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(terminal): confirmed close, duplicate, and real agents for copied terminals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Reprendre toutes les conversations

**Files:**
- Create: `src/fleet/resumable.ts`, `src/fleet/resumable.test.ts`, `src/fleet/ResumeAllToast.tsx`
- Modify: `src/nodes/terminal/registry.ts`, `src/canvas/Canvas.tsx`

**Interfaces:**
- Consumes: `relaunchSession`, `create` (registry interne), `useNodes`, `terminalStatusStore`.
- Produces: `resumableTerminals(nodes, statuses, workspaceId, alive)`, `offerResumeAll(workspaceId)`, `dismissResumeOffer(workspaceId)` ; dans `registry.ts`, `resumeTerminal(nodeId)` et `isLiveInRust(nodeId)`.

- [ ] **Step 1: Écrire le test**

`src/fleet/resumable.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { NodeRecord } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { resumableTerminals } from "./resumable";

const node = (workspaceId: string) => ({ workspaceId, kind: "terminal", payload: {} }) as unknown as NodeRecord;

describe("resumableTerminals", () => {
  it("lists the stopped terminals of a workspace, unknown status counting as stopped", () => {
    const nodes = { a: node("w1"), b: node("w1"), c: node("w1"), d: node("w1"), e: node("w2"), f: node("w1") };
    const statuses: Record<string, TerminalStatus> = {
      a: { state: "stopped" },
      b: { state: "running" },
      c: { state: "exited", code: 0 },
      d: { state: "error", message: "x" },
      e: { state: "stopped" },
    };
    expect(resumableTerminals(nodes, statuses, "w1", new Set())).toEqual(["a", "f"]);
  });

  it("skips terminals still running in Rust after a webview reload", () => {
    const nodes = { a: node("w1") };
    expect(resumableTerminals(nodes, {}, "w1", new Set(["a"]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/fleet/resumable 2>&1 | tail -5`
Expected: FAIL — `./resumable` introuvable.

- [ ] **Step 3: Écrire la reprise globale**

`src/fleet/resumable.ts` :

```ts
import type { NodeRecord } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";

/**
 * Terminals restored stopped that can pick their conversation back up (spec
 * habillage §7.4). A terminal never shown yet has no status: it counts as stopped,
 * unless its process still runs in Rust (webview reload).
 */
export function resumableTerminals(
  nodes: Record<string, NodeRecord>,
  statuses: Record<string, TerminalStatus>,
  workspaceId: string,
  alive: ReadonlySet<string>,
): string[] {
  return Object.entries(nodes)
    .filter(
      ([id, node]) =>
        node.workspaceId === workspaceId &&
        node.kind === "terminal" &&
        !alive.has(id) &&
        (statuses[id]?.state ?? "stopped") === "stopped",
    )
    .map(([id]) => id);
}
```

Dans `src/nodes/terminal/registry.ts`, ajouter :

```ts
/** True while a process started before a webview reload awaits re-attachment. */
export function isLiveInRust(nodeId: string): boolean {
  return livePtys.has(nodeId);
}

/**
 * Starts a terminal that may not be on screen yet ("Reprendre toutes les
 * conversations"): Claude resumes its session, other agents start anew. Its
 * output waits in xterm's buffer until the node is shown.
 */
export function resumeTerminal(nodeId: string) {
  const payload = nodesStore.getState().nodes[nodeId]?.payload;
  if (!payload) return;
  const entry = entries.get(nodeId) ?? create(nodeId);
  const mode = payload.agent === "claude" && payload.claudeSessionId ? "resume" : "new";
  void relaunchSession(nodeId, entry.term, payload, mode);
}
```

`src/fleet/ResumeAllToast.tsx` :

```tsx
import { useEffect } from "react";
import { History, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { isLiveInRust, resumeTerminal } from "@/nodes/terminal/registry";
import { nodesStore, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { plural } from "@/lib/format";
import { resumableTerminals } from "./resumable";

/** Workspaces whose offer was answered: it does not come back before the next launch. */
const answered = new Set<string>();
const toastId = (workspaceId: string) => `resume-all-${workspaceId}`;
const RELAUNCH_STAGGER_MS = 300;

function liveSet(ids: string[]): Set<string> {
  return new Set(ids.filter(isLiveInRust));
}

function ResumeAllToast({ workspaceId }: { workspaceId: string }) {
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const ids = resumableTerminals(nodes, statuses, workspaceId, liveSet(Object.keys(nodes)));

  useEffect(() => {
    if (ids.length === 0) toast.dismiss(toastId(workspaceId));
  }, [ids.length, workspaceId]);

  const answer = () => {
    answered.add(workspaceId);
    toast.dismiss(toastId(workspaceId));
  };
  const resumeAll = () => {
    answer();
    ids.forEach((id, i) => setTimeout(() => resumeTerminal(id), i * RELAUNCH_STAGGER_MS));
  };

  return (
    <div className="flex w-[360px] items-start gap-3 rounded-xl border border-ov-line bg-ov-surface-2 p-3 text-ov-text shadow-ov">
      <History className="mt-0.5 size-4 shrink-0 text-ov-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Reprendre toutes les conversations ?</p>
        <p className="text-xs text-ov-text-2">
          {plural(ids.length, "console peut", "consoles peuvent")} reprendre leur dernière discussion
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="h-7 rounded-full bg-ov-accent px-3 text-xs font-semibold text-white" onClick={resumeAll}>
            Oui
          </button>
          <button type="button" className="h-7 rounded-full bg-ov-card px-3 text-xs text-ov-text" onClick={answer}>
            Non
          </button>
        </div>
      </div>
      <button type="button" aria-label="Fermer" className="text-ov-text-2 hover:text-ov-text" onClick={answer}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Offers to resume the stopped terminals of a workspace (spec habillage §7.4). */
export function offerResumeAll(workspaceId: string) {
  if (answered.has(workspaceId)) return;
  const nodes = nodesStore.getState().nodes;
  const statuses = terminalStatusStore.getState().statuses;
  if (resumableTerminals(nodes, statuses, workspaceId, liveSet(Object.keys(nodes))).length === 0) return;
  toast.custom(() => <ResumeAllToast workspaceId={workspaceId} />, {
    id: toastId(workspaceId),
    duration: Infinity,
    position: "top-right",
  });
}

/** Leaving the workspace hides the offer without answering it. */
export function dismissResumeOffer(workspaceId: string) {
  toast.dismiss(toastId(workspaceId));
}
```

Dans `src/canvas/Canvas.tsx`, importer `offerResumeAll, dismissResumeOffer` de `@/fleet/ResumeAllToast` et ajouter dans `LoadedCanvas` :

```ts
  // After the scene is shown, restored terminals have their status.
  useEffect(() => {
    const timer = setTimeout(() => offerResumeAll(workspaceId), 800);
    return () => {
      clearTimeout(timer);
      dismissResumeOffer(workspaceId);
    };
  }, [workspaceId]);
```

- [ ] **Step 4: Tests, types, commit**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit`
Expected: verts.

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(fleet): offer to resume every stopped conversation at launch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Menu « Lancer un agent », placement et « Nouvelle console »

**Files:**
- Create: `src/fleet/placement.ts`, `src/fleet/placement.test.ts`, `src/fleet/agentsStore.ts`, `src/fleet/launchAgent.ts`, `src/fleet/AgentMenu.tsx`, `src/fleet/LaunchOptionsForm.tsx`, `src/fleet/OllamaPicker.tsx`, `src/fleet/PlacementGhost.tsx`, `src/shell/ActionChips.tsx`, `src/nodes/terminal/TerminalOptionsDialog.tsx`
- Modify: `src/store/ui.ts` (remplacement complet), `src/canvas/Canvas.tsx`, `src/canvas/nodeElement.ts`, `src/shell/ProjectView.tsx`, `src/nodes/terminal/TerminalHeader.tsx`
- Delete: `src/nodes/terminal/LaunchDialog.tsx`

**Interfaces:**
- Consumes: `AGENTS`, `AGENT_ORDER`, `defaultAgent` (Tâche 9), `addTerminal` (Tâche 12), `nameForNewAgent` (Tâche 10), `newTerminalPayload` (Tâche 9), `canvasStore` (Tâche 5), `LeftRail({ agentButton })` (Tâche 6).
- Produces:
  - `NODE_SIZE` exporté de `nodeElement.ts` ; `sceneOf(client, view)`, `ghostRect(pointer, zoom)`, `viewportCenter(view)`.
  - `agentsStore` / `useAgents` : `{ agents, shells, load() }`.
  - `LaunchOptions { cwd, shell, title, command, ollama? }`, `defaultLaunchOptions()`, `launchAgent(agent, options, center)`.
  - `uiStore` : `{ placing: Placement | null; setPlacing; closing; setClosing }` avec `Placement { agent: AgentId; options: LaunchOptions }` (`launchOpen` disparaît).

- [ ] **Step 1: Écrire le test du placement**

`src/fleet/placement.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { ghostRect, sceneOf, viewportCenter } from "./placement";

const view = { scrollX: -100, scrollY: 50, zoom: 0.5, offsetLeft: 10, offsetTop: 20, width: 1000, height: 800 };

describe("sceneOf", () => {
  it("is the inverse of Excalidraw's scene-to-screen mapping", () => {
    const scene = { x: 300, y: -40 };
    const client = { x: (scene.x + view.scrollX) * view.zoom + view.offsetLeft, y: (scene.y + view.scrollY) * view.zoom + view.offsetTop };
    expect(sceneOf(client, view)).toEqual(scene);
  });
});

describe("viewportCenter", () => {
  it("is the scene point at the middle of the canvas", () => {
    expect(viewportCenter(view)).toEqual(sceneOf({ x: 10 + 500, y: 20 + 400 }, view));
  });
});

describe("ghostRect", () => {
  it("draws the future terminal centered on the pointer, at the current zoom", () => {
    expect(ghostRect({ x: 400, y: 300 }, 0.5)).toEqual({ left: 220, top: 190, width: 360, height: 220 });
  });
});
```

- [ ] **Step 2: Le voir échouer**

Run: `pnpm test src/fleet/placement 2>&1 | tail -5`
Expected: FAIL — `./placement` introuvable.

- [ ] **Step 3: Écrire le placement, le menu et les puces**

Dans `src/canvas/nodeElement.ts`, exporter les tailles : `const DEFAULT_SIZE` devient `export const NODE_SIZE`, et `DEFAULT_SIZE[kind]` devient `NODE_SIZE[kind]`.

`src/fleet/placement.ts` :

```ts
import type { CanvasView } from "@/canvas/canvasStore";
import { NODE_SIZE } from "@/canvas/nodeElement";
import type { Point } from "./terminals";

type Viewport = Pick<CanvasView, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop">;

/** The scene point under a pointer given in client (window) coordinates. */
export function sceneOf(client: Point, view: Viewport): Point {
  return {
    x: (client.x - view.offsetLeft) / view.zoom - view.scrollX,
    y: (client.y - view.offsetTop) / view.zoom - view.scrollY,
  };
}

/** The scene point at the middle of the canvas ("Nouvelle console"). */
export function viewportCenter(view: Viewport & Pick<CanvasView, "width" | "height">): Point {
  return sceneOf({ x: view.offsetLeft + view.width / 2, y: view.offsetTop + view.height / 2 }, view);
}

/** Screen rectangle of the terminal about to be placed, centered on the pointer (spec habillage §10.1). */
export function ghostRect(pointer: Point, zoom: number) {
  const width = NODE_SIZE.terminal.width * zoom;
  const height = NODE_SIZE.terminal.height * zoom;
  return { left: pointer.x - width / 2, top: pointer.y - height / 2, width, height };
}
```

`src/fleet/agentsStore.ts` :

```ts
import { createStore, useStore } from "zustand";
import { listAgents, listShells, type AgentInfo, type ShellKind } from "@/ipc/pty";

interface AgentsState {
  agents: AgentInfo[];
  shells: ShellKind[];
  /** Looks for the agents on the PATH again (an install shows up without restart). */
  load: () => Promise<void>;
}

export const agentsStore = createStore<AgentsState>()((set) => ({
  agents: [],
  shells: [],
  load: async () => {
    const [agents, shells] = await Promise.all([listAgents(), listShells()]);
    set({ agents, shells });
  },
}));

export function useAgents<T>(selector: (state: AgentsState) => T): T {
  return useStore(agentsStore, selector);
}
```

`src/fleet/launchAgent.ts` :

```ts
import type { AgentId, OllamaLaunch, ShellKind } from "@/ipc/pty";
import { newTerminalPayload } from "@/nodes/terminal/launch";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { agentsStore } from "./agentsStore";
import { nameForNewAgent } from "./naming";
import { addTerminal, type Point } from "./terminals";

/** What the "Options" of the agent menu set for the next launches. */
export interface LaunchOptions {
  cwd: string;
  shell: ShellKind;
  title: string;
  command: string;
  ollama?: OllamaLaunch;
}

/** Agents start in the project folder, in the first available shell (spec habillage §6.1). */
export function defaultLaunchOptions(): LaunchOptions {
  const { projects, activeId } = projectsStore.getState();
  const cwd = projects.find((p) => p.id === activeId)?.path ?? "";
  return { cwd, shell: agentsStore.getState().shells[0] ?? "default", title: "", command: "" };
}

/** Creates and starts an agent of the active workspace at `center` (scene coordinates). */
export async function launchAgent(agent: AgentId, options: LaunchOptions, center: Point) {
  const workspaceId = workspacesStore.getState().activeId;
  if (!workspaceId) return;
  const name = await nameForNewAgent(workspaceId);
  await addTerminal(workspaceId, newTerminalPayload({ ...options, agent }, name), center);
}
```

Remplacer `src/store/ui.ts` :

```ts
import { createStore, useStore } from "zustand";
import type { AgentId } from "@/ipc/pty";
import type { LaunchOptions } from "@/fleet/launchAgent";

/** An agent chosen in the menu, waiting for a click on the canvas (spec habillage §10.1). */
export interface Placement {
  agent: AgentId;
  options: LaunchOptions;
}

interface UiState {
  placing: Placement | null;
  setPlacing: (placing: Placement | null) => void;
  /** The running terminal whose closing waits for confirmation. */
  closing: string | null;
  setClosing: (nodeId: string | null) => void;
}

export const uiStore = createStore<UiState>()((set) => ({
  placing: null,
  setPlacing: (placing) => set({ placing }),
  closing: null,
  setClosing: (closing) => set({ closing }),
}));

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}
```

`src/fleet/LaunchOptionsForm.tsx` :

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ShellKind } from "@/ipc/pty";
import { SHELL_LABELS } from "@/nodes/terminal/launch";
import type { LaunchOptions } from "./launchAgent";

/** Folder, shell, title and custom command of the next agents (spec habillage §10.1). */
export function LaunchOptionsForm(props: {
  value: LaunchOptions;
  shells: ShellKind[];
  onChange: (value: LaunchOptions) => void;
  onBack?: () => void;
  footer?: React.ReactNode;
}) {
  const { value, shells, onChange, onBack, footer } = props;
  const set = (patch: Partial<LaunchOptions>) => onChange({ ...value, ...patch });
  const browse = async () => {
    const picked = await open({ directory: true, defaultPath: value.cwd || undefined, title: "Dossier de travail" });
    if (typeof picked === "string") set({ cwd: picked });
  };

  return (
    <div className="grid gap-3 p-1">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-ov-text-2 hover:text-ov-text">
          <ArrowLeft className="size-3.5" /> Options de lancement
        </button>
      )}
      <div className="grid gap-1.5">
        <Label className="ov-label">Dossier</Label>
        <div className="flex gap-1.5">
          <Input value={value.cwd} onChange={(e) => set({ cwd: e.target.value })} className="h-8 font-mono text-xs" />
          <button
            type="button"
            aria-label="Parcourir"
            onClick={() => void browse()}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-ov-line bg-ov-card hover:bg-ov-hover"
          >
            <FolderOpen className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="ov-label">Shell</Label>
        <Select value={value.shell} onValueChange={(shell) => set({ shell: shell as ShellKind })}>
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shells.map((shell) => (
              <SelectItem key={shell} value={shell}>
                {SHELL_LABELS[shell]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label className="ov-label">Titre</Label>
        <Input value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder="Automatique" className="h-8" />
      </div>
      <div className="grid gap-1.5">
        <Label className="ov-label">Commande personnalisée</Label>
        <Input
          value={value.command}
          onChange={(e) => set({ command: e.target.value })}
          placeholder="npm run dev"
          className="h-8 font-mono text-xs"
        />
      </div>
      {footer}
    </div>
  );
}
```

`src/fleet/OllamaPicker.tsx` :

```tsx
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { listOllamaModels, type OllamaLaunch, type OllamaMode } from "@/ipc/pty";
import { cn } from "@/lib/utils";

type Models = { models: string[] } | { error: string } | null;

/** Model and mode of an Ollama agent (spec habillage §8.1). */
export function OllamaPicker(props: { aiderAvailable: boolean; onBack: () => void; onPick: (ollama: OllamaLaunch) => void }) {
  const { aiderAvailable, onBack, onPick } = props;
  const [models, setModels] = useState<Models>(null);
  const [mode, setMode] = useState<OllamaMode>(aiderAvailable ? "code" : "chat");

  useEffect(() => {
    listOllamaModels().then(
      (list) => setModels({ models: list }),
      (error: unknown) => setModels({ error: String(error) }),
    );
  }, []);

  const modeButton = (value: OllamaMode, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "aider introuvable dans le PATH" : undefined}
      onClick={() => setMode(value)}
      className={cn(
        "flex-1 rounded-lg border border-transparent bg-ov-card py-1.5 text-xs disabled:opacity-40",
        mode === value && "border-ov-accent bg-ov-accent-soft",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-3 p-1">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-ov-text-2 hover:text-ov-text">
        <ArrowLeft className="size-3.5" /> Ollama
      </button>
      <div className="flex gap-1.5">
        {modeButton("code", "Agent de code", !aiderAvailable)}
        {modeButton("chat", "Discussion")}
      </div>
      <div className="grid max-h-56 gap-0.5 overflow-auto">
        {models === null && <p className="px-2 py-1 text-xs text-ov-text-2">Lecture des modèles…</p>}
        {models && "error" in models && <p className="px-2 py-1 text-xs text-ov-danger">Ollama ne répond pas : {models.error}</p>}
        {models && "models" in models && models.models.length === 0 && (
          <p className="px-2 py-1 text-xs text-ov-text-2">
            Aucun modèle — lance <span className="font-mono">ollama pull &lt;modèle&gt;</span>
          </p>
        )}
        {models &&
          "models" in models &&
          models.models.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => onPick({ model, mode })}
              className="rounded-lg px-2 py-1.5 text-left font-mono text-xs text-ov-text hover:bg-ov-hover"
            >
              {model}
            </button>
          ))}
      </div>
    </div>
  );
}
```

`src/fleet/AgentMenu.tsx` :

```tsx
import { useEffect, useState } from "react";
import { Asterisk, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AgentId } from "@/ipc/pty";
import { RoundButton } from "@/shell/ui";
import { uiStore } from "@/store/ui";
import { agentsStore, useAgents } from "./agentsStore";
import { AGENT_ORDER, AGENTS, defaultAgent } from "./catalog";
import { defaultLaunchOptions, type LaunchOptions } from "./launchAgent";
import { LaunchOptionsForm } from "./LaunchOptionsForm";
import { OllamaPicker } from "./OllamaPicker";

type View = "agents" | "options" | "ollama";

/** "Lancer un agent", opened from the rail (spec habillage §10.1). */
export function AgentMenu() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("agents");
  const [options, setOptions] = useState<LaunchOptions | null>(null);
  const agents = useAgents((s) => s.agents);
  const shells = useAgents((s) => s.shells);
  const current = options ?? defaultLaunchOptions();
  const fallback = defaultAgent(agents);
  const available = (id: AgentId) => agents.find((a) => a.id === id)?.available ?? false;

  useEffect(() => {
    if (!open) return;
    setView("agents");
    void agentsStore.getState().load();
  }, [open]);

  const place = (agent: AgentId, launch: LaunchOptions) => {
    setOpen(false);
    uiStore.getState().setPlacing({ agent, options: launch });
  };

  const pick = (agent: AgentId) => {
    if (agent === "ollama") setView("ollama");
    else if (agent === "custom" && !current.command.trim()) setView("options");
    else place(agent, current);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <RoundButton label="Lancer un agent" active={open}>
          <Asterisk className={open ? undefined : "text-ov-accent"} />
        </RoundButton>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-2">
        {view === "agents" && (
          <>
            <p className="ov-label px-2 pb-1 pt-1">Lancer un agent</p>
            <div className="flex flex-col">
              {AGENT_ORDER.map((id) => {
                const meta = AGENTS[id];
                const usable = available(id);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!usable}
                    title={usable ? undefined : `${meta.binary} introuvable dans le PATH`}
                    onClick={() => pick(id)}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ov-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      className="grid size-7 place-items-center rounded-md"
                      style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: meta.tint }}
                    >
                      <meta.Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ov-text">{meta.label}</span>
                      <span className="block text-[11px] text-ov-text-2">{meta.vendor}</span>
                    </span>
                    {id === fallback && <Check className="size-3.5 text-ov-accent" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-ov-line px-2 pt-2 text-[11px] text-ov-text-2">
              <span>puis clique sur le canvas pour le poser</span>
              <button type="button" className="text-ov-accent hover:underline" onClick={() => setView("options")}>
                Options
              </button>
            </div>
          </>
        )}
        {view === "options" && (
          <LaunchOptionsForm
            value={current}
            shells={shells}
            onChange={setOptions}
            onBack={() => setView("agents")}
            footer={
              <button
                type="button"
                disabled={!current.command.trim()}
                onClick={() => place("custom", current)}
                className="h-8 rounded-full bg-ov-accent text-xs font-semibold text-white disabled:opacity-40"
              >
                Lancer la commande personnalisée
              </button>
            }
          />
        )}
        {view === "ollama" && (
          <OllamaPicker
            aiderAvailable={available("aider")}
            onBack={() => setView("agents")}
            onPick={(ollama) => place("ollama", { ...current, ollama })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
```

`src/fleet/PlacementGhost.tsx` :

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { uiStore, useUi } from "@/store/ui";
import { launchAgent } from "./launchAgent";
import { ghostRect, sceneOf } from "./placement";
import type { Point } from "./terminals";

/** Dashed outline that follows the pointer until a click places the agent (spec habillage §10.1). */
export function PlacementGhost() {
  const placing = useUi((s) => s.placing);
  const zoom = useCanvas((s) => s.view.zoom);
  const [pointer, setPointer] = useState<Point | null>(null);

  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.getState().setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  if (!placing) return null;
  const rect = pointer ? ghostRect(pointer, zoom) : null;

  return (
    <div
      className="fixed inset-0 z-40 cursor-crosshair"
      onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
      onContextMenu={(e) => {
        e.preventDefault();
        uiStore.getState().setPlacing(null);
      }}
      onClick={(e) => {
        uiStore.getState().setPlacing(null);
        const center = sceneOf({ x: e.clientX, y: e.clientY }, canvasStore.getState().view);
        void launchAgent(placing.agent, placing.options, center).catch((error: unknown) =>
          toast.error(`Lancement impossible : ${String(error)}`),
        );
      }}
    >
      {rect && (
        <div className="pointer-events-none fixed rounded-xl border-2 border-dashed border-ov-accent/80 bg-ov-accent/5" style={rect} />
      )}
      <div className="pointer-events-none fixed left-1/2 top-16 -translate-x-1/2 rounded-full border border-ov-line bg-ov-surface-2 px-3 py-1 text-xs text-ov-text-2 shadow-ov">
        Clique pour poser l'agent · Échap pour annuler
      </div>
    </div>
  );
}
```

`src/shell/ActionChips.tsx` :

```tsx
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsStore } from "@/fleet/agentsStore";
import { defaultAgent } from "@/fleet/catalog";
import { defaultLaunchOptions, launchAgent } from "@/fleet/launchAgent";
import { viewportCenter } from "@/fleet/placement";

/** Chips above the command bar (spec habillage §5.6); plan B adds the fleet ones. */
export function ActionChips() {
  const newConsole = () => {
    const agent = defaultAgent(agentsStore.getState().agents);
    const center = viewportCenter(canvasStore.getState().view);
    void launchAgent(agent, defaultLaunchOptions(), center).catch((error: unknown) =>
      toast.error(`Lancement impossible : ${String(error)}`),
    );
  };
  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <button
        type="button"
        onClick={newConsole}
        className="ov-chip h-8 rounded-full px-3.5 text-[13px] font-semibold text-ov-text shadow-ov hover:brightness-125"
      >
        Nouvelle console
      </button>
    </div>
  );
}
```

`src/nodes/terminal/TerminalOptionsDialog.tsx` (les « Options… » du `⌄` de l'en-tête) :

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAgents } from "@/fleet/agentsStore";
import { LaunchOptionsForm } from "@/fleet/LaunchOptionsForm";
import type { LaunchOptions } from "@/fleet/launchAgent";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";

/** Folder, shell, title and command of one terminal, used at its next launch. */
export function TerminalOptionsDialog(props: { nodeId: string; payload: TerminalPayload; onClose: () => void }) {
  const { nodeId, payload, onClose } = props;
  const shells = useAgents((s) => s.shells);
  const [value, setValue] = useState<LaunchOptions>({
    cwd: payload.cwd,
    shell: payload.shell,
    title: payload.title,
    command: payload.command,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Options de {payload.name || "ce terminal"}</DialogTitle>
        </DialogHeader>
        <LaunchOptionsForm value={value} shells={shells.length ? shells : [payload.shell]} onChange={setValue} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              nodesStore.getState().update(nodeId, {
                cwd: value.cwd.trim() || payload.cwd,
                shell: value.shell,
                title: value.title.trim() || payload.title,
                command: value.command.trim(),
              });
              onClose();
            }}
          >
            Appliquer au prochain lancement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Dans `src/nodes/terminal/TerminalHeader.tsx` : ajouter l'état `const [optionsOpen, setOptionsOpen] = useState(false);`, à la fin du menu du `⌄` (après la liste des agents) :

```tsx
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOptionsOpen(true)}>Options…</DropdownMenuItem>
```

et, juste avant `</header>` : `{optionsOpen && <TerminalOptionsDialog nodeId={nodeId} payload={payload} onClose={() => setOptionsOpen(false)} />}` (avec son import).

Dans `src/canvas/Canvas.tsx` : supprimer `LaunchDialog`, `useUi`/`uiStore`, `launchOpen`, le callback `launch` et les imports qui ne servent plus (`addTerminal`, `nameForNewAgent`, `TerminalPayload`, `useCallback` si inutilisé). Supprimer `src/nodes/terminal/LaunchDialog.tsx`.

Remplacer, dans `src/shell/ProjectView.tsx`, le bloc affiché quand le workspace est prêt par :

```tsx
        <>
          <Canvas key={activeId} workspaceId={activeId} />
          <LeftRail agentButton={<AgentMenu />} />
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 grid grid-cols-[1fr_auto_1fr] items-end gap-4">
            <div className="justify-self-start">
              <GitChip />
            </div>
            <ActionChips />
            <div className="justify-self-end">
              <ZoomControl />
            </div>
          </div>
          <PlacementGhost />
        </>
```

et charger le catalogue à l'ouverture du projet :

```tsx
  useEffect(() => {
    void agentsStore.getState().load();
  }, []);
```

(imports : `useEffect`, `AgentMenu`, `PlacementGhost`, `agentsStore` de `@/fleet/…`, `ActionChips` de `./ActionChips`). Dans `LeftRail.tsx`, le bouton de repli (`agentButton ?? …`) qui ouvrait l'ancien dialogue n'a plus de raison d'être : `agentButton` devient obligatoire (`{ agentButton: ReactNode }`), le repli et l'import de `uiStore` et d'`Asterisk` sont supprimés.

- [ ] **Step 4: Tests, types, build**

Run: `pnpm test 2>&1 | tail -5 && pnpm exec tsc --noEmit && pnpm build 2>&1 | tail -3`
Expected: verts, build réussi.

- [ ] **Step 5: Vérification manuelle J2 (Mathieu)**

Lancer `pnpm tauri dev`. Capture (`shot.ps1`) de l'en-tête d'un terminal Claude à comparer avec `tour\t004.8.jpg`, puis Mathieu vérifie :

1. Menu ✳ : liste des agents avec logos teintés, agents absents grisés avec l'info-bulle ; choisir Claude fait suivre un rectangle pointillé ; un clic pose et lance l'agent ; Échap et clic droit annulent.
2. Le nouvel agent porte un prénom égyptien ; les terminaux enregistrés avant ce plan ont reçu un prénom.
3. « Nouvelle console » pose un agent par défaut au centre.
4. En-tête : logo, `⌄` (changer d'agent, Options…), point, prénom renommable par double-clic, pastille ACTIF / ARRÊTÉ / TERMINÉ, ↻ (reprendre, nouvelle, plus récente, arrêter), ⧉, × ; bordure teintée, orange une fois sélectionné.
5. Fermer l'application avec des agents actifs, la rouvrir : terminaux arrêtés avec l'encart « Reprendre la dernière conversation ? » et le toast « Reprendre toutes les conversations ? » ; Oui reprend les conversations Claude.
6. Un terminal arrêté redémarre quand on tape dedans (nouvelle session) mais **jamais tout seul** pendant la restauration de son écran.
7. × sur un agent actif demande confirmation ; Ctrl+D, copier-coller et ⧉ créent de vrais agents, y compris en collant dans un autre workspace.
8. Ollama : la liste des modèles s'affiche ; en mode « Agent de code », Aider démarre sur le modèle local dans le dossier du projet (si Ollama et Aider sont installés).

Consigner chaque résultat dans le journal ; les écarts se corrigent dans cette tâche.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(fleet): launch agents from the rail menu and place them on the canvas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
