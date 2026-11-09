# dummyPlane — Plan F1 : la palette et la recherche (jalon J8, partie 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un champ « ⌕ Rechercher dans <projet>   Ctrl+P » au centre de la barre de titre et une palette façon VS Code : Ctrl+P « Aller à » (terminaux, groupes, orchestrateurs, workspaces, projets, y compris ceux d'un autre workspace) et Ctrl+Maj+P « Fonctions » (les commandes du registre, avec leur raccourci) ; recherche insensible à la casse et aux accents, approximative.

**Architecture:** La palette est un composant `cmdk` (version figée) monté une fois dans `App`, piloté par un petit magasin (`paletteStore` : ouverte, texte, contexte pris à l'ouverture, focus à rendre). Ses deux modes suivent le texte (`>` → Fonctions). Les éléments d'« Aller à » sont calculés par une fonction pure (`goToItems`) à partir des magasins et des scènes (lues par le cache de scènes existant), classés par une recherche pure (`rank`). Aller vers un élément réutilise l'arrivée de J7 ; un élément d'un autre workspace passe par une arrivée différée, consommée par le canvas une fois sa scène à l'écran. Ctrl+P et Ctrl+Maj+P sont deux commandes du registre de J7. Le catalogue complet des fonctions (spec fenêtre §7.3) vient au plan F2.

**Tech Stack:** React 19, TypeScript (lib ES2020), Zustand 5, `cmdk` 1.1.1 (nouvelle dépendance, version exacte), Excalidraw 0.18.1 (figé), Tauri 2.12, Vitest 5 (happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md` §3, §6.4, §7.1, §7.2, §8, §9, §10 J8, §11, amendée par `docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md` §5.1 (champ de recherche), §5.10 (verre dense), §4.4 (rayon 14 des palettes), §7 (palette sous la barre de titre, à l'aplomb du champ ; zone utile). Découpage décidé avec Mathieu le 2026-10-25 : J8 = F1 (palette, « Aller à », champ de recherche) puis F2 (catalogue des fonctions).

## Global Constraints

- Champ de recherche (spec identité §5.1) : centre de la barre de titre d'un projet, 440 px, « ⌕ Rechercher dans <projet> » et « Ctrl+P » à droite ; un clic ouvre « Aller à ». L'accueil n'a pas de champ (Ctrl+P y marche).
- Palette (spec fenêtre §7.1, spec identité §7 et §4.4) : sous la barre de titre, centrée, largeur 560 px (au plus la fenêtre moins 32 px), verre dense, rayon 14, pas de voile. Un champ, puis les résultats par sections (libellés en majuscules), hauteur au plus 420 px, défilable ; ligne choisie sur `--ov-accent-soft`. Pied : « ↑↓ naviguer · Entrée ouvrir · Échap fermer ».
- Modes (spec fenêtre §7.1) : Ctrl+P « Aller à », champ vide, invite « Aller à un terminal, un groupe, un workspace… (> pour les fonctions) » ; Ctrl+Maj+P « Fonctions », champ prérempli par `> `, invite « Rechercher une fonction… ». Le texte commençant par `>` fait le mode. Palette ouverte, Ctrl+P et Ctrl+Maj+P basculent en gardant la recherche.
- Recherche : insensible à la casse et aux accents (« hermes » trouve Hermès) ; approximative (lettres dans l'ordre) ; début de mot d'abord ; mots-clés en plus du libellé (« isis cl » trouve Isis, agent Claude).
- La première ligne est choisie à l'ouverture et après chaque frappe ; Entrée exécute la ligne choisie, la palette se fermant avant l'exécution ; Échap ou clic hors de la palette la ferment et le clavier revient là où il était.
- « Aller à » (spec fenêtre §7.2) : sections Terminaux, Groupes, Orchestrateurs, Workspaces, Projets ; sans recherche, workspace affiché d'abord puis les autres dans l'ordre des onglets (terminaux dans l'ordre de Ctrl+Tab, groupes et orchestrateurs en ordre de lecture) ; workspaces dans l'ordre des onglets ; autres projets du plus récent au plus ancien ; avec une recherche, la pertinence prime dans chaque section ; mention du workspace seulement pour les autres ; à l'accueil, seulement les projets. Scènes des autres workspaces par `loadScene` ; « Chargement… » tant que des scènes manquent.
- Entrée sur : un terminal → arrivée (§6.4) ; un groupe → vue ajustée sur son cadre (zoom au plus 100 %), clavier au canvas ; un orchestrateur → vue comme l'arrivée, curseur dans son champ de consigne ; un workspace → son onglet ; un projet → il s'ouvre. Élément d'un autre workspace : bascule sur son onglet, attend sa scène, puis l'arrivée.
- Erreurs (spec fenêtre §9) : cible disparue → toast « <nom> n'existe plus » ; scène illisible → ses éléments manquent, toast « Workspace <nom> illisible ».
- La palette n'est pas un dialogue au sens de §6.2 (pas de `data-slot="dialog-content"`) : Ctrl+P et Ctrl+Maj+P y restent actifs.
- Interface en français ; code et commentaires en anglais ; TypeScript lib ES2020.
- Tests : `pnpm test` ; `pnpm exec tsc --noEmit` et `pnpm build` propres ; test ciblé : `pnpm exec vitest run <fichiers>`. Un test qui charge un module atteignant `@excalidraw/excalidraw` à l'exécution le simule (`vi.mock("@excalidraw/excalidraw", () => ({}))`) ; un test qui charge `src/nodes/terminal/registry.ts` le simule. `readSource` (`src/theme/cssBlocks.ts`) pour les assertions sur des sources.
- Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; supprimer les `*.stackdump` avant chaque commit.
- Ne jamais lancer l'exécutable release ni l'installateur depuis la session (l'dummyPlane installé de Mathieu peut tourner : ne jamais le fermer). Vérification sur le profil `dev.dummyplane.probe`, sans souris ni clavier. Après le build : copie dans `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J8a.exe` et raccourci « dummyPlane (dernière build) » repointé.

### Décisions du plan (portées à Mathieu à la remise)

1. **J8 en deux plans** : F1 (palette, « Aller à », champ de recherche) puis F2 (catalogue des fonctions de §7.3). En F1, « Fonctions » liste les commandes déjà au registre (navigation de J7, « Aller à… »).
2. **Pas de champ à l'accueil** : la barre de titre de l'accueil reste celle de §5.9 ; Ctrl+P y ouvre la palette des projets.
3. **Focus robuste** : l'arrivée réessaie de donner le clavier pendant 10 images au plus (une arrivée différée ne part pas d'une touche ; le terminal peut être monté après la première image).
4. **Projets introuvables** : un projet dont le dossier n'existe plus n'est pas proposé (il ne peut pas s'ouvrir).
5. **Orchestrateur** : l'arrivée active aussi l'orchestrateur dans Excalidraw (comme un clic), sans le clignement réservé aux terminaux.

## Review Focus

1. Ctrl+P tapé dans un terminal ouvre la palette sans rien envoyer à l'agent, et Échap rend le clavier à ce terminal (tests : tâche 4 « opens from a shortcut and remembers where the keyboard was », tâche 5 « Escape closes and gives the keyboard back »).
2. Un élément d'un autre workspace fermé entre-temps : toast « <nom> n'existe plus », rien d'autre (test : tâche 3 « says so when the target is gone »).
3. Un workspace dont la scène est illisible : les autres restent listés, toast « Workspace <nom> illisible » (test : tâche 5 « lists the readable workspaces when one is unreadable »).
4. La recherche avec accents, majuscules et lettres non contiguës trouve et classe bien (tests : tâche 1).
5. À l'accueil, seuls les projets (sauf l'ouvert et les introuvables) (tests : tâche 2 « at home, only the projects », tâche 5 « opens on Aller à »).

---

## File Structure

- `src/commands/search.ts` (nouveau) : `normalize`, `matchScore`, `rank` (purs).
- `src/commands/goTo.ts` (nouveau) : `GoToItem`, `goToItems`, `goToSections` (purs).
- `src/canvas/arrive.ts` : focus robuste, orchestrateurs, valeur de retour.
- `src/canvas/canvasFocus.ts` : `focusGroup`.
- `src/commands/reach.ts`, `src/commands/pendingArrival.ts`, `src/commands/goToRun.ts` (nouveaux) : aller vers un élément, ici ou dans un autre workspace.
- `src/canvas/Canvas.tsx` : consommation de l'arrivée différée.
- `src/nodes/orchestrator/OrchestratorNode.tsx` : attribut `data-orchestrator`.
- `src/commands/palette.ts` (nouveau) : magasin de la palette ; `src/commands/registry.ts` : commandes « Aller à… » et « Rechercher une fonction… ».
- `src/commands/functions.ts`, `src/commands/useGoToData.ts`, `src/commands/GoToRow.tsx`, `src/commands/Palette.tsx` (nouveaux) : la palette.
- `src/shell/SearchField.tsx` (nouveau), `src/shell/TitleBar.tsx`, `src/shell/ProjectView.tsx`, `src/App.tsx` : le champ et le montage.

---

### Task 1: La recherche

**Files:**
- Create: `src/commands/search.ts`, `src/commands/search.test.ts`

**Interfaces:**
- Produces: `normalize(text: string): string` ; `matchScore(query: string, label: string, keywords?: readonly string[]): number | null` ; `rank<T>(items: readonly T[], query: string, textOf: (item: T) => { label: string; keywords: readonly string[] }): T[]`.

- [ ] **Step 1: Write the failing test**

`src/commands/search.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { matchScore, normalize, rank } from "./search";

describe("normalize", () => {
  it("drops case and accents", () => {
    expect(normalize("Hermès ÉCOLE")).toBe("hermes ecole");
  });
});

describe("matchScore (spec fenêtre §7.1)", () => {
  it("finds regardless of case and accents, with letters in order, not necessarily together", () => {
    expect(matchScore("hermes", "Hermès")).not.toBeNull();
    expect(matchScore("ISIS", "Isis")).not.toBeNull();
    expect(matchScore("hrms", "Hermès")).not.toBeNull();
    expect(matchScore("smreh", "Hermès")).toBeNull();
  });

  it("reads the keywords too, every term having to match", () => {
    expect(matchScore("isis cl", "Isis", ["Claude", "Backend", "Workspace 1"])).not.toBeNull();
    expect(matchScore("isis co", "Isis", ["Claude"])).toBeNull();
  });

  it("puts a word start before a match inside a word, and the label before the keywords", () => {
    expect(matchScore("th", "Thot")!).toBeGreaterThan(matchScore("th", "Arthur")!);
    expect(matchScore("ba", "Bastet", ["Claude"])!).toBeGreaterThan(matchScore("ba", "Isis", ["Backend"])!);
  });
});

describe("rank", () => {
  const items = [
    { label: "Arthur", keywords: [] },
    { label: "Thot", keywords: [] },
    { label: "Isis", keywords: ["Claude"] },
  ];
  const textOf = (item: { label: string; keywords: string[] }) => item;

  it("keeps every item in its order without a search", () => {
    expect(rank(items, "  ", textOf)).toEqual(items);
  });

  it("keeps the matches only, best first, ties in their order", () => {
    expect(rank(items, "th", textOf).map((i) => i.label)).toEqual(["Thot", "Arthur"]);
    expect(rank(items, "zz", textOf)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/search.test.ts`
Expected: FAIL — `./search` introuvable.

- [ ] **Step 3: Write the search**

`src/commands/search.ts` :

```ts
/** Lower case, accents dropped: « Hermès » and « hermes » are the same (spec fenêtre §7.1). */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const words = (text: string) => normalize(text).split(/[\s\-_/.·]+/).filter(Boolean);

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) if (char === needle[at]) at += 1;
  return at === needle.length;
}

/**
 * How well `query` matches an item (spec fenêtre §7.1), null when a term of
 * the query does not: a term at the start of a word of the label scores
 * best, then of a keyword, then inside a word, then with its letters spread.
 */
export function matchScore(query: string, label: string, keywords: readonly string[] = []): number | null {
  const terms = words(query);
  const labelWords = words(label);
  const allWords = [...labelWords, ...keywords.flatMap(words)];
  const haystack = allWords.join(" ");
  let score = 0;
  for (const term of terms) {
    if (labelWords.some((w) => w.startsWith(term))) score += 4;
    else if (allWords.some((w) => w.startsWith(term))) score += 3;
    else if (haystack.includes(term)) score += 2;
    else if (isSubsequence(term, haystack)) score += 1;
    else return null;
  }
  return score;
}

/** The items matching `query`, best first, ties in their order; every item, in order, without a query. */
export function rank<T>(items: readonly T[], query: string, textOf: (item: T) => { label: string; keywords: readonly string[] }): T[] {
  if (words(query).length === 0) return [...items];
  return items
    .map((item, index) => {
      const { label, keywords } = textOf(item);
      return { item, index, score: matchScore(query, label, keywords) };
    })
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/commands/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/search.ts src/commands/search.test.ts
git commit -m "feat(commands): search without case or accents, word starts first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Les éléments d'« Aller à »

**Files:**
- Create: `src/commands/goTo.ts`, `src/commands/goTo.test.ts`

**Interfaces:**
- Consumes: `rank` (tâche 1) ; `terminalOrder`, `readingOrder` (`src/canvas/terminalOrder.ts`) ; `framesFromScene`, `groupOf`, `isGroup` (`src/canvas/groups.ts`) ; `nodeKindOf` ; `orchestratorLinks` (`src/fleet/wires.ts`) ; `AGENTS` ; `ROLES` (`label`, `color`) ; `readOrchestratorPayload` ; `terminalOf`, `NodeRecord` ; `Project`, `Workspace` (`src/ipc/db.ts`).
- Produces:
  - `type GoToKind = "terminal" | "group" | "orchestrator" | "workspace" | "project"` ;
  - `interface GoToItem { key: string; kind: GoToKind; label: string; keywords: string[]; workspaceId?: string; targetId?: string; projectId?: string; elsewhere?: string; agent?: AgentId; group?: { name: string; color: string }; members?: number; links?: number; live?: number; current?: boolean; path?: string }` ;
  - `interface GoToInput { home: boolean; projects: readonly Project[]; activeProjectId: string | null; workspaces: readonly Workspace[]; activeWorkspaceId: string | null; scenes: Readonly<Record<string, readonly ExcalidrawElement[] | undefined>>; nodes: Readonly<Record<string, NodeRecord>>; live: Readonly<Record<string, number>> }` ;
  - `goToItems(input: GoToInput): GoToItem[]` ; `interface GoToSection { kind: GoToKind; label: string; items: GoToItem[] }` ; `goToSections(items: readonly GoToItem[], query: string): GoToSection[]`.

- [ ] **Step 1: Write the failing test**

`src/commands/goTo.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Project, Workspace } from "@/ipc/db";
import type { NodeRecord } from "@/store/nodes";
import { goToItems, goToSections, type GoToInput } from "./goTo";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 300, height: 200, isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;
const terminal = (id: string, x: number, frameId: string | null = null) =>
  element({ id, type: "embeddable", customData: { kind: "terminal" }, x, y: 40, frameId });
const orchestrator = (id: string) => element({ id, type: "embeddable", customData: { kind: "orchestrator" }, x: 2000, y: 0 });
const group = (id: string, name: string) =>
  element({ id, type: "frame", name, x: 0, y: 0, width: 1400, height: 400, customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } });
const node = (workspaceId: string, name: string, agent = "claude"): NodeRecord =>
  ({ workspaceId, kind: "terminal", payload: { title: name, name, agent, cwd: "C:/code", shell: "default", command: "" } }) as NodeRecord;

const workspaces = [
  { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null },
  { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null },
] as Workspace[];
const projects = [
  { id: "p1", name: "mk-webapp", path: "C:/code/mk-webapp", lastOpenedAt: 3, missing: false },
  { id: "p2", name: "api", path: "C:/code/api", lastOpenedAt: 1, missing: false },
  { id: "p3", name: "site", path: "C:/code/site", lastOpenedAt: 2, missing: false },
  { id: "p4", name: "vieux", path: "C:/code/vieux", lastOpenedAt: 9, missing: true },
] as Project[];

const input = (fields: Partial<GoToInput> = {}): GoToInput => ({
  home: false,
  projects,
  activeProjectId: "p1",
  workspaces,
  activeWorkspaceId: "w2",
  scenes: {
    w1: [terminal("isis", 0), orchestrator("chef")],
    w2: [group("g", "Serveurs"), terminal("thot", 500, "g"), terminal("hermes", 0, "g")],
  },
  nodes: {
    isis: node("w1", "Isis"),
    thot: node("w2", "Thot", "codex"),
    hermes: node("w2", "Hermès"),
    chef: { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef de backend" } } as NodeRecord,
  },
  live: { w1: 1, w2: 2 },
  ...fields,
});

describe("goToItems (spec fenêtre §7.2)", () => {
  it("lists the workspace on screen first, then the others in tab order, terminals in Ctrl+Tab order", () => {
    const items = goToItems(input());
    expect(items.filter((i) => i.kind === "terminal").map((i) => i.label)).toEqual(["Hermès", "Thot", "Isis"]);
    expect(items.map((i) => i.kind)).toEqual(["terminal", "terminal", "terminal", "group", "orchestrator", "workspace", "workspace", "project", "project"]);
  });

  it("names the workspace of an item only when it is not the one on screen", () => {
    const items = goToItems(input());
    expect(items.find((i) => i.label === "Thot")!.elsewhere).toBeUndefined();
    expect(items.find((i) => i.label === "Isis")!.elsewhere).toBe("Workspace 1");
    expect(items.find((i) => i.kind === "orchestrator")!).toMatchObject({ label: "chef de backend", elsewhere: "Workspace 1", targetId: "chef", workspaceId: "w1" });
  });

  it("tells a terminal's agent and group, a group's members, a workspace's live agents and whether it is on screen", () => {
    const items = goToItems(input());
    expect(items.find((i) => i.label === "Thot")).toMatchObject({ agent: "codex", group: { name: "Serveurs" }, targetId: "thot", workspaceId: "w2" });
    expect(items.find((i) => i.label === "Thot")!.keywords).toEqual(expect.arrayContaining(["Codex", "Serveurs", "Backend"]));
    expect(items.find((i) => i.kind === "group")).toMatchObject({ label: "Serveurs", members: 2, targetId: "g" });
    expect(items.filter((i) => i.kind === "workspace").map((i) => [i.label, i.live, i.current])).toEqual([
      ["Workspace 1", 1, false],
      ["Backend", 2, true],
    ]);
  });

  it("offers the other projects, most recently opened first, never one whose folder is gone", () => {
    expect(goToItems(input()).filter((i) => i.kind === "project").map((i) => i.label)).toEqual(["site", "api"]);
  });

  it("lists a workspace's items once its scene is read", () => {
    const items = goToItems(input({ scenes: { w2: input().scenes.w2 } }));
    expect(items.some((i) => i.label === "Isis")).toBe(false);
  });

  it("at home, only the projects", () => {
    const items = goToItems(input({ home: true, activeProjectId: null }));
    expect(items.map((i) => i.label)).toEqual(["mk-webapp", "site", "api"]);
    expect(items[0]).toMatchObject({ kind: "project", projectId: "p1", path: "C:/code/mk-webapp" });
  });
});

describe("goToSections", () => {
  it("puts the items in their sections, in the spec's order, empty sections left out", () => {
    const sections = goToSections(goToItems(input({ home: true, activeProjectId: null })), "");
    expect(sections.map((s) => s.label)).toEqual(["Projets"]);
    expect(goToSections(goToItems(input()), "").map((s) => s.label)).toEqual(["Terminaux", "Groupes", "Orchestrateurs", "Workspaces", "Projets"]);
  });

  it("ranks each section by the search", () => {
    const sections = goToSections(goToItems(input()), "isis cl");
    expect(sections.map((s) => [s.label, s.items.map((i) => i.label)])).toEqual([["Terminaux", ["Isis"]]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/goTo.test.ts`
Expected: FAIL — `./goTo` introuvable.

- [ ] **Step 3: Write the items**

`src/commands/goTo.ts` :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { framesFromScene, groupOf, isGroup } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { readingOrder, terminalOrder } from "@/canvas/terminalOrder";
import { AGENTS } from "@/fleet/catalog";
import { ROLES } from "@/fleet/roles";
import { orchestratorLinks } from "@/fleet/wires";
import type { Project, Workspace } from "@/ipc/db";
import type { AgentId } from "@/ipc/pty";
import { readOrchestratorPayload } from "@/nodes/types";
import { terminalOf, type NodeRecord } from "@/store/nodes";
import { rank } from "./search";

export type GoToKind = "terminal" | "group" | "orchestrator" | "workspace" | "project";

/** A line of « Aller à » (spec fenêtre §7.2). */
export interface GoToItem {
  key: string;
  kind: GoToKind;
  label: string;
  keywords: string[];
  /** The workspace of a node or a group, or the workspace itself. */
  workspaceId?: string;
  /** The node or the group frame to reach. */
  targetId?: string;
  projectId?: string;
  /** The item's workspace, only when it is not the one on screen. */
  elsewhere?: string;
  agent?: AgentId;
  group?: { name: string; color: string };
  members?: number;
  links?: number;
  live?: number;
  current?: boolean;
  path?: string;
}

export const GO_TO_SECTIONS: readonly { kind: GoToKind; label: string }[] = [
  { kind: "terminal", label: "Terminaux" },
  { kind: "group", label: "Groupes" },
  { kind: "orchestrator", label: "Orchestrateurs" },
  { kind: "workspace", label: "Workspaces" },
  { kind: "project", label: "Projets" },
];

export interface GoToInput {
  home: boolean;
  projects: readonly Project[];
  activeProjectId: string | null;
  /** In tab order. */
  workspaces: readonly Workspace[];
  activeWorkspaceId: string | null;
  /** Each workspace's scene; missing while it is read. */
  scenes: Readonly<Record<string, readonly ExcalidrawElement[] | undefined>>;
  nodes: Readonly<Record<string, NodeRecord>>;
  /** Running agents per workspace. */
  live: Readonly<Record<string, number>>;
}

/** The other projects, most recently opened first; a project whose folder is gone cannot open. */
function projectItems(input: GoToInput): GoToItem[] {
  return input.projects
    .filter((p) => p.id !== input.activeProjectId && !p.missing)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .map((p) => ({ key: `project:${p.id}`, kind: "project", label: p.name, keywords: [p.path], projectId: p.id, path: p.path }));
}

/** The items of « Aller à », section by section, in their order without a search (spec fenêtre §7.2). */
export function goToItems(input: GoToInput): GoToItem[] {
  if (input.home) return projectItems(input);
  const onScreenFirst = [...input.workspaces].sort(
    (a, b) => Number(b.id === input.activeWorkspaceId) - Number(a.id === input.activeWorkspaceId),
  );
  const terminals: GoToItem[] = [];
  const groups: GoToItem[] = [];
  const orchestrators: GoToItem[] = [];
  for (const workspace of onScreenFirst) {
    const scene = input.scenes[workspace.id];
    if (!scene) continue;
    const elsewhere = workspace.id === input.activeWorkspaceId ? undefined : workspace.name;
    const frames = framesFromScene(scene);
    for (const id of terminalOrder(scene)) {
      const payload = terminalOf(input.nodes[id]);
      if (!payload) continue;
      const meta = AGENTS[payload.agent];
      const group = groupOf(frames, id);
      terminals.push({
        key: `terminal:${id}`,
        kind: "terminal",
        label: payload.name || meta.label,
        keywords: [meta.label, ...(group ? [group.name] : []), workspace.name],
        workspaceId: workspace.id,
        targetId: id,
        elsewhere,
        agent: payload.agent,
        group: group ? { name: group.name, color: ROLES[group.group.role].color } : undefined,
      });
    }
    for (const frame of readingOrder(frames.filter(isGroup))) {
      const role = ROLES[frame.group.role];
      groups.push({
        key: `group:${frame.id}`,
        kind: "group",
        label: frame.name,
        keywords: ["groupe", role.label, workspace.name],
        workspaceId: workspace.id,
        targetId: frame.id,
        elsewhere,
        group: { name: frame.name, color: role.color },
        members: frame.memberIds.length,
      });
    }
    const links = orchestratorLinks(scene);
    for (const element of readingOrder(scene.filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator"))) {
      const wired = links[element.id];
      orchestrators.push({
        key: `orchestrator:${element.id}`,
        kind: "orchestrator",
        label: readOrchestratorPayload(input.nodes[element.id]?.payload).name,
        keywords: ["orchestrateur", workspace.name],
        workspaceId: workspace.id,
        targetId: element.id,
        elsewhere,
        links: wired ? wired.groupIds.length + wired.nodeIds.length : 0,
      });
    }
  }
  const workspaces = input.workspaces.map(
    (w): GoToItem => ({
      key: `workspace:${w.id}`,
      kind: "workspace",
      label: w.name,
      keywords: ["workspace", "onglet"],
      workspaceId: w.id,
      live: input.live[w.id] ?? 0,
      current: w.id === input.activeWorkspaceId,
    }),
  );
  return [...terminals, ...groups, ...orchestrators, ...workspaces, ...projectItems(input)];
}

export interface GoToSection {
  kind: GoToKind;
  label: string;
  items: GoToItem[];
}

/** The sections of « Aller à », each ranked by the search; empty ones left out. */
export function goToSections(items: readonly GoToItem[], query: string): GoToSection[] {
  return GO_TO_SECTIONS.map(({ kind, label }) => ({ kind, label, items: rank(items.filter((i) => i.kind === kind), query, (i) => i) })).filter(
    (section) => section.items.length > 0,
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/commands/goTo.test.ts`, puis `pnpm exec tsc --noEmit`
Expected: PASS ; aucune erreur.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/goTo.ts src/commands/goTo.test.ts
git commit -m "feat(commands): the items of Aller à, from every workspace of the project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Aller vers un élément, ici ou ailleurs

**Files:**
- Modify: `src/canvas/arrive.ts`, `src/canvas/arrive.test.ts`
- Modify: `src/canvas/canvasFocus.ts`, `src/canvas/canvasFocus.test.ts`
- Create: `src/commands/reach.ts`, `src/commands/pendingArrival.ts`, `src/commands/goToRun.ts`, `src/commands/goToRun.test.ts`
- Modify: `src/canvas/Canvas.tsx` (arrivée différée)
- Modify: `src/nodes/orchestrator/OrchestratorNode.tsx` (attribut)

**Interfaces:**
- Consumes: `GoToItem` (tâche 2) ; `arrive`, `needsMove`, `arrivalView` (J7) ; `releaseToCanvas` ; `focusTerminal` ; `terminalWithKeyboard` ; `workspacesStore.select`, `projectsStore.open`.
- Produces: `arrive(nodeId: string): boolean` (terminal ou orchestrateur ; `false` si absent) ; `focusGroup(frameId: string): boolean` ; `type ReachKind = "terminal" | "group" | "orchestrator"`, `reach(kind: ReachKind, id: string): boolean` ; `interface PendingArrival { workspaceId: string; kind: ReachKind; id: string; label: string }`, `requestArrival(target: PendingArrival): void`, `completeArrival(workspaceId: string): void` ; `goTo(item: GoToItem): void` ; attribut `data-orchestrator="<nodeId>"`.

- [ ] **Step 1: Write the failing tests**

`src/canvas/arrive.test.ts` — la terminale de test devient un vrai nœud terminal, l'orchestrateur est ajouté, et ces tests s'ajoutent au bloc `describe("arrive")` :

remplacer :

```ts
const isis = { id: "isis", x: 100, y: 200, width: 720, height: 440 };
```

par :

```ts
const isis = { id: "isis", type: "embeddable", customData: { kind: "terminal" }, x: 100, y: 200, width: 720, height: 440 };
const chef = { id: "chef", type: "embeddable", customData: { kind: "orchestrator" }, x: 100, y: 200, width: 320, height: 420 };
```

dans `withScene`, `getSceneElements: () => [isis]` devient `getSceneElements: () => [isis, chef]` ; et dans « does nothing for a terminal that is not on the canvas », `arrive("closed");` devient `expect(arrive("closed")).toBe(false);`. Puis ajouter :

```ts
  it("keeps trying to give the keyboard for a few frames: a node shown late still gets it", () => {
    withScene(at100);
    expect(arrive("isis")).toBe(true);
    for (let i = 0; i < 3; i++) frames.shift()!(0);
    expect(vi.mocked(focusTerminal).mock.calls.length).toBe(3);
    // Then it stops trying.
    while (frames.length > 0) frames.shift()!(0);
    expect(vi.mocked(focusTerminal).mock.calls.length).toBe(10);
  });

  it("stops trying once the terminal has the keyboard", () => {
    withScene(at100);
    document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div>';
    vi.mocked(focusTerminal).mockImplementation(() => document.querySelector("textarea")!.focus());
    arrive("isis");
    frames.shift()!(0);
    expect(frames).toHaveLength(0);
    vi.mocked(focusTerminal).mockReset();
    document.body.replaceChildren();
  });

  it("puts the cursor in an orchestrator's field, without the terminals' flash (spec fenêtre §7.2)", () => {
    withScene(at100);
    document.body.innerHTML = '<div data-orchestrator="chef"><textarea></textarea></div>';
    const before = arrivalStore.getState();
    expect(arrive("chef")).toBe(true);
    frames.shift()!(0);
    expect(document.activeElement).toBe(document.querySelector("textarea"));
    expect(focusTerminal).not.toHaveBeenCalled();
    expect(arrivalStore.getState()).toEqual(before);
    document.body.replaceChildren();
  });
```

`src/canvas/canvasFocus.test.ts` — ajouter :

```ts
describe("focusGroup (spec fenêtre §7.2)", () => {
  it("fits the group's frame, at 100 % at most, and gives the keyboard to the canvas", () => {
    const frame = groupFrame("backend");
    withScene([frame]);
    expect(focusGroup("backend")).toBe(true);
    expect(scrollToContent).toHaveBeenCalledWith(frame, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, maxZoom: 1 });
    expect(document.activeElement).toBe(container);
  });

  it("reports a group that is gone", () => {
    withScene([]);
    expect(focusGroup("backend")).toBe(false);
    expect(scrollToContent).not.toHaveBeenCalled();
  });
});
```

(importer `focusGroup` avec `overview`, `overviewTargets`, `releaseToCanvas`.)

`src/commands/goToRun.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { arrive } from "@/canvas/arrive";
import { focusGroup } from "@/canvas/canvasFocus";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import type { GoToItem } from "./goTo";
import { goTo } from "./goToRun";
import { completeArrival } from "./pendingArrival";

vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(() => true) }));
vi.mock("@/canvas/canvasFocus", () => ({ focusGroup: vi.fn(() => true) }));

const select = vi.fn();
const open = vi.fn(() => Promise.resolve());
const item = (fields: Partial<GoToItem>): GoToItem => ({ key: "k", kind: "terminal", label: "Isis", keywords: [], ...fields });

beforeEach(() => {
  vi.mocked(arrive).mockClear().mockReturnValue(true);
  vi.mocked(focusGroup).mockClear().mockReturnValue(true);
  select.mockClear();
  workspacesStore.setState({ activeId: "w1", select } as never);
  projectsStore.setState({ open } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("goTo (spec fenêtre §7.2)", () => {
  it("arrives on a terminal or an orchestrator of the workspace on screen, fits a group", () => {
    goTo(item({ workspaceId: "w1", targetId: "isis" }));
    expect(arrive).toHaveBeenCalledWith("isis");
    goTo(item({ kind: "orchestrator", workspaceId: "w1", targetId: "chef" }));
    expect(arrive).toHaveBeenLastCalledWith("chef");
    goTo(item({ kind: "group", workspaceId: "w1", targetId: "g" }));
    expect(focusGroup).toHaveBeenCalledWith("g");
    expect(select).not.toHaveBeenCalled();
  });

  it("switches to a workspace, opens a project", () => {
    goTo(item({ kind: "workspace", workspaceId: "w2" }));
    expect(select).toHaveBeenCalledWith("w2");
    goTo(item({ kind: "project", projectId: "p2" }));
    expect(open).toHaveBeenCalledWith("p2");
  });

  it("goes to another workspace first, then arrives once its scene is on screen", () => {
    goTo(item({ workspaceId: "w2", targetId: "thot", label: "Thot" }));
    expect(select).toHaveBeenCalledWith("w2");
    expect(arrive).not.toHaveBeenCalled();
    completeArrival("w1");
    expect(arrive).not.toHaveBeenCalled();
    completeArrival("w2");
    expect(arrive).toHaveBeenCalledWith("thot");
    completeArrival("w2");
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it("says so when the target is gone (spec fenêtre §9)", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    vi.mocked(arrive).mockReturnValue(false);
    goTo(item({ workspaceId: "w2", targetId: "isis", label: "Isis" }));
    completeArrival("w2");
    expect(error).toHaveBeenCalledWith("Isis n'existe plus");
    goTo(item({ kind: "group", workspaceId: "w1", targetId: "g", label: "Serveurs" }));
    vi.mocked(focusGroup).mockReturnValue(false);
    goTo(item({ kind: "group", workspaceId: "w1", targetId: "g", label: "Serveurs" }));
    expect(error).toHaveBeenLastCalledWith("Serveurs n'existe plus");
  });

  it("is completed by the canvas of a workspace, and orchestrators are found by their field", () => {
    expect(readSource("canvas/Canvas.tsx")).toContain("completeArrival(workspaceId)");
    expect(readSource("nodes/orchestrator/OrchestratorNode.tsx")).toContain("data-orchestrator={nodeId}");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/canvas/arrive.test.ts src/canvas/canvasFocus.test.ts src/commands/goToRun.test.ts`
Expected: FAIL — `arrive` ne renvoie rien et ne réessaie pas ; `focusGroup`, `./goToRun`, `./pendingArrival` introuvables.

- [ ] **Step 3: Make the arrival robust and open to orchestrators**

`src/canvas/arrive.ts` — ajouter les imports `import { nodeKindOf, type NodeKind } from "./nodeElement";` et `import { terminalWithKeyboard } from "./keyboardFocus";`, puis remplacer la fonction `arrive` (et son commentaire) par :

```ts
/** How many frames the keyboard is offered to an arriving node (plan F1, décision 3). */
const FOCUS_FRAMES = 10;

/**
 * Offers the keyboard on each of the next frames until `focus` succeeds:
 * Excalidraw shows a node that was off screen once the view has moved, and
 * after a workspace switch its terminal may only be mounted a frame later.
 */
function focusSoon(focus: () => boolean, frames = FOCUS_FRAMES) {
  requestAnimationFrame(() => {
    if (!focus() && frames > 1) focusSoon(focus, frames - 1);
  });
}

/** Gives the keyboard to a terminal's xterm, or to an orchestrator's field. */
function focusNodeInput(nodeId: string, kind: NodeKind | null): boolean {
  if (kind === "orchestrator") {
    const field = document.querySelector<HTMLTextAreaElement>(`[data-orchestrator="${nodeId}"] textarea`);
    field?.focus();
    return field !== null && document.activeElement === field;
  }
  focusTerminal(nodeId);
  return terminalWithKeyboard() === nodeId;
}

/**
 * Arrival on a node (spec fenêtre §6.4, §7.2), shared by Ctrl+Tab and Ctrl+P:
 * the view moves only if needed; the node is activated as by a click in its
 * body, without selecting it, and the selection left behind is cleared: the
 * canvas keys (Suppr, arrows) must not act on a node out of sight. A terminal
 * takes the keyboard and flashes; an orchestrator gets the cursor in its
 * field. False when the node is not on the canvas.
 */
export function arrive(nodeId: string): boolean {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return false;
  const app = api.getAppState();
  const view = { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value, width: app.width, height: app.height };
  const move = needsMove(element, view) ? arrivalView(element, view) : {};
  api.updateScene({
    appState: { ...move, activeEmbeddable: { element, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} },
  });
  const kind = nodeKindOf(element);
  focusSoon(() => focusNodeInput(nodeId, kind));
  if (kind === "terminal") signalArrival(nodeId);
  return true;
}
```

`src/canvas/canvasFocus.ts` — ajouter :

```ts
/** A group of « Aller à » (spec fenêtre §7.2): its frame fitted, at 100 % at most, then the keyboard to the canvas. False when it is gone. */
export function focusGroup(frameId: string): boolean {
  const api = canvasStore.getState().api;
  const frame = api?.getSceneElements().find((e) => e.id === frameId && e.type === "frame");
  if (!api || !frame) return false;
  api.scrollToContent(frame, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, maxZoom: 1 });
  releaseToCanvas();
  return true;
}
```

- [ ] **Step 4: Write reaching an item, here or in another workspace**

`src/commands/reach.ts` :

```ts
import { arrive } from "@/canvas/arrive";
import { focusGroup } from "@/canvas/canvasFocus";

export type ReachKind = "terminal" | "group" | "orchestrator";

/** Reaches a node or a group of the workspace on screen; false when it is gone. */
export function reach(kind: ReachKind, id: string): boolean {
  return kind === "group" ? focusGroup(id) : arrive(id);
}
```

`src/commands/pendingArrival.ts` :

```ts
import { toast } from "sonner";
import { reach, type ReachKind } from "./reach";

export interface PendingArrival {
  workspaceId: string;
  kind: ReachKind;
  id: string;
  /** For the message when it is gone. */
  label: string;
}

let pending: PendingArrival | null = null;

/** An item of another workspace: reached once that workspace's scene is on screen (spec fenêtre §7.2). */
export function requestArrival(target: PendingArrival) {
  pending = target;
}

/** Reaches the pending item of `workspaceId`, now on screen; says so when it is gone (spec fenêtre §9). */
export function completeArrival(workspaceId: string) {
  if (!pending || pending.workspaceId !== workspaceId) return;
  const target = pending;
  pending = null;
  if (!reach(target.kind, target.id)) toast.error(`${target.label} n'existe plus`);
}
```

`src/commands/goToRun.ts` :

```ts
import { toast } from "sonner";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import type { GoToItem } from "./goTo";
import { requestArrival } from "./pendingArrival";
import { reach } from "./reach";

/** Entrée on a line of « Aller à » (spec fenêtre §7.2). */
export function goTo(item: GoToItem) {
  const workspaces = workspacesStore.getState();
  switch (item.kind) {
    case "workspace":
      if (item.workspaceId) workspaces.select(item.workspaceId);
      return;
    case "project":
      if (item.projectId) {
        void projectsStore
          .getState()
          .open(item.projectId)
          .catch((error: unknown) => toast.error(`Ouverture impossible : ${String(error)}`));
      }
      return;
    default: {
      if (!item.workspaceId || !item.targetId) return;
      const target = { workspaceId: item.workspaceId, kind: item.kind, id: item.targetId, label: item.label };
      if (item.workspaceId !== workspaces.activeId) {
        requestArrival(target);
        workspaces.select(item.workspaceId);
        return;
      }
      if (!reach(target.kind, target.id)) toast.error(`${target.label} n'existe plus`);
    }
  }
}
```

`src/canvas/Canvas.tsx` — importer `completeArrival` (`import { completeArrival } from "@/commands/pendingArrival";`) et, dans `LoadedCanvas`, après l'effet qui publie `api` dans `canvasStore` :

```tsx
  // A Ctrl+P target of this workspace waits for its scene to be on screen (spec fenêtre §7.2).
  useEffect(() => {
    if (!api) return;
    const frame = requestAnimationFrame(() => completeArrival(workspaceId));
    return () => cancelAnimationFrame(frame);
  }, [api, workspaceId]);
```

`src/nodes/orchestrator/OrchestratorNode.tsx` — la racine du nœud porte son identifiant ; remplacer :

```tsx
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ov-surface-2" style={frameStyle("var(--ov-accent)", selected, false)}>
```

par :

```tsx
    <div
      data-orchestrator={nodeId}
      className="flex h-full flex-col overflow-hidden rounded-xl bg-ov-surface-2"
      style={frameStyle("var(--ov-accent)", selected, false)}
    >
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/canvas/arrive.test.ts src/canvas/canvasFocus.test.ts src/commands/goToRun.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
rm -f *.stackdump
git add src/canvas/arrive.ts src/canvas/arrive.test.ts src/canvas/canvasFocus.ts src/canvas/canvasFocus.test.ts src/commands/reach.ts src/commands/pendingArrival.ts src/commands/goToRun.ts src/commands/goToRun.test.ts src/canvas/Canvas.tsx src/nodes/orchestrator/OrchestratorNode.tsx
git commit -m "feat(commands): reach a terminal, group, orchestrator, workspace or project, here or elsewhere

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: L'état de la palette et ses raccourcis

**Files:**
- Create: `src/commands/palette.ts`, `src/commands/palette.test.ts`
- Modify: `src/commands/registry.ts`, `src/commands/registry.test.ts`

**Interfaces:**
- Consumes: `CommandContext`, `Command` (J7).
- Produces: `type PaletteMode = "goTo" | "functions"` ; `paletteStore` (`{ open: boolean; query: string; context: CommandContext | null; returnFocus: HTMLElement | null }`), `usePalette(selector)` ; `modeOf(query: string): PaletteMode` ; `stripPrefix(query: string): string` ; `openPalette(mode: PaletteMode, context: CommandContext): void` ; `setPaletteQuery(query: string): void` ; `closePalette(): void` ; commandes `palette.goTo` (« Aller à… », Ctrl+P) et `palette.functions` (« Rechercher une fonction… », Ctrl+Maj+P), toujours disponibles.

- [ ] **Step 1: Write the failing tests**

`src/commands/palette.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandContext } from "./command";
import { closePalette, modeOf, openPalette, paletteStore, setPaletteQuery, stripPrefix } from "./palette";

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 2, terminalId: "isis" };

beforeEach(() => paletteStore.setState({ open: false, query: "", context: null, returnFocus: null }));
afterEach(() => document.body.replaceChildren());

describe("the palette (spec fenêtre §7.1)", () => {
  it("follows its text: > makes the functions mode", () => {
    expect(modeOf("")).toBe("goTo");
    expect(modeOf("isis")).toBe("goTo");
    expect(modeOf("> pause")).toBe("functions");
    expect(modeOf("  >pause")).toBe("functions");
    expect(stripPrefix("> pause")).toBe("pause");
    expect(stripPrefix("isis")).toBe("isis");
  });

  it("opens from a shortcut and remembers where the keyboard was, and the context of the moment", () => {
    document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div>';
    const xterm = document.querySelector("textarea")!;
    xterm.focus();
    openPalette("goTo", ctx);
    expect(paletteStore.getState()).toMatchObject({ open: true, query: "", context: ctx, returnFocus: xterm });
    closePalette();
    openPalette("functions", ctx);
    expect(paletteStore.getState().query).toBe("> ");
  });

  it("switches mode when open, keeping the search", () => {
    openPalette("goTo", ctx);
    setPaletteQuery("thot");
    openPalette("functions", ctx);
    expect(paletteStore.getState().query).toBe("> thot");
    openPalette("goTo", ctx);
    expect(paletteStore.getState().query).toBe("thot");
  });

  it("gives the keyboard back where it was when it closes", () => {
    document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div><input />';
    const xterm = document.querySelector("textarea")!;
    xterm.focus();
    openPalette("goTo", ctx);
    document.querySelector("input")!.focus();
    closePalette();
    expect(paletteStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(xterm);
  });
});
```

`src/commands/registry.test.ts` — l'attente du premier test devient :

```ts
    expect(COMMANDS.map((c) => [c.label, c.shortcut])).toEqual([
      ["Terminal suivant", "Ctrl+Tab"],
      ["Terminal précédent", "Ctrl+Maj+Tab"],
      ["Rendre la main au canvas", "Maj+Échap"],
      ["Vue d'ensemble", "Ctrl+Maj+A"],
      ["Aller à…", "Ctrl+P"],
      ["Rechercher une fonction…", "Ctrl+Maj+P"],
    ]);
```

celle du deuxième :

```ts
    expect(available(home)).toEqual(["palette.goTo", "palette.functions"]);
    expect(available(empty)).toEqual(["canvas.release", "canvas.overview", "palette.goTo", "palette.functions"]);
    expect(available(busy)).toEqual(["terminal.next", "terminal.previous", "canvas.release", "canvas.overview", "palette.goTo", "palette.functions"]);
```

et ce test s'ajoute au `describe("the registry …")` :

```ts
  it("opens the palette from anywhere, in either mode", async () => {
    await command("palette.functions").run(home);
    expect(paletteStore.getState()).toMatchObject({ open: true, query: "> ", context: home });
    await command("palette.goTo").run(home);
    expect(paletteStore.getState().query).toBe("");
    paletteStore.setState({ open: false });
  });
```

(importer `paletteStore` depuis `./palette`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/palette.test.ts src/commands/registry.test.ts`
Expected: FAIL — `./palette` introuvable ; registre sans les commandes de la palette.

- [ ] **Step 3: Write the palette's state**

`src/commands/palette.ts` :

```ts
import { createStore, useStore } from "zustand";
import type { CommandContext } from "./command";

export type PaletteMode = "goTo" | "functions";

interface PaletteState {
  open: boolean;
  /** The field's text; `>` first makes the functions mode (spec fenêtre §7.1). */
  query: string;
  /** Taken when it opened: the functions are listed for that moment (spec fenêtre §7.3). */
  context: CommandContext | null;
  /** Where the keyboard was when it opened, and goes back when it closes. */
  returnFocus: HTMLElement | null;
}

export const paletteStore = createStore<PaletteState>()(() => ({ open: false, query: "", context: null, returnFocus: null }));

export function usePalette<T>(selector: (state: PaletteState) => T): T {
  return useStore(paletteStore, selector);
}

export function modeOf(query: string): PaletteMode {
  return query.trimStart().startsWith(">") ? "functions" : "goTo";
}

/** The search itself, without the functions' `>`. */
export function stripPrefix(query: string): string {
  return query.replace(/^\s*>\s?/, "");
}

/** Ctrl+P and Ctrl+Maj+P: opens the palette, or switches its mode keeping the search. */
export function openPalette(mode: PaletteMode, context: CommandContext) {
  const state = paletteStore.getState();
  const search = state.open ? stripPrefix(state.query) : "";
  const query = mode === "functions" ? `> ${search}` : search;
  if (state.open) {
    paletteStore.setState({ query });
    return;
  }
  const active = document.activeElement;
  paletteStore.setState({ open: true, query, context, returnFocus: active instanceof HTMLElement ? active : null });
}

export function setPaletteQuery(query: string) {
  paletteStore.setState({ query });
}

/** Closes it; the keyboard goes back where it was when it opened (spec fenêtre §7.1). */
export function closePalette() {
  const { returnFocus } = paletteStore.getState();
  paletteStore.setState({ open: false, query: "", context: null, returnFocus: null });
  if (returnFocus?.isConnected) returnFocus.focus();
}
```

`src/commands/registry.ts` — importer `openPalette` (`import { openPalette } from "./palette";`) et ajouter à la fin de `COMMANDS` :

```ts
  {
    id: "palette.goTo",
    label: "Aller à…",
    section: "Navigation",
    keywords: ["chercher", "rechercher", "terminal", "groupe", "workspace", "projet"],
    shortcut: "Ctrl+P",
    available: () => true,
    run: (ctx) => openPalette("goTo", ctx),
  },
  {
    id: "palette.functions",
    label: "Rechercher une fonction…",
    section: "Navigation",
    keywords: ["fonction", "commande", "action"],
    shortcut: "Ctrl+Maj+P",
    available: () => true,
    run: (ctx) => openPalette("functions", ctx),
  },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm exec vitest run src/commands/palette.test.ts src/commands/registry.test.ts src/commands/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/palette.ts src/commands/palette.test.ts src/commands/registry.ts src/commands/registry.test.ts
git commit -m "feat(commands): the palette's state, opened by Ctrl+P and Ctrl+Maj+P

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: La palette

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`cmdk` 1.1.1, version exacte)
- Create: `src/commands/functions.ts`, `src/commands/functions.test.ts`
- Create: `src/commands/useGoToData.ts`, `src/commands/GoToRow.tsx`
- Create: `src/commands/Palette.tsx`, `src/commands/Palette.test.tsx`

**Interfaces:**
- Consumes: `goToItems`, `goToSections`, `GoToItem` (tâche 2) ; `goTo` (tâche 3) ; `usePalette`, `modeOf`, `stripPrefix`, `setPaletteQuery`, `closePalette` (tâche 4) ; `COMMANDS`, `runCommand`, `Command`, `CommandContext` (J7) ; `rank` (tâche 1) ; `loadScene` ; `countRunning` (`src/store/running.ts`) ; `StatusPill` ; `AGENTS`, `agentInk`, `INDIGO` ; `TITLE_BAR_HEIGHT`.
- Produces: `functionSections(commands: readonly Command[], ctx: CommandContext, query: string): { label: string; items: Command[] }[]` ; `useGoToData(): { items: GoToItem[]; loading: boolean }` ; `GoToRow({ item })` ; `Palette()`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add -E cmdk@1.1.1`
Expected: `cmdk` 1.1.1 dans `dependencies` de `package.json`, sans `^`.

- [ ] **Step 2: Write the failing tests**

`src/commands/functions.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { Command, CommandContext } from "./command";
import { functionSections } from "./functions";

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: null };
const command = (id: string, label: string, section: string, available = true): Command => ({
  id,
  label,
  section,
  keywords: [],
  available: () => available,
  run: () => undefined,
});

describe("functionSections (spec fenêtre §7.3)", () => {
  const commands = [
    command("terminal.next", "Terminal suivant", "Navigation"),
    command("workspace.new", "Nouveau workspace", "Workspaces"),
    command("terminal.pause", "Mettre en pause", "Terminal · Isis", false),
    command("canvas.overview", "Vue d'ensemble", "Navigation"),
    command("palette.functions", "Rechercher une fonction…", "Navigation"),
  ];

  it("lists the available functions by section, in the registry's order, without itself", () => {
    expect(functionSections(commands, ctx, "").map((s) => [s.label, s.items.map((c) => c.label)])).toEqual([
      ["Navigation", ["Terminal suivant", "Vue d'ensemble"]],
      ["Workspaces", ["Nouveau workspace"]],
    ]);
  });

  it("ranks each section by the search", () => {
    expect(functionSections(commands, ctx, "ens").map((s) => [s.label, s.items.map((c) => c.label)])).toEqual([["Navigation", ["Vue d'ensemble"]]]);
  });
});
```

`src/commands/Palette.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import type { CommandContext } from "./command";
import { goTo } from "./goToRun";
import { openPalette, paletteStore, setPaletteQuery } from "./palette";
import { Palette } from "./Palette";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));
vi.mock("./goToRun", () => ({ goTo: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const home: CommandContext = { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "isis" };
let host: HTMLDivElement;
let root: Root;

const projects = [
  { id: "p1", name: "mk-webapp", path: "C:/code/mk-webapp", lastOpenedAt: 1, missing: false },
  { id: "p2", name: "api", path: "C:/code/api", lastOpenedAt: 5, missing: false },
];

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.mocked(goTo).mockClear();
  projectsStore.setState({ view: "home", projects, activeId: null } as never);
  paletteStore.setState({ open: false, query: "", context: null, returnFocus: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Palette />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  clearMocks();
  vi.restoreAllMocks();
});

const items = () => [...document.querySelectorAll<HTMLElement>("[cmdk-item]")];
const selected = () => document.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
const input = () => document.querySelector<HTMLInputElement>("[cmdk-input]")!;
const press = (key: string) => input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("the palette (spec fenêtre §7.1, §7.2)", () => {
  it("opens on « Aller à », the first line chosen; at home, the projects, most recent first", async () => {
    await act(async () => openPalette("goTo", home));
    expect(input().placeholder).toBe("Aller à un terminal, un groupe, un workspace… (> pour les fonctions)");
    expect(items().map((i) => i.textContent)).toEqual(["apiC:/code/api", "mk-webappC:/code/mk-webapp"]);
    expect(selected()).toBe(items()[0]);
    expect(document.body.textContent).toContain("↑↓ naviguer · Entrée ouvrir · Échap fermer");
  });

  it("chooses the first line again after each keystroke, and Entrée closes before going there", async () => {
    await act(async () => openPalette("goTo", home));
    await act(async () => setPaletteQuery("mk"));
    expect(selected()!.textContent).toContain("mk-webapp");
    await act(async () => press("Enter"));
    expect(paletteStore.getState().open).toBe(false);
    expect(goTo).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", projectId: "p1" }));
  });

  it("Escape closes and gives the keyboard back where it was", async () => {
    const xterm = document.createElement("textarea");
    document.body.append(xterm);
    xterm.focus();
    await act(async () => openPalette("goTo", home));
    expect(document.activeElement).toBe(input());
    await act(async () => press("Escape"));
    expect(paletteStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(xterm);
  });

  it("closes on a click outside, with no veil on the app", async () => {
    await act(async () => openPalette("goTo", home));
    const backdrop = document.querySelector<HTMLElement>("[data-palette-backdrop]")!;
    expect(backdrop.className).not.toMatch(/bg-/);
    await act(async () => backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(paletteStore.getState().open).toBe(false);
  });

  it("lists the functions available at that moment, with their shortcut, under > ", async () => {
    await act(async () => openPalette("functions", busy));
    expect(input().value).toBe("> ");
    const rows = items().map((i) => i.textContent);
    expect(rows).toContain("Terminal suivantCtrl+Tab");
    expect(rows).toContain("Aller à…Ctrl+P");
    expect(rows.some((r) => r?.startsWith("Rechercher une fonction"))).toBe(false);
  });

  it("lists the readable workspaces when one is unreadable (spec fenêtre §9)", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    mockIPC((cmd, args) => {
      if (cmd === "load_workspace" && (args as { id: string }).id === "w2") throw new Error("corrompu");
      return undefined;
    });
    await nodesStore.getState().create("isis", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
    const isis = { id: "isis", type: "embeddable", customData: { kind: "terminal" }, x: 0, y: 0, width: 300, height: 200, isDeleted: false, frameId: null };
    canvasStore.setState({ api: { getSceneElements: () => [isis] } as unknown as ExcalidrawImperativeAPI });
    projectsStore.setState({ view: "project", activeId: "p1" } as never);
    workspacesStore.setState({
      workspaces: [
        { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null },
        { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null },
      ],
      activeId: "w1",
    } as never);
    await act(async () => openPalette("goTo", busy));
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(error).toHaveBeenCalledWith("Workspace Backend illisible");
    expect(items()[0].textContent).toContain("Isis");
    expect(document.body.textContent).not.toContain("Chargement…");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/functions.test.ts src/commands/Palette.test.tsx`
Expected: FAIL — `./functions`, `./Palette` introuvables.

- [ ] **Step 4: Write the functions' sections and the data of « Aller à »**

`src/commands/functions.ts` :

```ts
import type { Command, CommandContext } from "./command";
import { rank } from "./search";

/**
 * The functions mode (spec fenêtre §7.3): the commands available at that
 * moment, by section in the registry's order, each ranked by the search. The
 * palette's own command is not listed in it.
 */
export function functionSections(commands: readonly Command[], ctx: CommandContext, query: string): { label: string; items: Command[] }[] {
  const listed = commands.filter((c) => c.id !== "palette.functions" && c.available(ctx));
  const labels: string[] = [];
  for (const command of listed) if (!labels.includes(command.section)) labels.push(command.section);
  return labels
    .map((label) => ({
      label,
      items: rank(
        listed.filter((c) => c.section === label),
        query,
        (c) => ({ label: c.label, keywords: c.keywords }),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
```

`src/commands/useGoToData.ts` :

```ts
import { useEffect, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { toast } from "sonner";
import { useStore } from "zustand";
import { canvasStore } from "@/canvas/canvasStore";
import { loadScene } from "@/canvas/sceneCache";
import { useNodes } from "@/store/nodes";
import { useProjects } from "@/store/projects";
import { countRunning } from "@/store/running";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useWorkspaces } from "@/store/workspaces";
import { goToItems, type GoToItem } from "./goTo";

/**
 * The items of « Aller à » for the palette that just opened (spec fenêtre
 * §7.2): the scene on screen as it is, the other workspaces' scenes read by
 * the scene cache (one SQLite read per workspace and session); their lines
 * come as they are read. An unreadable scene leaves its items out.
 */
export function useGoToData(): { items: GoToItem[]; loading: boolean } {
  const view = useProjects((s) => s.view);
  const projects = useProjects((s) => s.projects);
  const activeProjectId = useProjects((s) => s.activeId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const [scenes, setScenes] = useState<Record<string, readonly ExcalidrawElement[]>>({});
  const home = view !== "project";

  useEffect(() => {
    if (home) return;
    let alive = true;
    const keep = (id: string, elements: readonly ExcalidrawElement[]) => alive && setScenes((s) => ({ ...s, [id]: elements }));
    const api = canvasStore.getState().api;
    for (const workspace of workspaces) {
      if (workspace.id === activeWorkspaceId && api) {
        keep(workspace.id, api.getSceneElements());
        continue;
      }
      loadScene(workspace.id).then(
        (scene) => keep(workspace.id, scene.initialData.elements ?? []),
        () => {
          if (!alive) return;
          toast.error(`Workspace ${workspace.name} illisible`);
          keep(workspace.id, []);
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [home, workspaces, activeWorkspaceId]);

  const live = Object.fromEntries(workspaces.map((w) => [w.id, countRunning(nodes, statuses, [w.id])]));
  const items = goToItems({ home, projects, activeProjectId, workspaces, activeWorkspaceId, scenes, nodes, live });
  return { items, loading: !home && workspaces.some((w) => !(w.id in scenes)) };
}
```

`src/commands/GoToRow.tsx` :

```tsx
import { Folder, Layers, LayoutGrid, Network } from "lucide-react";
import { agentInk, AGENTS, INDIGO } from "@/fleet/catalog";
import { plural } from "@/lib/format";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import { useActivity } from "@/store/agentActivity";
import { useTerminalStatus } from "@/store/terminalStatus";
import type { GoToItem } from "./goTo";

const Elsewhere = ({ item }: { item: GoToItem }) =>
  item.elsewhere ? <span className="shrink-0 text-ov-text-3">{item.elsewhere}</span> : null;

function TerminalLine({ item }: { item: GoToItem }) {
  const id = item.targetId ?? "";
  const status = useTerminalStatus(id);
  const activity = useActivity(id);
  const meta = AGENTS[item.agent ?? "shell"];
  return (
    <>
      <span
        className="grid size-5 shrink-0 place-items-center rounded-[5px]"
        style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: agentInk(meta.tint) }}
      >
        <meta.Icon className="size-3" />
      </span>
      <span className="truncate font-medium text-ov-text">{item.label}</span>
      <span className="shrink-0 text-ov-text-2">{meta.label}</span>
      {item.group && (
        <span className="flex shrink-0 items-center gap-1 text-ov-text-2">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: item.group.color }} />
          {item.group.name}
        </span>
      )}
      <Elsewhere item={item} />
      <span className="ml-auto shrink-0">
        <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} />
      </span>
    </>
  );
}

/** A line of « Aller à » (spec fenêtre §7.2). */
export function GoToRow({ item }: { item: GoToItem }) {
  switch (item.kind) {
    case "terminal":
      return <TerminalLine item={item} />;
    case "group":
      return (
        <>
          <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.group?.color }} />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="shrink-0 text-ov-text-2">{plural(item.members ?? 0, "agent", "agents")}</span>
          <Elsewhere item={item} />
          <Layers className="ml-auto size-3.5 shrink-0 text-ov-text-3" />
        </>
      );
    case "orchestrator":
      return (
        <>
          <Network className="size-3.5 shrink-0 text-ov-accent" />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="shrink-0 text-ov-text-2">relié à {item.links ?? 0}</span>
          <Elsewhere item={item} />
        </>
      );
    case "workspace":
      return (
        <>
          <LayoutGrid className="size-3.5 shrink-0 text-ov-text-2" />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="shrink-0 font-mono text-[11px] text-ov-text-2">{plural(item.live ?? 0, "actif", "actifs")}</span>
          {item.current && <span className="ml-auto shrink-0 text-ov-text-3">affiché</span>}
        </>
      );
    case "project":
      return (
        <>
          <Folder className="size-3.5 shrink-0 text-ov-text-2" />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="ml-auto truncate font-mono text-[11px] text-ov-text-3">{item.path}</span>
        </>
      );
  }
}
```

(Le test vérifie « apiC:/code/api » : la ligne projet ne contient que le nom et le chemin.)

- [ ] **Step 5: Write the palette**

`src/commands/Palette.tsx` :

```tsx
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { TITLE_BAR_HEIGHT } from "@/shell/layout";
import { runCommand } from "./command";
import { functionSections } from "./functions";
import { goToSections } from "./goTo";
import { GoToRow } from "./GoToRow";
import { goTo } from "./goToRun";
import { closePalette, modeOf, setPaletteQuery, stripPrefix, usePalette } from "./palette";
import { COMMANDS } from "./registry";
import { useGoToData } from "./useGoToData";

// Section titles like `.ov-label` (a component class takes no variant in Tailwind 4).
const HEADING =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-ov-text-2";
const ITEM =
  "flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[12.5px] text-ov-text-2 data-[selected=true]:bg-ov-accent-soft";

/** The palette (spec fenêtre §7.1), under the title bar, centered; rendered only while open. */
export function Palette() {
  const open = usePalette((s) => s.open);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const query = usePalette((s) => s.query);
  const context = usePalette((s) => s.context);
  const mode = modeOf(query);
  const search = stripPrefix(query);
  const goToData = useGoToData();
  const goToList = mode === "goTo" ? goToSections(goToData.items, search) : [];
  const functionList = mode === "functions" && context ? functionSections(COMMANDS, context, search) : [];
  const keys = mode === "goTo" ? goToList.flatMap((s) => s.items.map((i) => i.key)) : functionList.flatMap((s) => s.items.map((c) => c.id));
  const [chosen, setChosen] = useState("");
  // The first line is chosen when it opens and after each keystroke (spec fenêtre §7.1).
  useEffect(() => setChosen(""), [query]);
  const value = keys.includes(chosen) ? chosen : (keys[0] ?? "");

  return (
    <div data-palette-backdrop className="fixed inset-0 z-50" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div
        className="ov-glass-strong absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-[14px]"
        style={{ top: TITLE_BAR_HEIGHT + 6, width: "min(560px, calc(100vw - 32px))", boxShadow: "var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-shadow)" }}
      >
        <Command
          label="Palette"
          shouldFilter={false}
          loop
          value={value}
          onValueChange={setChosen}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closePalette();
            }
          }}
        >
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setPaletteQuery}
            placeholder={mode === "goTo" ? "Aller à un terminal, un groupe, un workspace… (> pour les fonctions)" : "Rechercher une fonction…"}
            className="h-11 w-full border-b border-ov-line bg-transparent px-3.5 text-[13.5px] text-ov-text outline-none placeholder:text-ov-text-3"
          />
          <Command.List className={`max-h-[420px] overflow-y-auto p-1.5 ${HEADING}`}>
            {mode === "goTo" &&
              goToList.map((section) => (
                <Command.Group key={section.kind} heading={section.label}>
                  {section.items.map((item) => (
                    <Command.Item
                      key={item.key}
                      value={item.key}
                      className={ITEM}
                      onSelect={() => {
                        closePalette();
                        goTo(item);
                      }}
                    >
                      <GoToRow item={item} />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            {mode === "functions" &&
              context &&
              functionList.map((section) => (
                <Command.Group key={section.label} heading={section.label}>
                  {section.items.map((command) => (
                    <Command.Item
                      key={command.id}
                      value={command.id}
                      className={ITEM}
                      onSelect={() => {
                        closePalette();
                        runCommand(command, context);
                      }}
                    >
                      <span className="truncate text-ov-text">{command.label}</span>
                      {command.shortcut && <span className="ml-auto shrink-0 font-mono text-[11px] text-ov-text-3">{command.shortcut}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            {mode === "goTo" && goToData.loading && <div className="px-2.5 py-1.5 text-[11.5px] text-ov-text-3">Chargement…</div>}
            <Command.Empty className="px-2.5 py-3 text-[12.5px] text-ov-text-3">Aucun résultat</Command.Empty>
          </Command.List>
          <footer className="border-t border-ov-line px-3.5 py-1.5 text-[11px] text-ov-text-2">↑↓ naviguer · Entrée ouvrir · Échap fermer</footer>
        </Command>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands/functions.test.ts src/commands/Palette.test.tsx`
Expected: PASS. (Si `cmdk` réclame une API absente de happy-dom — `scrollIntoView`, `ResizeObserver` — la doubler dans le test (`Element.prototype.scrollIntoView = () => undefined`) et le noter au journal.)

- [ ] **Step 7: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 8: Commit**

```bash
rm -f *.stackdump
git add package.json pnpm-lock.yaml src/commands/functions.ts src/commands/functions.test.ts src/commands/useGoToData.ts src/commands/GoToRow.tsx src/commands/Palette.tsx src/commands/Palette.test.tsx
git commit -m "feat(commands): the palette, Aller à and functions, in dense glass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Le champ de recherche et le montage

**Files:**
- Create: `src/shell/SearchField.tsx`, `src/shell/SearchField.test.tsx`
- Modify: `src/shell/TitleBar.tsx`, `src/shell/TitleBar.test.tsx`
- Modify: `src/shell/ProjectView.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `openPalette` (tâche 4), `commandContext` (J7), `Palette` (tâche 5).
- Produces: `SearchField()` ; `TitleBar({ leading, center, trailing }: { leading: ReactNode; center?: ReactNode; trailing?: ReactNode })`.

- [ ] **Step 1: Write the failing tests**

`src/shell/SearchField.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { paletteStore } from "@/commands/palette";
import { projectsStore } from "@/store/projects";
import { readSource } from "@/theme/cssBlocks";
import { SearchField } from "./SearchField";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockIPC(() => undefined);
  paletteStore.setState({ open: false, query: "", context: null, returnFocus: null });
  projectsStore.setState({ projects: [{ id: "p1", name: "mk-webapp", path: "C:/code/mk-webapp" }], activeId: "p1" } as never);
});
afterEach(() => {
  clearMocks();
  document.body.replaceChildren();
});

it("names the project and its shortcut, and opens « Aller à » (spec identité §5.1)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SearchField />));
  const field = host.querySelector("button")!;
  expect(field.textContent).toContain("Rechercher dans mk-webapp");
  expect(field.textContent).toContain("Ctrl+P");
  expect(field.className).toContain("w-[440px]");
  // A press does not take the keyboard: it goes back where it was when the palette closes.
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  field.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  await act(async () => field.click());
  expect(paletteStore.getState()).toMatchObject({ open: true, query: "" });
  await act(async () => root.unmount());
});

it("sits in the project's title bar, the palette being mounted once for the whole app", () => {
  expect(readSource("shell/ProjectView.tsx")).toContain("center={<SearchField />}");
  expect(readSource("App.tsx")).toContain("<Palette />");
});
```

`src/shell/TitleBar.test.tsx` — ajouter :

```tsx
it("centers its middle element on the window, which does not drag", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TitleBar leading={<span>dummyPlane</span>} center={<button type="button">Rechercher</button>} />));
  const center = [...host.querySelectorAll("button")].find((b) => b.textContent === "Rechercher")!;
  expect(center.parentElement!.className).toContain("left-1/2");
  expect(center.closest("[data-tauri-drag-region]")).toBe(host.firstElementChild);
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/shell/SearchField.test.tsx src/shell/TitleBar.test.tsx`
Expected: FAIL — `./SearchField` introuvable ; `TitleBar` sans `center`.

- [ ] **Step 3: Write the field and mount the palette**

`src/shell/SearchField.tsx` :

```tsx
import { Search } from "lucide-react";
import { openPalette } from "@/commands/palette";
import { commandContext } from "@/commands/registry";
import { useProjects } from "@/store/projects";

/** « ⌕ Rechercher dans <projet>   Ctrl+P » at the center of the title bar (spec identité §5.1): it opens « Aller à ». */
export function SearchField() {
  const name = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.name ?? "");
  return (
    <button
      type="button"
      // The keyboard stays where it is: it goes back there when the palette closes.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openPalette("goTo", commandContext())}
      className="flex h-[26px] w-[440px] max-w-[34vw] items-center gap-2 rounded-[8px] border border-ov-glass-line bg-ov-field px-2.5 text-[12.5px] text-ov-text-3 transition-colors hover:text-ov-text-2"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="truncate">Rechercher dans {name}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px]">Ctrl+P</span>
    </button>
  );
}
```

`src/shell/TitleBar.tsx` (fichier complet) :

```tsx
import type { ReactNode } from "react";
import { TITLE_BAR_HEIGHT } from "./layout";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";

/**
 * The title bar (spec identité §5.1): the logo, `leading` (the project picker,
 * or the app's name), `center` (the search field) centered on the window, a
 * spacer, `trailing` (the agent counts), the window buttons in the corner.
 * The bar and its spacer carry Tauri's bare drag attribute: a click aimed at
 * them moves the window, a double-click maximizes it; a click on any button
 * inside does not.
 */
export function TitleBar({ leading, center, trailing }: { leading: ReactNode; center?: ReactNode; trailing?: ReactNode }) {
  return (
    <div
      data-tauri-drag-region=""
      className="ov-glass-strong relative flex w-full shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 pl-3"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      <Logo />
      {leading}
      <div data-tauri-drag-region="" className="h-full flex-1" />
      {center && <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{center}</div>}
      {trailing}
      <WindowControls />
    </div>
  );
}
```

`src/shell/ProjectView.tsx` — importer `SearchField` (`import { SearchField } from "./SearchField";`) et passer le champ à la barre de titre :

```tsx
        <TitleBar leading={<ProjectPicker />} center={<SearchField />} trailing={<AgentCounts />} />
```

`src/App.tsx` — importer `Palette` (`import { Palette } from "@/commands/Palette";`) et la monter une fois, avant `AppToaster` :

```tsx
      <Palette />
      <AppToaster />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/shell/SearchField.test.tsx src/shell/TitleBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/shell/SearchField.tsx src/shell/SearchField.test.tsx src/shell/TitleBar.tsx src/shell/TitleBar.test.tsx src/shell/ProjectView.tsx src/App.tsx
git commit -m "feat(shell): the search field in the title bar, the palette mounted once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Vérification et livraison

**Files:**
- Aucun (sauf correctif né d'un constat, avec son test d'abord rouge et une décision au journal).

**Interfaces:**
- Consumes: tâches 1 à 6.
- Produces: `src-tauri/target/release/bundle/nsis/dummyPlane_0.1.0_x64-setup.exe` ; `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J8a.exe` ; raccourci « dummyPlane (dernière build) » repointé.

- [ ] **Step 1: Check the field on the probe profile**

L'application de développement de la sonde fermée (`crisp\closedev.ps1`, qui ne vise que `target\debug`), lancer `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'` en arrière-plan, attendre une fenêtre dont l'exécutable est `…\target\debug\dummyplane.exe` et le titre « dummyPlane — … », la capturer (`crisp\printwin.ps1 -Out …`), puis la fermer.
Expected : le champ « ⌕ Rechercher dans mk-webapp   Ctrl+P » au centre de la barre de titre, lisible dans le verre ; rien d'autre ne bouge.

- [ ] **Step 2: Build the installer and the test copy**

Run : `pnpm tauri build > "$SCRATCH/f1-build.log" 2>&1` (en arrière-plan), puis copier `src-tauri\target\release\dummyplane.exe` en `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J8a.exe` et repointer le raccourci du bureau « dummyPlane (dernière build) » vers cette copie.
Expected : `Finished 1 bundle at: …\dummyPlane_0.1.0_x64-setup.exe` ; sous-système PE `2` ; la copie et le raccourci en place.

- [ ] **Step 3: Hand over**

Donner à Mathieu la version et ses vérifications (spec fenêtre §10 J8, partie palette) : Ctrl+P « tho » Entrée depuis un terminal en train d'écrire (on tape aussitôt dans Thot) ; un terminal d'un autre workspace ; un groupe ; un orchestrateur (curseur dans son champ) ; un workspace ; un projet ; un clic sur le champ de recherche ; Ctrl+P à l'accueil ; Ctrl+Maj+P puis « vue » Entrée ; Ctrl+P et Ctrl+Maj+P qui basculent palette ouverte ; Échap rend le clavier au terminal ; Ctrl+P n'imprime plus.
