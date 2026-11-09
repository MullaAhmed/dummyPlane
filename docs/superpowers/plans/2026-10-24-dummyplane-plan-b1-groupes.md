# dummyPlane — Plan B1 : groupes (jalon J4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer des groupes de terminaux dans un workspace (cadres Excalidraw à rôle, panthéon et étiquette), et ranger automatiquement dans la grille du groupe tout terminal qu'on y ouvre.

**Architecture:** Un groupe est un cadre (`frame`) Excalidraw dont le `customData.dummyplane` porte le rôle et le panthéon ; ses membres sont les terminaux dont le `frameId` est ce cadre. Le modèle (`framesFromScene`) est dérivé de la scène à chaque `onChange` et rangé dans `canvasStore.frames`. Deux couches DOM habillent les cadres : les contours sous le canvas transparent, les étiquettes (avec leur menu) au-dessus. Le placement en grille (`groupGrid`, `freeCell`) est fait de fonctions pures ; les opérations de scène (lancer, ajouter, dégrouper, fermer) sont une couche mince autour de `api.updateScene`.

**Tech Stack:** React 19, TypeScript, Zustand, Excalidraw 0.18.1 (figé), Radix (Popover, DropdownMenu, Dialog), Tailwind 4, Vitest 5 (happy-dom), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (§9.2, §10.1, §11, §18), amendée à la tâche 1 avec la règle d'alignement demandée par Mathieu.

## Global Constraints

- Interface en français, thème sombre uniquement ; code et commentaires en anglais (spec §21).
- Excalidraw reste en 0.18.1 ; les sélecteurs CSS visant ses classes vivent dans `src/theme/excalidraw.css` (spec §20).
- Vitest ne peut pas charger le runtime d'Excalidraw (ruling T5 du plan A) : les modules testés n'importent d'Excalidraw que des types. `newElementWith`, `CaptureUpdateAction` et `api` restent dans la couche mince non testée.
- Rôles de groupe : Frontend `#C18E57`, Backend `#AA88D2`, Testeurs `#86A174`, Relecteurs `#90B1D4`, Design `#CE7B8F`, Docs `#77B7C0`, Sécurité `#D88479`, Général `#8A8A80` (spec §4.1).
- Grille : `min(N, 4)` colonnes, terminaux de 720 × 440, espacement 24, marge intérieure 32 (48 en haut) ; 1 à 12 agents par groupe ; lancement échelonné de 300 ms (spec §11.3, §20).
- Aucun bouton inactif : les entrées de menu de J5 (orchestrateur, pause, reprise) n'apparaissent pas (spec §18).
- pnpm ; Conventional Commits ; chaque message de commit finit par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : `pnpm test` (front). Aucune modification Rust dans ce plan.

## Review Focus

1. Un terminal déplacé à la main dans un groupe, ou le trou laissé par un terminal fermé : un nouvel agent prend la case libre, sans chevaucher le terminal déplacé (test : tâche 3, `freeCell`).
2. Un terminal d'un groupe supprimé (ou fermé avec son groupe) avant son tour de lancement échelonné ne doit pas démarrer (test : tâche 5, `createAutostart`).
3. Deux groupes et les agents hors groupe d'un même workspace ne partagent jamais un panthéon ; au-delà de 12, retour au premier (test : tâche 4).
4. Après un changement de workspace, les étiquettes et contours de l'ancien workspace ne restent pas affichés (test : tâche 2, `setFrames`, et vérification en application tâche 6).
5. « Renommer » depuis le menu du groupe : l'éditeur de nom d'Excalidraw reste ouvert jusqu'à Entrée, Échap ou un clic ailleurs, malgré le retour du focus du menu (vérification en application, tâche 7 ; Excalidraw ne tourne pas sous Vitest).

---

## File Structure

Créés :
- `src/fleet/roles.ts` — rôles de groupe (libellé, couleur).
- `src/canvas/groups.ts` (+ test) — modèle des cadres de la scène : `framesFromScene`, `groupAt`, `groupOf`, `nextGroupName`, `groupPantheons`, `createGroupFrame`, `insertIntoFrame`.
- `src/fleet/groupLayout.ts` (+ test) — grille des groupes : `groupGrid`, `freeCell`, `arrangeInFrame`.
- `src/fleet/groupSummary.ts` (+ test) — textes de l'étiquette et de la confirmation.
- `src/fleet/composer.ts` (+ test) — logique du popover « Composer un groupe ».
- `src/nodes/terminal/autostart.ts` (+ test) — démarrage différé des nouveaux terminaux.
- `src/fleet/groups.ts` — opérations de scène : lancer, ajouter, dégrouper, fermer, renommer.
- `src/canvas/overlay/GroupBackdrops.tsx` — contours sous le canvas.
- `src/canvas/overlay/GroupLabels.tsx` — étiquettes au-dessus du canvas.
- `src/fleet/GroupMenu.tsx` — menu `⌄` de l'étiquette.
- `src/fleet/ComposeGroup.tsx` — popover « Composer un groupe ».
- `src/shell/CloseGroupDialog.tsx` — confirmation « Fermer le groupe ».

Modifiés : `canvasStore.ts`, `Canvas.tsx`, `sceneDefaults.ts`, `excalidraw.css`, `workspaces.ts`, `naming.ts`, `terminals.ts`, `launchAgent.ts`, `registry.ts`, `placement.ts`, `PlacementGhost.tsx`, `ActionChips.tsx`, `ui.ts`, `catalog.ts`, `TerminalHeader.tsx`, `ProjectView.tsx`, la spec et `BACKLOG.md`.

---

### Task 1: Amender la spec (alignement, Flotte en J3)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (§7.5, §10.1, §11.2, §11.3, §11.4, §18)

**Interfaces:**
- Consumes: rien.
- Produces: la règle d'alignement que les tâches 3, 5 et 8 implémentent.

- [ ] **Step 1: §7.5 — Dupliquer dans un groupe**

Remplacer la ligne :

```markdown
- Dupliquer : crée un nouveau terminal à droite du nœud (même agent, dossier, shell, groupe ; nouveau prénom ; Claude : nouvelle session) et le lance.
```

par :

```markdown
- Dupliquer : crée un nouveau terminal à droite du nœud (même agent, dossier, shell, groupe ; nouveau prénom ; Claude : nouvelle session) et le lance. Dans un groupe, la copie prend la première case libre de la grille du groupe (§11.3).
```

- [ ] **Step 2: §10.1 — placement dans un cadre**

Remplacer `Si le clic tombe dans un cadre de groupe, le terminal rejoint ce groupe.` par :

```markdown
Si le clic tombe dans un cadre de groupe, le terminal rejoint ce groupe et se range dans sa grille (§11.3) ; pendant le placement, le rectangle en pointillé s'aligne sur la case que le terminal prendra.
```

- [ ] **Step 3: §11.2 — largeur des emplacements**

Remplacer `grille de 4 colonnes d'emplacements (90 × 72, rayon 10)` par `grille de 4 colonnes d'emplacements (72 px de haut, largeur de la colonne, rayon 10 ; quatre emplacements de 90 px ne tiennent pas dans 360 px)`.

- [ ] **Step 4: §11.3 — règle d'alignement**

Ajouter à la fin de §11.3 :

```markdown
- **Alignement dans le groupe** (demande de Mathieu, 2026-10-24) : tout terminal ouvert dans un groupe — clic de placement dans le cadre, « Nouvelle console » quand le centre de la vue tombe dans le cadre, « Ajouter un agent », « Dupliquer » ou copie (Ctrl+D, copier-coller) d'un membre — prend la première case libre de la grille du groupe, ligne par ligne. La grille part du coin du cadre, avec les marges ci-dessus ; une case est prise quand un élément du cadre en couvre plus d'un dixième, si bien qu'un terminal déplacé à la main garde sa case. Cadre plein : il s'agrandit d'une colonne (jusqu'à 4), sinon d'une ligne.
- Glisser à la main un terminal dans un cadre ne le range pas : il reste où on le lâche.
```

- [ ] **Step 5: §11.4 — compteurs avant J3, menu, cadres simples, nom natif**

Ajouter à la fin de §11.4 :

```markdown
- Jusqu'à J3, « en cours » compte les membres dont le processus tourne (pastille ACTIF) ; J3 le remplace par l'activité `working`.
- Relier un orchestrateur, Tout mettre en pause et Tout reprendre arrivent avec J5 ; d'ici là, le menu ne les montre pas.
- Les cadres simples reçoivent un contour gris sobre de la même couche (l'outline native est désactivée, §5.7).
- Le nom natif de tous les cadres prend la police de l'étiquette (Geist 11 px semi-gras, majuscules, 28 px de marge pour le point) et sa position (16 px du coin, posé sur le bord), pour que la zone qu'on saisit coïncide avec notre étiquette ; il est transparent pour les groupes.
```

- [ ] **Step 6: §18 — Flotte en J3, découpage en plans**

Dans le tableau, remplacer la ligne J3 par :

```markdown
| B2 | J3 — États des agents | serveur local des hooks, réglages Claude, `notify` Codex, activité du terminal, événement `agent-activity`, pastilles vivantes, compteurs, rail droit et panneau Flotte | EN COURS / ATTEND / PRÊT en direct |
```

et la ligne J4 par :

```markdown
| B1 | J4 — Groupes | cadres de groupe, étiquettes et contours, Composer un groupe, Lancer 4, placement en grille et alignement, menu de groupe | les équipes |
```

La ligne J5 prend `B3` dans la colonne Plan. Remplacer la phrase qui suit le tableau par :

```markdown
Les éléments de la coquille apparaissent avec le jalon qui les rend fonctionnels : la puce « Nouvelle console » en J2 ; les puces « Lancer 4 » et « Groupe » en J4 ; le rail droit et le panneau Flotte en J3, dont viennent ses filtres et ses durées (le jalon J4 est livré avant J3, à la demande de Mathieu) ; la barre de commande et les puces de pause et de reprise en J5. Aucun bouton inactif n'est affiché entre-temps.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md
git commit -m "docs(spec): align terminals opened in a group, fleet panel moves to J3"
```

---

### Task 2: Modèle des cadres et des groupes

**Files:**
- Create: `src/fleet/roles.ts`
- Create: `src/canvas/groups.ts`
- Test: `src/canvas/groups.test.ts`
- Modify: `src/canvas/canvasStore.ts`, `src/canvas/canvasStore.test.ts`
- Modify: `src/canvas/sceneDefaults.ts`, `src/canvas/sceneDefaults.test.ts`
- Modify: `src/canvas/Canvas.tsx`

**Interfaces:**
- Consumes: `nodeKindOf(element)` de `src/canvas/nodeElement.ts`.
- Produces:
  - `type RoleId`, `ROLES: Record<RoleId, { label: string; color: string }>`, `ROLE_ORDER: RoleId[]`, `isRoleId(value): value is RoleId`.
  - `interface Rect { x; y; width; height }`, `interface GroupInfo { role: RoleId; pantheon: string }`, `interface SceneFrame extends Rect { id; name; group: GroupInfo | null; memberIds: string[] }`, `type SceneGroup = SceneFrame & { group: GroupInfo }`.
  - `groupInfoOf(element): GroupInfo | null`, `framesFromScene(elements): SceneFrame[]`, `isGroup(frame): frame is SceneGroup`, `groupAt(frames, point): SceneGroup | null`, `groupOf(frames, nodeId): SceneGroup | null`, `nextGroupName(frames): string`, `groupPantheons(frames): string[]`, `sameFrames(a, b): boolean`, `createGroupFrame(rect, name, info): ExcalidrawFrameElement`, `insertIntoFrame(elements, element, frame)`.
  - `canvasStore`: `frames: SceneFrame[]`, `setFrames(frames)` ; `CanvasView.editingFrame: string | null`.

- [ ] **Step 1: Write the failing tests**

`src/canvas/groups.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  createGroupFrame,
  framesFromScene,
  groupAt,
  groupInfoOf,
  groupOf,
  groupPantheons,
  insertIntoFrame,
  nextGroupName,
} from "./groups";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 100, height: 100, isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;
const frame = (id: string, fields: Record<string, unknown> = {}) => element({ id, type: "frame", name: id, ...fields });
const group = (id: string, role = "backend", pantheon = "greek", fields: Record<string, unknown> = {}) =>
  frame(id, { customData: { dummyplane: { kind: "group", role, pantheon } }, ...fields });
const terminal = (id: string, frameId: string | null, fields: Record<string, unknown> = {}) =>
  element({ id, type: "embeddable", customData: { kind: "terminal" }, frameId, width: 720, height: 440, ...fields });

describe("framesFromScene", () => {
  it("derives each group, its role, pantheon and terminals in scene order", () => {
    const scene = [
      terminal("a", "g1"),
      terminal("b", null),
      element({ id: "r", type: "rectangle", frameId: "g1" }),
      terminal("c", "g1"),
      group("g1", "backend", "greek", { x: 10, y: 20, width: 800, height: 500, name: "Backend" }),
    ];
    expect(framesFromScene(scene)).toEqual([
      {
        id: "g1",
        name: "Backend",
        x: 10,
        y: 20,
        width: 800,
        height: 500,
        group: { role: "backend", pantheon: "greek" },
        memberIds: ["a", "c"],
      },
    ]);
  });

  it("keeps hand-drawn frames as plain frames", () => {
    expect(framesFromScene([frame("f")])[0].group).toBeNull();
    expect(framesFromScene([group("g", "pirates")])[0].group).toBeNull();
  });

  it("ignores deleted frames and deleted terminals", () => {
    const frames = framesFromScene([group("g"), terminal("a", "g", { isDeleted: true }), group("old", "docs", "norse", { isDeleted: true })]);
    expect(frames.map((f) => [f.id, f.memberIds])).toEqual([["g", []]]);
  });
});

describe("groups of the scene", () => {
  const frames = framesFromScene([
    group("g1", "backend", "greek", { x: 0, y: 0, width: 1000, height: 1000, name: "Groupe 1" }),
    frame("plain", { x: 0, y: 0, width: 3000, height: 3000, name: "Groupe 3" }),
    group("g2", "docs", "norse", { x: 500, y: 500, width: 1000, height: 1000, name: "Docs" }),
    terminal("a", "g2"),
  ]);

  it("finds the topmost group under a point, never a plain frame", () => {
    expect(groupAt(frames, { x: 100, y: 100 })?.id).toBe("g1");
    expect(groupAt(frames, { x: 600, y: 600 })?.id).toBe("g2");
    expect(groupAt(frames, { x: 2500, y: 2500 })).toBeNull();
  });

  it("finds the group of a terminal", () => {
    expect(groupOf(frames, "a")?.id).toBe("g2");
    expect(groupOf(frames, "zzz")).toBeNull();
  });

  it("names a new group with the smallest free number", () => {
    expect(nextGroupName(frames)).toBe("Groupe 2");
    expect(nextGroupName([])).toBe("Groupe 1");
  });

  it("lists the pantheons the groups use", () => {
    expect(groupPantheons(frames)).toEqual(["greek", "norse"]);
  });
});

describe("group frame elements", () => {
  it("creates a frame carrying its role and pantheon", () => {
    const created = createGroupFrame({ x: 1, y: 2, width: 3, height: 4 }, "Backend", { role: "backend", pantheon: "greek" });
    expect(created).toMatchObject({ type: "frame", name: "Backend", x: 1, y: 2, width: 3, height: 4, isDeleted: false, frameId: null });
    expect(groupInfoOf(created)).toEqual({ role: "backend", pantheon: "greek" });
  });

  it("puts a new child right under its frame, which takes its grown size", () => {
    const scene = [{ id: "x" }, { id: "f", size: 1 }, { id: "y" }];
    expect(insertIntoFrame(scene, { id: "t" }, { id: "f", size: 2 })).toEqual([{ id: "x" }, { id: "t" }, { id: "f", size: 2 }, { id: "y" }]);
  });

  it("appends the child and its frame when the frame is not in the scene", () => {
    expect(insertIntoFrame([{ id: "x" }], { id: "t" }, { id: "f" })).toEqual([{ id: "x" }, { id: "t" }, { id: "f" }]);
  });
});
```

Dans `src/canvas/canvasStore.test.ts`, ajouter `editingFrame: null,` à l'objet attendu du test `viewFrom` (après `selectedIds: ["a", "b"],`), puis ajouter à la fin du fichier :

```ts
describe("frames", () => {
  it("keeps the same frames object when the scene's frames did not change", () => {
    const frames = [{ id: "g", name: "G", x: 0, y: 0, width: 1, height: 1, group: null, memberIds: [] }];
    canvasStore.getState().setFrames(frames);
    canvasStore.getState().setFrames(frames.map((f) => ({ ...f })));
    expect(canvasStore.getState().frames).toBe(frames);
    canvasStore.getState().setFrames([]);
    expect(canvasStore.getState().frames).toEqual([]);
  });
});
```

Dans `src/canvas/sceneDefaults.test.ts`, ajouter :

```ts
it("lets dummyPlane draw frame outlines and group labels", () => {
  expect(SCENE_DEFAULTS.frameRendering).toEqual({ enabled: true, name: true, outline: false, clip: true });
});
```

(avec `SCENE_DEFAULTS` ajouté à l'import existant de `./sceneDefaults` si besoin).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/canvas/groups.test.ts src/canvas/canvasStore.test.ts src/canvas/sceneDefaults.test.ts`
Expected: FAIL — `groups.ts` introuvable, `editingFrame` absent, `frameRendering` absent.

- [ ] **Step 3: Write the implementation**

`src/fleet/roles.ts` :

```ts
/** Group roles and their colors (spec habillage §4.1, §11.2). */
export type RoleId = "frontend" | "backend" | "testers" | "reviewers" | "design" | "docs" | "security" | "general";

export interface Role {
  label: string;
  color: string;
}

export const ROLES: Record<RoleId, Role> = {
  frontend: { label: "Frontend", color: "#C18E57" },
  backend: { label: "Backend", color: "#AA88D2" },
  testers: { label: "Testeurs", color: "#86A174" },
  reviewers: { label: "Relecteurs", color: "#90B1D4" },
  design: { label: "Design", color: "#CE7B8F" },
  docs: { label: "Docs", color: "#77B7C0" },
  security: { label: "Sécurité", color: "#D88479" },
  general: { label: "Général", color: "#8A8A80" },
};

export const ROLE_ORDER = Object.keys(ROLES) as RoleId[];

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}
```

`src/canvas/groups.ts` :

```ts
import type { ExcalidrawElement, ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";
import { isRoleId, type RoleId } from "@/fleet/roles";
import { nodeKindOf } from "./nodeElement";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a group frame carries in `customData.dummyplane` (spec habillage §11.1). */
export interface GroupInfo {
  role: RoleId;
  pantheon: string;
}

/** A frame of the scene: a group, or a plain frame drawn by hand (`group` null). */
export interface SceneFrame extends Rect {
  id: string;
  name: string;
  group: GroupInfo | null;
  /** Terminal nodes whose frameId is this frame, in scene order. */
  memberIds: string[];
}

export type SceneGroup = SceneFrame & { group: GroupInfo };

export function groupInfoOf(element: ExcalidrawElement): GroupInfo | null {
  const data = element.customData?.dummyplane as Record<string, unknown> | undefined;
  if (element.type !== "frame" || data?.kind !== "group") return null;
  if (!isRoleId(data.role) || typeof data.pantheon !== "string") return null;
  return { role: data.role, pantheon: data.pantheon };
}

/** The frames of the scene and their terminals, derived on every change (spec §11.1). */
export function framesFromScene(elements: readonly ExcalidrawElement[]): SceneFrame[] {
  const frames = new Map<string, SceneFrame>();
  for (const element of elements) {
    if (element.isDeleted || element.type !== "frame") continue;
    const { id, x, y, width, height } = element;
    frames.set(id, { id, name: element.name ?? "", x, y, width, height, group: groupInfoOf(element), memberIds: [] });
  }
  for (const element of elements) {
    if (element.isDeleted || !element.frameId || nodeKindOf(element) !== "terminal") continue;
    frames.get(element.frameId)?.memberIds.push(element.id);
  }
  return [...frames.values()];
}

export function isGroup(frame: SceneFrame): frame is SceneGroup {
  return frame.group !== null;
}

/** The group whose frame contains `point`, the topmost when frames overlap. */
export function groupAt(frames: readonly SceneFrame[], point: { x: number; y: number }): SceneGroup | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (isGroup(f) && point.x >= f.x && point.x <= f.x + f.width && point.y >= f.y && point.y <= f.y + f.height) return f;
  }
  return null;
}

export function groupOf(frames: readonly SceneFrame[], nodeId: string): SceneGroup | null {
  return frames.find((f): f is SceneGroup => isGroup(f) && f.memberIds.includes(nodeId)) ?? null;
}

/** "Groupe N" with the smallest N no frame of the scene is named (spec §11.3, "Lancer 4"). */
export function nextGroupName(frames: readonly SceneFrame[]): string {
  const taken = new Set(frames.map((f) => f.name));
  let n = 1;
  while (taken.has(`Groupe ${n}`)) n++;
  return `Groupe ${n}`;
}

/** The pantheons the groups of the scene draw their names from (spec §9.2). */
export function groupPantheons(frames: readonly SceneFrame[]): string[] {
  return frames.filter(isGroup).map((f) => f.group.pantheon);
}

export function sameFrames(a: readonly SceneFrame[], b: readonly SceneFrame[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A group frame element. Every base field is set by hand, like the nodes:
 * tests cannot load Excalidraw's element factories. `index: null` lets
 * Excalidraw order it.
 */
export function createGroupFrame(rect: Rect, name: string, info: GroupInfo): ExcalidrawFrameElement {
  const random = () => Math.floor(Math.random() * 2 ** 31);
  return {
    id: crypto.randomUUID(),
    type: "frame",
    name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    angle: 0 as ExcalidrawFrameElement["angle"],
    strokeColor: "#bbb",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roundness: null,
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
    customData: { dummyplane: { kind: "group", role: info.role, pantheon: info.pantheon } },
  };
}

/**
 * `elements` with `element` (a new child) right under its frame — Excalidraw
 * keeps a frame above its children — and the frame replaced by `frame`, its
 * possibly grown copy. Without the frame in the scene, both are appended.
 */
export function insertIntoFrame<T extends { id: string }>(elements: readonly T[], element: T, frame: T): T[] {
  const index = elements.findIndex((e) => e.id === frame.id);
  if (index === -1) return [...elements, element, frame];
  return [...elements.slice(0, index), element, frame, ...elements.slice(index + 1)];
}
```

`src/canvas/canvasStore.ts` — ajouts :

```ts
import { sameFrames, type SceneFrame } from "./groups";
```

Dans `CanvasView`, après `selectedIds` :

```ts
  /** The frame whose name Excalidraw is editing (its group label hides meanwhile). */
  editingFrame: string | null;
```

`EMPTY_VIEW` reçoit `editingFrame: null` ; `viewFrom` reçoit `editingFrame: appState.editingFrame ?? null` ; `sameView` compare aussi `a.editingFrame === b.editingFrame`.

Dans `CanvasState` :

```ts
  /** Frames and groups of the scene on screen, derived on every change (spec §11.1). */
  frames: SceneFrame[];
  setFrames: (frames: SceneFrame[]) => void;
```

et dans le store :

```ts
  frames: [],
  setFrames: (frames) => {
    if (!sameFrames(get().frames, frames)) set({ frames });
  },
```

`src/canvas/sceneDefaults.ts` — dans `SCENE_DEFAULTS`, après `gridModeEnabled: false,` :

```ts
  // Our layers draw frame outlines and group labels (spec habillage §5.7, §11.4).
  frameRendering: { enabled: true, name: true, outline: false, clip: true },
```

`src/canvas/Canvas.tsx` — importer `framesFromScene` depuis `./groups`, puis dans `onChange`, après `canvasStore.getState().setView(viewFrom(appState));` :

```ts
      canvasStore.getState().setFrames(framesFromScene(elements));
```

et ajouter dans `LoadedCanvas`, après l'effet de `setApi` :

```ts
  // The next workspace must not show this one's groups before its first change.
  useEffect(() => () => canvasStore.getState().setFrames([]), []);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/canvas/groups.test.ts src/canvas/canvasStore.test.ts src/canvas/sceneDefaults.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add src/fleet/roles.ts src/canvas/groups.ts src/canvas/groups.test.ts src/canvas/canvasStore.ts src/canvas/canvasStore.test.ts src/canvas/sceneDefaults.ts src/canvas/sceneDefaults.test.ts src/canvas/Canvas.tsx
git commit -m "feat(groups): derive groups and their terminals from the scene's frames"
```

---

### Task 3: Grille des groupes et première case libre

**Files:**
- Create: `src/fleet/groupLayout.ts`
- Test: `src/fleet/groupLayout.test.ts`

**Interfaces:**
- Consumes: `Rect` de `src/canvas/groups.ts` ; `NODE_SIZE` de `src/canvas/nodeElement.ts`.
- Produces: `CELL`, `GAP = 24`, `PADDING = 32`, `PADDING_TOP = 48`, `MAX_COLUMNS = 4` ; `cellAt(origin, col, row): Rect` ; `groupGrid(count): { width; height; cells: Rect[] }` (cellules relatives au coin du cadre) ; `freeCell(frame: Rect, members: readonly Rect[]): { cell: Rect; frame: Rect }` ; `arrangeInFrame(frame, members, count): { cells: Rect[]; frame: Rect }`.

- [ ] **Step 1: Write the failing test**

`src/fleet/groupLayout.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { Rect } from "@/canvas/groups";
import { arrangeInFrame, cellAt, freeCell, groupGrid } from "./groupLayout";

const at = (x: number, y: number, size: { width: number; height: number }): Rect => ({ x, y, width: size.width, height: size.height });

describe("groupGrid", () => {
  it("sizes the frame of 1, 4, 5 and 12 agents (spec §11.3)", () => {
    expect([1, 4, 5, 12].map((n) => [groupGrid(n).width, groupGrid(n).height])).toEqual([
      [784, 520],
      [3016, 520],
      [3016, 984],
      [3016, 1448],
    ]);
  });

  it("lays the terminals out row by row, four per row", () => {
    const { cells } = groupGrid(5);
    expect(cells.map((c) => [c.x, c.y])).toEqual([
      [32, 48],
      [776, 48],
      [1520, 48],
      [2264, 48],
      [32, 512],
    ]);
  });
});

describe("freeCell", () => {
  const origin = { x: 100, y: 200 };
  const full = (n: number) => groupGrid(n).cells.map((c) => ({ ...c, x: c.x + origin.x, y: c.y + origin.y }));
  const frameOf = (n: number) => at(origin.x, origin.y, groupGrid(n));

  it("takes the first cell of an empty group", () => {
    expect(freeCell(frameOf(1), [])).toEqual({ cell: cellAt(origin, 0, 0), frame: frameOf(1) });
  });

  it("fills the hole left by a closed terminal first", () => {
    const members = full(4).filter((_, i) => i !== 1);
    expect(freeCell(frameOf(4), members).cell).toEqual(cellAt(origin, 1, 0));
  });

  it("keeps the cell of a terminal moved a little by hand", () => {
    const [first, ...rest] = full(4);
    const moved = { ...first, x: first.x + 30, y: first.y + 12 };
    expect(freeCell(frameOf(4), [moved, ...rest.slice(1)]).cell).toEqual(cellAt(origin, 1, 0));
  });

  it("grows a full frame by a column, up to four", () => {
    expect(freeCell(frameOf(2), full(2))).toEqual({ cell: cellAt(origin, 2, 0), frame: frameOf(3) });
  });

  it("grows a full frame of four columns by a row", () => {
    expect(freeCell(frameOf(4), full(4))).toEqual({ cell: cellAt(origin, 0, 1), frame: frameOf(5) });
  });

  it("uses the first cell of a frame smaller than a terminal and grows it", () => {
    const small = at(0, 0, { width: 300, height: 200 });
    expect(freeCell(small, [])).toEqual({ cell: cellAt({ x: 0, y: 0 }, 0, 0), frame: at(0, 0, groupGrid(1)) });
  });
});

describe("arrangeInFrame", () => {
  it("places several new terminals one after the other", () => {
    const origin = { x: 0, y: 0 };
    const members = groupGrid(2).cells;
    const placed = arrangeInFrame(at(0, 0, groupGrid(2)), members, 3);
    expect(placed.cells).toEqual([cellAt(origin, 2, 0), cellAt(origin, 3, 0), cellAt(origin, 0, 1)]);
    expect(placed.frame).toEqual(at(0, 0, groupGrid(5)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/fleet/groupLayout.test.ts`
Expected: FAIL — `./groupLayout` introuvable.

- [ ] **Step 3: Write the implementation**

`src/fleet/groupLayout.ts` :

```ts
import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";

/** Group grid (spec habillage §11.3): terminals 24 apart, 32 inside the frame, 48 at the top for the label. */
export const CELL = NODE_SIZE.terminal;
export const GAP = 24;
export const PADDING = 32;
export const PADDING_TOP = 48;
export const MAX_COLUMNS = 4;

/** Cell (`col`, `row`) of a frame whose top-left corner is `origin`. */
export function cellAt(origin: { x: number; y: number }, col: number, row: number): Rect {
  return {
    x: origin.x + PADDING + col * (CELL.width + GAP),
    y: origin.y + PADDING_TOP + row * (CELL.height + GAP),
    width: CELL.width,
    height: CELL.height,
  };
}

/** The frame of a new group of `count` agents and its cells, relative to the frame's corner. */
export function groupGrid(count: number): { width: number; height: number; cells: Rect[] } {
  const n = Math.max(1, count);
  const columns = Math.min(n, MAX_COLUMNS);
  const rows = Math.ceil(n / columns);
  return {
    width: 2 * PADDING + columns * CELL.width + (columns - 1) * GAP,
    height: PADDING_TOP + PADDING + rows * CELL.height + (rows - 1) * GAP,
    cells: Array.from({ length: n }, (_, i) => cellAt({ x: 0, y: 0 }, i % columns, Math.floor(i / columns))),
  };
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** A cell is taken when an element covers more than a tenth of it: a terminal moved by hand keeps its cell. */
function isTaken(cell: Rect, members: readonly Rect[]): boolean {
  return members.some((member) => overlap(cell, member) > 0.1 * cell.width * cell.height);
}

function grownTo(frame: Rect, cell: Rect): Rect {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(frame.width, cell.x + cell.width + PADDING - frame.x),
    height: Math.max(frame.height, cell.y + cell.height + PADDING - frame.y),
  };
}

/**
 * Mathieu's alignment rule (spec §11.3): a terminal opened in a group takes the
 * first free cell of its grid, row by row. A full frame grows by a column (up
 * to four), else by a row. Returns the cell and the frame that holds it.
 */
export function freeCell(frame: Rect, members: readonly Rect[]): { cell: Rect; frame: Rect } {
  const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.floor((frame.width - 2 * PADDING + GAP) / (CELL.width + GAP))));
  const rows = Math.max(1, Math.floor((frame.height - PADDING_TOP - PADDING + GAP) / (CELL.height + GAP)));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cell = cellAt(frame, col, row);
      if (!isTaken(cell, members)) return { cell, frame: grownTo(frame, cell) };
    }
  }
  const cell = columns < MAX_COLUMNS ? cellAt(frame, columns, 0) : cellAt(frame, 0, rows);
  return { cell, frame: grownTo(frame, cell) };
}

/** `count` new terminals placed one after the other in `frame`. */
export function arrangeInFrame(frame: Rect, members: readonly Rect[], count: number): { cells: Rect[]; frame: Rect } {
  const cells: Rect[] = [];
  let current = frame;
  for (let i = 0; i < count; i++) {
    const next = freeCell(current, [...members, ...cells]);
    cells.push(next.cell);
    current = next.frame;
  }
  return { cells, frame: current };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/fleet/groupLayout.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/fleet/groupLayout.ts src/fleet/groupLayout.test.ts
git commit -m "feat(groups): grid layout and first free cell of a group"
```

---

### Task 4: Panthéons des groupes et prénoms

**Files:**
- Modify: `src/store/workspaces.ts:30-34,113-120`
- Modify: `src/fleet/naming.ts`
- Test: `src/store/workspaces.test.ts`, `src/fleet/naming.test.ts`

**Interfaces:**
- Consumes: `groupPantheons(frames)` (tâche 2), `canvasStore.frames` (tâche 2), `nextPantheon`, `nextName` de `src/fleet/names.ts`.
- Produces:
  - `ensurePantheon(id: string, taken?: readonly string[]): Promise<string>` — le panthéon hors groupe évite `taken`.
  - `nameForNewAgent(workspaceId: string, groupPantheon?: string): Promise<string>` — prénom tiré du panthéon du groupe s'il est donné, sinon du panthéon hors groupe (qui évite ceux des groupes).
  - `pantheonForNewGroup(workspaceId: string): string` — premier panthéon que ni les groupes ni le hors-groupe n'utilisent.

- [ ] **Step 1: Write the failing tests**

Dans `src/store/workspaces.test.ts`, après le test « chooses the pantheon of a workspace once » :

```ts
  it("gives the agents outside groups a pantheon no group uses", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    expect(await state().ensurePantheon("w1", ["egyptian", "greek"])).toBe("norse");
    expect(db.workspaces[0].pantheon).toBe("norse");
  });
```

Dans `src/fleet/naming.test.ts`, ajouter l'import `import { canvasStore } from "@/canvas/canvasStore";` et `pantheonForNewGroup` à l'import de `./naming`, puis ajouter `canvasStore.getState().setFrames([]);` au début de `afterEach`, et à la fin du fichier :

```ts
const groupFrame = (id: string, pantheon: string) => ({
  id,
  name: id,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  group: { role: "general" as const, pantheon },
  memberIds: [],
});

it("keeps the pantheons of the groups for their own agents", async () => {
  canvasStore.getState().setFrames([groupFrame("g", "egyptian")]);
  expect(await nameForNewAgent("w1")).toBe("Athéna");
  expect(pantheonSaves).toEqual(["greek"]);
});

it("names a group's agent from the group's pantheon", async () => {
  expect(await nameForNewAgent("w1", "norse")).toBe("Odin");
  expect(pantheonSaves).toEqual([]);
});

it("gives a new group the first pantheon nobody in the workspace uses", async () => {
  await nameForNewAgent("w1"); // the agents outside groups take "egyptian"
  canvasStore.getState().setFrames([groupFrame("g", "greek")]);
  expect(pantheonForNewGroup("w1")).toBe("norse");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/store/workspaces.test.ts src/fleet/naming.test.ts`
Expected: FAIL — `ensurePantheon` ignore `taken` (renvoie `egyptian`), `pantheonForNewGroup` n'existe pas.

- [ ] **Step 3: Write the implementation**

`src/store/workspaces.ts` — dans l'interface :

```ts
  /**
   * The pantheon of the agents outside any group, chosen and saved on first
   * use; it avoids `taken`, the pantheons of the workspace's groups.
   */
  ensurePantheon: (id: string, taken?: readonly string[]) => Promise<string>;
```

et l'implémentation :

```ts
      ensurePantheon: async (id, taken = []) => {
        const workspace = get().workspaces.find((w) => w.id === id);
        if (workspace?.pantheon) return workspace.pantheon;
        const pantheon = nextPantheon(taken);
        await get().setPantheon(id, pantheon);
        return pantheon;
      },
```

`src/fleet/naming.ts` — nouveaux imports et fonctions :

```ts
import { canvasStore } from "@/canvas/canvasStore";
import { groupPantheons } from "@/canvas/groups";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { nextName, nextPantheon } from "./names";

/** The pantheon of the agents outside groups; it avoids those of the groups on screen. */
function outsidePantheon(workspaceId: string): Promise<string> {
  return workspacesStore.getState().ensurePantheon(workspaceId, groupPantheons(canvasStore.getState().frames));
}

/**
 * The name of an agent about to be created (spec habillage §9.2): from its
 * group's pantheon, or from the workspace's pantheon outside groups.
 */
export async function nameForNewAgent(workspaceId: string, groupPantheon?: string): Promise<string> {
  const pantheon = groupPantheon ?? (await outsidePantheon(workspaceId));
  return nextName(pantheon, namesInWorkspace(workspaceId));
}

/** The pantheon of a new group: the first one neither the groups nor the agents outside them use. */
export function pantheonForNewGroup(workspaceId: string): string {
  const workspace = workspacesStore.getState().workspaces.find((w) => w.id === workspaceId);
  return nextPantheon([workspace?.pantheon, ...groupPantheons(canvasStore.getState().frames)]);
}
```

et dans `assignMissingNames`, remplacer `await workspacesStore.getState().ensurePantheon(workspaceId)` par `await outsidePantheon(workspaceId)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/store/workspaces.test.ts src/fleet/naming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/workspaces.ts src/store/workspaces.test.ts src/fleet/naming.ts src/fleet/naming.test.ts
git commit -m "feat(groups): each group draws its agents' names from its own pantheon"
```

---

### Task 5: Lancer un groupe et ranger les terminaux ouverts dans un groupe

**Files:**
- Create: `src/nodes/terminal/autostart.ts`, `src/nodes/terminal/autostart.test.ts`
- Create: `src/fleet/groups.ts`
- Modify: `src/nodes/terminal/registry.ts` (autostart)
- Modify: `src/fleet/terminals.ts` (`addTerminal`, `duplicateTerminal`, `adoptCopies`)
- Modify: `src/fleet/launchAgent.ts`
- Modify: `src/shell/ui.tsx` (`ChipButton`), `src/shell/ActionChips.tsx` (puce « Lancer 4 »)

**Interfaces:**
- Consumes: `framesFromScene`, `groupAt`, `groupOf`, `isGroup`, `groupInfoOf`, `createGroupFrame`, `insertIntoFrame` (tâche 2) ; `groupGrid`, `freeCell`, `arrangeInFrame` (tâche 3) ; `nameForNewAgent`, `pantheonForNewGroup`, `namesInWorkspace` (tâche 4) ; `viewportCenter` ; `newTerminalPayload`.
- Produces:
  - `createAutostart(setTimer?, clearTimer?)` → `{ mark(nodeId, delayMs?), run(nodeId, start): boolean, cancel(nodeId) }`.
  - `markForAutostart(nodeId: string, delayMs = 0)` (registry).
  - `addTerminal(workspaceId, payload, center: Point, groupId: string | null = null): Promise<string | null>`.
  - `interface GroupPlan { name: string; role: RoleId; agents: AgentId[] }`, `LAUNCH_STAGGER_MS = 300`, `launchGroup(plan, options?)`, `addAgentToGroup(groupId, agent)`.
  - `ChipButton` (`src/shell/ui.tsx`), props d'un `<button>`.

- [ ] **Step 1: Write the failing test**

`src/nodes/terminal/autostart.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutostart } from "./autostart";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autostart", () => {
  it("starts a marked terminal on its first mount, once", () => {
    const autostart = createAutostart();
    const start = vi.fn();
    autostart.mark("a");
    expect(autostart.run("a", start)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(autostart.run("a", start)).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("ignores terminals nobody marked (restored ones)", () => {
    const start = vi.fn();
    expect(createAutostart().run("x", start)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts the agents of a group one after the other", () => {
    const autostart = createAutostart();
    const started: string[] = [];
    ["a", "b", "c"].forEach((id, i) => autostart.mark(id, i * 300));
    ["a", "b", "c"].forEach((id) => autostart.run(id, () => started.push(id)));
    expect(started).toEqual(["a"]);
    vi.advanceTimersByTime(300);
    expect(started).toEqual(["a", "b"]);
    vi.advanceTimersByTime(300);
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("never starts a terminal removed before its turn", () => {
    const autostart = createAutostart();
    const start = vi.fn();
    autostart.mark("a", 300);
    autostart.run("a", start);
    autostart.cancel("a");
    vi.advanceTimersByTime(1000);
    expect(start).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/nodes/terminal/autostart.test.ts`
Expected: FAIL — `./autostart` introuvable.

- [ ] **Step 3: Write the autostart module and wire it into the registry**

`src/nodes/terminal/autostart.ts` :

```ts
/**
 * Terminals created by the user start on their first mount, possibly after a
 * delay: a new group starts one agent every 300 ms (spec habillage §20).
 */
export function createAutostart(setTimer = setTimeout, clearTimer = clearTimeout) {
  const delays = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    mark: (nodeId: string, delayMs = 0) => {
      delays.set(nodeId, delayMs);
    },
    /** Runs `start` for a marked node, at once or after its delay; false if it was not marked. */
    run: (nodeId: string, start: () => void): boolean => {
      const delay = delays.get(nodeId);
      if (delay === undefined) return false;
      delays.delete(nodeId);
      if (delay <= 0) start();
      else
        timers.set(
          nodeId,
          setTimer(() => {
            timers.delete(nodeId);
            start();
          }, delay),
        );
      return true;
    },
    /** A removed node never starts. */
    cancel: (nodeId: string) => {
      delays.delete(nodeId);
      const timer = timers.get(nodeId);
      if (timer !== undefined) clearTimer(timer);
      timers.delete(nodeId);
    },
  };
}
```

`src/nodes/terminal/registry.ts` :
- importer `import { createAutostart } from "./autostart";` ;
- remplacer `const autostart = new Set<string>();` par `const autostart = createAutostart();` ;
- remplacer `markForAutostart` par :

```ts
/** A terminal just created starts on its first mount, `delayMs` later (groups stagger their agents). */
export function markForAutostart(nodeId: string, delayMs = 0) {
  autostart.mark(nodeId, delayMs);
}
```

- dans `mountTerminal`, remplacer `if (autostart.delete(nodeId)) void startSession(nodeId, entry.term, payload, "new");` et le `else if` qui suit par :

```ts
  const started = autostart.run(nodeId, () => {
    // The node may have been edited while it waited for its turn.
    const latest = nodesStore.getState().nodes[nodeId]?.payload ?? payload;
    void startSession(nodeId, entry.term, latest, "new");
  });
  if (started) return;
  if (livePtys.delete(nodeId)) void attachSession(nodeId, entry.term, entry.session);
  else void restoreSession(nodeId, entry.term);
```

- dans `disposeTerminal`, remplacer `autostart.delete(nodeId);` par `autostart.cancel(nodeId);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/nodes/terminal/autostart.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Place new terminals in their group (`terminals.ts`)**

Dans `src/fleet/terminals.ts`, nouveaux imports :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf, groupOf, insertIntoFrame } from "@/canvas/groups";
import { arrangeInFrame, freeCell } from "./groupLayout";
```

Remplacer `addTerminal` par :

```ts
/**
 * Adds a terminal centered on `center` (scene coordinates), or in the first
 * free cell of the group `groupId` (spec habillage §11.3), and starts it when
 * shown.
 */
export async function addTerminal(
  workspaceId: string,
  payload: TerminalPayload,
  center: Point,
  groupId: string | null = null,
): Promise<string | null> {
  const api = canvasStore.getState().api;
  if (!api) return null;
  const element = createNodeElement("terminal", center);
  // The node row must exist before the process can save its scrollback.
  await nodesStore.getState().create(element.id, { workspaceId, kind: "terminal", payload });
  markForAutostart(element.id);
  // Read after the wait: the scene may have changed meanwhile.
  const elements = api.getSceneElementsIncludingDeleted();
  const frame = groupId ? elements.find((e) => e.id === groupId && !e.isDeleted && groupInfoOf(e)) : undefined;
  api.updateScene({
    elements: frame ? joinGroup(elements, element, frame) : [...elements, element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element.id;
}

/** `elements` with `element` in the first free cell of `frame`, grown if it was full. */
function joinGroup(elements: readonly ExcalidrawElement[], element: ExcalidrawElement, frame: ExcalidrawElement) {
  const members = elements.filter((e) => !e.isDeleted && e.frameId === frame.id);
  const placed = freeCell(frame, members);
  return insertIntoFrame(
    elements,
    newElementWith(element, { x: placed.cell.x, y: placed.cell.y, frameId: frame.id }),
    newElementWith(frame, { width: placed.frame.width, height: placed.frame.height }),
  );
}
```

Remplacer `duplicateTerminal` par :

```ts
/** "Dupliquer" of the header: a copy of the agent to the right of the node, or in its group's grid. */
export async function duplicateTerminal(workspaceId: string, nodeId: string) {
  const element = canvasStore.getState().api?.getSceneElements().find((e) => e.id === nodeId);
  const source = nodesStore.getState().nodes[nodeId]?.payload;
  if (!element || !source) return;
  const group = groupOf(canvasStore.getState().frames, nodeId);
  const center = { x: element.x + element.width * 1.5 + 24, y: element.y + element.height / 2 };
  const name = await nameForNewAgent(workspaceId, group?.group.pantheon);
  await addTerminal(workspaceId, cloneTerminalPayload(source, name), center, group?.id ?? null);
}
```

Dans `adoptCopies`, remplacer la boucle et la mise à jour finale par :

```ts
  for (const { id, sourceId } of copies) {
    const source = nodesStore.getState().nodes[sourceId]?.payload;
    if (!source) continue;
    markForAutostart(id);
    const frameId = api.getSceneElementsIncludingDeleted().find((e) => e.id === id)?.frameId;
    const group = canvasStore.getState().frames.find((f) => f.id === frameId);
    const name = await nameForNewAgent(workspaceId, group?.group?.pantheon);
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload: cloneTerminalPayload(source, name) });
  }
  const ids = new Set(copies.map((copy) => copy.id));
  const linked = api
    .getSceneElementsIncludingDeleted()
    .map((e) => (ids.has(e.id) ? newElementWith(e, { link: `dummyplane://terminal/${e.id}` }) : e));
  api.updateScene({ elements: alignCopies(linked, ids), captureUpdate: CaptureUpdateAction.NEVER });
}

/** Copies made inside a group (Ctrl+D, copy-paste) take its first free cells too (spec §11.3). */
function alignCopies(elements: readonly ExcalidrawElement[], copyIds: ReadonlySet<string>): ExcalidrawElement[] {
  const byFrame = new Map<string, string[]>();
  for (const e of elements) {
    if (copyIds.has(e.id) && e.frameId) byFrame.set(e.frameId, [...(byFrame.get(e.frameId) ?? []), e.id]);
  }
  let result = [...elements];
  for (const [frameId, ids] of byFrame) {
    const frame = result.find((e) => e.id === frameId && !e.isDeleted);
    if (!frame || !groupInfoOf(frame)) continue;
    const members = result.filter((e) => !e.isDeleted && e.frameId === frameId && !copyIds.has(e.id));
    const placed = arrangeInFrame(frame, members, ids.length);
    const cells = new Map(ids.map((id, i) => [id, placed.cells[i]]));
    result = result.map((e) => {
      const cell = cells.get(e.id);
      if (cell) return newElementWith(e, { x: cell.x, y: cell.y });
      if (e.id === frameId) return newElementWith(e, { width: placed.frame.width, height: placed.frame.height });
      return e;
    });
  }
  return result;
}
```

- [ ] **Step 6: Agents placed in a group join it (`launchAgent.ts`)**

Remplacer `launchAgent` par :

```ts
/**
 * Creates and starts an agent of the active workspace at `center` (scene
 * coordinates). Inside a group it takes the group's next free cell and a name
 * from the group's pantheon (spec habillage §10.1, §11.3).
 */
export async function launchAgent(agent: AgentId, options: LaunchOptions, center: Point) {
  const workspaceId = workspacesStore.getState().activeId;
  if (!workspaceId) return;
  const group = groupAt(canvasStore.getState().frames, center);
  const name = await nameForNewAgent(workspaceId, group?.group.pantheon);
  await addTerminal(workspaceId, newTerminalPayload({ ...options, agent }, name), center, group?.id ?? null);
}
```

avec les imports `import { canvasStore } from "@/canvas/canvasStore";` et `import { groupAt } from "@/canvas/groups";`.

- [ ] **Step 7: Launch a whole group (`groups.ts`)**

`src/fleet/groups.ts` :

```ts
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createGroupFrame, isGroup } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import type { AgentId } from "@/ipc/pty";
import { newTerminalPayload } from "@/nodes/terminal/launch";
import { markForAutostart } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { groupGrid } from "./groupLayout";
import { defaultLaunchOptions, type LaunchOptions } from "./launchAgent";
import { nextName } from "./names";
import { nameForNewAgent, namesInWorkspace, pantheonForNewGroup } from "./naming";
import { viewportCenter } from "./placement";
import { ROLES, type RoleId } from "./roles";
import { addTerminal } from "./terminals";

export interface GroupPlan {
  name: string;
  role: RoleId;
  agents: AgentId[];
}

/** Time between two agents of a new group starting (spec habillage §20). */
export const LAUNCH_STAGGER_MS = 300;

/**
 * Creates a group around the view's center — its frame and terminals in one
 * scene update, so one undo removes it — then shows it whole and starts its
 * agents one by one (spec habillage §11.3).
 */
export async function launchGroup(plan: GroupPlan, options: LaunchOptions = defaultLaunchOptions()) {
  const { api, view } = canvasStore.getState();
  const workspaceId = workspacesStore.getState().activeId;
  if (!api || !workspaceId || plan.agents.length === 0) return;
  const pantheon = pantheonForNewGroup(workspaceId);
  const grid = groupGrid(plan.agents.length);
  const center = viewportCenter(view);
  const origin = { x: center.x - grid.width / 2, y: center.y - grid.height / 2 };
  const name = plan.name.trim() || ROLES[plan.role].label;
  const frame = createGroupFrame({ ...origin, width: grid.width, height: grid.height }, name, { role: plan.role, pantheon });
  const taken = namesInWorkspace(workspaceId);
  const terminals: ExcalidrawElement[] = [];
  for (const [i, agent] of plan.agents.entries()) {
    const cell = grid.cells[i];
    const node = createNodeElement("terminal", { x: origin.x + cell.x + cell.width / 2, y: origin.y + cell.y + cell.height / 2 });
    const agentName = nextName(pantheon, taken);
    taken.push(agentName);
    await nodesStore.getState().create(node.id, {
      workspaceId,
      kind: "terminal",
      payload: newTerminalPayload({ ...options, agent }, agentName),
    });
    markForAutostart(node.id, i * LAUNCH_STAGGER_MS);
    terminals.push({ ...node, frameId: frame.id });
  }
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...terminals, frame],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(frame, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, duration: 300, maxZoom: 1 });
}

/** "Ajouter un agent" of the group menu: the group's first free cell (spec §11.4). */
export async function addAgentToGroup(groupId: string, agent: AgentId) {
  const workspaceId = workspacesStore.getState().activeId;
  const group = canvasStore.getState().frames.find((f) => f.id === groupId);
  if (!workspaceId || !group || !isGroup(group)) return;
  const name = await nameForNewAgent(workspaceId, group.group.pantheon);
  const center = { x: group.x + group.width / 2, y: group.y + group.height / 2 };
  await addTerminal(workspaceId, newTerminalPayload({ ...defaultLaunchOptions(), agent }, name), center, groupId);
}
```

- [ ] **Step 8: The « Lancer 4 » chip**

Dans `src/shell/ui.tsx`, ajouter :

```tsx
/** A chip of the bottom row (spec habillage §5.6): dark fill, multicolor outline. */
export function ChipButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "ov-chip h-8 shrink-0 rounded-full px-3.5 text-[13px] font-semibold text-ov-text shadow-ov hover:brightness-125",
        className,
      )}
      {...props}
    />
  );
}
```

Remplacer `src/shell/ActionChips.tsx` par :

```tsx
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { nextGroupName } from "@/canvas/groups";
import { agentsStore } from "@/fleet/agentsStore";
import { defaultAgent } from "@/fleet/catalog";
import { launchGroup } from "@/fleet/groups";
import { defaultLaunchOptions, launchAgent } from "@/fleet/launchAgent";
import { viewportCenter } from "@/fleet/placement";
import { ChipButton } from "./ui";

const reportLaunchError = (error: unknown) => toast.error(`Lancement impossible : ${String(error)}`);

/** Chips above the command bar (spec habillage §5.6); J5 adds pause and resume. */
export function ActionChips() {
  const newConsole = () => {
    const agent = defaultAgent(agentsStore.getState().agents);
    const center = viewportCenter(canvasStore.getState().view);
    void launchAgent(agent, defaultLaunchOptions(), center).catch(reportLaunchError);
  };
  const launchFour = () => {
    const agent = defaultAgent(agentsStore.getState().agents);
    const name = nextGroupName(canvasStore.getState().frames);
    void launchGroup({ name, role: "general", agents: [agent, agent, agent, agent] }).catch(reportLaunchError);
  };
  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <ChipButton onClick={newConsole}>Nouvelle console</ChipButton>
      <ChipButton onClick={launchFour}>Lancer 4</ChipButton>
    </div>
  );
}
```

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm exec tsc --noEmit`
Expected: aucune erreur. Si le typage refuse `maxZoom` à côté de `fitToViewport`, lire le message : les options de `scrollToContent` en 0.18.1 acceptent `minZoom` et `maxZoom` dans les deux variantes.

Run: `pnpm test`
Expected: tous les tests passent.

- [ ] **Step 10: Check in the app**

Run (application d'essai, profil séparé de la vraie base) : `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'`

Vérifier : « Lancer 4 » crée quatre terminaux Shell (ou l'agent par défaut) en grille 4 × 1, la vue cadre le groupe sans dépasser 100 %, les quatre démarrent à environ 300 ms d'écart ; un Ctrl+Z retire le groupe entier ; « Nouvelle console » avec le centre de la vue dans le cadre ajoute un cinquième terminal sur une nouvelle ligne, et le cadre s'agrandit ; « Dupliquer » d'un membre le range dans la case suivante. À ce stade, le cadre n'a ni contour ni étiquette (tâche 6) : on le voit à la sélection.

- [ ] **Step 11: Commit**

```bash
git add src/nodes/terminal/autostart.ts src/nodes/terminal/autostart.test.ts src/nodes/terminal/registry.ts src/fleet/terminals.ts src/fleet/launchAgent.ts src/fleet/groups.ts src/shell/ui.tsx src/shell/ActionChips.tsx
git commit -m "feat(groups): launch a group and line up terminals opened in a group"
```

---

### Task 6: Contours, étiquettes et point d'identité

**Files:**
- Create: `src/fleet/groupSummary.ts`, `src/fleet/groupSummary.test.ts`
- Modify: `src/fleet/placement.ts`, `src/fleet/placement.test.ts` (`screenRectOf`)
- Create: `src/canvas/overlay/GroupBackdrops.tsx`, `src/canvas/overlay/GroupLabels.tsx`
- Modify: `src/canvas/Canvas.tsx`, `src/theme/excalidraw.css`, `src/nodes/terminal/TerminalHeader.tsx`

**Interfaces:**
- Consumes: `canvasStore.frames`, `view.editingFrame`, `isGroup`, `groupOf`, `SceneGroup` (tâche 2) ; `ROLES` (tâche 2) ; `terminalStatusStore`.
- Produces: `countsText(members: number, working: number): string` ; `screenRectOf(rect: Rect, view): Rect` (position dans le canvas, sans le décalage du canvas) ; `GroupBackdrops`, `GroupLabels` (sans menu ; la tâche 7 l'ajoute).

- [ ] **Step 1: Write the failing tests**

`src/fleet/groupSummary.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { countsText } from "./groupSummary";

describe("countsText", () => {
  it("shows the members and those at work", () => {
    expect(countsText(4, 2)).toBe("4 · 2 en cours");
  });

  it("says inactif when nobody works", () => {
    expect(countsText(3, 0)).toBe("3 · inactif");
    expect(countsText(0, 0)).toBe("0 · inactif");
  });
});
```

Dans `src/fleet/placement.test.ts`, ajouter `screenRectOf` à l'import, puis :

```ts
describe("screenRectOf", () => {
  it("maps a scene rectangle into the canvas like Excalidraw does", () => {
    expect(screenRectOf({ x: 300, y: -40, width: 100, height: 50 }, view)).toEqual({ x: 100, y: 5, width: 50, height: 25 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/fleet/groupSummary.test.ts src/fleet/placement.test.ts`
Expected: FAIL — `./groupSummary` introuvable, `screenRectOf` non exporté.

- [ ] **Step 3: Write the pure helpers**

`src/fleet/groupSummary.ts` :

```ts
/**
 * Counters of a group label (spec habillage §11.4): "4 · 2 en cours", or
 * "4 · inactif". Until J3, "en cours" counts the running members.
 */
export function countsText(members: number, working: number): string {
  return `${members} · ${working > 0 ? `${working} en cours` : "inactif"}`;
}
```

Dans `src/fleet/placement.ts`, ajouter `import type { Rect } from "@/canvas/groups";` et :

```ts
/** Where a scene rectangle shows inside the canvas (Excalidraw's mapping, without the canvas offset). */
export function screenRectOf(rect: Rect, view: Viewport): Rect {
  return {
    x: (rect.x + view.scrollX) * view.zoom,
    y: (rect.y + view.scrollY) * view.zoom,
    width: rect.width * view.zoom,
    height: rect.height * view.zoom,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/fleet/groupSummary.test.ts src/fleet/placement.test.ts`
Expected: PASS.

- [ ] **Step 5: Draw the outlines and the labels**

`src/canvas/overlay/GroupBackdrops.tsx` :

```tsx
import { screenRectOf } from "@/fleet/placement";
import { ROLES } from "@/fleet/roles";
import { useCanvas } from "../canvasStore";

/**
 * Frame outlines, painted under the transparent canvas (spec habillage §11.4):
 * tinted with the role's color for groups, sober grey for plain frames.
 */
export function GroupBackdrops() {
  const frames = useCanvas((s) => s.frames);
  const view = useCanvas((s) => s.view);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {frames.map((frame) => {
        const rect = screenRectOf(frame, view);
        const color = frame.group ? ROLES[frame.group.role].color : null;
        return (
          <div
            key={frame.id}
            className="absolute border"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              borderRadius: 12 * view.zoom,
              borderColor: color
                ? `color-mix(in srgb, ${color} 60%, transparent)`
                : "color-mix(in srgb, var(--ov-text-2) 45%, transparent)",
              backgroundColor: color ? `color-mix(in srgb, ${color} 4%, transparent)` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
```

`src/canvas/overlay/GroupLabels.tsx` :

```tsx
import { useStore } from "zustand";
import { countsText } from "@/fleet/groupSummary";
import { screenRectOf } from "@/fleet/placement";
import { ROLES } from "@/fleet/roles";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useCanvas, type CanvasView } from "../canvasStore";
import { isGroup, type SceneGroup } from "../groups";

/** The label sits on the frame's top edge, 16 px from its corner, like a tab (spec §11.4). */
const LABEL_INSET = 16;
const LABEL_HEIGHT = 24;

/**
 * Group labels, above the canvas. Excalidraw's own frame name stays below as
 * the handle that selects, drags and renames the frame: excalidraw.css gives
 * it the label's font and place, and it is made transparent here.
 */
export function GroupLabels() {
  const frames = useCanvas((s) => s.frames);
  const view = useCanvas((s) => s.view);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const groups = frames.filter(isGroup);
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      <style>{groups.map((g) => `.excalidraw [id$="-frame-name-${g.id}"]{color:transparent!important}`).join("\n")}</style>
      {groups.map((group) =>
        group.id === view.editingFrame ? null : (
          <GroupLabel
            key={group.id}
            group={group}
            view={view}
            working={group.memberIds.filter((id) => statuses[id]?.state === "running").length}
          />
        ),
      )}
    </div>
  );
}

function GroupLabel({ group, view, working }: { group: SceneGroup; view: CanvasView; working: number }) {
  const rect = screenRectOf(group, view);
  const role = ROLES[group.group.role];
  return (
    <div
      className="absolute flex items-center rounded-t-lg border border-b-0 bg-ov-surface pr-1.5 text-[11px] whitespace-nowrap"
      style={{
        // One pixel left so the name lines up with the native one under it, despite the border.
        left: rect.x + LABEL_INSET - 1,
        top: rect.y - LABEL_HEIGHT,
        height: LABEL_HEIGHT,
        borderColor: `color-mix(in srgb, ${role.color} 60%, transparent)`,
      }}
    >
      <span className="grid w-7 shrink-0 place-items-center">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: role.color }} />
      </span>
      <span className="font-semibold tracking-[0.08em] text-ov-text uppercase">{group.name}</span>
      <span className="ml-2 font-mono text-ov-text-2">{countsText(group.memberIds.length, working)}</span>
    </div>
  );
}
```

Dans `src/canvas/Canvas.tsx`, importer `GroupBackdrops` et `GroupLabels` depuis `./overlay/…`, puis remplacer le rendu de `LoadedCanvas` par :

```tsx
    <div className="absolute inset-0">
      <DotGrid />
      <GroupBackdrops />
      <div className="absolute inset-0">
        <Excalidraw
          theme="dark"
          langCode="fr-FR"
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={onChange}
          UIOptions={EXCALIDRAW_UI_OPTIONS}
          validateEmbeddable={isdummyPlaneLink}
          renderEmbeddable={(element) => <NodeHost element={element} />}
        />
      </div>
      <GroupLabels />
    </div>
```

Ajouter à la fin de `src/theme/excalidraw.css` :

```css
/* Frame names (spec habillage §11.4). Excalidraw's name stays the handle that
   selects, drags and renames a frame; it takes the font and the place of our
   group label (a 28 px room for the dot, 16 px from the corner, on the top
   edge) so that what you grab is what you see. GroupLabels makes the names of
   groups transparent and draws its label over them. */
.excalidraw [id*="-frame-name-"] {
  padding-left: 28px;
  font-family: "Geist Variable", sans-serif;
  font-size: 11px !important;
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 24px !important;
  text-transform: uppercase;
  transform: translate(16px, 3px);
}
```

Dans `src/nodes/terminal/TerminalHeader.tsx`, importer `useCanvas` (`@/canvas/canvasStore`), `groupOf` (`@/canvas/groups`) et `ROLES` (`@/fleet/roles`) ; dans `TerminalHeader`, après `const meta = …` :

```tsx
  const role = useCanvas((s) => groupOf(s.frames, nodeId)?.group.role);
```

et remplacer le point `<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ov-idle" />` par :

```tsx
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: role ? ROLES[role].color : "var(--ov-idle)" }}
      />
```

- [ ] **Step 6: Run the suite and the type check**

Run: `pnpm exec tsc --noEmit` puis `pnpm test`
Expected: aucune erreur, tous les tests passent.

- [ ] **Step 7: Check in the app**

Dans l'application d'essai (profil `dev.dummyplane.probe`), « Lancer 4 » puis vérifier :
- contour du cadre à la couleur du rôle (gris pour Général), fond très légèrement teinté, rayon proportionnel au zoom ;
- étiquette en onglet sur le bord haut, à 16 px du coin : point, `GROUPE 1`, `4 · 4 en cours` ; aucun nom natif visible en double ;
- saisir l'étiquette par son nom sélectionne le cadre et le déplace avec ses terminaux ; double-clic sur le nom : l'éditeur natif s'ouvre, l'étiquette se masque pendant l'édition ;
- un cadre dessiné à la main (touche F) garde un nom gris et reçoit un contour gris ;
- l'en-tête des membres montre le point à la couleur du rôle ; glisser un terminal hors du cadre le remet en gris et fait passer le compteur à 3 ;
- changer d'onglet de workspace : aucune étiquette ni contour de l'ancien workspace ne reste affiché ;
- si une étiquette passe au-dessus du panneau de propriétés d'Excalidraw, baisser le `z-[5]` de `GroupLabels` (consigner le choix).

- [ ] **Step 8: Commit**

```bash
git add src/fleet/groupSummary.ts src/fleet/groupSummary.test.ts src/fleet/placement.ts src/fleet/placement.test.ts src/canvas/overlay/GroupBackdrops.tsx src/canvas/overlay/GroupLabels.tsx src/canvas/Canvas.tsx src/theme/excalidraw.css src/nodes/terminal/TerminalHeader.tsx
git commit -m "feat(groups): frame outlines, tab labels and the members' identity dot"
```

---

### Task 7: Menu du groupe : renommer, ajouter, dégrouper, fermer

**Files:**
- Modify: `src/fleet/catalog.ts`, `src/fleet/catalog.test.ts` (`AGENTS_WITHOUT_OPTIONS`)
- Modify: `src/nodes/terminal/TerminalHeader.tsx` (réutilise `AGENTS_WITHOUT_OPTIONS`)
- Modify: `src/fleet/groupSummary.ts`, `src/fleet/groupSummary.test.ts` (`livingAgents`)
- Modify: `src/fleet/groups.ts` (`renameGroup`, `ungroup`, `closeGroup`, `requestCloseGroup`)
- Modify: `src/store/ui.ts` (`closingGroup`)
- Create: `src/fleet/GroupMenu.tsx`, `src/shell/CloseGroupDialog.tsx`
- Modify: `src/canvas/overlay/GroupLabels.tsx`, `src/shell/ProjectView.tsx`

**Interfaces:**
- Consumes: `addAgentToGroup` (tâche 5) ; `GroupLabels` (tâche 6) ; `isRunning`.
- Produces: `AGENTS_WITHOUT_OPTIONS: AgentId[]` ; `livingAgents(memberIds, nameOf, running): string[]` ; `renameGroup(id)`, `ungroup(id)`, `closeGroup(id)`, `requestCloseGroup(id)` ; `uiStore.closingGroup` / `setClosingGroup`.

- [ ] **Step 1: Write the failing tests**

Dans `src/fleet/catalog.test.ts`, ajouter `AGENTS_WITHOUT_OPTIONS` à l'import de `./catalog`, puis :

```ts
it("lists the agents that start without options, in catalog order", () => {
  expect(AGENTS_WITHOUT_OPTIONS).toEqual(["claude", "codex", "gemini", "qwen", "cursor", "opencode", "aider", "shell"]);
});
```

Dans `src/fleet/groupSummary.test.ts`, ajouter `livingAgents` à l'import, puis :

```ts
describe("livingAgents", () => {
  it("names the members still running, in group order", () => {
    const names: Record<string, string> = { a: "Isis", b: "Osiris", c: "Horus" };
    expect(livingAgents(["a", "b", "c"], (id) => names[id], (id) => id !== "b")).toEqual(["Isis", "Horus"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/fleet/catalog.test.ts src/fleet/groupSummary.test.ts`
Expected: FAIL — `AGENTS_WITHOUT_OPTIONS` et `livingAgents` non exportés.

- [ ] **Step 3: Write the helpers**

Dans `src/fleet/catalog.ts`, après `AGENT_ORDER` :

```ts
/** Agents that start without options: Ollama needs a model, Personnalisé a command. */
export const AGENTS_WITHOUT_OPTIONS = AGENT_ORDER.filter((id) => id !== "ollama" && id !== "custom");
```

Dans `src/nodes/terminal/TerminalHeader.tsx`, supprimer la constante `SWITCHABLE` et son commentaire, importer `AGENTS_WITHOUT_OPTIONS` à la place d'`AGENT_ORDER`, et itérer sur `AGENTS_WITHOUT_OPTIONS` dans le menu d'agent.

Dans `src/fleet/groupSummary.ts` :

```ts
/** Names of the members still running, listed by the "Fermer le groupe" confirmation (spec §11.4). */
export function livingAgents(
  memberIds: readonly string[],
  nameOf: (id: string) => string,
  running: (id: string) => boolean,
): string[] {
  return memberIds.filter(running).map(nameOf);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/fleet/catalog.test.ts src/fleet/groupSummary.test.ts`
Expected: PASS.

- [ ] **Step 5: Scene operations of the menu**

Dans `src/fleet/groups.ts`, ajouter `newElementWith` à l'import d'Excalidraw, `isRunning` (`@/store/terminalStatus`) et `uiStore` (`@/store/ui`), puis :

```ts
/** "Renommer": Excalidraw's own frame name editor opens over the label. */
export function renameGroup(groupId: string) {
  canvasStore.getState().api?.updateScene({ appState: { editingFrame: groupId } });
}

/** "Dégrouper": the frame goes, its terminals stay where they are (spec §11.4). */
export function ungroup(groupId: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((e) => {
      if (e.id === groupId) return newElementWith(e, { isDeleted: true });
      if (e.frameId === groupId) return newElementWith(e, { frameId: null });
      return e;
    }),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** "Fermer le groupe": the frame and its terminals go; one undo brings them back, stopped. */
export function closeGroup(groupId: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (!e.isDeleted && (e.id === groupId || e.frameId === groupId) ? newElementWith(e, { isDeleted: true }) : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Asks first when agents of the group are still running (spec §11.4). */
export function requestCloseGroup(groupId: string) {
  const group = canvasStore.getState().frames.find((f) => f.id === groupId);
  if (group?.memberIds.some(isRunning)) uiStore.getState().setClosingGroup(groupId);
  else closeGroup(groupId);
}
```

Dans `src/store/ui.ts`, ajouter à `UiState` :

```ts
  /** The group whose closing waits for confirmation (some of its agents run). */
  closingGroup: string | null;
  setClosingGroup: (groupId: string | null) => void;
```

et au store : `closingGroup: null, setClosingGroup: (closingGroup) => set({ closingGroup }),`.

- [ ] **Step 6: The menu and the confirmation**

`src/fleet/GroupMenu.tsx` :

```tsx
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgents } from "./agentsStore";
import { AGENTS, AGENTS_WITHOUT_OPTIONS } from "./catalog";
import { addAgentToGroup, renameGroup, requestCloseGroup, ungroup } from "./groups";

/** The `⌄` of a group label (spec habillage §11.4); J5 adds the orchestrator, pause and resume. */
export function GroupMenu({ groupId }: { groupId: string }) {
  const agents = useAgents((s) => s.agents);
  const available = (id: string) => agents.some((agent) => agent.id === id && agent.available);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu du groupe"
          className="pointer-events-auto ml-1 grid size-5 place-items-center rounded text-ov-text-2 hover:bg-ov-card hover:text-ov-text"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      {/* Focus must not come back to the trigger: it would close Excalidraw's name editor. */}
      <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={() => requestAnimationFrame(() => renameGroup(groupId))}>Renommer</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Ajouter un agent</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {AGENTS_WITHOUT_OPTIONS.map((id) => {
              const meta = AGENTS[id];
              return (
                <DropdownMenuItem
                  key={id}
                  disabled={!available(id)}
                  onSelect={() =>
                    void addAgentToGroup(groupId, id).catch((error: unknown) =>
                      toast.error(`Lancement impossible : ${String(error)}`),
                    )
                  }
                >
                  <meta.Icon style={{ color: meta.tint }} /> {meta.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => ungroup(groupId)}>Dégrouper</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => requestCloseGroup(groupId)}>
          Fermer le groupe
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Dans `src/canvas/overlay/GroupLabels.tsx`, importer `GroupMenu` (`@/fleet/GroupMenu`) et ajouter après le `<span>` des compteurs :

```tsx
      <GroupMenu groupId={group.id} />
```

`src/shell/CloseGroupDialog.tsx` :

```tsx
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCanvas } from "@/canvas/canvasStore";
import { closeGroup } from "@/fleet/groups";
import { livingAgents } from "@/fleet/groupSummary";
import { useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore, useUi } from "@/store/ui";

/** "Fermer le groupe Backend ?" listing the agents still running (spec habillage §11.4). */
export function CloseGroupDialog() {
  const groupId = useUi((s) => s.closingGroup);
  const group = useCanvas((s) => s.frames.find((f) => f.id === groupId) ?? null);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const living = group
    ? livingAgents(group.memberIds, (id) => nodes[id]?.payload.name || "Agent", (id) => statuses[id]?.state === "running")
    : [];
  const close = () => uiStore.getState().setClosingGroup(null);

  return (
    <Dialog open={groupId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Fermer le groupe {group?.name} ?</DialogTitle>
          <DialogDescription>
            Ces agents tournent encore ; fermer le groupe met fin à leur session : {living.join(", ")}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button
            className="bg-ov-danger text-white hover:bg-ov-danger/90"
            onClick={() => {
              if (groupId) closeGroup(groupId);
              close();
            }}
          >
            Fermer le groupe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Dans `src/shell/ProjectView.tsx`, importer `CloseGroupDialog` et l'ajouter après `<CloseAgentDialog />`.

- [ ] **Step 7: Run the suite and the type check**

Run: `pnpm exec tsc --noEmit` puis `pnpm test`
Expected: aucune erreur, tous les tests passent. Si `updateScene` refuse `editingFrame` dans `appState`, lire le type `SceneData["appState"]` de 0.18.1 avant toute autre solution.

- [ ] **Step 8: Check in the app**

Sur un groupe de 4 Shell :
- « Renommer » : l'éditeur natif s'ouvre et reste ouvert pendant la frappe ; Entrée valide, le nouveau nom apparaît dans l'étiquette ;
- « Ajouter un agent › Shell » : un cinquième terminal sur une nouvelle ligne, prénom du panthéon du groupe ;
- « Dégrouper » : le cadre et l'étiquette disparaissent, les terminaux restent en place, points d'identité gris ; Ctrl+Z rétablit le groupe ;
- « Fermer le groupe » avec des agents en marche : la confirmation liste leurs prénoms ; confirmer retire cadre et terminaux ; Ctrl+Z les ramène arrêtés ;
- groupe dont aucun agent ne tourne : fermeture sans confirmation.

- [ ] **Step 9: Commit**

```bash
git add src/fleet/catalog.ts src/fleet/catalog.test.ts src/nodes/terminal/TerminalHeader.tsx src/fleet/groupSummary.ts src/fleet/groupSummary.test.ts src/fleet/groups.ts src/store/ui.ts src/fleet/GroupMenu.tsx src/shell/CloseGroupDialog.tsx src/canvas/overlay/GroupLabels.tsx src/shell/ProjectView.tsx
git commit -m "feat(groups): group menu to rename, add an agent, ungroup or close"
```

---

### Task 8: Composer un groupe

**Files:**
- Create: `src/fleet/composer.ts`, `src/fleet/composer.test.ts`
- Create: `src/fleet/ComposeGroup.tsx`
- Modify: `src/shell/ActionChips.tsx`

**Interfaces:**
- Consumes: `launchGroup`, `GroupPlan` (tâche 5) ; `ROLES`, `ROLE_ORDER`, `RoleId` (tâche 2) ; `AGENTS_WITHOUT_OPTIONS` (tâche 7) ; `ChipButton` (tâche 5) ; `defaultAgent`, `useAgents`.
- Produces: `DEFAULT_GROUP_SIZE = 4`, `MAX_GROUP_SIZE = 12`, `type Slot = AgentId | null`, `resizeSlots(slots, count): Slot[]`, `nameAfterRoleChange(name, previous, next): string`, `agentsOf(slots, fallback): AgentId[]` ; `ComposeGroup` (puce « Groupe » et son popover).

- [ ] **Step 1: Write the failing test**

`src/fleet/composer.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { agentsOf, nameAfterRoleChange, resizeSlots } from "./composer";

describe("resizeSlots", () => {
  it("keeps the agents already chosen and adds default slots", () => {
    expect(resizeSlots(["codex"], 3)).toEqual(["codex", null, null]);
  });

  it("drops the last slots when the group shrinks", () => {
    expect(resizeSlots(["codex", "claude", null], 2)).toEqual(["codex", "claude"]);
  });

  it("keeps a group between 1 and 12 agents", () => {
    expect(resizeSlots([], 0)).toHaveLength(1);
    expect(resizeSlots([], 40)).toHaveLength(12);
  });
});

describe("nameAfterRoleChange", () => {
  it("follows the role while the name is the role's label", () => {
    expect(nameAfterRoleChange("Général", "general", "backend")).toBe("Backend");
  });

  it("follows the role when the field is empty", () => {
    expect(nameAfterRoleChange("  ", "general", "docs")).toBe("Docs");
  });

  it("keeps a name the user typed", () => {
    expect(nameAfterRoleChange("API v2", "general", "backend")).toBe("API v2");
  });
});

describe("agentsOf", () => {
  it("gives the default agent to the slots nobody chose", () => {
    expect(agentsOf(["codex", null], "claude")).toEqual(["codex", "claude"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/fleet/composer.test.ts`
Expected: FAIL — `./composer` introuvable.

- [ ] **Step 3: Write the implementation**

`src/fleet/composer.ts` :

```ts
import type { AgentId } from "@/ipc/pty";
import { ROLES, type RoleId } from "./roles";

export const DEFAULT_GROUP_SIZE = 4;
/** Spec habillage §20: at most 12 agents per group. */
export const MAX_GROUP_SIZE = 12;

/** A slot of "Composer un groupe": an agent, or null for the default agent. */
export type Slot = AgentId | null;

/** The slots of a group of `count` agents (1 to 12), keeping those already chosen. */
export function resizeSlots(slots: readonly Slot[], count: number): Slot[] {
  const n = Math.min(MAX_GROUP_SIZE, Math.max(1, Math.round(count)));
  return Array.from({ length: n }, (_, i) => slots[i] ?? null);
}

/** The name field follows the role until the user types another name (spec §11.2). */
export function nameAfterRoleChange(name: string, previous: RoleId, next: RoleId): string {
  const typed = name.trim();
  return typed === "" || typed === ROLES[previous].label ? ROLES[next].label : name;
}

export function agentsOf(slots: readonly Slot[], fallback: AgentId): AgentId[] {
  return slots.map((slot) => slot ?? fallback);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/fleet/composer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: The popover and the « Groupe » chip**

`src/fleet/ComposeGroup.tsx` :

```tsx
import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AgentId } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { ChipButton } from "@/shell/ui";
import { agentsStore, useAgents } from "./agentsStore";
import { AGENTS, AGENTS_WITHOUT_OPTIONS, defaultAgent } from "./catalog";
import { agentsOf, DEFAULT_GROUP_SIZE, MAX_GROUP_SIZE, nameAfterRoleChange, resizeSlots, type Slot } from "./composer";
import { launchGroup } from "./groups";
import { ROLE_ORDER, ROLES, type RoleId } from "./roles";

function AgentLogo({ agent, className }: { agent: AgentId; className?: string }) {
  const meta = AGENTS[agent];
  return (
    <span
      className={cn("grid size-7 place-items-center rounded-md", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: meta.tint }}
    >
      <meta.Icon className="size-4" />
    </span>
  );
}

/** A slot of the grid: the agent's logo and label; a click opens the agents (spec §11.2). */
function SlotButton(props: { agent: AgentId; choices: AgentId[]; onPick: (agent: AgentId) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[10px] border border-ov-line bg-ov-card hover:border-ov-text-2"
        >
          <AgentLogo agent={props.agent} />
          <span className="max-w-full truncate px-1 text-[11px] text-ov-text">{AGENTS[props.agent].label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.choices.map((id) => {
          const meta = AGENTS[id];
          return (
            <DropdownMenuItem key={id} onSelect={() => props.onPick(id)}>
              <meta.Icon style={{ color: meta.tint }} /> {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Composer un groupe", anchored above the « Groupe » chip (spec habillage §11.2). */
export function ComposeGroup() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<RoleId>("general");
  const [name, setName] = useState(ROLES.general.label);
  const [slots, setSlots] = useState<Slot[]>(resizeSlots([], DEFAULT_GROUP_SIZE));
  const agents = useAgents((s) => s.agents);
  const fallback = defaultAgent(agents);
  const choices = AGENTS_WITHOUT_OPTIONS.filter((id) => agents.some((a) => a.id === id && a.available));
  const color = ROLES[role].color;

  useEffect(() => {
    if (!open) return;
    setRole("general");
    setName(ROLES.general.label);
    setSlots(resizeSlots([], DEFAULT_GROUP_SIZE));
    void agentsStore.getState().load();
  }, [open]);

  const pickRole = (next: RoleId) => {
    setName((current) => nameAfterRoleChange(current, role, next));
    setRole(next);
  };

  const launch = () => {
    setOpen(false);
    void launchGroup({ name, role, agents: agentsOf(slots, fallback) }).catch((error: unknown) =>
      toast.error(`Lancement impossible : ${String(error)}`),
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton>Groupe</ChipButton>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className="flex w-[360px] flex-col gap-3 p-3">
        <p className="ov-label">Composer un groupe</p>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-ov-line bg-ov-card px-2.5">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Nom du groupe"
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ov-text outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_ORDER.map((id) => {
            const active = id === role;
            return (
              <button
                key={id}
                type="button"
                onClick={() => pickRole(id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                  active ? "font-semibold text-ov-canvas" : "border-ov-line text-ov-text-2 hover:text-ov-text",
                )}
                style={active ? { backgroundColor: ROLES[id].color, borderColor: ROLES[id].color } : undefined}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: active ? "var(--ov-canvas)" : ROLES[id].color }}
                />
                {ROLES[id].label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {slots.map((slot, i) => (
            <SlotButton
              key={i}
              agent={slot ?? fallback}
              choices={choices}
              onPick={(agent) => setSlots((current) => current.map((s, j) => (j === i ? agent : s)))}
            />
          ))}
        </div>
        {choices.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-ov-text-2">
            <span className="mr-1">Tout remplir avec</span>
            {choices.map((id) => (
              <button
                key={id}
                type="button"
                title={AGENTS[id].label}
                aria-label={`Tout remplir avec ${AGENTS[id].label}`}
                onClick={() => setSlots((current) => current.map(() => id))}
                className="rounded-md hover:brightness-125"
              >
                <AgentLogo agent={id} className="size-6" />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-ov-line pt-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Un agent de moins"
              disabled={slots.length <= 1}
              onClick={() => setSlots((current) => resizeSlots(current, current.length - 1))}
              className="grid size-7 place-items-center rounded-full text-ov-text-2 hover:bg-ov-card hover:text-ov-text disabled:opacity-40"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-6 text-center font-mono text-[13px] text-ov-text">{slots.length}</span>
            <button
              type="button"
              aria-label="Un agent de plus"
              disabled={slots.length >= MAX_GROUP_SIZE}
              onClick={() => setSlots((current) => resizeSlots(current, current.length + 1))}
              className="grid size-7 place-items-center rounded-full text-ov-text-2 hover:bg-ov-card hover:text-ov-text disabled:opacity-40"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={launch}
            className="h-8 rounded-full px-4 text-[13px] font-semibold text-ov-canvas hover:brightness-110"
            style={{ backgroundColor: color }}
          >
            Lancer {slots.length}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

Dans `src/shell/ActionChips.tsx`, importer `ComposeGroup` (`@/fleet/ComposeGroup`) et l'ajouter après le bouton « Lancer 4 ».

- [ ] **Step 6: Run the suite and the type check**

Run: `pnpm exec tsc --noEmit` puis `pnpm test`
Expected: aucune erreur, tous les tests passent.

- [ ] **Step 7: Check in the app**

« Groupe » ouvre le popover au-dessus de la puce : nom « Général » sélectionné ; cliquer Backend remplace le nom par « Backend » ; taper « API » puis cliquer Docs garde « API » ; − et + bornés à 1 et 12 ; un emplacement change d'agent par son menu ; « Tout remplir avec » remplit tout ; « Lancer 3 » à la couleur du rôle crée le groupe en grille 3 × 1, avec des prénoms d'un panthéon différent du groupe précédent.

- [ ] **Step 8: Commit**

```bash
git add src/fleet/composer.ts src/fleet/composer.test.ts src/fleet/ComposeGroup.tsx src/shell/ActionChips.tsx
git commit -m "feat(groups): compose a group with a role, a name and its agents"
```

---

### Task 9: Le fantôme de placement s'aligne sur la case du groupe

**Files:**
- Modify: `src/fleet/placement.ts`, `src/fleet/placement.test.ts` (`clientRectOf`)
- Modify: `src/fleet/PlacementGhost.tsx`

**Interfaces:**
- Consumes: `groupAt` (tâche 2), `freeCell` (tâche 3), `screenRectOf` (tâche 6), `sceneOf`, `ghostRect`.
- Produces: `clientRectOf(rect: Rect, view): { left; top; width; height }`.

- [ ] **Step 1: Write the failing test**

Dans `src/fleet/placement.test.ts`, ajouter `clientRectOf` à l'import, puis :

```ts
describe("clientRectOf", () => {
  it("adds the canvas offset: where the ghost of a terminal snapped into a group shows", () => {
    expect(clientRectOf({ x: 300, y: -40, width: 100, height: 50 }, view)).toEqual({ left: 110, top: 25, width: 50, height: 25 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/fleet/placement.test.ts`
Expected: FAIL — `clientRectOf` non exporté.

- [ ] **Step 3: Write the implementation**

Dans `src/fleet/placement.ts` :

```ts
/** Window rectangle of a scene rectangle: the ghost of a terminal snapped into a group cell. */
export function clientRectOf(rect: Rect, view: Viewport) {
  const screen = screenRectOf(rect, view);
  return { left: screen.x + view.offsetLeft, top: screen.y + view.offsetTop, width: screen.width, height: screen.height };
}
```

Dans `src/fleet/PlacementGhost.tsx`, importer `groupAt` (`@/canvas/groups`), `freeCell` (`./groupLayout`) et `clientRectOf` (`./placement`) ; remplacer `const zoom = useCanvas((s) => s.view.zoom);` par :

```tsx
  const view = useCanvas((s) => s.view);
  const frames = useCanvas((s) => s.frames);
```

et remplacer `const rect = pointer ? ghostRect(pointer, zoom) : null;` par :

```tsx
  // Over a group the ghost shows the cell the agent will take (spec §10.1, §11.3).
  const group = pointer ? groupAt(frames, sceneOf(pointer, view)) : null;
  const members = group ? (canvasStore.getState().api?.getSceneElements().filter((e) => e.frameId === group.id) ?? []) : [];
  const rect = group ? clientRectOf(freeCell(group, members).cell, view) : pointer ? ghostRect(pointer, view.zoom) : null;
```

Le texte d'aide devient :

```tsx
        {group ? `Clique pour l'ajouter au groupe ${group.name} · Échap pour annuler` : "Clique pour poser l'agent · Échap pour annuler"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/fleet/placement.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit` puis `pnpm test`
Expected: aucune erreur, tous les tests passent.

- [ ] **Step 5: Check in the app**

Menu Agent › Shell : hors d'un groupe, le rectangle suit le curseur ; au-dessus d'un groupe, il saute sur la première case libre et le texte d'aide nomme le groupe ; le clic pose le terminal exactement dans ce rectangle.

- [ ] **Step 6: Commit**

```bash
git add src/fleet/placement.ts src/fleet/placement.test.ts src/fleet/PlacementGhost.tsx
git commit -m "feat(groups): the placement ghost snaps to the group's next free cell"
```

---

## Vérifications manuelles de Mathieu (J4)

- Composer un groupe de 8 (6 Claude, 2 Codex) rôle Backend : prénoms d'un panthéon, puis un autre panthéon pour le groupe suivant ; lancement échelonné.
- Déplacer le cadre par son étiquette ; glisser un terminal hors du groupe, puis le remettre.
- Ouvrir un terminal dans un groupe par chacun des chemins (clic de placement, Nouvelle console au centre du cadre, Ajouter un agent, Dupliquer, Ctrl+D) : il se range dans la première case libre, le cadre s'agrandit quand il est plein.
- Renommer, Dégrouper, Fermer le groupe (confirmation listant les agents en marche), Ctrl+Z après chacun.
