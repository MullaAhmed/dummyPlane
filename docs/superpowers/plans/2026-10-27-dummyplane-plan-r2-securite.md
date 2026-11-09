# R2 « Tenir les promesses de sécurité » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ce que le README et SECURITY.md promettent devient vrai : un orchestrateur ne démarre jamais sans ses garde-fous, la webview a une CSP stricte, le jeton du serveur local n'apparaît plus dans aucune ligne de commande, et les terminaux n'héritent pas des marqueurs d'une session Claude Code.

**Architecture:** Garde dans `pty_spawn` (Rust) avec un nouveau type d'erreur `toolsUnavailable` que le nœud orchestrateur affiche ; réglages de l'orchestrateur durcis (`Bash` interdit, `--strict-mcp-config`). CSP dans `tauri.conf.json`. Jeton passé par un fichier de configuration curl (`-K`) et accepté en en-tête par le serveur. Liste de variables retirées complétée quand dummyPlane tourne dans Claude Code.

**Tech Stack:** Rust 2024, Tauri 2.12, tiny_http, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§4)

## Global Constraints

- Textes en français, tutoiement ; R5 traduira.
- Message du nœud : « Outils dummyPlane indisponibles » (spec orchestrateur §9).
- CSP de production, mot pour mot : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost data: blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`.
- En-tête du jeton : `X-dummyPlane-Token`. Fichier : `<app data>\hooks\curl.cfg`.
- Variables retirées seulement si `CLAUDECODE` est dans l'environnement d'dummyPlane : `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `AI_AGENT`, `GIT_EDITOR`, `NoDefaultCurrentDirectoryInExePath`.
- Vérification dans l'app : profil `dev.dummyplane.probe` uniquement.

## Review Focus

1. Un orchestrateur relancé (« Réessayer », « Relancer », reprise de toutes les conversations) quand le serveur local manque : il doit être refusé à chaque fois, jamais lancé nu.
2. Un chemin de données avec espaces ou apostrophe (`C:\Users\Jean Dupont\…`, `O'Brien`) : la ligne d'état et le `notify` de Codex doivent fonctionner avec `-K`.
3. Une ligne d'état utilisateur existante (`$2` avant, `$3` maintenant) : elle doit toujours s'afficher.
4. L'export SVG et l'insertion d'image sous la CSP (WebAssembly, workers `blob:`) : aucune violation.
5. Un utilisateur qui a lui-même `GIT_EDITOR` hors de Claude Code : il doit le garder.

---

### Task 1: L'orchestrateur refuse de démarrer sans ses outils

**Files:**
- Modify: `src-tauri/src/error.rs` (variant `ToolsUnavailable`, kind `toolsUnavailable`)
- Modify: `src-tauri/src/pty/shell.rs` (`orchestrator_tools`, `--strict-mcp-config` for the orchestrator)
- Modify: `src-tauri/src/commands/pty.rs` (refuse in `pty_spawn`), `src-tauri/src/commands/agents.rs` (`server_running`)
- Modify: `src-tauri/src/agents/claude_settings.rs` (deny `Bash`), `src-tauri/src/agents/prompts.rs` (wording)
- Modify: `src/ipc/invoke.ts` (`AppErrorKind`), `src/store/terminalStatus.ts` (`error` carries `kind?`), `src/nodes/terminal/session.ts` (passes the kind), `src/nodes/terminal/pill.ts` (no resume offer for `toolsUnavailable`), `src/nodes/orchestrator/OrchestratorNode.tsx` (banner, label)
- Test: Rust tests in `shell.rs`, `claude_settings.rs`, `error.rs`; `src/nodes/terminal/session.test.ts`, `src/nodes/terminal/pill.test.ts`, a new `src/nodes/orchestrator/ToolsUnavailable.test.tsx`

**Interfaces:**
- Produces (Rust): `pty::shell::orchestrator_tools(hooks: &AgentHooks, server_running: bool) -> Result<(), String>`; `AppError::ToolsUnavailable(String)`.
- Produces (TS): `TerminalStatus` error `{ state: "error"; message: string; kind?: AppErrorKind }`; `ToolsUnavailable({ nodeId, message })` component.

- [ ] **Step 1: Failing tests**

`shell.rs`:

```rust
    #[test]
    fn an_orchestrator_needs_all_its_tools() {
        let full = AgentHooks {
            claude_settings: Some("s.json".into()),
            mcp_config: Some("m.json".into()),
            system_prompt: Some("p.md".into()),
            ..Default::default()
        };
        assert_eq!(orchestrator_tools(&full, true), Ok(()));
        assert_eq!(
            orchestrator_tools(&AgentHooks::default(), false),
            Err("le serveur local d'dummyPlane n'a pas démarré".into())
        );
        let partial = AgentHooks { mcp_config: None, ..full.clone() };
        assert_eq!(
            orchestrator_tools(&partial, true),
            Err("ses réglages n'ont pas pu être écrits (voir le journal)".into())
        );
    }

    #[test]
    fn an_orchestrator_gets_only_dummyplanes_tools() {
        let hooks = hooked_full();   // settings + mcp + prompt
        let mut s = spec(Agent::Claude, Some(claude(ClaudeMode::New, Role::Orchestrator)));
        let command = agent_command(&s, ShellSyntax::Cmd, &hooks).unwrap().unwrap();
        assert!(command.contains("--strict-mcp-config"));
        s.claude.as_mut().unwrap().role = Role::Agent;
        let command = agent_command(&s, ShellSyntax::Cmd, &hooks).unwrap().unwrap();
        assert!(!command.contains("--strict-mcp-config"));
    }
```

(Use or add the module's existing helpers for a `ClaudeLaunch` and hooks; `AgentHooks` gets `#[derive(Clone)]` if missing.)

`claude_settings.rs`: the orchestrator's deny list is `["Edit", "Write", "NotebookEdit", "Bash"]`; an agent has none.

`error.rs`: `AppError::ToolsUnavailable("x".into())` serializes as `{ "kind": "toolsUnavailable", "message": "x" }`.

`session.test.ts`: a rejected spawn `{ kind: "toolsUnavailable", message: "Outils dummyPlane indisponibles : …" }` gives `statusOf("t")` `{ state: "error", message, kind: "toolsUnavailable" }` and writes nothing red in the terminal.

`pill.test.ts`: `resumeOfferOf({ state: "error", message: "m", kind: "toolsUnavailable" }, "claude", true)` → `null`.

`ToolsUnavailable.test.tsx`: renders the banner with « Outils dummyPlane indisponibles », the cause, buttons « Réessayer » and « Ouvrir le dossier des journaux »; « Réessayer » calls `relaunchTerminal(nodeId, payload, "resume" | "new")` (mocked).

- [ ] **Step 2: Run** — Rust and TS → FAIL (missing function, variant, kind, component).
- [ ] **Step 3: Implement**
  - `orchestrator_tools`: no server → cause 1; any of the three paths `None` → cause 2.
  - `pty_spawn`, after `hooks_for`: `if spec.agent == Agent::Claude && role == Role::Orchestrator { if let Err(cause) = orchestrator_tools(&hooks, agents::server_running(&app)) { agents::ended(&app, &node_id); log::warn!(…); return Err(AppError::ToolsUnavailable(format!("Outils dummyPlane indisponibles : {cause}."))); } }`.
  - `claude_command`: `--strict-mcp-config` right after `--mcp-config <file>` when `launch.role == Role::Orchestrator`.
  - Deny list + prompt: « tu ne codes pas toi-même (tu ne peux ni modifier de fichier ni lancer de commande) ».
  - TS: `startSession` keeps `kind` from `AppError`; for `toolsUnavailable` it does not write the red line (the banner says it). `resumeOfferOf` → `null` for that kind. `OrchestratorNode`: when `status.state === "error" && status.kind === "toolsUnavailable"`, render `<ToolsUnavailable>` over the terminal area; `sessionLabel` returns « outils indisponibles ». « Réessayer » relaunches with `payload.claudeSessionId ? "resume" : "new"`.
- [ ] **Step 4: Run** → PASS; full suites; clippy; tsc.
- [ ] **Step 5: Commit** — `fix(orchestrator): never start without dummyPlane's tools and guards`

### Task 2: Une CSP stricte

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`app.security.csp`, `app.security.devCsp`)
- Modify: `index.html` (no inline script), `src/main.tsx` (imports `./app/assetPath` first)
- Create: `src/app/assetPath.ts`, `src/app/csp.test.ts`

- [ ] **Step 1: Failing test** `src/app/csp.test.ts` (node environment):

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

it("loads nothing from the network and runs no injected script (spec première version §4.2)", () => {
  const csp = directives(config.app.security.csp);
  expect(csp["default-src"]).toEqual(["'self'"]);
  expect(csp["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  expect(csp["frame-src"]).toEqual(["'none'"]);
  expect(csp["object-src"]).toEqual(["'none'"]);
  expect(Object.values(csp).flat().some((v) => /^https?:\/\/(?!ipc\.localhost)/.test(v as string))).toBe(false);
});

it("keeps index.html free of inline scripts, which the policy would block", () => {
  const html = readFileSync("index.html", "utf8");
  expect(html).not.toMatch(/<script>(?!\s*<\/script>)/);
  expect(html).not.toContain("EXCALIDRAW_ASSET_PATH");
});
```

- [ ] **Step 2: Run** → FAIL (`csp` is null; inline script present).
- [ ] **Step 3: Implement** — the CSP of the Global Constraints; `devCsp` = same with `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` and `connect-src` plus `ws://localhost:1420 http://localhost:1420`; `src/app/assetPath.ts`: `(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/";` with a comment; first import of `main.tsx`.
- [ ] **Step 4: Run** → PASS; `pnpm build` OK.
- [ ] **Step 5: Probe check under the production policy** — `pnpm tauri build --debug --no-bundle --config '{"identifier":"dev.dummyplane.probe"}'`, run `src-tauri\target\debug\dummyplane.exe` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`; through CDP: collect `securitypolicyviolation` events and console errors while drawing a rectangle, inserting an AWS icon, inserting an image (data URL through Excalidraw's API), exporting a PNG and an SVG (`exportToSvg` with fonts), opening two shell terminals; expect zero violations and Excalidraw fonts loaded from `/fonts/`. Close with `closedev.ps1`.
- [ ] **Step 6: Commit** — `fix(security): give the webview a strict content security policy`

### Task 3: Le jeton sort des lignes de commande

**Files:**
- Modify: `src-tauri/src/agents/hooks_server.rs` (header accepted; URLs without token for status and Codex)
- Modify: `src-tauri/src/agents/claude_settings.rs` (`write_curl_config`, `StatusLine.config`, `STATUS_SCRIPT` arguments)
- Modify: `src-tauri/src/commands/agents.rs` (`AgentState.curl_config`, written at setup), `src-tauri/src/pty/shell.rs` (`AgentHooks.curl_config`, `codex_command`)

**Interfaces:**
- Produces: `hooks_server::TOKEN_HEADER = "X-dummyPlane-Token"`; `parse_route(url, token, header: Option<&str>)`, `parse_status_route(url, token, header: Option<&str>)`; `HookServer::bare_url(source, node)`, `HookServer::bare_status_url(node)`; `claude_settings::write_curl_config(dir: &Path, token: &str) -> io::Result<PathBuf>`.

- [ ] **Step 1: Failing tests**
  - `parse_route("/hook/codex/n1", "tok", Some("tok"))` → `Ok`; `Some("bad")` → `Err(403)`; `None` → `Err(403)`; the query form still passes.
  - `write_curl_config` writes `header = "X-dummyPlane-Token: tok"` and returns its path.
  - `status_line_json` with `url` `http://127.0.0.1:1/status/n1` and `config` `C:\data\hooks\curl.cfg` → `bash 'C:/data/hooks/statusline.sh' 'http://127.0.0.1:1/status/n1' 'C:/data/hooks/curl.cfg'` (user command as 4th word); `STATUS_SCRIPT` contains `-K "$2"` and runs `"$3"`.
  - `codex_command` with url and config → `notify=['curl.exe','-s','-K','C:\data\hooks\curl.cfg','-X','POST','http://127.0.0.1:1/hook/codex/n1','-d']`; no `t=` anywhere.
  - A hooks-server test posts to `/status/n1` with the header and no query → 204 (existing test harness in `hooks_server.rs`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** as in the Interfaces; `hooks_for` uses the bare URLs for the status line and Codex; Claude's http hooks keep `url()` (in a file only).
- [ ] **Step 4: Run** → PASS; full suite.
- [ ] **Step 5: Probe check** — a Shell terminal running `Get-CimInstance Win32_Process | ? CommandLine -match 't=[0-9a-f-]{36}'` while a Claude session (Haiku, `/context` only) shows its status line: no match; the usage meter still fills.
- [ ] **Step 6: Commit** — `fix(security): keep the local server's token off command lines`

### Task 4: Marqueurs de session hérités

**Files:**
- Modify: `src-tauri/src/pty/shell.rs` (`removed_env(inside_claude: bool) -> Vec<String>`, used by `build_plan`)

- [ ] **Step 1: Failing test**

```rust
    #[test]
    fn inside_claude_code_its_session_variables_stay_behind() {
        let outside = removed_env(false);
        assert_eq!(outside.len(), INHERITED_MARKERS.len());
        assert!(!outside.contains(&"GIT_EDITOR".to_string()));
        let inside = removed_env(true);
        for key in INHERITED_MARKERS.iter().chain(CLAUDE_SESSION_EXTRAS.iter()) {
            assert!(inside.contains(&key.to_string()), "{key}");
        }
    }
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** `CLAUDE_SESSION_EXTRAS` (the 8 names of the Global Constraints) and `removed_env`; `build_plan` uses `removed_env(std::env::var_os("CLAUDECODE").is_some())`. The existing test that checks 3 markers checks all 8. **Step 4:** PASS. **Step 5: Commit** — `fix(pty): leave a parent Claude Code session's variables out of terminals`

### Task 5: Fin du jalon

- [ ] `SECURITY.md` : retirer les deux limites réglées (jeton visible, pas de CSP) ; dire que l'orchestrateur ne peut ni écrire ni lancer de commande et refuse de démarrer sans ses garde-fous ; la CSP.
- [ ] `BACKLOG.md` : retirer les points réglés (marqueurs de session l. « Constats du plan A » et « au-delà des 8 de la spec », CSP, orchestrateur sans réglages, jeton dans la ligne de commande).
- [ ] Toutes les vérifications ; relecture finale (agent neuf, modèle le plus capable) ; corrections Critical/Important avec un test d'abord ; fusion dans `main`, push, branche supprimée.
