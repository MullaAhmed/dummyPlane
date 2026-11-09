# R1 « Ne rien perdre » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plus aucune perte de travail par dummyPlane : reprise Claude sans conversation, historique final des terminaux, base sauvegardée avant migration, interface qui survit à une erreur de rendu, paniques qui ne tuent plus l'app, et un journal à envoyer.

**Architecture:** Correctifs ciblés dans Rust (`pty`, `db`, `commands`, `lib.rs`) et React (`main.tsx`, `NodeHost`, `ProjectView`). Un journal fichier par `tauri-plugin-log`, alimenté par Rust (`log::…`) et par le frontend (console transférée). Aucune migration de schéma.

**Tech Stack:** Rust 2024, Tauri 2.12, rusqlite 0.40, tauri-plugin-log 2, React 19, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§3)

## Global Constraints

- Textes de l'interface en français, tutoiement (« fais un premier commit »), comme le reste de l'app ; R5 les traduira.
- Jamais dans le journal : jetons, texte des terminaux, consignes, contenu des fichiers.
- Fichier de journal : `%LOCALAPPDATA%\dev.dummyplane.app\logs\dummyplane.log`, rotation à 5 Mo.
- Copie avant migration : `<dossier de la base>\dummyplane.v<N>-backup.db`.
- Vérification dans l'app : profil `dev.dummyplane.probe` uniquement (jamais `dev.dummyplane.app`).
- Commits conventionnels en anglais avec les lignes `Co-Authored-By` / `Claude-Session` de la session.
- Rust : `cargo fmt`, `cargo clippy --all-targets -- -D warnings` propres ; TS : `pnpm exec tsc --noEmit` propre.

## Review Focus

1. Un terminal relancé plusieurs fois de suite : la sauvegarde la plus récente doit gagner, jamais une plus ancienne (horloge à la milliseconde, captures égales).
2. Une base copiée puis une migration qui échoue : au redémarrage suivant, la copie d'origine reste (pas écrasée par une copie de la base à moitié migrée — la transaction annule la migration, la version ne bouge pas, la copie existe déjà).
3. Une conversation Claude enregistrée dans un dossier dont la casse diffère (`c:\x` contre `C:\x`) : la reprise doit la trouver.
4. Une erreur de rendu dans un seul terminal : les autres terminaux et le canvas restent utilisables.
5. Le journal ne contient jamais l'URL avec `?t=` ni un en-tête `Authorization`.

---

### Task 1: Paniques et verrous

**Files:**
- Modify: `src-tauri/Cargo.toml` (`[profile.release]` : `panic = "unwind"`)
- Create: `src-tauri/src/sync.rs`
- Modify: `src-tauri/src/lib.rs` (`mod sync;`)
- Modify: les 33 `lock().unwrap()` de production : `db/mod.rs:59`, `pty/mod.rs` (47, 69, 127, 133, 137, 162, 170), `pty/session.rs` (97, 105, 117, 125, 130, 137, 143, 148, 169, 171), `commands/agents.rs` (130-131, 153, 198, 213, 294-295, 305-306, 318-319, 329, 347-348), `agents/mcp.rs` (86, 93, 97, 112, 118, 125)

**Interfaces:**
- Produces: `crate::sync::lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T>`

- [ ] **Step 1: Write the failing test** in `src-tauri/src/sync.rs`

```rust
//! Locks that outlive a panic: a thread that panicked while holding one must
//! not take persistence or the terminals down with it (spec première version §3.5).

use std::sync::{Mutex, MutexGuard, PoisonError};

/// The guard, even when a panicking thread poisoned the mutex: the data of
/// every lock in dummyPlane stays consistent between two statements.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_poisoned_mutex_still_locks() {
        let shared = Arc::new(Mutex::new(1));
        let poisoner = shared.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison");
        })
        .join();
        assert!(shared.is_poisoned());
        *lock(&shared) += 1;
        assert_eq!(*lock(&shared), 2);
    }
}
```

Plus, in `db/mod.rs` tests:

```rust
    #[test]
    fn the_base_survives_a_panic_inside_with() {
        let db = std::sync::Arc::new(Db::open_in_memory().unwrap());
        let inner = db.clone();
        let _ = std::thread::spawn(move || {
            let _ = inner.with(|_| -> AppResult<()> { panic!("inside with") });
        })
        .join();
        let version: i64 = db
            .with(|conn| Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }
```

- [ ] **Step 2: Run to verify the db test fails** — `cargo test --manifest-path src-tauri/Cargo.toml the_base_survives` → FAIL (PoisonError unwrap panics). (The `sync` test passes at once: it pins the helper, not a bug.)
- [ ] **Step 3: Replace every production `.lock().unwrap()` by `crate::sync::lock(&…)`** (`use crate::sync::lock;` in each file); set `panic = "unwind"` in `[profile.release]`.
- [ ] **Step 4: Run** — `cargo test --manifest-path src-tauri/Cargo.toml` → all pass; `grep -rn "lock().unwrap()" src-tauri/src` lists only test code.
- [ ] **Step 5: Commit** — `fix(core): survive panics and poisoned locks`

### Task 2: Journaux

**Files:**
- Modify: `src-tauri/Cargo.toml` (`tauri-plugin-log = "2"`, `log = "0.4"`), `package.json` (`@tauri-apps/plugin-log`)
- Create: `src-tauri/src/logging.rs` (plugin builder, panic hook, redaction helper)
- Modify: `src-tauri/src/lib.rs` (plugin, panic hook, start line), `src-tauri/capabilities/default.json` (`log:default`)
- Modify: the 6 `eprintln!` (`agents/claude_settings.rs:138`, `commands/agents.rs:110,260,272`, `commands/pty.rs:80,212`), plus info lines (start, base, server port, pty spawn/exit)
- Create: `src-tauri/src/commands/app.rs` (`open_log_dir`)
- Create: `src/app/log.ts` (console forwarding, global handlers), `src/app/logs.ts` (`openLogDir`)
- Modify: `src/main.tsx`, `src/commands/catalog/app.ts`, `src/shell/SettingsMenu.tsx`, `.github/ISSUE_TEMPLATE/bug_report.yml`
- Test: `src-tauri/src/logging.rs` tests, `src/app/log.test.ts`

**Interfaces:**
- Produces (Rust): `logging::plugin() -> TauriPlugin<Wry>`, `logging::install_panic_hook()`, `logging::redact(text: &str) -> String` (removes `t=<…>` query values and `Bearer <…>`); command `open_log_dir`.
- Produces (TS): `installLogging(target?: LogTarget)` in `src/app/log.ts`; `openLogDir(): Promise<void>` in `src/app/logs.ts`.

- [ ] **Step 1: Failing tests**

`src-tauri/src/logging.rs`:

```rust
    #[test]
    fn secrets_never_reach_the_log() {
        let line = "POST http://127.0.0.1:5000/status/n1?t=abc-123 failed; Authorization: Bearer xyz.789";
        let clean = redact(line);
        assert!(!clean.contains("abc-123"));
        assert!(!clean.contains("xyz.789"));
        assert!(clean.contains("/status/n1"));
    }

    #[test]
    fn a_panic_message_names_its_place() {
        let text = panic_line("boom", Some(("src/x.rs", 12)), Some("reader"));
        assert_eq!(text, "panic in thread reader at src/x.rs:12: boom");
    }
```

`src/app/log.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { installLogging } from "./log";

it("sends console warnings and errors to the log file, and keeps them in the console", () => {
  const sent: [string, string][] = [];
  const target = { warn: (m: string) => (sent.push(["warn", m]), Promise.resolve()), error: (m: string) => (sent.push(["error", m]), Promise.resolve()) };
  const original = vi.fn();
  const fakeConsole = { warn: original, error: original } as unknown as Console;
  installLogging(target, fakeConsole, new EventTarget() as unknown as Window);
  fakeConsole.warn("projects not refreshed", new Error("offline"));
  fakeConsole.error("boom");
  expect(sent).toEqual([["warn", "projects not refreshed Error: offline"], ["error", "boom"]]);
  expect(original).toHaveBeenCalledTimes(2);
});

it("logs uncaught errors and unhandled rejections", () => {
  const sent: string[] = [];
  const target = { warn: () => Promise.resolve(), error: (m: string) => (sent.push(m), Promise.resolve()) };
  const win = new EventTarget() as unknown as Window;
  installLogging(target, { warn: vi.fn(), error: vi.fn() } as unknown as Console, win);
  win.dispatchEvent(Object.assign(new Event("error"), { error: new Error("render") }));
  win.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));
  expect(sent).toEqual(["uncaught: Error: render", "unhandled rejection: nope"]);
});
```

- [ ] **Step 2: Run both** → FAIL (no `logging` module, no `installLogging`).
- [ ] **Step 3: Implement.**

`logging.rs` core:

```rust
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let level = if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info };
    let mut targets = vec![Target::new(TargetKind::LogDir { file_name: Some("dummyplane".into()) })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(level)
        // Dependencies stay quiet: only their warnings.
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .max_file_size(5_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(3))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .format(|out, message, record| out.finish(format_args!("[{}][{}] {}", record.level(), record.target(), redact(&message.to_string()))))
        .build()
}
```

(If the installed version lacks `KeepSome`, use `KeepAll` and ledger a ruling.) `redact` uses two passes without regex: cut `t=` values up to `&`, space or quote; cut the word following `Bearer `. `install_panic_hook` wraps the previous hook and `log::error!("{}", panic_line(...))`.

`commands/app.rs`:

```rust
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> AppResult<()> {
    let dir = app.path().app_log_dir().map_err(|e| AppError::NotFound(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}
```

`src/app/log.ts`:

```ts
import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";

export interface LogTarget { warn: (message: string) => Promise<void>; error: (message: string) => Promise<void> }

const text = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" ");

/** Console warnings and errors, uncaught errors and unhandled rejections go to the log file too (spec première version §3.6). */
export function installLogging(target: LogTarget = { warn: logWarn, error: logError }, cons: Console = console, win: Window = window) {
  for (const level of ["warn", "error"] as const) {
    const original = cons[level].bind(cons);
    cons[level] = (...args: unknown[]) => {
      original(...args);
      void target[level](text(args)).catch(() => undefined);
    };
  }
  win.addEventListener("error", (event) => void target.error(`uncaught: ${text([(event as ErrorEvent).error ?? (event as ErrorEvent).message])}`).catch(() => undefined));
  win.addEventListener("unhandledrejection", (event) => void target.error(`unhandled rejection: ${text([(event as PromiseRejectionEvent).reason])}`).catch(() => undefined));
}
```

`main.tsx`: `installLogging();` first. Palette command `{ id: "app.logs", label: "Ouvrir le dossier des journaux", section: "Aide", keywords: ["journal", "journaux", "logs", "bug", "aide"], available: always, run: () => openLogDir() }`; same item (icon `FileText`) after « À propos » in `SettingsMenu`. `openLogDir` shows `toast.error` on failure. Bug template: a « Journal » field telling where the file is.

Log lines: `log::info!("dummyPlane {} on {}", version, std::env::consts::OS)` at setup; base path opened; migrations applied/backed up (Task 4); `hooks server on port {port}`; `pty {node} started: agent {agent:?}` / `pty {node} exited: {code:?}`.

- [ ] **Step 4: Run** — `cargo test … logging`, `pnpm exec vitest run src/app/log.test.ts` → PASS; full suites green.
- [ ] **Step 5: Probe check** — launch the probe app; open the log folder from the palette; `dummyplane.log` has the start line; `grep -c "t=" dummyplane.log` shows no token.
- [ ] **Step 6: Commit** — `feat(core): write a log file and open its folder from the app`

### Task 3: Le sauvegardeur n'écrase plus l'historique final

**Files:**
- Modify: `src-tauri/src/db/scrollback.rs` (`save` takes `captured_at`), `src-tauri/src/pty/session.rs` (`capture`, `take_dirty_capture`), `src-tauri/src/pty/mod.rs` (`ExitInfo.scrollback: Capture`, `dirty_scrollbacks`, `all_scrollbacks`), `src-tauri/src/pty/scrollback.rs` (`pub struct Capture`), `src-tauri/src/commands/pty.rs` (callers)

**Interfaces:**
- Produces: `pty::scrollback::Capture { pub at: i64, pub data: Vec<u8> }`; `db::scrollback::save(conn, node_id, data: &[u8], captured_at: i64) -> AppResult<bool>` (false: unknown node, or a newer save is already stored).

- [ ] **Step 1: Failing test** in `db/scrollback.rs`:

```rust
    #[test]
    fn an_older_capture_never_replaces_a_newer_one() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                nodes::save(conn, "t1", &w.id, NodeKind::Terminal, "{}")?;
                assert!(save(conn, "t1", b"final", 200)?);
                // The periodic saver's snapshot, taken before the exit, written after it.
                assert!(!save(conn, "t1", b"older", 100)?);
                assert_eq!(load(conn, "t1")?, Some(b"final".to_vec()));
                assert!(save(conn, "t1", b"same time", 200)?);
                assert_eq!(load(conn, "t1")?, Some(b"same time".to_vec()));
                Ok(())
            })
            .unwrap();
    }
```

(Existing tests pass `1`, `2` as `captured_at`.)

- [ ] **Step 2: Run** → FAIL to compile (4 arguments), then FAIL on `older` replacing `final` once the signature exists without the `WHERE`.
- [ ] **Step 3: Implement** — SQL `ON CONFLICT(node_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE excluded.updated_at >= terminal_scrollback.updated_at`, params `captured_at`. `Session::capture()` takes `now_ms()` while holding the `output` lock; `take_dirty_capture()` likewise; the exit waiter captures after `reader.join()`; `flush_scrollbacks` passes `capture.at`.
- [ ] **Step 4: Run** — `cargo test --manifest-path src-tauri/Cargo.toml` → PASS.
- [ ] **Step 5: Commit** — `fix(pty): never let an older scrollback overwrite a terminal's final one`

### Task 4: Sauvegarde de la base avant une migration

**Files:**
- Modify: `src-tauri/src/db/mod.rs` (`Db::open` → `prepare_upgrade`), `src-tauri/src/lib.rs` (log line)
- Test: `src-tauri/src/db/mod.rs` tests

**Interfaces:**
- Produces: `db::backup_path(db: &Path, version: usize) -> PathBuf` → `<dir>/dummyplane.v<version>-backup.db`.

- [ ] **Step 1: Failing tests** (tempdir, `tempfile` is a dev-dependency):

```rust
    fn base_at_version(path: &Path, version: usize) {
        let mut conn = Connection::open(path).unwrap();
        migrate_up_to(&mut conn, version, "C:/home").unwrap();
    }

    #[test]
    fn copies_an_existing_base_before_upgrading_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dummyplane.db");
        base_at_version(&path, 1);
        Db::open(&path).unwrap();
        let backup = Connection::open(backup_path(&path, 1)).unwrap();
        let version: i64 = backup.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn keeps_the_copy_made_before_a_first_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dummyplane.db");
        base_at_version(&path, 1);
        std::fs::write(backup_path(&path, 1), b"first copy").unwrap();
        Db::open(&path).unwrap();
        assert_eq!(std::fs::read(backup_path(&path, 1)).unwrap(), b"first copy");
    }

    #[test]
    fn no_copy_for_a_new_or_current_base() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dummyplane.db");
        Db::open(&path).unwrap();
        drop(Db::open(&path).unwrap());
        let copies = std::fs::read_dir(dir.path()).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains("backup")).count();
        assert_eq!(copies, 0);
    }

    #[test]
    fn refuses_a_base_from_a_newer_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dummyplane.db");
        Connection::open(&path).unwrap().pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1).unwrap();
        let err = Db::open(&path).err().unwrap().to_string();
        assert!(err.contains("version plus récente d'dummyPlane"), "{err}");
    }
```

- [ ] **Step 2: Run** → FAIL (`backup_path` missing; newer base opens).
- [ ] **Step 3: Implement**:

```rust
const NEWER_BASE: &str = "Cette base vient d'une version plus récente d'dummyPlane. Installe la dernière version.";

pub fn open(path: &Path) -> AppResult<Self> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    prepare_upgrade(&conn, path)?;
    Self::init(conn)
}

/// A base from a newer dummyPlane is not touched; an older one is copied before
/// its first missing migration (spec première version §3.3).
fn prepare_upgrade(conn: &Connection, path: &Path) -> AppResult<()> {
    let applied: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let applied = applied as usize;
    if applied > MIGRATIONS.len() {
        return Err(AppError::InvalidInput(NEWER_BASE.into()));
    }
    if applied == 0 || applied == MIGRATIONS.len() {
        return Ok(());
    }
    let backup = backup_path(path, applied);
    if backup.exists() {
        return Ok(());
    }
    conn.execute("VACUUM INTO ?1", [backup.to_string_lossy()])
        .map_err(|err| AppError::InvalidInput(format!("Copie de la base impossible avant sa mise à jour : {err}")))?;
    log::info!("base v{applied} copied to {}", backup.display());
    Ok(())
}

pub fn backup_path(db: &Path, version: usize) -> PathBuf {
    let stem = db.file_stem().map_or("dummyplane".into(), |s| s.to_string_lossy().into_owned());
    db.with_file_name(format!("{stem}.v{version}-backup.db"))
}
```

- [ ] **Step 4: Run** → PASS; whole suite green.
- [ ] **Step 5: Commit** — `fix(db): copy the base before migrating it and refuse a newer one`

### Task 5: Reprendre une session Claude sans conversation

**Files:**
- Create: `src-tauri/src/agents/transcripts.rs`
- Modify: `src-tauri/src/agents/mod.rs` (`pub mod transcripts;`), `src-tauri/src/agents/claude_settings.rs` (`claude_config_dir()`), `src-tauri/src/commands/pty.rs` (`pty_spawn` adjusts the mode), `src/nodes/terminal/session.ts` (keeps a generated id)
- Test: `transcripts.rs` tests, `src/nodes/terminal/session.test.ts`

**Interfaces:**
- Produces: `claude_settings::claude_config_dir() -> Option<PathBuf>`; `transcripts::project_folder(cwd: &Path) -> Option<String>`; `transcripts::launch_mode(mode: ClaudeMode, session: &str, cwd: &Path, config: Option<&Path>) -> ClaudeMode`.

- [ ] **Step 1: Failing tests** in `transcripts.rs`:

```rust
    use std::fs;

    fn config_with(files: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for file in files {
            let path = dir.path().join("projects").join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"{}").unwrap();
        }
        dir
    }

    const ID: &str = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";

    #[test]
    fn claude_names_a_project_folder_after_its_path() {
        assert_eq!(project_folder(Path::new(r"C:\Users\Spectrum\Documents\02_Code_Projects\dummyplane")).as_deref(), Some("C--Users-Spectrum-Documents-02-Code-Projects-dummyplane"));
        assert_eq!(project_folder(Path::new(r"C:\Dév\x")).as_deref(), Some("C--D-v-x"));
        assert_eq!(project_folder(&Path::new("C:\\").join("a".repeat(250))), None);
    }

    #[test]
    fn resumes_a_conversation_that_exists() {
        let config = config_with(&[&format!("C--code-app/{ID}.jsonl")]);
        assert_eq!(launch_mode(ClaudeMode::Resume, ID, Path::new(r"C:\code\app"), Some(config.path())), ClaudeMode::Resume);
    }

    #[test]
    fn starts_a_new_conversation_under_the_same_id_when_none_was_saved() {
        let config = config_with(&["C--code-app/other.jsonl"]);
        assert_eq!(launch_mode(ClaudeMode::Resume, ID, Path::new(r"C:\code\app"), Some(config.path())), ClaudeMode::New);
    }

    #[test]
    fn finds_a_conversation_saved_under_another_folder_case() {
        let config = config_with(&[&format!("c--code-app/{ID}.jsonl")]);
        assert_eq!(launch_mode(ClaudeMode::Resume, ID, Path::new(r"C:\code\app"), Some(config.path())), ClaudeMode::Resume);
    }

    #[test]
    fn continues_only_a_folder_that_has_a_conversation() {
        let config = config_with(&["C--code-app/x.jsonl"]);
        assert_eq!(launch_mode(ClaudeMode::Continue, ID, Path::new(r"C:\code\app"), Some(config.path())), ClaudeMode::Continue);
        assert_eq!(launch_mode(ClaudeMode::Continue, ID, Path::new(r"C:\code\empty"), Some(config.path())), ClaudeMode::New);
    }

    #[test]
    fn keeps_the_mode_when_it_cannot_tell() {
        assert_eq!(launch_mode(ClaudeMode::Resume, ID, Path::new(r"C:\code\app"), None), ClaudeMode::Resume);
        let long = Path::new("C:\\").join("a".repeat(250));
        let config = config_with(&[]);
        assert_eq!(launch_mode(ClaudeMode::Continue, ID, &long, Some(config.path())), ClaudeMode::Continue);
    }
```

`session.test.ts`:

```ts
it("gives a Claude terminal without a conversation id one, and keeps it in its node", async () => {
  await nodesStore.getState().create("c", { workspaceId: "w", kind: "terminal", payload: { ...payload, agent: "claude" } });
  mockIPC((cmd, args) => { calls.push({ cmd, args: args as Record<string, unknown> }); return 1; });
  await startSession("c", fakeTerm(), { ...payload, agent: "claude" }, "resume");
  const spec = calls.find((c) => c.cmd === "pty_spawn")!.args.spec as { claude: { sessionId: string } };
  expect(spec.claude.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(nodesStore.getState().nodes.c.payload).toMatchObject({ claudeSessionId: spec.claude.sessionId });
});
```

- [ ] **Step 2: Run** → FAIL (module missing; id not kept).
- [ ] **Step 3: Implement** — `project_folder`: map each UTF-16 unit of the path to itself if ASCII alphanumeric else `-`; `None` above 200 units. `launch_mode`:
  - `New` → `New`; `config` None → mode unchanged.
  - `Resume`: scan `config/projects/*/` for a file named `<session>.jsonl` (case-insensitive on the name) → `Resume`, else `New`.
  - `Continue`: `project_folder(cwd)` None → `Continue`; find a dir in `config/projects` whose name equals it ignoring ASCII case; if it holds any `*.jsonl` → `Continue`, else `New`.
  - `pty_spawn`: `let mut spec = spec;` then `if let Some(claude) = spec.claude.as_mut() { claude.mode = transcripts::launch_mode(claude.mode, &claude.session_id, Path::new(&spec.cwd), claude_settings::claude_config_dir().as_deref()); }` before `hooks_for`; log the switch at `info`.
  - `session.ts`: `withConversationId(nodeId, payload)` used by `startSession`: a Claude payload without `claudeSessionId` gets `crypto.randomUUID()`, stored with `nodesStore.getState().update(nodeId, { claudeSessionId })`.
- [ ] **Step 4: Run** → PASS; full suites.
- [ ] **Step 5: Commit** — `fix(claude): start a new conversation when the one to resume was never saved`

### Task 6: Limites d'erreur

**Files:**
- Create: `src/components/ErrorBoundary.tsx`, `src/shell/AppCrash.tsx`, `src/components/ErrorBoundary.test.tsx`
- Modify: `src/main.tsx` (root boundary), `src/nodes/NodeHost.tsx` (node boundary), `src/shell/ProjectView.tsx` (canvas keyed by workspace, panels), `src/App.tsx` (palette boundary; `boot()` rejection → error view)
- Modify: `src/store/projects.ts` only if a `fail(message)` action is needed for the boot error.

**Interfaces:**
- Consumes: `openLogDir()` from Task 2.
- Produces: `ErrorBoundary({ scope: string; fallback: (error: Error, retry: () => void) => ReactNode; children })`; `CrashNotice({ error, retry, compact? })`.

- [ ] **Step 1: Failing tests** (`ErrorBoundary.test.tsx`, happy-dom, `act`, like `CloseAgentDialog.test.tsx`):

```tsx
function Bomb({ explode }: { explode: { current: boolean } }) {
  if (explode.current) throw new Error("render failed");
  return <p>fine</p>;
}

it("shows the fallback instead of blanking, logs the error, and retries", async () => {
  const explode = { current: true };
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => root.render(<ErrorBoundary scope="node" fallback={(e, retry) => <button onClick={retry}>{e.message}</button>}><Bomb explode={explode} /></ErrorBoundary>));
  expect(host.textContent).toBe("render failed");
  expect(logged.mock.calls.some((args) => String(args[0]).includes("[ui] node"))).toBe(true);
  explode.current = false;
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toBe("fine");
});

it("keeps a sibling alive when one child fails", async () => {
  await act(async () => root.render(<><ErrorBoundary scope="a" fallback={() => <i>a down</i>}><Bomb explode={{ current: true }} /></ErrorBoundary><p>b alive</p></>));
  expect(host.textContent).toBe("a downb alive");
});
```

- [ ] **Step 2: Run** → FAIL (no component).
- [ ] **Step 3: Implement** `ErrorBoundary` (class, `getDerivedStateFromError`, `componentDidCatch` → `console.error("[ui] " + scope, error, info.componentStack)`, `retry` resets state). `CrashNotice`: text « Cette partie de l'interface a rencontré une erreur. », the message in small mono, buttons « Réessayer » and « Ouvrir le dossier des journaux ». `AppCrash` (root): `TitleBar` + « L'interface a rencontré une erreur », message, « Recharger l'interface » (`location.reload()`) and « Ouvrir le dossier des journaux ». Wire: root in `main.tsx`; `NodeHost` content; `<Canvas key={activeId}>` wrapped with `key` on the boundary; `AgentsPanel`, `ReviewPanel`, `UsageMeter`, `Palette` each in a compact boundary. `App.tsx`: `boot().catch((e) => projectsStore.setState({ view: "error", error: \`Le démarrage a échoué : ${e instanceof Error ? e.message : String(e)}\` }))`.
- [ ] **Step 4: Run** — vitest file + full suite + tsc → PASS.
- [ ] **Step 5: Probe check** — in the probe app, throw from one terminal node through CDP (`Runtime.evaluate` patching nothing: render a node whose payload is unreadable is not possible; instead dispatch an error by temporarily setting `nodesStore` payload of one node to `null` via the console) and see its error card while the other nodes and the canvas still work; « Réessayer » after restoring the payload brings it back.
- [ ] **Step 6: Commit** — `feat(ui): contain render errors instead of blanking the app`

### Task 7: Fin du jalon

- [ ] Remove from `BACKLOG.md` the points R1 settles: « Priorité haute » (reprise sans conversation), sauvegardeur 10 s, mutex de base empoisonné, `tauri-plugin-log`, sauvegarde avant migration, limite d'erreur React, verrou du suivi d'activité ; add « Une relance remplace dans la base l'historique de la session précédente » under a new « Constats R1 » section.
- [ ] Full checks: `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- [ ] Final review (fresh reviewer, most capable model) on the branch diff; fix Critical/Important with a failing test first.
- [ ] Merge into `main`, push, delete the branch.
