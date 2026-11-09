# dummyPlane H3 — Le temps d'une mission (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque sous-tâche d'une mission a son budget qui court ; un dépassement réveille l'orchestrateur (une fois), le double prévient l'utilisateur, la fin du budget global aussi ; l'orchestrateur peut prolonger, interrompre ou réattribuer ; des barres montrent le temps passé.

**Architecture:** Le temps se calcule à partir des horodatages déjà gardés (`sentAt`, `report.at`) et de nouveaux champs de la mission (`startedAt`, `extraMin`, `overdue`, `globalOverdue`, `handedTo`), par des fonctions pures (`src/mission/mission.ts`). Une horloge (`src/mission/clock.ts`, toutes les 15 s) les applique : évènements à l'orchestrateur par la file de H2, toasts à l'utilisateur. Trois outils de plus (`prolonger`, `interrompre`, `reattribuer`) ; la réattribution réutilise le lancement de H2. L'affichage lit les mêmes fonctions.

**Tech Stack:** React 19 / TypeScript, Zustand 5, sonner, Vitest ; Rust (consigne de l'orchestrateur).

**Spec:** `docs/superpowers/specs/2026-10-26-dummyplane-orchestrateur-manager-design.md` (jalon H3 : §7.2 `prolonger`, `interrompre`, `reattribuer` ; §8).

## Global Constraints

- Aucune dépendance ajoutée.
- dummyPlane n'arrête jamais un agent de lui-même pour un dépassement (spec §8.2).
- Le temps d'une sous-tâche court de l'envoi de sa consigne à son compte rendu, en temps réel (spec §8.1).
- Textes visibles et messages des outils en français ; identifiants, commits et commentaires de code en anglais ; les textes pour l'IA disent « l'utilisateur ».
- Vérification réelle uniquement sur le profil `dev.dummyplane.probe`, avec le dépôt jetable du scratchpad.

## Review Focus

1. Un dépassement n'est signalé qu'une fois par palier, y compris après un redémarrage d'dummyPlane (les paliers sont enregistrés dans la mission) (Task 2).
2. `prolonger` au-delà du reste du budget global est refusé ; un agent prolongé au-delà de son temps passé peut être signalé de nouveau plus tard (Task 3).
3. Réattribuer à un agent qui n'a pas fini, à lui-même ou à un inconnu : refus lisible, rien ne change (Task 4).
4. Un agent dont la sous-tâche a été réattribuée ne compte plus dans les dépassements ni dans le reste du budget global (Task 1, Task 4).
5. Les barres et les temps se mettent à jour sans action de l'utilisateur (horloge d'affichage) et disparaissent hors mission en cours (Task 5).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/mission/mission.ts` | Champs du temps ; `budgetOf`, `spentMin`, `overruns`, `remainingGlobal`, `budgetBar`, `clockText`. |
| `src/mission/clock.ts` (créé) | L'horloge des missions : évènements et toasts de dépassement. |
| `src/mission/launch.ts` | `startedAt` au feu vert ; `reassignTask` ; consigne de reprise. |
| `src/mission/store.ts` | `memberBudgets` : le temps de chaque agent de mission, pour l'affichage. |
| `src/mcp/orchestratorTools.ts` | `prolonger`, `interrompre`, `reattribuer`. |
| `src-tauri/src/agents/prompts.rs` | La consigne de l'orchestrateur parle des budgets et des trois outils. |
| `src/canvas/overlay/StepTimelines.tsx`, `src/canvas/overlay/timeline.ts` | La barre du budget au-dessus de la frise. |
| `src/nodes/orchestrator/OrchestratorNode.tsx`, `src/mission/MissionPanel.tsx` | Temps passé / budget global ; temps de chaque agent. |
| `src/lib/useNow.ts` (créé) | Un instant qui avance, pour l'affichage. |
| `src/app/boot.ts` | Installe l'horloge. |

---

### Task 1: Le modèle du temps

**Files:**
- Modify: `src/mission/mission.ts`, `src/mission/mission.test.ts`
- Modify: `src/mission/launch.ts` (`startedAt`), `src/mission/launch.test.ts`

**Interfaces:**
- Produces: `Member.extraMin?: number`, `Member.overdue?: 1 | 2`, `Member.handedTo?: string` ; `Mission.startedAt?: number`, `Mission.globalOverdue?: boolean` ; `budgetOf(m): number`, `spentMin(m, now): number`, `Overrun { nodeId, name, task, level: 1 | 2, budget }`, `overruns(mission, now): { members: Overrun[]; global: boolean }`, `remainingGlobal(mission): number | undefined`, `BudgetTone = "ok" | "late" | "over"`, `budgetBar(spent, budget): { ratio, tone }`, `clockText(mission, now): string | null`.

- [ ] **Step 1: Write the failing tests** — `src/mission/mission.test.ts` (imports `budgetBar, budgetOf, clockText, overruns, remainingGlobal, spentMin, type Member` en plus) :

```ts
describe("the time of a mission (spec orchestrateur §8)", () => {
  const min = 60_000;
  const member = (extra: Partial<Member> = {}): Member => ({ nodeId: "n1", name: "Isis", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0, ...extra });
  const running = (members: Member[], extra: Partial<Mission> = {}): Mission => ({ ...NEW_MISSION, state: "en_cours", name: "Auth", members, ...extra });

  it("counts a member's time from its sub-task to its report, its budget with its extensions", () => {
    expect(spentMin(member(), 6 * min)).toBe(6);
    expect(spentMin(member({ report: { summary: "ok", status: "termine", at: 4 * min } }), 9 * min)).toBe(4);
    expect(spentMin(member({ sentAt: undefined }), 9 * min)).toBe(0);
    expect(budgetOf(member({ extraMin: 5 }))).toBe(15);
  });

  it("finds each overrun once per step, 100 % then 200 %, and the end of the global budget", () => {
    const report = { summary: "ok", status: "termine" as const, at: min };
    const mission = running(
      [member(), member({ nodeId: "n2", name: "Horus", overdue: 1 }), member({ nodeId: "n3", name: "Seth", report }), member({ nodeId: "n4", name: "Thot", handedTo: "Horus" })],
      { budgetMin: 30, startedAt: 0 },
    );
    expect(overruns(mission, 11 * min)).toEqual({ members: [{ nodeId: "n1", name: "Isis", task: "Login", level: 1, budget: 10 }], global: false });
    expect(overruns(mission, 21 * min).members.map((o) => [o.nodeId, o.level])).toEqual([["n1", 2], ["n2", 2]]);
    expect(overruns(mission, 31 * min).global).toBe(true);
    expect(overruns({ ...mission, globalOverdue: true }, 31 * min).global).toBe(false);
    expect(overruns({ ...mission, state: "terminee" }, 31 * min)).toEqual({ members: [], global: false });
  });

  it("knows what is left of the global budget, without the handed-over sub-tasks", () => {
    expect(remainingGlobal(running([member(), member({ nodeId: "n2", extraMin: 5 }), member({ nodeId: "n3", handedTo: "Isis" })], { budgetMin: 30 }))).toBe(5);
    expect(remainingGlobal(running([member()]))).toBeUndefined();
  });

  it("colours a budget's bar: green, orange past 80 %, red past 100 %", () => {
    expect(budgetBar(4, 10)).toEqual({ ratio: 0.4, tone: "ok" });
    expect(budgetBar(9, 10)).toEqual({ ratio: 0.9, tone: "late" });
    expect(budgetBar(25, 10)).toEqual({ ratio: 1, tone: "over" });
  });

  it("writes the mission's time for the orchestrator's header", () => {
    expect(clockText(running([], { startedAt: 0, budgetMin: 60 }), 12.4 * min)).toBe("12 / 60 min");
    expect(clockText(running([], { startedAt: 0 }), 3 * min)).toBe("3 min");
    expect(clockText({ ...NEW_MISSION }, 3 * min)).toBeNull();
  });

  it("reads the time fields back", () => {
    const saved = { state: "en_cours", maxAgents: 4, startedAt: 5, globalOverdue: true, members: [{ ...member(), extraMin: 5, overdue: 2, handedTo: "Horus" }] };
    expect(readMission(saved)).toEqual(saved);
  });
});
```

`src/mission/launch.test.ts`, dans « forms the team… » : `expect(mission.startedAt).toEqual(expect.any(Number));`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mission 2>&1 | tail -20`
Expected: FAIL — `spentMin`, `budgetOf`… introuvables ; `startedAt` absent.

- [ ] **Step 3: Write the time model**

`Member` gagne :

```ts
  /** Minutes added by `prolonger` (spec §8.2). */
  extraMin?: number;
  /** The overruns already told: 1 at 100 % of its budget, 2 at 200 % (spec §8.2). */
  overdue?: 1 | 2;
  /** Its sub-task went to this agent (`reattribuer`): its clock stops. */
  handedTo?: string;
```

`Mission` gagne :

```ts
  /** The go-ahead: the global budget runs from then (spec §8.1). */
  startedAt?: number;
  /** The end of the global budget was told (spec §8.2). */
  globalOverdue?: boolean;
```

Dans `readMember`, avant `return member;` :

```ts
  if (typeof r.extraMin === "number") member.extraMin = r.extraMin;
  if (r.overdue === 1 || r.overdue === 2) member.overdue = r.overdue;
  if (typeof r.handedTo === "string") member.handedTo = r.handedTo;
```

Dans `readMission`, avant `return mission;` :

```ts
  if (typeof r.startedAt === "number") mission.startedAt = r.startedAt;
  if (r.globalOverdue === true) mission.globalOverdue = true;
```

À la fin du fichier :

```ts
const MINUTE = 60_000;

/** A member's budget with its extensions. */
export const budgetOf = (member: Member) => member.budgetMin + (member.extraMin ?? 0);

/** Minutes a member has spent: from its sub-task's sending to its report, in real time (spec §8.1). */
export function spentMin(member: Member, now: number): number {
  if (member.sentAt === undefined) return 0;
  return Math.max(0, ((member.report?.at ?? now) - member.sentAt) / MINUTE);
}

export interface Overrun {
  nodeId: string;
  name: string;
  task: string;
  level: 1 | 2;
  budget: number;
}

/**
 * What the clock has to tell (spec §8.2): the members past 100 % or 200 % of
 * their budget without a report, each step once, and the end of the global budget.
 */
export function overruns(mission: Mission, now: number): { members: Overrun[]; global: boolean } {
  if (mission.state !== "en_cours") return { members: [], global: false };
  const members = mission.members.flatMap((m): Overrun[] => {
    if (m.sentAt === undefined || m.report || m.handedTo) return [];
    const ratio = spentMin(m, now) / budgetOf(m);
    const level = ratio >= 2 ? 2 : ratio >= 1 ? 1 : 0;
    return level > (m.overdue ?? 0) ? [{ nodeId: m.nodeId, name: m.name, task: m.task, level: level as 1 | 2, budget: budgetOf(m) }] : [];
  });
  const global =
    mission.budgetMin !== undefined && mission.startedAt !== undefined && !mission.globalOverdue && (now - mission.startedAt) / MINUTE >= mission.budgetMin;
  return { members, global };
}

/** What `prolonger` may still take from the global budget; undefined without one. */
export function remainingGlobal(mission: Mission): number | undefined {
  if (mission.budgetMin === undefined) return undefined;
  return mission.budgetMin - mission.members.filter((m) => !m.handedTo).reduce((sum, m) => sum + budgetOf(m), 0);
}

export type BudgetTone = "ok" | "late" | "over";

/** A budget's bar (spec §8.3): green, orange past 80 %, red past 100 %. */
export function budgetBar(spent: number, budget: number): { ratio: number; tone: BudgetTone } {
  const ratio = budget > 0 ? spent / budget : 0;
  return { ratio: Math.min(1, ratio), tone: ratio > 1 ? "over" : ratio > 0.8 ? "late" : "ok" };
}

/** The orchestrator's header during a mission (spec §8.3): time spent, over the global budget if any. */
export function clockText(mission: Mission, now: number): string | null {
  if (mission.state !== "en_cours" || mission.startedAt === undefined) return null;
  const spent = Math.floor((now - mission.startedAt) / MINUTE);
  return mission.budgetMin === undefined ? `${spent} min` : `${spent} / ${mission.budgetMin} min`;
}
```

`src/mission/launch.ts`, dans `launchMission` : `setMission(orchestratorId, { state: "en_cours", startedAt: Date.now(), ...team });`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/mission 2>&1 | tail -6`
Expected: tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/mission
git commit -m "feat(mission): budgets, time spent and overruns of a mission"
```

---

### Task 2: L'horloge des missions

**Files:**
- Create: `src/mission/clock.ts`, `src/mission/clock.test.ts`
- Modify: `src/app/boot.ts`

**Interfaces:**
- Consumes: `overruns` (Task 1), `notify` (H2), `missionOf`, `setMission`, `updateMember` (H2).
- Produces: `CLOCK_MS = 15_000`, `checkBudgets(now?: number): void`, `installMissionClock(): () => void`.

- [ ] **Step 1: Write the failing test** — `src/mission/clock.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { checkBudgets } from "./clock";
import { notify } from "./events";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("./events", () => ({ notify: vi.fn() }));

const min = 60_000;
beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "orchestrator",
    payload: {
      name: "Chef",
      mission: {
        state: "en_cours",
        name: "Auth",
        maxAgents: 4,
        budgetMin: 30,
        startedAt: 0,
        members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 }],
      },
    },
  });
});

it("tells the orchestrator once when a budget runs out, warns the user at 200 % and at the end of the global budget (spec §8.2)", () => {
  checkBudgets(5 * min);
  expect(notify).not.toHaveBeenCalled();
  checkBudgets(11 * min);
  checkBudgets(12 * min);
  expect(vi.mocked(notify).mock.calls).toEqual([
    ["chef", "Budget écoulé : Isis (Login) a passé ses 10 min sans rendre compte. Décide : ecrire, prolonger, interrompre ou reattribuer."],
  ]);
  expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].overdue).toBe(1);
  checkBudgets(21 * min);
  checkBudgets(22 * min);
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(toast.warning).toHaveBeenCalledWith("Isis a dépassé deux fois son budget (10 min) sans rendre compte.");
  checkBudgets(31 * min);
  checkBudgets(40 * min);
  expect(vi.mocked(notify).mock.calls[1]).toEqual(["chef", "Budget global écoulé (30 min) : termine avec ce qui est fait."]);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(toast.warning).toHaveBeenLastCalledWith("Budget global de la mission Auth écoulé (30 min).");
  expect(missionOf(nodesStore.getState().nodes.chef)?.globalOverdue).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/mission/clock.test.ts 2>&1 | tail -10`
Expected: FAIL — `./clock` introuvable.

- [ ] **Step 3: Write the clock**

`src/mission/clock.ts` :

```ts
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { notify } from "./events";
import { overruns } from "./mission";
import { missionOf, setMission, updateMember } from "./store";

/** How often the missions' clocks are read. */
export const CLOCK_MS = 15_000;

/** One look at every running mission's budgets (spec §8.2); it never stops an agent. */
export function checkBudgets(now = Date.now()) {
  for (const [orchestratorId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (!mission) continue;
    const found = overruns(mission, now);
    for (const overrun of found.members) {
      const before = mission.members.find((m) => m.nodeId === overrun.nodeId)?.overdue ?? 0;
      if (before < 1) {
        notify(
          orchestratorId,
          `Budget écoulé : ${overrun.name} (${overrun.task}) a passé ses ${overrun.budget} min sans rendre compte. Décide : ecrire, prolonger, interrompre ou reattribuer.`,
        );
      }
      if (overrun.level === 2) toast.warning(`${overrun.name} a dépassé deux fois son budget (${overrun.budget} min) sans rendre compte.`);
      updateMember(orchestratorId, overrun.nodeId, { overdue: overrun.level });
    }
    if (found.global) {
      notify(orchestratorId, `Budget global écoulé (${mission.budgetMin} min) : termine avec ce qui est fait.`);
      toast.warning(`Budget global de la mission ${mission.name ?? ""} écoulé (${mission.budgetMin} min).`);
      setMission(orchestratorId, { globalOverdue: true });
    }
  }
}

/** For the app's whole life. */
export function installMissionClock(): () => void {
  const timer = setInterval(() => checkBudgets(), CLOCK_MS);
  return () => clearInterval(timer);
}
```

`src/app/boot.ts` : après `installMissionEvents();`, `installMissionClock();` (import de `@/mission/clock`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/mission 2>&1 | tail -6`
Expected: tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/mission/clock.ts src/mission/clock.test.ts src/app/boot.ts
git commit -m "feat(mission): a clock tells the orchestrator and the user about overruns"
```

---

### Task 3: Prolonger et interrompre

**Files:**
- Modify: `src/mcp/orchestratorTools.ts`, `src/mcp/router.test.ts`
- Modify: `src-tauri/src/agents/prompts.rs`

**Interfaces:**
- Consumes: `budgetOf`, `spentMin`, `remainingGlobal` (Task 1) ; `pauseAgents(ids): Promise<number>` (`@/fleet/broadcast`).
- Produces: `ORCHESTRATOR_TOOLS` dans l'ordre `mission`, `proposer_plan`, `equipe`, `lire_sortie`, `ecrire`, `prolonger`, `interrompre`, `reattribuer`, `fusionner`, `terminer` (la définition de `reattribuer` arrive ici ; son effet en Task 4).

- [ ] **Step 1: Write the failing tests**

`src/mcp/router.test.ts` : la liste attendue des outils devient `["mission", "proposer_plan", "equipe", "lire_sortie", "ecrire", "prolonger", "interrompre", "reattribuer", "fusionner", "terminer"]` ; simulation ajoutée `vi.mock("@/fleet/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));` (import `pauseAgents`) ; dans « once the team is formed », avant « merges and ends… » :

```ts
    it("extends an agent's budget from what is left of the global one (spec §7.2)", async () => {
      setMission("chef", { budgetMin: 30 });
      expect(textOf(await call("chef", "prolonger", { agent: "Isis", minutes: 20 }))).toBe("Il reste 10 min sur le budget global.");
      updateMember("chef", "isis", { overdue: 1 });
      expect(textOf(await call("chef", "prolonger", { agent: "Isis", minutes: 10 }))).toBe("Isis : +10 min, budget 30 min.");
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0]).toMatchObject({ extraMin: 10 });
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].overdue).toBeUndefined();
      expect(await call("chef", "prolonger", { agent: "Isis", minutes: 0 })).toMatchObject({ isError: true });
      setMission("chef", { budgetMin: undefined });
    });

    it("interrupts an agent's turn like « Pause » (spec §7.2)", async () => {
      expect(textOf(await call("chef", "interrompre", { agent: "Isis" }))).toBe("Tour d'Isis interrompu. ecrire « continue » le reprend.");
      expect(pauseAgents).toHaveBeenCalledWith(["isis"]);
      vi.mocked(pauseAgents).mockResolvedValueOnce(0);
      expect(textOf(await call("chef", "interrompre", { agent: "Isis" }))).toBe("Isis n'est pas au travail : rien à interrompre.");
    });
```

`src-tauri/src/agents/prompts.rs`, le test `each_role_gets_its_own_instructions` couvre aussi `"prolonger"`, `"interrompre"`, `"reattribuer"` et `"Budget écoulé"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mcp 2>&1 | tail -10 ; cd src-tauri && cargo test --lib prompts 2>&1 | tail -5`
Expected: FAIL — outils inconnus ; consigne sans ces mots.

- [ ] **Step 3: Write the tools**

`ORCHESTRATOR_TOOLS`, après `ecrire` :

```ts
  {
    name: "prolonger",
    description: "Ajoute des minutes au budget d'un agent de la mission, prises sur le reste du budget global.",
    inputSchema: { type: "object", properties: { agent: { type: "string" }, minutes: { type: "integer", minimum: 1 } }, required: ["agent", "minutes"] },
  },
  {
    name: "interrompre",
    description: "Arrête le tour d'un agent au travail (Échap), comme « Pause » ; ecrire « continue » le reprend.",
    inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] },
  },
  {
    name: "reattribuer",
    description: "Donne une sous-tâche à un autre agent de la mission qui a rendu compte, ou à un agent « nouveau » : il la reçoit avec le compte rendu et la branche du précédent.",
    inputSchema: { type: "object", properties: { sous_tache: { type: "string" }, agent: { type: "string" } }, required: ["sous_tache", "agent"] },
  },
```

Fonctions (imports `pauseAgents` de `@/fleet/broadcast` ; `budgetOf, remainingGlobal, spentMin` de `@/mission/mission` ; `updateMember` de `@/mission/store`) :

```ts
function prolong(orchestratorId: string, mission: Mission, args: Record<string, unknown>): ToolResult {
  if (mission.state !== "en_cours") return refused("Aucune mission en cours.");
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  const minutes = args.minutes;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1) return refused("Donne un nombre entier de minutes (1 au moins).");
  const left = remainingGlobal(mission);
  if (left !== undefined && minutes > left) return refused(`Il reste ${Math.max(0, left)} min sur le budget global.`);
  const extraMin = (member.extraMin ?? 0) + minutes;
  const budget = member.budgetMin + extraMin;
  const spent = spentMin(member, Date.now());
  // Below its new budget it may be told again later; still past it, it is not told twice (spec §8.2).
  const overdue = spent >= 2 * budget ? 2 : spent >= budget ? 1 : undefined;
  updateMember(orchestratorId, member.nodeId, { extraMin, overdue });
  return said(`${member.name} : +${minutes} min, budget ${budget} min.`);
}

async function interrupt(mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  const member = memberNamed(mission, args.agent);
  if (typeof member === "string") return refused(member);
  // The same as « Pause »: « Tout reprendre » knows it.
  if ((await pauseAgents([member.nodeId])) === 0) return refused(`${member.name} n'est pas au travail : rien à interrompre.`);
  return said(`Tour d'${member.name} interrompu. ecrire « continue » le reprend.`);
}
```

Dans `orchestratorTool` : `case "prolonger": return prolong(orchestratorId, mission, args);` et `case "interrompre": return mission.state === "en_cours" ? interrupt(mission, args) : refused("Aucune mission en cours.");`. (« Tour d'Isis » : la forme « d' » devant voyelle ; devant consonne « de » — `const of = (name: string) => (/^[aeiouyéèêàâîôûh]/i.test(name) ? `d'${name}` : `de ${name}`);` et le texte `Tour ${of(member.name)} interrompu…`.)

`prompts.rs`, dans `ORCHESTRATOR`, après la ligne de `ecrire` :

```text
- prolonger : ajoute des minutes au budget d'un agent, prises sur le reste du budget global.
- interrompre : arrête le tour d'un agent au travail, comme Échap ; ecrire « continue » le reprend.
- reattribuer : donne une sous-tâche à un autre agent de la mission qui a rendu compte, ou à un agent « nouveau » ; il reçoit le compte rendu et la branche du précédent.
```

et la phrase des évènements devient : « dummyPlane tape dans ton terminal des lignes qui commencent par [dummyPlane] : feu vert, comptes rendus des agents, agent qui attend l'utilisateur, agent arrêté, « Budget écoulé » d'un agent, budget global écoulé. Réagis-y : suis ton équipe avec equipe et lire_sortie ; sur un budget écoulé, décide : relancer avec ecrire, prolonger, interrompre ou reattribuer ; sur le budget global écoulé, termine avec ce qui est fait. »

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/mcp 2>&1 | tail -6 ; cd src-tauri && cargo test --lib 2>&1 | grep "test result"`
Expected: tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/mcp src-tauri/src/agents/prompts.rs
git commit -m "feat(mcp): the orchestrator extends budgets and interrupts agents"
```

---

### Task 4: Réattribuer une sous-tâche

**Files:**
- Modify: `src/mission/launch.ts`, `src/mission/launch.test.ts`
- Modify: `src/mcp/orchestratorTools.ts`, `src/mcp/router.test.ts`

**Interfaces:**
- Consumes: H2 (`assign`, `missionAddAgent`, `missionDiscard`, `launchGroup`, `linkOrchestrator`, `orchestratorShown`, `newNames`, `besideOrchestrator`) ; `addTerminal(workspaceId, payload, center, groupId)` (`@/fleet/terminals`) ; `relaunchTerminal`.
- Produces: `handoverText(from: Member): string` ; `subTaskText(mission, task, branch, handover?)` ; `reassignTask(orchestratorId, fromNodeId, target): Promise<{ name: string } | string>`.

- [ ] **Step 1: Write the failing tests**

`src/mission/launch.test.ts` (simulation ajoutée `vi.mock("@/fleet/terminals", () => ({ addTerminal: vi.fn(() => Promise.resolve("n9")) }))`, import `addTerminal` et `canvasStore`, `reassignTask`, `handoverText`) :

```ts
describe("reassignTask (spec §7.2 reattribuer)", () => {
  const report = { summary: "API faite", status: "termine" as const, at: 1 };
  const team = () => setup({ state: "en_cours", project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("isis", "Isis", true, { task: "Login" }), member("n1", "Horus", false, { task: "API", report })] });

  it("gives a sub-task to an agent who is done, with the previous one's report and branch", async () => {
    await team();
    expect(await reassignTask("chef", "isis", "horus")).toEqual({ name: "Horus" });
    const [isis, horus] = missionNow().members;
    expect(isis.handedTo).toBe("Horus");
    expect(horus).toMatchObject({ task: "Login", budgetMin: 20, report: undefined, overdue: undefined, extraMin: undefined });
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("Reprise du travail d'Isis")));
    const text = vi.mocked(ptySendText).mock.calls[0][1];
    expect(text.startsWith(subTaskText("Auth", plan[0], "dummyplane/auth-n1"))).toBe(true);
    expect(text).toContain("dummyplane/auth-isis");
    expect(handoverText(missionNow().members[1])).toContain("API faite");
  });

  it("refuses an agent who is not done, the same agent, or a stranger; nothing changes", async () => {
    await team();
    const before = missionNow();
    expect(await reassignTask("chef", "n1", "Isis")).toContain("n'a pas fini");
    expect(await reassignTask("chef", "isis", "Isis")).toContain("n'est pas un autre agent");
    expect(await reassignTask("chef", "isis", "Zeus")).toContain("n'est pas un autre agent");
    expect(missionNow()).toEqual(before);
  });

  it("gives a sub-task to a new agent in the mission's group, started at once", async () => {
    await team();
    canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1"] }] });
    const result = await reassignTask("chef", "isis", "nouveau");
    expect(typeof result === "object" && result.name).toBeTruthy();
    const name = (result as { name: string }).name;
    expect(missionAddAgent).toHaveBeenCalledWith("C:/code/proj", "auth", name);
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ name, cwd: tree(`auth-${name.toLowerCase()}`).path, agent: "claude" }), { x: 400, y: 250 }, "f1");
    expect(relaunchTerminal).toHaveBeenCalledWith("n9", expect.objectContaining({ name }), "new");
    expect(missionNow().members.map((m) => [m.nodeId, m.task, m.handedTo])).toEqual([
      ["isis", "Login", name],
      ["n1", "API", undefined],
      ["n9", "Login", undefined],
    ]);
  });
});
```

`src/mcp/router.test.ts` : la simulation de `@/mission/launch` gagne `reassignTask: vi.fn(() => Promise.resolve({ name: "Horus" }))` ; dans « once the team is formed » :

```ts
    it("hands a sub-task over through dummyPlane (spec §7.2)", async () => {
      expect(textOf(await call("chef", "reattribuer", { sous_tache: "login", agent: "nouveau" }))).toBe("« Login » passe à Horus.");
      expect(reassignTask).toHaveBeenCalledWith("chef", "isis", "nouveau");
      expect(await call("chef", "reattribuer", { sous_tache: "Paiement", agent: "nouveau" })).toMatchObject({ isError: true });
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mission src/mcp 2>&1 | tail -10`
Expected: FAIL — `reassignTask` introuvable.

- [ ] **Step 3: Write the handover**

`src/mission/launch.ts` :

```ts
/** What the next agent learns of the previous one (spec §7.2 reattribuer). */
export function handoverText(from: Member): string {
  const report = from.report ? `son compte rendu (${from.report.status}) : « ${oneLine(from.report.summary)} »` : "il n'a pas rendu compte";
  return `Reprise du travail d'${from.name} : ${report}. Sa branche ${from.branch} : fusionne-la dans la tienne pour repartir de son travail.`;
}
```

`subTaskText(mission, task, branch, handover?: string)` ajoute `${handover ? ` ${handover}` : ""}` à la fin ; `assign(orchestratorId, member, mission, task, restarted, handover?: string)` passe `handover` à `subTaskText`.

```ts
/** A new agent for a handed-over sub-task: its worktree, its terminal in the mission's group, started now. */
async function newMember(orchestratorId: string, workspaceId: string, mission: Mission, task: SubTask): Promise<Member | string> {
  if (!mission.project || !mission.slug) return "La mission n'a pas de dossier.";
  const frame = canvasStore.getState().frames.find((f) => f.id === mission.frameId);
  const pantheon = frame?.group?.pantheon ?? pantheonForNewGroup(workspaceId);
  const [name] = newNames(workspaceId, pantheon, 1);
  let tree: Worktree;
  try {
    tree = await missionAddAgent(mission.project, mission.slug, name);
  } catch (error) {
    return errorText(error);
  }
  const payload = newTerminalPayload({ ...defaultLaunchOptions(), cwd: tree.path, agent: "claude" }, name);
  let nodeId: string | null = null;
  if (frame) {
    nodeId = await addTerminal(workspaceId, payload, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, frame.id);
  } else {
    const group = await launchGroup(
      { name: `Mission ${mission.name}`, role: "general", agents: ["claude"] },
      defaultLaunchOptions(),
      besideOrchestrator(orchestratorId, 1),
      { pantheon, names: [name], cwds: [tree.path] },
    );
    if (group) {
      nodeId = group.nodeIds[0];
      linkOrchestrator(orchestratorId, group.frameId);
      setMission(orchestratorId, { frameId: group.frameId });
    }
  }
  if (!nodeId) {
    await missionDiscard(mission.project, [tree]).catch(() => undefined);
    return "Le nouvel agent n'a pas pu être créé.";
  }
  // Started now, shown or not: its sub-task waits for it.
  if (frame) void relaunchTerminal(nodeId, payload, "new");
  return { nodeId, name, task: task.title, budgetMin: task.budgetMin, linked: false, branch: tree.branch, worktree: tree.path };
}

/** `reattribuer` (spec §7.2): to a member who reported, or to a new agent; it gets the previous one's report and branch. */
export async function reassignTask(orchestratorId: string, fromNodeId: string, target: string): Promise<{ name: string } | string> {
  const record = nodesStore.getState().nodes[orchestratorId];
  const mission = missionOf(record);
  if (!record || mission?.state !== "en_cours") return "Aucune mission en cours.";
  const from = mission.members.find((m) => m.nodeId === fromNodeId && !m.handedTo);
  const task = mission.plan?.find((s) => s.title === from?.task);
  if (!from || !task) return "Sous-tâche introuvable.";
  let to: Member;
  if (sameName(target, NEW_AGENT)) {
    if (!orchestratorShown(orchestratorId)) return "L'espace de l'orchestrateur n'est pas affiché : impossible d'y créer un agent.";
    const made = await newMember(orchestratorId, record.workspaceId, mission, task);
    if (typeof made === "string") return made;
    to = made;
  } else {
    const found = mission.members.find((m) => sameName(m.name, target) && m.nodeId !== from.nodeId && !m.handedTo);
    if (!found) return `« ${target} » n'est pas un autre agent de la mission.`;
    if (!found.report) return `${found.name} n'a pas fini sa sous-tâche : choisis un agent qui a rendu compte, ou « nouveau ».`;
    to = { ...found, task: task.title, budgetMin: task.budgetMin, extraMin: undefined, overdue: undefined, report: undefined, sentAt: undefined };
  }
  const latest = missionOf(nodesStore.getState().nodes[orchestratorId]) ?? mission;
  const members = latest.members.map((m) => (m.nodeId === from.nodeId ? { ...m, handedTo: to.name } : m.nodeId === to.nodeId ? to : m));
  setMission(orchestratorId, { members: members.some((m) => m.nodeId === to.nodeId) ? members : [...members, to] });
  void assign(orchestratorId, to, mission.name ?? "", task, Promise.resolve(), handoverText(from));
  return { name: to.name };
}
```

(Imports ajoutés : `addTerminal` de `@/fleet/terminals`, `newTerminalPayload` de `@/nodes/terminal/launch`.)

`src/mcp/orchestratorTools.ts` (import `reassignTask`) :

```ts
async function reassign(orchestratorId: string, mission: Mission, args: Record<string, unknown>): Promise<ToolResult> {
  if (mission.state !== "en_cours") return refused("Aucune mission en cours.");
  const title = typeof args.sous_tache === "string" ? args.sous_tache : "";
  const from = mission.members.find((m) => !m.handedTo && sameName(m.task, title));
  if (!from) return refused(`Aucune sous-tâche « ${title} » dans l'équipe.`);
  const result = await reassignTask(orchestratorId, from.nodeId, typeof args.agent === "string" ? args.agent : "");
  return typeof result === "string" ? refused(result) : said(`« ${from.task} » passe à ${result.name}.`);
}
```

et `case "reattribuer": return reassign(orchestratorId, mission, args);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -6`
Expected: toute la suite passe.

- [ ] **Step 5: Commit**

```bash
git add src/mission src/mcp
git commit -m "feat(mission): a sub-task can go to an agent who is done or to a new one"
```

---

### Task 5: Les barres et les temps

**Files:**
- Create: `src/lib/useNow.ts`
- Modify: `src/mission/store.ts` (`memberBudgets`), `src/mission/store.test.ts` (créé)
- Modify: `src/canvas/overlay/timeline.ts` (+ test), `src/canvas/overlay/StepTimelines.tsx`
- Modify: `src/nodes/orchestrator/OrchestratorNode.tsx`, `src/mission/MissionPanel.tsx` (+ test)

**Interfaces:**
- Consumes: `budgetBar`, `budgetOf`, `spentMin`, `clockText` (Task 1).
- Produces: `useNow(everyMs): number` ; `memberBudgets(nodes, now): Record<string, { spent: number; budget: number }>` ; `BUDGET_COLOR: Record<BudgetTone, string>`.

- [ ] **Step 1: Write the failing tests**

`src/mission/store.test.ts` :

```ts
import { expect, it } from "vitest";
import type { NodeRecord } from "@/store/nodes";
import { NEW_MISSION } from "./mission";
import { memberBudgets } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));

it("gives each agent of a running mission its time and budget, for the bars (spec orchestrateur §8.3)", () => {
  const member = { name: "Isis", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w" };
  const nodes: Record<string, NodeRecord> = {
    chef: {
      workspaceId: "w1",
      kind: "orchestrator",
      payload: { name: "Chef", mission: { ...NEW_MISSION, state: "en_cours", members: [{ ...member, nodeId: "isis", sentAt: 0, extraMin: 5 }, { ...member, nodeId: "horus" }, { ...member, nodeId: "seth", sentAt: 0, handedTo: "Isis" }] } },
    },
    fini: { workspaceId: "w1", kind: "orchestrator", payload: { name: "Fini", mission: { ...NEW_MISSION, state: "terminee", members: [{ ...member, nodeId: "thot", sentAt: 0 }] } } },
  };
  expect(memberBudgets(nodes, 6 * 60_000)).toEqual({ isis: { spent: 6, budget: 15 } });
});
```

(`vi` rejoint l'import de `vitest`.)

`src/canvas/overlay/timeline.test.ts` : `expect(BUDGET_COLOR).toEqual({ ok: "var(--ov-ok)", late: "var(--ov-accent)", over: "var(--ov-danger)" });`.

`src/mission/MissionPanel.test.tsx`, dans le test de l'équipe : le membre a `sentAt: 0` et `report.at: 6 * 60_000` → `expect(host.querySelector('[data-member="Isis"]')?.textContent).toContain("6 / 20 min");`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/mission src/canvas/overlay 2>&1 | tail -10`
Expected: FAIL — `memberBudgets`, `BUDGET_COLOR` introuvables ; pas de temps dans la ligne.

- [ ] **Step 3: Write the display**

`src/lib/useNow.ts` :

```ts
import { useEffect, useState } from "react";

/** The current time, refreshed every `everyMs`: what shows a clock re-renders on its own. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
```

`src/mission/store.ts` (imports `budgetOf, spentMin`) :

```ts
/** The time and budget of each agent of a running mission, by node (spec §8.3). */
export function memberBudgets(nodes: Record<string, NodeRecord>, now: number): Record<string, { spent: number; budget: number }> {
  const budgets: Record<string, { spent: number; budget: number }> = {};
  for (const record of Object.values(nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours") continue;
    for (const m of mission.members) {
      if (m.sentAt !== undefined && !m.handedTo) budgets[m.nodeId] = { spent: spentMin(m, now), budget: budgetOf(m) };
    }
  }
  return budgets;
}
```

`src/canvas/overlay/timeline.ts` :

```ts
/** A budget's bar (spec orchestrateur §8.3): green, orange past 80 %, red past 100 %. */
export const BUDGET_COLOR: Record<BudgetTone, string> = { ok: "var(--ov-ok)", late: "var(--ov-accent)", over: "var(--ov-danger)" };
```

`StepTimelines.tsx` : `const now = useNow(15_000); const budgets = memberBudgets(nodes, now);` ; un nœud a sa frise s'il a des étapes **ou** un budget ; `Timeline` reçoit `budget?: { spent: number; budget: number }` et, s'il est là, dessine en haut de la frise, dans l'écart sous le terminal :

```tsx
      {budget && <BudgetBar {...budgetBar(budget.spent, budget.budget)} title={`${Math.floor(budget.spent)} / ${budget.budget} min`} />}
```

```tsx
/** Time spent over budget, in the gap between the terminal and its steps. */
function BudgetBar({ ratio, tone, title }: { ratio: number; tone: BudgetTone; title: string }) {
  return (
    <div className="absolute inset-x-0 -top-[3px] h-[2px] bg-ov-line" aria-label={title}>
      <div className="h-full" style={{ width: `${ratio * 100}%`, backgroundColor: BUDGET_COLOR[tone] }} />
    </div>
  );
}
```

`OrchestratorNode.tsx` : `const now = useNow(15_000);` et dans l'en-tête, avant l'état de la session, `{record.payload.mission && clockText(record.payload.mission, now) && <span className="font-mono text-[11px] text-ov-text-2" title="Temps passé / budget global">{clockText(record.payload.mission, now)}</span>}`.

`MissionPanel.tsx`, dans `Team` : `const now = useNow(15_000);` et pour chaque membre qui a été envoyé, `<span className="shrink-0 font-mono text-[11px]" style={{ color: BUDGET_COLOR[budgetBar(spent, budget).tone] }}>{Math.floor(spent)} / {budget} min</span>` (avec `spent = spentMin(member, now)`, `budget = budgetOf(member)`) ; un membre dont la sous-tâche est passée à un autre affiche « → <prénom> ».

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -6`
Expected: toute la suite passe.

- [ ] **Step 5: Commit**

```bash
git add src/lib/useNow.ts src/mission src/canvas/overlay src/nodes/orchestrator
git commit -m "feat(mission): budget bars above the friezes, times in the panel and the header"
```

---

### Task 6: Vérification réelle et livraison

- [ ] **Step 1: In the real app** (profil de sonde, dépôt jetable `demo`) — une mission d'un agent nouveau au budget d'une minute, par le client MCP scripté (`proposer_plan` avec `budget_min: 1`) et une sous-tâche un peu plus longue ; vérifier : la barre au-dessus de sa frise (verte puis orange puis rouge), le temps dans l'en-tête et le panneau, la ligne « [dummyPlane] Budget écoulé … » dans l'orchestrateur après une minute, une seule fois ; `prolonger` (refus au-delà du budget global, puis accord) ; `interrompre` sur l'agent au travail ; `reattribuer` à « nouveau » : un agent naît dans le groupe de la mission, reçoit la sous-tâche avec la reprise.
- [ ] **Step 2: Build and hand over** — `pnpm test`, `cargo test --lib`, `pnpm tauri build` ; `dummyPlane-H3.exe` dans `C:\Users\Spectrum\dummyPlane-builds\`, raccourci repointé ; constats dans `BACKLOG.md`.
- [ ] **Step 3: Commit**

```bash
git add BACKLOG.md
git commit -m "docs(backlog): findings of plan H3"
```
