# dummyPlane — Plan B3 : commande et orchestrateur (jalon J5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Piloter la flotte : une barre de commande qui tape une consigne dans les agents ciblés (`@tous`, `@groupe`, `@prénom` ou la sélection), un nœud orchestrateur relié par des flèches à des groupes et des terminaux, et la pause et la reprise des agents (puces, menus, survol).

**Architecture:** Rust gagne deux commandes : `pty_send_text` colle le texte (encadré en collage « bracketed » quand le programme l'a demandé, mode suivi dans sa sortie) puis valide par Entrée 30 ms plus tard, et `pty_interrupt` envoie la touche d'interruption de l'agent. Le front calcule tout le reste par des fonctions pures testées : cibles (`fleet/targets.ts`), envoi et pause (`fleet/broadcast.ts`), historique (`fleet/history.ts`), liaisons de l'orchestrateur dérivées des flèches Excalidraw (`fleet/wires.ts`). Les composants restent minces : `CommandInput` sert à la barre et au pied de l'orchestrateur, `AgentRow` au panneau Flotte et à l'orchestrateur.

**Tech Stack:** Rust (Tauri 2, portable-pty), React 19, TypeScript, Zustand, Excalidraw 0.18.1 (figé), Vitest 5 (+ happy-dom, `@tauri-apps/api/mocks`).

**Spec:** `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (§5.5, §5.6, §8, §11.4, §12, §13, §14, §15.2, §15.3, §19), amendée à la tâche 1.

## Global Constraints

- Interface en français, thème sombre ; code et commentaires en anglais (spec §21).
- Barre de commande : 560 px de large, fond `--ov-command`, rayon 16 ; orbe orange animée (CSS pur) à gauche ; champ « Écris une consigne · @ pour cibler… » ; bouton Envoyer rond, gris si désactivé, orange sinon (spec §5.6).
- Ciblage : `@tous`, puis les groupes (`@backend` : nom sans espaces ni accents, en minuscules), puis les agents (`@isis`) ; insensible à la casse et aux accents ; Tab ou Entrée insère la cible ; cibles en puces au début du champ (fond teinté, ×) ; sans `@`, la sélection (terminaux sélectionnés et membres des groupes sélectionnés) ; sans cible ni sélection, Envoyer grisé et indice « Sélectionne des agents ou tape @ » ; prénom ambigu : les deux dans la liste avec leur groupe (spec §12).
- Envoi : Entrée (Maj+Entrée = nouvelle ligne) ; les terminaux arrêtés sont ignorés, toast « 2 agents arrêtés ignorés : Thot, Anubis » ; le champ se vide, les cibles restent ; ↑ et ↓ parcourent les 50 dernières consignes, mémorisées par projet dans `settings` ; indice ponctuel « Essaie « @tous lance les tests » » (×, ne revient plus) (spec §12).
- `pty_send_text` : le texte collé, puis `\r` 30 ms plus tard ; erreur si le processus n'existe pas (spec §15.3, amendée tâche 1).
- Pause : la séquence d'interruption de l'agent (Échap pour Claude, Codex, Gemini, Qwen Code, Cursor, OpenCode ; Ctrl+C pour Aider, Ollama, Personnalisé ; rien pour Shell). Reprendre : « continue ». Tout reprendre : seuls les agents mis en pause par dummyPlane depuis moins de 24 h. Toast récapitulatif « 5 agents mis en pause » (spec §8, §14).
- Orchestrateur : élément intégré `dummyplane://orchestrator/<id>`, 320 × 420 ; charge utile `{ "name": "Orchestrateur" }` ; liaison = flèche Excalidraw liée de l'orchestrateur à un cadre de groupe ou un terminal, `customData = { "dummyplane": { "kind": "wire" } }`, trait orange, courbe, sans tête ; destinataires dérivés des flèches ; historique partagé avec la barre (spec §13).
- Aucun bouton inactif (spec §18).
- Tests : `pnpm test` (front) ; `cargo test --manifest-path src-tauri/Cargo.toml --lib` (Rust) ; `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` et `cargo fmt --manifest-path src-tauri/Cargo.toml --check` propres ; `pnpm exec tsc --noEmit` et `pnpm build` propres.
- Arrêter l'application de développement avant toute modification Rust ; ne jamais faire tourner deux instances sur la même base (vérification sur le profil `dev.dummyplane.probe`). Ne pas modifier `Canvas.tsx` ni `canvasStore.ts` pendant que l'application tourne (le rechargement à chaud remonte une scène périmée) : la fermer d'abord.
- Conventional Commits ; chaque message de commit finit par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Une consigne de plusieurs lignes arrive à Claude en un seul message et n'est validée qu'une fois ; un texte qui contient un marqueur de fin de collage ne peut pas faire taper le reste comme des touches (tests : tâche 1, `paste.rs`).
2. Une diffusion vers des agents arrêtés, ou dont le processus meurt pendant l'envoi, ne fait pas échouer les autres : ils sont comptés dans le toast des ignorés (tests : tâche 4, `sendToAgents`).
3. « Tout reprendre » ne relance jamais un agent qui a fini de lui-même, mis en pause il y a plus de 24 h, encore en cours, ou un Shell (tests : tâche 4, `resumeCandidates`).
4. Supprimer la flèche, l'orchestrateur ou le groupe relié coupe la liaison ; une flèche dessinée à la main, dans un sens ou dans l'autre, compte ; un cadre simple n'est pas une cible (tests : tâche 8, `orchestratorTargets`).
5. Un `@nom` tapé sans la liste est envoyé à la bonne cible ou laissé dans le texte s'il est ambigu ou inconnu, jamais deviné ; une adresse `a@b.fr` reste du texte (tests : tâche 3, `extractMentions`).

---

## File Structure

Rust (`src-tauri/src/`) :
- `pty/paste.rs` (nouveau) : suivi du mode de collage encadré et octets d'un collage.
- `pty/session.rs`, `pty/mod.rs`, `pty/shell.rs` : séquence d'interruption de l'agent, `send_text`, `interrupt`.
- `commands/pty.rs`, `lib.rs` : `pty_send_text`, `pty_interrupt`.
- `db/nodes.rs` : type de nœud `orchestrator`.

Front (`src/`) :
- `ipc/pty.ts` : `ptySendText`, `ptyInterrupt` (file d'écriture commune avec `ptyWrite`).
- `canvas/nodeElement.ts`, `nodes/types.ts`, `store/nodes.ts` (+ consommateurs) : nœud orchestrateur dans les données.
- `fleet/targets.ts` (+ test), `fleet/broadcast.ts` (+ test), `fleet/history.ts` (+ test), `fleet/wires.ts` (+ test), `fleet/groupSummary.ts`, `fleet/groupLayout.ts`.
- `fleet/CommandInput.tsx`, `shell/CommandBar.tsx`, `shell/ProjectView.tsx`, `index.css` (orbe animée).
- `fleet/AgentRow.tsx`, `fleet/FleetPanel.tsx`, `shell/ActionChips.tsx`, `fleet/GroupMenu.tsx`, `fleet/groups.ts`.
- `fleet/orchestrators.ts`, `fleet/LinkMode.tsx`, `nodes/orchestrator/OrchestratorNode.tsx`, `nodes/NodeHost.tsx`, `canvas/canvasStore.ts` (`links`), `canvas/Canvas.tsx`, `store/ui.ts` (`linking`).

---

### Task 1: Rust — coller une consigne et interrompre un agent

**Files:**
- Create: `src-tauri/src/pty/paste.rs`
- Modify: `src-tauri/src/pty/mod.rs`, `src-tauri/src/pty/session.rs`, `src-tauri/src/pty/shell.rs`, `src-tauri/src/commands/pty.rs`, `src-tauri/src/commands/test_support.rs`, `src-tauri/src/lib.rs`
- Modify: `src/ipc/pty.ts`, `src/ipc/pty.test.ts`
- Modify: `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (§12, §13, §14, §15.3)

**Interfaces:**
- Consumes: `commands::agents::input(app, node_id, data)` (plan B2) : une frappe rend la main à l'activité du terminal.
- Produces: Rust `PtyManager::send_text(&self, node_id: &str, text: &str) -> AppResult<()>`, `PtyManager::interrupt(&self, node_id: &str) -> AppResult<Option<&'static [u8]>>`, `shell::interrupt_sequence(agent: Agent) -> Option<&'static [u8]>`, `SpawnPlan.interrupt: Option<&'static [u8]>` ; commandes `pty_send_text(nodeId, text)` et `pty_interrupt(nodeId) -> bool` ; TS `ptySendText(nodeId: string, text: string): Promise<void>`, `ptyInterrupt(nodeId: string): Promise<boolean>`.

Vérifié avant ce plan : ConPTY transmet au terminal les `ESC[?2004h` / `ESC[?2004l` qu'un programme écrit (sonde sur `cmd /c echo`). Le mode peut donc être suivi dans la sortie, comme le fait xterm, et le texte n'est encadré que pour un programme qui l'a demandé : un Shell qui ne l'a pas demandé recevrait les marqueurs comme des touches.

- [ ] **Step 1: Amend the spec**

Dans `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` :

§12, après la ligne « - Prénom ambigu (deux agents portant le même) : les deux apparaissent dans la liste avec leur groupe. », ajouter :

```markdown
  - Un `@nom` tapé sans passer par la liste (« @tous lance les tests ») devient une cible à l'envoi s'il désigne exactement une cible ; un prénom ambigu ou inconnu reste dans le texte. Une adresse `a@b.fr` n'est pas une cible (le `@` doit commencer un mot).
```

§13, remplacer la ligne de l'en-tête :

```markdown
- En-tête : orbe, « Orchestrateur » (renommable), anneau de progression `◌ 3/8` (agents en activité / agents reliés).
```

par :

```markdown
- En-tête : orbe, « Orchestrateur » (renommable par double-clic), anneau de progression `◌ 3/8` (agents en activité / agents reliés), menu `⌄` (Tout mettre en pause, Tout reprendre) et × (supprime l'orchestrateur et ses liaisons en une étape d'annulation).
```

§13, dans la ligne « - « Relier » passe en mode liaison : … », remplacer « chaque clic sur un groupe ou un terminal crée la flèche ; » par « chaque clic sur un groupe ou un terminal crée la flèche (un clic sur un terminal membre d'un groupe relie le groupe) ; ».

§14, ajouter à la fin de la section (avant « ## 15. ») :

```markdown
- Survol d'un agent (panneau Flotte, orchestrateur) : Pause est proposée quand il est EN COURS, Reprendre quand il est PRÊT (demande explicite : sans limite de 24 h).
- Les mises en pause faites par dummyPlane sont retenues en mémoire : un rechargement de la fenêtre les oublie.
- L'interruption et l'Entrée qui suit une consigne comptent comme une réponse de l'utilisateur pour l'activité (§10.2, règle 4) : un agent interrompu repasse PRÊT dès que sa sortie se tait.
```

§15.3, remplacer les deux lignes :

```markdown
| PTY | `pty_send_text(nodeId, text)` | `ESC[200~` + texte + `ESC[201~`, puis `\r` 30 ms plus tard ; erreur si le processus n'existe pas |
| | `pty_interrupt(nodeId)` | séquence d'interruption de l'agent du nœud |
```

par :

```markdown
| PTY | `pty_send_text(nodeId, text)` | le texte, sauts de ligne en `\r`, encadré par `ESC[200~` et `ESC[201~` quand le programme a activé le collage encadré (`ESC[?2004h`, suivi dans sa sortie : ConPTY le transmet), tel quel sinon ; les marqueurs de collage présents dans le texte sont retirés ; puis `\r` 30 ms plus tard ; erreur si le processus n'existe pas |
| | `pty_interrupt(nodeId) -> bool` | séquence d'interruption de l'agent du nœud ; `false` pour un Shell, qui n'en a pas |
```

- [ ] **Step 2: Write the failing Rust tests**

Créer `src-tauri/src/pty/paste.rs` avec seulement ses tests (l'implémentation vient à l'étape 4) :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_mode_even_when_a_switch_is_split_across_reads() {
        let mut mode = PasteMode::default();
        assert!(!mode.is_on());
        mode.feed(b"prompt\x1b[?20");
        assert!(!mode.is_on());
        mode.feed(b"04h> ");
        assert!(mode.is_on());
        mode.feed(b"bye\x1b[?2004l");
        assert!(!mode.is_on());
        // Within one read, the last switch wins.
        mode.feed(b"\x1b[?2004hx\x1b[?2004ly\x1b[?2004h");
        assert!(mode.is_on());
        mode.feed(b"plain output");
        assert!(mode.is_on());
    }

    #[test]
    fn wraps_the_text_only_when_the_program_asked_for_it() {
        assert_eq!(
            paste_payload("lance\nles tests", true),
            b"\x1b[200~lance\rles tests\x1b[201~"
        );
        assert_eq!(paste_payload("a\r\nb", false), b"a\rb");
        assert_eq!(paste_payload("continue", false), b"continue");
    }

    #[test]
    fn drops_paste_markers_found_in_the_text() {
        assert_eq!(
            paste_payload("x\x1b[201~rm\x1b[200~y", true),
            b"\x1b[200~xrmy\x1b[201~"
        );
    }
}
```

Dans `src-tauri/src/pty/mod.rs`, ajouter `pub mod paste;` après `pub mod scrollback;`, et dans `mod windows_tests` (après `rejects_a_second_spawn_for_the_same_node_and_resizes`) :

```rust
    #[test]
    fn follows_the_paste_mode_the_program_asks_for() {
        let mgr = PtyManager::default();
        let sink = VecSink::default();
        let exited = spawn_answering(
            &mgr,
            "i",
            cmd_plan(&["/k", "echo \x1b[?2004hpaste-mode-on"], None),
            sink.clone(),
        );
        wait_until("mode switch", || sink.text().contains("paste-mode-on"));
        assert!(mgr.pastes_bracketed("i"));
        mgr.kill("i");
        wait_exit(&exited);
    }

    #[test]
    fn types_a_command_then_validates_it_with_enter() {
        let mgr = PtyManager::default();
        let sink = VecSink::default();
        let exited = spawn_answering(&mgr, "j", cmd_plan(&[], None), sink.clone());
        wait_until("prompt", || sink.text().contains('>'));
        mgr.send_text("j", "echo sent-by-dummyplane").unwrap();
        // The typed line, then what the command printed.
        wait_until("command output", || {
            sink.text().matches("sent-by-dummyplane").count() >= 2
        });
        mgr.write("j", b"exit\r").unwrap();
        wait_exit(&exited);
    }

    #[test]
    fn interrupts_with_the_agent_key_and_not_a_plain_shell() {
        let mgr = PtyManager::default();
        let mut plan = cmd_plan(&[], None);
        plan.interrupt = Some(b"\x03");
        let agent = spawn_answering(&mgr, "k", plan, VecSink::default());
        let shell = spawn_answering(&mgr, "l", cmd_plan(&[], None), VecSink::default());
        assert_eq!(mgr.interrupt("k").unwrap(), Some(&b"\x03"[..]));
        assert_eq!(mgr.interrupt("l").unwrap(), None);
        assert_eq!(mgr.interrupt("nope").unwrap_err().kind(), "notFound");
        assert_eq!(mgr.send_text("nope", "x").unwrap_err().kind(), "notFound");
        mgr.kill_all();
        wait_exit(&agent);
        wait_exit(&shell);
    }
```

Dans le `cmd_plan` de ces tests, ajouter le champ `interrupt: None,` après `initial_input: initial_input.map(str::to_string),`.

Dans `src-tauri/src/pty/shell.rs`, module `tests`, après `plan_types_command_with_carriage_return_and_sets_env` :

```rust
    #[test]
    fn interrupt_keys_follow_the_catalog() {
        assert_eq!(interrupt_sequence(Agent::Claude), Some(&b"\x1b"[..]));
        assert_eq!(interrupt_sequence(Agent::Opencode), Some(&b"\x1b"[..]));
        assert_eq!(interrupt_sequence(Agent::Aider), Some(&b"\x03"[..]));
        assert_eq!(interrupt_sequence(Agent::Custom), Some(&b"\x03"[..]));
        assert_eq!(interrupt_sequence(Agent::Shell), None);
        let plan = build_plan(
            "node-1",
            &spec(Agent::Codex, None),
            &nothing_on_path,
            &AgentHooks::default(),
        )
        .unwrap();
        assert_eq!(plan.interrupt, Some(&b"\x1b"[..]));
    }
```

Dans `src-tauri/src/commands/test_support.rs`, ajouter `interrupt: None,` après `initial_input: None,`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | grep -E "^error" | sort | uniq -c`
Expected: FAIL à la compilation — `PasteMode`, `paste_payload`, `interrupt_sequence`, `send_text`, `interrupt`, `pastes_bracketed` et le champ `interrupt` de `SpawnPlan` n'existent pas.

- [ ] **Step 4: Write the implementation**

En tête de `src-tauri/src/pty/paste.rs`, avant le module de tests :

```rust
//! A command typed into a terminal as a paste (spec habillage §15.3): wrapped
//! in bracketed paste when the program asked for it, so an agent takes several
//! lines as one message, then validated with Enter.

use std::time::Duration;

/// Enter follows the paste after this delay: an agent that reads both at once
/// may take the Enter as part of the paste.
pub const ENTER_DELAY: Duration = Duration::from_millis(30);

const MODE_ON: &[u8] = b"\x1b[?2004h";
const MODE_OFF: &[u8] = b"\x1b[?2004l";
const PASTE_START: &str = "\x1b[200~";
const PASTE_END: &str = "\x1b[201~";

/// The program's bracketed paste mode, followed in its output (ConPTY forwards
/// `ESC[?2004h` and `ESC[?2004l`). A switch may be split across two reads.
#[derive(Debug, Default)]
pub struct PasteMode {
    on: bool,
    tail: Vec<u8>,
}

impl PasteMode {
    pub fn feed(&mut self, chunk: &[u8]) {
        let mut data = std::mem::take(&mut self.tail);
        data.extend_from_slice(chunk);
        match (find_last(&data, MODE_ON), find_last(&data, MODE_OFF)) {
            (Some(on), Some(off)) => self.on = on > off,
            (Some(_), None) => self.on = true,
            (None, Some(_)) => self.on = false,
            (None, None) => {}
        }
        // Shorter than a whole switch, so none is ever counted twice.
        let keep = data.len().min(MODE_ON.len() - 1);
        self.tail = data.split_off(data.len() - keep);
    }

    pub fn is_on(&self) -> bool {
        self.on
    }
}

fn find_last(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

/// What is written for `text`: line breaks as Enter (`\r`, as xterm does for a
/// paste), inside paste markers when `bracketed`. Markers found in the text are
/// dropped: they would end the paste early and type the rest as keys.
pub fn paste_payload(text: &str, bracketed: bool) -> Vec<u8> {
    let clean = text
        .replace(PASTE_START, "")
        .replace(PASTE_END, "")
        .replace("\r\n", "\r")
        .replace('\n', "\r");
    if bracketed {
        format!("{PASTE_START}{clean}{PASTE_END}").into_bytes()
    } else {
        clean.into_bytes()
    }
}
```

`src-tauri/src/pty/shell.rs` — dans `SpawnPlan`, après le champ `initial_input` :

```rust
    /// What `pty_interrupt` writes: the agent's interrupt key (spec §8).
    pub interrupt: Option<&'static [u8]>,
```

après la fonction `binary` :

```rust
/// What stops an agent's current turn (spec §8): Escape, or Ctrl+C for the
/// agents that take it; nothing for a plain shell.
pub fn interrupt_sequence(agent: Agent) -> Option<&'static [u8]> {
    match agent {
        Agent::Claude
        | Agent::Codex
        | Agent::Gemini
        | Agent::Qwen
        | Agent::Cursor
        | Agent::Opencode => Some(b"\x1b"),
        Agent::Aider | Agent::Ollama | Agent::Custom => Some(b"\x03"),
        Agent::Shell => None,
    }
}
```

et dans `build_plan`, après `initial_input,` du `SpawnPlan` construit : `interrupt: interrupt_sequence(spec.agent),`.

`src-tauri/src/pty/session.rs` :
- import : `use super::paste::PasteMode;` ;
- `Session` : ajouter les champs `paste: Mutex<PasteMode>,` et `interrupt: Option<&'static [u8]>,` (après `output`) ;
- `Session::start`, dans `Arc::new(Session { … })` : `paste: Mutex::new(PasteMode::default()),` et `interrupt: plan.interrupt,` ;
- dans `spawn_reader`, juste après `let chunk = &buf[..n];` et avant le bloc qui pousse le morceau dans le scrollback : `session.paste.lock().unwrap().feed(chunk);` (avant l'envoi au front : quand un morceau est visible, son mode est déjà connu) ;
- méthodes, après `write` :

```rust
    /// The program asked for bracketed paste (`ESC[?2004h`) and did not take it back.
    pub fn pastes_bracketed(&self) -> bool {
        self.paste.lock().unwrap().is_on()
    }

    /// Writes the agent's interrupt key; `None` for a plain shell.
    pub fn interrupt(&self) -> AppResult<Option<&'static [u8]>> {
        if let Some(key) = self.interrupt {
            self.write(key)?;
        }
        Ok(self.interrupt)
    }
```

`src-tauri/src/pty/mod.rs` — import `use paste::{ENTER_DELAY, paste_payload};` et, dans `impl PtyManager` après `write` :

```rust
    /// Types `text` as a paste, then Enter after `ENTER_DELAY` (spec §15.3).
    /// Blocks for that delay: call it off the async runtime.
    pub fn send_text(&self, node_id: &str, text: &str) -> AppResult<()> {
        let session = self.require(node_id)?;
        session.write(&paste_payload(text, session.pastes_bracketed()))?;
        std::thread::sleep(ENTER_DELAY);
        session.write(b"\r")
    }

    /// Stops the agent's turn with its own key (spec §14); `None` for a plain
    /// shell, which has none.
    pub fn interrupt(&self, node_id: &str) -> AppResult<Option<&'static [u8]>> {
        self.require(node_id)?.interrupt()
    }

    #[cfg(test)]
    fn pastes_bracketed(&self, node_id: &str) -> bool {
        self.get(node_id)
            .is_some_and(|session| session.pastes_bracketed())
    }
```

`src-tauri/src/commands/pty.rs`, après `pty_write` :

```rust
/// The command bar, the orchestrator and "Reprendre" type into terminals this
/// way (spec habillage §12, §15.3). The Enter counts as the user's answer for
/// the agent's activity.
#[tauri::command]
pub async fn pty_send_text(app: AppHandle, node_id: String, text: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<PtyManager>().send_text(&node_id, &text)?;
        agents::input(&app, &node_id, b"\r");
        Ok(())
    })
    .await
    .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
}

/// "Pause" (spec §14): false for a plain shell. The key counts as the user's
/// answer, so a hooked agent's activity follows its output again.
#[tauri::command]
pub async fn pty_interrupt(
    app: AppHandle,
    pty: State<'_, PtyManager>,
    node_id: String,
) -> AppResult<bool> {
    let sent = pty.interrupt(&node_id)?;
    if let Some(key) = sent {
        agents::input(&app, &node_id, key);
    }
    Ok(sent.is_some())
}
```

`src-tauri/src/lib.rs` : après `commands::pty::pty_write,`, ajouter `commands::pty::pty_send_text,` et `commands::pty::pty_interrupt,`.

- [ ] **Step 5: Run the Rust tests to verify they pass**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | grep -E "test result|FAILED|panicked"`
Expected: `test result: ok.` (117 + 7 tests), puis `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` propre.

- [ ] **Step 6: Write the failing front test**

Dans `src/ipc/pty.test.ts`, importer aussi `ptyInterrupt, ptySendText` depuis `./pty`, et ajouter :

```ts
it("types a command after the keystrokes already sent to the terminal", async () => {
  const calls: string[] = [];
  let release!: () => void;
  mockIPC((cmd) => {
    calls.push(cmd);
    if (cmd === "pty_write") return new Promise<void>((resolve) => (release = resolve));
    if (cmd === "pty_interrupt") return true;
  });
  const typed = ptyWrite("node-3", "a");
  const sent = ptySendText("node-3", "lance les tests");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual(["pty_write"]); // the command waits for the keystroke
  release();
  await Promise.all([typed, sent]);
  expect(calls).toEqual(["pty_write", "pty_send_text"]);
  expect(await ptyInterrupt("node-3")).toBe(true);
});
```

Run: `pnpm vitest run src/ipc/pty.test.ts`
Expected: FAIL — `ptySendText` n'est pas exporté.

- [ ] **Step 7: Write the front wrappers**

Dans `src/ipc/pty.ts`, remplacer la fonction `ptyWrite` (et son commentaire, qui reste au-dessus de `queued`) par :

```ts
// Tauri runs async commands concurrently, so two writes sent back to back could
// reach the PTY swapped. Each terminal's writes are chained to keep their order.
const writeQueues = new Map<string, Promise<unknown>>();

function queued<T>(nodeId: string, run: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(nodeId) ?? Promise.resolve();
  const result = previous.then(run);
  const tail = result.catch(() => undefined);
  writeQueues.set(nodeId, tail);
  void tail.then(() => {
    if (writeQueues.get(nodeId) === tail) writeQueues.delete(nodeId);
  });
  return result;
}

export function ptyWrite(nodeId: string, data: string): Promise<void> {
  return queued(nodeId, () => call<void>("pty_write", { nodeId, data }));
}

/** Types a command into the terminal, then Enter (spec habillage §15.3). */
export function ptySendText(nodeId: string, text: string): Promise<void> {
  return queued(nodeId, () => call<void>("pty_send_text", { nodeId, text }));
}

/** Interrupts the agent's turn; false for a plain shell (spec §14). */
export function ptyInterrupt(nodeId: string): Promise<boolean> {
  return queued(nodeId, () => call<boolean>("pty_interrupt", { nodeId }));
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run src/ipc/pty.test.ts`
Expected: PASS. Puis `pnpm exec tsc --noEmit` et `pnpm test` : aucune erreur.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/pty/paste.rs src-tauri/src/pty/mod.rs src-tauri/src/pty/session.rs src-tauri/src/pty/shell.rs src-tauri/src/commands/pty.rs src-tauri/src/commands/test_support.rs src-tauri/src/lib.rs src/ipc/pty.ts src/ipc/pty.test.ts docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md
git commit -m "feat(pty): type a command as a paste and interrupt an agent"
```

---

### Task 2: Le nœud orchestrateur dans les données

**Files:**
- Modify: `src-tauri/src/db/nodes.rs`
- Modify: `src/canvas/nodeElement.ts`, `src/canvas/nodeElement.test.ts`
- Modify: `src/nodes/types.ts`, `src/nodes/types.test.ts`
- Modify: `src/store/nodes.ts`, `src/store/nodes.test.ts`
- Modify: `src/fleet/FleetPanel.tsx`, `src/fleet/terminals.ts`, `src/nodes/terminal/registry.ts`, `src/nodes/terminal/TerminalNode.tsx`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `NodeKind` inclut `"orchestrator"` (`NODE_SIZE.orchestrator = { width: 320, height: 420 }`) ; `interface OrchestratorPayload { name: string }`, `ORCHESTRATOR_NAME = "Orchestrateur"`, `readOrchestratorPayload(raw: unknown): OrchestratorPayload`, `NodePayload = TerminalPayload | OrchestratorPayload` ; `NodeRecord` union discriminée par `kind` (`"terminal"` / `"orchestrator"`) ; `terminalOf(record: NodeRecord | undefined): TerminalPayload | undefined` ; `update(id, patch: Partial<TerminalPayload> | Partial<OrchestratorPayload>)`. Rust `NodeKind::Orchestrator`.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/db/nodes.rs`, module `tests` :

```rust
    #[test]
    fn stores_orchestrator_nodes() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                save(conn, "o1", &w.id, NodeKind::Orchestrator, r#"{"name":"Chef"}"#)?;
                let kind: String =
                    conn.query_row("SELECT kind FROM nodes WHERE id = 'o1'", [], |r| r.get(0))?;
                assert_eq!(kind, "orchestrator");
                Ok(())
            })
            .unwrap();
    }
```

`src/canvas/nodeElement.test.ts`, dans `describe("createNodeElement", …)` :

```ts
  it("makes a 320 × 420 orchestrator linked to its own id", () => {
    const element = createNodeElement("orchestrator", { x: 0, y: 0 });
    expect(element).toMatchObject({ x: -160, y: -210, width: 320, height: 420, customData: { kind: "orchestrator" } });
    expect(element.link).toBe(`dummyplane://orchestrator/${element.id}`);
    expect(isdummyPlaneLink(element.link!)).toBe(true);
    expect(nodeKindOf(element as unknown as ExcalidrawElement)).toBe("orchestrator");
  });
```

`src/nodes/types.test.ts` (importer aussi `readOrchestratorPayload`) :

```ts
describe("readOrchestratorPayload", () => {
  it("keeps the given name and names the others Orchestrateur", () => {
    expect(readOrchestratorPayload({ name: "Chef" })).toEqual({ name: "Chef" });
    expect(readOrchestratorPayload({ name: "  " })).toEqual({ name: "Orchestrateur" });
    expect(readOrchestratorPayload({})).toEqual({ name: "Orchestrateur" });
    expect(readOrchestratorPayload(null)).toEqual({ name: "Orchestrateur" });
  });
});
```

`src/store/nodes.test.ts` (importer aussi `terminalOf` depuis `./nodes`) :

```ts
it("reads orchestrator nodes and keeps them apart from terminals", () => {
  const { store } = createNodesStore();
  store.getState().hydrate("w1", [
    { id: "o1", kind: "orchestrator", payloadJson: '{"name":"Chef"}' },
    { id: "t1", kind: "terminal", payloadJson: JSON.stringify(payload) },
  ]);
  expect(store.getState().nodes.o1).toEqual({ workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
  expect(terminalOf(store.getState().nodes.t1)).toEqual(payload);
  expect(terminalOf(store.getState().nodes.o1)).toBeUndefined();
  expect(terminalOf(undefined)).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/canvas/nodeElement.test.ts src/nodes/types.test.ts src/store/nodes.test.ts`
Expected: FAIL — `readOrchestratorPayload` et `terminalOf` n'existent pas, `NODE_SIZE.orchestrator` absent.

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib nodes 2>&1 | grep -E "^error"`
Expected: FAIL — `NodeKind::Orchestrator` inexistant.

- [ ] **Step 3: Write the implementation**

`src-tauri/src/db/nodes.rs` : variante `Orchestrator,` après `Terminal,` dans `NodeKind`, et `NodeKind::Orchestrator => "orchestrator",` dans `as_str`.

`src/canvas/nodeElement.ts` :

```ts
export type NodeKind = "terminal" | "orchestrator" | "note" | "kanban" | "git";

const NODE_KINDS: readonly NodeKind[] = ["terminal", "orchestrator", "note", "kanban", "git"];

export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  terminal: { width: 720, height: 440 },
  orchestrator: { width: 320, height: 420 },
  note: { width: 320, height: 240 },
  kanban: { width: 640, height: 400 },
  git: { width: 360, height: 320 },
};

const LINK_PATTERN = /^dummyplane:\/\/(terminal|orchestrator|note|kanban|git)\/[\w-]+$/;
```

`src/nodes/types.ts` — remplacer `/** Plan B adds the orchestrator payload. */ export type NodePayload = TerminalPayload;` par :

```ts
/** Content of an orchestrator node (spec habillage §13, §15.2). */
export interface OrchestratorPayload {
  name: string;
}

export const ORCHESTRATOR_NAME = "Orchestrateur";

export type NodePayload = TerminalPayload | OrchestratorPayload;

/** Reads a stored orchestrator payload; a missing or blank name becomes "Orchestrateur". */
export function readOrchestratorPayload(raw: unknown): OrchestratorPayload {
  const name = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).name : undefined;
  return { name: typeof name === "string" && name.trim() ? name : ORCHESTRATOR_NAME };
}
```

`src/store/nodes.ts` :
- import : `import { readOrchestratorPayload, readTerminalPayload, type OrchestratorPayload, type TerminalPayload } from "@/nodes/types";` (à la place de l'import actuel de `@/nodes/types`) ;
- remplacer l'interface `NodeRecord` par :

```ts
export type NodeRecord =
  | { workspaceId: string; kind: "terminal"; payload: TerminalPayload }
  | { workspaceId: string; kind: "orchestrator"; payload: OrchestratorPayload };
```

- dans `NodesState`, la signature : `update: (id: string, patch: Partial<TerminalPayload> | Partial<OrchestratorPayload>) => void;`
- `hydrate` :

```ts
      hydrate: (workspaceId, stored) => {
        const loaded: Record<string, NodeRecord> = {};
        for (const node of stored) {
          const record = readRecord(workspaceId, node);
          if (record) loaded[node.id] = record;
          else console.warn(`node ${node.id}: unreadable payload, skipped`);
        }
        set((s) => ({ nodes: { ...loaded, ...s.nodes } }));
      },
```

- `update` :

```ts
      update: (id, patch) => {
        const record = get().nodes[id];
        if (!record) return;
        const next = { ...record, payload: { ...record.payload, ...patch } } as NodeRecord;
        set((s) => ({ nodes: { ...s.nodes, [id]: next } }));
        saveLater(id);
      },
```

- après `createNodesStore` (fonctions de module) :

```ts
function readRecord(workspaceId: string, node: StoredNode): NodeRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(node.payloadJson);
  } catch {
    return null;
  }
  if (node.kind === "orchestrator") return { workspaceId, kind: "orchestrator", payload: readOrchestratorPayload(raw) };
  if (node.kind !== "terminal") return null;
  const payload = readTerminalPayload(raw);
  return payload ? { workspaceId, kind: "terminal", payload } : null;
}

/** The terminal payload of a node; undefined for an orchestrator or a missing node. */
export function terminalOf(record: NodeRecord | undefined): TerminalPayload | undefined {
  return record?.kind === "terminal" ? record.payload : undefined;
}
```

Consommateurs (chacun lisait `payload` comme une charge de terminal) :
- `src/fleet/FleetPanel.tsx` : importer `terminalOf` avec `useNodes` (`import { terminalOf, useNodes } from "@/store/nodes";`) et remplacer le calcul de `agents` par :

```ts
  const agents: FleetAgent[] = nodeIds.flatMap((id) => {
    const payload = terminalOf(nodes[id]);
    if (!payload) return [];
    const status = statuses[id] ?? { state: "stopped" as const };
    const state = fleetStateOf(status, activities[id]);
    return [
      {
        id,
        name: payload.name || AGENTS[payload.agent].label,
        agent: payload.agent,
        state,
        since: state === "stopped" ? undefined : activities[id]?.since,
      },
    ];
  });
```

- `src/fleet/terminals.ts` : importer `terminalOf` (`import { nodesStore, terminalOf } from "@/store/nodes";`) et `nodeKindOf` (`import { createNodeElement, nodeKindOf } from "@/canvas/nodeElement";`) ; dans `duplicateTerminal`, `const source = terminalOf(nodesStore.getState().nodes[nodeId]);` ; remplacer la boucle et le lien d'`adoptCopies` par :

```ts
  for (const { id, sourceId } of copies) {
    const source = nodesStore.getState().nodes[sourceId];
    if (!source) continue;
    if (source.kind === "orchestrator") {
      // A copied orchestrator keeps its name; its wires stay with the original.
      await nodesStore.getState().create(id, { workspaceId, kind: "orchestrator", payload: { ...source.payload } });
      continue;
    }
    markForAutostart(id);
    const frameId = api.getSceneElementsIncludingDeleted().find((e) => e.id === id)?.frameId;
    const group = canvasStore.getState().frames.find((f) => f.id === frameId);
    const name = await nameForNewAgent(workspaceId, group?.group?.pantheon);
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload: cloneTerminalPayload(source.payload, name) });
  }
  const ids = new Set(copies.map((copy) => copy.id));
  const linked = api
    .getSceneElementsIncludingDeleted()
    .map((e) => (ids.has(e.id) ? newElementWith(e, { link: `dummyplane://${nodeKindOf(e) ?? "terminal"}/${e.id}` }) : e));
```

  et, dans `alignCopies`, ne ranger que les terminaux : la condition de la première boucle devient `if (copyIds.has(e.id) && e.frameId && nodeKindOf(e) === "terminal")`.
- `src/nodes/terminal/registry.ts` : importer `terminalOf` (`import { nodesStore, terminalOf } from "@/store/nodes";`) ; `const latest = terminalOf(nodesStore.getState().nodes[nodeId]) ?? payload;` ; dans `startFresh`, remplacer `const record = …; if (!record) return; let payload = record.payload;` par `let payload = terminalOf(nodesStore.getState().nodes[nodeId]); if (!payload) return;` ; dans `resumeTerminal`, `const payload = terminalOf(nodesStore.getState().nodes[nodeId]);`.
- `src/nodes/terminal/TerminalNode.tsx` : importer `terminalOf` ; `const payload = useNodes((s) => terminalOf(s.nodes[nodeId]));` et, dans l'effet, `const current = terminalOf(nodesStore.getState().nodes[nodeId]);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/canvas/nodeElement.test.ts src/nodes/types.test.ts src/store/nodes.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit` puis `pnpm test`
Expected: aucune erreur de type (les autres lectures de `payload.name` valent pour les deux types), tous les tests passent.

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 | grep -E "test result|FAILED"`
Expected: `test result: ok.`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/nodes.rs src/canvas/nodeElement.ts src/canvas/nodeElement.test.ts src/nodes/types.ts src/nodes/types.test.ts src/store/nodes.ts src/store/nodes.test.ts src/fleet/FleetPanel.tsx src/fleet/terminals.ts src/nodes/terminal/registry.ts src/nodes/terminal/TerminalNode.tsx
git commit -m "feat(nodes): orchestrator node kind and payload"
```

---

### Task 3: Les cibles d'une consigne

**Files:**
- Create: `src/fleet/targets.ts`, `src/fleet/targets.test.ts`
- Modify: `src/fleet/groupSummary.ts`, `src/fleet/groupSummary.test.ts`

**Interfaces:**
- Consumes: `SceneFrame` (`@/canvas/groups`).
- Produces: `type Target = { kind: "all" } | { kind: "group"; id: string } | { kind: "agent"; id: string }` ; `interface TargetOption { target: Target; label: string; detail: string }` ; `interface TargetAgent { id: string; name: string; groupName: string | null }` ; `slug(text)`, `targetKey(target)`, `uniqueTargets(targets)`, `targetAgents(ids, nameOf, frames)`, `targetOptions(agents, groups)`, `matchOptions(options, query)`, `mentionAt(text, caret)`, `withoutMention(text, start, end)`, `extractMentions(text, options)`, `resolveTargets(targets, scope, fallback)`, `selectionTargets(selectedIds, frames, terminalIds)` ; `agentsText(n)`, `groupsText(n)` dans `groupSummary.ts`.

- [ ] **Step 1: Write the failing tests**

`src/fleet/targets.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { SceneFrame } from "@/canvas/groups";
import {
  extractMentions,
  matchOptions,
  mentionAt,
  resolveTargets,
  selectionTargets,
  slug,
  targetAgents,
  targetOptions,
  withoutMention,
  type TargetAgent,
} from "./targets";

const group = (id: string, name: string, memberIds: string[]): SceneFrame => ({
  id,
  name,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  group: { role: "backend", pantheon: "greek" },
  memberIds,
});
const plain: SceneFrame = { ...group("f", "Notes", ["c"]), group: null };
const backend = group("g1", "Équipe Back", ["a", "b"]);
const docs = group("g2", "Docs", ["d"]);
const agents: TargetAgent[] = [
  { id: "a", name: "Isis", groupName: "Équipe Back" },
  { id: "b", name: "Thot", groupName: "Équipe Back" },
  { id: "c", name: "Isis", groupName: null },
  { id: "d", name: "Zeus", groupName: "Docs" },
];
const options = targetOptions(agents, [backend, docs, plain]);

describe("slug", () => {
  it("drops spaces and accents and lowers the case", () => {
    expect(slug("Équipe Back")).toBe("equipeback");
    expect(slug("Hermès")).toBe("hermes");
  });
});

describe("targetOptions", () => {
  it("lists @tous, then the groups, then every agent with its group", () => {
    expect(options.map((o) => [o.label, o.detail])).toEqual([
      ["@tous", "4 agents"],
      ["@equipeback", "2 agents"],
      ["@docs", "1 agent"],
      ["@isis", "Équipe Back"],
      ["@thot", "Équipe Back"],
      ["@isis", "Hors groupe"],
      ["@zeus", "Docs"],
    ]);
  });
});

describe("targetAgents", () => {
  it("names the terminals and finds their group", () => {
    const names: Record<string, string> = { a: "Isis", c: "Isis" };
    expect(targetAgents(["a", "c", "o"], (id) => names[id], [backend, plain])).toEqual([
      { id: "a", name: "Isis", groupName: "Équipe Back" },
      { id: "c", name: "Isis", groupName: null },
    ]);
  });
});

describe("matchOptions", () => {
  it("ignores case and accents, and puts the names that start with the query first", () => {
    expect(matchOptions(options, "EQU").map((o) => o.label)).toEqual(["@equipeback"]);
    expect(matchOptions(options, "is").map((o) => o.label)).toEqual(["@isis", "@isis"]);
    expect(matchOptions(options, "o").map((o) => o.label)).toEqual(["@tous", "@docs", "@thot"]);
    expect(matchOptions(options, "").length).toBe(options.length);
  });
});

describe("mentionAt", () => {
  it("finds the @word being typed at the caret", () => {
    expect(mentionAt("lance @ba", 9)).toEqual({ start: 6, query: "ba" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("lance @ba suite", 15)).toBeNull();
    expect(mentionAt("mail a@b", 8)).toBeNull();
  });
});

describe("withoutMention", () => {
  it("removes the mention and one space after it", () => {
    expect(withoutMention("@tous lance", 0, 5)).toEqual({ text: "lance", caret: 0 });
    expect(withoutMention("lance @ba", 6, 9)).toEqual({ text: "lance ", caret: 6 });
  });
});

describe("extractMentions", () => {
  it("turns typed mentions of exactly one target into targets", () => {
    expect(extractMentions("@tous lance les tests", options)).toEqual({ targets: [{ kind: "all" }], text: "lance les tests" });
    expect(extractMentions("relis @Docs puis @zeus", options)).toEqual({
      targets: [
        { kind: "group", id: "g2" },
        { kind: "agent", id: "d" },
      ],
      text: "relis puis",
    });
  });

  it("leaves ambiguous, unknown mentions and e-mail addresses as typed", () => {
    expect(extractMentions("@isis @nobody écris à a@b.fr", options)).toEqual({ targets: [], text: "@isis @nobody écris à a@b.fr" });
  });

  it("keeps the line breaks of the command", () => {
    expect(extractMentions("@tous un\ndeux", options).text).toBe("un\ndeux");
  });
});

describe("resolveTargets", () => {
  const scope = { all: ["a", "b", "c", "d"], groups: [backend, docs] };

  it("gives each terminal once, in the order of the targets", () => {
    expect(
      resolveTargets(
        [
          { kind: "agent", id: "d" },
          { kind: "group", id: "g1" },
          { kind: "agent", id: "a" },
        ],
        scope,
        [],
      ),
    ).toEqual(["d", "a", "b"]);
    expect(resolveTargets([{ kind: "all" }], scope, [])).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back on the selection, and keeps to the scope", () => {
    expect(resolveTargets([], scope, ["c", "c"])).toEqual(["c"]);
    expect(resolveTargets([{ kind: "agent", id: "gone" }], scope, ["c"])).toEqual([]);
  });
});

describe("selectionTargets", () => {
  it("takes the selected terminals and the members of the selected groups", () => {
    expect(selectionTargets(["c", "g1", "f", "x"], [backend, plain], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });
});
```

Dans `src/fleet/groupSummary.test.ts`, importer aussi `agentsText, groupsText` et ajouter :

```ts
describe("agentsText / groupsText", () => {
  it("counts in French with the singular", () => {
    expect(agentsText(1)).toBe("1 agent");
    expect(agentsText(8)).toBe("8 agents");
    expect(groupsText(0)).toBe("0 groupe");
    expect(groupsText(2)).toBe("2 groupes");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/fleet/targets.test.ts src/fleet/groupSummary.test.ts`
Expected: FAIL — `./targets` introuvable, `agentsText` inexistant.

- [ ] **Step 3: Write the implementation**

Ajouter à `src/fleet/groupSummary.ts` :

```ts
/** "1 agent", "8 agents". */
export function agentsText(count: number): string {
  return count > 1 ? `${count} agents` : `${count} agent`;
}

/** "0 groupe", "2 groupes". */
export function groupsText(count: number): string {
  return count > 1 ? `${count} groupes` : `${count} groupe`;
}
```

`src/fleet/targets.ts` :

```ts
import type { SceneFrame } from "@/canvas/groups";
import { agentsText } from "./groupSummary";

/** Who a command goes to (spec habillage §12). */
export type Target = { kind: "all" } | { kind: "group"; id: string } | { kind: "agent"; id: string };

/** One line of the `@` list. */
export interface TargetOption {
  target: Target;
  /** "@tous", "@backend", "@isis". */
  label: string;
  /** In grey: the size of a group, or the group of an agent ("Hors groupe"). */
  detail: string;
}

/** An agent as the `@` list sees it. */
export interface TargetAgent {
  id: string;
  name: string;
  groupName: string | null;
}

/** "Équipe Back" → "equipeback": no spaces nor accents, lower case. */
export function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function targetKey(target: Target): string {
  return target.kind === "all" ? "all" : `${target.kind}:${target.id}`;
}

export function uniqueTargets(targets: readonly Target[]): Target[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The terminals among `ids` (those `nameOf` names), with their group. */
export function targetAgents(
  ids: readonly string[],
  nameOf: (id: string) => string | undefined,
  frames: readonly SceneFrame[],
): TargetAgent[] {
  return ids.flatMap((id) => {
    const name = nameOf(id);
    if (name === undefined) return [];
    const group = frames.find((f) => f.group !== null && f.memberIds.includes(id));
    return [{ id, name, groupName: group?.name ?? null }];
  });
}

/** @tous, then the groups, then the agents; two agents of the same name both show, with their group (spec §12). */
export function targetOptions(agents: readonly TargetAgent[], groups: readonly SceneFrame[]): TargetOption[] {
  const all: TargetOption = { target: { kind: "all" }, label: "@tous", detail: agentsText(agents.length) };
  const groupOptions = groups
    .filter((g) => g.group !== null && slug(g.name))
    .map((g): TargetOption => ({ target: { kind: "group", id: g.id }, label: `@${slug(g.name)}`, detail: agentsText(g.memberIds.length) }));
  const agentOptions = agents
    .filter((a) => slug(a.name))
    .map((a): TargetOption => ({ target: { kind: "agent", id: a.id }, label: `@${slug(a.name)}`, detail: a.groupName ?? "Hors groupe" }));
  return [all, ...groupOptions, ...agentOptions];
}

/** The options whose name starts with the query, then those containing it; case and accents ignored. */
export function matchOptions(options: readonly TargetOption[], query: string): TargetOption[] {
  const wanted = slug(query);
  const name = (option: TargetOption) => option.label.slice(1);
  const starts = options.filter((o) => name(o).startsWith(wanted));
  const contains = options.filter((o) => !name(o).startsWith(wanted) && name(o).includes(wanted));
  return [...starts, ...contains];
}

/** The `@word` being typed at the caret: where its `@` is and what follows it. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2] } : null;
}

/** `text` without the mention from `start` to `end`, and one space after it. */
export function withoutMention(text: string, start: number, end: number): { text: string; caret: number } {
  return { text: text.slice(0, start) + text.slice(end).replace(/^ /, ""), caret: start };
}

/**
 * Typed `@names` that match exactly one option become targets and leave the
 * text ("@tous lance les tests"); ambiguous or unknown ones stay as typed.
 */
export function extractMentions(text: string, options: readonly TargetOption[]): { targets: Target[]; text: string } {
  const targets: Target[] = [];
  const rest = text.replace(/(^|\s)@([^\s@]+)/g, (whole: string, space: string, word: string) => {
    const found = options.filter((o) => o.label === `@${slug(word)}`);
    if (found.length !== 1) return whole;
    targets.push(found[0].target);
    return space;
  });
  return { targets, text: rest.replace(/[ \t]{2,}/g, " ").trim() };
}

/**
 * The terminals a command goes to, once each, in the order of the targets;
 * without targets, `fallback` (the selection, or an orchestrator's agents).
 * Only terminals of `scope.all` count.
 */
export function resolveTargets(
  targets: readonly Target[],
  scope: { all: readonly string[]; groups: readonly SceneFrame[] },
  fallback: readonly string[],
): string[] {
  const ids: string[] = [];
  if (targets.length === 0) ids.push(...fallback);
  for (const target of targets) {
    if (target.kind === "all") ids.push(...scope.all);
    else if (target.kind === "group") ids.push(...(scope.groups.find((g) => g.id === target.id)?.memberIds ?? []));
    else ids.push(target.id);
  }
  return [...new Set(ids)].filter((id) => scope.all.includes(id));
}

/** Without `@`: the selected terminals and the members of the selected groups (spec §12). */
export function selectionTargets(
  selectedIds: readonly string[],
  frames: readonly SceneFrame[],
  terminalIds: readonly string[],
): string[] {
  const ids: string[] = [];
  for (const id of selectedIds) {
    if (terminalIds.includes(id)) ids.push(id);
    const frame = frames.find((f) => f.id === id && f.group !== null);
    if (frame) ids.push(...frame.memberIds);
  }
  return [...new Set(ids)];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/fleet/targets.test.ts src/fleet/groupSummary.test.ts`
Expected: PASS. Puis `pnpm exec tsc --noEmit` propre.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/targets.ts src/fleet/targets.test.ts src/fleet/groupSummary.ts src/fleet/groupSummary.test.ts
git commit -m "feat(fleet): command targets with @ mentions and the selection"
```

---

### Task 4: Envoyer, mettre en pause, reprendre

**Files:**
- Create: `src/fleet/broadcast.ts`, `src/fleet/broadcast.test.ts`

**Interfaces:**
- Consumes: `ptySendText`, `ptyInterrupt` (tâche 1) ; `terminalOf` (tâche 2) ; `statusOf` (`@/store/terminalStatus`) ; `agentActivityStore` ; `canvasStore.nodeIds` ; `AGENTS`.
- Produces: `RESUME_WINDOW_MS`, `pausedStore` (`pausedAt: Record<string, number>`, `mark(ids, at)`, `clear(ids)`), `interface AgentFacts`, `canPause(facts)`, `canResume(facts)`, `sendToAgents(ids, text): Promise<{ sent: number; skipped: string[] }>`, `pauseAgents(ids, now?): Promise<number>`, `resumeAgents(ids, now?): Promise<number>`, `resumeAgent(id): Promise<boolean>`, `skippedText(names)`, `pausedText(n)`, `resumedText(n)`, `sendCommand(ids, text)`, `pauseAll(ids)`, `resumeAll(ids)`, `workspaceTerminalIds()`.

- [ ] **Step 1: Write the failing tests**

`src/fleet/broadcast.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Activity } from "@/ipc/activity";
import type { AgentId } from "@/ipc/pty";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import {
  canPause,
  canResume,
  pauseAgents,
  pausedStore,
  pausedText,
  RESUME_WINDOW_MS,
  resumeAgents,
  resumedText,
  sendToAgents,
  skippedText,
} from "./broadcast";

let calls: { cmd: string; nodeId: string; text?: string }[];
let dead: Set<string>;

beforeEach(() => {
  calls = [];
  dead = new Set();
  mockIPC((cmd, args) => {
    if (cmd !== "pty_send_text" && cmd !== "pty_interrupt") return;
    const { nodeId, text } = args as { nodeId: string; text?: string };
    if (dead.has(nodeId)) throw { kind: "notFound", message: "aucun terminal actif" };
    calls.push({ cmd, nodeId, text });
    return cmd === "pty_interrupt" ? true : undefined;
  });
});
afterEach(() => clearMocks());

async function agent(id: string, agentId: AgentId, state: "running" | "stopped", activity?: Activity) {
  await nodesStore.getState().create(id, {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: id, name: id[0].toUpperCase() + id.slice(1), agent: agentId, cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set(id, { state });
  if (activity) agentActivityStore.getState().apply({ nodeId: id, activity, since: 0 });
}

describe("sendToAgents", () => {
  it("types the command into the running agents and names the stopped ones", async () => {
    await agent("isis", "claude", "running", "idle");
    await agent("thot", "claude", "stopped");
    await agent("anubis", "codex", "stopped");
    expect(await sendToAgents(["isis", "thot", "anubis"], "lance les tests")).toEqual({ sent: 1, skipped: ["Thot", "Anubis"] });
    expect(calls).toEqual([{ cmd: "pty_send_text", nodeId: "isis", text: "lance les tests" }]);
  });

  it("counts an agent whose process just died as ignored", async () => {
    await agent("osiris", "claude", "running", "idle");
    dead.add("osiris");
    expect(await sendToAgents(["osiris"], "x")).toEqual({ sent: 0, skipped: ["Osiris"] });
  });
});

describe("skippedText / pausedText / resumedText", () => {
  it("says who was ignored and how many were paused or resumed", () => {
    expect(skippedText([])).toBeNull();
    expect(skippedText(["Thot"])).toBe("1 agent arrêté ignoré : Thot");
    expect(skippedText(["Thot", "Anubis"])).toBe("2 agents arrêtés ignorés : Thot, Anubis");
    expect(pausedText(0)).toBe("Aucun agent en cours à mettre en pause");
    expect(pausedText(1)).toBe("1 agent mis en pause");
    expect(pausedText(5)).toBe("5 agents mis en pause");
    expect(resumedText(0)).toBe("Aucun agent mis en pause à reprendre");
    expect(resumedText(3)).toBe("3 agents repris");
  });
});

describe("canPause / canResume", () => {
  it("pauses a running agent at work, never a shell", () => {
    expect(canPause({ agent: "claude", running: true, activity: "working" })).toBe(true);
    expect(canPause({ agent: "claude", running: true, activity: "idle" })).toBe(false);
    expect(canPause({ agent: "claude", running: false, activity: "working" })).toBe(false);
    expect(canPause({ agent: "shell", running: true, activity: "working" })).toBe(false);
  });

  it("resumes a running agent that is idle, never a shell", () => {
    expect(canResume({ agent: "codex", running: true, activity: "idle" })).toBe(true);
    expect(canResume({ agent: "codex", running: true, activity: undefined })).toBe(true);
    expect(canResume({ agent: "codex", running: true, activity: "working" })).toBe(false);
    expect(canResume({ agent: "codex", running: true, activity: "waiting" })).toBe(false);
    expect(canResume({ agent: "shell", running: true, activity: "idle" })).toBe(false);
  });
});

describe("pauseAgents / resumeAgents", () => {
  it("pauses the agents at work and remembers when", async () => {
    await agent("hera", "claude", "running", "working");
    await agent("zeus", "claude", "running", "idle");
    await agent("ares", "shell", "running", "working");
    expect(await pauseAgents(["hera", "zeus", "ares"], 1000)).toBe(1);
    expect(calls).toEqual([{ cmd: "pty_interrupt", nodeId: "hera", text: undefined }]);
    expect(pausedStore.getState().pausedAt.hera).toBe(1000);
  });

  it("resumes only the agents it paused less than a day ago, once idle", async () => {
    const now = 10 * RESUME_WINDOW_MS;
    await agent("ra", "claude", "running", "idle");
    await agent("ptah", "claude", "running", "idle");
    await agent("seth", "claude", "running", "idle");
    await agent("bastet", "claude", "running", "working");
    pausedStore.getState().mark(["ra", "bastet"], now - 3_600_000);
    pausedStore.getState().mark(["seth"], now - RESUME_WINDOW_MS - 1);
    expect(await resumeAgents(["ra", "ptah", "seth", "bastet"], now)).toBe(1);
    expect(calls).toEqual([{ cmd: "pty_send_text", nodeId: "ra", text: "continue" }]);
    expect(pausedStore.getState().pausedAt.ra).toBeUndefined();
    expect(pausedStore.getState().pausedAt.bastet).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/fleet/broadcast.test.ts`
Expected: FAIL — `./broadcast` introuvable.

- [ ] **Step 3: Write the implementation**

`src/fleet/broadcast.ts` :

```ts
import { toast } from "sonner";
import { createStore } from "zustand";
import { canvasStore } from "@/canvas/canvasStore";
import type { Activity } from "@/ipc/activity";
import { ptyInterrupt, ptySendText, type AgentId } from "@/ipc/pty";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { statusOf } from "@/store/terminalStatus";
import { AGENTS } from "./catalog";

/** "Tout reprendre" only restarts agents dummyPlane paused less than this ago (spec habillage §14). */
export const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

interface PausedState {
  /** When dummyPlane paused each agent; kept in memory only. */
  pausedAt: Record<string, number>;
  mark: (ids: readonly string[], at: number) => void;
  clear: (ids: readonly string[]) => void;
}

export const pausedStore = createStore<PausedState>()((set) => ({
  pausedAt: {},
  mark: (ids, at) => set((s) => ({ pausedAt: { ...s.pausedAt, ...Object.fromEntries(ids.map((id) => [id, at])) } })),
  clear: (ids) => set((s) => ({ pausedAt: Object.fromEntries(Object.entries(s.pausedAt).filter(([id]) => !ids.includes(id))) })),
}));

/** What pause and resume look at. */
export interface AgentFacts {
  agent: AgentId;
  running: boolean;
  activity: Activity | undefined;
}

/** A running agent at work, other than a plain shell (spec §14). */
export function canPause(facts: AgentFacts): boolean {
  return facts.running && facts.agent !== "shell" && facts.activity === "working";
}

/** A running agent that is idle, other than a plain shell. */
export function canResume(facts: AgentFacts): boolean {
  return facts.running && facts.agent !== "shell" && (facts.activity ?? "idle") === "idle";
}

function factsOf(id: string): AgentFacts | null {
  const payload = terminalOf(nodesStore.getState().nodes[id]);
  if (!payload) return null;
  return {
    agent: payload.agent,
    running: statusOf(id).state === "running",
    activity: agentActivityStore.getState().activities[id]?.activity,
  };
}

function nameOf(id: string): string {
  const payload = terminalOf(nodesStore.getState().nodes[id]);
  return payload ? payload.name || AGENTS[payload.agent].label : "Agent";
}

/**
 * Types `text` into each running terminal of `ids` (spec §12). Stopped ones,
 * and those whose process dies meanwhile, are ignored and named (spec §17).
 */
export async function sendToAgents(ids: readonly string[], text: string): Promise<{ sent: number; skipped: string[] }> {
  const results = await Promise.all(
    ids.map(async (id) => {
      const facts = factsOf(id);
      if (!facts) return null;
      if (!facts.running) return nameOf(id);
      try {
        await ptySendText(id, text);
        return true;
      } catch {
        return nameOf(id);
      }
    }),
  );
  return {
    sent: results.filter((result) => result === true).length,
    skipped: results.filter((result): result is string => typeof result === "string"),
  };
}

/** Interrupts the agents of `ids` that are at work, and remembers them for "Tout reprendre". */
export async function pauseAgents(ids: readonly string[], now = Date.now()): Promise<number> {
  const targets = ids.filter((id) => {
    const facts = factsOf(id);
    return facts !== null && canPause(facts);
  });
  const paused = await Promise.all(targets.map((id) => ptyInterrupt(id).then((sent) => (sent ? id : null), () => null)));
  const done = paused.filter((id): id is string => id !== null);
  pausedStore.getState().mark(done, now);
  return done.length;
}

/** Sends "continue" to the idle agents of `ids` dummyPlane paused less than 24 h ago (spec §14). */
export async function resumeAgents(ids: readonly string[], now = Date.now()): Promise<number> {
  const { pausedAt } = pausedStore.getState();
  const targets = ids.filter((id) => {
    const facts = factsOf(id);
    const at = pausedAt[id];
    return facts !== null && canResume(facts) && at !== undefined && now - at < RESUME_WINDOW_MS;
  });
  const resumed = await Promise.all(targets.map((id) => ptySendText(id, "continue").then(() => id, () => null)));
  const done = resumed.filter((id): id is string => id !== null);
  pausedStore.getState().clear(done);
  return done.length;
}

/** "Reprendre" of one agent: an explicit request, so no 24 h limit. */
export async function resumeAgent(id: string): Promise<boolean> {
  const facts = factsOf(id);
  if (!facts || !canResume(facts)) return false;
  await ptySendText(id, "continue");
  pausedStore.getState().clear([id]);
  return true;
}

/** "2 agents arrêtés ignorés : Thot, Anubis" (spec §12). */
export function skippedText(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `1 agent arrêté ignoré : ${names[0]}`;
  return `${names.length} agents arrêtés ignorés : ${names.join(", ")}`;
}

export function pausedText(count: number): string {
  if (count === 0) return "Aucun agent en cours à mettre en pause";
  return count === 1 ? "1 agent mis en pause" : `${count} agents mis en pause`;
}

export function resumedText(count: number): string {
  if (count === 0) return "Aucun agent mis en pause à reprendre";
  return count === 1 ? "1 agent repris" : `${count} agents repris`;
}

/** The command bar's and the orchestrator's send, with the toast of ignored agents. */
export async function sendCommand(ids: readonly string[], text: string) {
  const { skipped } = await sendToAgents(ids, text);
  const warning = skippedText(skipped);
  if (warning) toast.warning(warning);
}

/** "Tout mettre en pause" of the chips, a group or an orchestrator. */
export async function pauseAll(ids: readonly string[]) {
  toast(pausedText(await pauseAgents(ids)));
}

/** "Tout reprendre" of the chips, a group or an orchestrator. */
export async function resumeAll(ids: readonly string[]) {
  toast(resumedText(await resumeAgents(ids)));
}

/** The terminals of the workspace on screen. */
export function workspaceTerminalIds(): string[] {
  const { nodes } = nodesStore.getState();
  return canvasStore.getState().nodeIds.filter((id) => nodes[id]?.kind === "terminal");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/fleet/broadcast.test.ts`
Expected: PASS. Puis `pnpm exec tsc --noEmit` propre.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/broadcast.ts src/fleet/broadcast.test.ts
git commit -m "feat(fleet): send a command, pause and resume agents"
```

---

### Task 5: Historique des consignes

**Files:**
- Create: `src/fleet/history.ts`, `src/fleet/history.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `setSetting` (`@/ipc/db`).
- Produces: `HISTORY_SIZE = 50`, `historyKey(projectId)`, `HINT_KEY`, `pushHistory(entries, text)`, `browseHistory(entries, index, direction)`, `historyStore` (`projectId`, `entries`, `load(projectId)`, `add(text)`).

- [ ] **Step 1: Write the failing tests**

`src/fleet/history.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { browseHistory, HISTORY_SIZE, historyStore, pushHistory } from "./history";

afterEach(() => clearMocks());

describe("pushHistory", () => {
  it("adds the command last, moves an earlier copy and keeps the last 50", () => {
    expect(pushHistory(["a", "b"], " a ")).toEqual(["b", "a"]);
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
    const full = Array.from({ length: HISTORY_SIZE }, (_, i) => `c${i}`);
    const next = pushHistory(full, "new");
    expect(next).toHaveLength(HISTORY_SIZE);
    expect(next[0]).toBe("c1");
    expect(next[next.length - 1]).toBe("new");
  });
});

describe("browseHistory", () => {
  it("walks up to the oldest command and down back to the draft", () => {
    const entries = ["a", "b", "c"];
    expect(browseHistory(entries, null, "up")).toBe(2);
    expect(browseHistory(entries, 2, "up")).toBe(1);
    expect(browseHistory(entries, 0, "up")).toBe(0);
    expect(browseHistory(entries, 1, "down")).toBe(2);
    expect(browseHistory(entries, 2, "down")).toBeNull();
    expect(browseHistory(entries, null, "down")).toBeNull();
    expect(browseHistory([], null, "up")).toBeNull();
  });
});

describe("historyStore", () => {
  it("loads a project's commands and saves each new one", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "get_setting") return (args as { key: string }).key === "command.history.p1" ? ["a", "b"] : null;
      if (cmd === "set_setting") saved.push(args);
    });
    await historyStore.getState().load("p1");
    expect(historyStore.getState().entries).toEqual(["a", "b"]);
    historyStore.getState().add("a");
    expect(historyStore.getState().entries).toEqual(["b", "a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([{ key: "command.history.p1", value: ["b", "a"] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/fleet/history.test.ts`
Expected: FAIL — `./history` introuvable.

- [ ] **Step 3: Write the implementation**

`src/fleet/history.ts` :

```ts
import { createStore } from "zustand";
import { getSetting, setSetting } from "@/ipc/db";

/** ↑ and ↓ go through the last 50 commands (spec habillage §12). */
export const HISTORY_SIZE = 50;

/** One history per project, shared by the command bar and the orchestrators. */
export const historyKey = (projectId: string) => `command.history.${projectId}`;

/** Set once the first-use hint of the command bar was dismissed. */
export const HINT_KEY = "command.hintDismissed";

/** `entries` with `text` added last; an earlier copy moves to the end; blank text is ignored. */
export function pushHistory(entries: readonly string[], text: string): string[] {
  const command = text.trim();
  if (!command) return [...entries];
  return [...entries.filter((entry) => entry !== command), command].slice(-HISTORY_SIZE);
}

/** One step of ↑ or ↓: `index` null is the draft being typed. */
export function browseHistory(entries: readonly string[], index: number | null, direction: "up" | "down"): number | null {
  if (entries.length === 0) return null;
  if (direction === "up") return index === null ? entries.length - 1 : Math.max(0, index - 1);
  if (index === null) return null;
  return index + 1 < entries.length ? index + 1 : null;
}

interface HistoryState {
  projectId: string | null;
  entries: string[];
  load: (projectId: string) => Promise<void>;
  add: (text: string) => void;
}

export const historyStore = createStore<HistoryState>()((set, get) => ({
  projectId: null,
  entries: [],
  load: async (projectId) => {
    if (get().projectId === projectId) return;
    set({ projectId, entries: [] });
    const saved = await getSetting<unknown>(historyKey(projectId)).catch(() => null);
    if (get().projectId !== projectId || !Array.isArray(saved)) return;
    set({ entries: saved.filter((entry): entry is string => typeof entry === "string").slice(-HISTORY_SIZE) });
  },
  add: (text) => {
    const { projectId, entries } = get();
    const next = pushHistory(entries, text);
    set({ entries: next });
    if (projectId) {
      setSetting(historyKey(projectId), next).catch((error: unknown) => console.warn("command history not saved", error));
    }
  },
}));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/fleet/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/history.ts src/fleet/history.test.ts
git commit -m "feat(fleet): command history per project"
```

---

### Task 6: La barre de commande

**Files:**
- Create: `src/fleet/CommandInput.tsx`, `src/shell/CommandBar.tsx`
- Modify: `src/shell/ProjectView.tsx`, `src/index.css`

**Interfaces:**
- Consumes: tâche 3 (cibles), tâche 4 (`sendCommand`), tâche 5 (`historyStore`, `browseHistory`, `HINT_KEY`) ; `terminalOf` ; `isGroup` ; `useCanvas`, `useNodes`, `useWorkspaces` ; `getSetting`, `setSetting`.
- Produces: `CommandInput(props: { agents: readonly TargetAgent[]; groups: readonly SceneFrame[]; fallback: readonly string[]; placeholder: string; emptyHint: string; compact?: boolean })` (réutilisé par l'orchestrateur, tâche 9) ; `CommandBar()`, `CommandHint()` ; classe CSS `ov-orb-live`.

Pas de test automatisé de composant (pas de bibliothèque de rendu dans le projet) : la logique est dans les tâches 3 à 5 ; vérification dans l'application.

- [ ] **Step 1: Write `CommandInput`**

`src/fleet/CommandInput.tsx` :

```tsx
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, X } from "lucide-react";
import { useStore } from "zustand";
import type { SceneFrame } from "@/canvas/groups";
import { cn } from "@/lib/utils";
import { sendCommand } from "./broadcast";
import { browseHistory, historyStore } from "./history";
import {
  extractMentions,
  matchOptions,
  mentionAt,
  resolveTargets,
  targetKey,
  targetOptions,
  uniqueTargets,
  withoutMention,
  type Target,
  type TargetAgent,
  type TargetOption,
} from "./targets";

const MENU_SIZE = 8;
const MAX_HEIGHT_PX = 120;

/**
 * The field of the command bar and of an orchestrator (spec habillage §12, §13):
 * `@` targets in chips, Enter sends to them (or to `fallback`), ↑ ↓ recall.
 */
export function CommandInput(props: {
  agents: readonly TargetAgent[];
  groups: readonly SceneFrame[];
  /** Reached without `@`: the selection, or an orchestrator's agents. */
  fallback: readonly string[];
  placeholder: string;
  /** Why Envoyer is grey when nothing is targeted. */
  emptyHint: string;
  compact?: boolean;
}) {
  const { agents, groups, fallback, placeholder, emptyHint, compact = false } = props;
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [active, setActive] = useState(0);
  // Escape closes the list for the mention typed at that position.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState<{ index: number; draft: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const history = useStore(historyStore, (s) => s.entries);

  const options = useMemo(() => targetOptions(agents, groups), [agents, groups]);
  const labels = new Map(options.map((o) => [targetKey(o.target), o.label]));
  const chips = targets.filter((t) => labels.has(targetKey(t)));
  const mention = mentionAt(text, caret);
  const matches = mention && mention.start !== dismissedAt ? matchOptions(options, mention.query).slice(0, MENU_SIZE) : [];
  const typed = extractMentions(text, options);
  const allTargets = uniqueTargets([...chips, ...typed.targets]);
  const ids = resolveTargets(allTargets, { all: agents.map((a) => a.id), groups }, fallback);
  const canSend = typed.text.length > 0 && ids.length > 0;
  const nothingTargeted = allTargets.length === 0 && fallback.length === 0;

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const edit = (value: string, at: number) => {
    setText(value);
    setCaret(at);
    setActive(0);
    setBrowsing(null);
  };

  const insert = (option: TargetOption) => {
    if (!mention) return;
    setTargets(uniqueTargets([...chips, option.target]));
    const next = withoutMention(text, mention.start, caret);
    edit(next.text, next.caret);
    requestAnimationFrame(() => field.current?.setSelectionRange(next.caret, next.caret));
  };

  const send = () => {
    if (!canSend) return;
    historyStore.getState().add(text);
    setTargets(allTargets);
    edit("", 0);
    void sendCommand(ids, typed.text);
  };

  const recall = (direction: "up" | "down") => {
    const index = browseHistory(history, browsing?.index ?? null, direction);
    const draft = browsing?.draft ?? text;
    const value = index === null ? draft : history[index];
    setText(value);
    setCaret(value.length);
    setBrowsing(index === null ? null : { index, draft });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0 && mention) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : matches.length - 1;
        setActive((i) => (i + step) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        insert(matches[Math.min(active, matches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(mention.start);
        return;
      }
    }
    const element = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "ArrowUp" && !element.value.slice(0, element.selectionStart).includes("\n")) {
      e.preventDefault();
      recall("up");
    } else if (e.key === "ArrowDown" && browsing && !element.value.slice(element.selectionEnd).includes("\n")) {
      e.preventDefault();
      recall("down");
    } else if (e.key === "Backspace" && element.selectionEnd === 0 && chips.length > 0) {
      setTargets(chips.slice(0, -1));
    }
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-end gap-2">
      {matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-10 mb-2 w-64 overflow-hidden rounded-xl border border-ov-line bg-ov-surface-2 py-1 shadow-ov"
        >
          {matches.map((option, i) => (
            <li
              key={`${targetKey(option.target)}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(option);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1 text-xs",
                i === active ? "bg-ov-hover text-ov-text" : "text-ov-text-2",
              )}
            >
              <span className="font-mono text-ov-text">{option.label}</span>
              <span className="ml-auto truncate">{option.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {text.trim() && nothingTargeted && <p className="text-[11px] text-ov-text-2">{emptyHint}</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {chips.map((target) => (
            <span
              key={targetKey(target)}
              className="flex h-6 items-center gap-1 rounded-full bg-ov-accent-soft pl-2 pr-1 font-mono text-[11px] text-ov-text"
            >
              {labels.get(targetKey(target))}
              <button
                type="button"
                aria-label={`Retirer ${labels.get(targetKey(target))}`}
                onClick={() => setTargets(chips.filter((c) => targetKey(c) !== targetKey(target)))}
                className="grid size-4 place-items-center rounded-full text-ov-text-2 hover:text-ov-text"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <textarea
            ref={field}
            rows={1}
            value={text}
            placeholder={chips.length > 0 ? "" : placeholder}
            onChange={(e) => edit(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className={cn(
              "min-w-[8rem] flex-1 resize-none bg-transparent py-1 text-ov-text outline-none placeholder:text-ov-text-2",
              compact ? "text-xs" : "text-[13px]",
            )}
          />
        </div>
      </div>
      <button
        type="button"
        aria-label="Envoyer"
        title={canSend ? "Envoyer" : nothingTargeted ? emptyHint : "Écris une consigne"}
        disabled={!canSend}
        onClick={send}
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          compact ? "size-7" : "size-8",
          canSend ? "bg-ov-accent text-white" : "bg-ov-card text-ov-text-2",
        )}
      >
        <ArrowUp className="size-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `CommandBar` and its hint**

`src/shell/CommandBar.tsx` :

```tsx
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { AGENTS } from "@/fleet/catalog";
import { CommandInput } from "@/fleet/CommandInput";
import { HINT_KEY, historyStore } from "@/fleet/history";
import { selectionTargets, targetAgents } from "@/fleet/targets";
import { getSetting, setSetting } from "@/ipc/db";
import { terminalOf, useNodes } from "@/store/nodes";
import { useWorkspaces } from "@/store/workspaces";

/** The bar under the chips (spec habillage §5.6, §12): a command for the workspace's agents. */
export function CommandBar() {
  const nodeIds = useCanvas((s) => s.nodeIds);
  const frames = useCanvas((s) => s.frames);
  const selectedIds = useCanvas((s) => s.view.selectedIds);
  const nodes = useNodes((s) => s.nodes);
  const projectId = useWorkspaces((s) => s.projectId);

  useEffect(() => {
    if (projectId) void historyStore.getState().load(projectId);
  }, [projectId]);

  const agents = useMemo(
    () =>
      targetAgents(
        nodeIds,
        (id) => {
          const payload = terminalOf(nodes[id]);
          return payload ? payload.name || AGENTS[payload.agent].label : undefined;
        },
        frames,
      ),
    [nodeIds, nodes, frames],
  );
  const groups = useMemo(() => frames.filter(isGroup), [frames]);
  const fallback = useMemo(
    () => selectionTargets(selectedIds, frames, agents.map((a) => a.id)),
    [selectedIds, frames, agents],
  );

  return (
    <div className="pointer-events-auto flex w-[560px] items-end gap-3 rounded-2xl bg-ov-command px-3 py-2 shadow-ov">
      <span className="ov-orb ov-orb-live mb-1.5 size-5 shrink-0" />
      <CommandInput
        agents={agents}
        groups={groups}
        fallback={fallback}
        placeholder="Écris une consigne · @ pour cibler…"
        emptyHint="Sélectionne des agents ou tape @"
      />
    </div>
  );
}

/** "Essaie « @tous lance les tests »", above the chips until dismissed (spec §12). */
export function CommandHint() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    getSetting<boolean>(HINT_KEY).then(
      (dismissed) => alive && setShown(dismissed !== true),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ov-line bg-ov-surface-2 py-1 pl-3 pr-1 text-xs text-ov-text-2 shadow-ov">
      Essaie « @tous lance les tests »
      <button
        type="button"
        aria-label="Masquer l'indice"
        onClick={() => {
          setShown(false);
          void setSetting(HINT_KEY, true).catch(() => undefined);
        }}
        className="grid size-5 place-items-center rounded-full hover:bg-ov-card hover:text-ov-text"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Place the bar and animate the orb**

`src/shell/ProjectView.tsx` : importer `import { CommandBar, CommandHint } from "./CommandBar";` et remplacer `<ActionChips />` dans la grille du bas par :

```tsx
            <div className="flex flex-col items-center gap-2">
              <CommandHint />
              <ActionChips />
              <CommandBar />
            </div>
```

`src/index.css`, après la règle `.ov-orb` :

```css
  /* The command bar's and the orchestrator's orb turn slowly (spec habillage §5.6). */
  .ov-orb-live {
    animation: ov-orb-spin 12s linear infinite;
  }

  @keyframes ov-orb-spin {
    to {
      transform: rotate(360deg);
    }
  }
```

- [ ] **Step 4: Check the build and the suite**

Run: `pnpm exec tsc --noEmit` puis `pnpm test` puis `pnpm build`
Expected: aucune erreur, tous les tests passent, build propre.

- [ ] **Step 5: Check in the app**

Application d'essai (profil `dev.dummyplane.probe`, relancée après les tâches 1 et 2 qui touchent Rust) : la barre apparaît sous les puces, orbe en rotation lente ; l'indice « Essaie « @tous lance les tests » » s'affiche et disparaît pour de bon après × ; `@` ouvre la liste (`@tous`, groupes, agents avec leur groupe), filtrée sans tenir compte des accents ; Tab insère une puce ; Envoyer est gris sans texte, sans cible ni sélection (indice affiché) ; `@tous` puis une consigne : elle est tapée et validée dans chaque agent vivant, toast pour les arrêtés ; avec deux terminaux sélectionnés et sans `@`, seuls eux la reçoivent ; une consigne de deux lignes (Maj+Entrée) arrive à Claude en un seul message ; ↑ rappelle la consigne précédente.

- [ ] **Step 6: Commit**

```bash
git add src/fleet/CommandInput.tsx src/shell/CommandBar.tsx src/shell/ProjectView.tsx src/index.css
git commit -m "feat(shell): command bar with @ targets, history and first-use hint"
```

---

### Task 7: Pause et reprise dans l'interface

**Files:**
- Create: `src/fleet/AgentRow.tsx`
- Modify: `src/fleet/FleetPanel.tsx`, `src/shell/ActionChips.tsx`, `src/fleet/GroupMenu.tsx`, `src/fleet/groups.ts`

**Interfaces:**
- Consumes: `pauseAll`, `resumeAll`, `pauseAgents`, `resumeAgent`, `canPause`, `canResume`, `workspaceTerminalIds` (tâche 4) ; `terminalOf` ; `HeaderButton` (`@/nodes/terminal/TerminalHeader`) ; `focusNode` ; `requestClose`.
- Produces: `AgentRow(props: { id: string; onOpen?: () => void; trailing?: ReactNode; showCenter?: boolean })` (réutilisé par l'orchestrateur, tâche 9) ; `groupMembers(groupId: string): string[]` dans `fleet/groups.ts`.

- [ ] **Step 1: Write `AgentRow`**

`src/fleet/AgentRow.tsx` :

```tsx
import type { ReactNode } from "react";
import { Crosshair, Pause, Play, X } from "lucide-react";
import { focusNode } from "@/canvas/focusNode";
import { HeaderButton } from "@/nodes/terminal/TerminalHeader";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import { useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { canPause, canResume, pauseAgents, resumeAgent } from "./broadcast";
import { AGENTS, INDIGO } from "./catalog";
import { requestClose } from "./terminals";

/**
 * One agent of the fleet panel or of an orchestrator: logo, name, agent, pill;
 * on hover, Centrer (orchestrator), Pause, Reprendre and Fermer (spec habillage §5.5, §13).
 */
export function AgentRow(props: { id: string; onOpen?: () => void; trailing?: ReactNode; showCenter?: boolean }) {
  const { id, onOpen, trailing, showCenter = false } = props;
  const payload = useNodes((s) => terminalOf(s.nodes[id]));
  const status = useTerminalStatus(id);
  const activity = useActivity(id);
  if (!payload) return null;
  const meta = AGENTS[payload.agent];
  const name = payload.name || meta.label;
  const facts = { agent: payload.agent, running: status.state === "running", activity: activity?.activity };
  return (
    <div className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ov-hover">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-md"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: meta.tint }}
        >
          <meta.Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ov-text">
          {name} <span className="text-ov-text-2">{meta.label}</span>
        </span>
      </button>
      <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} />
      {trailing}
      <span className="hidden items-center gap-0.5 group-hover:flex">
        {showCenter && (
          <HeaderButton label={`Centrer ${name}`} onClick={() => focusNode(id)}>
            <Crosshair />
          </HeaderButton>
        )}
        {canPause(facts) && (
          <HeaderButton label={`Mettre ${name} en pause`} onClick={() => void pauseAgents([id])}>
            <Pause />
          </HeaderButton>
        )}
        {canResume(facts) && (
          <HeaderButton label={`Reprendre ${name}`} onClick={() => void resumeAgent(id)}>
            <Play />
          </HeaderButton>
        )}
        <HeaderButton label={`Fermer ${name}`} onClick={() => requestClose(id)}>
          <X />
        </HeaderButton>
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Use it in the fleet panel**

`src/fleet/FleetPanel.tsx` : retirer les imports devenus inutiles (`X`, `StatusPill`, `INDIGO`, `requestClose`), importer `AgentRow`, mettre à jour le commentaire du composant (« the fleet of the workspace on screen, by group (spec habillage §5.5) ») et remplacer la boucle `section.agents.map((a) => { … })` par :

```tsx
          {section.agents.map((a) => (
            <AgentRow
              key={a.id}
              id={a.id}
              onOpen={() => focusNode(a.id)}
              trailing={
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ov-text-2">
                  {a.since !== undefined ? formatDuration(now - a.since) : ""}
                </span>
              }
            />
          ))}
```

- [ ] **Step 3: Chips and group menu**

`src/fleet/groups.ts`, à la fin :

```ts
/** The terminals of a group, for its menu's pause and resume. */
export function groupMembers(groupId: string): string[] {
  return canvasStore.getState().frames.find((f) => f.id === groupId)?.memberIds ?? [];
}
```

`src/shell/ActionChips.tsx` : importer `import { pauseAll, resumeAll, workspaceTerminalIds } from "@/fleet/broadcast";`, commentaire « Chips above the command bar (spec habillage §5.6). », et après `<ComposeGroup />` :

```tsx
      <ChipButton onClick={() => void pauseAll(workspaceTerminalIds())}>Tout mettre en pause</ChipButton>
      <ChipButton onClick={() => void resumeAll(workspaceTerminalIds())}>Tout reprendre</ChipButton>
```

`src/fleet/GroupMenu.tsx` : importer `import { pauseAll, resumeAll } from "./broadcast";` et `groupMembers` avec les autres fonctions de `./groups` ; après `</DropdownMenuSub>` et avant le `<DropdownMenuSeparator />` :

```tsx
        <DropdownMenuItem onSelect={() => void pauseAll(groupMembers(groupId))}>Tout mettre en pause</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void resumeAll(groupMembers(groupId))}>Tout reprendre</DropdownMenuItem>
```

- [ ] **Step 4: Check the build and the suite**

Run: `pnpm exec tsc --noEmit` puis `pnpm test` puis `pnpm build`
Expected: aucune erreur, tous les tests passent, build propre.

- [ ] **Step 5: Check in the app**

Les puces « Tout mettre en pause » et « Tout reprendre » suivent « Groupe » ; un Claude EN COURS (consigne longue) est interrompu par « Tout mettre en pause », toast « 1 agent mis en pause », pastille PRÊT peu après ; « Tout reprendre » lui envoie « continue » (toast « 1 agent repris ») et pas aux agents qui étaient PRÊTS avant ; le menu `⌄` d'un groupe offre les deux actions restreintes au groupe ; au survol d'une ligne du panneau Flotte : Pause sur un agent EN COURS, Reprendre sur un agent PRÊT, Fermer toujours.

- [ ] **Step 6: Commit**

```bash
git add src/fleet/AgentRow.tsx src/fleet/FleetPanel.tsx src/shell/ActionChips.tsx src/fleet/GroupMenu.tsx src/fleet/groups.ts
git commit -m "feat(fleet): pause and resume from the chips, group menu and fleet panel"
```

---

### Task 8: Liaisons de l'orchestrateur

**Files:**
- Create: `src/fleet/wires.ts`, `src/fleet/wires.test.ts`
- Modify: `src/fleet/groupLayout.ts`, `src/fleet/groupLayout.test.ts`
- Modify: `src/canvas/canvasStore.ts`, `src/canvas/canvasStore.test.ts`, `src/canvas/Canvas.tsx`

**Interfaces:**
- Consumes: `groupInfoOf`, `groupAt`, `SceneFrame`, `Rect` (`@/canvas/groups`) ; `nodeKindOf`, `NODE_SIZE` ; `findTerminalAt` (`@/canvas/hitTest`) ; `GROUP_GAP`.
- Produces: `WIRE_COLOR`, `interface Links { groupIds: string[]; nodeIds: string[] }`, `NO_LINKS`, `isWire(element)`, `orchestratorTargets(elements, orchestratorId): Links`, `orchestratorLinks(elements): Record<string, Links>`, `sameLinks(a, b)`, `createWire(orchestrator, target): ExcalidrawArrowElement`, `withWire(elements, orchestratorId, targetId): ExcalidrawElement[]`, `unmarkedWires(elements): string[]`, `linkTargetAt(elements, frames, point): string | null`, `interface LinkedAgents { groups: SceneFrame[]; directIds: string[]; agentIds: string[] }`, `linkedAgents(links, frames)` ; `orchestratorSpot(frame: Rect): Point` ; `canvasStore.links` / `setLinks`.

- [ ] **Step 1: Write the failing tests**

`src/fleet/wires.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, framesFromScene } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import {
  createWire,
  isWire,
  linkedAgents,
  linkTargetAt,
  orchestratorLinks,
  orchestratorTargets,
  unmarkedWires,
  WIRE_COLOR,
  withWire,
} from "./wires";

const orchestrator = createNodeElement("orchestrator", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
const frame = createGroupFrame({ x: 600, y: -300, width: 900, height: 600 }, "Backend", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
const member = { ...createNodeElement("terminal", { x: 1000, y: 0 }), frameId: frame.id } as unknown as ExcalidrawElement;
const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
const plain = { ...frame, id: "plain", customData: undefined } as ExcalidrawElement;
const base = [orchestrator, frame, member, lone, plain];

/** An arrow drawn by hand: no mark, bound the other way round. */
function handDrawn(from: ExcalidrawElement, to: ExcalidrawElement): ExcalidrawElement {
  const wire = createWire(from, to);
  return { ...wire, id: `hand-${to.id}`, customData: undefined } as ExcalidrawElement;
}

describe("withWire / createWire", () => {
  it("adds an orange curved arrow without heads, bound at both ends", () => {
    const elements = withWire(base, orchestrator.id, frame.id);
    const wire = elements[elements.length - 1] as ExcalidrawArrowElement;
    expect(wire).toMatchObject({
      type: "arrow",
      strokeColor: WIRE_COLOR,
      startArrowhead: null,
      endArrowhead: null,
      startBinding: { elementId: orchestrator.id },
      endBinding: { elementId: frame.id },
      customData: { dummyplane: { kind: "wire" } },
    });
    expect(wire.points).toHaveLength(3);
    expect(isWire(wire)).toBe(true);
    const bound = (id: string) => elements.find((e) => e.id === id)?.boundElements;
    expect(bound(orchestrator.id)).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(bound(frame.id)).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("does not wire the same target twice", () => {
    const once = withWire(base, orchestrator.id, lone.id);
    expect(withWire(once, orchestrator.id, lone.id)).toHaveLength(once.length);
  });
});

describe("orchestratorTargets", () => {
  it("finds the groups and terminals wired to the orchestrator, either way round", () => {
    const elements = [...withWire(base, orchestrator.id, frame.id), handDrawn(lone, orchestrator)];
    expect(orchestratorTargets(elements, orchestrator.id)).toEqual({ groupIds: [frame.id], nodeIds: [lone.id] });
  });

  it("drops deleted arrows, deleted targets and plain frames", () => {
    const wired = withWire(withWire(base, orchestrator.id, frame.id), orchestrator.id, plain.id);
    const arrows = wired.filter((e) => e.type === "arrow");
    expect(orchestratorTargets(wired, orchestrator.id)).toEqual({ groupIds: [frame.id], nodeIds: [] });
    const cut = wired.map((e) => (e.id === arrows[0].id ? { ...e, isDeleted: true } : e));
    expect(orchestratorTargets(cut, orchestrator.id).groupIds).toEqual([]);
    const gone = wired.map((e) => (e.id === frame.id ? { ...e, isDeleted: true } : e));
    expect(orchestratorTargets(gone, orchestrator.id).groupIds).toEqual([]);
  });

  it("maps every orchestrator of the scene", () => {
    const elements = withWire(base, orchestrator.id, lone.id);
    expect(orchestratorLinks(elements)).toEqual({ [orchestrator.id]: { groupIds: [], nodeIds: [lone.id] } });
  });
});

describe("unmarkedWires", () => {
  it("lists the hand-drawn arrows between an orchestrator and a target", () => {
    const hand = handDrawn(orchestrator, lone);
    const stray = { ...handDrawn(member, lone), id: "stray" } as ExcalidrawElement;
    const elements = [...withWire(base, orchestrator.id, frame.id), hand, stray];
    expect(unmarkedWires(elements)).toEqual([hand.id]);
  });
});

describe("linkTargetAt", () => {
  it("links a lone terminal, and the group of a terminal inside one", () => {
    const frames = framesFromScene(base);
    expect(linkTargetAt(base, frames, { x: lone.x + 10, y: lone.y + 10 })).toBe(lone.id);
    expect(linkTargetAt(base, frames, { x: member.x + 10, y: member.y + 10 })).toBe(frame.id);
    expect(linkTargetAt(base, frames, { x: frame.x + 5, y: frame.y + 5 })).toBe(frame.id);
    expect(linkTargetAt(base, frames, { x: -5000, y: -5000 })).toBeNull();
  });
});

describe("linkedAgents", () => {
  it("lists the agents of the wired groups, then the terminals wired directly", () => {
    const frames = framesFromScene(base);
    expect(linkedAgents({ groupIds: [frame.id], nodeIds: [lone.id, member.id] }, frames)).toEqual({
      groups: [frames.find((f) => f.id === frame.id)],
      directIds: [lone.id],
      agentIds: [member.id, lone.id],
    });
  });
});
```

`src/fleet/groupLayout.test.ts` (importer aussi `orchestratorSpot`) :

```ts
describe("orchestratorSpot", () => {
  it("puts an orchestrator to the left of the group, its top on the group's top", () => {
    expect(orchestratorSpot({ x: 1000, y: 500, width: 900, height: 600 })).toEqual({ x: 1000 - GROUP_GAP - 160, y: 710 });
  });
});
```

`src/canvas/canvasStore.test.ts` :

```ts
describe("links", () => {
  it("keeps the same map when the wires did not change", () => {
    const links = { o1: { groupIds: ["g1"], nodeIds: [] } };
    canvasStore.getState().setLinks(links);
    canvasStore.getState().setLinks({ o1: { groupIds: ["g1"], nodeIds: [] } });
    expect(canvasStore.getState().links).toBe(links);
    canvasStore.getState().setLinks({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/fleet/wires.test.ts src/fleet/groupLayout.test.ts src/canvas/canvasStore.test.ts`
Expected: FAIL — `./wires` introuvable, `orchestratorSpot` et `setLinks` inexistants.

- [ ] **Step 3: Write the implementation**

`src/fleet/groupLayout.ts`, à la fin (`NODE_SIZE` y est déjà importé ; ajouter `import type { Point } from "./terminals";`, import de type seulement : `terminals.ts` importe ce module) :

```ts
/** Where "Relier un orchestrateur" puts it: left of the group, tops aligned (spec habillage §11.4). */
export function orchestratorSpot(frame: Rect): Point {
  const { width, height } = NODE_SIZE.orchestrator;
  return { x: frame.x - GROUP_GAP - width / 2, y: frame.y + height / 2 };
}
```

`src/fleet/wires.ts` :

```ts
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupAt, groupInfoOf, type SceneFrame } from "@/canvas/groups";
import { findTerminalAt } from "@/canvas/hitTest";
import { nodeKindOf } from "@/canvas/nodeElement";
import type { Point } from "./terminals";

/** The orange of the wires (spec habillage §13). */
export const WIRE_COLOR = "#f4602e";

/** Space between a wire's ends and the elements it joins. */
const GAP = 8;

/** What an orchestrator is wired to. */
export interface Links {
  groupIds: string[];
  nodeIds: string[];
}

export const NO_LINKS: Links = { groupIds: [], nodeIds: [] };

export function isWire(element: ExcalidrawElement): boolean {
  const data = element.customData?.dummyplane as { kind?: unknown } | undefined;
  return data?.kind === "wire";
}

/** What an orchestrator can be wired to: a group's frame or a terminal (not a plain frame). */
function isWireTarget(element: ExcalidrawElement | undefined): element is ExcalidrawElement {
  return element !== undefined && !element.isDeleted && (groupInfoOf(element) !== null || nodeKindOf(element) === "terminal");
}

/** The element at the other end of an arrow bound to `orchestratorId`, either way round. */
function otherEnd(arrow: ExcalidrawElement, orchestratorId: string): string | null {
  if (arrow.type !== "arrow") return null;
  const start = arrow.startBinding?.elementId;
  const end = arrow.endBinding?.elementId;
  if (start === orchestratorId) return end ?? null;
  if (end === orchestratorId) return start ?? null;
  return null;
}

/**
 * The groups and terminals wired to an orchestrator, from the arrows of the
 * scene: deleting an arrow or its target cuts the link (spec §13).
 */
export function orchestratorTargets(elements: readonly ExcalidrawElement[], orchestratorId: string): Links {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const links: Links = { groupIds: [], nodeIds: [] };
  for (const element of elements) {
    if (element.isDeleted) continue;
    const otherId = otherEnd(element, orchestratorId);
    const other = otherId ? byId.get(otherId) : undefined;
    if (!isWireTarget(other)) continue;
    if (groupInfoOf(other)) {
      if (!links.groupIds.includes(other.id)) links.groupIds.push(other.id);
    } else if (!links.nodeIds.includes(other.id)) {
      links.nodeIds.push(other.id);
    }
  }
  return links;
}

/** The links of every orchestrator of the scene. */
export function orchestratorLinks(elements: readonly ExcalidrawElement[]): Record<string, Links> {
  return Object.fromEntries(
    elements
      .filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator")
      .map((o) => [o.id, orchestratorTargets(elements, o.id)]),
  );
}

export function sameLinks(a: Record<string, Links>, b: Record<string, Links>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return keys.every((k) => b[k] !== undefined && same(a[k].groupIds, b[k].groupIds) && same(a[k].nodeIds, b[k].nodeIds));
}

/**
 * A complete arrow from the side of `orchestrator` facing `target` to the side
 * of `target` facing it, curving gently, without heads (spec §13). Every base
 * field is set here, as for the nodes (Excalidraw's skeletons cannot bind to
 * existing elements).
 */
export function createWire(orchestrator: ExcalidrawElement, target: ExcalidrawElement): ExcalidrawArrowElement {
  const toRight = target.x + target.width / 2 >= orchestrator.x + orchestrator.width / 2;
  const start = {
    x: toRight ? orchestrator.x + orchestrator.width + GAP : orchestrator.x - GAP,
    y: orchestrator.y + orchestrator.height / 2,
  };
  const end = {
    x: toRight ? target.x - GAP : target.x + target.width + GAP,
    y: target.y + target.height / 2,
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const points = [
    [0, 0],
    [dx / 2, dy / 2 - Math.abs(dx) * 0.12],
    [dx, dy],
  ] as const;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const random = () => Math.floor(Math.random() * 2 ** 31);
  return {
    id: crypto.randomUUID(),
    type: "arrow",
    x: start.x,
    y: start.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    angle: 0 as ExcalidrawArrowElement["angle"],
    strokeColor: WIRE_COLOR,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    // Excalidraw's ROUNDNESS.PROPORTIONAL_RADIUS: the line curves through its middle point.
    roundness: { type: 2 },
    roughness: 0,
    opacity: 100,
    seed: random(),
    version: 1,
    versionNonce: random(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: points.map(([x, y]) => [x, y]) as unknown as ExcalidrawArrowElement["points"],
    lastCommittedPoint: null,
    startBinding: { elementId: orchestrator.id, focus: 0, gap: GAP },
    endBinding: { elementId: target.id, focus: 0, gap: GAP },
    startArrowhead: null,
    endArrowhead: null,
    elbowed: false,
    customData: { dummyplane: { kind: "wire" } },
  };
}

/** `elements` with a new wire, recorded on both ends, unless one already joins them (spec §13). */
export function withWire(elements: readonly ExcalidrawElement[], orchestratorId: string, targetId: string): ExcalidrawElement[] {
  const orchestrator = elements.find((e) => e.id === orchestratorId && !e.isDeleted);
  const target = elements.find((e) => e.id === targetId && !e.isDeleted);
  if (!orchestrator || !target) return [...elements];
  const links = orchestratorTargets(elements, orchestratorId);
  if (links.groupIds.includes(targetId) || links.nodeIds.includes(targetId)) return [...elements];
  const wire = createWire(orchestrator, target);
  const bind = (e: ExcalidrawElement): ExcalidrawElement => ({
    ...e,
    boundElements: [...(e.boundElements ?? []), { id: wire.id, type: "arrow" }],
    version: e.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  });
  return [...elements.map((e) => (e.id === orchestratorId || e.id === targetId ? bind(e) : e)), wire];
}

/** Arrows drawn by hand between an orchestrator and a group or terminal: they get the wire mark (spec §13). */
export function unmarkedWires(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const orchestrators = elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator").map((e) => e.id);
  return elements
    .filter((e) => !e.isDeleted && e.type === "arrow" && !isWire(e))
    .filter((arrow) =>
      orchestrators.some((id) => {
        const otherId = otherEnd(arrow, id);
        return isWireTarget(otherId ? byId.get(otherId) : undefined);
      }),
    )
    .map((arrow) => arrow.id);
}

/** What a click of "Relier" designates: a lone terminal, else the group under the pointer (spec §13). */
export function linkTargetAt(elements: readonly ExcalidrawElement[], frames: readonly SceneFrame[], point: Point): string | null {
  const terminal = findTerminalAt(elements, point.x, point.y);
  if (terminal) {
    const group = frames.find((f) => f.group !== null && f.memberIds.includes(terminal.id));
    return group ? group.id : terminal.id;
  }
  return groupAt(frames, point)?.id ?? null;
}

/** The agents an orchestrator commands. */
export interface LinkedAgents {
  groups: SceneFrame[];
  /** Terminals wired directly, outside the wired groups. */
  directIds: string[];
  agentIds: string[];
}

export function linkedAgents(links: Links, frames: readonly SceneFrame[]): LinkedAgents {
  const groups = links.groupIds.flatMap((id) => frames.filter((f) => f.id === id && f.group !== null));
  const inGroups = groups.flatMap((g) => g.memberIds);
  const directIds = links.nodeIds.filter((id) => !inGroups.includes(id));
  return { groups, directIds, agentIds: [...new Set([...inGroups, ...directIds])] };
}
```

`src/canvas/canvasStore.ts` : importer `import { sameLinks, type Links } from "@/fleet/wires";` ; dans `CanvasState`, après `setNodeIds` :

```ts
  /** What each orchestrator of the scene is wired to (spec habillage §13). */
  links: Record<string, Links>;
  setLinks: (links: Record<string, Links>) => void;
```

et dans le store, après `setNodeIds` :

```ts
  links: {},
  setLinks: (links) => {
    if (!sameLinks(get().links, links)) set({ links });
  },
```

`src/canvas/Canvas.tsx` (application fermée) :
- imports : `import { CaptureUpdateAction, Excalidraw, getSceneVersion, newElementWith } from "@excalidraw/excalidraw";` et `import { orchestratorLinks, unmarkedWires } from "@/fleet/wires";` ;
- dans l'effet de démontage, vider aussi : `canvasStore.getState().setLinks({});` ;
- dans `onChange`, après `setNodeIds(…)` :

```ts
      canvasStore.getState().setLinks(orchestratorLinks(elements));
      const unmarked = unmarkedWires(elements);
      if (unmarked.length > 0 && api) requestAnimationFrame(() => markWires(api, unmarked));
```

- après `showAtFullSize` :

```ts
/** Hand-drawn wires get their mark, outside the undo history (spec habillage §13). */
function markWires(api: ExcalidrawImperativeAPI, ids: readonly string[]) {
  const marked = new Set(ids);
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (marked.has(e.id) ? newElementWith(e, { customData: { ...e.customData, dummyplane: { kind: "wire" } } }) : e)),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/fleet/wires.test.ts src/fleet/groupLayout.test.ts src/canvas/canvasStore.test.ts`
Expected: PASS. Puis `pnpm exec tsc --noEmit` et `pnpm test` : aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/wires.ts src/fleet/wires.test.ts src/fleet/groupLayout.ts src/fleet/groupLayout.test.ts src/canvas/canvasStore.ts src/canvas/canvasStore.test.ts src/canvas/Canvas.tsx
git commit -m "feat(fleet): orchestrator wires derived from bound arrows"
```

---

### Task 9: Le nœud orchestrateur

**Files:**
- Create: `src/fleet/orchestrators.ts`, `src/fleet/LinkMode.tsx`, `src/nodes/orchestrator/OrchestratorNode.tsx`
- Modify: `src/nodes/NodeHost.tsx`, `src/store/ui.ts`, `src/fleet/GroupMenu.tsx`, `src/shell/ProjectView.tsx`

**Interfaces:**
- Consumes: tâche 2 (nœud), tâche 3 (`targetAgents`, `agentsText`, `groupsText`, `countsText`), tâche 4 (`pauseAll`, `resumeAll`), tâche 6 (`CommandInput`), tâche 7 (`AgentRow`), tâche 8 (`withWire`, `linkTargetAt`, `linkedAgents`, `NO_LINKS`, `orchestratorSpot`, `canvasStore.links`) ; `frameStyle` ; `HeaderButton` ; `sceneOf`, `clientRectOf`.
- Produces: `orchestrateGroup(groupId)`, `linkOrchestrator(orchestratorId, targetId)`, `removeOrchestrator(id)`, `renameOrchestrator(id, name)` ; `uiStore.linking` / `setLinking` ; `OrchestratorNode({ nodeId })`, `LinkMode()`.

- [ ] **Step 1: Write the actions**

`src/store/ui.ts` : dans `UiState`, après `setFleetOpen` :

```ts
  /** The orchestrator in "Relier" mode: each click wires a group or a terminal to it. */
  linking: string | null;
  setLinking: (orchestratorId: string | null) => void;
```

et dans le store : `linking: null,` `setLinking: (linking) => set({ linking }),`.

`src/fleet/orchestrators.ts` :

```ts
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { canvasStore } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { ORCHESTRATOR_NAME } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { orchestratorSpot } from "./groupLayout";
import { withWire } from "./wires";

/** "Relier un orchestrateur" of the group menu: a new orchestrator left of the group, wired to it, in one undo step. */
export async function orchestrateGroup(groupId: string) {
  const api = canvasStore.getState().api;
  const workspaceId = workspacesStore.getState().activeId;
  const group = canvasStore.getState().frames.find((f) => f.id === groupId);
  if (!api || !workspaceId || !group || !isGroup(group)) return;
  const element = createNodeElement("orchestrator", orchestratorSpot(group));
  await nodesStore.getState().create(element.id, { workspaceId, kind: "orchestrator", payload: { name: ORCHESTRATOR_NAME } });
  api.updateScene({
    elements: withWire([...api.getSceneElementsIncludingDeleted(), element], element.id, groupId),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** One click of "Relier" (spec habillage §13). */
export function linkOrchestrator(orchestratorId: string, targetId: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  api.updateScene({
    elements: withWire(api.getSceneElementsIncludingDeleted(), orchestratorId, targetId),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** The × of an orchestrator: it and its wires go, in one undo step. */
export function removeOrchestrator(orchestratorId: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  const wired = (e: { type: string; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null }) =>
    e.type === "arrow" && (e.startBinding?.elementId === orchestratorId || e.endBinding?.elementId === orchestratorId);
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (!e.isDeleted && (e.id === orchestratorId || wired(e)) ? newElementWith(e, { isDeleted: true }) : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

export function renameOrchestrator(orchestratorId: string, name: string) {
  nodesStore.getState().update(orchestratorId, { name: name.trim() || ORCHESTRATOR_NAME });
}
```

- [ ] **Step 2: Write the "Relier" mode**

`src/fleet/LinkMode.tsx` :

```tsx
import { useEffect, useState } from "react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { uiStore, useUi } from "@/store/ui";
import { linkOrchestrator } from "./orchestrators";
import { clientRectOf, sceneOf } from "./placement";
import type { Point } from "./terminals";
import { linkTargetAt } from "./wires";

/** "Relier" (spec habillage §13): each click wires a group or a terminal; Escape or a click in the void ends it. */
export function LinkMode() {
  const linking = useUi((s) => s.linking);
  const view = useCanvas((s) => s.view);
  const frames = useCanvas((s) => s.frames);
  const [pointer, setPointer] = useState<Point | null>(null);

  useEffect(() => {
    if (!linking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.getState().setLinking(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linking]);

  if (!linking) return null;
  const elements = canvasStore.getState().api?.getSceneElements() ?? [];
  const targetAt = (client: Point) => linkTargetAt(elements, frames, sceneOf(client, view));
  const hovered = pointer ? targetAt(pointer) : null;
  const rect = hovered ? (frames.find((f) => f.id === hovered) ?? elements.find((e) => e.id === hovered)) : undefined;

  return (
    <div
      className="fixed inset-0 z-40 cursor-crosshair"
      onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
      onContextMenu={(e) => {
        e.preventDefault();
        uiStore.getState().setLinking(null);
      }}
      onClick={(e) => {
        const target = targetAt({ x: e.clientX, y: e.clientY });
        if (target) linkOrchestrator(linking, target);
        else uiStore.getState().setLinking(null);
      }}
    >
      {rect && (
        <div
          className="pointer-events-none fixed rounded-xl border-2 border-dashed border-ov-accent/80 bg-ov-accent/5"
          style={clientRectOf(rect, view)}
        />
      )}
      <div className="pointer-events-none fixed left-1/2 top-16 -translate-x-1/2 rounded-full border border-ov-line bg-ov-surface-2 px-3 py-1 text-xs text-ov-text-2 shadow-ov">
        Clique sur un groupe ou un agent à relier · Échap pour terminer
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the node**

`src/nodes/orchestrator/OrchestratorNode.tsx` :

```tsx
import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentRow } from "@/fleet/AgentRow";
import { pauseAll, resumeAll } from "@/fleet/broadcast";
import { AGENTS } from "@/fleet/catalog";
import { CommandInput } from "@/fleet/CommandInput";
import { agentsText, countsText, groupsText } from "@/fleet/groupSummary";
import { removeOrchestrator, renameOrchestrator } from "@/fleet/orchestrators";
import { ROLES } from "@/fleet/roles";
import { targetAgents } from "@/fleet/targets";
import { linkedAgents, NO_LINKS } from "@/fleet/wires";
import { useActivities } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { uiStore, useUi } from "@/store/ui";
import { frameStyle } from "../terminal/frame";
import { HeaderButton } from "../terminal/TerminalHeader";

/** A node that commands the groups and terminals wired to it (spec habillage §13). */
export function OrchestratorNode({ nodeId }: { nodeId: string }) {
  const record = useNodes((s) => s.nodes[nodeId]);
  const nodes = useNodes((s) => s.nodes);
  const links = useCanvas((s) => s.links[nodeId] ?? NO_LINKS);
  const frames = useCanvas((s) => s.frames);
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  const linking = useUi((s) => s.linking === nodeId);
  const activities = useActivities();

  if (record?.kind !== "orchestrator") {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-ov-line bg-ov-surface text-sm text-ov-text-2">
        Orchestrateur introuvable
      </div>
    );
  }

  const linked = linkedAgents(links, frames);
  const working = (ids: readonly string[]) => ids.filter((id) => activities[id]?.activity === "working").length;
  const nameOf = (id: string) => {
    const payload = terminalOf(nodes[id]);
    return payload ? payload.name || AGENTS[payload.agent].label : undefined;
  };
  const agents = targetAgents(linked.agentIds, nameOf, frames);
  const count = linked.agentIds.length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ov-surface-2" style={frameStyle("#f4602e", selected, false)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-ov-line px-3">
        <span className="ov-orb ov-orb-live size-4 shrink-0" />
        <NameField value={record.payload.name} onCommit={(name) => renameOrchestrator(nodeId, name)} />
        <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-ov-text-2" title="Agents en activité / agents reliés">
          <ProgressRing value={working(linked.agentIds)} total={count} />
          {working(linked.agentIds)}/{count}
        </span>
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
      <div className="flex shrink-0 items-center justify-between px-3 py-2 text-xs text-ov-text-2">
        <span>
          {agentsText(count)} · {groupsText(linked.groups.length)}
        </span>
        <button
          type="button"
          onClick={() => uiStore.getState().setLinking(linking ? null : nodeId)}
          className="rounded-full bg-ov-accent px-2.5 py-0.5 text-[11px] font-semibold text-white hover:brightness-110"
        >
          {linking ? "Terminer" : "+ Relier"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {count === 0 && <p className="py-6 text-center text-xs text-ov-text-2">Relie un groupe ou un agent avec « + Relier »</p>}
        {linked.groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-1 pb-2">
            <header className="flex items-center gap-1.5 px-1 text-[11px]">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: group.group ? ROLES[group.group.role].color : "var(--ov-idle)" }} />
              <span className="font-semibold uppercase tracking-[0.08em] text-ov-text">{group.name}</span>
              <span className="ml-auto font-mono text-ov-text-2">{countsText(group.memberIds.length, working(group.memberIds))}</span>
            </header>
            {group.memberIds.map((id) => (
              <AgentRow key={id} id={id} showCenter />
            ))}
          </section>
        ))}
        {linked.directIds.map((id) => (
          <AgentRow key={id} id={id} showCenter />
        ))}
      </div>
      <footer className="shrink-0 border-t border-ov-line p-2">
        <CommandInput
          compact
          agents={agents}
          groups={linked.groups}
          fallback={linked.agentIds}
          placeholder={`Commander ${agentsText(count)} · @ pour cibler…`}
          emptyHint="Relie des agents à cet orchestrateur"
        />
      </footer>
    </div>
  );
}

/** The orchestrator's name; a double-click edits it, Enter or a click elsewhere keeps it, Escape cancels. */
function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <span className="truncate text-[13px] font-semibold text-ov-text" onDoubleClick={() => setDraft(value)} title="Double-clic pour renommer">
        {value}
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="w-36 rounded bg-ov-card px-1 text-[13px] font-semibold text-ov-text outline-none"
    />
  );
}

/** `◌ 3/8`: the share of wired agents at work. */
function ProgressRing({ value, total }: { value: number; total: number }) {
  const radius = 5;
  const length = 2 * Math.PI * radius;
  const done = total > 0 ? (value / total) * length : 0;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90">
      <circle cx="7" cy="7" r={radius} fill="none" stroke="var(--ov-line)" strokeWidth="2" />
      <circle cx="7" cy="7" r={radius} fill="none" stroke="var(--ov-working)" strokeWidth="2" strokeDasharray={`${done} ${length}`} />
    </svg>
  );
}
```

- [ ] **Step 4: Wire it in**

`src/nodes/NodeHost.tsx` : importer `import { OrchestratorNode } from "./orchestrator/OrchestratorNode";` et ajouter dans le `switch` :

```tsx
    case "orchestrator":
      return <OrchestratorNode nodeId={element.id} />;
```

`src/fleet/GroupMenu.tsx` : importer `import { orchestrateGroup } from "./orchestrators";` ; commentaire du composant « The `⌄` of a group label (spec habillage §11.4). » ; après `</DropdownMenuSub>` et avant « Tout mettre en pause » :

```tsx
        <DropdownMenuItem
          onSelect={() =>
            void orchestrateGroup(groupId).catch((error: unknown) => toast.error(`Orchestrateur impossible : ${String(error)}`))
          }
        >
          Relier un orchestrateur
        </DropdownMenuItem>
```

`src/shell/ProjectView.tsx` : importer `import { LinkMode } from "@/fleet/LinkMode";` et ajouter `<LinkMode />` après `<PlacementGhost />`.

- [ ] **Step 5: Check the build and the suite**

Run: `pnpm exec tsc --noEmit` puis `pnpm test` puis `pnpm build`
Expected: aucune erreur, tous les tests passent, build propre.

- [ ] **Step 6: Check in the app**

Application fermée pendant les modifications de `Canvas.tsx` (tâche 8), puis relancée : « Relier un orchestrateur » du menu d'un groupe crée un orchestrateur à gauche du groupe, relié par une flèche orange courbe sans tête ; l'orchestrateur liste le groupe (point, nom, compteurs) et ses agents, avec leurs pastilles ; « 4 agents · 1 groupe », anneau `◌ n/4` ; « + Relier » puis un clic sur un terminal hors groupe le relie (contour pointillé au survol), un clic dans le vide termine ; le pied « Commander 5 agents · @ pour cibler… » tape une consigne dans les agents reliés, `@` ne propose qu'eux ; supprimer la flèche (sélection + Suppr) retire la liaison de la liste ; une flèche tirée à la main de l'orchestrateur vers un terminal compte ; double-clic sur le nom pour renommer ; × supprime l'orchestrateur et ses flèches, Ctrl+Z les ramène ; Ctrl+D sur l'orchestrateur en fait une copie nommée pareil, sans liaison.

- [ ] **Step 7: Commit**

```bash
git add src/fleet/orchestrators.ts src/fleet/LinkMode.tsx src/nodes/orchestrator/OrchestratorNode.tsx src/nodes/NodeHost.tsx src/store/ui.ts src/fleet/GroupMenu.tsx src/shell/ProjectView.tsx
git commit -m "feat(orchestrator): node, Relier mode and group menu entry"
```

---

## Vérifications manuelles de Mathieu (J5)

- `@tous` puis `@backend` puis la sélection : chaque consigne n'arrive qu'aux agents visés ; les arrêtés sont nommés dans un toast.
- Une consigne sur plusieurs lignes (Maj+Entrée) est reçue en un seul message par Claude.
- Un orchestrateur relié à un groupe et à un terminal isolé commande les deux ; supprimer une flèche coupe la liaison.
- « Tout mettre en pause » puis « Tout reprendre » sur tout le workspace : seuls les agents qui travaillaient reprennent.
