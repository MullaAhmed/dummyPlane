# dummyPlane — Plan B2 : états des agents (jalon J3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montrer en direct si chaque agent travaille, attend une réponse ou est prêt (pastilles EN COURS / ATTEND / PRÊT, compteurs des groupes), et ouvrir le panneau Flotte qui liste la flotte par groupe avec ses filtres et ses durées.

**Architecture:** Rust calcule l'activité (`agents::activity`, machine d'état pure) à partir de deux sources : les hooks de Claude (et le `notify` de Codex), reçus par un petit serveur HTTP local (`tiny_http`, jeton aléatoire), et la sortie des terminaux (rappel par morceau lu). Il émet `agent-activity` à chaque changement et répond à `agent_activity_snapshot` au chargement. Le front range ces états dans un store et les affiche : pastilles, compteurs des étiquettes de groupe, rail droit et panneau Flotte.

**Tech Stack:** Rust (Tauri 2, portable-pty, tiny_http 0.12, serde_json, uuid), React 19, TypeScript, Zustand, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (§5.5, §7.2, §8.2, §10.2 à §10.4, §11.4, §15.3), amendée à la tâche 1 avec les résultats de la vérification de Claude Code.

## Global Constraints

- Interface en français, thème sombre ; code et commentaires en anglais (spec §21).
- Sources d'activité, par priorité : hooks Claude, fin de tour Codex, sortie du terminal ; sortie dans les 1,5 dernières secondes → `working` ; un terminal qui a reçu un hook Claude ignore sa sortie, sauf pour quitter `working` après 30 s sans sortie (spec §10.2).
- Serveur : `127.0.0.1`, port choisi par le système, jeton UUID v4, `POST` seulement, corps ≤ 64 Kio, réponse 204 ; aucun hook bloquant (`PreToolUse`, `PermissionRequest`) (spec §10.3).
- Si le serveur ne démarre pas : un toast unique « États des agents approximatifs : serveur local indisponible », Claude lancé sans `--settings`, activité déduite de la sortie (spec §10.3).
- Couleurs : PRÊT fond `#322F28` ; EN COURS `#E8553A` (indigo `#707DE3` pour les agents de teinte indigo) ; ATTEND `#D9B35A`, point clignotant (spec §7.2).
- Durées : « 45 s », « 12 min », « 1 h 05 », rafraîchies toutes les 15 s (spec §10.4).
- Aucun bouton inactif : Pause et Reprendre du panneau Flotte arrivent avec J5 (spec §18).
- Tests : `pnpm test` (front) ; `cargo test --manifest-path src-tauri/Cargo.toml --lib` (Rust) ; `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` et `cargo fmt --manifest-path src-tauri/Cargo.toml --check` propres.
- Arrêter l'application de développement avant toute modification Rust ; ne jamais faire tourner deux instances sur la même base (vérification sur le profil `dev.dummyplane.probe`).
- Conventional Commits ; chaque message de commit finit par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Une sortie continue d'un agent sans hooks (compilation qui défile) le garde EN COURS sans émettre un événement par morceau lu (test : tâche 2, `output` ne change rien quand l'activité ne change pas).
2. Un Claude dont le hook `Stop` se perd (réseau, serveur redémarré) ne reste pas EN COURS indéfiniment : retour à PRÊT après 30 s sans sortie (test : tâche 2, filet de 30 s).
3. Une requête au serveur sans jeton, avec un mauvais jeton, une méthode autre que `POST`, un identifiant de nœud douteux (`../`) ou un corps de plus de 64 Kio n'atteint jamais l'activité ni le disque (tests : tâche 3 routes et statuts, tâche 4 nom de fichier refusé).
4. Un dummyPlane lancé depuis une session Claude Code ne transmet pas le marqueur `CLAUDE_CODE_CHILD_SESSION` aux agents (test : tâche 4, variable retirée dans un vrai PTY).
5. Après un rechargement de la webview, les pastilles reprennent l'état courant au lieu de repartir de PRÊT (test : tâche 6, `load` du store depuis l'instantané ; vérification en application tâche 6).

---

## File Structure

Rust (`src-tauri/src/`) :
- `agents.rs` → `agents/mod.rs` (déplacé, inchangé) ; nouveaux `agents/activity.rs` (machine d'état), `agents/hooks_server.rs` (serveur HTTP), `agents/claude_settings.rs` (fichier `--settings`).
- `pty/shell.rs` : `AgentHooks`, `--settings` pour Claude, `notify` pour Codex, `env_remove` des marqueurs hérités.
- `pty/session.rs`, `pty/mod.rs` : rappel `on_output` par morceau lu ; `env_remove` appliqué au processus.
- `commands/agents.rs` (nouveau) : état partagé, émission d'`agent-activity`, `agent_activity_snapshot`, minuterie.
- `commands/pty.rs`, `lib.rs` : branchement.

Front (`src/`) :
- `ipc/activity.ts`, `store/agentActivity.ts` (+ tests), `lib/format.ts` (`formatDuration`), `lib/useNow.ts`.
- `nodes/terminal/pill.ts`, `StatusPill.tsx`, `TerminalHeader.tsx`, `TerminalNode.tsx`.
- `fleet/groupSummary.ts`, `canvas/overlay/GroupLabels.tsx`.
- `fleet/fleetView.ts` (+ test), `fleet/FleetPanel.tsx`, `shell/RightRail.tsx`, `canvas/focusNode.ts`, `canvas/canvasStore.ts` (`terminalIds`), `store/ui.ts` (`fleetOpen`), `shell/ProjectView.tsx`, `app/boot.ts`.

---

### Task 1: Consigner la vérification de Claude Code dans la spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (§8.2, §10.3, §15.3)

**Interfaces:**
- Consumes: la vérification faite avant ce plan (Claude Code 2.1.304, `claude -p` avec `--settings` pointant sur un serveur local).
- Produces: les décisions que les tâches 3 à 6 implémentent (instantané avec `hooksAvailable`, durée de vie du fichier de réglages, `notify` en chaînes littérales TOML, marqueurs retirés).

- [ ] **Step 1: §10.3 — résultats de la vérification**

Remplacer le point « Points à vérifier au jalon J3 (…) » par :

```markdown
- Vérifié sur Claude Code 2.1.304 (2026-10-24) : les hooks `http` de `--settings` se déclenchent (`UserPromptSubmit` puis `Stop` pour un tour) et s'ajoutent à ceux du projet et de l'utilisateur, qui se déclenchent aussi ; le corps porte `hook_event_name` (et `notification_type` pour `Notification`) ; une réponse 204 ne produit rien dans la sortie de Claude. Une réponse en erreur ou un serveur injoignable donnent une ligne « hook error » dans Claude : le délai de 2 s borne l'attente.
```

- [ ] **Step 2: §8.2 — durée de vie du fichier, Codex, environnement**

Remplacer la ligne Claude de §8.2 par :

```markdown
- Claude : dummyPlane écrit `<app_data>/hooks/<nodeId>.json` et lance `claude --settings "<chemin>" …`. Le fichier est réécrit à chaque lancement (port et jeton changent à chaque démarrage de l'application), supprimé à la fin du processus, et le dossier est vidé au démarrage de l'application (un fichier restant pointerait vers un serveur mort). Contenu : §10.3. Les réglages de l'utilisateur (`~/.claude/settings.json`) ne sont pas modifiés.
```

et la ligne Codex par :

```markdown
- Codex : `codex -c "notify=['curl.exe','-s','-X','POST','<url>','-d']"` (chaînes littérales TOML entre apostrophes : PowerShell 5.1 perd les guillemets doubles imbriqués passés à un programme natif) ; Codex ajoute la charge JSON en dernier argument, qui devient le corps de la requête. Non vérifié (Codex absent de la machine de développement) ; en cas d'échec, Codex reste sur l'état déduit de l'activité.
- Environnement : les terminaux héritent de l'environnement d'dummyPlane, sauf les marqueurs de session de Claude Code (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`) : un dummyPlane lancé depuis une session Claude Code ne doit pas faire de ses agents des sessions enfants (exclues de `--resume`).
```

- [ ] **Step 3: §15.3 — instantané**

Remplacer la ligne `agent_activity_snapshot` du tableau par :

```markdown
| États | `agent_activity_snapshot() -> { hooksAvailable, activities: { nodeId, activity, since }[] }` | état courant au chargement du front, et disponibilité du serveur des hooks |
```

et la puce `hooks-unavailable` des événements par :

```markdown
- la disponibilité du serveur des hooks est lue dans `agent_activity_snapshot` (un événement émis au démarrage de Rust arriverait avant que la webview n'écoute).
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md
git commit -m "docs(spec): Claude Code hooks verified, J3 decisions"
```

---

### Task 2: Machine d'état de l'activité (Rust)

**Files:**
- Move: `src-tauri/src/agents.rs` → `src-tauri/src/agents/mod.rs`
- Create: `src-tauri/src/agents/activity.rs` (code et tests)

**Interfaces:**
- Consumes: rien.
- Produces (`crate::agents::activity`) : `enum Activity { Idle, Working, Waiting }` (sérialisé en camelCase) ; `enum HookSource { Claude, Codex }` ; `struct Change { node_id: String, activity: Activity, since: Instant }` ; `QUIET_AFTER = 1,5 s`, `HOOK_SAFETY_NET = 30 s` ; `Tracker::{start(&mut, node_id, now) -> Change, output(&mut, node_id, now) -> Option<Change>, hook(&mut, node_id, source, activity, now) -> Option<Change>, tick(&mut, now) -> Vec<Change>, remove(&mut, node_id), snapshot(&self) -> Vec<Change>}` ; `claude_activity(event: &str, notification_type: Option<&str>) -> Option<Activity>` ; `codex_activity(kind: &str) -> Option<Activity>`.

- [ ] **Step 1: Move the module and write the failing tests**

```bash
mkdir -p src-tauri/src/agents
git mv src-tauri/src/agents.rs src-tauri/src/agents/mod.rs
```

En tête de `src-tauri/src/agents/mod.rs`, ajouter :

```rust
pub mod activity;
```

`src-tauri/src/agents/activity.rs` (tests seulement pour l'instant, avec les signatures attendues) :

```rust
#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    fn started(t0: Instant) -> Tracker {
        let mut tracker = Tracker::default();
        tracker.start("a", t0);
        tracker
    }

    #[test]
    fn output_makes_an_agent_without_hooks_work_then_quiet_makes_it_idle() {
        let t0 = Instant::now();
        let mut tracker = started(t0);
        let change = tracker.output("a", t0 + ms(10)).unwrap();
        assert_eq!(change.activity, Activity::Working);
        assert_eq!(tracker.output("a", t0 + ms(500)), None);
        assert!(tracker.tick(t0 + ms(1900)).is_empty());
        let idle = tracker.tick(t0 + ms(2000));
        assert_eq!(idle.len(), 1);
        assert_eq!((idle[0].node_id.as_str(), idle[0].activity), ("a", Activity::Idle));
    }

    #[test]
    fn claude_hooks_replace_the_output_heuristic() {
        let t0 = Instant::now();
        let mut tracker = started(t0);
        let working = tracker.hook("a", HookSource::Claude, Activity::Working, t0).unwrap();
        assert_eq!(working.activity, Activity::Working);
        // Output no longer decides, and short silences keep it working.
        assert_eq!(tracker.output("a", t0 + ms(100)), None);
        assert!(tracker.tick(t0 + ms(5000)).is_empty());
        let waiting = tracker.hook("a", HookSource::Claude, Activity::Waiting, t0 + ms(6000)).unwrap();
        assert_eq!(waiting.activity, Activity::Waiting);
        assert!(tracker.tick(t0 + ms(60_000)).is_empty());
        let idle = tracker.hook("a", HookSource::Claude, Activity::Idle, t0 + ms(61_000)).unwrap();
        assert_eq!(idle.activity, Activity::Idle);
        assert_eq!(tracker.output("a", t0 + ms(61_100)), None);
    }

    #[test]
    fn a_lost_stop_hook_ends_in_idle_after_thirty_seconds_without_output() {
        let t0 = Instant::now();
        let mut tracker = started(t0);
        tracker.hook("a", HookSource::Claude, Activity::Working, t0);
        tracker.output("a", t0 + ms(20_000));
        assert!(tracker.tick(t0 + ms(49_000)).is_empty());
        let idle = tracker.tick(t0 + ms(50_000));
        assert_eq!(idle[0].activity, Activity::Idle);
    }

    #[test]
    fn codex_turn_end_sets_idle_without_disabling_the_output_heuristic() {
        let t0 = Instant::now();
        let mut tracker = started(t0);
        tracker.output("a", t0);
        let idle = tracker.hook("a", HookSource::Codex, Activity::Idle, t0 + ms(100)).unwrap();
        assert_eq!(idle.activity, Activity::Idle);
        assert_eq!(tracker.output("a", t0 + ms(200)).unwrap().activity, Activity::Working);
    }

    #[test]
    fn removed_or_unknown_terminals_are_ignored() {
        let t0 = Instant::now();
        let mut tracker = started(t0);
        tracker.remove("a");
        assert_eq!(tracker.output("a", t0), None);
        assert_eq!(tracker.hook("zzz", HookSource::Claude, Activity::Working, t0), None);
        assert!(tracker.snapshot().is_empty());
    }

    #[test]
    fn snapshot_lists_the_current_activity_of_each_terminal() {
        let t0 = Instant::now();
        let mut tracker = started(t0);
        tracker.start("b", t0);
        tracker.output("b", t0 + ms(5));
        let mut snapshot = tracker.snapshot();
        snapshot.sort_by(|x, y| x.node_id.cmp(&y.node_id));
        let pairs: Vec<_> = snapshot.iter().map(|c| (c.node_id.as_str(), c.activity)).collect();
        assert_eq!(pairs, vec![("a", Activity::Idle), ("b", Activity::Working)]);
    }

    #[test]
    fn maps_claude_hook_events() {
        assert_eq!(claude_activity("UserPromptSubmit", None), Some(Activity::Working));
        assert_eq!(claude_activity("PostToolUse", None), Some(Activity::Working));
        assert_eq!(claude_activity("Stop", None), Some(Activity::Idle));
        assert_eq!(claude_activity("StopFailure", None), Some(Activity::Idle));
        for kind in ["permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"] {
            assert_eq!(claude_activity("Notification", Some(kind)), Some(Activity::Waiting));
        }
        assert_eq!(claude_activity("Notification", Some("idle_prompt")), Some(Activity::Idle));
        assert_eq!(claude_activity("Notification", Some("auth_success")), None);
        assert_eq!(claude_activity("Notification", None), None);
        assert_eq!(claude_activity("SessionStart", None), None);
    }

    #[test]
    fn maps_the_codex_turn_end() {
        assert_eq!(codex_activity("agent-turn-complete"), Some(Activity::Idle));
        assert_eq!(codex_activity("something-else"), None);
    }

    #[test]
    fn serializes_activities_for_the_frontend() {
        assert_eq!(serde_json::to_value(Activity::Waiting).unwrap(), serde_json::json!("waiting"));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib agents::activity`
Expected: FAIL à la compilation — `Tracker`, `Activity`, `HookSource`, `claude_activity`, `codex_activity` introuvables.

- [ ] **Step 3: Write the implementation**

Au-dessus du module de tests de `src-tauri/src/agents/activity.rs` :

```rust
//! Agent activity (spec habillage §10.2): working, waiting for the user or
//! idle, from the agents' hooks first, else from their terminal's output.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Activity {
    Idle,
    Working,
    Waiting,
}

/// Without hooks, output in the last 1.5 s means the agent works.
pub const QUIET_AFTER: Duration = Duration::from_millis(1500);
/// A hooked agent left working this long without output lost its `Stop` hook.
pub const HOOK_SAFETY_NET: Duration = Duration::from_secs(30);

/// Claude's hooks report every transition, so they replace the output
/// heuristic; Codex only reports the end of a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookSource {
    Claude,
    Codex,
}

/// A terminal's new activity, and since when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub node_id: String,
    pub activity: Activity,
    pub since: Instant,
}

struct Node {
    activity: Activity,
    since: Instant,
    last_output: Option<Instant>,
    hooked: bool,
}

/// The activity of every running terminal.
#[derive(Default)]
pub struct Tracker {
    nodes: HashMap<String, Node>,
}

impl Tracker {
    /// A process just started: idle until it shows otherwise.
    pub fn start(&mut self, node_id: &str, now: Instant) -> Change {
        self.nodes.insert(
            node_id.to_string(),
            Node {
                activity: Activity::Idle,
                since: now,
                last_output: None,
                hooked: false,
            },
        );
        change(node_id, Activity::Idle, now)
    }

    /// The terminal printed something. Returns a change only when the
    /// activity changes, not for every chunk read.
    pub fn output(&mut self, node_id: &str, now: Instant) -> Option<Change> {
        let node = self.nodes.get_mut(node_id)?;
        node.last_output = Some(now);
        if node.hooked {
            return None;
        }
        set(node_id, node, Activity::Working, now)
    }

    pub fn hook(&mut self, node_id: &str, source: HookSource, activity: Activity, now: Instant) -> Option<Change> {
        let node = self.nodes.get_mut(node_id)?;
        if source == HookSource::Claude {
            node.hooked = true;
        }
        set(node_id, node, activity, now)
    }

    /// Working terminals that went quiet become idle: after 1.5 s without
    /// hooks, after 30 s with them (safety net for a lost `Stop`).
    pub fn tick(&mut self, now: Instant) -> Vec<Change> {
        let mut changes = Vec::new();
        for (node_id, node) in &mut self.nodes {
            if node.activity != Activity::Working {
                continue;
            }
            let last = node.last_output.map_or(node.since, |at| at.max(node.since));
            let limit = if node.hooked { HOOK_SAFETY_NET } else { QUIET_AFTER };
            if now.saturating_duration_since(last) >= limit {
                node.activity = Activity::Idle;
                node.since = now;
                changes.push(change(node_id, Activity::Idle, now));
            }
        }
        changes
    }

    pub fn remove(&mut self, node_id: &str) {
        self.nodes.remove(node_id);
    }

    pub fn snapshot(&self) -> Vec<Change> {
        self.nodes
            .iter()
            .map(|(node_id, node)| change(node_id, node.activity, node.since))
            .collect()
    }
}

fn change(node_id: &str, activity: Activity, since: Instant) -> Change {
    Change {
        node_id: node_id.to_string(),
        activity,
        since,
    }
}

fn set(node_id: &str, node: &mut Node, activity: Activity, now: Instant) -> Option<Change> {
    if node.activity == activity {
        return None;
    }
    node.activity = activity;
    node.since = now;
    Some(change(node_id, activity, now))
}

/// Claude's hook events (spec §10.2), from `hook_event_name` and `notification_type`.
pub fn claude_activity(event: &str, notification_type: Option<&str>) -> Option<Activity> {
    match event {
        "UserPromptSubmit" | "PostToolUse" => Some(Activity::Working),
        "Stop" | "StopFailure" => Some(Activity::Idle),
        "Notification" => match notification_type? {
            "permission_prompt" | "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => {
                Some(Activity::Waiting)
            }
            "idle_prompt" => Some(Activity::Idle),
            _ => None,
        },
        _ => None,
    }
}

/// The type of Codex's `notify` payload that ends a turn.
pub fn codex_activity(kind: &str) -> Option<Activity> {
    (kind == "agent-turn-complete").then_some(Activity::Idle)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib agents::activity`
Expected: PASS (9 tests).

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml` puis `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: propre. Clippy signale le code encore inutilisé (`dead_code`) tant que la tâche 5 ne branche pas le module : ajouter `#![allow(dead_code)]` en tête d'`activity.rs` avec le commentaire `// Wired in task 5.`, retiré à la tâche 5.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agents
git commit -m "feat(agents): activity state machine fed by hooks and terminal output"
```

---

### Task 3: Serveur local des hooks (Rust)

**Files:**
- Modify: `src-tauri/Cargo.toml` (`tiny_http = "0.12"`)
- Create: `src-tauri/src/agents/hooks_server.rs` (code et tests)
- Modify: `src-tauri/src/agents/mod.rs` (`pub mod hooks_server;`)

**Interfaces:**
- Consumes: `Activity`, `HookSource`, `claude_activity`, `codex_activity` (tâche 2).
- Produces (`crate::agents::hooks_server`) : `MAX_BODY = 64 * 1024` ; `struct HookHit { node_id: String, source: HookSource, activity: Activity }` ; `struct HookServer { port: u16, token: String }` avec `url(&self, source, node_id) -> String` ; `start(on_hit: impl Fn(HookHit) + Send + 'static) -> io::Result<HookServer>` ; `parse_route(url, token) -> Result<(HookSource, String), u16>` ; `valid_node_id(id: &str) -> bool`.

- [ ] **Step 1: Write the failing tests**

```bash
cargo add tiny_http@0.12 --manifest-path src-tauri/Cargo.toml
```

`src-tauri/src/agents/mod.rs` reçoit `pub mod hooks_server;` après `pub mod activity;`.

`src-tauri/src/agents/hooks_server.rs` (tests seulement) :

```rust
#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    const TOKEN: &str = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";

    #[test]
    fn routes_a_hook_to_its_terminal() {
        assert_eq!(
            parse_route(&format!("/hook/claude/node-1?t={TOKEN}"), TOKEN),
            Ok((HookSource::Claude, "node-1".to_string()))
        );
        assert_eq!(
            parse_route(&format!("/hook/codex/abc_2?x=1&t={TOKEN}"), TOKEN),
            Ok((HookSource::Codex, "abc_2".to_string()))
        );
    }

    #[test]
    fn refuses_a_missing_or_wrong_token_before_anything_else() {
        assert_eq!(parse_route("/hook/claude/node-1", TOKEN), Err(403));
        assert_eq!(parse_route("/hook/claude/node-1?t=nope", TOKEN), Err(403));
        assert_eq!(parse_route("/nothing?t=nope", TOKEN), Err(403));
    }

    #[test]
    fn refuses_unknown_routes_and_doubtful_node_ids() {
        for path in ["/hook/gemini/n", "/hook/claude", "/hook/claude/a/b", "/hook/claude/..", "/hook/claude/%2e%2e", "/other/claude/n"] {
            assert_eq!(parse_route(&format!("{path}?t={TOKEN}"), TOKEN), Err(404), "{path}");
        }
        assert!(!valid_node_id("../x"));
        assert!(!valid_node_id(""));
        assert!(valid_node_id("0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10"));
    }

    /// One raw HTTP/1.1 request; returns the status code.
    fn send(port: u16, method: &str, path: &str, body: &[u8]) -> u16 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
        let _ = stream.write_all(body);
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response.split_whitespace().nth(1).unwrap_or("0").parse().unwrap()
    }

    #[test]
    fn answers_hooks_and_reports_their_activity() {
        let (tx, rx) = mpsc::channel();
        let server = start(move |hit| {
            let _ = tx.send(hit);
        })
        .unwrap();
        let claude = server.url(HookSource::Claude, "n1");
        let path = claude.trim_start_matches(&format!("http://127.0.0.1:{}", server.port));

        assert_eq!(send(server.port, "POST", path, br#"{"hook_event_name":"UserPromptSubmit"}"#), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            HookHit { node_id: "n1".into(), source: HookSource::Claude, activity: Activity::Working }
        );
        let waiting = br#"{"hook_event_name":"Notification","notification_type":"permission_prompt"}"#;
        assert_eq!(send(server.port, "POST", path, waiting), 204);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap().activity, Activity::Waiting);

        let codex = server.url(HookSource::Codex, "n2");
        let codex_path = codex.trim_start_matches(&format!("http://127.0.0.1:{}", server.port));
        assert_eq!(send(server.port, "POST", codex_path, br#"{"type":"agent-turn-complete"}"#), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            HookHit { node_id: "n2".into(), source: HookSource::Codex, activity: Activity::Idle }
        );
    }

    #[test]
    fn rejects_bad_requests_without_reporting_anything() {
        let (tx, rx) = mpsc::channel();
        let server = start(move |hit| {
            let _ = tx.send(hit);
        })
        .unwrap();
        let path = format!("/hook/claude/n1?t={}", server.token);
        assert_eq!(send(server.port, "POST", "/hook/claude/n1?t=wrong", b"{}"), 403);
        assert_eq!(send(server.port, "GET", &path, b""), 405);
        assert_eq!(send(server.port, "POST", &format!("/hook/claude/..?t={}", server.token), b"{}"), 404);
        assert_eq!(send(server.port, "POST", &path, b"not json"), 400);
        let huge = vec![b' '; MAX_BODY + 1];
        assert_eq!(send(server.port, "POST", &path, &huge), 413);
        // An event dummyPlane does not track is accepted and ignored.
        assert_eq!(send(server.port, "POST", &path, br#"{"hook_event_name":"SessionStart"}"#), 204);
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib agents::hooks_server`
Expected: FAIL à la compilation — `start`, `parse_route`, `HookHit`… introuvables.

- [ ] **Step 3: Write the implementation**

Au-dessus des tests :

```rust
//! The local HTTP endpoint the agents' hooks post to (spec habillage §10.3).
//! Bound to 127.0.0.1 on a port the system picks; every request must carry the
//! token drawn at startup.

use std::io::Read;

use tiny_http::{Method, Request, Response, Server};

use super::activity::{Activity, HookSource, claude_activity, codex_activity};

/// Larger bodies are refused (spec §10.3).
pub const MAX_BODY: usize = 64 * 1024;

/// A hook event that changes a terminal's activity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookHit {
    pub node_id: String,
    pub source: HookSource,
    pub activity: Activity,
}

pub struct HookServer {
    pub port: u16,
    pub token: String,
}

impl HookServer {
    /// The URL a terminal's hooks post to.
    pub fn url(&self, source: HookSource, node_id: &str) -> String {
        let kind = match source {
            HookSource::Claude => "claude",
            HookSource::Codex => "codex",
        };
        format!("http://127.0.0.1:{}/hook/{kind}/{node_id}?t={}", self.port, self.token)
    }
}

/// Starts the server; `on_hit` runs on the server's thread for each event
/// that maps to an activity.
pub fn start(on_hit: impl Fn(HookHit) + Send + 'static) -> std::io::Result<HookServer> {
    let server = Server::http("127.0.0.1:0").map_err(|err| std::io::Error::other(err.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| std::io::Error::other("no TCP port for the hook server"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let expected = token.clone();
    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let status = status_of(&mut request, &expected, &on_hit);
            let _ = request.respond(Response::empty(status));
        }
    });
    Ok(HookServer { port, token })
}

/// Node ids name files too: only the characters of our UUIDs pass.
pub fn valid_node_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `/hook/<claude|codex>/<nodeId>?t=<token>`. The token is checked first (403),
/// so nothing about the routes is told to a caller without it; then 404.
pub fn parse_route(url: &str, token: &str) -> Result<(HookSource, String), u16> {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    if !query.split('&').any(|pair| pair.strip_prefix("t=") == Some(token)) {
        return Err(403);
    }
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match parts.as_slice() {
        ["hook", "claude", node_id] if valid_node_id(node_id) => Ok((HookSource::Claude, node_id.to_string())),
        ["hook", "codex", node_id] if valid_node_id(node_id) => Ok((HookSource::Codex, node_id.to_string())),
        _ => Err(404),
    }
}

fn status_of(request: &mut Request, token: &str, on_hit: &dyn Fn(HookHit)) -> u16 {
    let (source, node_id) = match parse_route(request.url(), token) {
        Ok(route) => route,
        Err(status) => return status,
    };
    if *request.method() != Method::Post {
        return 405;
    }
    let mut body = Vec::new();
    if request.as_reader().take(MAX_BODY as u64 + 1).read_to_end(&mut body).is_err() {
        return 400;
    }
    if body.len() > MAX_BODY {
        return 413;
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return 400;
    };
    let activity = match source {
        HookSource::Claude => claude_activity(
            json["hook_event_name"].as_str().unwrap_or_default(),
            json["notification_type"].as_str(),
        ),
        HookSource::Codex => codex_activity(json["type"].as_str().unwrap_or_default()),
    };
    if let Some(activity) = activity {
        on_hit(HookHit { node_id, source, activity });
    }
    204
}
```

L'ordre des contrôles (jeton, puis méthode, puis route) fait que `GET` avec le bon jeton sur une route valide renvoie 405, comme le test l'attend ; une route invalide avec le bon jeton renvoie 404 avant la méthode. `#![allow(dead_code)]` en tête du fichier jusqu'à la tâche 5 (`// Wired in task 5.`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib agents::hooks_server`
Expected: PASS (5 tests).

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml` puis `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: propre.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/agents
git commit -m "feat(agents): local hook server for the agents' state"
```

---

### Task 4: Réglages de Claude, notify de Codex, marqueurs hérités (Rust)

**Files:**
- Create: `src-tauri/src/agents/claude_settings.rs` (code et tests)
- Modify: `src-tauri/src/agents/mod.rs` (`pub mod claude_settings;`)
- Modify: `src-tauri/src/pty/shell.rs` (`AgentHooks`, `INHERITED_MARKERS`, `SpawnPlan.env_remove`, `agent_command`, `claude_command`, `codex_command`, `build_plan`, tests)
- Modify: `src-tauri/src/pty/session.rs` (`env_remove` appliqué)
- Modify: `src-tauri/src/pty/mod.rs` (tests Windows), `src-tauri/src/commands/pty.rs` (appel de `build_plan`)

**Interfaces:**
- Consumes: `valid_node_id` (tâche 3).
- Produces : `claude_settings::{settings_json(url) -> serde_json::Value, write(dir, node_id, url) -> io::Result<PathBuf>, remove(dir, node_id), clear(dir)}` ; `pty::shell::{AgentHooks { claude_settings: Option<PathBuf>, codex_notify: Option<String> }, INHERITED_MARKERS: [&str; 8]}` ; `SpawnPlan.env_remove: Vec<String>` ; `agent_command(spec, syntax, hooks: &AgentHooks)` ; `build_plan(node_id, spec, locate, hooks: &AgentHooks)`.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/agents/mod.rs` reçoit `pub mod claude_settings;`.

`src-tauri/src/agents/claude_settings.rs` (tests seulement) :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "http://127.0.0.1:4242/hook/claude/n1?t=tok";

    #[test]
    fn reports_the_tracked_events_to_the_url_without_blocking_hooks() {
        let json = settings_json(URL);
        let hooks = json["hooks"].as_object().unwrap();
        let mut events: Vec<_> = hooks.keys().map(String::as_str).collect();
        events.sort_unstable();
        assert_eq!(events, ["Notification", "PostToolUse", "Stop", "StopFailure", "UserPromptSubmit"]);
        assert_eq!(json["hooks"]["Stop"][0]["hooks"][0], serde_json::json!({ "type": "http", "url": URL, "timeout": 2 }));
        assert_eq!(
            json["hooks"]["Notification"][0]["matcher"],
            "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|idle_prompt"
        );
    }

    #[test]
    fn writes_rewrites_and_removes_a_terminal_s_file() {
        let dir = tempfile::tempdir().unwrap();
        let hooks = dir.path().join("hooks");
        let path = write(&hooks, "n1", URL).unwrap();
        assert_eq!(path, hooks.join("n1.json"));
        let read: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(read, settings_json(URL));
        write(&hooks, "n1", "http://127.0.0.1:1/other").unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("127.0.0.1:1/other"));
        remove(&hooks, "n1");
        assert!(!path.exists());
    }

    #[test]
    fn refuses_a_node_id_that_would_leave_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write(dir.path(), "../evil", URL).is_err());
        assert!(!dir.path().join("../evil.json").exists());
    }

    #[test]
    fn clears_the_files_of_the_previous_run() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a", URL).unwrap();
        write(dir.path(), "b", URL).unwrap();
        std::fs::write(dir.path().join("keep.txt"), "x").unwrap();
        clear(dir.path());
        let left: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("keep.txt")]);
        clear(&dir.path().join("missing"));
    }
}
```

Dans `src-tauri/src/pty/shell.rs`, module `tests`, ajouter :

```rust
    fn hooked(settings: &str) -> AgentHooks {
        AgentHooks {
            claude_settings: Some(PathBuf::from(settings)),
            ..Default::default()
        }
    }

    #[test]
    fn claude_reports_its_state_through_its_settings_file() {
        let cmd = agent_command(
            &spec(Agent::Claude, claude(ClaudeMode::New, "Mon agent")),
            ShellSyntax::PowerShell,
            &hooked(r"C:\data\hooks\n1.json"),
        )
        .unwrap();
        assert_eq!(
            cmd.as_deref(),
            Some(r"claude --settings 'C:\data\hooks\n1.json' --session-id 0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10 -n 'Mon agent'")
        );
        let resume = agent_command(
            &spec(Agent::Claude, claude(ClaudeMode::Resume, "x")),
            ShellSyntax::Cmd,
            &hooked(r"C:\data\hooks\n1.json"),
        )
        .unwrap();
        assert_eq!(
            resume.as_deref(),
            Some(r#"claude --settings "C:\data\hooks\n1.json" --resume 0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10"#)
        );
        let cont = agent_command(
            &spec(Agent::Claude, claude(ClaudeMode::Continue, "x")),
            ShellSyntax::Posix,
            &hooked("C:/hooks/n1.json"),
        )
        .unwrap();
        assert_eq!(cont.as_deref(), Some("claude --settings 'C:/hooks/n1.json' --continue"));
    }

    #[test]
    fn codex_notifies_the_end_of_its_turns() {
        let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
        let hooks = AgentHooks {
            codex_notify: Some("http://127.0.0.1:4242/hook/codex/n1?t=tok".into()),
            ..Default::default()
        };
        let cmd = agent_command(&spec(Agent::Codex, None), ShellSyntax::Cmd, &hooks).unwrap();
        assert_eq!(
            cmd.unwrap(),
            format!(r#"codex -c "notify=['{curl}','-s','-X','POST','http://127.0.0.1:4242/hook/codex/n1?t=tok','-d']""#)
        );
        let plain = agent_command(&spec(Agent::Codex, None), ShellSyntax::Cmd, &AgentHooks::default()).unwrap();
        assert_eq!(plain.as_deref(), Some("codex"));
    }

    #[test]
    fn terminals_do_not_inherit_claude_code_session_markers() {
        let plan = build_plan("node-1", &spec(Agent::Shell, None), &nothing_on_path, &AgentHooks::default()).unwrap();
        for marker in ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID"] {
            assert!(plan.env_remove.iter().any(|key| key == marker), "{marker}");
        }
    }
```

Dans `src-tauri/src/pty/mod.rs`, module `windows_tests`, ajouter `env_remove: vec![],` dans `cmd_plan`, et :

```rust
    #[test]
    fn removes_inherited_variables_from_the_terminal() {
        // SAFETY: no other test reads or writes this variable.
        unsafe { std::env::set_var("DUMMYPLANE_TEST_MARKER", "leaked") };
        let mut plan = cmd_plan(&["/c", "echo [%DUMMYPLANE_TEST_MARKER%]"], None);
        plan.env_remove = vec!["DUMMYPLANE_TEST_MARKER".into()];
        let sink = VecSink::default();
        let exited = spawn_answering(&PtyManager::default(), "g", plan, sink.clone());
        wait_exit(&exited);
        assert!(sink.text().contains("[%DUMMYPLANE_TEST_MARKER%]"), "output: {:?}", sink.text());
        assert!(!sink.text().contains("leaked"));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: FAIL à la compilation — `settings_json`, `AgentHooks`, `env_remove`… introuvables, `agent_command` et `build_plan` appelés avec un argument de trop.

- [ ] **Step 3: Write the implementation**

`src-tauri/src/agents/claude_settings.rs`, au-dessus des tests :

```rust
//! The settings file given to Claude with `--settings` (spec habillage §8.2,
//! §10.3): http hooks that report its state, none that could block a decision.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::hooks_server::valid_node_id;

const NOTIFICATIONS: &str = "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|idle_prompt";

pub fn settings_json(url: &str) -> Value {
    let hook = json!({ "type": "http", "url": url, "timeout": 2 });
    let every = json!([{ "hooks": [hook] }]);
    json!({
        "hooks": {
            "UserPromptSubmit": every,
            "PostToolUse": every,
            "Stop": every,
            "StopFailure": every,
            "Notification": [{ "matcher": NOTIFICATIONS, "hooks": [hook] }],
        }
    })
}

/// `<dir>/<nodeId>.json`, rewritten at each launch (port and token change
/// with each run of the app).
pub fn write(dir: &Path, node_id: &str, url: &str) -> io::Result<PathBuf> {
    if !valid_node_id(node_id) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("identifiant de nœud invalide : {node_id}")));
    }
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{node_id}.json"));
    std::fs::write(&path, serde_json::to_vec_pretty(&settings_json(url))?)?;
    Ok(path)
}

pub fn remove(dir: &Path, node_id: &str) {
    if valid_node_id(node_id) {
        let _ = std::fs::remove_file(dir.join(format!("{node_id}.json")));
    }
}

/// Files left by a previous run point at a server that is gone.
pub fn clear(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            let _ = std::fs::remove_file(path);
        }
    }
}
```

`#![allow(dead_code)]` en tête du fichier jusqu'à la tâche 5 (`// Wired in task 5.`).

Dans `src-tauri/src/pty/shell.rs` :

1. Après `SpawnPlan`, ajouter :

```rust
/// What dummyPlane passes to agents so they report their state (spec §8.2).
#[derive(Debug, Clone, Default)]
pub struct AgentHooks {
    /// Claude: `claude --settings <file>`.
    pub claude_settings: Option<PathBuf>,
    /// Codex: the URL its `notify` posts to.
    pub codex_notify: Option<String>,
}

/// Claude Code marks the processes its tools start; an dummyPlane launched from
/// a Claude Code session must not pass them on, or its agents become child
/// sessions, left out of `--resume` (spec §8.2).
pub const INHERITED_MARKERS: [&str; 8] = [
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SKIP_PROMPT_HISTORY",
];
```

2. Dans `SpawnPlan`, après `env` :

```rust
    /// Inherited variables the process must not see.
    pub env_remove: Vec<String>,
```

3. `agent_command` prend `hooks: &AgentHooks` en troisième paramètre ; ses bras Claude et Codex deviennent :

```rust
        Agent::Claude => Some(claude_command(spec.claude.as_ref(), syntax, hooks.claude_settings.as_deref())?),
        Agent::Codex => Some(codex_command(syntax, hooks.codex_notify.as_deref())),
```

4. `claude_command` prend `settings: Option<&Path>` et construit le début de la commande :

```rust
fn claude_command(launch: Option<&ClaudeLaunch>, syntax: ShellSyntax, settings: Option<&Path>) -> AppResult<String> {
    let launch =
        launch.ok_or_else(|| AppError::InvalidInput("options Claude manquantes".into()))?;
    let claude = match settings {
        Some(path) => format!("claude --settings {}", quote(syntax, &path.to_string_lossy())),
        None => "claude".to_string(),
    };
    if launch.mode == ClaudeMode::Continue {
        return Ok(format!("{claude} --continue"));
    }
```

et chaque `claude --…` du reste de la fonction devient `{claude} --…` (y compris `MSYS_NO_PATHCONV=1 {claude} --session-id …`).

5. Ajouter :

```rust
/// `notify` is given as TOML literal strings: PowerShell 5.1 drops the
/// double quotes nested in an argument passed to a native program.
fn codex_command(syntax: ShellSyntax, notify_url: Option<&str>) -> String {
    let Some(url) = notify_url else {
        return "codex".into();
    };
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let notify = format!("notify=['{curl}','-s','-X','POST','{url}','-d']");
    format!("codex -c {}", quote(syntax, &notify))
}
```

6. `build_plan` prend `hooks: &AgentHooks` en quatrième paramètre, le passe à `agent_command`, et remplit :

```rust
        env_remove: INHERITED_MARKERS.iter().map(|key| key.to_string()).collect(),
```

7. Ajouter `&AgentHooks::default()` en dernier argument de chaque appel existant d'`agent_command` et de `build_plan` dans les tests de `shell.rs`, et `use std::path::Path;` si besoin.

Dans `src-tauri/src/pty/session.rs`, dans `Session::start`, après la boucle des `env` :

```rust
        for key in &plan.env_remove {
            cmd.env_remove(key);
        }
```

Dans `src-tauri/src/commands/pty.rs`, l'appel devient provisoirement `build_plan(&node_id, &spec, &which_locate, &AgentHooks::default())?` (la tâche 5 passe les vrais hooks), avec `AgentHooks` ajouté à l'import de `crate::pty::shell`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: PASS (les 4 tests de `claude_settings`, les 3 nouveaux de `shell`, le test Windows des variables, et tous les anciens).

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml` puis `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: propre.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(agents): Claude settings and Codex notify for the hooks, no inherited session markers"
```

---

### Task 5: Brancher l'activité dans l'application (Rust)

**Files:**
- Modify: `src-tauri/src/pty/session.rs`, `src-tauri/src/pty/mod.rs` (rappel `on_output`)
- Create: `src-tauri/src/commands/agents.rs` (état, émission, minuterie, commande, test)
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/pty.rs`, `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/agents/{activity,hooks_server,claude_settings}.rs` (retirer `#![allow(dead_code)]`)

**Interfaces:**
- Consumes: `Tracker`, `Change`, `HookSource` (tâche 2) ; `hooks_server::{start, HookServer, HookHit}` (tâche 3) ; `claude_settings::{write, remove, clear}`, `AgentHooks`, `build_plan(…, hooks)` (tâche 4).
- Produces : `PtyManager::spawn(node_id, plan, size, sink, on_output: Box<dyn Fn() + Send>, on_exit)` ; événement `agent-activity` `{ nodeId, activity, since }` (`since` en millisecondes epoch) ; commande `agent_activity_snapshot() -> { hooksAvailable, activities }` ; `commands::agents::epoch_ms(at, now, wall_now_ms) -> u64`.

- [ ] **Step 1: Write the failing tests**

Dans `src-tauri/src/pty/mod.rs`, module `windows_tests` : `spawn_answering` et le test « rejects a second spawn » passent `Box::new(|| {})` comme nouveau cinquième argument de `spawn`, et ajouter :

```rust
    #[test]
    fn reports_each_chunk_of_output_to_the_activity_callback() {
        let mgr = PtyManager::default();
        let sink = VecSink::default();
        let chunks = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = chunks.clone();
        let (tx, rx) = mpsc::channel();
        mgr.spawn(
            "h",
            cmd_plan(&["/c", "echo activity"], None),
            pty_size(80, 24),
            Box::new(sink.clone()),
            Box::new(move || {
                counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }),
            move |info| {
                let _ = tx.send(info);
            },
        )
        .unwrap();
        wait_until("cursor position query", || sink.text().contains("\x1b[6n"));
        mgr.write("h", b"\x1b[1;1R").unwrap();
        wait_exit(&rx);
        assert!(chunks.load(std::sync::atomic::Ordering::SeqCst) > 0);
    }
```

`src-tauri/src/commands/agents.rs` (test seulement pour l'instant) :

```rust
#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn dates_a_change_in_wall_clock_milliseconds() {
        let now = Instant::now();
        assert_eq!(epoch_ms(now - Duration::from_millis(1500), now, 1_000_000), 998_500);
        assert_eq!(epoch_ms(now, now, 1_000_000), 1_000_000);
    }
}
```

et `pub mod agents;` en tête de `src-tauri/src/commands/mod.rs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: FAIL à la compilation — `spawn` attend 5 arguments, `epoch_ms` introuvable.

- [ ] **Step 3: Write the implementation**

`src-tauri/src/pty/session.rs` :

```rust
/// Called after each chunk of output is read: the agent's activity.
pub type OnOutput = Box<dyn Fn() + Send>;
```

`Session::start(plan, size, sink, on_output: OnOutput)` passe `on_output` à `spawn_reader(reader, session.clone(), on_output)`, qui l'appelle après avoir relâché le verrou de sortie :

```rust
fn spawn_reader(mut reader: Box<dyn Read + Send>, session: Arc<Session>, on_output: OnOutput) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    {
                        let mut output = session.output.lock().unwrap();
                        output.scrollback.push(chunk);
                        if output.sink.as_ref().is_some_and(|sink| !sink.send(chunk)) {
                            output.sink = None;
                        }
                    }
                    on_output();
                }
            }
        }
    })
}
```

`src-tauri/src/pty/mod.rs` : `PtyManager::spawn` prend `on_output: OnOutput` après `sink` et le passe à `Session::start` (`use session::{OnOutput, OutputSink, Session, Started};`).

`src-tauri/src/commands/agents.rs`, au-dessus du test :

```rust
//! Agent activity as the frontend sees it (spec habillage §10.2, §15.3): the
//! hook server, the tracker, the `agent-activity` event and the snapshot.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agents::activity::{Activity, Change, HookSource, Tracker};
use crate::agents::claude_settings;
use crate::agents::hooks_server::{self, HookHit, HookServer};
use crate::error::AppResult;
use crate::pty::shell::{Agent, AgentHooks};

/// Quiet terminals are checked this often (the 1.5 s rule).
const TICK: Duration = Duration::from_millis(250);

pub struct AgentState {
    tracker: Mutex<Tracker>,
    hooks: Option<HookServer>,
    hooks_dir: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    node_id: String,
    activity: Activity,
    since: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    hooks_available: bool,
    activities: Vec<ActivityEvent>,
}

/// Wall-clock milliseconds of `at`, given `now` and the wall clock at `now`:
/// the frontend shows how long an agent has been in its state.
pub fn epoch_ms(at: Instant, now: Instant, wall_now_ms: u64) -> u64 {
    wall_now_ms.saturating_sub(now.saturating_duration_since(at).as_millis() as u64)
}

fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn event(change: &Change) -> ActivityEvent {
    ActivityEvent {
        node_id: change.node_id.clone(),
        activity: change.activity,
        since: epoch_ms(change.since, Instant::now(), wall_ms()),
    }
}

fn emit(app: &AppHandle, change: &Change) {
    let _ = app.emit("agent-activity", event(change));
}

/// Starts the hook server (the app runs without it if it cannot), clears the
/// settings files of the previous run, and checks quiet terminals.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let hooks_dir = app.path().app_data_dir()?.join("hooks");
    claude_settings::clear(&hooks_dir);
    let handle = app.clone();
    let hooks = match hooks_server::start(move |hit| on_hook(&handle, hit)) {
        Ok(server) => Some(server),
        Err(err) => {
            eprintln!("hook server not started: {err}");
            None
        }
    };
    app.manage(AgentState {
        tracker: Mutex::new(Tracker::default()),
        hooks,
        hooks_dir,
    });
    let ticker = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(TICK);
            let changes = ticker.state::<AgentState>().tracker.lock().unwrap().tick(Instant::now());
            for change in &changes {
                emit(&ticker, change);
            }
        }
    });
    Ok(())
}

fn on_hook(app: &AppHandle, hit: HookHit) {
    let Some(state) = app.try_state::<AgentState>() else {
        return;
    };
    let change = state.tracker.lock().unwrap().hook(&hit.node_id, hit.source, hit.activity, Instant::now());
    if let Some(change) = change {
        emit(app, &change);
    }
}

/// The hooks a new process gets: Claude's settings file, Codex's notify URL.
/// Without a server, Claude starts without `--settings`.
pub fn hooks_for(app: &AppHandle, node_id: &str, agent: Agent) -> AgentHooks {
    let state = app.state::<AgentState>();
    let Some(server) = &state.hooks else {
        return AgentHooks::default();
    };
    match agent {
        Agent::Claude => match claude_settings::write(&state.hooks_dir, node_id, &server.url(HookSource::Claude, node_id)) {
            Ok(path) => AgentHooks {
                claude_settings: Some(path),
                ..Default::default()
            },
            Err(err) => {
                eprintln!("hooks of {node_id} not written: {err}");
                AgentHooks::default()
            }
        },
        Agent::Codex => AgentHooks {
            codex_notify: Some(server.url(HookSource::Codex, node_id)),
            ..Default::default()
        },
        _ => AgentHooks::default(),
    }
}

/// A process is about to start: idle until it shows otherwise.
pub fn started(app: &AppHandle, node_id: &str) {
    let change = app.state::<AgentState>().tracker.lock().unwrap().start(node_id, Instant::now());
    emit(app, &change);
}

/// Each chunk of output; emits only when the activity changes.
pub fn output(app: &AppHandle, node_id: &str) {
    let change = app.state::<AgentState>().tracker.lock().unwrap().output(node_id, Instant::now());
    if let Some(change) = change {
        emit(app, &change);
    }
}

/// The process ended (or failed to start): forget it and its settings file.
pub fn ended(app: &AppHandle, node_id: &str) {
    let state = app.state::<AgentState>();
    state.tracker.lock().unwrap().remove(node_id);
    claude_settings::remove(&state.hooks_dir, node_id);
}

#[tauri::command]
pub async fn agent_activity_snapshot(state: State<'_, AgentState>) -> AppResult<ActivitySnapshot> {
    let activities = state.tracker.lock().unwrap().snapshot().iter().map(event).collect();
    Ok(ActivitySnapshot {
        hooks_available: state.hooks.is_some(),
        activities,
    })
}
```

`src-tauri/src/commands/pty.rs`, dans `pty_spawn` :

```rust
    let hooks = agents::hooks_for(&app, &node_id, spec.agent);
    let plan = match build_plan(&node_id, &spec, &which_locate, &hooks) {
        Ok(plan) => plan,
        Err(err) => {
            // The settings file written for this launch has no use any more.
            agents::ended(&app, &node_id);
            return Err(err);
        }
    };
    let exited_id = node_id.clone();
    let output_app = app.clone();
    let output_id = node_id.clone();
    let exit_app = app.clone();
    agents::started(&app, &node_id);
    let spawned = pty.spawn(
        &node_id,
        plan,
        pty_size(cols, rows),
        Box::new(ChannelSink(on_data)),
        Box::new(move || agents::output(&output_app, &output_id)),
        move |info| {
            agents::ended(&exit_app, &exited_id);
            // …the existing scrollback save and `pty-exit` event, unchanged…
        },
    );
    if spawned.is_err() {
        agents::ended(&app, &node_id);
    }
    spawned
```

(avec `use crate::commands::agents;`, et le corps existant de la fermeture de sortie déplacé tel quel après `agents::ended`, `app` remplacé par `exit_app`).

`src-tauri/src/lib.rs` : dans `setup`, après `spawn_scrollback_flusher(...)`, ajouter `commands::agents::setup(app.handle())?;` ; dans `generate_handler!`, ajouter `commands::agents::agent_activity_snapshot,`.

Retirer les `#![allow(dead_code)]` (et leur commentaire) des trois fichiers d'`agents/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: PASS, dont `reports_each_chunk_of_output_to_the_activity_callback` et `dates_a_change_in_wall_clock_milliseconds`.

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml` puis `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: propre (plus aucun code mort).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(agents): emit agent-activity from hooks and terminal output"
```

---

### Task 6: Pastilles vivantes, durées et compteurs des groupes (front)

**Files:**
- Create: `src/ipc/activity.ts`, `src/store/agentActivity.ts`, `src/store/agentActivity.test.ts`, `src/lib/useNow.ts`
- Modify: `src/lib/format.ts`, `src/lib/format.test.ts` (`formatDuration`)
- Modify: `src/nodes/terminal/pill.ts`, `src/nodes/terminal/pill.test.ts`, `src/nodes/terminal/StatusPill.tsx`, `src/nodes/terminal/TerminalHeader.tsx`, `src/nodes/terminal/TerminalNode.tsx`
- Modify: `src/fleet/catalog.ts` (`INDIGO`), `src/fleet/groupSummary.ts`, `src/fleet/groupSummary.test.ts`, `src/canvas/overlay/GroupLabels.tsx`
- Modify: `src/app/boot.ts`

**Interfaces:**
- Consumes: événement `agent-activity`, commande `agent_activity_snapshot` (tâche 5).
- Produces : `type Activity = "idle" | "working" | "waiting"` ; `agentActivityStore` (`activities`, `apply`, `load`, `remove`) ; `useActivity(nodeId)` ; `formatDuration(ms)` ; `useNow(intervalMs)` ; `pillOf(status, activity?, indigo?)` avec les tons `ready`, `working`, `workingIndigo`, `waiting` ; `waitingText(waiting) -> string | null`.

- [ ] **Step 1: Write the failing tests**

`src/store/agentActivity.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { agentActivityStore } from "./agentActivity";

const state = () => agentActivityStore.getState();

beforeEach(() => state().load([]));

describe("agent activity store", () => {
  it("applies each change from Rust", () => {
    state().apply({ nodeId: "a", activity: "working", since: 10 });
    state().apply({ nodeId: "a", activity: "waiting", since: 20 });
    expect(state().activities).toEqual({ a: { activity: "waiting", since: 20 } });
  });

  it("starts again from Rust's snapshot after a reload, dropping what it no longer runs", () => {
    state().apply({ nodeId: "gone", activity: "working", since: 1 });
    state().load([{ nodeId: "a", activity: "working", since: 5 }]);
    expect(state().activities).toEqual({ a: { activity: "working", since: 5 } });
  });

  it("forgets a terminal whose process exited", () => {
    state().apply({ nodeId: "a", activity: "idle", since: 1 });
    state().remove("a");
    expect(state().activities).toEqual({});
  });
});
```

Dans `src/lib/format.test.ts`, ajouter `formatDuration` à l'import et :

```ts
describe("formatDuration", () => {
  it("reads like the fleet panel (spec habillage §10.4)", () => {
    expect(formatDuration(45_400)).toBe("45 s");
    expect(formatDuration(12 * 60_000 + 5_000)).toBe("12 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05");
    expect(formatDuration(-3)).toBe("0 s");
  });
});
```

Dans `src/nodes/terminal/pill.test.ts`, ajouter :

```ts
describe("a running agent's activity (spec habillage §7.2)", () => {
  const running = { state: "running" } as const;

  it("reads PRÊT, EN COURS or ATTEND", () => {
    expect(pillOf(running, "idle")).toEqual({ label: "PRÊT", tone: "ready" });
    expect(pillOf(running, "working")).toEqual({ label: "EN COURS", tone: "working" });
    expect(pillOf(running, "waiting")).toEqual({ label: "ATTEND", tone: "waiting" });
  });

  it("works in indigo for the indigo agents", () => {
    expect(pillOf(running, "working", true)).toEqual({ label: "EN COURS", tone: "workingIndigo" });
  });

  it("reads ACTIF while its activity is unknown, and ignores the activity of a stopped process", () => {
    expect(pillOf(running)).toEqual({ label: "ACTIF", tone: "live" });
    expect(pillOf({ state: "stopped" }, "working")).toEqual({ label: "ARRÊTÉ", tone: "stopped" });
  });
});
```

Dans `src/fleet/groupSummary.test.ts`, ajouter `waitingText` à l'import et :

```ts
describe("waitingText", () => {
  it("adds the members waiting for an answer, in amber", () => {
    expect(waitingText(1)).toBe("· 1 attend");
    expect(waitingText(3)).toBe("· 3 attendent");
    expect(waitingText(0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/store/agentActivity.test.ts src/lib/format.test.ts src/nodes/terminal/pill.test.ts src/fleet/groupSummary.test.ts`
Expected: FAIL — `./agentActivity` introuvable, `formatDuration` et `waitingText` non exportés, `pillOf` sans paramètre d'activité.

- [ ] **Step 3: Write the implementation**

`src/ipc/activity.ts` :

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./invoke";

export type Activity = "idle" | "working" | "waiting";

/** Mirrors Rust's `ActivityEvent`; `since` is a wall-clock time in ms. */
export interface ActivityEvent {
  nodeId: string;
  activity: Activity;
  since: number;
}

export interface ActivitySnapshot {
  hooksAvailable: boolean;
  activities: ActivityEvent[];
}

export const agentActivitySnapshot = () => call<ActivitySnapshot>("agent_activity_snapshot");

export function onAgentActivity(handler: (event: ActivityEvent) => void): Promise<UnlistenFn> {
  return listen<ActivityEvent>("agent-activity", (event) => handler(event.payload));
}
```

`src/store/agentActivity.ts` :

```ts
import { createStore, useStore } from "zustand";
import type { Activity, ActivityEvent } from "@/ipc/activity";

export interface AgentActivity {
  activity: Activity;
  since: number;
}

interface AgentActivityState {
  activities: Record<string, AgentActivity>;
  /** One change computed by Rust (spec habillage §10.2). */
  apply: (event: ActivityEvent) => void;
  /** Rust's state when the webview (re)loads. */
  load: (events: readonly ActivityEvent[]) => void;
  remove: (nodeId: string) => void;
}

export const agentActivityStore = createStore<AgentActivityState>()((set) => ({
  activities: {},
  apply: ({ nodeId, activity, since }) => set((s) => ({ activities: { ...s.activities, [nodeId]: { activity, since } } })),
  load: (events) =>
    set({ activities: Object.fromEntries(events.map(({ nodeId, activity, since }) => [nodeId, { activity, since }])) }),
  remove: (nodeId) =>
    set((s) => ({ activities: Object.fromEntries(Object.entries(s.activities).filter(([id]) => id !== nodeId)) })),
}));

export function useActivity(nodeId: string): AgentActivity | undefined {
  return useStore(agentActivityStore, (s) => s.activities[nodeId]);
}

export function useActivities(): Record<string, AgentActivity> {
  return useStore(agentActivityStore, (s) => s.activities);
}
```

`src/lib/format.ts` :

```ts
/** "45 s", "12 min", "1 h 05": how long an agent has been in its state (spec habillage §10.4). */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
```

`src/lib/useNow.ts` :

```ts
import { useEffect, useState } from "react";

/** The current time, refreshed every `intervalMs` (durations shown in the UI). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
```

`src/nodes/terminal/pill.ts` : importer `type Activity` de `@/ipc/activity` ; `PillTone` devient `"live" | "ready" | "working" | "workingIndigo" | "waiting" | "stopped" | "done" | "failed"` ; `pillOf(status: TerminalStatus, activity?: Activity, indigo = false)` ; le cas `running` devient :

```ts
    case "running":
      if (activity === "working") return { label: "EN COURS", tone: indigo ? "workingIndigo" : "working" };
      if (activity === "waiting") return { label: "ATTEND", tone: "waiting" };
      if (activity === "idle") return { label: "PRÊT", tone: "ready" };
      return { label: "ACTIF", tone: "live" };
```

Son commentaire de tête devient « The status pill of a terminal header (spec habillage §7.2): the process state, and for a running process its activity. »

`src/fleet/catalog.ts` : `/** Agents of this tint work in indigo rather than orange (spec habillage §7.2). */ export const INDIGO = "#707de3";`.

`src/nodes/terminal/StatusPill.tsx` :

```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { pillOf, type PillTone } from "./pill";

const TONES: Record<PillTone, string> = {
  live: "bg-[#322f28] text-ov-text",
  ready: "bg-[#322f28] text-ov-text",
  working: "border border-ov-working/70 text-ov-working",
  workingIndigo: "border border-[#707de3]/70 text-[#707de3]",
  waiting: "border border-ov-waiting/70 text-ov-waiting",
  stopped: "bg-ov-card text-ov-text-2",
  done: "border border-ov-done/60 text-ov-done",
  failed: "border border-ov-danger/60 text-ov-danger",
};

const DOTS: Record<PillTone, string> = {
  live: "bg-ov-live",
  ready: "bg-ov-text-2",
  working: "bg-ov-working",
  workingIndigo: "bg-[#707de3]",
  waiting: "bg-ov-waiting animate-pulse",
  stopped: "bg-ov-text-2/60",
  done: "bg-ov-done",
  failed: "bg-ov-danger",
};

/** Spec habillage §7.2; the tooltip tells how long the agent has been in its state (§10.4). */
export function StatusPill(props: { status: TerminalStatus; activity?: AgentActivity; indigo?: boolean }) {
  const { status, activity, indigo } = props;
  const now = useNow(15_000);
  const running = status.state === "running";
  const pill = pillOf(status, running ? activity?.activity : undefined, indigo);
  const title =
    status.state === "error"
      ? status.message
      : running && activity
        ? `${pill.label} depuis ${formatDuration(now - activity.since)}`
        : undefined;
  return (
    <span
      title={title}
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

`src/nodes/terminal/TerminalHeader.tsx` : nouveau prop `activity?: AgentActivity` (import de `@/store/agentActivity`), passé à `<StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} />` (import d'`INDIGO` depuis `@/fleet/catalog`).

`src/nodes/terminal/TerminalNode.tsx` : `const activity = useActivity(nodeId);` (import de `@/store/agentActivity`), passé à `<TerminalHeader … activity={activity} />`.

`src/fleet/groupSummary.ts` : le commentaire de `countsText` perd sa phrase « Until J3… » (« en cours » compte désormais l'activité `working`), et ajouter :

```ts
/** "· 1 attend", shown in amber after the counters; null when nobody waits. */
export function waitingText(waiting: number): string | null {
  if (waiting <= 0) return null;
  return `· ${waiting} ${waiting > 1 ? "attendent" : "attend"}`;
}
```

`src/canvas/overlay/GroupLabels.tsx` : remplacer `statuses` par `const activities = useActivities();` (import de `@/store/agentActivity`) ; chaque `GroupLabel` reçoit `working={members(group, "working")}` et `waiting={members(group, "waiting")}` avec, dans `GroupLabels` :

```tsx
  const members = (group: SceneGroup, activity: Activity) =>
    group.memberIds.filter((id) => activities[id]?.activity === activity).length;
```

(import de `type Activity` depuis `@/ipc/activity`) ; dans `GroupLabel`, après le `<span>` des compteurs :

```tsx
      {waitingText(waiting) && <span className="ml-1 font-mono text-ov-waiting">{waitingText(waiting)}</span>}
```

Une activité ne survit pas à la fin du processus (`remove` à `pty-exit`) : un membre arrêté n'est jamais compté.

`src/app/boot.ts` : avant `setLivePtys(await ptyList())` :

```ts
    await onAgentActivity((event) => agentActivityStore.getState().apply(event));
    const activity = await agentActivitySnapshot();
    agentActivityStore.getState().load(activity.activities);
    if (!activity.hooksAvailable) toast.warning("États des agents approximatifs : serveur local indisponible");
```

et le gestionnaire de `pty-exit` appelle aussi `agentActivityStore.getState().remove(nodeId)` (imports : `agentActivitySnapshot`, `onAgentActivity` de `@/ipc/activity`, `agentActivityStore` de `@/store/agentActivity`, `toast` de `sonner`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/store/agentActivity.test.ts src/lib/format.test.ts src/nodes/terminal/pill.test.ts src/fleet/groupSummary.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit` puis `pnpm test`
Expected: aucune erreur, tous les tests passent.

- [ ] **Step 5: Check in the app**

Application d'essai (profil `dev.dummyplane.probe`, relancée après les tâches Rust) : un Claude passe EN COURS pendant un tour (consigne « écris trois lignes sur le thème de la mer »), PRÊT à la fin ; une demande d'autorisation (consigne « crée un fichier a.txt ») le met en ATTEND, point clignotant ; un Shell qui affiche `dir /s` passe EN COURS puis PRÊT 1,5 s après ; l'info-bulle de la pastille donne la durée ; l'étiquette du groupe compte « en cours » et « · 1 attend » ; F5 : les pastilles reprennent l'état courant ; aucune ligne de hook visible dans Claude.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(agents): live PRÊT / EN COURS / ATTEND pills and group counters"
```

---

### Task 7: Rail droit et panneau Flotte (front)

**Files:**
- Create: `src/fleet/fleetView.ts`, `src/fleet/fleetView.test.ts`
- Create: `src/fleet/FleetPanel.tsx`, `src/shell/RightRail.tsx`, `src/canvas/focusNode.ts`
- Modify: `src/canvas/canvasStore.ts` (`nodeIds`), `src/canvas/canvasStore.test.ts`, `src/canvas/Canvas.tsx`
- Modify: `src/store/ui.ts` (`fleetOpen`), `src/shell/ProjectView.tsx`

**Interfaces:**
- Consumes: `canvasStore.frames` (B1), `SceneFrame`, `ROLES`, `countsText` (B1) ; `useActivities`, `formatDuration`, `useNow`, `StatusPill`, `INDIGO` (tâche 6) ; `requestClose` (`src/fleet/terminals.ts`) ; `focusTerminal` (`registry.ts`).
- Produces : `type FleetState = "working" | "waiting" | "idle" | "stopped"`, `type FleetFilter = "all" | FleetState`, `FLEET_FILTERS`, `fleetStateOf(status, activity?)`, `interface FleetAgent`, `interface FleetSection`, `fleetSections(agents, frames, filter)`, `filterCounts(agents)` ; `canvasStore.nodeIds` / `setNodeIds` ; `focusNode(nodeId)` ; `uiStore.fleetOpen` / `setFleetOpen`.

- [ ] **Step 1: Write the failing tests**

`src/fleet/fleetView.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { SceneFrame } from "@/canvas/groups";
import { filterCounts, fleetSections, fleetStateOf, type FleetAgent } from "./fleetView";

const agent = (id: string, state: FleetAgent["state"]): FleetAgent => ({ id, name: id, agent: "claude", state, since: 0 });
const frame = (id: string, memberIds: string[], role: "backend" | "docs" | null = "backend"): SceneFrame => ({
  id,
  name: id.toUpperCase(),
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  group: role ? { role, pantheon: "greek" } : null,
  memberIds,
});

describe("fleetStateOf", () => {
  it("takes the activity of a running agent, idle while unknown", () => {
    expect(fleetStateOf({ state: "running" }, { activity: "waiting", since: 1 })).toBe("waiting");
    expect(fleetStateOf({ state: "running" })).toBe("idle");
    expect(fleetStateOf({ state: "starting" })).toBe("idle");
  });

  it("calls every other process state stopped", () => {
    expect(fleetStateOf({ state: "stopped" }, { activity: "working", since: 1 })).toBe("stopped");
    expect(fleetStateOf({ state: "exited", code: 0 })).toBe("stopped");
    expect(fleetStateOf({ state: "error", message: "x" })).toBe("stopped");
  });
});

describe("fleetSections", () => {
  const agents = [agent("a", "working"), agent("b", "idle"), agent("c", "waiting"), agent("d", "stopped")];
  const frames = [frame("g1", ["a", "b"]), frame("plain", ["c"], null), frame("g2", ["d"], "docs")];

  it("lists each group in scene order, then the agents outside groups", () => {
    const sections = fleetSections(agents, frames, "all");
    expect(sections.map((s) => [s.id, s.name, s.agents.map((a) => a.id)])).toEqual([
      ["g1", "G1", ["a", "b"]],
      ["g2", "G2", ["d"]],
      [null, "Hors groupe", ["c"]],
    ]);
    expect(sections[0].color).toBe("#AA88D2");
    expect(sections[2].color).toBeNull();
  });

  it("keeps only the agents of the filter and drops empty sections", () => {
    expect(fleetSections(agents, frames, "working").map((s) => [s.id, s.agents.map((a) => a.id)])).toEqual([["g1", ["a"]]]);
    expect(fleetSections(agents, frames, "waiting").map((s) => s.id)).toEqual([null]);
  });
});

describe("filterCounts", () => {
  it("counts the agents of each filter", () => {
    expect(filterCounts([agent("a", "working"), agent("b", "working"), agent("c", "stopped")])).toEqual({
      all: 3,
      working: 2,
      waiting: 0,
      idle: 0,
      stopped: 1,
    });
  });
});
```

Dans `src/canvas/canvasStore.test.ts`, ajouter :

```ts
describe("nodeIds", () => {
  it("keeps the same list when the scene's nodes did not change", () => {
    const ids = ["a", "b"];
    canvasStore.getState().setNodeIds(ids);
    canvasStore.getState().setNodeIds(["a", "b"]);
    expect(canvasStore.getState().nodeIds).toBe(ids);
    canvasStore.getState().setNodeIds([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/fleet/fleetView.test.ts src/canvas/canvasStore.test.ts`
Expected: FAIL — `./fleetView` introuvable, `setNodeIds` inexistant.

- [ ] **Step 3: Write the implementation**

`src/fleet/fleetView.ts` :

```ts
import type { SceneFrame } from "@/canvas/groups";
import type { AgentId } from "@/ipc/pty";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { ROLES } from "./roles";

/** What the fleet panel tells about an agent (spec habillage §5.5). */
export type FleetState = "working" | "waiting" | "idle" | "stopped";
export type FleetFilter = "all" | FleetState;

export const FLEET_FILTERS: readonly { id: FleetFilter; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "working", label: "En cours" },
  { id: "waiting", label: "Attend" },
  { id: "idle", label: "Inactifs" },
  { id: "stopped", label: "Arrêtés" },
];

export interface FleetAgent {
  id: string;
  name: string;
  agent: AgentId;
  state: FleetState;
  /** Since when the agent is in its state (running agents only). */
  since?: number;
}

export interface FleetSection {
  /** The group's frame, or null for the agents outside groups. */
  id: string | null;
  name: string;
  color: string | null;
  agents: FleetAgent[];
}

/** A running agent takes its activity (idle until known); any other process state is stopped. */
export function fleetStateOf(status: TerminalStatus, activity?: AgentActivity): FleetState {
  if (status.state === "running") return activity?.activity ?? "idle";
  if (status.state === "starting") return "idle";
  return "stopped";
}

/** Each group in scene order, then "Hors groupe"; only the agents of `filter`, no empty section. */
export function fleetSections(
  agents: readonly FleetAgent[],
  frames: readonly SceneFrame[],
  filter: FleetFilter,
): FleetSection[] {
  const shown = agents.filter((a) => filter === "all" || a.state === filter);
  const inGroups = new Set<string>();
  const sections: FleetSection[] = [];
  for (const frame of frames) {
    if (!frame.group) continue;
    frame.memberIds.forEach((id) => inGroups.add(id));
    const members = shown.filter((a) => frame.memberIds.includes(a.id));
    if (members.length > 0) {
      sections.push({ id: frame.id, name: frame.name, color: ROLES[frame.group.role].color, agents: members });
    }
  }
  const outside = shown.filter((a) => !inGroups.has(a.id));
  if (outside.length > 0) sections.push({ id: null, name: "Hors groupe", color: null, agents: outside });
  return sections;
}

export function filterCounts(agents: readonly FleetAgent[]): Record<FleetFilter, number> {
  const counts: Record<FleetFilter, number> = { all: agents.length, working: 0, waiting: 0, idle: 0, stopped: 0 };
  for (const a of agents) counts[a.state]++;
  return counts;
}
```

`src/canvas/canvasStore.ts` : dans `CanvasState`, ajouter

```ts
  /** Ids of the dummyPlane nodes on the canvas on screen (deleted ones excluded). */
  nodeIds: string[];
  setNodeIds: (ids: string[]) => void;
```

et dans le store :

```ts
  nodeIds: [],
  setNodeIds: (ids) => {
    const current = get().nodeIds;
    if (ids.length !== current.length || ids.some((id, i) => id !== current[i])) set({ nodeIds: ids });
  },
```

`src/canvas/Canvas.tsx` : dans `onChange`, après `setFrames(...)`, `canvasStore.getState().setNodeIds(liveNodeIds(elements));` (déjà importé depuis `./sceneSync`), et dans l'effet de démontage déjà présent, vider aussi : `useEffect(() => () => { canvasStore.getState().setFrames([]); canvasStore.getState().setNodeIds([]); }, []);`.

`src/canvas/focusNode.ts` :

```ts
import type { NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { focusTerminal } from "@/nodes/terminal/registry";
import { canvasStore } from "./canvasStore";

/** The fleet panel's click: the view centered on the terminal at 100 %, and the keyboard to it (spec habillage §5.5). */
export function focusNode(nodeId: string) {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return;
  api.updateScene({ appState: { zoom: { value: 1 as NormalizedZoomValue } } });
  api.scrollToContent(element, { animate: true, duration: 200 });
  focusTerminal(nodeId);
}
```

`src/store/ui.ts` : `fleetOpen: boolean; setFleetOpen: (open: boolean) => void;` (`fleetOpen: false`, `setFleetOpen: (fleetOpen) => set({ fleetOpen })`).

`src/fleet/FleetPanel.tsx` :

```tsx
import { useState } from "react";
import { X } from "lucide-react";
import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { focusNode } from "@/canvas/focusNode";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import { useActivities } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { AGENTS, INDIGO } from "./catalog";
import { FLEET_FILTERS, filterCounts, fleetSections, fleetStateOf, type FleetAgent, type FleetFilter } from "./fleetView";
import { countsText } from "./groupSummary";
import { requestClose } from "./terminals";

/** The fleet of the workspace on screen, by group (spec habillage §5.5); J5 adds pause and resume. */
export function FleetPanel() {
  const [filter, setFilter] = useState<FleetFilter>("all");
  const now = useNow(15_000);
  const nodeIds = useCanvas((s) => s.nodeIds);
  const frames = useCanvas((s) => s.frames);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();

  const agents: FleetAgent[] = nodeIds
    .filter((id) => nodes[id]?.kind === "terminal")
    .map((id) => {
      const payload = nodes[id].payload;
      const status = statuses[id] ?? { state: "stopped" as const };
      const state = fleetStateOf(status, activities[id]);
      return {
        id,
        name: payload.name || AGENTS[payload.agent].label,
        agent: payload.agent,
        state,
        since: state === "stopped" ? undefined : activities[id]?.since,
      };
    });
  const counts = filterCounts(agents);
  const sections = fleetSections(agents, frames, filter);

  return (
    <aside className="pointer-events-auto absolute right-[72px] top-1/2 z-30 flex max-h-[70vh] w-[300px] -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl border border-ov-line bg-ov-surface-2 p-3 shadow-ov">
      <p className="ov-label">Flotte</p>
      <div className="flex flex-wrap gap-1.5">
        {FLEET_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]",
              id === filter ? "border-ov-accent bg-ov-accent-soft text-ov-text" : "border-ov-line text-ov-text-2 hover:text-ov-text",
            )}
          >
            {label}
            <span className="font-mono">{counts[id]}</span>
          </button>
        ))}
      </div>
      {sections.length === 0 && <p className="py-4 text-center text-xs text-ov-text-2">Aucun agent</p>}
      {sections.map((section) => (
        <section key={section.id ?? "outside"} className="flex flex-col gap-1">
          <header className="flex items-center gap-1.5 px-1 text-[11px]">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: section.color ?? "var(--ov-idle)" }} />
            <span className="font-semibold tracking-[0.08em] text-ov-text uppercase">{section.name}</span>
            <span className="ml-auto font-mono text-ov-text-2">
              {countsText(section.agents.length, section.agents.filter((a) => a.state === "working").length)}
            </span>
          </header>
          {section.agents.map((a) => {
            const meta = AGENTS[a.agent];
            return (
              <div key={a.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ov-hover">
                <button type="button" onClick={() => focusNode(a.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-md"
                    style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: meta.tint }}
                  >
                    <meta.Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ov-text">
                    {a.name} <span className="text-ov-text-2">{meta.label}</span>
                  </span>
                </button>
                <StatusPill status={statuses[a.id] ?? { state: "stopped" }} activity={activities[a.id]} indigo={meta.tint === INDIGO} />
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ov-text-2">
                  {a.since !== undefined ? formatDuration(now - a.since) : ""}
                </span>
                <button
                  type="button"
                  title="Fermer"
                  aria-label={`Fermer ${a.name}`}
                  onClick={() => requestClose(a.id)}
                  className="hidden size-5 place-items-center rounded text-ov-text-2 hover:bg-ov-card hover:text-ov-text group-hover:grid"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
```

`src/shell/RightRail.tsx` :

```tsx
import { Network } from "lucide-react";
import { FleetPanel } from "@/fleet/FleetPanel";
import { uiStore, useUi } from "@/store/ui";
import { RoundButton } from "./ui";

/** The vertical pill on the right (spec habillage §5.5); its only entry for now is the fleet. */
export function RightRail() {
  const open = useUi((s) => s.fleetOpen);
  return (
    <>
      <nav className="pointer-events-auto absolute right-4 top-1/2 z-30 flex w-11 -translate-y-1/2 flex-col items-center gap-1 rounded-full border border-ov-line bg-ov-surface py-2 shadow-ov">
        <RoundButton label="Flotte" active={open} onClick={() => uiStore.getState().setFleetOpen(!open)}>
          <Network />
        </RoundButton>
      </nav>
      {open && <FleetPanel />}
    </>
  );
}
```

`src/shell/ProjectView.tsx` : importer `RightRail` et l'ajouter après `<LeftRail … />`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/fleet/fleetView.test.ts src/canvas/canvasStore.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit` puis `pnpm test` puis `pnpm build`
Expected: aucune erreur, tous les tests passent, build propre.

- [ ] **Step 5: Check in the app**

Le rail droit montre « Flotte » ; un clic ouvre le panneau à gauche du rail : filtres avec compteurs, sections par groupe (point, nom en majuscules, compteurs) puis « Hors groupe », lignes avec logo, prénom, agent, pastille et durée ; un clic sur une ligne centre la vue à 100 % sur le terminal et lui donne le clavier ; au survol, « Fermer » demande confirmation pour un agent en marche ; les filtres EN COURS et ATTEND suivent les états en direct.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(fleet): right rail and fleet panel with live states and durations"
```

---

## Vérifications manuelles de Mathieu (J3)

- Un Claude passe EN COURS pendant un tour, ATTEND sur une demande d'autorisation, PRÊT à la fin ; aucune ligne de hook visible dans Claude.
- Codex (s'il est installé) repasse PRÊT à la fin de son tour.
- Un Shell qui affiche beaucoup passe EN COURS puis PRÊT.
- Panneau Flotte : filtres, durées (« 12 min »), clic sur un agent, Fermer au survol.
- Lancé depuis l'Explorateur comme depuis une session Claude Code : « Reprendre » retrouve bien la conversation (marqueurs de session retirés).
