# dummyPlane H1 — Le pont MCP et la frise des étapes (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un serveur MCP local dans dummyPlane, donné à chaque session Claude, avec les outils d'agent (étapes, compte rendu), et la frise des étapes sous chaque terminal Claude.

**Architecture:** Rust ajoute une route `/mcp` au serveur des hooks (transport JSON-RPC, jeton par nœud) et transmet `tools/list` / `tools/call` à l'interface par l'évènement `mcp-call` (réponse : commande `mcp_reply`). Chaque lancement de Claude reçoit `--mcp-config` et `--append-system-prompt-file`, et ses réglages ajoutent les hooks des sous-agents et l'autorisation `mcp__dummyplane`. L'interface répond aux outils, enregistre les étapes dans le payload du terminal, et un calque dessine la frise sous chaque terminal.

**Tech Stack:** Rust (tiny_http, serde_json, uuid), Tauri 2 events et commandes, React 19 / TypeScript, Zustand 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-dummyplane-orchestrateur-manager-design.md` (jalon H1 : §4, §5, §6 pour la frise, §9 pour les erreurs du pont).

## Global Constraints

- Aucune dépendance ajoutée (Rust ni npm).
- Le serveur n'écoute que sur 127.0.0.1 ; tout appel MCP porte `Authorization: Bearer <jeton du nœud>` ; sans jeton valable : 401.
- Textes visibles et messages des outils en français ; identifiants, commits et commentaires de code en anglais.
- Les fichiers de lancement sont réécrits à chaque lancement et effacés à la fin du processus (spec §4.2).
- Fichiers commités en CRLF : les scripts d'édition normalisent les fins de ligne.
- Vérification réelle uniquement sur le profil `dev.dummyplane.probe`, jamais sur l'app installée ni sur les copies de builds.

## Review Focus

1. Un appel d'outil qui attend l'interface ne bloque jamais les hooks (le serveur traite `/mcp` sur son propre fil).
2. Un jeton révoqué (processus fini) ou d'un autre lancement ne donne plus accès (401).
3. La consigne de rôle et la config MCP survivent aux chemins avec espaces et apostrophes (citation selon le shell, comme `--settings`).
4. Une étape marquée avant toute déclaration, un titre inconnu, une liste vide ou trop longue : réponse d'erreur lisible, payload intact.
5. La frise suit le terminal quand il bouge ou que la vue zoome, et disparaît quand il est supprimé.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src-tauri/src/agents/mcp.rs` (créé) | JSON-RPC du serveur MCP (pur), jetons des nœuds, appels en attente de l'interface. |
| `src-tauri/src/agents/hooks_server.rs` | Le `HookSink` (ce que le serveur rapporte et demande), la route `/mcp`, les hooks des sous-agents. |
| `src-tauri/src/agents/subagents.rs` (créé) | Compte des sous-agents en cours par nœud. |
| `src-tauri/src/agents/mcp_files.rs` (créé) | Config MCP et consigne de rôle d'une session (fichiers). |
| `src-tauri/src/agents/prompts.rs` (créé) | La consigne de rôle d'un agent. |
| `src-tauri/src/agents/claude_settings.rs` | Hooks des sous-agents, autorisation `mcp__dummyplane`. |
| `src-tauri/src/pty/shell.rs` | `AgentHooks` porte la config MCP et la consigne ; `claude_command` les passe. |
| `src-tauri/src/commands/agents.rs` | État : jetons, appels en attente, sous-agents ; `AppSink` ; `mcp_reply` ; évènement `agent-subagents`. |
| `src-tauri/src/lib.rs` | Enregistre `mcp_reply`. |
| `src/ipc/mcp.ts` (créé) | Évènements `mcp-call`, `agent-subagents`, commande `mcp_reply`. |
| `src/nodes/steps.ts` (créé) | Type `Step`, lecture, déclaration et marquage (purs). |
| `src/nodes/types.ts` | `TerminalPayload.steps`, lu par `readTerminalPayload`. |
| `src/mcp/agentTools.ts` (créé) | Les outils d'agent : définitions et effets. |
| `src/mcp/router.ts` (créé) | Répond à `tools/list` et `tools/call`. |
| `src/store/subagents.ts` (créé) | Compte des sous-agents par nœud (interface). |
| `src/app/boot.ts` | Écoute `agent-subagents` et `mcp-call`. |
| `src/canvas/canvasStore.ts`, `src/canvas/sceneSync.ts`, `src/canvas/Canvas.tsx` | `nodeRects` : le cadre de scène de chaque nœud. |
| `src/canvas/overlay/timeline.ts` (créé) | Disposition de la frise (pure). |
| `src/canvas/overlay/StepTimelines.tsx` (créé) | Le calque des frises. |

---

### Task 1: Le transport MCP

**Files:**
- Create: `src-tauri/src/agents/mcp.rs`
- Modify: `src-tauri/src/agents/mod.rs`, `src-tauri/src/agents/hooks_server.rs`, `src-tauri/src/commands/agents.rs` (adaptation à `HookSink`)

**Interfaces:**
- Produces: `mcp::action(&Value) -> Action` (`Reply(Value)`, `Accept`, `Forward { id, method, params }`), `mcp::reply`, `mcp::failure`, `mcp::bearer`, `mcp::MAX_BODY` ; `mcp::Tokens { issue(node) -> String, node(token) -> Option<String>, revoke(node) }` ; `mcp::Pending { open() -> (u64, Receiver<Value>), answer(id, Value) -> bool, close(id) }` ; `hooks_server::HookSink` (`hit`, `subagent`, `mcp_node`, `mcp_call`) ; `hooks_server::start(sink: impl HookSink)` ; `HookServer::mcp_url()`.

- [ ] **Step 1: Write the failing tests** — `mcp.rs` (module de tests ci-dessous, avec le code de l'étape 3) et, dans `hooks_server.rs`, un `TestSink` remplace les fermetures des tests existants, plus deux tests de la route `/mcp`.

`src-tauri/src/agents/mcp.rs` (tests) :

```rust
#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;

    #[test]
    fn answers_initialize_with_the_client_s_version_and_the_tools_capability() {
        let message = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}});
        let Action::Reply(answer) = action(&message) else { panic!("not a reply") };
        assert_eq!(answer["id"], 1);
        assert_eq!(answer["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(answer["result"]["capabilities"], json!({ "tools": {} }));
        assert_eq!(answer["result"]["serverInfo"]["name"], "dummyplane");
    }

    #[test]
    fn accepts_notifications_and_forwards_tools_to_the_interface() {
        assert_eq!(action(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})), Action::Accept);
        assert_eq!(
            action(&json!({"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"etape"}})),
            Action::Forward { id: json!("a"), method: "tools/call".into(), params: json!({"name":"etape"}) }
        );
        assert_eq!(
            action(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})),
            Action::Forward { id: json!(2), method: "tools/list".into(), params: json!({}) }
        );
        let Action::Reply(pong) = action(&json!({"jsonrpc":"2.0","id":3,"method":"ping"})) else { panic!() };
        assert_eq!(pong["result"], json!({}));
    }

    #[test]
    fn refuses_unknown_methods_in_json_rpc_terms() {
        let Action::Reply(answer) = action(&json!({"jsonrpc":"2.0","id":4,"method":"resources/list"})) else { panic!() };
        assert_eq!(answer["error"]["code"], -32601);
        assert_eq!(answer["id"], 4);
    }

    #[test]
    fn reads_a_bearer_token() {
        assert_eq!(bearer(Some("Bearer abc")), Some("abc"));
        assert_eq!(bearer(Some("Basic abc")), None);
        assert_eq!(bearer(Some("Bearer ")), None);
        assert_eq!(bearer(None), None);
    }

    #[test]
    fn gives_each_launch_its_own_token_and_forgets_it_with_the_process() {
        let tokens = Tokens::default();
        let first = tokens.issue("n1");
        assert_eq!(tokens.node(&first).as_deref(), Some("n1"));
        let second = tokens.issue("n1");
        assert_ne!(first, second);
        assert_eq!(tokens.node(&first), None, "a relaunch revokes the old token");
        tokens.revoke("n1");
        assert_eq!(tokens.node(&second), None);
    }

    #[test]
    fn delivers_an_answer_to_the_call_that_waits_for_it() {
        let pending = Pending::default();
        let (id, rx) = pending.open();
        assert!(pending.answer(id, json!({"ok": true})));
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), json!({"ok": true}));
        pending.close(id);
        assert!(!pending.answer(id, json!(null)), "a closed call takes no answer");
        let (other, _rx) = pending.open();
        assert_ne!(other, id);
    }
}
```

Dans `src-tauri/src/agents/hooks_server.rs`, module de tests : remplacer les deux `start(move |hit| { let _ = tx.send(hit); })` par `start(TestSink::new(tx))`, ajouter au module :

```rust
    struct TestSink {
        hits: Mutex<mpsc::Sender<HookHit>>,
        subagents: Mutex<Vec<(String, bool)>>,
    }

    impl TestSink {
        fn new(hits: mpsc::Sender<HookHit>) -> Self {
            Self { hits: Mutex::new(hits), subagents: Mutex::new(Vec::new()) }
        }
    }

    impl HookSink for std::sync::Arc<TestSink> {
        fn hit(&self, hit: HookHit) {
            let _ = self.hits.lock().unwrap().send(hit);
        }
        fn subagent(&self, node_id: &str, started: bool) {
            self.subagents.lock().unwrap().push((node_id.to_string(), started));
        }
        fn mcp_node(&self, token: &str) -> Option<String> {
            token.strip_prefix("tok-").map(str::to_string)
        }
        fn mcp_call(&self, node_id: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
            if node_id == "slow" {
                return Err("dummyPlane ne répond pas".into());
            }
            Ok(serde_json::json!({ "node": node_id, "method": method, "params": params }))
        }
    }

    impl HookSink for TestSink {
        fn hit(&self, hit: HookHit) {
            let _ = self.hits.lock().unwrap().send(hit);
        }
        fn subagent(&self, node_id: &str, started: bool) {
            self.subagents.lock().unwrap().push((node_id.to_string(), started));
        }
        fn mcp_node(&self, token: &str) -> Option<String> {
            token.strip_prefix("tok-").map(str::to_string)
        }
        fn mcp_call(&self, node_id: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
            if node_id == "slow" {
                return Err("dummyPlane ne répond pas".into());
            }
            Ok(serde_json::json!({ "node": node_id, "method": method, "params": params }))
        }
    }

    /// One raw HTTP/1.1 request with extra headers; returns the status and the body.
    fn exchange(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let extra: String = headers.iter().map(|(k, v)| format!("{k}: {v}\r\n")).collect();
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
        let _ = stream.write_all(body);
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        let status = response.split_whitespace().nth(1).unwrap_or("0").parse().unwrap();
        let body = response.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        (status, body)
    }

    #[test]
    fn serves_mcp_to_the_node_a_token_was_given_to() {
        let (tx, _rx) = mpsc::channel();
        let server = start(TestSink::new(tx)).unwrap();
        assert_eq!(server.mcp_url(), format!("http://127.0.0.1:{}/mcp", server.port));
        let auth = [("Authorization", "Bearer tok-n1")];
        let (status, body) = exchange(server.port, "POST", "/mcp", &auth, br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#);
        assert_eq!(status, 200);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["result"]["serverInfo"]["name"], "dummyplane");
        let (status, body) = exchange(server.port, "POST", "/mcp", &auth, br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"etape"}}"#);
        assert_eq!(status, 200);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["result"], serde_json::json!({ "node": "n1", "method": "tools/call", "params": { "name": "etape" } }));
        let (status, _) = exchange(server.port, "POST", "/mcp", &auth, br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert_eq!(status, 202);
        let slow = [("Authorization", "Bearer tok-slow")];
        let (_, body) = exchange(server.port, "POST", "/mcp", &slow, br#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"]["message"], "dummyPlane ne répond pas");
    }

    #[test]
    fn refuses_mcp_without_a_known_token_and_counts_subagents() {
        let (tx, _rx) = mpsc::channel();
        let sink = std::sync::Arc::new(TestSink::new(tx));
        let server = start(std::sync::Arc::clone(&sink)).unwrap();
        assert_eq!(exchange(server.port, "POST", "/mcp", &[], b"{}").0, 401);
        assert_eq!(exchange(server.port, "POST", "/mcp", &[("Authorization", "Bearer nope")], b"{}").0, 401);
        assert_eq!(exchange(server.port, "GET", "/mcp", &[("Authorization", "Bearer tok-n1")], b"").0, 405);
        assert_eq!(exchange(server.port, "POST", "/mcp", &[("Authorization", "Bearer tok-n1")], b"not json").0, 400);
        let path = format!("/hook/claude/n1?t={}", server.token);
        assert_eq!(send(server.port, "POST", &path, br#"{"hook_event_name":"SubagentStart","agent_type":"Explore"}"#), 204);
        assert_eq!(send(server.port, "POST", &path, br#"{"hook_event_name":"SubagentStop","agent_type":"Explore"}"#), 204);
        assert_eq!(*sink.subagents.lock().unwrap(), vec![("n1".to_string(), true), ("n1".to_string(), false)]);
    }
```

(`use std::sync::Mutex;` s'ajoute aux imports du module de tests.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test --lib agents::`
Expected: FAIL à la compilation — `mcp` introuvable, `HookSink` inconnu, `mcp_url` absent.

- [ ] **Step 3: Write the transport**

`src-tauri/src/agents/mcp.rs` (au-dessus du module de tests) :

```rust
//! dummyPlane's MCP server (spec orchestrateur §4.1): JSON-RPC over one HTTP
//! POST, answered at once. Rust holds the transport and the caller's identity;
//! `tools/list` and `tools/call` are answered by the interface.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;

use serde_json::{Value, json};

/// Larger bodies are refused.
pub const MAX_BODY: usize = 256 * 1024;
/// The version answered when the client names none.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// What the server does with one JSON-RPC message.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Answered here.
    Reply(Value),
    /// A notification, or a response to nothing we asked: 202, no body.
    Accept,
    /// Answered by the interface, for the calling node.
    Forward { id: Value, method: String, params: Value },
}

pub fn action(message: &Value) -> Action {
    let Some(id) = message.get("id").cloned() else {
        return Action::Accept;
    };
    let Some(method) = message["method"].as_str() else {
        return Action::Accept;
    };
    match method {
        "initialize" => {
            let version = message["params"]["protocolVersion"]
                .as_str()
                .unwrap_or(PROTOCOL_VERSION);
            Action::Reply(reply(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "dummyplane", "version": env!("CARGO_PKG_VERSION") },
                }),
            ))
        }
        "ping" => Action::Reply(reply(&id, json!({}))),
        "tools/list" | "tools/call" => Action::Forward {
            id,
            method: method.to_string(),
            params: message.get("params").cloned().unwrap_or_else(|| json!({})),
        },
        other => Action::Reply(failure(&id, -32601, &format!("méthode inconnue : {other}"))),
    }
}

pub fn reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn failure(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// The token of an `Authorization: Bearer <token>` header.
pub fn bearer(header: Option<&str>) -> Option<&str> {
    header?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

/// One token per Claude launch, naming its node; a relaunch revokes the old one.
#[derive(Default)]
pub struct Tokens(Mutex<HashMap<String, String>>);

impl Tokens {
    pub fn issue(&self, node_id: &str) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        let mut tokens = self.0.lock().unwrap();
        tokens.retain(|_, node| node != node_id);
        tokens.insert(token.clone(), node_id.to_string());
        token
    }

    pub fn node(&self, token: &str) -> Option<String> {
        self.0.lock().unwrap().get(token).cloned()
    }

    pub fn revoke(&self, node_id: &str) {
        self.0.lock().unwrap().retain(|_, node| node != node_id);
    }
}

/// The calls waiting for the interface's answer.
#[derive(Default)]
pub struct Pending {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
}

impl Pending {
    pub fn open(&self) -> (u64, mpsc::Receiver<Value>) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.waiting.lock().unwrap().insert(id, tx);
        (id, rx)
    }

    /// False when nothing waits any more (answered too late).
    pub fn answer(&self, id: u64, value: Value) -> bool {
        match self.waiting.lock().unwrap().remove(&id) {
            Some(tx) => tx.send(value).is_ok(),
            None => false,
        }
    }

    pub fn close(&self, id: u64) {
        self.waiting.lock().unwrap().remove(&id);
    }
}
```

`src-tauri/src/agents/mod.rs` : `pub mod mcp;` après `pub mod hooks_server;`.

`src-tauri/src/agents/hooks_server.rs` :
- imports : `use std::sync::Arc;`, `use serde_json::Value;`, `use tiny_http::Header;`, `use super::mcp;` ;
- avant `pub struct HookServer` :

```rust
/// What the server reports, and the questions it forwards.
pub trait HookSink: Send + Sync + 'static {
    /// A hook event that changes a terminal's activity.
    fn hit(&self, hit: HookHit);
    /// A Claude session started (`true`) or ended (`false`) a subagent.
    fn subagent(&self, node_id: &str, started: bool);
    /// The node an MCP token was given to.
    fn mcp_node(&self, token: &str) -> Option<String>;
    /// `tools/list` or `tools/call` for a node, answered by the interface.
    fn mcp_call(&self, node_id: &str, method: &str, params: Value) -> Result<Value, String>;
}
```

- dans `impl HookServer` :

```rust
    /// The URL of dummyPlane's MCP server (spec orchestrateur §4.1).
    pub fn mcp_url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }
```

- `start` devient :

```rust
/// Starts the server; hooks are answered on its thread, MCP calls each on
/// their own (a tools call waits for the interface, never in the hooks' way).
pub fn start(sink: impl HookSink) -> std::io::Result<HookServer> {
    let server =
        Server::http("127.0.0.1:0").map_err(|err| std::io::Error::other(err.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| std::io::Error::other("no TCP port for the hook server"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let expected = token.clone();
    let sink = Arc::new(sink);
    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            if request.url().split('?').next() == Some("/mcp") {
                let sink = Arc::clone(&sink);
                std::thread::spawn(move || answer_mcp(request, &*sink));
                continue;
            }
            let status = status_of(&mut request, &expected, &*sink);
            let _ = request.respond(Response::empty(status));
        }
    });
    Ok(HookServer { port, token })
}
```

- `status_of(request, token, sink: &dyn HookSink)` : au début de la branche Claude, avant `claude_session_ended` :

```rust
            if matches!(event, "SubagentStart" | "SubagentStop") {
                sink.subagent(&node_id, event == "SubagentStart");
                return 204;
            }
```

et `on_hit(HookHit { … })` devient `sink.hit(HookHit { … })`.

- à la fin du fichier (avant les tests) :

```rust
fn answer_mcp(mut request: Request, sink: &dyn HookSink) {
    let (status, body) = mcp_response(&mut request, sink);
    let mut response = Response::from_data(body.map(|json| json.to_string().into_bytes()).unwrap_or_default())
        .with_status_code(status);
    if status == 200 {
        response = response.with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
    }
    let _ = request.respond(response);
}

/// The token names the calling node (401 first, like the hooks' 403).
fn mcp_response(request: &mut Request, sink: &dyn HookSink) -> (u16, Option<Value>) {
    let header = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .map(|header| header.value.as_str().to_string());
    let Some(node_id) = mcp::bearer(header.as_deref()).and_then(|token| sink.mcp_node(token)) else {
        return (401, None);
    };
    if *request.method() != Method::Post {
        return (405, None);
    }
    let mut body = Vec::new();
    if request.as_reader().take(mcp::MAX_BODY as u64 + 1).read_to_end(&mut body).is_err() {
        return (400, None);
    }
    if body.len() > mcp::MAX_BODY {
        return (413, None);
    }
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        return (400, None);
    };
    match mcp::action(&message) {
        mcp::Action::Accept => (202, None),
        mcp::Action::Reply(json) => (200, Some(json)),
        mcp::Action::Forward { id, method, params } => match sink.mcp_call(&node_id, &method, params) {
            Ok(result) => (200, Some(mcp::reply(&id, result))),
            Err(message) => (200, Some(mcp::failure(&id, -32603, &message))),
        },
    }
}
```

`src-tauri/src/commands/agents.rs` (pour compiler, la vraie version vient à la tâche 2) : `hooks_server::start(move |hit| on_hook(&handle, hit))` devient `hooks_server::start(AppSink(app.clone()))` avec :

```rust
/// The app behind the hook server.
struct AppSink(AppHandle);

impl HookSink for AppSink {
    fn hit(&self, hit: HookHit) {
        on_hook(&self.0, hit);
    }
    fn subagent(&self, _node_id: &str, _started: bool) {}
    fn mcp_node(&self, _token: &str) -> Option<String> {
        None
    }
    fn mcp_call(&self, _node_id: &str, _method: &str, _params: serde_json::Value) -> Result<serde_json::Value, String> {
        Err("dummyPlane ne répond pas".into())
    }
}
```

(import `HookSink` avec `HookHit, HookServer` ; `let handle = app.clone();` disparaît.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib agents:: && cargo clippy --quiet`
Expected: PASS ; pas d'avertissement.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump src-tauri/*.stackdump
git add src-tauri/src/agents/mcp.rs src-tauri/src/agents/mod.rs src-tauri/src/agents/hooks_server.rs src-tauri/src/commands/agents.rs
git commit -m "feat(mcp): dummyPlane's MCP transport on the hooks' server, one token per node

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 2: Les sessions Claude reçoivent leurs outils

**Files:**
- Create: `src-tauri/src/agents/subagents.rs`, `src-tauri/src/agents/mcp_files.rs`, `src-tauri/src/agents/prompts.rs`
- Modify: `src-tauri/src/agents/mod.rs`, `src-tauri/src/agents/claude_settings.rs`, `src-tauri/src/pty/shell.rs`, `src-tauri/src/commands/agents.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `mcp::Tokens`, `mcp::Pending`, `HookSink`, `HookServer::mcp_url` (tâche 1).
- Produces: évènement `mcp-call` `{ callId: number, nodeId, method, params }` ; commande `mcp_reply(callId: u64, result: Value)` ; évènement `agent-subagents` `{ nodeId, running }` ; `AgentHooks { claude_settings, codex_notify, mcp_config, system_prompt }`.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/agents/subagents.rs` (tests) :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_the_subagents_a_session_runs_never_below_zero() {
        let mut counts = SubagentCounts::default();
        assert_eq!(counts.change("n1", true), 1);
        assert_eq!(counts.change("n1", true), 2);
        assert_eq!(counts.change("n1", false), 1);
        assert_eq!(counts.change("n1", false), 0);
        assert_eq!(counts.change("n1", false), 0);
        assert_eq!(counts.change("n2", true), 1);
        assert!(counts.clear("n2"));
        assert!(!counts.clear("n2"));
    }
}
```

`src-tauri/src/agents/mcp_files.rs` (tests) :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_claude_at_dummyplane_with_the_node_s_token() {
        assert_eq!(
            config_json("http://127.0.0.1:4242/mcp", "tok"),
            serde_json::json!({ "mcpServers": { "dummyplane": {
                "type": "http",
                "url": "http://127.0.0.1:4242/mcp",
                "headers": { "Authorization": "Bearer tok" }
            } } })
        );
    }

    #[test]
    fn writes_removes_and_clears_a_session_s_files() {
        let dir = tempfile::tempdir().unwrap();
        let mcp = dir.path().join("mcp");
        let files = write(&mcp, "n1", "http://127.0.0.1:1/mcp", "tok", "Tu travailles dans dummyPlane.").unwrap();
        assert_eq!(files.config, mcp.join("n1.json"));
        assert_eq!(files.prompt, mcp.join("n1.md"));
        assert_eq!(std::fs::read_to_string(&files.prompt).unwrap(), "Tu travailles dans dummyPlane.");
        assert!(write(&mcp, "../evil", "u", "t", "p").is_err());
        remove(&mcp, "n1");
        assert!(!files.config.exists() && !files.prompt.exists());
        write(&mcp, "a", "u", "t", "p").unwrap();
        std::fs::write(mcp.join("keep.txt"), "x").unwrap();
        clear(&mcp);
        let left: Vec<_> = std::fs::read_dir(&mcp).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("keep.txt")]);
    }
}
```

`src-tauri/src/agents/claude_settings.rs` : le test `reports_the_tracked_events_to_the_url_without_blocking_hooks` attend désormais les événements `["Notification", "PostToolUse", "SessionEnd", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "UserPromptSubmit"]`, et un test s'ajoute :

```rust
    #[test]
    fn allows_dummyplane_s_tools_without_asking() {
        assert_eq!(
            settings_json(URL)["permissions"],
            serde_json::json!({ "allow": ["mcp__dummyplane"] })
        );
    }
```

`src-tauri/src/pty/shell.rs` (tests) : ajouter à côté de `hooked` :

```rust
    #[test]
    fn gives_claude_dummyplane_s_tools_and_its_role() {
        let hooks = AgentHooks {
            claude_settings: Some(PathBuf::from(r"C:\data\hooks\n1.json")),
            mcp_config: Some(PathBuf::from(r"C:\data\mcp\n1.json")),
            system_prompt: Some(PathBuf::from(r"C:\data\mcp\n1.md")),
            ..Default::default()
        };
        assert_eq!(
            agent_command(&spec(Agent::Claude, claude(ClaudeMode::Resume, "")), ShellSyntax::PowerShell, &hooks).unwrap(),
            Some(format!(
                r"claude --settings 'C:\data\hooks\n1.json' --mcp-config 'C:\data\mcp\n1.json' --append-system-prompt-file 'C:\data\mcp\n1.md' --resume {SESSION}"
            ))
        );
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test --lib`
Expected: FAIL à la compilation — modules `subagents`, `mcp_files` absents, champs `mcp_config` / `system_prompt` inconnus.

- [ ] **Step 3: Write the launch files and the bridge**

`src-tauri/src/agents/subagents.rs` (au-dessus des tests) :

```rust
//! How many subagents each Claude session runs (spec orchestrateur §5.2), from
//! its `SubagentStart` / `SubagentStop` hooks.

use std::collections::HashMap;

#[derive(Default)]
pub struct SubagentCounts(HashMap<String, u32>);

impl SubagentCounts {
    /// The node's count after a start or a stop; never below zero.
    pub fn change(&mut self, node_id: &str, started: bool) -> u32 {
        let count = self.0.entry(node_id.to_string()).or_default();
        *count = if started { *count + 1 } else { count.saturating_sub(1) };
        *count
    }

    /// The session or its process ended: true when some were still counted.
    pub fn clear(&mut self, node_id: &str) -> bool {
        self.0.remove(node_id).is_some_and(|count| count > 0)
    }
}
```

`src-tauri/src/agents/prompts.rs` :

```rust
//! The role given to each Claude session dummyPlane launches, with
//! `--append-system-prompt-file` (spec orchestrateur §4.4).

pub const AGENT: &str = "Tu travailles dans dummyPlane, un canvas de terminaux d'agents. Le serveur MCP « dummyplane » te donne trois outils :
- declarer_etapes : quand ta tâche demande plusieurs étapes (ou les phases d'un workflow), déclare-les avant de commencer, en titres courts (par exemple Plan, Recherche, Implémentation, Vérification). dummyPlane les montre en frise sous ton terminal.
- etape : marque chaque étape « en_cours » quand tu la commences, « fait » quand elle est finie, « echec » si elle échoue.
- rendre_compte : quand dummyPlane t'a confié une sous-tâche de mission, termine par un résumé et un statut (termine, bloque, echec).
Délègue à tes sous-agents les sous-tâches qui s'y prêtent. Pour une simple question, sans étapes, n'utilise pas ces outils.";
```

`src-tauri/src/agents/mcp_files.rs` (au-dessus des tests) :

```rust
//! The files that give a Claude session dummyPlane's tools (spec orchestrateur
//! §4.2): `--mcp-config <nodeId>.json` and `--append-system-prompt-file <nodeId>.md`.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::hooks_server::valid_node_id;

pub struct McpFiles {
    pub config: PathBuf,
    pub prompt: PathBuf,
}

pub fn config_json(url: &str, token: &str) -> Value {
    json!({ "mcpServers": { "dummyplane": {
        "type": "http",
        "url": url,
        "headers": { "Authorization": format!("Bearer {token}") }
    } } })
}

/// Rewritten at each launch: the port and the token change.
pub fn write(dir: &Path, node_id: &str, url: &str, token: &str, prompt: &str) -> io::Result<McpFiles> {
    if !valid_node_id(node_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("identifiant de nœud invalide : {node_id}"),
        ));
    }
    std::fs::create_dir_all(dir)?;
    let files = McpFiles {
        config: dir.join(format!("{node_id}.json")),
        prompt: dir.join(format!("{node_id}.md")),
    };
    std::fs::write(&files.config, serde_json::to_vec_pretty(&config_json(url, token))?)?;
    std::fs::write(&files.prompt, prompt)?;
    Ok(files)
}

pub fn remove(dir: &Path, node_id: &str) {
    if valid_node_id(node_id) {
        let _ = std::fs::remove_file(dir.join(format!("{node_id}.json")));
        let _ = std::fs::remove_file(dir.join(format!("{node_id}.md")));
    }
}

/// Files left by a previous run carry tokens that are gone.
pub fn clear(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json" || ext == "md") {
            let _ = std::fs::remove_file(path);
        }
    }
}
```

`src-tauri/src/agents/mod.rs` : `pub mod mcp_files;`, `pub mod prompts;`, `pub mod subagents;` (ordre alphabétique avec les autres).

`src-tauri/src/agents/claude_settings.rs` — `settings_json` devient :

```rust
pub fn settings_json(url: &str) -> Value {
    let hook = json!({ "type": "http", "url": url, "timeout": 2 });
    let every = json!([{ "hooks": [hook] }]);
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
        // dummyPlane's own tools never ask (spec orchestrateur §4.2).
        "permissions": { "allow": ["mcp__dummyplane"] },
    })
}
```

`src-tauri/src/pty/shell.rs` :
- `AgentHooks` reçoit :

```rust
    /// Claude: `--mcp-config <file>`, dummyPlane's tools (spec orchestrateur §4.2).
    pub mcp_config: Option<PathBuf>,
    /// Claude: `--append-system-prompt-file <file>`, its role.
    pub system_prompt: Option<PathBuf>,
```

- l'appel devient `Agent::Claude => Some(claude_command(spec.claude.as_ref(), syntax, hooks)?),` ;
- `claude_command(launch, syntax, hooks: &AgentHooks)` ; le début devient :

```rust
    let mut claude = "claude".to_string();
    let flags = [
        ("--settings", &hooks.claude_settings),
        ("--mcp-config", &hooks.mcp_config),
        ("--append-system-prompt-file", &hooks.system_prompt),
    ];
    for (flag, path) in flags {
        if let Some(path) = path {
            claude.push_str(&format!(" {flag} {}", quote(syntax, &path.to_string_lossy())));
        }
    }
```

(la variable `settings: Option<&Path>` et son `match` disparaissent ; le reste de la fonction est inchangé.)

`src-tauri/src/commands/agents.rs` :
- imports : `use std::time::Duration;` (déjà), `use serde_json::Value;`, `use crate::agents::mcp::{Pending, Tokens};`, `use crate::agents::{mcp_files, prompts};`, `use crate::agents::subagents::SubagentCounts;` ;
- constante : `/// An MCP call the interface has not answered by then fails (spec orchestrateur §4.1).\nconst MCP_TIMEOUT: Duration = Duration::from_secs(30);` ;
- `AgentState` reçoit :

```rust
    mcp_dir: PathBuf,
    /// One token per Claude launch, naming its node (spec orchestrateur §4.1).
    mcp_tokens: Tokens,
    mcp_calls: Pending,
    subagents: Mutex<SubagentCounts>,
```

- évènements :

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpCallEvent {
    call_id: u64,
    node_id: String,
    method: String,
    params: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubagentsEvent {
    node_id: String,
    running: u32,
}
```

- `AppSink` réel :

```rust
impl HookSink for AppSink {
    fn hit(&self, hit: HookHit) {
        on_hook(&self.0, hit);
    }

    fn subagent(&self, node_id: &str, started: bool) {
        let Some(state) = self.0.try_state::<AgentState>() else {
            return;
        };
        let running = state.subagents.lock().unwrap().change(node_id, started);
        let _ = self.0.emit("agent-subagents", SubagentsEvent { node_id: node_id.into(), running });
    }

    fn mcp_node(&self, token: &str) -> Option<String> {
        self.0.try_state::<AgentState>()?.mcp_tokens.node(token)
    }

    fn mcp_call(&self, node_id: &str, method: &str, params: Value) -> Result<Value, String> {
        let state = self.0.try_state::<AgentState>().ok_or("dummyPlane ne répond pas")?;
        let (call_id, answer) = state.mcp_calls.open();
        let event = McpCallEvent { call_id, node_id: node_id.into(), method: method.into(), params };
        let _ = self.0.emit("mcp-call", event);
        let result = answer.recv_timeout(MCP_TIMEOUT);
        state.mcp_calls.close(call_id);
        result.map_err(|_| "dummyPlane ne répond pas".to_string())
    }
}

/// A session or its process ended: its subagents went with it.
fn clear_subagents(app: &AppHandle, state: &AgentState, node_id: &str) {
    if state.subagents.lock().unwrap().clear(node_id) {
        let _ = app.emit("agent-subagents", SubagentsEvent { node_id: node_id.into(), running: 0 });
    }
}
```

- `setup` : `let mcp_dir = app.path().app_data_dir()?.join("mcp"); mcp_files::clear(&mcp_dir);` et `AgentState { tracker, hooks, hooks_dir, mcp_dir, mcp_tokens: Tokens::default(), mcp_calls: Pending::default(), subagents: Mutex::new(SubagentCounts::default()) }` ;
- `on_hook` : après `drop(tracker);`, `if hit.session_ended { clear_subagents(app, &state, &hit.node_id); }` ;
- `hooks_for`, branche Claude :

```rust
        Agent::Claude => {
            let settings = claude_settings::write(&state.hooks_dir, node_id, &server.url(HookSource::Claude, node_id));
            let Ok(settings) = settings.inspect_err(|err| eprintln!("hooks of {node_id} not written: {err}")) else {
                return AgentHooks::default();
            };
            let token = state.mcp_tokens.issue(node_id);
            let files = mcp_files::write(&state.mcp_dir, node_id, &server.mcp_url(), &token, prompts::AGENT)
                .inspect_err(|err| eprintln!("tools of {node_id} not written: {err}"))
                .ok();
            AgentHooks {
                claude_settings: Some(settings),
                mcp_config: files.as_ref().map(|f| f.config.clone()),
                system_prompt: files.map(|f| f.prompt),
                ..Default::default()
            }
        }
```

- `ended` : en plus, `state.mcp_tokens.revoke(node_id); mcp_files::remove(&state.mcp_dir, node_id); clear_subagents(app, &state, node_id);` ;
- commande :

```rust
/// The interface's answer to an MCP call (spec orchestrateur §4.1).
#[tauri::command]
pub async fn mcp_reply(state: State<'_, AgentState>, call_id: u64, result: Value) -> AppResult<()> {
    state.mcp_calls.answer(call_id, result);
    Ok(())
}
```

`src-tauri/src/lib.rs` : `commands::agents::mcp_reply,` après `commands::agents::agent_activity_snapshot,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib && cargo clippy --quiet`
Expected: PASS ; pas d'avertissement.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump src-tauri/*.stackdump
git add src-tauri/src
git commit -m "feat(mcp): every Claude session gets dummyPlane's tools, its role and subagent hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 3: L'interface répond aux outils d'agent

**Files:**
- Create: `src/ipc/mcp.ts`, `src/nodes/steps.ts`, `src/nodes/steps.test.ts`, `src/mcp/agentTools.ts`, `src/mcp/router.ts`, `src/mcp/router.test.ts`, `src/store/subagents.ts`
- Modify: `src/nodes/types.ts`, `src/nodes/types.test.ts` (s'il existe ; sinon le test va dans `steps.test.ts`), `src/app/boot.ts`

**Interfaces:**
- Consumes: évènements `mcp-call`, `agent-subagents`, commande `mcp_reply` (tâche 2).
- Produces: `type StepState = "a_venir" | "en_cours" | "fait" | "echec"`, `interface Step { title; state }`, `readSteps(raw): Step[] | undefined`, `declaredSteps(raw): Step[] | string`, `markedSteps(steps, title, state): Step[] | string` ; `TerminalPayload.steps?: Step[]` ; `AGENT_TOOLS` ; `answer(call: McpCall): Promise<unknown>` ; `installMcp(): Promise<void>` ; `subagentsStore`, `useSubagents(nodeId)`.

- [ ] **Step 1: Write the failing tests**

`src/nodes/steps.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { declaredSteps, markedSteps, readSteps } from "./steps";
import { readTerminalPayload } from "./types";

describe("an agent's steps (spec orchestrateur §4.4, §5)", () => {
  it("declares 1 to 12 short titles, all to come", () => {
    expect(declaredSteps([" Plan ", "Recherche"])).toEqual([
      { title: "Plan", state: "a_venir" },
      { title: "Recherche", state: "a_venir" },
    ]);
    expect(declaredSteps(["x".repeat(50)])).toEqual([{ title: "x".repeat(40), state: "a_venir" }]);
    expect(declaredSteps([])).toBe("Donne entre 1 et 12 étapes.");
    expect(declaredSteps(Array.from({ length: 13 }, (_, i) => `É${i}`))).toBe("Donne entre 1 et 12 étapes.");
    expect(declaredSteps(["Plan", 3])).toBe("Chaque étape est un titre court.");
    expect(declaredSteps(["Plan", "  "])).toBe("Chaque étape est un titre court.");
    expect(declaredSteps("Plan")).toBe("Donne entre 1 et 12 étapes.");
  });

  it("marks a step by its title, adding an unknown one at the end", () => {
    const steps = declaredSteps(["Plan", "Code"]) as ReturnType<typeof readSteps> & object;
    expect(markedSteps(steps, "plan", "fait")).toEqual([
      { title: "Plan", state: "fait" },
      { title: "Code", state: "a_venir" },
    ]);
    expect(markedSteps(steps, "Tests", "en_cours")).toEqual([...steps, { title: "Tests", state: "en_cours" }]);
    expect(markedSteps(steps, "Plan", "fini")).toBe("État inconnu : fini (en_cours, fait ou echec).");
    expect(markedSteps([], "Plan", "fait")).toEqual([{ title: "Plan", state: "fait" }]);
    expect(markedSteps(steps, "", "fait")).toBe("Chaque étape est un titre court.");
  });

  it("keeps the steps a terminal saved, drops what it cannot read", () => {
    const base = { title: "", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" };
    expect(readTerminalPayload({ ...base, steps: [{ title: "Plan", state: "fait" }] })?.steps).toEqual([{ title: "Plan", state: "fait" }]);
    expect(readTerminalPayload({ ...base, steps: [{ title: "Plan", state: "?" }] })?.steps).toBeUndefined();
    expect(readTerminalPayload(base)?.steps).toBeUndefined();
  });
});
```

`src/mcp/router.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore, terminalOf } from "@/store/nodes";
import { answer } from "./router";

vi.mock("@excalidraw/excalidraw", () => ({}));

const call = (nodeId: string, name: string, args: Record<string, unknown>) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } });
const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef" } });
});

describe("the agent's tools (spec orchestrateur §4.4)", () => {
  it("lists them for any Claude session", async () => {
    const list = (await answer({ callId: 1, nodeId: "isis", method: "tools/list", params: {} })) as { tools: { name: string; inputSchema: object }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["declarer_etapes", "etape", "rendre_compte"]);
    expect(list.tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
  });

  it("declares and marks the terminal's steps, saved in its payload", async () => {
    expect(textOf(await call("isis", "declarer_etapes", { etapes: ["Plan", "Code"] }))).toBe("2 étapes déclarées.");
    expect(textOf(await call("isis", "etape", { titre: "Plan", etat: "fait" }))).toBe("Plan : fait.");
    expect(terminalOf(nodesStore.getState().nodes.isis)?.steps).toEqual([
      { title: "Plan", state: "fait" },
      { title: "Code", state: "a_venir" },
    ]);
  });

  it("answers mistakes with a readable error, the payload untouched", async () => {
    const before = terminalOf(nodesStore.getState().nodes.isis)?.steps;
    const wrong = (await call("isis", "etape", { titre: "Plan", etat: "fini" })) as { isError?: boolean };
    expect(wrong.isError).toBe(true);
    expect((await call("isis", "declarer_etapes", {})) as { isError?: boolean }).toMatchObject({ isError: true });
    expect(textOf(await call("isis", "voler", {}))).toBe("Outil inconnu : voler");
    expect(textOf(await call("gone", "etape", { titre: "Plan", etat: "fait" }))).toBe("Ce terminal n'est plus sur le canvas.");
    expect(textOf(await call("chef", "etape", { titre: "Plan", etat: "fait" }))).toBe("Ce terminal n'est plus sur le canvas.");
    expect(terminalOf(nodesStore.getState().nodes.isis)?.steps).toEqual(before);
  });

  it("says there is no mission to report to, outside one", async () => {
    expect(textOf(await call("isis", "rendre_compte", { resume: "Fait", statut: "termine" }))).toBe("Pas de mission en cours : rien à transmettre.");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/nodes/steps.test.ts src/mcp/router.test.ts`
Expected: FAIL — `./steps` et `./router` introuvables.

- [ ] **Step 3: Write the steps and the router**

`src/nodes/steps.ts` :

```ts
/** A step an agent declared (spec orchestrateur §4.4, §5): its frieze shows them in order. */
export type StepState = "a_venir" | "en_cours" | "fait" | "echec";

export interface Step {
  title: string;
  state: StepState;
}

export const MAX_STEPS = 12;
export const MAX_STEP_TITLE = 40;
const STATES: readonly string[] = ["a_venir", "en_cours", "fait", "echec"];
const MARKS: readonly string[] = ["en_cours", "fait", "echec"];

const titleOf = (raw: unknown) => (typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_STEP_TITLE) : null);

/** Steps saved in a terminal's payload; undefined when absent or unreadable. */
export function readSteps(raw: unknown): Step[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STEPS) return undefined;
  const steps = raw.map((s) => (typeof s === "object" && s !== null ? (s as Record<string, unknown>) : {}));
  if (!steps.every((s) => titleOf(s.title) && typeof s.state === "string" && STATES.includes(s.state))) return undefined;
  return steps.map((s) => ({ title: titleOf(s.title)!, state: s.state as StepState }));
}

/** `declarer_etapes`: the steps, all to come; or what is wrong. */
export function declaredSteps(raw: unknown): Step[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STEPS) return `Donne entre 1 et ${MAX_STEPS} étapes.`;
  const titles = raw.map(titleOf);
  if (titles.some((t) => t === null)) return "Chaque étape est un titre court.";
  return titles.map((title) => ({ title: title!, state: "a_venir" }));
}

/** `etape`: the step of that title (case aside) takes the state; an unknown one is added at the end. */
export function markedSteps(steps: readonly Step[], rawTitle: unknown, state: unknown): Step[] | string {
  const title = titleOf(rawTitle);
  if (!title) return "Chaque étape est un titre court.";
  if (typeof state !== "string" || !MARKS.includes(state)) return `État inconnu : ${String(state)} (en_cours, fait ou echec).`;
  const at = steps.findIndex((s) => s.title.toLowerCase() === title.toLowerCase());
  if (at === -1) return steps.length >= MAX_STEPS ? `Pas plus de ${MAX_STEPS} étapes.` : [...steps, { title, state: state as StepState }];
  return steps.map((s, i) => (i === at ? { ...s, state: state as StepState } : s));
}
```

`src/nodes/types.ts` : `import { readSteps, type Step } from "./steps";` ; `TerminalPayload` reçoit `/** The steps its agent declared (spec orchestrateur §5). */\n  steps?: Step[];` ; dans `readTerminalPayload`, avant `return payload;` : `const steps = readSteps(r.steps);\n  if (steps) payload.steps = steps;`.

`src/ipc/mcp.ts` :

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./invoke";

/** A question of dummyPlane's MCP server, for the interface to answer (spec orchestrateur §4.1). */
export interface McpCall {
  callId: number;
  nodeId: string;
  method: "tools/list" | "tools/call";
  params: Record<string, unknown>;
}

export function onMcpCall(handler: (call: McpCall) => void): Promise<UnlistenFn> {
  return listen<McpCall>("mcp-call", (event) => handler(event.payload));
}

export const mcpReply = (callId: number, result: unknown) => call<void>("mcp_reply", { callId, result });

/** How many subagents a Claude session runs (spec orchestrateur §5.2). */
export interface SubagentsEvent {
  nodeId: string;
  running: number;
}

export function onAgentSubagents(handler: (event: SubagentsEvent) => void): Promise<UnlistenFn> {
  return listen<SubagentsEvent>("agent-subagents", (event) => handler(event.payload));
}
```

`src/store/subagents.ts` :

```ts
import { createStore, useStore } from "zustand";

/** Subagents each Claude session runs, from its hooks (spec orchestrateur §5.2). */
export const subagentsStore = createStore<{ running: Record<string, number>; set: (nodeId: string, running: number) => void }>()((set) => ({
  running: {},
  set: (nodeId, running) => set((s) => ({ running: { ...s.running, [nodeId]: running } })),
}));

export function useSubagents(nodeId: string): number {
  return useStore(subagentsStore, (s) => s.running[nodeId] ?? 0);
}
```

`src/mcp/agentTools.ts` :

```ts
import { declaredSteps, markedSteps, MAX_STEPS } from "@/nodes/steps";
import { nodesStore, terminalOf } from "@/store/nodes";

/** What a tool answers: MCP text content, an error the agent can read. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const said = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const refused = (text: string): ToolResult => ({ ...said(text), isError: true });

/** The tools of any Claude session (spec orchestrateur §4.4). */
export const AGENT_TOOLS = [
  {
    name: "declarer_etapes",
    description: "Déclare les étapes de ta tâche, dans l'ordre (titres courts). dummyPlane les montre en frise sous ton terminal. Remplace les étapes déjà déclarées.",
    inputSchema: {
      type: "object",
      properties: { etapes: { type: "array", items: { type: "string", maxLength: 40 }, minItems: 1, maxItems: MAX_STEPS } },
      required: ["etapes"],
    },
  },
  {
    name: "etape",
    description: "Marque une étape : en_cours quand tu la commences, fait quand elle est finie, echec si elle échoue. Une étape inconnue s'ajoute à la fin.",
    inputSchema: {
      type: "object",
      properties: { titre: { type: "string" }, etat: { type: "string", enum: ["en_cours", "fait", "echec"] } },
      required: ["titre", "etat"],
    },
  },
  {
    name: "rendre_compte",
    description: "Rends compte de ta sous-tâche de mission à l'orchestrateur : un résumé et un statut.",
    inputSchema: {
      type: "object",
      properties: { resume: { type: "string" }, statut: { type: "string", enum: ["termine", "bloque", "echec"] } },
      required: ["resume", "statut"],
    },
  },
] as const;

export function declareSteps(nodeId: string, args: Record<string, unknown>): ToolResult {
  const steps = declaredSteps(args.etapes);
  if (typeof steps === "string") return refused(steps);
  nodesStore.getState().update(nodeId, { steps });
  return said(`${steps.length} étape${steps.length > 1 ? "s" : ""} déclarée${steps.length > 1 ? "s" : ""}.`);
}

export function markStep(nodeId: string, args: Record<string, unknown>): ToolResult {
  const current = terminalOf(nodesStore.getState().nodes[nodeId])?.steps ?? [];
  const steps = markedSteps(current, args.titre, args.etat);
  if (typeof steps === "string") return refused(steps);
  nodesStore.getState().update(nodeId, { steps });
  const step = steps.find((s) => s.title.toLowerCase() === String(args.titre).trim().toLowerCase())!;
  return said(`${step.title} : ${step.state.replace("_", " ")}.`);
}

/** Outside a mission (milestone H2 adds them), a report has no one to go to. */
export function report(): ToolResult {
  return said("Pas de mission en cours : rien à transmettre.");
}
```

`src/mcp/router.ts` :

```ts
import { mcpReply, onMcpCall, type McpCall } from "@/ipc/mcp";
import { nodesStore, terminalOf } from "@/store/nodes";
import { AGENT_TOOLS, declareSteps, markStep, refused, report } from "./agentTools";

/** The interface's answer to one MCP call of a node (spec orchestrateur §4.1, §4.3). */
export async function answer(call: McpCall): Promise<unknown> {
  if (call.method === "tools/list") return { tools: AGENT_TOOLS };
  const name = String(call.params.name ?? "");
  const args = (call.params.arguments ?? {}) as Record<string, unknown>;
  if (!terminalOf(nodesStore.getState().nodes[call.nodeId])) return refused("Ce terminal n'est plus sur le canvas.");
  switch (name) {
    case "declarer_etapes":
      return declareSteps(call.nodeId, args);
    case "etape":
      return markStep(call.nodeId, args);
    case "rendre_compte":
      return report();
    default:
      return refused(`Outil inconnu : ${name}`);
  }
}

/** For the app's whole life: every call gets an answer, a failure included. */
export async function installMcp() {
  await onMcpCall(async (call) => {
    let result: unknown;
    try {
      result = await answer(call);
    } catch (error) {
      result = refused(`dummyPlane n'a pas pu répondre : ${String(error)}`);
    }
    await mcpReply(call.callId, result);
  });
}
```

Note : le test « unknown tool » appelle `voler` sur `isis` qui existe : l'ordre (terminal d'abord, puis outil) donne bien « Outil inconnu : voler ».

`src/app/boot.ts` : imports `import { onAgentSubagents } from "@/ipc/mcp";`, `import { installMcp } from "@/mcp/router";`, `import { subagentsStore } from "@/store/subagents";` ; après la ligne `if (!activity.hooksAvailable) …` :

```ts
    await onAgentSubagents(({ nodeId, running }) => subagentsStore.getState().set(nodeId, running));
    await installMcp();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/nodes/steps.test.ts src/mcp/router.test.ts`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/ipc/mcp.ts src/nodes/steps.ts src/nodes/steps.test.ts src/nodes/types.ts src/mcp src/store/subagents.ts src/app/boot.ts
git commit -m "feat(mcp): the interface answers the agents' tools and keeps their steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 4: La frise sous chaque terminal

**Files:**
- Create: `src/canvas/overlay/timeline.ts`, `src/canvas/overlay/timeline.test.ts`, `src/canvas/overlay/StepTimelines.tsx`, `src/canvas/overlay/StepTimelines.test.tsx`
- Modify: `src/canvas/canvasStore.ts`, `src/canvas/sceneSync.ts`, `src/canvas/sceneSync.test.ts`, `src/canvas/Canvas.tsx`

**Interfaces:**
- Consumes: `TerminalPayload.steps`, `useSubagents` (tâche 3) ; `screenRectOf` ; `Rect`.
- Produces: `canvasStore.nodeRects: Record<string, Rect>`, `setNodeRects` ; `liveNodeRects(elements): Record<string, Rect>` ; `dotsOf(steps, width): Dot[]` ; `STEP_COLOR` ; `<StepTimelines />`.

- [ ] **Step 1: Write the failing tests**

`src/canvas/overlay/timeline.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { dotsOf, STEP_COLOR } from "./timeline";

describe("the steps' frieze (spec orchestrateur §5.1)", () => {
  it("spreads the steps evenly along the terminal's width, half a slot from each end", () => {
    const dots = dotsOf(
      [
        { title: "Plan", state: "fait" },
        { title: "Code", state: "en_cours" },
        { title: "Tests", state: "a_venir" },
        { title: "Revue", state: "echec" },
      ],
      400,
    );
    expect(dots.map((d) => d.x)).toEqual([50, 150, 250, 350]);
    expect(dots.map((d) => d.slot)).toEqual([100, 100, 100, 100]);
    expect(dots.map((d) => d.color)).toEqual([STEP_COLOR.fait, STEP_COLOR.en_cours, STEP_COLOR.a_venir, STEP_COLOR.echec]);
  });

  it("colors by state: done, running, to come, failed", () => {
    expect(STEP_COLOR).toEqual({ fait: "var(--ov-ok)", en_cours: "var(--ov-working)", a_venir: "var(--ov-text-3)", echec: "var(--ov-danger)" });
  });
});
```

`src/canvas/sceneSync.test.ts` — ajouter (importer `liveNodeRects` avec `liveNodeIds`) :

```ts
it("gives the scene rectangle of each live node, the frieze's anchor", () => {
  const node = (id: string, isDeleted = false) =>
    ({ id, type: "embeddable", x: 10, y: 20, width: 720, height: 440, isDeleted, customData: { dummyplane: { kind: "terminal" } } }) as never;
  expect(liveNodeRects([node("isis"), node("gone", true)])).toEqual({ isis: { x: 10, y: 20, width: 720, height: 440 } });
});
```

(Si `nodeKindOf` lit un autre emplacement que `customData.dummyplane.kind`, reprendre la forme des autres tests de ce fichier.)

`src/canvas/overlay/StepTimelines.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { nodesStore } from "@/store/nodes";
import { subagentsStore } from "@/store/subagents";
import { StepTimelines } from "./StepTimelines";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("draws each terminal's steps under it, following the view, with its running subagents", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "", steps: [{ title: "Plan", state: "fait" }, { title: "Code", state: "en_cours" }] },
  });
  await nodesStore.getState().create("thot", { workspaceId: "w1", kind: "terminal", payload: { title: "", name: "Thot", agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  canvasStore.setState({
    view: { ...EMPTY_VIEW, zoom: 0.5, scrollX: 100, scrollY: 0 },
    nodeRects: { isis: { x: 0, y: 0, width: 800, height: 400 }, thot: { x: 900, y: 0, width: 800, height: 400 } },
  });
  subagentsStore.getState().set("isis", 3);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StepTimelines />));
  const friezes = host.querySelectorAll<HTMLElement>("[data-steps]");
  expect([...friezes].map((f) => f.dataset.steps)).toEqual(["isis"]);
  // (0 + 100) * 0.5 = 50; 400 * 0.5 = 200 below the top; 800 * 0.5 = 400 wide.
  expect([friezes[0].style.left, friezes[0].style.top, friezes[0].style.width]).toEqual(["50px", "208px", "400px"]);
  expect(friezes[0].textContent).toContain("Plan");
  expect(friezes[0].textContent).toContain("×3");
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/canvas/overlay src/canvas/sceneSync.test.ts`
Expected: FAIL — `./timeline`, `./StepTimelines`, `liveNodeRects` introuvables.

- [ ] **Step 3: Write the frieze**

`src/canvas/sceneSync.ts` — après `liveNodeIds` (importer `type Rect` depuis `./groups`) :

```ts
/** The scene rectangle of each live node: where the overlays anchor (spec orchestrateur §5.1). */
export function liveNodeRects(elements: readonly ExcalidrawElement[]): Record<string, Rect> {
  return Object.fromEntries(
    elements.filter((e) => !e.isDeleted && nodeKindOf(e) !== null).map((e) => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]),
  );
}
```

`src/canvas/canvasStore.ts` — `CanvasState` reçoit `nodeRects: Record<string, Rect>;` et `setNodeRects: (rects: Record<string, Rect>) => void;` (importer `type Rect` depuis `./groups`) ; dans le magasin :

```ts
  nodeRects: {},
  setNodeRects: (rects) => {
    const current = get().nodeRects;
    const ids = Object.keys(rects);
    const same =
      ids.length === Object.keys(current).length &&
      ids.every((id) => {
        const a = rects[id];
        const b = current[id];
        return b !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      });
    if (!same) set({ nodeRects: rects });
  },
```

`src/canvas/Canvas.tsx` — dans `onChange`, après `setNodeIds(liveNodeIds(elements))` : `canvasStore.getState().setNodeRects(liveNodeRects(elements));` ; à côté des remises à zéro (`setFrames([])`, `setNodeIds([])`) : `canvasStore.getState().setNodeRects({});` ; monter `<StepTimelines />` après `<GroupLabels />` (import depuis `./overlay/StepTimelines`).

`src/canvas/overlay/timeline.ts` :

```ts
import type { Step, StepState } from "@/nodes/steps";

/** Between the terminal's bottom edge and its frieze. */
export const TIMELINE_GAP = 8;

/** Done, running, to come, failed (spec orchestrateur §5.1; tokens of spec identité). */
export const STEP_COLOR: Record<StepState, string> = {
  fait: "var(--ov-ok)",
  en_cours: "var(--ov-working)",
  a_venir: "var(--ov-text-3)",
  echec: "var(--ov-danger)",
};

export interface Dot {
  x: number;
  /** The width a title may take under its dot. */
  slot: number;
  title: string;
  state: StepState;
  color: string;
}

/** One dot per step, evenly spread, half a slot from each end. */
export function dotsOf(steps: readonly Step[], width: number): Dot[] {
  const slot = width / steps.length;
  return steps.map((step, i) => ({ x: slot * (i + 0.5), slot, title: step.title, state: step.state, color: STEP_COLOR[step.state] }));
}
```

`src/canvas/overlay/StepTimelines.tsx` :

```tsx
import { screenRectOf } from "@/fleet/placement";
import type { Step } from "@/nodes/steps";
import { terminalOf, useNodes } from "@/store/nodes";
import { useSubagents } from "@/store/subagents";
import { useCanvas, type CanvasView } from "../canvasStore";
import type { Rect } from "../groups";
import { dotsOf, TIMELINE_GAP } from "./timeline";

/**
 * Each Claude terminal's steps, under it (spec orchestrateur §5): a calque
 * like the group labels, over the canvas, letting the pointer through except
 * on the titles (their full text on hover).
 */
export function StepTimelines() {
  const rects = useCanvas((s) => s.nodeRects);
  const view = useCanvas((s) => s.view);
  const nodes = useNodes((s) => s.nodes);
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
      {Object.entries(rects).map(([id, rect]) => {
        const steps = terminalOf(nodes[id])?.steps;
        return steps?.length ? <Timeline key={id} nodeId={id} steps={steps} rect={rect} view={view} /> : null;
      })}
    </div>
  );
}

function Timeline({ nodeId, steps, rect, view }: { nodeId: string; steps: Step[]; rect: Rect; view: CanvasView }) {
  const running = useSubagents(nodeId);
  const screen = screenRectOf(rect, view);
  const dots = dotsOf(steps, screen.width);
  return (
    <div data-steps={nodeId} className="absolute h-10" style={{ left: screen.x, top: screen.y + screen.height + TIMELINE_GAP, width: screen.width }}>
      <div className="absolute inset-x-0 top-[5px] h-px bg-ov-line" />
      {dots.map((dot) => (
        <div key={dot.title} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: dot.x, width: dot.slot }}>
          <span className={dot.state === "en_cours" ? "size-[11px] animate-pulse rounded-full" : "size-[11px] rounded-full"} style={{ backgroundColor: dot.color }} />
          <span title={dot.title} className="pointer-events-auto mt-1 max-w-full truncate px-1 text-[10px] text-ov-text-2">
            {dot.title}
            {dot.state === "en_cours" && running > 0 ? ` ×${running}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/canvas/overlay src/canvas/sceneSync.test.ts`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/canvas
git commit -m "feat(canvas): each Claude terminal shows its declared steps under it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 5: Vérification réelle et livraison

**Files:**
- Create: `scripts/mcp-probe.mjs` (client MCP scripté, gardé pour les jalons suivants)

- [ ] **Step 1: Write the scripted client**

`scripts/mcp-probe.mjs` :

```js
// Calls dummyPlane's MCP server as a Claude session would, with a node's
// launch file (spec orchestrateur §11). Usage:
//   node scripts/mcp-probe.mjs <path to <appdata>/mcp/<nodeId>.json> <method> [json params]
import { readFileSync } from "node:fs";

const [configPath, method, params = "{}"] = process.argv.slice(2);
const server = JSON.parse(readFileSync(configPath, "utf8")).mcpServers.dummyplane;
let id = 0;
async function rpc(method, params) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { ...server.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return { status: response.status, body: await response.text() };
}
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } });
const answer = await rpc(method, JSON.parse(params));
console.log(answer.status, answer.body);
```

- [ ] **Step 2: Check in the real app**

App de sonde (`dev.dummyplane.probe`, port 9223). Dans le workspace de test, lancer un agent Claude (ou relancer un agent existant), puis :
1. `<appdata sonde>\mcp\<nodeId>.json` et `.md` existent ; le réglage de hooks contient `SubagentStart` et `permissions.allow` ; la commande tapée dans le terminal porte `--mcp-config` et `--append-system-prompt-file`.
2. `node scripts/mcp-probe.mjs <config> tools/list` → `200` et les trois outils.
3. `… tools/call '{"name":"declarer_etapes","arguments":{"etapes":["Plan","Recherche","Code","Vérification"]}}'` → « 4 étapes déclarées. » ; la frise apparaît sous le terminal (capture `h1-frise.png`).
4. `… tools/call '{"name":"etape","arguments":{"titre":"Plan","etat":"fait"}}'` puis `Recherche` `en_cours` → couleurs à jour ; zoom et déplacement du terminal : la frise suit.
5. Une requête avec un faux jeton → `401`.
6. Fermer le terminal : les fichiers `mcp\<nodeId>.*` disparaissent, l'ancien jeton répond `401`.
7. Une session Claude réelle et courte : lui demander « Déclare trois étapes (Lire, Résumer, Conclure) avec l'outil dummyPlane, marque-les une à une, sans rien faire d'autre. » ; la frise s'allume (consomme un peu de l'abonnement de Mathieu ; une seule fois).
Expected : chaque point comme dit. Un écart devient un correctif (test d'abord rouge) et une décision au journal.

- [ ] **Step 3: Build and hand over**

`pnpm tauri build` (en arrière-plan), copie `src-tauri\target\release\dummyplane.exe` → `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-H1.exe`, raccourci du bureau repointé ; dire à Mathieu de fermer l'dummyPlane installé avant de l'ouvrir.

- [ ] **Step 4: Commit**

```bash
rm -f *.stackdump
git add scripts/mcp-probe.mjs
git commit -m "chore(mcp): a scripted MCP client to probe dummyPlane's server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```
