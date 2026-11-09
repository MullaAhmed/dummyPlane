# R3 « Une mission qui va au bout » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une mission ne bute plus sur un dépôt sans commit ni sur une fusion ratée, ses temps s'arrêtent à « terminer », et fermer un orchestrateur au travail se confirme et ne laisse pas de mission fantôme.

**Architecture:** Deux correctifs Rust dans `mission.rs` (vérification de `HEAD`, annulation dès que `MERGE_HEAD` existe) et la journalisation des erreurs de mission à la frontière des commandes. Côté TS : `endedAt` sur la mission ; un ensemble en mémoire des orchestrateurs fermés que le canvas tient à jour (suppression, annulation) et que les évènements, l'horloge et `rendre_compte` consultent ; le × passe par la confirmation existante, dont le texte connaît l'orchestrateur et sa mission.

**Tech Stack:** Rust 2024 (git en sous-processus), React 19, zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§5) ; décision R1 : journaliser les erreurs de mission ici.

## Global Constraints

- Textes en français, tutoiement.
- Dépôt sans commit : « Le dépôt n'a pas encore de commit : fais un premier commit, puis relance la mission. »
- Dialogue d'un orchestrateur en mission : « <nom> mène une mission en cours. Le fermer arrête sa session ; ses agents continuent, mais personne ne lira leurs comptes rendus. »
- Réponse de `rendre_compte` sans orchestrateur à l'écoute : « Compte rendu enregistré, mais l'orchestrateur est fermé : personne ne le lira pour l'instant. »
- Les identifiants enregistrés (`en_cours`, `terminee`…) ne changent pas.

## Review Focus

1. Un orchestrateur supprimé puis rétabli par Ctrl+Z : sa mission doit reprendre (évènements, horloge, comptes rendus transmis).
2. Une mission terminée avant ce correctif (pas d'`endedAt`) : aucun « 1440 / 20 min » en rouge.
3. Une fusion refusée par un hook alors qu'une fusion précédente a réussi : la branche de mission garde la fusion précédente, sans état intermédiaire.
4. Un orchestrateur arrêté (pas supprimé) qu'on relance : les comptes rendus arrivés entre-temps restent visibles par `equipe`.
5. Le × d'un orchestrateur arrêté : pas de dialogue, il part avec ses fils en un pas d'annulation.

---

### Task 1: Dépôt sans commit, et erreurs de mission au journal

**Files:** Modify `src-tauri/src/mission.rs` (`prepare`), `src-tauri/src/commands/mission.rs` (`blocking` logs); Test in `mission.rs` tests.

- [ ] **Step 1: Failing test**

```rust
    #[test]
    fn a_repository_without_a_commit_is_told_so() {
        let Some(dir) = repo_without_commit() else { return };
        assert_eq!(
            prepare(dir.path(), "auth").unwrap_err(),
            "Le dépôt n'a pas encore de commit : fais un premier commit, puis relance la mission."
        );
    }
```

`repo_without_commit()`: like `project()` (tempdir, `git init -q -b main`, user name/email, gpgsign false, autocrlf false) without the commit; `None` when git is missing.

- [ ] **Step 2: Run** → FAIL (git's raw text).
- [ ] **Step 3: Implement** — in `prepare`, after `locate`: `if git(&root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() { return Err(NO_COMMIT.into()); }`. In `blocking`, `log::warn!("mission: {err}")` on the `Err` of the job.
- [ ] **Step 4: Run** → PASS; full Rust suite.
- [ ] **Step 5: Commit** — `fix(mission): say that a repository has no commit yet`

### Task 2: Une fusion ratée ne bloque plus les suivantes

**Files:** Modify `src-tauri/src/mission.rs` (`merge_agent`); Test in `mission.rs` tests.

- [ ] **Step 1: Failing test** — a failing `pre-merge-commit` hook:

```rust
    #[test]
    fn a_merge_refused_by_a_hook_is_undone() {
        let Some(proj) = project() else { return };
        let mission = prepare(proj.path(), "auth").unwrap();
        let agent = add_agent(proj.path(), &mission.slug, "Athéna").unwrap();
        commit(Path::new(&agent.path), "a.txt", "a\n");
        let hooks = proj.path().join(".git").join("hooks");
        std::fs::write(hooks.join("pre-merge-commit"), "#!/bin/sh\nexit 1\n").unwrap();
        let err = merge_agent(Path::new(&mission.path), Path::new(&agent.path), &agent.branch).unwrap_err();
        assert!(err.contains("annulée"), "{err}");
        assert!(git(Path::new(&mission.path), &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
        std::fs::remove_file(hooks.join("pre-merge-commit")).unwrap();
        let again = merge_agent(Path::new(&mission.path), Path::new(&agent.path), &agent.branch).unwrap();
        assert_eq!(again.merge, Merge::Merged);
    }
```

(Use the module's helpers as they are named; `commit` makes a commit in a worktree. If Git for Windows does not run the hook — check `git merge` output in the test —, use `core.hooksPath` pointing at a folder with the hook.)

- [ ] **Step 2: Run** → FAIL (`MERGE_HEAD` remains; second merge fails).
- [ ] **Step 3: Implement** — in the `Err` branch: when `rev-parse -q --verify MERGE_HEAD` succeeds and no file is in conflict, `merge --abort` and return `Err(format!("La fusion de {branch} a échoué et a été annulée : {err}"))`; the conflict path stays as it is.
- [ ] **Step 4: Run** → PASS; full suite.
- [ ] **Step 5: Commit** — `fix(mission): undo a merge that failed without a conflict`

### Task 3: Les temps s'arrêtent à « terminer »

**Files:** Modify `src/mission/mission.ts` (`Mission.endedAt`, `readMission`, `memberTime`), `src/mission/launch.ts` (`endMission`), `src/mission/MissionPanel.tsx` (`Team`), `src/mcp/orchestratorTools.ts` (`equipe`); Tests in `mission.test.ts`, `launch.test.ts`, `MissionPanel.test.tsx`.

**Interfaces:** Produces `memberTime(mission: Mission, member: Member, now: number): number | undefined` — minutes from `sentAt` to the report, else to `endedAt`, else to `now` while running; `undefined` for a finished mission without `endedAt` and without a report.

- [ ] **Step 1: Failing tests**
  - `memberTime({ ...mission, state: "terminee", endedAt: t0 + 30 * MINUTE }, { sentAt: t0 }, t0 + 1440 * MINUTE)` → `30`.
  - `memberTime({ ...mission, state: "terminee" }, { sentAt: t0 }, later)` → `undefined`; with a report at `t0 + 6 min` → `6`.
  - `readMission({ ..., endedAt: 5 })` keeps `endedAt`.
  - `endMission` sets `endedAt` (fake `Date.now`).
  - `MissionPanel`: a `terminee` mission without `endedAt`, a member without a report → no « / 20 min » text for that member.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`spentMin` unchanged for running missions; `Team` and `equipe` use `memberTime`). **Step 4: Run** → PASS. **Step 5: Commit** — `fix(mission): stop the clocks when the mission ends`

### Task 4: Fermer un orchestrateur au travail

**Files:**
- Modify `src/mission/store.ts` (`setOrchestratorClosed`, `isOrchestratorClosed`; `memberOf(nodeId, { evenClosed })`), `src/canvas/Canvas.tsx` (closed on dispose, open again on restore), `src/mission/clock.ts`, `src/mission/events.ts` (skip closed), `src/mcp/agentTools.ts` (`report`)
- Modify `src/fleet/orchestrators.ts` (`requestCloseOrchestrator`), `src/nodes/orchestrator/OrchestratorNode.tsx` (×), `src/commands/catalog/orchestrator.ts` (palette), `src/shell/CloseAgentDialog.tsx` (orchestrator wording)
- Tests: `src/mission/store.test.ts` (or the file that tests `memberOf`), `src/mission/clock.test.ts`, `src/mcp/router.test.ts`, `src/shell/CloseAgentDialog.test.tsx`, a test for `requestCloseOrchestrator`.

**Interfaces:** Produces `setOrchestratorClosed(id: string, closed: boolean)`, `isOrchestratorClosed(id: string): boolean`, `requestCloseOrchestrator(id: string)`, `orchestratorWires(id): string[]` (the ids `removeOrchestrator` already computes).

- [ ] **Step 1: Failing tests**
  - `memberOf(agent)` → `null` once `setOrchestratorClosed(o, true)`; back after `setOrchestratorClosed(o, false)`; `memberOf(agent, { evenClosed: true })` finds it.
  - `checkBudgets` sends no notice and no toast for a closed orchestrator's overrun.
  - `report` (router `rendre_compte`) for a member of a closed or stopped orchestrator records the report and answers the Global Constraints' sentence; no `notify`.
  - `requestCloseOrchestrator` on a running orchestrator opens `closing` with `agents: [o]` and `remove: [o, …its wires]`; on a stopped one it removes at once.
  - `CloseAgentDialog` for an orchestrator in mission shows the Global Constraints' sentence and the button « Fermer l'orchestrateur ».
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** `Canvas.tsx`: in `settleRemovals`, `dispose.forEach((id) => setOrchestratorClosed(id, true))` before disposing; in `onNodesAdded`, `added.restored.forEach((id) => setOrchestratorClosed(id, false))`. **Step 4: Run** → PASS; full suite; tsc. **Step 5: Probe check** — an orchestrator (no mission needed) running a Shell? No: an orchestrator runs Claude. Launch one (Haiku, no message), click ×: the dialog shows; « Annuler » keeps it; « Fermer l'orchestrateur » removes it and its wires; Ctrl+Z brings it back stopped. **Step 6: Commit** — `fix(orchestrator): confirm before closing a working one, and forget its mission`

### Task 5: Fin du jalon

- [ ] `BACKLOG.md` : retirer les quatre points du plan H2/H3 réglés ; noter ce qui reste.
- [ ] Toutes les vérifications ; relecture finale ; corrections ; fusion dans `main`, push, branche supprimée.
