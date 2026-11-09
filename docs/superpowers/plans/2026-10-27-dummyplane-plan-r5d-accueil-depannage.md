# R5d « Être compris » — premier lancement et dépannage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un nouveau venu sans agent installé sait quoi faire dès l'accueil ; un agent installé pendant qu'dummyPlane tourne est trouvé sans redémarrer ; un testeur en difficulté trouve un diagnostic, un guide et le moyen de signaler un problème.

**Architecture:** L'accueil charge la liste des agents et montre un encart « Bien démarrer » (trois étapes et leur état) ; sans agent, une carte avec la commande d'installation de Claude Code et les liens officiels des autres. Rust relit le `PATH` de Windows dans le registre (utilisateur et machine) sur demande, et s'en sert pour trouver les agents et lancer les terminaux. Un dialogue « Dépannage » rassemble version, agents, Git, serveur local, dossiers, diagnostic à copier, guide et signalement. Deux pages de documentation.

**Tech Stack:** Rust (`winreg`), React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§7.2, §7.3).

## Global Constraints

- Commande Claude Code (PowerShell) : `irm https://claude.ai/install.ps1 | iex` ; page : `https://code.claude.com/docs/en/setup`.
- Liens officiels : Codex `https://github.com/openai/codex`, Gemini CLI `https://github.com/google-gemini/gemini-cli`, Qwen Code `https://github.com/QwenLM/qwen-code`, Cursor CLI `https://cursor.com/cli`, opencode `https://opencode.ai/docs`, Aider `https://aider.chat/docs/install.html`, Ollama `https://ollama.com/download`, Git `https://git-scm.com/download/win`.
- Diagnostic copiable : sans jeton, sans chemin de projet, sans nom d'utilisateur (le dossier personnel devient `~`).
- Signaler : `https://github.com/Mideky-hub/openvibe/issues/new?template=bug_report.yml&version=<version>`.
- Guide : `https://github.com/Mideky-hub/openvibe/blob/main/docs/troubleshooting.md` (ou `.fr.md` en français).
- Tout texte en deux langues (dictionnaires de R5a).

## Review Focus

1. Un agent installé pendant qu'dummyPlane tourne : « Vérifier à nouveau » le trouve, et un nouveau terminal le lance.
2. Un `PATH` du registre avec `%USERPROFILE%`, `%LOCALAPPDATA%` et des entrées vides : développé et nettoyé.
3. Un utilisateur sans Git : le diagnostic le dit, le compteur d'usage explique pourquoi il est vide.
4. Un orchestrateur demandé sans Claude Code : refusé avec un message clair, rien n'est créé.
5. Le diagnostic copié ne contient ni jeton ni chemin personnel.

---

### Task 1: Relire le PATH de Windows

**Files:** `src-tauri/Cargo.toml` (`winreg`, Windows only), `src-tauri/src/pty/env_path.rs` (new), `pty/shell.rs` (`which_locate` uses it), `commands/pty.rs` (`refresh_path` command; spawn env `PATH`), `src/ipc/pty.ts`.

- [ ] Failing tests: `expand("%USERPROFILE%\\bin;;C:\\x", vars)`; `merge(user, machine)` keeps order, drops empties and duplicates (case-insensitive); `which_locate` finds a binary in a refreshed folder (tempdir with a fake `.exe`).
- [ ] Commit — `feat(agents): find agents installed while dummyPlane runs`

### Task 2: Bien démarrer

**Files:** `src/home/GettingStarted.tsx`, `src/home/NoAgent.tsx`, `src/home/HomeScreen.tsx`, `src/home/messages.ts`, `src/fleet/agentsStore.ts` (load + refresh), `src/fleet/orchestrators.ts` (refuse without Claude).

- [ ] Failing tests: no project and no agent → the three steps with « installer un agent » to do and the no-agent card with Claude Code's command and a copy button; « Vérifier à nouveau » calls `refresh_path` then reloads the agents; with an agent and a project → no panel; adding an orchestrator without Claude → toast, nothing created.
- [ ] Probe check: the home screen of a probe profile without projects.
- [ ] Commit — `feat(home): a guided first launch`

### Task 3: Dépannage

**Files:** `src-tauri/src/commands/app.rs` (`diagnostics`: version, OS, agents with found path shortened, git, git bash, server running; `open_data_dir`), `src/app/diagnostics.ts`, `src/shell/TroubleshootingDialog.tsx`, entries in the palette (Aide/Help), the settings menu and the home screen; `docs/troubleshooting.md`, `docs/troubleshooting.fr.md`; README links.

- [ ] Failing tests: the diagnostic text replaces the home folder by `~` and holds no token; the dialog shows agents and buttons; « Signaler un problème » opens the issue URL with the version.
- [ ] Commit — `feat(help): a troubleshooting dialog and guide`

### Task 4: Fin

- [ ] CHANGELOG, BACKLOG, all checks, final review, merge, push.
