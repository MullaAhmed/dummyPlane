# R5c « Être compris » — ce qui est dit aux agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ce qu'dummyPlane dit aux agents et ce que Rust affiche suivent la langue de l'interface ; les outils MCP portent des noms anglais pour tous.

**Architecture:** Côté Rust, `tr!` pour les messages d'erreur montrés à l'utilisateur et des consignes de rôle en deux langues choisies au lancement. Côté TS, les descriptions et réponses des outils MCP, les lignes `[dummyPlane]` tapées dans les terminaux et le message des remarques de revue passent par des dictionnaires. Les noms d'outils, d'arguments et leurs valeurs deviennent anglais à la frontière MCP ; les identifiants enregistrés restent (`en_cours`, `faible`…), une table les traduit.

**Tech Stack:** Rust 2024, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§7.1, « Ce qui est envoyé aux agents », « Les noms des outils MCP passent en anglais »).

## Global Constraints

- Noms d'outils : `declare_steps`, `step`, `report` (agent) ; `mission`, `propose_plan`, `team`, `read_output`, `write`, `extend`, `interrupt`, `reassign`, `merge`, `finish`, `remote_control` (orchestrateur). Arguments en anglais (`steps`, `title`, `state`, `summary`, `status`, `name`, `task`, `subtasks`, `brief`, `agent`, `budget_min`, `level`, `text`, `lines`, `minutes`, `agents`, `on`).
- Valeurs à la frontière : étapes `in_progress`/`done`/`failed` ↔ `en_cours`/`fait`/`echec` ; compte rendu `done`/`blocked`/`failed` ↔ `termine`/`bloque`/`echec` ; niveaux `low`/`medium`/`high`/`extreme` ↔ `faible`/`moyen`/`eleve`/`extreme` ; agent `new` ↔ `nouveau` ; cibles `all`/`me` ↔ `tous`/`moi`. Les anciennes valeurs françaises restent acceptées (conversations reprises).
- Les textes français d'aujourd'hui ne changent pas ; les tests tournent en français.

## Review Focus

1. Une conversation reprise après la mise à jour, dont l'historique appelle `rendre_compte` : l'appel d'un ancien nom doit répondre clairement (outil renommé, son nouveau nom), pas échouer en silence.
2. Un orchestrateur lancé en anglais puis une interface passée en français : sa consigne de rôle reste celle de son lancement ; les lignes `[dummyPlane]` suivent la langue courante.
3. Une valeur française envoyée à un outil anglais (`state: "fait"`) : acceptée.
4. Les tests qui épinglent les textes des consignes (`prompts.rs`) restent verts en français et ont leur pendant anglais.
5. Une erreur Rust à variables (chemin avec espaces) : formatée en anglais comme en français.

---

### Task 1: Messages Rust

**Files:** the ~38 French messages of `src-tauri/src` (pty/shell.rs, mission.rs, review.rs, db/projects.rs, db/workspaces.rs, commands/*.rs, pty/mod.rs, agents/*.rs) → `tr!(fr, en)`; the database-failure dialog in `lib.rs` follows Windows' language (`sys-locale` or the `LANG` of the webview is not available yet: use `GetUserDefaultUILanguage` through `windows-sys` if already a dependency, else English and French side by side).

- [ ] Failing tests: for 3 representative messages, a test in English is not possible without the global; instead each message's English text is checked by a unit test of a pure `fn message(lang, …)` where a message has logic; the rest are covered by review. French tests unchanged.
- [ ] Commit — `feat(i18n): Rust's messages in the interface's language`

### Task 2: Consignes de rôle

**Files:** `src-tauri/src/agents/prompts.rs` (`AGENT`/`ORCHESTRATOR` in French and English, with the English tool names), `commands/agents.rs` (`prompts::for_role(role, i18n::current())`).

- [ ] Failing tests: both languages contain every tool name of the Global Constraints; the English prompt says it may not edit files nor run commands; French prompt keeps its pinned sentences with the new tool names.
- [ ] Commit — `feat(i18n): the agents' role prompts in English and French`

### Task 3: Outils MCP en anglais

**Files:** `src/mcp/agentTools.ts`, `src/mcp/orchestratorTools.ts`, `src/mcp/router.ts`, `src/mcp/messages.ts` (new), tests `src/mcp/router.test.ts` and neighbours.

- [ ] Failing tests: `tools/list` gives the English names; calls with English arguments and values work; French values are accepted; an old French tool name answers « Outil renommé : utilise report » / "Tool renamed: use report"; descriptions and replies in English when `lang` is `en`.
- [ ] Commit — `feat(mcp): English tool names, replies in the interface's language`

### Task 4: Lignes tapées dans les terminaux

**Files:** `src/mission/launch.ts`, `events.ts`, `clock.ts`, `src/mcp/agentTools.ts` (notify texts), `src/review/review.ts` (remarks message), `src/fleet/broadcast.ts` (if any line), `src/mission/messages.ts` (agent-facing section).

- [ ] Failing tests: each line in English when `lang` is `en`; French unchanged.
- [ ] Commit — `feat(i18n): what dummyPlane types to agents in the interface's language`

### Task 5: Fin

- [ ] CHANGELOG (MCP tool names changed), BACKLOG, all checks, final review, merge, push.
