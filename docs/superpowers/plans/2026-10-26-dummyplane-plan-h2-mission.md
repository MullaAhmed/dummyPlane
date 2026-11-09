# dummyPlane H2 — La mission de l'orchestrateur (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'orchestrateur devient un manager IA : une session Claude dans son nœud, qui propose un plan ; au feu vert, dummyPlane forme l'équipe (worktree et branche par agent), envoie à chacun sa sous-tâche, relaie les évènements et les comptes rendus, fusionne les branches et clôt la mission.

**Architecture:** Rust gagne le rôle d'une session Claude (`agent` / `orchestrator` : consigne, interdiction d'éditer) et les commandes git d'une mission (`mission.rs` : worktrees, fusion, nettoyage). L'interface héberge le terminal de l'orchestrateur dans son nœud (sa session vit dans `OrchestratorPayload.session`), garde la mission dans `OrchestratorPayload.mission`, répond aux outils de l'orchestrateur par le routeur MCP de H1, forme l'équipe (`src/mission/launch.ts`) et tape les évènements dans le terminal de l'orchestrateur (`src/mission/events.ts`). Le panneau de la mission est sous le terminal.

**Tech Stack:** Rust (std::process git, serde, tempfile en test), Tauri 2 commandes, React 19 / TypeScript, Zustand 5, xterm 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-dummyplane-orchestrateur-manager-design.md` (jalon H2 : §3, §4.2 rôle, §4.3, §4.4 `rendre_compte`, §6, §7, §9 ; amendée le 2026-10-26 : `prolonger` / `interrompre` / `reattribuer` et la minuterie passent en H3).

## Global Constraints

- Aucune dépendance ajoutée (Rust ni npm).
- Jamais de fusion dans la branche de l'utilisateur, jamais de `push`, jamais de `--force` (worktree ou branche) (spec §7.6, §7.7).
- Branches `dummyplane/<mission>` et `dummyplane/<mission>-<prénom>` ; worktrees dans `<parent du dépôt>/<dossier>.worktrees/` (spec §7.4).
- Un agent est « prêt » quand son processus tourne et qu'il est inactif depuis 2 s ; au bout de 60 s, la sous-tâche est tapée quand même (spec §7.3).
- L'invite « trust this folder » de Claude n'est acceptée que dans les worktrees qu'dummyPlane vient de créer (spec §7.3 amendée).
- Textes visibles et messages des outils en français ; identifiants, commits et commentaires de code en anglais. Les textes destinés à l'IA disent « l'utilisateur », pas un prénom (dummyPlane est un produit open source).
- Fichiers commités en CRLF ou LF selon le fichier existant : les scripts d'édition préservent les fins de ligne.
- Vérification réelle uniquement sur le profil `dev.dummyplane.probe`, avec un dépôt git jetable du scratchpad ; jamais dans un vrai dépôt de l'utilisateur.

## Review Focus

1. Un agent relié relancé dans son worktree ne reprend jamais sa conversation d'avant (nouvel identifiant de session, étapes effacées), et un agent qui n'était pas encore affiché démarre quand même (Task 5).
2. Un double clic sur « Lancer la mission », ou un lancement pendant qu'un autre est en cours, ne forme qu'une équipe (Task 5).
3. Les évènements pour un orchestrateur qui attend une réponse ou qui est arrêté sont gardés et partent dans l'ordre quand il redevient libre ; aucun n'est tapé dans un terminal arrêté (Task 4).
4. Un échec git (pas un dépôt, branche existante, dépôt sans commit) ramène la mission à son plan avec une erreur lisible dans le panneau et pour l'orchestrateur, sans agent lancé (Task 5).
5. Un `rendre_compte` d'un agent hors mission ou après la fin, un outil d'orchestrateur appelé par un agent, un outil d'agent appelé par l'orchestrateur : réponse lisible, rien ne change (Task 6).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src-tauri/src/pty/shell.rs` | `Role` (agent, orchestrateur) dans `ClaudeLaunch`. |
| `src-tauri/src/agents/claude_settings.rs` | Un orchestrateur reçoit `permissions.deny` = `Edit`, `Write`, `NotebookEdit`. |
| `src-tauri/src/agents/prompts.rs` | La consigne `ORCHESTRATOR` et `for_role`. |
| `src-tauri/src/commands/agents.rs`, `src-tauri/src/commands/pty.rs` | `hooks_for` reçoit le rôle de la session. |
| `src-tauri/src/mission.rs` (créé) | Git d'une mission : `slug`, `prepare`, `add_agent`, `merge_agent`, `cleanup`. |
| `src-tauri/src/commands/mission.rs` (créé), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` | Les commandes `mission_prepare`, `mission_add_agent`, `mission_merge`, `mission_cleanup`. |
| `src/ipc/pty.ts` | `ClaudeLaunch.role`. |
| `src/ipc/mission.ts` (créé) | Les commandes de mission. |
| `src/nodes/types.ts` | `TerminalPayload.role`, `OrchestratorPayload.session` et `.mission`. |
| `src/store/nodes.ts` | `sessionOf`, `updateSession`. |
| `src/nodes/terminal/launch.ts` | Le rôle dans la demande de lancement ; `orchestratorSession`. |
| `src/nodes/terminal/registry.ts` | Sessions d'orchestrateur ; `terminalText`, `quietFor` ; `relaunchTerminal` sans affichage préalable. |
| `src/nodes/terminal/useTerminalHost.ts` (créé) | Montage d'un xterm dans un nœud (terminal ou orchestrateur). |
| `src/nodes/terminal/TerminalNode.tsx` | Utilise `useTerminalHost`. |
| `src/nodes/orchestrator/OrchestratorNode.tsx` | En-tête, terminal de la session, panneau de la mission. |
| `src/nodes/orchestrator/field.ts` (supprimé) | Remplacé par le terminal. |
| `src/canvas/nodeElement.ts` | Orchestrateur 640 × 760. |
| `src/canvas/arrive.ts` | L'arrivée sur un orchestrateur donne le clavier à son terminal. |
| `src/commands/catalog/orchestrator.ts` | « Coller » colle dans le terminal de l'orchestrateur. |
| `src/fleet/orchestrators.ts`, `src/fleet/terminals.ts` | Un orchestrateur naît avec sa session ; sa copie aussi, neuve. |
| `src/fleet/groups.ts` | `launchGroup` accepte prénoms, dossiers et panthéon, et rend le groupe créé. |
| `src/mission/mission.ts` (créé) | Modèle de la mission (pur) : types, lecture, validation du plan. |
| `src/mission/store.ts` (créé) | Mission d'un orchestrateur, membres, agents reliés. |
| `src/mission/events.ts` (créé) | File des évènements tapés dans l'orchestrateur ; surveillance des membres. |
| `src/mission/ready.ts` (créé) | Quand un agent est prêt ; l'invite de confiance. |
| `src/mission/launch.ts` (créé) | Feu vert, fusion, fin, nettoyage. |
| `src/mcp/orchestratorTools.ts` (créé) | Les outils de l'orchestrateur. |
| `src/mcp/agentTools.ts`, `src/mcp/router.ts` | `rendre_compte` en mission ; routage selon le nœud. |
| `src/mission/MissionPanel.tsx` (créé) | Réglages, plan et feu vert, équipe, bilan et nettoyage. |
| `src/app/boot.ts` | Installe la surveillance des évènements. |

---

### Task 1: Le rôle d'une session Claude

**Files:**
- Modify: `src-tauri/src/pty/shell.rs` (`ClaudeLaunch`, tests)
- Modify: `src-tauri/src/agents/claude_settings.rs`
- Modify: `src-tauri/src/agents/prompts.rs`
- Modify: `src-tauri/src/commands/agents.rs` (`hooks_for`)
- Modify: `src-tauri/src/commands/pty.rs` (`pty_spawn`)

**Interfaces:**
- Produces: `pty::shell::Role { Agent (défaut), Orchestrator }`, sérialisé `"agent"` / `"orchestrator"`, champ `ClaudeLaunch.role` (`#[serde(default)]`) ; `claude_settings::settings_json(url, role)`, `claude_settings::write(dir, node_id, url, role)` ; `prompts::ORCHESTRATOR`, `prompts::for_role(role) -> &'static str` ; `agents::hooks_for(app, node_id, agent, role)`.

- [ ] **Step 1: Write the failing tests**

Dans `shell.rs`, module de tests : le helper `claude()` construit `ClaudeLaunch { mode, session_id, title, role: Role::Agent }`, et ce test s'ajoute (sur le modèle des tests de désérialisation existants, mêmes valeurs de `shell`) :

```rust
    #[test]
    fn reads_the_role_of_a_claude_session_an_agent_by_default() {
        let spec = |claude: serde_json::Value| -> SpawnSpec {
            serde_json::from_value(serde_json::json!({
                "cwd": "C:/code", "shell": "cmd", "agent": "claude", "command": "", "claude": claude
            }))
            .unwrap()
        };
        let orchestrator = spec(serde_json::json!({ "mode": "new", "sessionId": SESSION, "title": "t", "role": "orchestrator" }));
        assert_eq!(orchestrator.claude.unwrap().role, Role::Orchestrator);
        let older = spec(serde_json::json!({ "mode": "new", "sessionId": SESSION, "title": "t" }));
        assert_eq!(older.claude.unwrap().role, Role::Agent);
    }
```

Dans `claude_settings.rs`, les appels existants passent `Role::Agent`, et :

```rust
    #[test]
    fn an_orchestrator_may_not_edit_files() {
        let manager = settings_json(URL, Role::Orchestrator);
        assert_eq!(manager["permissions"]["allow"], json!(["mcp__dummyplane"]));
        assert_eq!(manager["permissions"]["deny"], json!(["Edit", "Write", "NotebookEdit"]));
        assert!(settings_json(URL, Role::Agent)["permissions"].get("deny").is_none());
    }
```

Dans `prompts.rs` :

```rust
    #[test]
    fn each_role_gets_its_own_instructions() {
        assert_eq!(for_role(Role::Agent), AGENT);
        assert_eq!(for_role(Role::Orchestrator), ORCHESTRATOR);
        for tool in ["mission", "proposer_plan", "equipe", "lire_sortie", "ecrire", "fusionner", "terminer"] {
            assert!(ORCHESTRATOR.contains(tool), "{tool}");
        }
        assert!(ORCHESTRATOR.contains("[dummyPlane]"));
        assert!(!ORCHESTRATOR.contains("Mathieu"));
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test --lib role 2>&1 | tail -20`
Expected: FAIL — `Role` introuvable, `settings_json` attend 1 argument, `for_role` introuvable.

- [ ] **Step 3: Write the role**

`shell.rs`, avant `ClaudeLaunch` :

```rust
/// What a Claude session is for (spec orchestrateur §4.2): an agent, or the
/// orchestrator that manages a team without coding.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    #[default]
    Agent,
    Orchestrator,
}
```

et dans `ClaudeLaunch`, après `title` :

```rust
    /// Interfaces of before the orchestrator send none: an agent.
    #[serde(default)]
    pub role: Role,
```

`claude_settings.rs` (import `use crate::pty::shell::Role;`) :

```rust
pub fn settings_json(url: &str, role: Role) -> Value {
    let hook = json!({ "type": "http", "url": url, "timeout": 2 });
    let every = json!([{ "hooks": [hook] }]);
    // dummyPlane's own tools never ask (spec orchestrateur §4.2).
    let mut permissions = json!({ "allow": ["mcp__dummyplane"] });
    if role == Role::Orchestrator {
        // A manager does not code itself.
        permissions["deny"] = json!(["Edit", "Write", "NotebookEdit"]);
    }
    json!({
        "hooks": {
            "UserPromptSubmit": every,
            "PostToolUse": every,
            "Stop": every,
            "StopFailure": every,
            "SessionEnd": every,
            "SubagentStart": every,
            "SubagentStop": every,
            "Notification": [{ "matcher": NOTIFICATIONS, "hooks": [hook] }],
        },
        "permissions": permissions,
    })
}
```

`write(dir, node_id, url, role)` passe `role` à `settings_json`.

`prompts.rs` (import `use crate::pty::shell::Role;`) :

```rust
pub const ORCHESTRATOR: &str = "Tu es l'orchestrateur d'une équipe d'agents Claude dans dummyPlane, un canvas de terminaux. Tu es le manager : tu ne codes pas toi-même (tu ne peux pas modifier de fichier) ; tu lis le dépôt, tu découpes, tu distribues, tu suis et tu fusionnes. Le serveur MCP « dummyplane » te donne tes outils :
- mission : les réglages de la mission (budget global, nombre maximal d'agents), son état, sa branche, et les agents Claude reliés disponibles.
- proposer_plan : ton plan — un nom court de mission, la tâche, et les sous-tâches (titre, consigne, agent : prénom d'un agent relié ou « nouveau », budget en minutes). Le plan attend le feu vert de l'utilisateur (« Lancer la mission » dans le panneau de l'orchestrateur) : tu ne lances rien toi-même.
- equipe : où en est chaque agent (état, étapes, temps, compte rendu).
- lire_sortie : la fin du terminal d'un agent.
- ecrire : tape un message dans le terminal d'un agent (relance, précision). Jamais pour répondre à un dialogue d'autorisation : celui-là est pour l'utilisateur, signale-le-lui.
- fusionner : fusionne dans la branche de la mission les branches des agents qui ont rendu compte « termine » ; te dit les conflits.
- terminer : clôt la mission avec ton bilan.
Quand l'utilisateur te donne une tâche : appelle mission, lis le dépôt, découpe en sous-tâches aussi indépendantes que possible, chacune avec un résultat vérifiable et une seule par agent, appelle proposer_plan, puis dis à l'utilisateur que le plan attend son feu vert.
dummyPlane tape dans ton terminal des lignes qui commencent par [dummyPlane] : feu vert, comptes rendus des agents, agent qui attend l'utilisateur, agent arrêté. Réagis-y : suis ton équipe avec equipe et lire_sortie, relance avec ecrire.
Quand les agents ont rendu compte, appelle fusionner ; en cas de conflit, demande à l'agent concerné de fusionner la branche de la mission dans la sienne et de résoudre, puis rappelle fusionner. Fais vérifier le résultat (tests) par un agent, puis appelle terminer avec ton bilan. Ne fusionne jamais dans la branche de l'utilisateur et ne pousse jamais : c'est lui qui le fait.";

/// The instructions of a session's role.
pub fn for_role(role: Role) -> &'static str {
    match role {
        Role::Agent => AGENT,
        Role::Orchestrator => ORCHESTRATOR,
    }
}
```

`commands/agents.rs` : `pub fn hooks_for(app: &AppHandle, node_id: &str, agent: Agent, role: Role) -> AgentHooks`, qui passe `role` à `claude_settings::write` et `prompts::for_role(role)` à `mcp_files::write` (au lieu de `prompts::AGENT`). `commands/pty.rs`, dans `pty_spawn` :

```rust
    let role = spec.claude.as_ref().map(|c| c.role).unwrap_or_default();
    let hooks = agents::hooks_for(&app, &node_id, spec.agent, role);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib 2>&1 | grep -E "test result|FAILED|panicked" ; cargo clippy --quiet ; cargo fmt --check`
Expected: tous les tests passent, clippy et fmt muets.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty/shell.rs src-tauri/src/agents/claude_settings.rs src-tauri/src/agents/prompts.rs src-tauri/src/commands/agents.rs src-tauri/src/commands/pty.rs
git commit -m "feat(mcp): a Claude session has a role, the orchestrator manages without editing files"
```

---

### Task 2: Le git d'une mission

**Files:**
- Create: `src-tauri/src/mission.rs`
- Create: `src-tauri/src/commands/mission.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod mission;`), `src-tauri/src/lib.rs` (`mod mission;`, quatre commandes)

**Interfaces:**
- Produces (Rust) : `mission::{slug, prepare, add_agent, merge_agent, cleanup}`, `Worktree { slug, branch, path }`, `Merge::{Merged, Empty, Conflict { files }}` (sérialisé `{ kind: "merged" | "empty" | "conflict", files? }`), `MergeReport { merge, uncommitted }`, `Cleanup { removed, kept }`.
- Produces (commandes) : `mission_prepare(project, name) -> Worktree`, `mission_add_agent(project, mission, agent) -> Worktree` (`mission` = le slug de la mission, `agent` = le prénom), `mission_merge(mission, agent, branch) -> MergeReport` (`mission`, `agent` = chemins des worktrees), `mission_cleanup(project, mission, agents: string[]) -> Cleanup` (`agents` = prénoms). Les erreurs sont des `AppError::InvalidInput` au texte français.

- [ ] **Step 1: Write the failing tests** — `mission.rs` ne contient d'abord que son module de tests (il échoue à la compilation).

```rust
#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn run(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, file: &str, content: &str, message: &str) {
        std::fs::write(dir.join(file), content).unwrap();
        run(dir, &["add", file]);
        run(dir, &["commit", "-q", "-m", message]);
    }

    /// A repository `proj` with one commit on `main`, inside a temporary parent folder.
    fn project() -> Option<(tempfile::TempDir, PathBuf)> {
        if Command::new("git").arg("--version").output().is_err() {
            return None; // git is not installed on this machine
        }
        let parent = tempfile::tempdir().unwrap();
        let proj = parent.path().join("proj");
        std::fs::create_dir(&proj).unwrap();
        run(&proj, &["init", "-q", "-b", "main"]);
        for (key, value) in [("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false"), ("core.autocrlf", "false")] {
            run(&proj, &["config", key, value]);
        }
        commit(&proj, "a.txt", "a\n", "init");
        Some((parent, proj))
    }

    fn same(a: impl AsRef<Path>, b: impl AsRef<Path>) -> bool {
        std::fs::canonicalize(a).unwrap() == std::fs::canonicalize(b).unwrap()
    }

    #[test]
    fn slugs_are_safe_for_branches_and_folders() {
        assert_eq!(slug("Ajoute l'Authentification !"), "ajoute-l-authentification");
        assert_eq!(slug("Athéna 2"), "athena-2");
        assert_eq!(slug("Œuvre complète"), "oeuvre-complete");
        assert_eq!(slug("Ōkuninushi"), "okuninushi");
        assert_eq!(slug("  --  "), "mission");
        let long = slug(&"a b ".repeat(30));
        assert!(long.len() <= 40 && !long.ends_with('-'), "{long}");
    }

    #[test]
    fn prepares_the_mission_branch_and_worktree_beside_the_project() {
        let Some((parent, proj)) = project() else { return };
        let tree = prepare(&proj, "Ajoute l'Authentification").unwrap();
        assert_eq!(tree.slug, "ajoute-l-authentification");
        assert_eq!(tree.branch, "dummyplane/ajoute-l-authentification");
        assert!(same(&tree.path, parent.path().join("proj.worktrees").join("ajoute-l-authentification")));
        assert!(Path::new(&tree.path).join("a.txt").exists());
        assert_eq!(run(Path::new(&tree.path), &["branch", "--show-current"]), tree.branch);
        // The user's folder is untouched: same branch, nothing to commit.
        assert_eq!(run(&proj, &["branch", "--show-current"]), "main");
        assert_eq!(run(&proj, &["status", "--porcelain"]), "");
    }

    #[test]
    fn refuses_a_mission_that_exists_or_a_folder_outside_git() {
        let Some((parent, proj)) = project() else { return };
        prepare(&proj, "auth").unwrap();
        assert!(prepare(&proj, "auth").unwrap_err().contains("existe déjà"));
        let plain = parent.path().join("plain");
        std::fs::create_dir(&plain).unwrap();
        assert_eq!(prepare(&plain, "auth").unwrap_err(), "Le dossier du projet n'est pas un dépôt git.");
    }

    #[test]
    fn gives_each_agent_a_branch_from_the_missions() {
        let Some((parent, proj)) = project() else { return };
        let mission = prepare(&proj, "auth").unwrap();
        commit(Path::new(&mission.path), "m.txt", "m\n", "mission base");
        let agent = add_agent(&proj, &mission.slug, "Athéna").unwrap();
        assert_eq!(agent.slug, "auth-athena");
        assert_eq!(agent.branch, "dummyplane/auth-athena");
        assert!(same(&agent.path, parent.path().join("proj.worktrees").join("auth-athena")));
        assert!(Path::new(&agent.path).join("m.txt").exists());
    }

    #[test]
    fn merges_an_agents_commits_into_the_mission() {
        let Some((_parent, proj)) = project() else { return };
        let mission = prepare(&proj, "auth").unwrap();
        let athena = add_agent(&proj, &mission.slug, "Athéna").unwrap();
        let apollon = add_agent(&proj, &mission.slug, "Apollon").unwrap();
        commit(Path::new(&athena.path), "login.txt", "login\n", "login");
        std::fs::write(Path::new(&apollon.path).join("draft.txt"), "x").unwrap();
        let m = Path::new(&mission.path);
        assert_eq!(
            merge_agent(m, Path::new(&athena.path), &athena.branch).unwrap(),
            MergeReport { merge: Merge::Merged, uncommitted: false }
        );
        assert!(m.join("login.txt").exists());
        assert_eq!(
            merge_agent(m, Path::new(&apollon.path), &apollon.branch).unwrap(),
            MergeReport { merge: Merge::Empty, uncommitted: true }
        );
    }

    #[test]
    fn a_conflict_is_undone_and_its_files_named() {
        let Some((_parent, proj)) = project() else { return };
        let mission = prepare(&proj, "auth").unwrap();
        let athena = add_agent(&proj, &mission.slug, "Athéna").unwrap();
        let m = Path::new(&mission.path);
        commit(m, "a.txt", "mission\n", "mission side");
        commit(Path::new(&athena.path), "a.txt", "athena\n", "agent side");
        let report = merge_agent(m, Path::new(&athena.path), &athena.branch).unwrap();
        assert_eq!(report.merge, Merge::Conflict { files: vec!["a.txt".into()] });
        assert_eq!(run(m, &["status", "--porcelain"]), "");
        assert_eq!(std::fs::read_to_string(m.join("a.txt")).unwrap().trim_end(), "mission");
    }

    #[test]
    fn cleanup_removes_merged_worktrees_and_keeps_the_branches() {
        let Some((parent, proj)) = project() else { return };
        let mission = prepare(&proj, "auth").unwrap();
        let athena = add_agent(&proj, &mission.slug, "Athéna").unwrap();
        let apollon = add_agent(&proj, &mission.slug, "Apollon").unwrap();
        commit(Path::new(&athena.path), "login.txt", "login\n", "login");
        commit(Path::new(&apollon.path), "api.txt", "api\n", "api");
        let m = Path::new(&mission.path);
        merge_agent(m, Path::new(&athena.path), &athena.branch).unwrap();
        let names = vec!["Athéna".to_string(), "Apollon".to_string()];
        let first = cleanup(&proj, &mission.slug, &names).unwrap();
        assert_eq!(first.removed, vec!["auth-athena".to_string()]);
        assert_eq!(first.kept, vec!["auth-apollon (branche non fusionnée)".to_string()]);
        assert!(m.exists());
        merge_agent(m, Path::new(&apollon.path), &apollon.branch).unwrap();
        let second = cleanup(&proj, &mission.slug, &names).unwrap();
        assert_eq!(second.removed, vec!["auth-apollon".to_string(), "auth".to_string()]);
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
        let branches = run(&proj, &["branch", "--list", "dummyplane/*"]);
        assert!(branches.contains("dummyplane/auth-apollon") && branches.contains("dummyplane/auth"));
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test --lib mission 2>&1 | tail -20`
Expected: FAIL à la compilation — `prepare`, `slug`… introuvables.

- [ ] **Step 3: Write the mission's git**

`src-tauri/src/mission.rs`, au-dessus des tests :

```rust
//! Worktrees and branches of a mission (spec orchestrateur §7.4, §7.6, §7.7).
//! dummyPlane works beside the user's folder, never in their branch: no push,
//! no force.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::process::hide_window;

/// A worktree dummyPlane made, on a branch of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub slug: String,
    pub branch: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Merge {
    Merged,
    /// The agent's branch has no commit the mission's lacks.
    Empty,
    /// The merge was undone; these files conflicted.
    Conflict { files: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub merge: Merge,
    /// The agent left changes uncommitted in its worktree: they are not merged.
    pub uncommitted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub removed: Vec<String>,
    pub kept: Vec<String>,
}

const MAX_SLUG: usize = 40;

/// Latin letters with accents or macrons, as plain ASCII: "Athéna" → "athena", "Fūjin" → "fujin".
fn fold(c: char) -> Option<&'static str> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => "a",
        'ç' => "c",
        'è' | 'é' | 'ê' | 'ë' | 'ē' => "e",
        'ì' | 'í' | 'î' | 'ï' | 'ī' => "i",
        'ñ' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' => "o",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' => "u",
        'ý' | 'ÿ' => "y",
        'œ' => "oe",
        'æ' => "ae",
        _ => return None,
    })
}

/// A name made safe for a branch and a folder: lowercase ASCII and dashes.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if let Some(plain) = fold(c) {
            out.push_str(plain);
        } else if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let mut cut: String = out.chars().take(MAX_SLUG).collect();
    while cut.ends_with('-') {
        cut.pop();
    }
    if cut.is_empty() { "mission".into() } else { cut }
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = hide_window(Command::new("git").arg("-C").arg(dir).args(args))
        .output()
        .map_err(|err| format!("git introuvable : {err}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// The repository's root, and the folder of its worktrees: `<parent>/<folder>.worktrees`.
fn locate(project: &Path) -> Result<(PathBuf, PathBuf), String> {
    let root = git(project, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "Le dossier du projet n'est pas un dépôt git.".to_string())?;
    // git answers with forward slashes, even on Windows.
    let root = PathBuf::from(if cfg!(windows) { root.replace('/', "\\") } else { root });
    let name = root
        .file_name()
        .ok_or("Le dépôt n'a pas de nom de dossier.")?
        .to_string_lossy()
        .into_owned();
    let parent = root.parent().ok_or("Le dépôt n'a pas de dossier parent.")?;
    let dir = parent.join(format!("{name}.worktrees"));
    Ok((root, dir))
}

fn add_worktree(root: &Path, dir: &Path, slug: &str, from: &str) -> Result<Worktree, String> {
    let branch = format!("dummyplane/{slug}");
    if git(root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok() {
        return Err(format!("La branche {branch} existe déjà."));
    }
    let path = dir.join(slug);
    if path.exists() {
        return Err(format!("Le dossier {} existe déjà.", path.display()));
    }
    let shown = path.to_string_lossy().into_owned();
    git(root, &["worktree", "add", "-b", &branch, &shown, from])?;
    Ok(Worktree { slug: slug.into(), branch, path: shown })
}

/// The mission's branch, from the project's current commit, and its worktree (where merges happen).
pub fn prepare(project: &Path, name: &str) -> Result<Worktree, String> {
    let (root, dir) = locate(project)?;
    add_worktree(&root, &dir, &slug(name), "HEAD")
}

/// An agent's branch, from the mission's, and its worktree. `mission` is the mission's slug.
pub fn add_agent(project: &Path, mission: &str, agent: &str) -> Result<Worktree, String> {
    let (root, dir) = locate(project)?;
    let name = format!("{mission}-{}", slug(agent));
    add_worktree(&root, &dir, &name, &format!("dummyplane/{mission}"))
}

/// Merges an agent's branch into the mission's, in the mission's worktree; a conflict is undone.
pub fn merge_agent(mission: &Path, agent: &Path, branch: &str) -> Result<MergeReport, String> {
    let uncommitted = !git(agent, &["status", "--porcelain"]).unwrap_or_default().is_empty();
    let ahead = git(mission, &["rev-list", "--count", &format!("HEAD..{branch}")])?;
    if ahead == "0" {
        return Ok(MergeReport { merge: Merge::Empty, uncommitted });
    }
    match git(mission, &["merge", "--no-ff", "--no-edit", branch]) {
        Ok(_) => Ok(MergeReport { merge: Merge::Merged, uncommitted }),
        Err(err) => {
            let files: Vec<String> = git(mission, &["diff", "--name-only", "--diff-filter=U"])
                .unwrap_or_default()
                .lines()
                .map(str::to_string)
                .collect();
            if files.is_empty() {
                return Err(err);
            }
            let _ = git(mission, &["merge", "--abort"]);
            Ok(MergeReport { merge: Merge::Conflict { files }, uncommitted })
        }
    }
}

/// Never forced: a worktree with uncommitted changes stays.
fn remove_worktree(root: &Path, name: String, path: &Path, done: &mut Cleanup) {
    match git(root, &["worktree", "remove", &path.to_string_lossy()]) {
        Ok(_) => done.removed.push(name),
        Err(_) => done.kept.push(format!("{name} (changements non commités)")),
    }
}

/// Removes the worktrees whose branch is merged into the mission's, then the
/// mission's own when none is left; the branches stay for the user.
pub fn cleanup(project: &Path, mission: &str, agents: &[String]) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let merged = git(&root, &["branch", "--format=%(refname:short)", "--merged", &format!("dummyplane/{mission}")])?;
    let merged: Vec<&str> = merged.lines().map(str::trim).collect();
    let mut done = Cleanup::default();
    for agent in agents {
        let name = format!("{mission}-{}", slug(agent));
        let path = dir.join(&name);
        if !path.exists() {
            continue;
        }
        if merged.contains(&format!("dummyplane/{name}").as_str()) {
            remove_worktree(&root, name, &path, &mut done);
        } else {
            done.kept.push(format!("{name} (branche non fusionnée)"));
        }
    }
    let path = dir.join(mission);
    if path.exists() && done.kept.is_empty() {
        remove_worktree(&root, mission.to_string(), &path, &mut done);
    }
    Ok(done)
}
```

`src-tauri/src/commands/mission.rs` :

```rust
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::mission::{self, Cleanup, MergeReport, Worktree};

/// Git can take seconds on a large repository: off the async runtime.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
        .map_err(AppError::InvalidInput)
}

/// The mission's branch and worktree (spec orchestrateur §7.4).
#[tauri::command]
pub async fn mission_prepare(project: String, name: String) -> AppResult<Worktree> {
    blocking(move || mission::prepare(Path::new(&project), &name)).await
}

#[tauri::command]
pub async fn mission_add_agent(project: String, mission: String, agent: String) -> AppResult<Worktree> {
    blocking(move || mission::add_agent(Path::new(&project), &mission, &agent)).await
}

/// `mission` and `agent` are the worktrees' paths (spec orchestrateur §7.6).
#[tauri::command]
pub async fn mission_merge(mission: String, agent: String, branch: String) -> AppResult<MergeReport> {
    blocking(move || mission::merge_agent(Path::new(&mission), Path::new(&agent), &branch)).await
}

/// « Nettoyer la mission » (spec orchestrateur §7.7).
#[tauri::command]
pub async fn mission_cleanup(project: String, mission: String, agents: Vec<String>) -> AppResult<Cleanup> {
    blocking(move || mission::cleanup(Path::new(&project), &mission, &agents)).await
}
```

`commands/mod.rs` : `pub mod mission;`. `lib.rs` : `mod mission;` à côté de `mod git;`, et dans `generate_handler!` : `commands::mission::mission_prepare, commands::mission::mission_add_agent, commands::mission::mission_merge, commands::mission::mission_cleanup,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib 2>&1 | grep -E "test result|FAILED|panicked" ; cargo clippy --quiet ; cargo fmt`
Expected: tous les tests passent ; clippy muet.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mission.rs src-tauri/src/commands/mission.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(mission): worktrees, merges and cleanup of a mission's branches"
```

---
### Task 3: La session Claude de l'orchestrateur, dans son nœud

**Files:**
- Modify: `src/ipc/pty.ts` (`ClaudeLaunch.role`)
- Modify: `src/nodes/types.ts`, `src/nodes/types.test.ts`
- Modify: `src/store/nodes.ts`, `src/store/nodes.test.ts`
- Modify: `src/nodes/terminal/launch.ts`, `src/nodes/terminal/launch.test.ts`
- Modify: `src/nodes/terminal/registry.ts`
- Create: `src/nodes/terminal/useTerminalHost.ts`
- Modify: `src/nodes/terminal/TerminalNode.tsx`
- Modify: `src/nodes/orchestrator/OrchestratorNode.tsx`, `src/nodes/orchestrator/OrchestratorNode.test.tsx`
- Delete: `src/nodes/orchestrator/field.ts`, `src/nodes/orchestrator/field.test.ts`
- Modify: `src/canvas/nodeElement.ts` (+ `nodeElement.test.ts`, `src/fleet/groupLayout.test.ts`, `src/fleet/placement.test.ts`)
- Modify: `src/fleet/orchestrators.ts`, `src/fleet/terminals.ts` ; Create: `src/fleet/orchestrators.test.ts`
- Modify: `src/canvas/arrive.ts`, `src/canvas/arrive.test.ts`
- Modify: `src/commands/catalog/orchestrator.ts`, `src/commands/catalog/orchestrator.test.ts`

**Interfaces:**
- Consumes: `ClaudeLaunch.role` de Rust (Task 1), sérialisé `"agent"` / `"orchestrator"`.
- Produces: `TerminalPayload.role?: "orchestrator"` ; `OrchestratorPayload { name: string; session?: TerminalPayload }` ; `sessionOf(record: NodeRecord | undefined): TerminalPayload | undefined` et `updateSession(nodeId: string, patch: Partial<TerminalPayload>): void` (`@/store/nodes`) ; `orchestratorSession(name: string, options: { cwd: string; shell: ShellKind }): TerminalPayload` (`@/nodes/terminal/launch`) ; `useTerminalHost(nodeId, hostRef, ready)` ; `NODE_SIZE.orchestrator = { width: 640, height: 760 }`. L'élément racine du nœud garde `data-orchestrator={nodeId}`.

- [ ] **Step 1: Write the failing tests**

`src/nodes/types.test.ts` :

```ts
describe("an orchestrator's session (spec orchestrateur §6)", () => {
  const session = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s1", role: "orchestrator" };

  it("reads it back as the orchestrator's Claude session", () => {
    expect(readOrchestratorPayload({ name: "Chef", session })).toEqual({ name: "Chef", session });
    expect(readTerminalPayload(session)?.role).toBe("orchestrator");
  });

  it("drops a session that is not Claude's or cannot launch", () => {
    expect(readOrchestratorPayload({ name: "Chef", session: { ...session, agent: "shell" } })).toEqual({ name: "Chef" });
    expect(readOrchestratorPayload({ name: "Chef", session: 3 })).toEqual({ name: "Chef" });
  });
});
```

`src/nodes/terminal/launch.test.ts` (les attentes existantes sur `claude` gagnent `role: "agent"`) :

```ts
describe("orchestratorSession (spec orchestrateur §6)", () => {
  it("is Claude in the project folder, launched with the orchestrator's role", () => {
    const session = orchestratorSession("Chef", { cwd: "C:/code", shell: "pwsh" });
    expect(session).toMatchObject({ title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code", shell: "pwsh", role: "orchestrator" });
    expect(buildSpawnSpec(session, "new").claude).toEqual({ mode: "new", sessionId: session.claudeSessionId, title: "Chef", role: "orchestrator" });
    expect(buildSpawnSpec({ ...session, role: undefined }, "new").claude?.role).toBe("agent");
  });
});
```

`src/store/nodes.test.ts` (import `nodesStore, sessionOf, updateSession`) :

```ts
it("finds a node's Claude session, a terminal's own or an orchestrator's, and changes it where it lives", async () => {
  const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s1", role: "orchestrator" };
  await nodesStore.getState().create("t1", { workspaceId: "w1", kind: "terminal", payload: { ...payload, agent: "claude", claudeSessionId: "s0" } });
  await nodesStore.getState().create("o1", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef", session } });
  await nodesStore.getState().create("o2", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Ancien" } });
  expect(sessionOf(nodesStore.getState().nodes.o1)).toEqual(session);
  expect(sessionOf(nodesStore.getState().nodes.o2)).toBeUndefined();
  updateSession("o1", { claudeSessionId: "s2" });
  updateSession("t1", { claudeSessionId: "s3" });
  updateSession("o2", { claudeSessionId: "s4" });
  expect(nodesStore.getState().nodes.o1.payload).toEqual({ name: "Chef", session: { ...session, claudeSessionId: "s2" } });
  expect(sessionOf(nodesStore.getState().nodes.t1)?.claudeSessionId).toBe("s3");
  expect(nodesStore.getState().nodes.o2.payload).toEqual({ name: "Ancien" });
});
```

`src/nodes/orchestrator/OrchestratorNode.test.tsx` (le test de renommage existant reste ; le fichier simule le registre des terminaux) :

```tsx
vi.mock("../terminal/registry", () => ({ mountTerminal: vi.fn(), layoutTerminal: vi.fn(), markForAutostart: vi.fn(), relaunchTerminal: vi.fn() }));
// happy-dom may lack it; the node observes its terminal's host.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

it("gives an orchestrator of before its Claude session, and shows its terminal (spec orchestrateur §6)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("ancien", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OrchestratorNode nodeId="ancien" />));
  const session = sessionOf(nodesStore.getState().nodes.ancien)!;
  expect(session).toMatchObject({ name: "Chef", agent: "claude", role: "orchestrator" });
  expect(session.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(markForAutostart).toHaveBeenCalledWith("ancien");
  expect(mountTerminal).toHaveBeenCalledWith("ancien", expect.any(HTMLElement), session, 1);
  expect(host.querySelector('[data-orchestrator="ancien"] textarea')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
```

`src/fleet/orchestrators.test.ts` (créé) :

```ts
// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { markForAutostart } from "@/nodes/terminal/registry";
import { nodesStore, sessionOf } from "@/store/nodes";
import { addOrchestrator } from "./orchestrators";
import { adoptCopies } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn() }));

let scene: { id: string; isDeleted?: boolean; link?: string; customData?: object; type?: string; frameId?: string | null }[] = [];
beforeEach(() => {
  mockIPC(() => undefined);
  scene = [];
  const api = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene,
    updateScene: ({ elements }: { elements?: typeof scene }) => {
      if (elements) scene = elements;
    },
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI });
});

it("places an orchestrator with its Claude session, started when shown (spec orchestrateur §6)", async () => {
  await addOrchestrator("w1", { x: 0, y: 0 });
  const id = scene[0].id;
  expect(sessionOf(nodesStore.getState().nodes[id])).toMatchObject({ agent: "claude", role: "orchestrator", name: "Orchestrateur" });
  expect(markForAutostart).toHaveBeenCalledWith(id);
});

it("gives a copied orchestrator a session of its own, created when shown", async () => {
  const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", claudeSessionId: "s1", role: "orchestrator" as const };
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef", session } });
  scene = [{ id: "copie", type: "embeddable", customData: { kind: "orchestrator" }, frameId: null }];
  await adoptCopies("w1", [{ id: "copie", sourceId: "chef" }]);
  expect(nodesStore.getState().nodes.copie.payload).toEqual({ name: "Chef" });
});
```

`src/canvas/arrive.test.ts`, le test de l'orchestrateur devient :

```ts
  it("gives an orchestrator's terminal the keyboard, without the terminals' flash (spec orchestrateur §6)", () => {
    withScene(at100);
    const before = arrivalStore.getState();
    expect(arrive("chef")).toBe(true);
    frames.shift()!(0);
    expect(focusTerminal).toHaveBeenCalledWith("chef");
    expect(arrivalStore.getState()).toEqual(before);
  });
```

`src/commands/catalog/orchestrator.test.ts` : le module simulé `@/nodes/orchestrator/field` est remplacé par `vi.mock("@/nodes/terminal/registry", () => ({ pasteIntoTerminal: vi.fn() }))`, et l'attente de « Coller » devient :

```ts
    await find("orchestrator.paste").run(ring);
    expect(arrive).toHaveBeenCalledWith("chef");
    expect(pasteIntoTerminal).toHaveBeenCalledWith("chef", "texte");
```

Tailles : `nodeElement.test.ts` attend `{ x: -320, y: -380, width: 640, height: 760 }` (« makes a 640 × 760 orchestrator ») ; `groupLayout.test.ts` attend `{ x: 1000 - GROUP_GAP - 320, y: 880 }` ; `placement.test.ts` attend `{ left: 240, top: 110, width: 320, height: 380 }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/nodes src/store/nodes.test.ts src/fleet/orchestrators.test.ts src/canvas src/commands/catalog/orchestrator.test.ts src/fleet/groupLayout.test.ts src/fleet/placement.test.ts 2>&1 | tail -30`
Expected: FAIL — `sessionOf`, `orchestratorSession` introuvables ; tailles 320 × 420 ; arrivée et collage par le champ.

- [ ] **Step 3: Write the orchestrator's session**

`src/ipc/pty.ts` : `ClaudeLaunch` gagne `role: "agent" | "orchestrator";`.

`src/nodes/types.ts` :

```ts
  /** The steps its agent declared (spec orchestrateur §5). */
  steps?: Step[];
  /** An orchestrator's session (spec orchestrateur §4.2); absent for an agent. */
  role?: "orchestrator";
}

/** Content of an orchestrator node (spec habillage §13, spec orchestrateur §6). */
export interface OrchestratorPayload {
  name: string;
  /** Its Claude session, created when it is first shown. */
  session?: TerminalPayload;
}
```

```ts
/** Reads a stored orchestrator payload; a missing or blank name becomes "Orchestrateur". */
export function readOrchestratorPayload(raw: unknown): OrchestratorPayload {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const payload: OrchestratorPayload = { name: typeof r.name === "string" && r.name.trim() ? r.name : ORCHESTRATOR_NAME };
  const session = readTerminalPayload(r.session);
  if (session?.agent === "claude") payload.session = { ...session, role: "orchestrator" };
  return payload;
}
```

et dans `readTerminalPayload`, avant `return payload;` : `if (r.role === "orchestrator") payload.role = "orchestrator";`.

`src/store/nodes.ts`, après `terminalOf` :

```ts
/** The Claude session of a node: a terminal's own, or an orchestrator's (spec orchestrateur §6). */
export function sessionOf(record: NodeRecord | undefined): TerminalPayload | undefined {
  if (record?.kind === "terminal") return record.payload;
  return record?.kind === "orchestrator" ? record.payload.session : undefined;
}

/** Changes a node's session where it lives: the payload of a terminal, the `session` of an orchestrator. */
export function updateSession(nodeId: string, patch: Partial<TerminalPayload>) {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "terminal") nodesStore.getState().update(nodeId, patch);
  else if (record?.kind === "orchestrator" && record.payload.session) {
    nodesStore.getState().update(nodeId, { session: { ...record.payload.session, ...patch } });
  }
}
```

(`sessionOf` et `updateSession` sont placés après la création de `nodesStore`.)

`src/nodes/terminal/launch.ts` :

```ts
export function buildSpawnSpec(payload: TerminalPayload, mode: LaunchMode): SpawnSpec {
  const spec: SpawnSpec = { cwd: payload.cwd, shell: payload.shell, agent: payload.agent, command: payload.command };
  if (payload.agent === "claude") {
    spec.claude = { mode, sessionId: payload.claudeSessionId ?? crypto.randomUUID(), title: payload.title, role: payload.role ?? "agent" };
  }
  if (payload.agent === "ollama" && payload.ollama) spec.ollama = payload.ollama;
  return spec;
}

/** An orchestrator's brain: Claude in the project folder, with the manager's role (spec orchestrateur §6). */
export function orchestratorSession(name: string, options: { cwd: string; shell: ShellKind }): TerminalPayload {
  return { ...newTerminalPayload({ title: name, cwd: options.cwd, agent: "claude", command: "", shell: options.shell }, name), role: "orchestrator" };
}
```

`src/nodes/terminal/registry.ts` : import `nodesStore, sessionOf, updateSession` (plus `terminalOf`) ; dans `mountTerminal`, `const latest = sessionOf(nodesStore.getState().nodes[nodeId]) ?? payload;` ; dans `startFresh`, `let payload = sessionOf(nodesStore.getState().nodes[nodeId]);` et `updateSession(nodeId, fresh);` au lieu de `nodesStore.getState().update(nodeId, fresh)` ; dans `resumeTerminal`, `sessionOf` au lieu de `terminalOf`.

`src/nodes/terminal/useTerminalHost.ts` :

```ts
import { useEffect, type RefObject } from "react";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore, sessionOf } from "@/store/nodes";
import { createFitScheduler, ZOOM_SETTLE_MS } from "./fitScheduler";
import { layoutTerminal, mountTerminal } from "./registry";

/**
 * Shows the xterm of a node's session in `host` — a terminal's or an
 * orchestrator's — and keeps its grid fitted to the host and the zoom.
 * `ready`: the node has a session to show.
 */
export function useTerminalHost(nodeId: string, host: RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    const element = host.current;
    const session = sessionOf(nodesStore.getState().nodes[nodeId]);
    if (!ready || !element || !session) return;
    const zoom = () => canvasStore.getState().view.zoom;
    mountTerminal(nodeId, element, session, zoom());
    const layout = () => layoutTerminal(nodeId, element, zoom());
    const onResize = createFitScheduler(layout);
    const onZoom = createFitScheduler(layout, ZOOM_SETTLE_MS);
    const observer = new ResizeObserver(onResize.schedule);
    observer.observe(element);
    const unsubscribe = canvasStore.subscribe((state, previous) => {
      if (state.view.zoom !== previous.view.zoom) onZoom.schedule();
    });
    return () => {
      observer.disconnect();
      unsubscribe();
      onResize.cancel();
      onZoom.cancel();
    };
  }, [nodeId, host, ready]);
}
```

`TerminalNode.tsx` : l'effet de montage est remplacé par `useTerminalHost(nodeId, hostRef, hasPayload);` (imports devenus inutiles retirés).

`src/nodes/orchestrator/OrchestratorNode.tsx` (le `NameField`, `NameInput` et la fermeture restent ; `ProgressRing`, la liste des agents et `CommandInput` partent) :

```tsx
/** The manager of a team: its Claude session, then its mission (spec orchestrateur §6). */
export function OrchestratorNode({ nodeId }: { nodeId: string }) {
  const record = useNodes((s) => s.nodes[nodeId]);
  const links = useCanvas((s) => s.links[nodeId] ?? NO_LINKS);
  const frames = useCanvas((s) => s.frames);
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  const linking = useUi((s) => s.linking === nodeId);
  const status = useTerminalStatus(nodeId);
  const activity = useActivity(nodeId);
  const hostRef = useRef<HTMLDivElement>(null);
  const session = record?.kind === "orchestrator" ? record.payload.session : undefined;

  useEffect(() => {
    const current = nodesStore.getState().nodes[nodeId];
    // An orchestrator of before gets its session when first shown (spec orchestrateur §6).
    if (current?.kind !== "orchestrator" || current.payload.session) return;
    nodesStore.getState().update(nodeId, { session: orchestratorSession(current.payload.name, defaultLaunchOptions()) });
    markForAutostart(nodeId);
  }, [nodeId]);
  useTerminalHost(nodeId, hostRef, session !== undefined);

  if (record?.kind !== "orchestrator") {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-ov-line bg-ov-surface text-sm text-ov-text-2">
        Orchestrateur introuvable
      </div>
    );
  }

  const linked = linkedAgents(links, frames);
  const waiting = status.state === "running" && activity?.activity === "waiting";
  return (
    <div
      data-orchestrator={nodeId}
      className="relative flex h-full flex-col overflow-hidden rounded-xl bg-ov-surface-2"
      style={frameStyle("var(--ov-accent)", selected, waiting)}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-ov-line px-3">
        <Network className="size-4 shrink-0 text-ov-accent" />
        <NameField nodeId={nodeId} value={record.payload.name} onCommit={(name) => renameOrchestrator(nodeId, name)} />
        <span className="ml-auto font-mono text-[11px] text-ov-text-2">{sessionLabel(status.state, activity?.activity)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menu de l'orchestrateur"
              className="grid size-5 place-items-center rounded text-ov-text-2 hover:bg-ov-card hover:text-ov-text"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => void pauseAll(linked.agentIds)}>Tout mettre en pause</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void resumeAll(linked.agentIds)}>Tout reprendre</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <HeaderButton label="Fermer l'orchestrateur" onClick={() => removeOrchestrator(nodeId)}>
          <X />
        </HeaderButton>
      </header>
      <div className="relative min-h-0 flex-1 bg-ov-terminal px-1 pt-1">
        <div ref={hostRef} className="relative h-full w-full overflow-hidden" />
        {session && <ResumeCard nodeId={nodeId} payload={session} status={status} />}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-ov-line px-3 py-2 text-xs text-ov-text-2">
        <span>
          {agentsText(linked.agentIds.length)} · {groupsText(linked.groups.length)}
        </span>
        <button
          type="button"
          onClick={() => uiStore.getState().setLinking(linking ? null : nodeId)}
          className="rounded-full bg-ov-accent px-2.5 py-0.5 text-[11px] font-semibold text-white hover:brightness-110"
        >
          {linking ? "Terminer" : "+ Relier"}
        </button>
      </div>
      {waiting && <div className="pointer-events-none absolute inset-0 z-20 rounded-xl" style={{ boxShadow: WAITING_GLOW }} />}
    </div>
  );
}

/** What its session does, in the header. */
function sessionLabel(state: TerminalStatus["state"], activity: Activity | undefined): string {
  if (state === "starting") return "démarrage";
  if (state !== "running") return "arrêté";
  return activity === "working" ? "au travail" : activity === "waiting" ? "attend une réponse" : "inactif";
}
```

Imports : `useEffect, useRef, useState` ; `Activity` de `@/ipc/activity` ; `defaultLaunchOptions` de `@/fleet/launchAgent` ; `orchestratorSession` de `../terminal/launch` ; `markForAutostart` de `../terminal/registry` ; `ResumeCard` de `../terminal/ResumeCard` ; `useTerminalHost` de `../terminal/useTerminalHost` ; `frameStyle, WAITING_GLOW` de `../terminal/frame` ; `useActivity` de `@/store/agentActivity` ; `nodesStore, useNodes` de `@/store/nodes` ; `useTerminalStatus, type TerminalStatus` de `@/store/terminalStatus`.

Supprimer `src/nodes/orchestrator/field.ts` et `field.test.ts`.

`src/canvas/nodeElement.ts` : `orchestrator: { width: 640, height: 760 },`.

`src/fleet/orchestrators.ts` :

```ts
/** A new orchestrator with its Claude session, which starts when it is shown (spec orchestrateur §6). */
async function createOrchestrator(id: string, workspaceId: string) {
  const session = orchestratorSession(ORCHESTRATOR_NAME, defaultLaunchOptions());
  await nodesStore.getState().create(id, { workspaceId, kind: "orchestrator", payload: { name: ORCHESTRATOR_NAME, session } });
  markForAutostart(id);
}
```

`orchestrateGroup` et `addOrchestrator` appellent `await createOrchestrator(element.id, workspaceId)` au lieu de `nodesStore.getState().create(...)`. `removeOrchestrator` commence par `allowRemoval([orchestratorId]);` (son × est une fermeture demandée : sa session s'arrête sans confirmation).

`src/fleet/terminals.ts`, dans `adoptCopies` :

```ts
    if (source.kind === "orchestrator") {
      // A copied orchestrator keeps its name; its session, created when shown, and its wires are its own.
      await nodesStore.getState().create(id, { workspaceId, kind: "orchestrator", payload: { name: source.payload.name } });
      continue;
    }
```

`src/canvas/arrive.ts` :

```ts
/** Gives the keyboard to the xterm of a terminal or of an orchestrator's session. */
function focusNodeInput(nodeId: string, kind: NodeKind | null): boolean {
  focusTerminal(nodeId);
  if (kind === "orchestrator") return document.activeElement?.closest(`[data-orchestrator="${nodeId}"]`) != null;
  return terminalWithKeyboard() === nodeId;
}
```

`src/commands/catalog/orchestrator.ts` : `pasteIntoTerminal` de `@/nodes/terminal/registry` remplace `pasteIntoOrchestrator`, et :

```ts
    run: async (ctx) => {
      const text = await readClipboardText();
      if (text === null) return;
      // Like a terminal's « Coller »: its session's terminal takes the keyboard, then the text.
      arrive(id(ctx));
      pasteIntoTerminal(id(ctx), text);
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -8`
Expected: types sans erreur ; toute la suite passe.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(orchestrator): the orchestrator's Claude session lives in its node"
```

---

### Task 4: Le modèle de la mission et ses évènements

**Files:**
- Create: `src/mission/mission.ts`, `src/mission/mission.test.ts`
- Create: `src/mission/store.ts`
- Create: `src/mission/events.ts`, `src/mission/events.test.ts`
- Create: `src/ipc/mission.ts`
- Modify: `src/nodes/types.ts` (`OrchestratorPayload.mission`), `src/nodes/types.test.ts`
- Modify: `src/app/boot.ts`

**Interfaces:**
- Consumes: commandes de la Task 2 ; `sessionOf` (Task 3).
- Produces (`@/mission/mission`) : types `MissionState = "redaction" | "plan" | "lancement" | "en_cours" | "terminee"`, `ReportStatus`, `SubTask { title, brief, agent, budgetMin }`, `Report { summary, status, at }`, `Member { nodeId, name, task, budgetMin, linked, branch, worktree, sentAt?, report?, merged? }`, `Mission { state, budgetMin?, maxAgents, name?, task?, plan?, project?, slug?, branch?, worktree?, frameId?, members, summary?, error? }` ; `NEW_AGENT = "nouveau"`, `DEFAULT_MAX_AGENTS = 4`, `MAX_AGENTS = 8`, `NEW_MISSION` ; `readMission(raw): Mission | undefined` ; `proposedPlan(args, mission, linkedNames): { name, task, plan } | string` ; `sameName(a, b)` ; `oneLine(text)`.
- Produces (`@/mission/store`) : `missionOf(record): Mission | undefined`, `setMission(orchestratorId, patch)`, `updateMember(orchestratorId, nodeId, patch)`, `memberOf(nodeId): { orchestratorId, member } | null`, `linkedClaudeAgents(orchestratorId): { nodeId, name }[]`, `agentState(nodeId): "travaille" | "attend" | "inactif" | "arrêté"`.
- Produces (`@/mission/events`) : `notify(orchestratorId, line)`, `pendingEvents(orchestratorId)`, `installMissionEvents(): () => void`.
- Produces (`@/ipc/mission`) : `missionPrepare(project, name)`, `missionAddAgent(project, mission, agent)`, `missionMerge(mission, agent, branch)`, `missionCleanup(project, mission, agents)`, types `Worktree`, `MergeReport`, `Cleanup`.

- [ ] **Step 1: Write the failing tests**

`src/mission/mission.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { NEW_MISSION, oneLine, proposedPlan, readMission, sameName, type Mission } from "./mission";

const task = (agent: string, budget = 20) => ({ titre: "Login", consigne: "Fais le login", agent, budget_min: budget });
const args = (...sous_taches: object[]) => ({ nom: "Auth", tache: "Ajoute l'authentification", sous_taches });

describe("proposedPlan (spec orchestrateur §7.2)", () => {
  it("takes a plan of linked agents, named case and accents aside, and new ones", () => {
    const result = proposedPlan(args(task("athena"), { ...task("nouveau", 30), titre: "API" }), NEW_MISSION, ["Athéna", "Apollon"]);
    expect(result).toEqual({
      name: "Auth",
      task: "Ajoute l'authentification",
      plan: [
        { title: "Login", brief: "Fais le login", agent: "Athéna", budgetMin: 20 },
        { title: "API", brief: "Fais le login", agent: "nouveau", budgetMin: 30 },
      ],
    });
  });

  it("refuses what the team cannot do, with a reason the orchestrator can read", () => {
    const budgeted: Mission = { ...NEW_MISSION, budgetMin: 30, maxAgents: 2 };
    expect(proposedPlan(args(task("Zeus")), NEW_MISSION, ["Athéna"])).toContain("Zeus");
    expect(proposedPlan(args(task("Athéna"), task("Athéna")), NEW_MISSION, ["Athéna"])).toContain("une sous-tâche par agent");
    expect(proposedPlan(args(task("nouveau", 20), task("nouveau", 20)), budgeted, [])).toContain("budget global");
    expect(proposedPlan(args(task("nouveau"), task("nouveau"), task("nouveau")), budgeted, [])).toContain("2 sous-tâches");
    expect(proposedPlan(args(task("nouveau", 0)), NEW_MISSION, [])).toContain("budget");
    expect(proposedPlan({ tache: "x", sous_taches: [task("nouveau")] }, NEW_MISSION, [])).toContain("nom");
    expect(proposedPlan(args(), NEW_MISSION, [])).toContain("au moins une");
  });
});

describe("readMission", () => {
  it("reads a saved mission back; a launch cut short by a restart is back to its plan", () => {
    const saved = { state: "lancement", maxAgents: 3, name: "Auth", plan: [{ title: "Login", brief: "b", agent: "nouveau", budgetMin: 5 }], members: [] };
    expect(readMission(saved)).toEqual({ ...saved, state: "plan" });
    const member = { nodeId: "n1", name: "Isis", task: "Login", budgetMin: 5, linked: false, branch: "dummyplane/auth-isis", worktree: "C:/w", sentAt: 4, report: { summary: "ok", status: "termine", at: 9 } };
    expect(readMission({ state: "en_cours", maxAgents: 4, members: [member, { nodeId: 3 }] })?.members).toEqual([member]);
  });

  it("drops what is not a mission", () => {
    expect(readMission({ state: "partie" })).toBeUndefined();
    expect(readMission("x")).toBeUndefined();
  });
});

it("compares names case and accents aside, and keeps typed text on one line", () => {
  expect(sameName(" HÉRA", "hera")).toBe(true);
  expect(sameName("Héra", "Hermès")).toBe(false);
  expect(oneLine("Fais ceci\r\n\n  puis cela ")).toBe("Fais ceci puis cela");
});
```

`src/nodes/types.test.ts` :

```ts
it("reads an orchestrator's mission with it (spec orchestrateur §7)", () => {
  const mission = { state: "plan", maxAgents: 4, name: "Auth", members: [] };
  expect(readOrchestratorPayload({ name: "Chef", mission })).toEqual({ name: "Chef", mission });
  expect(readOrchestratorPayload({ name: "Chef", mission: { state: "?" } })).toEqual({ name: "Chef" });
});
```

`src/mission/events.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ptySendText } from "@/ipc/pty";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { installMissionEvents, notify, pendingEvents } from "./events";
import type { Member } from "./mission";

vi.mock("@/ipc/pty", () => ({ ptySendText: vi.fn(() => Promise.resolve()) }));

const member = (nodeId: string, name: string, sentAt?: number): Member => ({ nodeId, name, task: "t", budgetMin: 5, linked: false, branch: `dummyplane/m-${nodeId}`, worktree: "C:/w", sentAt });
const activity = (nodeId: string, value: "idle" | "working" | "waiting") => agentActivityStore.getState().apply({ nodeId, activity: value, since: 0 });
const status = (nodeId: string, state: "running" | "stopped" | "exited") =>
  terminalStatusStore.getState().set(nodeId, state === "exited" ? { state, code: 0 } : { state });
const sent = () => vi.mocked(ptySendText).mock.calls.map(([id, text]) => `${id}: ${text}`);

let uninstall: () => void;
beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "orchestrator",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, members: [member("isis", "Isis", 1), member("horus", "Horus")] } },
  });
  uninstall = installMissionEvents();
});
afterAll(() => uninstall());
beforeEach(() => {
  status("chef", "running");
  activity("chef", "idle");
  status("isis", "running");
  activity("isis", "working");
  vi.mocked(ptySendText).mockClear();
});

describe("events to the orchestrator (spec orchestrateur §7.5)", () => {
  it("types a line in a free orchestrator at once", () => {
    notify("chef", "Isis a rendu compte (termine) : fait");
    expect(sent()).toEqual(["chef: [dummyPlane] Isis a rendu compte (termine) : fait"]);
  });

  it("holds the lines while it waits for the user or is stopped, then sends them in order", () => {
    activity("chef", "waiting");
    notify("chef", "un");
    notify("chef", "deux");
    expect(sent()).toEqual([]);
    expect(pendingEvents("chef")).toEqual(["un", "deux"]);
    activity("chef", "working");
    status("chef", "stopped");
    notify("chef", "trois");
    status("chef", "running");
    expect(sent()).toEqual(["chef: [dummyPlane] un", "chef: [dummyPlane] deux", "chef: [dummyPlane] trois"]);
    expect(pendingEvents("chef")).toEqual([]);
  });

  it("tells it when a member waits for the user or stops, once its sub-task is sent", () => {
    activity("isis", "waiting");
    status("isis", "exited");
    status("horus", "running");
    activity("horus", "waiting");
    expect(sent()).toEqual([
      "chef: [dummyPlane] Isis attend une réponse de l'utilisateur (un dialogue est ouvert dans son terminal).",
      "chef: [dummyPlane] Isis s'est arrêté : son terminal ne tourne plus.",
    ]);
  });

  it("counts a member's terminal removed from the canvas as stopped", () => {
    terminalStatusStore.getState().remove("isis");
    expect(sent()).toEqual(["chef: [dummyPlane] Isis s'est arrêté : son terminal ne tourne plus."]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mission src/nodes/types.test.ts 2>&1 | tail -20`
Expected: FAIL — modules `./mission`, `./events` introuvables.

- [ ] **Step 3: Write the mission's model, store and events**

`src/mission/mission.ts` :

```ts
/** The mission of an orchestrator (spec orchestrateur §7), saved in its payload. */
export type MissionState = "redaction" | "plan" | "lancement" | "en_cours" | "terminee";
export type ReportStatus = "termine" | "bloque" | "echec";

/** A sub-task of the plan; `agent` is a linked agent's name, or `nouveau`. */
export interface SubTask {
  title: string;
  brief: string;
  agent: string;
  budgetMin: number;
}

export interface Report {
  summary: string;
  status: ReportStatus;
  at: number;
}

/** An agent of the formed team, in its worktree. */
export interface Member {
  nodeId: string;
  name: string;
  /** The title of its sub-task. */
  task: string;
  budgetMin: number;
  /** Linked before the mission (back to the project at its end), else created for it (closed). */
  linked: boolean;
  branch: string;
  worktree: string;
  /** When its sub-task was typed: its events are watched from then on. */
  sentAt?: number;
  report?: Report;
  merged?: boolean;
}

export interface Mission {
  state: MissionState;
  /** Settings of the panel (spec §7.1). */
  budgetMin?: number;
  maxAgents: number;
  name?: string;
  task?: string;
  plan?: SubTask[];
  /** Set by « Lancer la mission ». */
  project?: string;
  slug?: string;
  branch?: string;
  worktree?: string;
  /** The group of the agents created for it. */
  frameId?: string;
  members: Member[];
  summary?: string;
  error?: string;
}

export const NEW_AGENT = "nouveau";
export const DEFAULT_MAX_AGENTS = 4;
export const MAX_AGENTS = 8;
export const NEW_MISSION: Mission = { state: "redaction", maxAgents: DEFAULT_MAX_AGENTS, members: [] };

const STATES: readonly string[] = ["redaction", "plan", "lancement", "en_cours", "terminee"];
const STATUSES: readonly string[] = ["termine", "bloque", "echec"];
const MAX_TITLE = 60;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const fold = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("fr");

/** The orchestrator names agents as it reads them: case and accents aside. */
export const sameName = (a: string, b: string) => fold(a) === fold(b);

/** Text typed in a terminal ends at its first line break: briefs and messages go on one line. */
export const oneLine = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ").trim();

function readMember(raw: unknown): Member | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.nodeId !== "string" || typeof r.name !== "string" || typeof r.branch !== "string" || typeof r.worktree !== "string") return null;
  const member: Member = {
    nodeId: r.nodeId,
    name: r.name,
    task: text(r.task),
    budgetMin: typeof r.budgetMin === "number" ? r.budgetMin : 0,
    linked: r.linked === true,
    branch: r.branch,
    worktree: r.worktree,
  };
  if (typeof r.sentAt === "number") member.sentAt = r.sentAt;
  if (r.merged === true) member.merged = true;
  const report = r.report as Record<string, unknown> | undefined;
  if (report && typeof report.summary === "string" && typeof report.status === "string" && STATUSES.includes(report.status)) {
    member.report = { summary: report.summary, status: report.status as ReportStatus, at: typeof report.at === "number" ? report.at : 0 };
  }
  return member;
}

function isSubTask(raw: unknown): raw is SubTask {
  const r = raw as Record<string, unknown>;
  return typeof raw === "object" && raw !== null && typeof r.title === "string" && typeof r.brief === "string" && typeof r.agent === "string" && typeof r.budgetMin === "number";
}

/** A saved mission; undefined when absent or unreadable. A launch cut short by a restart is back to its plan. */
export function readMission(raw: unknown): Mission | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== "string" || !STATES.includes(r.state)) return undefined;
  const mission: Mission = {
    state: r.state === "lancement" ? "plan" : (r.state as MissionState),
    maxAgents: typeof r.maxAgents === "number" ? r.maxAgents : DEFAULT_MAX_AGENTS,
    members: Array.isArray(r.members) ? r.members.map(readMember).filter((m): m is Member => m !== null) : [],
  };
  if (typeof r.budgetMin === "number") mission.budgetMin = r.budgetMin;
  for (const key of ["name", "task", "project", "slug", "branch", "worktree", "frameId", "summary", "error"] as const) {
    if (typeof r[key] === "string") mission[key] = r[key];
  }
  if (Array.isArray(r.plan)) mission.plan = r.plan.filter(isSubTask);
  return mission;
}

/** `proposer_plan`'s arguments as a plan, or what is wrong (spec §7.2). `linked`: names of the linked Claude agents. */
export function proposedPlan(
  args: Record<string, unknown>,
  mission: Mission,
  linked: readonly string[],
): { name: string; task: string; plan: SubTask[] } | string {
  const name = text(args.nom);
  if (!name || name.length > MAX_TITLE) return `Donne un nom court à la mission (nom, ${MAX_TITLE} caractères au plus).`;
  const task = text(args.tache);
  if (!task) return "Rappelle la tâche de la mission (tache).";
  const raw = args.sous_taches;
  if (!Array.isArray(raw) || raw.length === 0) return "Donne au moins une sous-tâche.";
  if (raw.length > mission.maxAgents) return `Pas plus de ${mission.maxAgents} sous-tâches : une par agent, ${mission.maxAgents} agents au plus.`;
  const plan: SubTask[] = [];
  for (const [i, item] of raw.entries()) {
    const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const n = i + 1;
    const title = text(r.titre);
    const brief = text(r.consigne);
    const agent = text(r.agent);
    const budget = r.budget_min;
    if (!title || title.length > MAX_TITLE) return `Sous-tâche ${n} : un titre court (${MAX_TITLE} caractères au plus).`;
    if (!brief) return `Sous-tâche ${n} : une consigne.`;
    if (typeof budget !== "number" || !Number.isInteger(budget) || budget < 1) return `Sous-tâche ${n} : un budget en minutes (entier, 1 au moins).`;
    const known = sameName(agent, NEW_AGENT) ? NEW_AGENT : linked.find((l) => sameName(l, agent));
    if (!known) return `Sous-tâche ${n} : « ${agent} » n'est pas un agent Claude relié (prénom, ou « nouveau »).`;
    if (known !== NEW_AGENT && plan.some((s) => s.agent === known)) return `${known} a déjà une sous-tâche : une sous-tâche par agent.`;
    plan.push({ title, brief, agent: known, budgetMin: budget });
  }
  const total = plan.reduce((sum, s) => sum + s.budgetMin, 0);
  if (mission.budgetMin !== undefined && total > mission.budgetMin) {
    return `Les budgets font ${total} min, plus que le budget global (${mission.budgetMin} min).`;
  }
  return { name, task, plan };
}
```

`src/mission/store.ts` :

```ts
import { canvasStore } from "@/canvas/canvasStore";
import { AGENTS } from "@/fleet/catalog";
import { linkedAgents, NO_LINKS } from "@/fleet/wires";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { NEW_MISSION, type Member, type Mission } from "./mission";

/** An orchestrator's mission — a fresh one until it has its own; undefined for any other node. */
export function missionOf(record: NodeRecord | undefined): Mission | undefined {
  return record?.kind === "orchestrator" ? (record.payload.mission ?? NEW_MISSION) : undefined;
}

export function setMission(orchestratorId: string, patch: Partial<Mission>) {
  const mission = missionOf(nodesStore.getState().nodes[orchestratorId]);
  if (mission) nodesStore.getState().update(orchestratorId, { mission: { ...mission, ...patch } });
}

export function updateMember(orchestratorId: string, nodeId: string, patch: Partial<Member>) {
  const mission = missionOf(nodesStore.getState().nodes[orchestratorId]);
  if (mission) setMission(orchestratorId, { members: mission.members.map((m) => (m.nodeId === nodeId ? { ...m, ...patch } : m)) });
}

/** The running mission an agent works for, once its sub-task was sent (spec §7.5). */
export function memberOf(nodeId: string): { orchestratorId: string; member: Member } | null {
  for (const [orchestratorId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours") continue;
    const member = mission.members.find((m) => m.nodeId === nodeId && m.sentAt !== undefined);
    if (member) return { orchestratorId, member };
  }
  return null;
}

/** The Claude agents wired to an orchestrator: only they have dummyPlane's tools for a mission (spec §2). */
export function linkedClaudeAgents(orchestratorId: string): { nodeId: string; name: string }[] {
  const { links, frames } = canvasStore.getState();
  const nodes = nodesStore.getState().nodes;
  return linkedAgents(links[orchestratorId] ?? NO_LINKS, frames).agentIds.flatMap((nodeId) => {
    const payload = terminalOf(nodes[nodeId]);
    return payload?.agent === "claude" ? [{ nodeId, name: payload.name || AGENTS.claude.label }] : [];
  });
}

export type AgentState = "travaille" | "attend" | "inactif" | "arrêté";

/** An agent's state as the orchestrator reads it (spec §7.2 `equipe`). */
export function agentState(nodeId: string): AgentState {
  if (!isRunning(nodeId)) return "arrêté";
  const activity = agentActivityStore.getState().activities[nodeId]?.activity;
  return activity === "working" ? "travaille" : activity === "waiting" ? "attend" : "inactif";
}
```

`src/mission/events.ts` :

```ts
import { ptySendText } from "@/ipc/pty";
import { agentActivityStore } from "@/store/agentActivity";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { memberOf } from "./store";

/** Lines waiting for their orchestrator to be free. */
const queues = new Map<string, string[]>();

/** An orchestrator takes a line while its session runs and no dialog waits for the user (spec §7.5). */
function free(orchestratorId: string): boolean {
  return isRunning(orchestratorId) && agentActivityStore.getState().activities[orchestratorId]?.activity !== "waiting";
}

function flush(orchestratorId: string) {
  const queue = queues.get(orchestratorId);
  if (!queue?.length || !free(orchestratorId)) return;
  queues.delete(orchestratorId);
  // ptySendText keeps a node's writes in order; Claude queues what comes while it works.
  for (const line of queue) void ptySendText(orchestratorId, `[dummyPlane] ${line}`).catch(() => undefined);
}

/** Types `line` in the orchestrator's terminal, now or as soon as it is free. */
export function notify(orchestratorId: string, line: string) {
  queues.set(orchestratorId, [...(queues.get(orchestratorId) ?? []), line]);
  flush(orchestratorId);
}

export function pendingEvents(orchestratorId: string): readonly string[] {
  return queues.get(orchestratorId) ?? [];
}

/** Watches the members of running missions, and frees held lines when an orchestrator is free again. */
export function installMissionEvents(): () => void {
  const flushAll = () => [...queues.keys()].forEach(flush);
  const offActivity = agentActivityStore.subscribe((state, previous) => {
    for (const [nodeId, now] of Object.entries(state.activities)) {
      if (now.activity !== "waiting" || previous.activities[nodeId]?.activity === "waiting") continue;
      const found = memberOf(nodeId);
      if (found) notify(found.orchestratorId, `${found.member.name} attend une réponse de l'utilisateur (un dialogue est ouvert dans son terminal).`);
    }
    flushAll();
  });
  const offStatus = terminalStatusStore.subscribe((state, previous) => {
    // A terminal removed from the canvas leaves the statuses: it stopped too.
    for (const nodeId of new Set([...Object.keys(previous.statuses), ...Object.keys(state.statuses)])) {
      if (previous.statuses[nodeId]?.state !== "running" || state.statuses[nodeId]?.state === "running") continue;
      const found = memberOf(nodeId);
      if (found) notify(found.orchestratorId, `${found.member.name} s'est arrêté : son terminal ne tourne plus.`);
    }
    flushAll();
  });
  return () => {
    offActivity();
    offStatus();
  };
}
```

`src/ipc/mission.ts` :

```ts
import { call } from "./invoke";

/** A worktree dummyPlane made for a mission, on its own branch (spec orchestrateur §7.4). */
export interface Worktree {
  slug: string;
  branch: string;
  path: string;
}

export type Merge = { kind: "merged" } | { kind: "empty" } | { kind: "conflict"; files: string[] };

export interface MergeReport {
  merge: Merge;
  /** Changes left uncommitted in the agent's worktree: not merged. */
  uncommitted: boolean;
}

export interface Cleanup {
  removed: string[];
  kept: string[];
}

export const missionPrepare = (project: string, name: string) => call<Worktree>("mission_prepare", { project, name });
/** `mission`: the mission's slug; `agent`: the agent's name. */
export const missionAddAgent = (project: string, mission: string, agent: string) => call<Worktree>("mission_add_agent", { project, mission, agent });
/** `mission`, `agent`: their worktrees' paths. */
export const missionMerge = (mission: string, agent: string, branch: string) => call<MergeReport>("mission_merge", { mission, agent, branch });
export const missionCleanup = (project: string, mission: string, agents: string[]) => call<Cleanup>("mission_cleanup", { project, mission, agents });
```

`src/nodes/types.ts` : `OrchestratorPayload` gagne `/** Its mission (spec orchestrateur §7). */ mission?: Mission;` (import de type depuis `@/mission/mission`, et `readMission`), et `readOrchestratorPayload`, avant `return payload;` :

```ts
  const mission = readMission(r.mission);
  if (mission) payload.mission = mission;
```

`src/app/boot.ts` : après `await installMcp();`, `installMissionEvents();` (import de `@/mission/events`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/mission src/nodes 2>&1 | tail -8`
Expected: types sans erreur ; tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/mission src/ipc/mission.ts src/nodes/types.ts src/nodes/types.test.ts src/app/boot.ts
git commit -m "feat(mission): the mission's model, and events typed in the orchestrator's terminal"
```

---
### Task 5: Le feu vert, la fusion, la fin

**Files:**
- Create: `src/nodes/terminal/bufferText.ts`, `src/nodes/terminal/bufferText.test.ts`
- Modify: `src/nodes/terminal/registry.ts` (`terminalText`, `quietFor`, `relaunchTerminal`)
- Modify: `src/fleet/groups.ts` ; Create: `src/fleet/groups.test.ts`
- Create: `src/mission/ready.ts`, `src/mission/ready.test.ts`
- Create: `src/mission/launch.ts`, `src/mission/launch.test.ts`

**Interfaces:**
- Consumes: Task 4 (`missionOf`, `setMission`, `updateMember`, `linkedClaudeAgents`, `notify`, `sameName`, `oneLine`, `NEW_AGENT`, `NEW_MISSION`, commandes `@/ipc/mission`) ; Task 3 (`sessionOf`) ; `newConversation` (H1).
- Produces: `bufferText(buffer, lines)` ; `terminalText(nodeId, lines): string`, `quietFor(nodeId): number` (registre) ; `relaunchTerminal` démarre aussi un terminal jamais affiché ; `GroupStaffing { pantheon, names, cwds }` et `launchGroup(plan, options?, at?, staffing?): Promise<{ frameId: string; nodeIds: string[] } | null>` ; `ReadyProbe`, `trustKeys(screen)`, `whenReady(probe, wait?)` ; `subTaskText(mission, task, branch)`, `launchMission(orchestratorId)`, `endMission(orchestratorId, summary)`, `mergeMission(orchestratorId): Promise<string>`, `cleanMission(orchestratorId): Promise<Cleanup | string>`.

- [ ] **Step 1: Write the failing tests**

`src/nodes/terminal/bufferText.test.ts` :

```ts
import { expect, it } from "vitest";
import { bufferText } from "./bufferText";

const buffer = (rows: string[]) => ({ length: rows.length, getLine: (y: number) => ({ translateToString: () => rows[y] }) });

it("reads the last lines of a terminal as plain text, without the empty rows under the output", () => {
  const screen = buffer(["$ claude", "> Bonjour", "  Fait.", "", ""]);
  expect(bufferText(screen, 2)).toBe("> Bonjour\n  Fait.");
  expect(bufferText(screen, 200)).toBe("$ claude\n> Bonjour\n  Fait.");
  expect(bufferText(screen, 0)).toBe("");
});
```

`src/fleet/groups.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore, terminalOf } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { launchGroup } from "./groups";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn() }));

let scene: { id: string; type: string; customData?: Record<string, unknown> }[] = [];
beforeEach(() => {
  mockIPC(() => undefined);
  scene = [];
  const api = {
    getSceneElements: () => scene,
    getSceneElementsIncludingDeleted: () => scene,
    updateScene: ({ elements }: { elements?: typeof scene }) => {
      if (elements) scene = elements;
    },
    scrollToContent: vi.fn(),
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI });
  workspacesStore.setState({ activeId: "w1" });
});

it("staffs a mission's group with the names, folders and pantheon it is given, and says what it made", async () => {
  const made = await launchGroup(
    { name: "Mission Auth", role: "general", agents: ["claude", "claude"] },
    { cwd: "C:/code", shell: "default", title: "", command: "" },
    { x: 0, y: 0 },
    { pantheon: "egyptian", names: ["Isis", "Horus"], cwds: ["C:/w/auth-isis", "C:/w/auth-horus"] },
  );
  const frame = scene.find((e) => e.type === "frame");
  expect(made?.frameId).toBe(frame?.id);
  expect(made!.nodeIds.map((id) => [terminalOf(nodesStore.getState().nodes[id])?.name, terminalOf(nodesStore.getState().nodes[id])?.cwd])).toEqual([
    ["Isis", "C:/w/auth-isis"],
    ["Horus", "C:/w/auth-horus"],
  ]);
  expect(frame?.customData?.dummyplane).toMatchObject({ kind: "group", pantheon: "egyptian" });
});
```

`src/mission/ready.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { trustKeys, whenReady, type ReadyProbe } from "./ready";

const TRUST = "Accessing workspace:\n\nQuick safety check: Is this a project you created or one you trust?\n\n❯ No, exit\n  Yes, I trust this folder\n\nEnter to confirm · Esc to cancel";
const CLAUDE = " ✻  Claude Code v2.1.304\n    Opus 5.5\n\n> ";

/** An agent's terminal on a simulated clock: what it shows, when it last wrote, what was pressed. */
function agent(first: string, onPress: (keys: string, show: (screen: string) => void) => void = () => undefined) {
  let clock = 0;
  let wrote = 0;
  let screen = first;
  const pressed: string[] = [];
  const show = (next: string) => {
    screen = next;
    wrote = clock;
  };
  const probe: ReadyProbe = {
    running: () => true,
    quietMs: () => clock - wrote,
    screen: () => screen,
    press: async (keys) => {
      pressed.push(keys);
      onPress(keys, show);
    },
  };
  const wait = async (ms: number) => {
    clock += ms;
  };
  return { probe, wait, pressed, now: () => clock, wroteAt: () => wrote };
}

describe("trustKeys (spec orchestrateur §7.3)", () => {
  it("moves to « Yes » when « No » is selected, presses Enter when « Yes » already is", () => {
    expect(trustKeys(TRUST)).toEqual(["\x1b[B", "\r"]);
    expect(trustKeys(TRUST.replace("❯ No, exit\n  Yes", "  No, exit\n❯ Yes"))).toEqual(["\r"]);
    expect(trustKeys(CLAUDE)).toBeNull();
  });
});

describe("whenReady (spec orchestrateur §7.3)", () => {
  it("accepts the trust prompt once, then waits for Claude's prompt to stay quiet 2 s", async () => {
    const a = agent(TRUST, (keys, show) => {
      if (keys === "\r") show(CLAUDE);
    });
    expect(await whenReady(a.probe, a.wait)).toBe(true);
    expect(a.pressed).toEqual(["\x1b[B", "\r"]);
    expect(a.now() - a.wroteAt()).toBeGreaterThanOrEqual(2000);
    expect(a.now() - a.wroteAt()).toBeLessThan(2500);
  });

  it("is ready at once when Claude is already quiet", async () => {
    const a = agent(CLAUDE);
    await a.wait(5000);
    expect(await whenReady(a.probe, a.wait)).toBe(true);
    expect(a.pressed).toEqual([]);
  });

  it("gives up after 60 s, and never answers the prompt twice", async () => {
    const a = agent(TRUST);
    expect(await whenReady(a.probe, a.wait)).toBe(false);
    expect(a.now()).toBeGreaterThanOrEqual(60_000);
    expect(a.pressed).toEqual(["\x1b[B", "\r"]);
  });
});
```

`src/mission/launch.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { closeGroup, launchGroup } from "@/fleet/groups";
import { linkOrchestrator } from "@/fleet/orchestrators";
import { missionAddAgent, missionCleanup, missionMerge, missionPrepare, type Worktree } from "@/ipc/mission";
import { ptySendText } from "@/ipc/pty";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { notify } from "./events";
import { cleanMission, endMission, launchMission, mergeMission, subTaskText } from "./launch";
import type { Member, Mission } from "./mission";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/mission", () => ({ missionPrepare: vi.fn(), missionAddAgent: vi.fn(), missionMerge: vi.fn(), missionCleanup: vi.fn() }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(), quietFor: vi.fn(() => 0), terminalText: vi.fn(() => ""), markForAutostart: vi.fn() }));
vi.mock("@/fleet/groups", () => ({ launchGroup: vi.fn(), closeGroup: vi.fn() }));
vi.mock("@/fleet/orchestrators", () => ({ linkOrchestrator: vi.fn() }));
vi.mock("./ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  linkedClaudeAgents: vi.fn(() => [{ nodeId: "isis", name: "Isis" }]),
}));

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", claudeSessionId: "s0", role: "orchestrator" };
const plan = [
  { title: "Login", brief: "Fais le login.", agent: "Isis", budgetMin: 20 },
  { title: "API", brief: "Fais l'API\npuis teste", agent: "nouveau", budgetMin: 30 },
];
const tree = (slug: string): Worktree => ({ slug, branch: `dummyplane/${slug}`, path: `C:/code/proj.worktrees/${slug}` });
const member = (nodeId: string, name: string, linked: boolean, extra: Partial<Member> = {}): Member => ({
  nodeId, name, task: "t", budgetMin: 5, linked, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 1, ...extra,
});
const missionNow = () => missionOf(nodesStore.getState().nodes.chef)!;

async function setup(mission: Partial<Mission> = {}) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "orchestrator",
    payload: { name: "Chef", session, mission: { state: "plan", maxAgents: 4, members: [], name: "Auth", plan, ...mission } },
  });
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { ...session, role: undefined, name: "Isis", claudeSessionId: "old", steps: [{ title: "Plan", state: "fait" }] },
  });
}

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  vi.mocked(missionPrepare).mockResolvedValue(tree("auth"));
  vi.mocked(missionAddAgent).mockImplementation(async (_project, mission, agent) => tree(`${mission}-${agent.toLowerCase()}`));
  vi.mocked(launchGroup).mockResolvedValue({ frameId: "f1", nodeIds: ["n1"] });
  for (const id of ["chef", "isis", "n1"]) terminalStatusStore.getState().set(id, { state: "running" });
});

it("writes an agent's sub-task on one line, with its budget, branch and duties (spec §7.3)", () => {
  expect(subTaskText("Auth", plan[1], "dummyplane/auth-horus")).toBe(
    "[dummyPlane · mission Auth] API — Fais l'API puis teste. Budget : 30 min. Branche : dummyplane/auth-horus. Ce worktree est neuf : les dépendances (node_modules…) n'y sont pas installées. Déclare tes étapes, délègue à tes sous-agents, commit sur ta branche, puis rends compte avec rendre_compte.",
  );
});

describe("launchMission (spec §7.3)", () => {
  it("forms the team: a worktree each, linked agents relaunched there anew, new ones in the mission's group", async () => {
    await setup();
    await launchMission("chef");
    const mission = missionNow();
    const fresh = mission.members[1].name;
    expect(missionPrepare).toHaveBeenCalledWith("C:/code/proj", "Auth");
    expect(vi.mocked(missionAddAgent).mock.calls).toEqual([
      ["C:/code/proj", "auth", "Isis"],
      ["C:/code/proj", "auth", fresh],
    ]);
    const isis = terminalOf(nodesStore.getState().nodes.isis)!;
    expect(isis.cwd).toBe("C:/code/proj.worktrees/auth-isis");
    expect(isis.claudeSessionId).not.toBe("old");
    expect(isis.steps).toBeUndefined();
    expect(relaunchTerminal).toHaveBeenCalledWith("isis", expect.objectContaining({ cwd: isis.cwd, claudeSessionId: isis.claudeSessionId }), "new");
    expect(launchGroup).toHaveBeenCalledWith(
      { name: "Mission Auth", role: "general", agents: ["claude"] },
      expect.anything(),
      undefined,
      expect.objectContaining({ names: [fresh], cwds: [tree(`auth-${fresh.toLowerCase()}`).path] }),
    );
    expect(linkOrchestrator).toHaveBeenCalledWith("chef", "f1");
    expect(mission).toMatchObject({ state: "en_cours", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", frameId: "f1" });
    expect(mission.members.map((m) => [m.nodeId, m.linked, m.branch])).toEqual([
      ["isis", true, "dummyplane/auth-isis"],
      ["n1", false, tree(`auth-${fresh.toLowerCase()}`).branch],
    ]);
    expect(vi.mocked(notify).mock.calls[0]).toEqual(["chef", expect.stringContaining("Feu vert")]);
    await vi.waitFor(() => expect(missionNow().members.every((m) => m.sentAt !== undefined)).toBe(true));
    expect(ptySendText).toHaveBeenCalledWith("isis", subTaskText("Auth", plan[0], "dummyplane/auth-isis"));
    expect(ptySendText).toHaveBeenCalledWith("n1", subTaskText("Auth", plan[1], tree(`auth-${fresh.toLowerCase()}`).branch));
  });

  it("takes a mission whose git fails back to its plan, with the error, and launches no one", async () => {
    await setup();
    vi.mocked(missionPrepare).mockRejectedValueOnce(new Error("Le dossier du projet n'est pas un dépôt git."));
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "Le dossier du projet n'est pas un dépôt git.", members: [] });
    expect(notify).toHaveBeenCalledWith("chef", "La mission n'a pas pu démarrer : Le dossier du projet n'est pas un dépôt git.");
    vi.mocked(missionAddAgent).mockResolvedValueOnce(tree("auth-isis")).mockRejectedValueOnce(new Error("La branche dummyplane/auth-x existe déjà."));
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "La branche dummyplane/auth-x existe déjà." });
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(launchGroup).not.toHaveBeenCalled();
  });

  it("forms one team for two go-aheads in a row", async () => {
    await setup();
    let release!: (tree: Worktree) => void;
    vi.mocked(missionPrepare).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = launchMission("chef");
    await launchMission("chef");
    expect(missionNow().state).toBe("lancement");
    release(tree("auth"));
    await first;
    expect(missionPrepare).toHaveBeenCalledTimes(1);
    expect(launchGroup).toHaveBeenCalledTimes(1);
  });

  it("tells the orchestrator when an agent did not start, instead of typing into nothing", async () => {
    await setup();
    terminalStatusStore.getState().set("n1", { state: "stopped" });
    await launchMission("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("n'a pas démarré")));
    expect(vi.mocked(ptySendText).mock.calls.some(([id]) => id === "n1")).toBe(false);
  });
});

it("ends the mission: created agents closed, linked ones back in the project in a new conversation (spec §7.7)", async () => {
  await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("isis", "Isis", true), member("n1", "Horus", false)] });
  endMission("chef", "Tout est fait.");
  expect(missionNow()).toMatchObject({ state: "terminee", summary: "Tout est fait." });
  expect(relaunchTerminal).toHaveBeenCalledWith("isis", expect.objectContaining({ cwd: "C:/code/proj" }), "new");
  expect(closeGroup).toHaveBeenCalledWith("f1");
});

it("merges the branches of the agents done, and says what happened to each (spec §7.6)", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  await setup({
    state: "en_cours",
    worktree: "C:/w/auth",
    branch: "dummyplane/auth",
    members: [member("isis", "Isis", true, { report: done }), member("n1", "Horus", false, { report: done }), member("n2", "Anubis", false, { report: { ...done, status: "bloque" } })],
  });
  vi.mocked(missionMerge).mockImplementation(async (_mission, _agent, branch) =>
    branch.endsWith("isis") ? { merge: { kind: "merged" }, uncommitted: true } : { merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false },
  );
  expect(await mergeMission("chef")).toBe(
    "Branche dummyplane/auth :\nIsis : fusionné (des changements non commités de son worktree ne sont pas fusionnés)\nHorus : conflit, fusion annulée — a.ts",
  );
  expect(vi.mocked(missionMerge).mock.calls.map(([mission, agent, branch]) => [mission, agent, branch])).toEqual([
    ["C:/w/auth", "C:/w/isis", "dummyplane/auth-isis"],
    ["C:/w/auth", "C:/w/n1", "dummyplane/auth-n1"],
  ]);
  expect(missionNow().members.map((m) => m.merged === true)).toEqual([true, false, false]);
});

it("cleans a finished mission and frees the orchestrator for the next, its settings kept", async () => {
  await setup({ state: "terminee", budgetMin: 90, maxAgents: 3, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("isis", "Isis", true)] });
  vi.mocked(missionCleanup).mockResolvedValue({ removed: ["auth-isis", "auth"], kept: [] });
  expect(await cleanMission("chef")).toEqual({ removed: ["auth-isis", "auth"], kept: [] });
  expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", ["Isis"]);
  expect(missionNow()).toEqual({ state: "redaction", budgetMin: 90, maxAgents: 3, members: [] });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mission src/fleet/groups.test.ts src/nodes/terminal/bufferText.test.ts 2>&1 | tail -20`
Expected: FAIL — `./launch`, `./ready`, `./bufferText` introuvables ; `launchGroup` ne rend rien et ignore les prénoms.

- [ ] **Step 3: Write the launch**

`src/nodes/terminal/bufferText.ts` :

```ts
/** The part of an xterm buffer text extraction reads (lets tests use a fake). */
export interface TextBuffer {
  readonly length: number;
  getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
}

/** The last `lines` lines of a buffer as plain text, without the empty rows under the output. */
export function bufferText(buffer: TextBuffer, lines: number): string {
  if (lines <= 0) return "";
  const rows: string[] = [];
  for (let y = 0; y < buffer.length; y++) rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
  while (rows.length > 0 && !rows[rows.length - 1].trim()) rows.pop();
  return rows.slice(-lines).join("\n");
}
```

`src/nodes/terminal/registry.ts` : `Entry` gagne `/** When output was last written: a quiet agent is ready (spec orchestrateur §7.3). */ lastOutput?: number;` ; dans `create`, après la création de `entry` : `term.onWriteParsed(() => { entry.lastOutput = Date.now(); });` ; et :

```ts
/** How long the terminal has written nothing; 0 before its first output. */
export function quietFor(nodeId: string): number {
  const last = entries.get(nodeId)?.lastOutput;
  return last === undefined ? 0 : Date.now() - last;
}

/** The last `lines` lines of the terminal, as plain text (spec orchestrateur §7.2 `lire_sortie`). */
export function terminalText(nodeId: string, lines: number): string {
  const term = entries.get(nodeId)?.term;
  return term ? bufferText(term.buffer.active, lines) : "";
}

export function relaunchTerminal(nodeId: string, payload: TerminalPayload, mode: LaunchMode) {
  // A terminal not shown since the app started has no xterm yet: a mission still starts it.
  const entry = entries.get(nodeId) ?? create(nodeId);
  autostart.cancel(nodeId);
  void relaunchSession(nodeId, entry.term, payload, mode);
}
```

`src/fleet/groups.ts` :

```ts
/** Who staffs a mission's group: its pantheon, its agents' names and folders (spec orchestrateur §7.3). */
export interface GroupStaffing {
  pantheon: string;
  names: readonly string[];
  cwds: readonly string[];
}
```

`launchGroup(plan, options = defaultLaunchOptions(), at?: Point, staffing?: GroupStaffing): Promise<{ frameId: string; nodeIds: string[] } | null>` : `return null` au lieu de `return` ; `const pantheon = staffing?.pantheon ?? pantheonForNewGroup(workspaceId);` ; dans la boucle, `const agentName = staffing?.names[i] ?? nextName(pantheon, taken);`, le payload `newTerminalPayload({ ...options, cwd: staffing?.cwds[i] ?? options.cwd, agent }, agentName)`, et `nodeIds.push(node.id)` ; à la fin, `return { frameId: frame.id, nodeIds };`.

`src/mission/ready.ts` :

```ts
/** What readiness reads of an agent's terminal, and how it answers it (spec orchestrateur §7.3). */
export interface ReadyProbe {
  running(): boolean;
  quietMs(): number;
  screen(): string;
  press(keys: string): Promise<void>;
}

export const READY_QUIET_MS = 2000;
export const READY_TIMEOUT_MS = 60_000;
const TICK_MS = 250;
const BETWEEN_KEYS_MS = 300;
/** Claude's welcome banner: its prompt is up. */
const CLAUDE_UP = /Claude Code v\d/;

/** The keys that accept Claude's « trust this folder » prompt, or null when it does not show. */
export function trustKeys(screen: string): string[] | null {
  if (!/trust/i.test(screen) || !/folder/i.test(screen)) return null;
  const selected = screen.split("\n").find((line) => line.trimStart().startsWith("❯"));
  return selected && /yes/i.test(selected) ? ["\r"] : ["\x1b[B", "\r"];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True once the agent can take its sub-task: it runs, its trust prompt was
 * accepted (once — only dummyPlane's fresh worktrees ask), Claude's prompt is up
 * and quiet for 2 s. False after 60 s.
 */
export async function whenReady(probe: ReadyProbe, wait: (ms: number) => Promise<void> = sleep): Promise<boolean> {
  let trusted = false;
  for (let waited = 0; waited < READY_TIMEOUT_MS; waited += TICK_MS) {
    if (probe.running()) {
      const screen = probe.screen();
      const keys = trusted ? null : trustKeys(screen);
      if (keys) {
        trusted = true;
        for (const [i, key] of keys.entries()) {
          if (i > 0) await wait(BETWEEN_KEYS_MS);
          await probe.press(key);
        }
      } else if (CLAUDE_UP.test(screen) && probe.quietMs() >= READY_QUIET_MS) {
        return true;
      }
    }
    await wait(TICK_MS);
  }
  return false;
}
```

`src/mission/launch.ts` :

```ts
import { canvasStore } from "@/canvas/canvasStore";
import { GROUP_GAP, groupGrid } from "@/fleet/groupLayout";
import { closeGroup, launchGroup } from "@/fleet/groups";
import { defaultLaunchOptions } from "@/fleet/launchAgent";
import { nextName } from "@/fleet/names";
import { namesInWorkspace, pantheonForNewGroup } from "@/fleet/naming";
import { linkOrchestrator } from "@/fleet/orchestrators";
import { missionAddAgent, missionCleanup, missionMerge, missionPrepare, type Cleanup } from "@/ipc/mission";
import { ptySendText, ptyWrite } from "@/ipc/pty";
import { newConversation } from "@/nodes/terminal/launch";
import { quietFor, relaunchTerminal, terminalText } from "@/nodes/terminal/registry";
import { nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { notify } from "./events";
import { NEW_AGENT, NEW_MISSION, oneLine, sameName, type Member, type Mission, type SubTask } from "./mission";
import { whenReady } from "./ready";
import { linkedClaudeAgents, missionOf, setMission, updateMember } from "./store";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What an agent of the mission reads first (spec orchestrateur §7.3, §7.4). */
export function subTaskText(mission: string, task: SubTask, branch: string): string {
  const brief = oneLine(task.brief);
  return (
    `[dummyPlane · mission ${mission}] ${task.title} — ${brief}${/[.!?]$/.test(brief) ? "" : "."} ` +
    `Budget : ${task.budgetMin} min. Branche : ${branch}. ` +
    "Ce worktree est neuf : les dépendances (node_modules…) n'y sont pas installées. " +
    "Déclare tes étapes, délègue à tes sous-agents, commit sur ta branche, puis rends compte avec rendre_compte."
  );
}

/** A linked agent moves to `cwd` in a new conversation: a Claude session does not resume from another folder (spec §7.3). */
function restartIn(nodeId: string, cwd: string) {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  if (!payload) return;
  const patch = { cwd, ...newConversation() };
  nodesStore.getState().update(nodeId, patch);
  relaunchTerminal(nodeId, { ...payload, ...patch }, "new");
}

/** Right of the orchestrator, tops aligned; `launchGroup` moves it down past what it would cover. */
function besideOrchestrator(orchestratorId: string, count: number) {
  const element = canvasStore.getState().api?.getSceneElements().find((e) => e.id === orchestratorId);
  if (!element) return undefined;
  const grid = groupGrid(count);
  return { x: element.x + element.width + GROUP_GAP + grid.width / 2, y: element.y + grid.height / 2 };
}

function newNames(workspaceId: string, pantheon: string, count: number): string[] {
  const names: string[] = [];
  const taken = namesInWorkspace(workspaceId);
  for (let i = 0; i < count; i++) names.push(nextName(pantheon, [...taken, ...names]));
  return names;
}

type Team = Required<Pick<Mission, "project" | "slug" | "branch" | "worktree">> & Pick<Mission, "frameId" | "members">;

/** dummyPlane — not the AI — forms the team: every worktree first, then the agents (spec §7.3). */
async function formTeam(orchestratorId: string, workspaceId: string, project: string, mission: Mission): Promise<Team> {
  const plan = mission.plan ?? [];
  const linked = linkedClaudeAgents(orchestratorId);
  const agents = plan.map((task) => (task.agent === NEW_AGENT ? null : (linked.find((a) => sameName(a.name, task.agent)) ?? null)));
  const lost = plan.find((task, i) => task.agent !== NEW_AGENT && !agents[i]);
  if (lost) throw new Error(`${lost.agent} n'est plus relié à l'orchestrateur.`);
  const pantheon = pantheonForNewGroup(workspaceId);
  const fresh = newNames(workspaceId, pantheon, agents.filter((a) => a === null).length);
  const root = await missionPrepare(project, mission.name ?? "mission");
  const members: Member[] = [];
  let next = 0;
  for (const [i, task] of plan.entries()) {
    const agent = agents[i];
    const name = agent?.name ?? fresh[next++];
    const tree = await missionAddAgent(project, root.slug, name);
    members.push({ nodeId: agent?.nodeId ?? "", name, task: task.title, budgetMin: task.budgetMin, linked: agent !== null, branch: tree.branch, worktree: tree.path });
  }
  for (const member of members) if (member.linked) restartIn(member.nodeId, member.worktree);
  const created = members.filter((m) => !m.linked);
  let frameId: string | undefined;
  if (created.length > 0) {
    const group = await launchGroup(
      { name: `Mission ${mission.name}`, role: "general", agents: created.map(() => "claude" as const) },
      defaultLaunchOptions(),
      besideOrchestrator(orchestratorId, created.length),
      { pantheon, names: created.map((m) => m.name), cwds: created.map((m) => m.worktree) },
    );
    if (!group) throw new Error("Le groupe des nouveaux agents n'a pas pu être créé.");
    created.forEach((member, i) => (member.nodeId = group.nodeIds[i]));
    frameId = group.frameId;
    linkOrchestrator(orchestratorId, group.frameId);
  }
  return { project, slug: root.slug, branch: root.branch, worktree: root.path, frameId, members };
}

/** Types its sub-task in a member's terminal once it is ready (spec §7.3). */
async function assign(orchestratorId: string, member: Member, mission: string, task: SubTask) {
  const id = member.nodeId;
  await whenReady({ running: () => isRunning(id), quietMs: () => quietFor(id), screen: () => terminalText(id, 50), press: (keys) => ptyWrite(id, keys) });
  if (missionOf(nodesStore.getState().nodes[orchestratorId])?.state !== "en_cours") return;
  if (!isRunning(id)) {
    notify(orchestratorId, `${member.name} n'a pas démarré : sa sous-tâche n'est pas envoyée.`);
    return;
  }
  await ptySendText(id, subTaskText(mission, task, member.branch));
  updateMember(orchestratorId, id, { sentAt: Date.now() });
}

/** « Lancer la mission » (spec §7.3): the plan's go-ahead. A second click while it launches does nothing. */
export async function launchMission(orchestratorId: string): Promise<void> {
  const record = nodesStore.getState().nodes[orchestratorId];
  const mission = missionOf(record);
  const session = sessionOf(record);
  if (!record || !mission || !session || mission.state !== "plan" || !mission.plan?.length) return;
  setMission(orchestratorId, { state: "lancement", error: undefined });
  let team: Team;
  try {
    team = await formTeam(orchestratorId, record.workspaceId, session.cwd, mission);
  } catch (error) {
    setMission(orchestratorId, { state: "plan", error: errorText(error) });
    notify(orchestratorId, `La mission n'a pas pu démarrer : ${errorText(error)}`);
    return;
  }
  setMission(orchestratorId, { state: "en_cours", ...team });
  const names = team.members.map((m) => `${m.name} (${m.task})`).join(", ");
  notify(orchestratorId, `Feu vert : l'équipe est formée — ${names}. Branche de la mission : ${team.branch}. Chacun reçoit sa sous-tâche dès que son terminal est prêt.`);
  const plan = mission.plan;
  team.members.forEach((member, i) => void assign(orchestratorId, member, mission.name ?? "", plan[i]));
}

/** `terminer` (spec §7.7): created agents close, linked ones go back to the project. */
export function endMission(orchestratorId: string, summary: string) {
  const mission = missionOf(nodesStore.getState().nodes[orchestratorId]);
  if (mission?.state !== "en_cours") return;
  // Ended first: the agents stopping now are no events.
  setMission(orchestratorId, { state: "terminee", summary });
  for (const member of mission.members) if (member.linked && mission.project) restartIn(member.nodeId, mission.project);
  if (mission.frameId) closeGroup(mission.frameId);
}

/** `fusionner` (spec §7.6): the branches of the agents done since the last merge. */
export async function mergeMission(orchestratorId: string): Promise<string> {
  const mission = missionOf(nodesStore.getState().nodes[orchestratorId]);
  if (!mission?.worktree) return "La mission n'a pas de branche.";
  const ready = mission.members.filter((m) => m.report?.status === "termine" && !m.merged);
  if (ready.length === 0) return "Rien à fusionner : aucun agent n'a rendu compte « termine » depuis la dernière fusion.";
  const lines: string[] = [];
  for (const member of ready) {
    try {
      const { merge, uncommitted } = await missionMerge(mission.worktree, member.worktree, member.branch);
      const note = uncommitted ? " (des changements non commités de son worktree ne sont pas fusionnés)" : "";
      if (merge.kind === "conflict") {
        lines.push(`${member.name} : conflit, fusion annulée — ${merge.files.join(", ")}${note}`);
        continue;
      }
      updateMember(orchestratorId, member.nodeId, { merged: true });
      lines.push(`${member.name} : ${merge.kind === "merged" ? "fusionné" : "rien à fusionner (aucun commit)"}${note}`);
    } catch (error) {
      lines.push(`${member.name} : échec — ${errorText(error)}`);
    }
  }
  return `Branche ${mission.branch} :\n${lines.join("\n")}`;
}

/** « Nettoyer la mission » (spec §7.7): merged worktrees go, the branches stay; the orchestrator is free again. */
export async function cleanMission(orchestratorId: string): Promise<Cleanup | string> {
  const mission = missionOf(nodesStore.getState().nodes[orchestratorId]);
  if (mission?.state !== "terminee") return "La mission n'est pas terminée.";
  try {
    const result = mission.project && mission.slug ? await missionCleanup(mission.project, mission.slug, mission.members.map((m) => m.name)) : { removed: [], kept: [] };
    const next: Mission = { ...NEW_MISSION, maxAgents: mission.maxAgents };
    if (mission.budgetMin !== undefined) next.budgetMin = mission.budgetMin;
    nodesStore.getState().update(orchestratorId, { mission: next });
    return result;
  } catch (error) {
    return errorText(error);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -8`
Expected: types sans erreur ; toute la suite passe.

- [ ] **Step 5: Commit**

```bash
git add src/mission src/fleet/groups.ts src/fleet/groups.test.ts src/nodes/terminal/registry.ts src/nodes/terminal/bufferText.ts src/nodes/terminal/bufferText.test.ts
git commit -m "feat(mission): the go-ahead forms the team in worktrees, then merges and ends the mission"
```

---

### Task 6: Les outils de l'orchestrateur

**Files:**
- Create: `src/mcp/orchestratorTools.ts`
- Modify: `src/mcp/agentTools.ts` (`report`), `src/mcp/router.ts`, `src/mcp/router.test.ts`

**Interfaces:**
- Consumes: Task 4 (`missionOf`, `setMission`, `updateMember`, `memberOf`, `linkedClaudeAgents`, `agentState`, `proposedPlan`, `sameName`, `oneLine`, `notify`) ; Task 5 (`mergeMission`, `endMission`, `terminalText`).
- Produces: `ORCHESTRATOR_TOOLS` (dans l'ordre `mission`, `proposer_plan`, `equipe`, `lire_sortie`, `ecrire`, `fusionner`, `terminer`), `orchestratorTool(orchestratorId, name, args): Promise<ToolResult>` ; `report(nodeId, args): ToolResult`.

- [ ] **Step 1: Write the failing tests**

`src/mcp/router.test.ts` : l'attente `call("chef", "etape", …)` du test des erreurs devient `"Outil réservé aux agents."`. Simulations et imports ajoutés en tête :

```ts
import { ptySendText } from "@/ipc/pty";
import { terminalText } from "@/nodes/terminal/registry";
import { notify } from "@/mission/events";
import { endMission } from "@/mission/launch";
import { missionOf, setMission } from "@/mission/store";
import { agentActivityStore } from "@/store/agentActivity";
import { terminalStatusStore } from "@/store/terminalStatus";

vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "ligne 1\nligne 2") }));
vi.mock("@/mission/launch", () => ({ mergeMission: vi.fn(() => Promise.resolve("Branche dummyplane/auth :\nIsis : fusionné")), endMission: vi.fn() }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/mission/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mission/store")>()),
  linkedClaudeAgents: vi.fn(() => [{ nodeId: "isis", name: "Isis" }]),
}));
```

et à la fin du fichier :

```ts
describe("the orchestrator's tools (spec orchestrateur §7.2)", () => {
  const plan = {
    nom: "Auth",
    tache: "Ajoute l'authentification",
    sous_taches: [
      { titre: "Login", consigne: "Fais le login", agent: "isis", budget_min: 20 },
      { titre: "API", consigne: "Fais l'API", agent: "nouveau", budget_min: 30 },
    ],
  };

  it("lists them for the orchestrator only, and each side refuses the other's", async () => {
    const list = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["mission", "proposer_plan", "equipe", "lire_sortie", "ecrire", "fusionner", "terminer"]);
    expect(textOf(await call("isis", "proposer_plan", plan))).toBe("Outil réservé à l'orchestrateur.");
    expect(textOf(await call("chef", "rendre_compte", { resume: "x", statut: "termine" }))).toBe("Outil réservé aux agents.");
  });

  it("takes a plan that waits for the go-ahead, and describes it in mission()", async () => {
    const wrong = await call("chef", "proposer_plan", { ...plan, sous_taches: [{ ...plan.sous_taches[0], agent: "Zeus" }] });
    expect(wrong).toMatchObject({ isError: true });
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("redaction");
    expect(textOf(await call("chef", "proposer_plan", plan))).toBe(
      "Plan proposé : 2 sous-tâches. Il attend le feu vert de l'utilisateur (« Lancer la mission » dans le panneau de l'orchestrateur).",
    );
    expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({
      etat: "plan",
      nom: "Auth",
      agents_max: 4,
      plan: [{ titre: "Login", agent: "Isis" }, { titre: "API", agent: "nouveau" }],
      agents_relies: [{ prenom: "Isis" }],
    });
  });

  describe("once the team is formed", () => {
    beforeAll(() =>
      setMission("chef", {
        state: "en_cours",
        branch: "dummyplane/auth",
        members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 20, linked: true, branch: "dummyplane/auth-isis", worktree: "C:/w/isis", sentAt: Date.now() }],
      }),
    );

    it("reports the team and reads an agent's terminal", async () => {
      expect(JSON.parse(textOf(await call("chef", "equipe", {})))).toEqual([
        expect.objectContaining({ prenom: "Isis", sous_tache: "Login", temps: "0 / 20 min", compte_rendu: null, fusionne: false }),
      ]);
      expect(textOf(await call("chef", "lire_sortie", { agent: "ISIS", lignes: 2 }))).toBe("ligne 1\nligne 2");
      expect(terminalText).toHaveBeenCalledWith("isis", 2);
      expect(await call("chef", "lire_sortie", { agent: "Zeus" })).toMatchObject({ isError: true });
    });

    it("writes to an agent that runs, never into a dialog meant for the user", async () => {
      terminalStatusStore.getState().set("isis", { state: "stopped" });
      expect(textOf(await call("chef", "ecrire", { agent: "Isis", texte: "Relance" }))).toBe("Isis est arrêté.");
      terminalStatusStore.getState().set("isis", { state: "running" });
      agentActivityStore.getState().apply({ nodeId: "isis", activity: "waiting", since: 0 });
      expect(await call("chef", "ecrire", { agent: "Isis", texte: "Relance" })).toMatchObject({ isError: true });
      agentActivityStore.getState().apply({ nodeId: "isis", activity: "idle", since: 0 });
      expect(textOf(await call("chef", "ecrire", { agent: "Isis", texte: "Relance\nles tests" }))).toBe("Écrit à Isis.");
      expect(ptySendText).toHaveBeenCalledWith("isis", "Relance les tests");
    });

    it("takes an agent's report to its orchestrator", async () => {
      expect(await call("isis", "rendre_compte", { resume: "Fait", statut: "fini" })).toMatchObject({ isError: true });
      expect(textOf(await call("isis", "rendre_compte", { resume: "Login fait", statut: "termine" }))).toBe("Compte rendu transmis à l'orchestrateur.");
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].report).toMatchObject({ summary: "Login fait", status: "termine" });
      expect(notify).toHaveBeenCalledWith("chef", "Isis a rendu compte (termine) : Login fait");
    });

    it("merges and ends the mission through dummyPlane; no new plan meanwhile", async () => {
      expect(textOf(await call("chef", "fusionner", {}))).toBe("Branche dummyplane/auth :\nIsis : fusionné");
      expect(await call("chef", "proposer_plan", plan)).toMatchObject({ isError: true });
      expect(await call("chef", "terminer", {})).toMatchObject({ isError: true });
      expect(textOf(await call("chef", "terminer", { bilan: "Fini" }))).toContain("Mission terminée");
      expect(endMission).toHaveBeenCalledWith("chef", "Fini");
    });
  });
});
```

(`beforeAll` rejoint les imports de `vitest`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mcp 2>&1 | tail -20`
Expected: FAIL — l'orchestrateur reçoit les outils d'agent ; `rendre_compte` ne transmet rien.

- [ ] **Step 3: Write the tools**

`src/mcp/agentTools.ts` (imports `notify` de `@/mission/events`, `oneLine` de `@/mission/mission`, `memberOf, updateMember` de `@/mission/store`) :

```ts
/** `rendre_compte`: outside a mission there is no one to tell; inside, its orchestrator hears it (spec §7.5). */
export function report(nodeId: string, args: Record<string, unknown>): ToolResult {
  const found = memberOf(nodeId);
  if (!found) return said("Pas de mission en cours : rien à transmettre.");
  const summary = typeof args.resume === "string" ? args.resume.trim() : "";
  const status = args.statut;
  if (!summary) return refused("Résume ton travail (resume).");
  if (status !== "termine" && status !== "bloque" && status !== "echec") return refused(`Statut inconnu : ${String(status)} (termine, bloque ou echec).`);
  // A new report after a merge brings new commits: its branch is merged again.
  updateMember(found.orchestratorId, nodeId, { report: { summary, status, at: Date.now() }, merged: false });
  notify(found.orchestratorId, `${found.member.name} a rendu compte (${status}) : ${oneLine(summary)}`);
  return said("Compte rendu transmis à l'orchestrateur.");
}
```

`src/mcp/orchestratorTools.ts` :

```ts
import { ptySendText } from "@/ipc/pty";
import { endMission, mergeMission } from "@/mission/launch";
import { oneLine, proposedPlan, sameName, type Member, type Mission } from "@/mission/mission";
import { agentState, linkedClaudeAgents, missionOf, setMission } from "@/mission/store";
import { terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { refused, said, type ToolResult } from "./agentTools";

const NO_ARGS = { type: "object", properties: {} } as const;

/** The orchestrator's tools (spec orchestrateur §7.2; `prolonger`, `interrompre`, `reattribuer` come with H3). */
export const ORCHESTRATOR_TOOLS = [
  {
    name: "mission",
    description: "La mission : état, nom, tâche, budget global, nombre maximal d'agents, branche, plan, et les agents Claude reliés disponibles.",
    inputSchema: NO_ARGS,
  },
  {
    name: "proposer_plan",
    description: "Propose ton plan : il remplace le plan en attente et attend le feu vert de l'utilisateur (« Lancer la mission » dans le panneau). Une sous-tâche par agent.",
    inputSchema: {
      type: "object",
      properties: {
        nom: { type: "string", maxLength: 60, description: "Nom court de la mission ; il nomme sa branche." },
        tache: { type: "string", description: "La tâche de l'utilisateur, résumée." },
        sous_taches: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              titre: { type: "string", maxLength: 60 },
              consigne: { type: "string" },
              agent: { type: "string", description: "Prénom d'un agent Claude relié, ou « nouveau »." },
              budget_min: { type: "integer", minimum: 1 },
            },
            required: ["titre", "consigne", "agent", "budget_min"],
          },
        },
      },
      required: ["nom", "tache", "sous_taches"],
    },
  },
  {
    name: "equipe",
    description: "Chaque agent de la mission : sous-tâche, état (travaille, attend, inactif, arrêté), étapes, temps passé / budget, compte rendu.",
    inputSchema: NO_ARGS,
  },
  {
    name: "lire_sortie",
    description: "La fin du terminal d'un agent de la mission, en texte simple.",
    inputSchema: { type: "object", properties: { agent: { type: "string" }, lignes: { type: "integer", minimum: 1, maximum: 200 } }, required: ["agent"] },
  },
  {
    name: "ecrire",
    description: "Tape un message dans le terminal d'un agent de la mission (relance, précision). Refusé s'il attend une réponse de l'utilisateur.",
    inputSchema: { type: "object", properties: { agent: { type: "string" }, texte: { type: "string" } }, required: ["agent", "texte"] },
  },
  {
    name: "fusionner",
    description: "Fusionne dans la branche de la mission les branches des agents qui ont rendu compte « termine » ; dit ce qui est fusionné et les conflits.",
    inputSchema: NO_ARGS,
  },
  {
    name: "terminer",
    description: "Clôt la mission avec ton bilan : les agents créés pour elle sont fermés, les agents reliés reviennent dans le dossier du projet.",
    inputSchema: { type: "object", properties: { bilan: { type: "string" } }, required: ["bilan"] },
  },
] as const;

const AGENT_ONLY = new Set(["declarer_etapes", "etape", "rendre_compte"]);
const json = (value: unknown) => said(JSON.stringify(value, null, 2));
const formed = (mission: Mission) => mission.state === "en_cours" || mission.state === "terminee";

function memberNamed(mission: Mission, raw: unknown): Member | string {
  if (!formed(mission)) return "L'équipe n'est pas encore formée.";
  const name = typeof raw === "string" ? raw : "";
  return mission.members.find((m) => sameName(m.name, name)) ?? `« ${name} » n'est pas un agent de la mission.`;
}

function describeMission(orchestratorId: string, mission: Mission): ToolResult {
  const team = new Set(mission.members.map((m) => m.nodeId));
  return json({
    etat: mission.state,
    nom: mission.name ?? null,
    tache: mission.task ?? null,
    budget_global_min: mission.budgetMin ?? null,
    agents_max: mission.maxAgents,
    branche: mission.branch ?? null,
    plan: mission.plan?.map((s) => ({ titre: s.title, consigne: s.brief, agent: s.agent, budget_min: s.budgetMin })) ?? null,
    agents_relies: linkedClaudeAgents(orchestratorId)
      .filter((a) => !team.has(a.nodeId))
      .map((a) => ({ prenom: a.name, etat: agentState(a.nodeId) })),
    erreur: mission.error ?? null,
  });
}

function proposePlan(orchestratorId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state === "lancement" || mission.state === "en_cours") return refused("Une mission est déjà en cours : termine-la avant d'en proposer une autre.");
  if (mission.state === "terminee") return refused("La mission est terminée : l'utilisateur la nettoie depuis le panneau, puis tu pourras proposer un nouveau plan.");
  const result = proposedPlan(args, mission, linkedClaudeAgents(orchestratorId).map((a) => a.name));
  if (typeof result === "string") return refused(result);
  setMission(orchestratorId, { state: "plan", ...result, error: undefined });
  const n = result.plan.length;
  return said(`Plan proposé : ${n} sous-tâche${n > 1 ? "s" : ""}. Il attend le feu vert de l'utilisateur (« Lancer la mission » dans le panneau de l'orchestrateur).`);
}

function describeTeam(mission: Mission): ToolResult {
  if (!formed(mission)) return refused("L'équipe n'est pas encore formée.");
  const nodes = nodesStore.getState().nodes;
  const minutes = (at: number | undefined) => (at === undefined ? 0 : Math.floor((Date.now() - at) / 60_000));
  return json(
    mission.members.map((m) => ({
      prenom: m.name,
      sous_tache: m.task,
      etat: agentState(m.nodeId),
      etapes: terminalOf(nodes[m.nodeId])?.steps?.map((s) => `${s.title} : ${s.state}`) ?? [],
      temps: `${minutes(m.sentAt)} / ${m.budgetMin} min`,
      branche: m.branch,
      compte_rendu: m.report ? { statut: m.report.status, resume: m.report.summary } : null,
      fusionne: m.merged === true,
    })),
  );
}

function readOutput(mission: Mission, args: Record<string, unknown>): ToolResult {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const lines = typeof args.lignes === "number" ? Math.min(200, Math.max(1, Math.floor(args.lignes))) : 50;
  return said(terminalText(member.nodeId, lines) || "(terminal vide)");
}

async function write(mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const text = typeof args.texte === "string" ? oneLine(args.texte) : "";
  if (!text) return refused("Rien à écrire (texte).");
  if (!isRunning(member.nodeId)) return refused(`${member.name} est arrêté.`);
  if (agentActivityStore.getState().activities[member.nodeId]?.activity === "waiting") {
    return refused(`${member.name} attend une réponse de l'utilisateur : ce dialogue est pour lui, signale-le-lui.`);
  }
  await ptySendText(member.nodeId, text);
  return said(`Écrit à ${member.name}.`);
}

function finish(orchestratorId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state !== "en_cours") return refused("Aucune mission en cours.");
  const summary = typeof args.bilan === "string" ? args.bilan.trim() : "";
  if (!summary) return refused("Donne ton bilan (bilan).");
  endMission(orchestratorId, summary);
  return said("Mission terminée. Le bilan est dans le panneau ; l'utilisateur fusionne la branche de la mission dans la sienne.");
}

/** One call of the orchestrator; it acts on its own mission only (spec orchestrateur §4.3). */
export async function orchestratorTool(orchestratorId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const mission = missionOf(nodesStore.getState().nodes[orchestratorId]);
  if (!mission) return refused("Cet orchestrateur n'est plus sur le canvas.");
  switch (name) {
    case "mission":
      return describeMission(orchestratorId, mission);
    case "proposer_plan":
      return proposePlan(orchestratorId, mission, args);
    case "equipe":
      return describeTeam(mission);
    case "lire_sortie":
      return readOutput(mission, args);
    case "ecrire":
      return write(mission, args);
    case "fusionner":
      return mission.state === "en_cours" ? said(await mergeMission(orchestratorId)) : refused("Aucune mission en cours.");
    case "terminer":
      return finish(orchestratorId, mission, args);
    default:
      return refused(AGENT_ONLY.has(name) ? "Outil réservé aux agents." : `Outil inconnu : ${name}`);
  }
}
```

`src/mcp/router.ts` :

```ts
import { mcpReply, onMcpCall, type McpCall } from "@/ipc/mcp";
import { nodesStore, terminalOf } from "@/store/nodes";
import { AGENT_TOOLS, declareSteps, markStep, refused, report } from "./agentTools";
import { ORCHESTRATOR_TOOLS, orchestratorTool } from "./orchestratorTools";

const ORCHESTRATOR_ONLY = new Set<string>(ORCHESTRATOR_TOOLS.map((t) => t.name));

/** The interface's answer to one MCP call of a node, by its kind (spec orchestrateur §4.1, §4.3). */
export async function answer(call: McpCall): Promise<unknown> {
  const record = nodesStore.getState().nodes[call.nodeId];
  const orchestrator = record?.kind === "orchestrator";
  if (call.method === "tools/list") return { tools: orchestrator ? ORCHESTRATOR_TOOLS : AGENT_TOOLS };
  const name = String(call.params.name ?? "");
  const args = (call.params.arguments ?? {}) as Record<string, unknown>;
  if (orchestrator) return orchestratorTool(call.nodeId, name, args);
  if (!terminalOf(record)) return refused("Ce terminal n'est plus sur le canvas.");
  if (ORCHESTRATOR_ONLY.has(name)) return refused("Outil réservé à l'orchestrateur.");
  switch (name) {
    case "declarer_etapes":
      return declareSteps(call.nodeId, args);
    case "etape":
      return markStep(call.nodeId, args);
    case "rendre_compte":
      return report(call.nodeId, args);
    default:
      return refused(`Outil inconnu : ${name}`);
  }
}
```

(`installMcp` reste tel quel.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/mcp 2>&1 | tail -8`
Expected: types sans erreur ; tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/mcp
git commit -m "feat(mcp): the orchestrator's tools, and agents report to it"
```

---

### Task 7: Le panneau de la mission

**Files:**
- Create: `src/mission/MissionPanel.tsx`, `src/mission/MissionPanel.test.tsx`
- Modify: `src/nodes/orchestrator/OrchestratorNode.tsx`, `src/nodes/orchestrator/OrchestratorNode.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`missionOf`, `setMission`, `agentState`, `MAX_AGENTS`), Task 5 (`launchMission`, `cleanMission`).
- Produces: `MissionPanel({ nodeId })`, racine `data-mission={nodeId}` ; une ligne par membre `data-member={name}`.

- [ ] **Step 1: Write the failing tests**

`src/mission/MissionPanel.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { cleanMission, launchMission } from "./launch";
import { NEW_MISSION, type Mission } from "./mission";
import { MissionPanel } from "./MissionPanel";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./launch", () => ({
  launchMission: vi.fn(() => Promise.resolve()),
  cleanMission: vi.fn(() => Promise.resolve({ removed: ["auth-isis", "auth"], kept: [] })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeAll(() => mockIPC(() => undefined));
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function show(mission?: Partial<Mission>) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "orchestrator",
    payload: mission ? { name: "Chef", mission: { ...NEW_MISSION, ...mission } } : { name: "Chef" },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MissionPanel nodeId="chef" />));
}

/** Types in a React-controlled field as a person would. */
function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

it("sets the mission's global budget and team size before the plan (spec §7.1)", async () => {
  await show();
  await act(async () => type(host.querySelector('[aria-label="Budget global (minutes)"]')!, "90"));
  await act(async () => type(host.querySelector(`[aria-label="Nombre maximal d'agents"]`)!, "12"));
  expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ state: "redaction", budgetMin: 90, maxAgents: 8 });
});

it("shows the plan and gives the go-ahead (spec §7.3)", async () => {
  await show({ state: "plan", name: "Auth", task: "Ajoute l'authentification", budgetMin: 60, plan: [{ title: "Login", brief: "Fais le login", agent: "Isis", budgetMin: 20 }] });
  expect(host.textContent).toContain("Fais le login");
  expect(host.textContent).toContain("Total 20 min / 60");
  await act(async () => button("Lancer la mission").click());
  expect(launchMission).toHaveBeenCalledWith("chef");
});

it("shows the team's reports and the summary, and cleans the mission (spec §7.7)", async () => {
  await show({
    state: "terminee",
    name: "Auth",
    branch: "dummyplane/auth",
    summary: "Tout est fait.",
    members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 20, linked: true, branch: "dummyplane/auth-isis", worktree: "C:/w", report: { summary: "ok", status: "termine", at: 1 }, merged: true }],
  });
  expect(host.querySelector('[data-member="Isis"]')?.textContent).toContain("terminé · fusionné");
  expect(host.textContent).toContain("Tout est fait.");
  await act(async () => button("Nettoyer la mission").click());
  expect(cleanMission).toHaveBeenCalledWith("chef");
  expect(toast.success).toHaveBeenCalledWith("Worktrees retirés : auth-isis, auth");
});
```

`OrchestratorNode.test.tsx`, dans le test de la session : `expect(host.querySelector('[data-mission="ancien"]')).not.toBeNull();`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mission/MissionPanel.test.tsx src/nodes/orchestrator 2>&1 | tail -20`
Expected: FAIL — `./MissionPanel` introuvable ; pas de panneau dans le nœud.

- [ ] **Step 3: Write the panel**

`src/mission/MissionPanel.tsx` :

```tsx
import { toast } from "sonner";
import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { linkedAgents, NO_LINKS } from "@/fleet/wires";
import { useActivities } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore, useUi } from "@/store/ui";
import { cleanMission, launchMission } from "./launch";
import { MAX_AGENTS, type Member, type Mission, type MissionState } from "./mission";
import { agentState, missionOf, setMission } from "./store";

const STATE_LABEL: Record<MissionState, string> = {
  redaction: "en attente d'une tâche",
  plan: "plan proposé · attend le feu vert",
  lancement: "formation de l'équipe…",
  en_cours: "en cours",
  terminee: "terminée",
};

const REPORT_LABEL = { termine: "terminé", bloque: "bloqué", echec: "échec" } as const;

/** Under the orchestrator's terminal: settings, plan and go-ahead, team, summary (spec orchestrateur §6, §7). */
export function MissionPanel({ nodeId }: { nodeId: string }) {
  const mission = useNodes((s) => missionOf(s.nodes[nodeId]));
  if (!mission) return null;
  return (
    <section data-mission={nodeId} className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-ov-line px-3 py-2 text-xs text-ov-text-2">
      <header className="flex items-center gap-2">
        <span className="font-semibold uppercase tracking-[0.08em] text-ov-text">Mission{mission.name ? ` · ${mission.name}` : ""}</span>
        <span>{STATE_LABEL[mission.state]}</span>
        {mission.branch && <span className="ml-auto truncate font-mono text-[11px]">{mission.branch}</span>}
      </header>
      {(mission.state === "redaction" || mission.state === "plan") && <Settings nodeId={nodeId} mission={mission} />}
      {mission.state === "redaction" && <p>Écris la tâche dans le terminal : l'orchestrateur proposera son plan ici.</p>}
      {mission.plan && (mission.state === "plan" || mission.state === "lancement") && <Plan nodeId={nodeId} mission={mission} />}
      {mission.error && (
        <p role="alert" className="text-ov-danger">
          {mission.error}
        </p>
      )}
      {(mission.state === "en_cours" || mission.state === "terminee") && <Team members={mission.members} />}
      {mission.state === "terminee" && <Summary nodeId={nodeId} summary={mission.summary ?? ""} />}
    </section>
  );
}

function Settings({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const linking = useUi((s) => s.linking === nodeId);
  const links = useCanvas((s) => s.links[nodeId] ?? NO_LINKS);
  const frames = useCanvas((s) => s.frames);
  const nodes = useNodes((s) => s.nodes);
  const claude = linkedAgents(links, frames).agentIds.filter((id) => terminalOf(nodes[id])?.agent === "claude").length;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1">
        Budget global
        <input
          type="number"
          min={1}
          aria-label="Budget global (minutes)"
          placeholder="aucun"
          value={mission.budgetMin ?? ""}
          onChange={(e) => setMission(nodeId, { budgetMin: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })}
          className="w-16 rounded bg-ov-field px-1 py-0.5 text-ov-text outline-none"
        />
        min
      </label>
      <label className="flex items-center gap-1">
        Agents max
        <input
          type="number"
          min={1}
          max={MAX_AGENTS}
          aria-label="Nombre maximal d'agents"
          value={mission.maxAgents}
          onChange={(e) => {
            const count = Math.round(Number(e.target.value));
            if (count >= 1) setMission(nodeId, { maxAgents: Math.min(MAX_AGENTS, count) });
          }}
          className="w-12 rounded bg-ov-field px-1 py-0.5 text-ov-text outline-none"
        />
      </label>
      <span className="ml-auto">
        {claude} Claude relié{claude > 1 ? "s" : ""}
      </span>
      <button
        type="button"
        onClick={() => uiStore.getState().setLinking(linking ? null : nodeId)}
        className="rounded-full bg-ov-accent px-2.5 py-0.5 text-[11px] font-semibold text-white hover:brightness-110"
      >
        {linking ? "Terminer" : "+ Relier"}
      </button>
    </div>
  );
}

function Plan({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const plan = mission.plan ?? [];
  const total = plan.reduce((sum, s) => sum + s.budgetMin, 0);
  const launching = mission.state === "lancement";
  return (
    <div className="flex flex-col gap-1.5">
      {mission.task && <p className="text-ov-text">{mission.task}</p>}
      <ol className="flex flex-col gap-1">
        {plan.map((task, i) => (
          <li key={i} className="rounded bg-ov-card px-2 py-1">
            <div className="flex items-center gap-2 text-ov-text">
              <span className="font-medium">{task.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-ov-text-2">
                {task.agent} · {task.budgetMin} min
              </span>
            </div>
            <p className="line-clamp-2">{task.brief}</p>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px]">
          Total {total} min{mission.budgetMin ? ` / ${mission.budgetMin}` : ""}
        </span>
        <button
          type="button"
          disabled={launching}
          onClick={() => void launchMission(nodeId)}
          className="ml-auto rounded-full bg-ov-accent px-3 py-1 text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          {launching ? "Lancement…" : "Lancer la mission"}
        </button>
      </div>
    </div>
  );
}

function Team({ members }: { members: readonly Member[] }) {
  // The agents' states follow their activity and their processes.
  useActivities();
  useStore(terminalStatusStore, (s) => s.statuses);
  const nodes = useNodes((s) => s.nodes);
  return (
    <ul className="flex flex-col gap-1">
      {members.map((member) => {
        const steps = terminalOf(nodes[member.nodeId])?.steps ?? [];
        const done = steps.filter((s) => s.state === "fait").length;
        return (
          <li key={member.nodeId || member.name} data-member={member.name} className="flex items-center gap-2 rounded bg-ov-card px-2 py-1">
            <span className="font-medium text-ov-text">{member.name}</span>
            <span className="min-w-0 truncate">{member.task}</span>
            <span className="ml-auto shrink-0">{agentState(member.nodeId)}</span>
            {steps.length > 0 && (
              <span className="shrink-0 font-mono text-[11px]">
                {done}/{steps.length}
              </span>
            )}
            {member.report && (
              <span title={member.report.summary} className="shrink-0 rounded-full bg-ov-field px-1.5 text-[11px] text-ov-text">
                {REPORT_LABEL[member.report.status]}
                {member.merged ? " · fusionné" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Summary({ nodeId, summary }: { nodeId: string; summary: string }) {
  const clean = async () => {
    const result = await cleanMission(nodeId);
    if (typeof result === "string") toast.error(`Nettoyage impossible : ${result}`);
    else toast.success(`Worktrees retirés : ${result.removed.join(", ") || "aucun"}${result.kept.length ? ` · gardés : ${result.kept.join(", ")}` : ""}`);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <p className="whitespace-pre-wrap text-ov-text">{summary}</p>
      <button type="button" onClick={() => void clean()} className="self-end rounded-full border border-ov-line px-3 py-1 text-[11px] text-ov-text hover:bg-ov-card">
        Nettoyer la mission
      </button>
    </div>
  );
}
```

`OrchestratorNode.tsx` : le bandeau « N agents · M groupes » + « + Relier » est remplacé par `<MissionPanel nodeId={nodeId} />` (le bouton « + Relier » vit désormais dans les réglages du panneau) ; imports devenus inutiles retirés (`agentsText`, `groupsText`, `useUi`, `uiStore`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -8`
Expected: types sans erreur ; toute la suite passe.

- [ ] **Step 5: Commit**

```bash
git add src/mission/MissionPanel.tsx src/mission/MissionPanel.test.tsx src/nodes/orchestrator
git commit -m "feat(mission): the mission's panel under the orchestrator's terminal"
```

---

### Task 8: Vérification réelle et livraison

**Files:**
- Modify: `BACKLOG.md` (constats)

- [ ] **Step 1: A throwaway repository** — dans le scratchpad, `h2-repo/demo` : `git init -b main`, un `README.md`, un commit (identité locale du dépôt). Jamais de vrai dépôt de l'utilisateur.

- [ ] **Step 2: The orchestrator's session in the real app** (profil `dev.dummyplane.probe`, `crisp/cdp.mjs`) — ouvrir `demo` comme projet ; placer un orchestrateur ; vérifier :
  - le fichier de réglages de sa session contient `permissions.deny` = `Edit`, `Write`, `NotebookEdit` ; son `.md` est la consigne d'orchestrateur ;
  - sa session démarre dans son nœud (accepter l'invite de confiance de `demo` à la main, par `ptyWrite`) ;
  - `node scripts/mcp-probe.mjs <appdata>/mcp/<orch>.json tools/list` donne les sept outils de l'orchestrateur ;
  - « Coller » du menu radial colle dans son terminal ; l'arrivée (Ctrl+P) lui donne le clavier.

- [ ] **Step 3: A short real mission** — taper dans l'orchestrateur une tâche de deux sous-tâches triviales pour deux agents nouveaux (« crée hello.txt contenant hello et commit », « crée bye.txt contenant bye et commit »), budget 5 min chacune. Vérifier :
  - le plan s'affiche dans le panneau ; « Lancer la mission » (clic DOM) forme le groupe « Mission <nom> » à droite, relié ;
  - `git -C demo worktree list` et `git -C demo branch` : la branche et le worktree de la mission, ceux des deux agents, rien dans `demo` lui-même ;
  - l'invite de confiance des worktrees est acceptée et la sous-tâche tapée ; les frises s'allument ;
  - les comptes rendus arrivent dans l'orchestrateur (`[dummyPlane] … a rendu compte`), qui fusionne puis termine (ou `fusionner` / `terminer` par `mcp-probe.mjs` s'il ne le fait pas) ; la branche de la mission contient `hello.txt` et `bye.txt` ;
  - « Nettoyer la mission » retire les worktrees ; les branches restent.

- [ ] **Step 4: Build and hand over** — `pnpm test`, `cargo test --lib`, `pnpm tauri build` ; copier `dummyPlane-H2.exe` dans `C:\Users\Spectrum\dummyPlane-builds\`, repointer le raccourci « dummyPlane (dernière build) » ; consigner les constats dans `BACKLOG.md` ; supprimer le dépôt jetable.

- [ ] **Step 5: Commit**

```bash
git add BACKLOG.md
git commit -m "docs(backlog): findings of plan H2"
```
