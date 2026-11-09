# dummyPlane — Plan E1 : navigation au clavier (jalon J7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Piloter la flotte sans souris : Ctrl+Tab / Ctrl+Maj+Tab passent d'un terminal à l'autre (même en train d'écrire dans l'un d'eux) dans l'ordre de lecture du canvas, Maj+Échap rend la main au canvas, Ctrl+Maj+A montre tout le workspace — par un écouteur clavier unique adossé à un registre de commandes que la palette (J8) et le menu radial réutiliseront.

**Architecture:** Un écouteur `keydown` sur `window`, en phase de capture, traduit la touche en raccourci (`shortcutOf`, pur), cherche la commande disponible du registre (`src/commands/registry.ts`) et la consomme avant xterm, les champs et Excalidraw. Les comportements sont des fonctions séparées et testées : ordre de lecture par blocs (`terminalOrder`), mémoire du dernier terminal par workspace (`keyboardFocus`), arrivée sur un terminal (`arrive` : vue, activation, focus, signal), retour au canvas et vue d'ensemble (`canvasFocus`). Aucune nouvelle dépendance.

**Tech Stack:** React 19, TypeScript (lib ES2020), Zustand 5, Excalidraw 0.18.1 (figé), xterm 6, Tauri 2.12, Vitest 5 (happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md` (§3, §6, §8, §9, §10 J7, §11, §12), amendée par `docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md` §7 (zone utile, panneau Agents). Ordre des jalons fixé par Mathieu le 2026-10-25 : J7, J8, menu radial, puis R3.

## Global Constraints

- Raccourcis de J7 (spec fenêtre §6.1) : Ctrl+Tab « Terminal suivant », Ctrl+Maj+Tab « Terminal précédent » (projet ouvert, au moins un terminal dans le workspace affiché) ; Maj+Échap « Rendre la main au canvas », Ctrl+Maj+A « Vue d'ensemble » (projet ouvert). Ctrl+P et Ctrl+Maj+P sont reconnus mais n'ont pas de commande avant J8.
- Capture (spec fenêtre §6.2) : un écouteur `keydown` unique sur `window`, phase de capture, installé au démarrage pour toute la durée de l'application. Une touche reconnue dont la fonction est disponible est consommée (`preventDefault`, arrêt de la propagation) ; reconnue mais indisponible : pas consommée.
- Reconnaissance : lettres par `event.key`, insensible à la casse ; Tab et Échap par leur nom ; une combinaison avec Alt (donc AltGr) n'est jamais un raccourci ; ignorées pendant une composition IME et quand un dialogue modal est ouvert ; répétition automatique permise pour Ctrl+Tab et Ctrl+Maj+Tab seulement.
- Ordre de Ctrl+Tab (spec fenêtre §6.3) : blocs (cadres contenant au moins un terminal) en ordre de lecture, leurs membres en ordre de lecture, puis les terminaux isolés ; ligne = chevauchement d'au moins la moitié de la plus petite hauteur avec le premier élément de la ligne ; rotation ignorée ; retour au début après le dernier.
- Départ : le terminal qui a le clavier ; sinon le dernier du workspace affiché à l'avoir eu, s'il existe encore ; sinon aucun (Ctrl+Tab → premier, Ctrl+Maj+Tab → dernier).
- Arrivée (spec fenêtre §6.4, zone utile amendée par spec identité §7) : la vue ne bouge pas si le zoom est de 100 % et le terminal entièrement dans la zone utile (canvas moins 72 px en haut et 60 px en bas) ; sinon le terminal à 100 %, centré dans cette zone. Le terminal est activé comme par un clic dans son corps, xterm prend le clavier, il n'est pas sélectionné ; sa bordure passe à `--ov-accent` puis revient en 600 ms.
- Maj+Échap (spec fenêtre §6.5) : le terminal ou le champ qui a le clavier le perd, le terminal actif est désactivé, aucune sélection, le clavier va au canvas (raccourcis d'Excalidraw actifs).
- Ctrl+Maj+A (spec fenêtre §6.6) : vue ajustée avec animation et marge de 10 % sur tous les nœuds (terminaux, orchestrateurs) du workspace affiché et leurs cadres de groupe ; sans nœud, toute la scène ; puis le clavier au canvas.
- Erreur d'une commande : toast « <Action> impossible : <raison> » (spec fenêtre §9).
- Interface en français ; code et commentaires en anglais ; libellés de raccourcis « Ctrl », « Maj », « Échap », « Tab ».
- TypeScript : lib ES2020 (ni `.at()`, ni `replaceAll`).
- Tests : `pnpm test` ; `pnpm exec tsc --noEmit` et `pnpm build` propres ; test ciblé : `pnpm exec vitest run <fichiers>`. Les tests qui chargent un module atteignant `@excalidraw/excalidraw` à l'exécution le simulent (`vi.mock("@excalidraw/excalidraw", () => ({}))`) ; ceux qui chargent `src/nodes/terminal/registry.ts` (xterm) simulent ce module. Les assertions sur des sources passent par `readSource` (`src/theme/cssBlocks.ts`).
- Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; supprimer les `*.stackdump` avant chaque commit.
- Ne jamais lancer l'exécutable release ni l'installateur depuis la session ; vérification sur le profil `dev.dummyplane.probe`, sans souris ni clavier si Mathieu peut être sur le poste.

### Décisions du plan (portées à Mathieu à la remise)

1. **Centrage à l'arrivée** : un terminal qui doit être déplacé est centré dans la zone utile (entre la barre des onglets et la bande du bas), et non au centre de la fenêtre comme `fullSizeView` : depuis R2, le canvas passe sous les barres.
2. **Mémoire du dernier terminal** : seule la saisie de xterm compte (« a eu le clavier ») ; un clic sur un bouton de l'en-tête ne change pas le point de départ de Ctrl+Tab.
3. **Ctrl+P et Ctrl+Maj+P** : reconnus dès J7 mais sans commande jusqu'à J8 ; d'ici là, ils se comportent comme aujourd'hui.
4. **Registre** : une commande = identifiant, libellé, section, mots-clés, raccourci, `available(ctx)`, `run(ctx)`. La palette (J8) y ajoutera ses fonctions ; le menu radial y ajoutera une icône.
5. **Vue d'ensemble** : elle cadre les nœuds et leurs cadres de groupe, pas les cadres de dessin (spec fenêtre §6.6, « leurs cadres de groupe »).

## Review Focus

1. Un terminal hors de l'écran (Excalidraw le masque) prend le clavier une fois la vue déplacée, pas avant (test : tâche 4, « focuses xterm on the next frame, after the view moved »).
2. Le terminal courant fermé entre-temps : Ctrl+Tab repart du premier, Ctrl+Maj+Tab du dernier (tests : tâche 2 `stepTerminal` « an unknown current terminal », tâche 6 « forgets a remembered terminal that left the canvas »).
3. Un dialogue modal ouvert (confirmation de fermeture, dialogues d'Excalidraw) : aucun raccourci n'agit et la touche lui parvient (test : tâche 6, « lets every key through while a modal dialog is open »).
4. Après Maj+Échap depuis un terminal, une touche d'Excalidraw (R, V…) agit : le clavier est dans le conteneur d'Excalidraw et le terminal n'est plus actif (test : tâche 5, « gives the keyboard to Excalidraw's container »).
5. Le point de départ de Ctrl+Tab est retenu par workspace : revenir sur un onglet reprend là où on en était (test : tâche 3, « remembers the last terminal of each workspace »).

---

## File Structure

- `src/commands/shortcuts.ts` (nouveau) : `Shortcut`, `shortcutOf` (pur), `isModalOpen`.
- `src/canvas/terminalOrder.ts` (nouveau) : `readingOrder`, `terminalOrder`, `stepTerminal` (purs).
- `src/canvas/keyboardFocus.ts` (nouveau) : terminal qui a le clavier, mémoire du dernier par workspace.
- `src/canvas/arrivalSignal.ts`, `src/nodes/terminal/ArrivalFlash.tsx` (nouveaux) : le signal d'arrivée.
- `src/canvas/arrive.ts` (nouveau) : `needsMove`, `arrivalView` (purs), `arrive`.
- `src/canvas/canvasFocus.ts` (nouveau) : `releaseToCanvas`, `overviewTargets` (pur), `overview`.
- `src/commands/command.ts`, `src/commands/registry.ts`, `src/commands/dispatch.ts` (nouveaux) : type `Command`, registre et contexte, écouteur global.
- `src/nodes/terminal/TerminalNode.tsx` : attribut `data-terminal`, signal d'arrivée.
- `src/index.css` : animation `ov-arrival`.
- `src/main.tsx` : installation de l'écouteur et du suivi du focus.

---

### Task 1: Les raccourcis

**Files:**
- Create: `src/commands/shortcuts.ts`
- Create: `src/commands/shortcuts.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `type Shortcut = "Ctrl+Tab" | "Ctrl+Maj+Tab" | "Ctrl+P" | "Ctrl+Maj+P" | "Maj+Échap" | "Ctrl+Maj+A"` ; `type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "repeat" | "isComposing">` ; `shortcutOf(event: KeyLike): Shortcut | null` ; `isModalOpen(root?: ParentNode): boolean`.

- [ ] **Step 1: Write the failing test**

`src/commands/shortcuts.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { isModalOpen, shortcutOf, type KeyLike } from "./shortcuts";

const key = (fields: Partial<KeyLike>): KeyLike => ({
  key: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  ...fields,
});

describe("shortcutOf (spec fenêtre §6.1, §6.2)", () => {
  it("recognizes each shortcut of the application", () => {
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true }))).toBe("Ctrl+Tab");
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Maj+Tab");
    expect(shortcutOf(key({ key: "p", ctrlKey: true }))).toBe("Ctrl+P");
    expect(shortcutOf(key({ key: "P", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Maj+P");
    expect(shortcutOf(key({ key: "Escape", shiftKey: true }))).toBe("Maj+Échap");
    expect(shortcutOf(key({ key: "A", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Maj+A");
  });

  it("reads the letter as printed: P on an AZERTY keyboard, whatever the case", () => {
    expect(shortcutOf({ ...key({ key: "p", ctrlKey: true }), code: "KeyP" } as KeyLike)).toBe("Ctrl+P");
    expect(shortcutOf(key({ key: "P", ctrlKey: true }))).toBe("Ctrl+P");
  });

  it("never makes a shortcut with Alt or AltGr, nor during an IME composition", () => {
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "p", ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, isComposing: true }))).toBeNull();
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it("lets a held key repeat Ctrl+Tab and Ctrl+Maj+Tab only", () => {
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, repeat: true }))).toBe("Ctrl+Tab");
    expect(shortcutOf(key({ key: "Tab", ctrlKey: true, shiftKey: true, repeat: true }))).toBe("Ctrl+Maj+Tab");
    expect(shortcutOf(key({ key: "A", ctrlKey: true, shiftKey: true, repeat: true }))).toBeNull();
    expect(shortcutOf(key({ key: "Escape", shiftKey: true, repeat: true }))).toBeNull();
  });

  it("ignores everything else: plain Tab, Escape alone, Ctrl+A, Ctrl+Échap", () => {
    for (const fields of [{ key: "Tab" }, { key: "Escape" }, { key: "a", ctrlKey: true }, { key: "Escape", ctrlKey: true, shiftKey: true }, { key: "r" }]) {
      expect(shortcutOf(key(fields))).toBeNull();
    }
  });
});

describe("isModalOpen", () => {
  afterEach(() => document.body.replaceChildren());

  it("sees an open dialog of ours or of Excalidraw, not a menu or a popover", () => {
    expect(isModalOpen()).toBe(false);
    document.body.innerHTML = '<div data-slot="dropdown-menu-content"></div><div data-slot="popover-content" role="dialog"></div>';
    expect(isModalOpen()).toBe(false);
    document.body.innerHTML = '<div data-slot="dialog-content"></div>';
    expect(isModalOpen()).toBe(true);
    document.body.innerHTML = '<div class="excalidraw excalidraw-modal-container"></div>';
    expect(isModalOpen()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/shortcuts.test.ts`
Expected: FAIL — `./shortcuts` introuvable.

- [ ] **Step 3: Write the shortcuts**

`src/commands/shortcuts.ts` :

```ts
/** The application's shortcuts (spec fenêtre §6.1), as the interface writes them. */
export type Shortcut = "Ctrl+Tab" | "Ctrl+Maj+Tab" | "Ctrl+P" | "Ctrl+Maj+P" | "Maj+Échap" | "Ctrl+Maj+A";

/** The part of a keydown event the shortcuts read. */
export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "repeat" | "isComposing">;

/** A held key repeats these only (spec fenêtre §6.2). */
const REPEATABLE: ReadonlySet<Shortcut> = new Set<Shortcut>(["Ctrl+Tab", "Ctrl+Maj+Tab"]);

function match(key: string, ctrl: boolean, shift: boolean): Shortcut | null {
  if (ctrl && key === "Tab") return shift ? "Ctrl+Maj+Tab" : "Ctrl+Tab";
  if (ctrl && key === "p") return shift ? "Ctrl+Maj+P" : "Ctrl+P";
  if (ctrl && shift && key === "a") return "Ctrl+Maj+A";
  if (!ctrl && shift && key === "Escape") return "Maj+Échap";
  return null;
}

/**
 * The shortcut a keydown makes, if any (spec fenêtre §6.2). Letters are read
 * as printed (`key`, any case: P is P in AZERTY as in QWERTY); Alt, hence
 * AltGr, never makes a shortcut, nor does a key typed during an IME composition.
 */
export function shortcutOf(event: KeyLike): Shortcut | null {
  if (event.isComposing || event.altKey || event.metaKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const shortcut = match(key, event.ctrlKey, event.shiftKey);
  if (!shortcut || (event.repeat && !REPEATABLE.has(shortcut))) return null;
  return shortcut;
}

/**
 * A modal dialog takes every key (spec fenêtre §6.2): ours (closing a node,
 * terminal options) and Excalidraw's, whose container only exists while open.
 */
export function isModalOpen(root: ParentNode = document): boolean {
  return root.querySelector('[data-slot="dialog-content"], .excalidraw-modal-container') !== null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/commands/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/shortcuts.ts src/commands/shortcuts.test.ts
git commit -m "feat(commands): recognize the application's shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: L'ordre de lecture

**Files:**
- Create: `src/canvas/terminalOrder.ts`
- Create: `src/canvas/terminalOrder.test.ts`

**Interfaces:**
- Consumes: `nodeKindOf(element)` (`src/canvas/nodeElement.ts`, renvoie `"terminal"` pour un embeddable dont `customData.kind === "terminal"`).
- Produces: `readingOrder<T extends Box>(boxes: readonly T[]): T[]` (où `Box = { x: number; y: number; width: number; height: number }`) ; `terminalOrder(elements: readonly ExcalidrawElement[]): string[]` ; `stepTerminal(order: readonly string[], current: string | null, direction: 1 | -1): string | null`.

- [ ] **Step 1: Write the failing test**

`src/canvas/terminalOrder.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { readingOrder, stepTerminal, terminalOrder } from "./terminalOrder";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 100, height: 100, isDeleted: false, frameId: null, angle: 0, ...fields }) as unknown as ExcalidrawElement;
const frame = (id: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  element({ id, type: "frame", name: id, x, y, width, height, ...fields });
const terminal = (id: string, frameId: string | null, x: number, y: number) =>
  element({ id, type: "embeddable", customData: { kind: "terminal" }, frameId, x, y, width: 300, height: 200 });

describe("terminalOrder (spec fenêtre §6.3)", () => {
  it("reads the spec's example: blocks in reading order, members row by row, isolated terminals last", () => {
    const scene = [
      element({ id: "ra", type: "embeddable", customData: { kind: "terminal" }, x: 1300, y: 820, width: 300, height: 200 }),
      frame("tests", 0, 800, 400, 300),
      terminal("ptah", "tests", 40, 840),
      frame("front", 900, 0, 400, 700),
      terminal("sekhmet", "front", 940, 480),
      terminal("horus", "front", 940, 40),
      terminal("bastet", "front", 940, 260),
      frame("backend", 0, 0, 800, 500, { customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } }),
      terminal("osiris", "backend", 420, 280),
      terminal("isis", "backend", 40, 40),
      terminal("anubis", "backend", 40, 280),
      terminal("thot", "backend", 420, 40),
    ];
    expect(terminalOrder(scene)).toEqual(["isis", "thot", "anubis", "osiris", "horus", "bastet", "sekhmet", "ptah", "ra"]);
  });

  it("puts two blocks on one row when they overlap by half the smaller height, on two rows below that", () => {
    const scene = (secondTop: number) => [
      frame("a", 1000, 0, 400, 200),
      terminal("in-a", "a", 1010, 0),
      frame("b", 0, secondTop, 400, 400),
      terminal("in-b", "b", 10, secondTop),
    ];
    // Overlap 100 = half of 200: same row, read left to right.
    expect(terminalOrder(scene(100))).toEqual(["in-b", "in-a"]);
    // Overlap 99: B opens a row below A.
    expect(terminalOrder(scene(101))).toEqual(["in-a", "in-b"]);
  });

  it("treats a drawing frame as a block, skips deleted elements and empty frames", () => {
    const scene = [
      frame("empty", 0, 0, 200, 200),
      frame("drawing", 500, 0, 400, 300),
      terminal("drawn", "drawing", 510, 10),
      terminal("alone", null, 0, 400),
      element({ id: "gone", type: "embeddable", customData: { kind: "terminal" }, x: 0, y: 0, isDeleted: true }),
      element({ id: "box", type: "rectangle", x: 0, y: 0 }),
    ];
    expect(terminalOrder(scene)).toEqual(["drawn", "alone"]);
  });
});

describe("readingOrder", () => {
  it("joins a row by its first box, then reads it left to right", () => {
    const boxes = [
      { id: "c", x: 0, y: 260, width: 10, height: 100 },
      { id: "b", x: 300, y: 10, width: 10, height: 100 },
      { id: "a", x: 0, y: 0, width: 10, height: 100 },
    ];
    expect(readingOrder(boxes).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("stepTerminal", () => {
  const order = ["isis", "thot", "anubis"];

  it("goes to the next or the previous terminal, wrapping around", () => {
    expect(stepTerminal(order, "isis", 1)).toBe("thot");
    expect(stepTerminal(order, "anubis", 1)).toBe("isis");
    expect(stepTerminal(order, "isis", -1)).toBe("anubis");
    expect(stepTerminal(order, "thot", -1)).toBe("isis");
  });

  it("starts at the first or the last without a current terminal, or with an unknown current terminal", () => {
    expect(stepTerminal(order, null, 1)).toBe("isis");
    expect(stepTerminal(order, null, -1)).toBe("anubis");
    expect(stepTerminal(order, "closed-meanwhile", 1)).toBe("isis");
    expect(stepTerminal(order, "closed-meanwhile", -1)).toBe("anubis");
  });

  it("goes nowhere in a workspace without terminals", () => {
    expect(stepTerminal([], null, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/canvas/terminalOrder.test.ts`
Expected: FAIL — `./terminalOrder` introuvable.

- [ ] **Step 3: Write the order**

`src/canvas/terminalOrder.ts` :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "./nodeElement";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box joins a row when it overlaps the row's first box by half the smaller height at least (spec fenêtre §6.3). */
function sameRow(first: Box, next: Box): boolean {
  const overlap = Math.min(first.y + first.height, next.y + next.height) - Math.max(first.y, next.y);
  return overlap >= Math.min(first.height, next.height) / 2;
}

/** Reading order: boxes taken from the top, gathered in rows, each row read left to right. */
export function readingOrder<T extends Box>(boxes: readonly T[]): T[] {
  const rows: T[][] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    const row = rows[rows.length - 1];
    if (row && sameRow(row[0], box)) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * Ctrl+Tab's order (spec fenêtre §6.3): each frame holding a terminal is a
 * block, blocks in reading order and their members in reading order, then
 * the terminals outside any frame. Rotation is ignored.
 */
export function terminalOrder(elements: readonly ExcalidrawElement[]): string[] {
  const live = elements.filter((e) => !e.isDeleted);
  const frames = new Map(live.filter((e) => e.type === "frame").map((f) => [f.id, f] as const));
  const members = new Map<string, ExcalidrawElement[]>();
  const isolated: ExcalidrawElement[] = [];
  for (const terminal of live.filter((e) => nodeKindOf(e) === "terminal")) {
    const frame = terminal.frameId ? frames.get(terminal.frameId) : undefined;
    if (!frame) {
      isolated.push(terminal);
      continue;
    }
    const list = members.get(frame.id) ?? [];
    list.push(terminal);
    members.set(frame.id, list);
  }
  const blocks = readingOrder([...members.keys()].map((id) => frames.get(id) as ExcalidrawElement));
  return [...blocks.flatMap((block) => readingOrder(members.get(block.id) ?? [])), ...readingOrder(isolated)].map((e) => e.id);
}

/**
 * The terminal after (1) or before (-1) `current`, wrapping around. Without a
 * current terminal, or with one no longer in `order`: the first or the last.
 */
export function stepTerminal(order: readonly string[], current: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index < 0) return direction === 1 ? order[0] : order[order.length - 1];
  return order[(index + direction + order.length) % order.length];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/canvas/terminalOrder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/canvas/terminalOrder.ts src/canvas/terminalOrder.test.ts
git commit -m "feat(canvas): terminals in reading order, by blocks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Le terminal qui a le clavier

**Files:**
- Create: `src/canvas/keyboardFocus.ts`
- Create: `src/canvas/keyboardFocus.test.ts`
- Modify: `src/nodes/terminal/TerminalNode.tsx` (racine du nœud)

**Interfaces:**
- Consumes: `nodesStore` (`src/store/nodes.ts` : `nodes[id].workspaceId`).
- Produces: `terminalOfElement(element: Element | null): string | null` ; `terminalWithKeyboard(doc?: Document): string | null` ; `trackTerminalFocus(doc?: Document): () => void` ; `lastTerminalOf(workspaceId: string): string | null` ; attribut `data-terminal="<nodeId>"` sur la racine de chaque nœud terminal.

- [ ] **Step 1: Write the failing test**

`src/canvas/keyboardFocus.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { readSource } from "@/theme/cssBlocks";
import { lastTerminalOf, terminalWithKeyboard, trackTerminalFocus } from "./keyboardFocus";

let untrack: () => void;

/** Focuses like a click or xterm would; the focusin is sent by hand in case the DOM emulation does not. */
const focusOn = (element: HTMLElement) => {
  element.focus();
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
};

const terminalNode = (nodeId: string) => {
  const root = document.createElement("div");
  root.dataset.terminal = nodeId;
  root.innerHTML = '<button type="button">Fermer</button><div><textarea></textarea></div>';
  document.body.append(root);
  const input = root.querySelector("textarea")!;
  const button = root.querySelector("button")!;
  return { input: { focus: () => focusOn(input) }, button: { focus: () => focusOn(button) } };
};

beforeAll(async () => {
  mockIPC(() => undefined);
  for (const [id, workspaceId] of [["isis", "w1"], ["thot", "w1"], ["horus", "w2"]]) {
    await nodesStore.getState().create(id, {
      workspaceId,
      kind: "terminal",
      payload: { title: id, name: id, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
  }
});
afterAll(() => clearMocks());
beforeEach(() => {
  untrack = trackTerminalFocus(document);
});
afterEach(() => {
  untrack();
  document.body.replaceChildren();
});

it("knows the terminal whose xterm has the keyboard, and none elsewhere", () => {
  const isis = terminalNode("isis");
  expect(terminalWithKeyboard()).toBeNull();
  isis.input.focus();
  expect(terminalWithKeyboard()).toBe("isis");
  isis.button.focus();
  expect(terminalWithKeyboard()).toBeNull();
});

it("remembers the last terminal of each workspace to have had the keyboard (spec fenêtre §6.3)", () => {
  const isis = terminalNode("isis");
  const thot = terminalNode("thot");
  const horus = terminalNode("horus");
  isis.input.focus();
  horus.input.focus();
  expect(lastTerminalOf("w1")).toBe("isis");
  expect(lastTerminalOf("w2")).toBe("horus");
  thot.input.focus();
  thot.button.focus();
  expect(lastTerminalOf("w1")).toBe("thot");
});

it("does not count a click on a terminal's header button", () => {
  const isis = terminalNode("isis");
  const thot = terminalNode("thot");
  isis.input.focus();
  thot.button.focus();
  expect(lastTerminalOf("w1")).toBe("isis");
});

it("marks every terminal node with its id", () => {
  expect(readSource("nodes/terminal/TerminalNode.tsx")).toContain("data-terminal={nodeId}");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/canvas/keyboardFocus.test.ts`
Expected: FAIL — `./keyboardFocus` introuvable.

- [ ] **Step 3: Write the focus memory**

`src/canvas/keyboardFocus.ts` :

```ts
import { nodesStore } from "@/store/nodes";

/** Per workspace, the last terminal whose xterm had the keyboard. */
const lastTerminals = new Map<string, string>();

/** The terminal node holding `element` (its root carries `data-terminal`), if any. */
export function terminalOfElement(element: Element | null): string | null {
  return element?.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null;
}

/** The terminal whose xterm has the keyboard: xterm reads keys from a textarea. */
export function terminalWithKeyboard(doc: Document = document): string | null {
  const active = doc.activeElement;
  return active instanceof HTMLTextAreaElement ? terminalOfElement(active) : null;
}

/**
 * Follows the keyboard into the terminals (spec fenêtre §8): the start of
 * Ctrl+Tab when no terminal has the keyboard (spec fenêtre §6.3). A click on
 * a header button does not count, only xterm's input.
 */
export function trackTerminalFocus(doc: Document = document): () => void {
  const listener = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    const nodeId = terminalOfElement(event.target);
    const workspaceId = nodeId ? nodesStore.getState().nodes[nodeId]?.workspaceId : undefined;
    if (nodeId && workspaceId) lastTerminals.set(workspaceId, nodeId);
  };
  doc.addEventListener("focusin", listener);
  return () => doc.removeEventListener("focusin", listener);
}

export function lastTerminalOf(workspaceId: string): string | null {
  return lastTerminals.get(workspaceId) ?? null;
}
```

`src/nodes/terminal/TerminalNode.tsx` — la racine du nœud porte son identifiant ; remplacer :

```tsx
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-xl bg-ov-terminal"
```

par :

```tsx
    <div
      data-terminal={nodeId}
      className="relative flex h-full flex-col overflow-hidden rounded-xl bg-ov-terminal"
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/canvas/keyboardFocus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/canvas/keyboardFocus.ts src/canvas/keyboardFocus.test.ts src/nodes/terminal/TerminalNode.tsx
git commit -m "feat(canvas): know and remember the terminal that has the keyboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: L'arrivée sur un terminal

**Files:**
- Create: `src/canvas/arrivalSignal.ts`
- Create: `src/nodes/terminal/ArrivalFlash.tsx`, `src/nodes/terminal/ArrivalFlash.test.tsx`
- Create: `src/canvas/arrive.ts`, `src/canvas/arrive.test.ts`
- Modify: `src/nodes/terminal/TerminalNode.tsx` (signal)
- Modify: `src/index.css` (animation)

**Interfaces:**
- Consumes: `canvasStore` (`api`) ; `focusTerminal(nodeId)` (`src/nodes/terminal/registry.ts`) ; `TOP_ROW_HEIGHT` (72), `BOTTOM_BAR_HEIGHT` (60) (`src/shell/layout.ts`).
- Produces: `signalArrival(nodeId: string): void`, `useArrivalSignal(nodeId: string): number | null`, `arrivalStore` ; `ArrivalFlash({ nodeId })` ; `needsMove(rect: Rect, view: Viewport): boolean`, `arrivalView(rect: Rect, viewport: { width: number; height: number })`, `arrive(nodeId: string): void` (où `Rect = { x; y; width; height }`, `Viewport = { scrollX; scrollY; zoom; width; height }`, nombres).

- [ ] **Step 1: Write the failing tests**

`src/canvas/arrive.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { focusTerminal } from "@/nodes/terminal/registry";
import { arrivalStore } from "./arrivalSignal";
import { arrivalView, arrive, needsMove } from "./arrive";
import { canvasStore } from "./canvasStore";

vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));

const viewport = { width: 1400, height: 900 };
const at100 = { scrollX: 0, scrollY: 0, zoom: 1, ...viewport };
const isis = { id: "isis", x: 100, y: 200, width: 720, height: 440 };

describe("needsMove (spec fenêtre §6.4, zone utile of spec identité §7)", () => {
  it("keeps the view when the terminal shows whole at 100 % in the zone utile", () => {
    expect(needsMove(isis, at100)).toBe(false);
  });

  it("moves it when the terminal is zoomed, under the bars, under the bottom band or off screen", () => {
    expect(needsMove(isis, { ...at100, zoom: 0.8 })).toBe(true);
    expect(needsMove({ ...isis, y: 60 }, at100)).toBe(true);
    expect(needsMove({ ...isis, y: 900 - 60 - 440 + 1 }, at100)).toBe(true);
    expect(needsMove({ ...isis, x: -10 }, at100)).toBe(true);
    expect(needsMove({ ...isis, x: 1400 - 720 + 1 }, at100)).toBe(true);
    expect(needsMove(isis, { ...at100, scrollY: -150 })).toBe(true);
  });
});

it("centers a moved terminal at 100 % in the zone utile", () => {
  const view = arrivalView(isis, viewport);
  expect(view.zoom.value).toBe(1);
  // Screen top of the terminal: equal margins under the 72 px bars and above the 60 px band.
  const top = isis.y + view.scrollY;
  expect(top - 72).toBe(900 - 60 - (top + isis.height));
  expect(isis.x + view.scrollX).toBe((1400 - 720) / 2);
});

describe("arrive", () => {
  let frames: FrameRequestCallback[];
  const updateScene = vi.fn();

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    updateScene.mockClear();
    vi.mocked(focusTerminal).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const withScene = (appState: Record<string, unknown>) =>
    canvasStore.setState({
      api: {
        getSceneElements: () => [isis],
        getAppState: () => ({ ...appState, zoom: { value: appState.zoom } }),
        updateScene,
      } as unknown as ExcalidrawImperativeAPI,
    });

  it("activates the terminal without moving a view that already shows it, and flashes it", () => {
    withScene(at100);
    const before = arrivalStore.getState().seq;
    arrive("isis");
    expect(updateScene).toHaveBeenCalledWith({ appState: { activeEmbeddable: { element: isis, state: "active" } } });
    expect(arrivalStore.getState()).toEqual({ nodeId: "isis", seq: before + 1 });
  });

  it("moves the view first when needed, then focuses xterm on the next frame, after the view moved", () => {
    withScene({ ...at100, zoom: 0.5 });
    arrive("isis");
    const { appState } = updateScene.mock.calls[0][0];
    expect(appState.zoom.value).toBe(1);
    expect(appState.activeEmbeddable).toEqual({ element: isis, state: "active" });
    expect(focusTerminal).not.toHaveBeenCalled();
    frames.forEach((frame) => frame(0));
    expect(focusTerminal).toHaveBeenCalledWith("isis");
  });

  it("does nothing for a terminal that is not on the canvas", () => {
    withScene(at100);
    arrive("closed");
    expect(updateScene).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
```

`src/nodes/terminal/ArrivalFlash.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { signalArrival } from "@/canvas/arrivalSignal";
import { readSource } from "@/theme/cssBlocks";
import { ArrivalFlash } from "./ArrivalFlash";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("flashes the border of the terminal that arrives, anew on each arrival (spec fenêtre §6.4)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <div data-node="isis">
          <ArrivalFlash nodeId="isis" />
        </div>
        <div data-node="thot">
          <ArrivalFlash nodeId="thot" />
        </div>
      </>,
    ),
  );
  expect(host.querySelector("[data-arrival]")).toBeNull();
  await act(async () => signalArrival("isis"));
  const first = host.querySelector('[data-node="isis"] [data-arrival]')!;
  expect(first.className).toContain("ov-arrival");
  expect(host.querySelector('[data-node="thot"] [data-arrival]')).toBeNull();
  await act(async () => signalArrival("isis"));
  // A new element restarts the animation.
  expect(host.querySelector('[data-node="isis"] [data-arrival]')).not.toBe(first);
  await act(async () => signalArrival("thot"));
  expect(host.querySelector('[data-node="isis"] [data-arrival]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("fades the accent back in 600 ms, inside every terminal", () => {
  expect(readSource("index.css")).toMatch(/@keyframes ov-arrival \{[^}]*var\(--ov-accent\)/);
  expect(readSource("index.css")).toMatch(/\.ov-arrival \{[^}]*ov-arrival 600ms/);
  expect(readSource("nodes/terminal/TerminalNode.tsx")).toContain("<ArrivalFlash nodeId={nodeId} />");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/canvas/arrive.test.ts src/nodes/terminal/ArrivalFlash.test.tsx`
Expected: FAIL — `./arrivalSignal`, `./arrive`, `./ArrivalFlash` introuvables.

- [ ] **Step 3: Write the signal**

`src/canvas/arrivalSignal.ts` :

```ts
import { createStore, useStore } from "zustand";

interface ArrivalState {
  /** The terminal that arrived last. */
  nodeId: string | null;
  /** Counts arrivals: a new value restarts the flash. */
  seq: number;
}

export const arrivalStore = createStore<ArrivalState>()(() => ({ nodeId: null, seq: 0 }));

/** The arriving terminal's border takes the accent, then fades back (spec fenêtre §6.4). */
export function signalArrival(nodeId: string) {
  arrivalStore.setState((state) => ({ nodeId, seq: state.seq + 1 }));
}

/** The flash of `nodeId`, as a key that changes on every arrival; null when another terminal arrived last. */
export function useArrivalSignal(nodeId: string): number | null {
  return useStore(arrivalStore, (state) => (state.nodeId === nodeId ? state.seq : null));
}
```

`src/nodes/terminal/ArrivalFlash.tsx` :

```tsx
import { useArrivalSignal } from "@/canvas/arrivalSignal";

/** The ring drawn over a terminal that arrives (Ctrl+Tab, Ctrl+P); keyed so each arrival replays it. */
export function ArrivalFlash({ nodeId }: { nodeId: string }) {
  const arrival = useArrivalSignal(nodeId);
  if (arrival === null) return null;
  return <div key={arrival} data-arrival className="ov-arrival pointer-events-none absolute inset-0 z-30 rounded-xl" />;
}
```

`src/index.css` — à la fin du fichier :

```css
/* Arrival on a terminal: its border takes the accent, then fades back (spec fenêtre §6.4). */
@keyframes ov-arrival {
  from {
    box-shadow: inset 0 0 0 2px var(--ov-accent);
  }
  to {
    box-shadow: inset 0 0 0 2px transparent;
  }
}

.ov-arrival {
  animation: ov-arrival 600ms ease-out forwards;
}
```

`src/nodes/terminal/TerminalNode.tsx` — importer `ArrivalFlash` (`import { ArrivalFlash } from "./ArrivalFlash";`) et l'ajouter juste avant la fermeture de la racine, après la lueur d'attente :

```tsx
      {waiting && <div className="pointer-events-none absolute inset-0 z-20 rounded-xl" style={{ boxShadow: WAITING_GLOW }} />}
      <ArrivalFlash nodeId={nodeId} />
    </div>
```

- [ ] **Step 4: Write the arrival**

`src/canvas/arrive.ts` :

```ts
import type { NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { focusTerminal } from "@/nodes/terminal/registry";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { signalArrival } from "./arrivalSignal";
import { canvasStore } from "./canvasStore";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/**
 * The view stays when the terminal shows whole, at 100 %, in the zone utile:
 * the canvas less the bars at the top and the command bar's band at the
 * bottom (spec fenêtre §6.4, as amended by spec identité §7).
 */
export function needsMove(rect: Rect, view: Viewport): boolean {
  if (view.zoom !== 1) return true;
  const left = rect.x + view.scrollX;
  const top = rect.y + view.scrollY;
  return left < 0 || top < TOP_ROW_HEIGHT || left + rect.width > view.width || top + rect.height > view.height - BOTTOM_BAR_HEIGHT;
}

/** The terminal at 100 %, centered in the zone utile (plan E1, décision 1). */
export function arrivalView(rect: Rect, viewport: { width: number; height: number }) {
  const middle = (TOP_ROW_HEIGHT + viewport.height - BOTTOM_BAR_HEIGHT) / 2;
  return {
    zoom: { value: 1 as NormalizedZoomValue },
    scrollX: viewport.width / 2 - (rect.x + rect.width / 2),
    scrollY: middle - (rect.y + rect.height / 2),
  };
}

/**
 * Arrival on a terminal (spec fenêtre §6.4), shared by Ctrl+Tab and Ctrl+P:
 * the view moves only if needed; the terminal is activated as by a click in
 * its body, without selecting it; xterm takes the keyboard on the next frame,
 * once Excalidraw shows a terminal that was off screen; its border flashes.
 */
export function arrive(nodeId: string) {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return;
  const app = api.getAppState();
  const view = { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value, width: app.width, height: app.height };
  const move = needsMove(element, view) ? arrivalView(element, view) : {};
  api.updateScene({ appState: { ...move, activeEmbeddable: { element, state: "active" } } });
  requestAnimationFrame(() => focusTerminal(nodeId));
  signalArrival(nodeId);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/canvas/arrive.test.ts src/nodes/terminal/ArrivalFlash.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
rm -f *.stackdump
git add src/canvas/arrivalSignal.ts src/nodes/terminal/ArrivalFlash.tsx src/nodes/terminal/ArrivalFlash.test.tsx src/canvas/arrive.ts src/canvas/arrive.test.ts src/nodes/terminal/TerminalNode.tsx src/index.css
git commit -m "feat(canvas): arrive on a terminal: view, keyboard and a flash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rendre la main au canvas et vue d'ensemble

**Files:**
- Create: `src/canvas/canvasFocus.ts`
- Create: `src/canvas/canvasFocus.test.ts`

**Interfaces:**
- Consumes: `canvasStore` (`api`) ; `nodeKindOf` (`src/canvas/nodeElement.ts`) ; `groupInfoOf(element): GroupInfo | null` (`src/canvas/groups.ts`).
- Produces: `releaseToCanvas(doc?: Document): void` ; `overviewTargets(elements: readonly ExcalidrawElement[]): ExcalidrawElement[]` ; `overview(): void`.

- [ ] **Step 1: Write the failing test**

`src/canvas/canvasFocus.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "./canvasStore";
import { overview, overviewTargets, releaseToCanvas } from "./canvasFocus";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 100, height: 100, isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;
const node = (id: string, kind: string, frameId: string | null = null) => element({ id, type: "embeddable", customData: { kind }, frameId });
const groupFrame = (id: string) => element({ id, type: "frame", customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } });

const updateScene = vi.fn();
const scrollToContent = vi.fn();
let container: HTMLDivElement;

beforeEach(() => {
  updateScene.mockClear();
  scrollToContent.mockClear();
  document.body.innerHTML =
    '<div class="excalidraw excalidraw-container" tabindex="0"><div data-terminal="isis"><textarea></textarea></div></div>';
  container = document.querySelector<HTMLDivElement>(".excalidraw-container")!;
});
afterEach(() => document.body.replaceChildren());

const withScene = (elements: ExcalidrawElement[]) =>
  canvasStore.setState({
    api: { getSceneElements: () => elements, updateScene, scrollToContent } as unknown as ExcalidrawImperativeAPI,
  });

describe("releaseToCanvas (spec fenêtre §6.5)", () => {
  it("takes the keyboard from the terminal, deactivates it and gives the keyboard to Excalidraw's container", () => {
    withScene([]);
    document.querySelector("textarea")!.focus();
    releaseToCanvas();
    expect(document.activeElement).toBe(container);
    expect(updateScene).toHaveBeenCalledWith({ appState: { activeEmbeddable: null } });
  });

  it("creates no selection", () => {
    withScene([]);
    releaseToCanvas();
    for (const [update] of updateScene.mock.calls) expect(update.appState).not.toHaveProperty("selectedElementIds");
  });
});

describe("overview (spec fenêtre §6.6)", () => {
  it("frames the nodes and their group frames, not drawings nor drawing frames", () => {
    const scene = [
      groupFrame("backend"),
      node("isis", "terminal", "backend"),
      node("chef", "orchestrator"),
      element({ id: "drawing", type: "frame" }),
      node("in-drawing", "terminal", "drawing"),
      element({ id: "box", type: "rectangle" }),
      node("gone", "terminal", null),
    ];
    const gone = { ...scene[6], isDeleted: true } as ExcalidrawElement;
    expect(overviewTargets([...scene.slice(0, 6), gone]).map((e) => e.id)).toEqual(["backend", "isis", "chef", "in-drawing"]);
  });

  it("frames the whole scene when there is no node", () => {
    const scene = [element({ id: "box", type: "rectangle" }), element({ id: "arrow", type: "arrow" })];
    expect(overviewTargets(scene).map((e) => e.id)).toEqual(["box", "arrow"]);
  });

  it("fits them with an animation and a 10 % margin, then gives the keyboard to the canvas", () => {
    const scene = [node("isis", "terminal")];
    withScene(scene);
    overview();
    expect(scrollToContent).toHaveBeenCalledWith(scene, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
    expect(document.activeElement).toBe(container);
  });

  it("leaves an empty canvas alone", () => {
    withScene([]);
    overview();
    expect(scrollToContent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/canvas/canvasFocus.test.ts`
Expected: FAIL — `./canvasFocus` introuvable.

- [ ] **Step 3: Write the canvas focus**

`src/canvas/canvasFocus.ts` :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "./canvasStore";
import { groupInfoOf } from "./groups";
import { nodeKindOf } from "./nodeElement";

/**
 * Maj+Échap (spec fenêtre §6.5): the terminal or field that has the keyboard
 * loses it, the active terminal is deactivated, nothing gets selected, and the
 * keyboard goes to Excalidraw's container, where Excalidraw reads its keys
 * (dummyPlane does not set `handleKeyboardGlobally`).
 */
export function releaseToCanvas(doc: Document = document) {
  const active = doc.activeElement;
  if (active instanceof HTMLElement) active.blur();
  canvasStore.getState().api?.updateScene({ appState: { activeEmbeddable: null } });
  doc.querySelector<HTMLElement>(".excalidraw-container")?.focus();
}

/** What the overview frames: the nodes and their group frames; the whole scene without nodes. */
export function overviewTargets(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const live = elements.filter((e) => !e.isDeleted);
  const nodes = live.filter((e) => {
    const kind = nodeKindOf(e);
    return kind === "terminal" || kind === "orchestrator";
  });
  if (nodes.length === 0) return live;
  const holding = new Set(nodes.map((n) => n.frameId));
  return [...live.filter((e) => e.type === "frame" && holding.has(e.id) && groupInfoOf(e) !== null), ...nodes];
}

/** Ctrl+Maj+A (spec fenêtre §6.6): every node in view, with an animation and a 10 % margin, then the keyboard to the canvas. */
export function overview() {
  const api = canvasStore.getState().api;
  if (!api) return;
  const targets = overviewTargets(api.getSceneElements());
  if (targets.length > 0) api.scrollToContent(targets, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
  releaseToCanvas();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/canvas/canvasFocus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/canvas/canvasFocus.ts src/canvas/canvasFocus.test.ts
git commit -m "feat(canvas): give the keyboard back to the canvas, overview of the nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Le registre de commandes et l'écouteur global

**Files:**
- Create: `src/commands/command.ts`
- Create: `src/commands/registry.ts`, `src/commands/registry.test.ts`
- Create: `src/commands/dispatch.ts`, `src/commands/dispatch.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `Shortcut`, `shortcutOf`, `isModalOpen` (tâche 1) ; `terminalOrder`, `stepTerminal` (tâche 2) ; `terminalWithKeyboard`, `lastTerminalOf`, `trackTerminalFocus` (tâche 3) ; `arrive` (tâche 4) ; `releaseToCanvas`, `overview` (tâche 5) ; `projectsStore` (`view`), `workspacesStore` (`status`, `activeId`), `canvasStore` (`api`, `nodeIds`), `nodesStore` (`nodes[id].kind`).
- Produces:
  - `interface CommandContext { project: boolean; workspaceId: string | null; terminalCount: number; terminalId: string | null }` ;
  - `interface Command { id: string; label: string; section: string; keywords: readonly string[]; shortcut?: Shortcut; available: (ctx: CommandContext) => boolean; run: (ctx: CommandContext) => void | Promise<void> }` ;
  - `commandFor(commands: readonly Command[], shortcut: Shortcut, ctx: CommandContext): Command | null` ; `runCommand(command: Command, ctx: CommandContext): void` ;
  - `COMMANDS: readonly Command[]` (identifiants `terminal.next`, `terminal.previous`, `canvas.release`, `canvas.overview`) ; `commandContext(): CommandContext` ;
  - `installShortcuts(target: Window, commands?: readonly Command[], context?: () => CommandContext): () => void`.

- [ ] **Step 1: Write the failing tests**

`src/commands/registry.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { arrive } from "@/canvas/arrive";
import { canvasStore } from "@/canvas/canvasStore";
import { lastTerminalOf, terminalWithKeyboard } from "@/canvas/keyboardFocus";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { commandFor, runCommand, type Command, type CommandContext } from "./command";
import { COMMANDS, commandContext } from "./registry";

vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn() }));
vi.mock("@/canvas/keyboardFocus", () => ({ terminalWithKeyboard: vi.fn(() => null), lastTerminalOf: vi.fn(() => null) }));

const home: CommandContext = { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
const empty: CommandContext = { project: true, workspaceId: "w1", terminalCount: 0, terminalId: null };
const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 3, terminalId: "thot" };
const command = (id: string) => COMMANDS.find((c) => c.id === id)!;
const terminal = (id: string, x: number) =>
  ({ id, type: "embeddable", customData: { kind: "terminal" }, x, y: 100, width: 300, height: 200, isDeleted: false, frameId: null }) as unknown as ExcalidrawElement;

beforeAll(async () => {
  mockIPC(() => undefined);
  for (const id of ["isis", "thot", "anubis"]) {
    await nodesStore.getState().create(id, {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: id, name: id, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
  }
});
beforeEach(() => {
  vi.mocked(arrive).mockClear();
  canvasStore.setState({
    api: { getSceneElements: () => [terminal("isis", 0), terminal("thot", 400), terminal("anubis", 800)] } as unknown as ExcalidrawImperativeAPI,
    nodeIds: ["isis", "thot", "anubis"],
  });
  projectsStore.setState({ view: "project" } as never);
  workspacesStore.setState({ status: "ready", activeId: "w1" } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("the registry (spec fenêtre §6.1, §8)", () => {
  it("names each command once and gives each shortcut to one command", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const shortcuts = COMMANDS.flatMap((c) => (c.shortcut ? [c.shortcut] : []));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(COMMANDS.map((c) => [c.label, c.shortcut])).toEqual([
      ["Terminal suivant", "Ctrl+Tab"],
      ["Terminal précédent", "Ctrl+Maj+Tab"],
      ["Rendre la main au canvas", "Maj+Échap"],
      ["Vue d'ensemble", "Ctrl+Maj+A"],
    ]);
  });

  it("offers nothing at home, the canvas commands in an empty workspace, everything with terminals", () => {
    const available = (ctx: CommandContext) => COMMANDS.filter((c) => c.available(ctx)).map((c) => c.id);
    expect(available(home)).toEqual([]);
    expect(available(empty)).toEqual(["canvas.release", "canvas.overview"]);
    expect(available(busy)).toEqual(["terminal.next", "terminal.previous", "canvas.release", "canvas.overview"]);
  });

  it("goes to the next and the previous terminal in reading order, from the current one", async () => {
    await command("terminal.next").run(busy);
    expect(arrive).toHaveBeenLastCalledWith("anubis");
    await command("terminal.previous").run(busy);
    expect(arrive).toHaveBeenLastCalledWith("isis");
    await command("terminal.next").run({ ...busy, terminalId: null });
    expect(arrive).toHaveBeenLastCalledWith("isis");
    await command("terminal.previous").run({ ...busy, terminalId: null });
    expect(arrive).toHaveBeenLastCalledWith("anubis");
  });

  it("finds the command of a shortcut only where it is available", () => {
    expect(commandFor(COMMANDS, "Ctrl+Tab", busy)?.id).toBe("terminal.next");
    expect(commandFor(COMMANDS, "Ctrl+Tab", empty)).toBeNull();
    expect(commandFor(COMMANDS, "Ctrl+P", busy)).toBeNull();
  });

  it("says when a command fails", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const failing: Command = { ...command("canvas.overview"), run: () => Promise.reject(new Error("canvas absent")) };
    runCommand(failing, busy);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Vue d'ensemble impossible : .*canvas absent/)));
  });
});

describe("commandContext", () => {
  it("reads the open project, its workspace on screen and its terminals", () => {
    expect(commandContext()).toEqual({ project: true, workspaceId: "w1", terminalCount: 3, terminalId: null });
  });

  it("starts from the terminal that has the keyboard, else from the last one of the workspace", () => {
    vi.mocked(lastTerminalOf).mockReturnValue("anubis");
    expect(commandContext().terminalId).toBe("anubis");
    vi.mocked(terminalWithKeyboard).mockReturnValue("thot");
    expect(commandContext().terminalId).toBe("thot");
    vi.mocked(terminalWithKeyboard).mockReturnValue(null);
  });

  it("forgets a remembered terminal that left the canvas", () => {
    vi.mocked(lastTerminalOf).mockReturnValue("closed-meanwhile");
    expect(commandContext().terminalId).toBeNull();
  });

  it("knows the home screen", () => {
    projectsStore.setState({ view: "home" } as never);
    expect(commandContext()).toEqual({ project: false, workspaceId: null, terminalCount: 0, terminalId: null });
  });
});

afterAll(() => clearMocks());
```

(et `afterAll` rejoint l'import de `vitest` en tête du fichier.)

`src/commands/dispatch.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import type { Command, CommandContext } from "./command";
import { installShortcuts } from "./dispatch";

vi.mock("./registry", () => ({ COMMANDS: [], commandContext: () => ({}) }));

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 2, terminalId: "isis" };
let available: boolean;
const run = vi.fn();
const next: Command = { id: "terminal.next", label: "Terminal suivant", section: "Navigation", keywords: [], shortcut: "Ctrl+Tab", available: () => available, run };
let uninstall: () => void;
let xterm: HTMLTextAreaElement;
const reachedXterm = vi.fn();

beforeEach(() => {
  available = true;
  run.mockClear();
  reachedXterm.mockClear();
  document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div>';
  xterm = document.querySelector("textarea")!;
  xterm.addEventListener("keydown", reachedXterm);
  uninstall = installShortcuts(window, [next], () => ctx);
});
afterEach(() => {
  uninstall();
  document.body.replaceChildren();
});

const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  xterm.dispatchEvent(event);
  return event;
};

it("runs the shortcut's command and keeps the key from the terminal and its agent (spec fenêtre §6.2)", () => {
  const event = press({ key: "Tab", ctrlKey: true });
  expect(run).toHaveBeenCalledWith(ctx);
  expect(event.defaultPrevented).toBe(true);
  expect(reachedXterm).not.toHaveBeenCalled();
});

it("lets a key through when its command is unavailable, or when it is no shortcut", () => {
  available = false;
  expect(press({ key: "Tab", ctrlKey: true }).defaultPrevented).toBe(false);
  available = true;
  expect(press({ key: "Tab" }).defaultPrevented).toBe(false);
  expect(press({ key: "p", ctrlKey: true }).defaultPrevented).toBe(false);
  expect(run).not.toHaveBeenCalled();
  expect(reachedXterm).toHaveBeenCalledTimes(3);
});

it("lets every key through while a modal dialog is open", () => {
  const dialog = document.createElement("div");
  dialog.dataset.slot = "dialog-content";
  document.body.append(dialog);
  expect(press({ key: "Tab", ctrlKey: true }).defaultPrevented).toBe(false);
  expect(run).not.toHaveBeenCalled();
  expect(reachedXterm).toHaveBeenCalled();
});

it("stops listening once uninstalled", () => {
  uninstall();
  press({ key: "Tab", ctrlKey: true });
  expect(run).not.toHaveBeenCalled();
  uninstall = () => undefined;
});

it("is installed once, at startup, for the app's whole life, with the focus tracking", () => {
  const main = readSource("main.tsx");
  expect(main).toContain("installShortcuts(window);");
  expect(main).toContain("trackTerminalFocus(document);");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/registry.test.ts src/commands/dispatch.test.ts`
Expected: FAIL — `./command`, `./registry`, `./dispatch` introuvables.

- [ ] **Step 3: Write the command type**

`src/commands/command.ts` :

```ts
import { toast } from "sonner";
import type { Shortcut } from "./shortcuts";

/** What a command knows of the moment it runs in (spec fenêtre §7.3). */
export interface CommandContext {
  /** A project is open, its workspace on screen. */
  project: boolean;
  workspaceId: string | null;
  /** Terminals of the workspace on screen. */
  terminalCount: number;
  /** The terminal that has the keyboard, else the last of the workspace to have had it (spec fenêtre §6.3). */
  terminalId: string | null;
}

/**
 * One function of the application. Its shortcut, its palette line (J8) and
 * its radial menu entry run this same command: they never diverge (spec
 * fenêtre §3).
 */
export interface Command {
  id: string;
  label: string;
  section: string;
  keywords: readonly string[];
  shortcut?: Shortcut;
  available: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

/** The available command of a shortcut, if any. */
export function commandFor(commands: readonly Command[], shortcut: Shortcut, ctx: CommandContext): Command | null {
  return commands.find((command) => command.shortcut === shortcut && command.available(ctx)) ?? null;
}

/** Runs a command; a failure says so, like the menus (spec fenêtre §9). */
export function runCommand(command: Command, ctx: CommandContext) {
  const fail = (error: unknown) => toast.error(`${command.label} impossible : ${String(error)}`);
  try {
    void Promise.resolve(command.run(ctx)).catch(fail);
  } catch (error) {
    fail(error);
  }
}
```

- [ ] **Step 4: Write the registry**

`src/commands/registry.ts` :

```ts
import { arrive } from "@/canvas/arrive";
import { overview, releaseToCanvas } from "@/canvas/canvasFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { lastTerminalOf, terminalWithKeyboard } from "@/canvas/keyboardFocus";
import { stepTerminal, terminalOrder } from "@/canvas/terminalOrder";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import type { Command, CommandContext } from "./command";

const inProject = (ctx: CommandContext) => ctx.project;
const withTerminals = (ctx: CommandContext) => ctx.project && ctx.terminalCount > 0;

/** Ctrl+Tab and Ctrl+Maj+Tab (spec fenêtre §6.3): the next terminal in reading order, then the arrival (§6.4). */
function step(direction: 1 | -1, ctx: CommandContext) {
  const api = canvasStore.getState().api;
  if (!api) return;
  const target = stepTerminal(terminalOrder(api.getSceneElements()), ctx.terminalId, direction);
  if (target) arrive(target);
}

/** The application's functions (spec fenêtre §7.3); the palette (J8) adds its own. */
export const COMMANDS: readonly Command[] = [
  {
    id: "terminal.next",
    label: "Terminal suivant",
    section: "Navigation",
    keywords: ["suivant", "terminal", "agent"],
    shortcut: "Ctrl+Tab",
    available: withTerminals,
    run: (ctx) => step(1, ctx),
  },
  {
    id: "terminal.previous",
    label: "Terminal précédent",
    section: "Navigation",
    keywords: ["précédent", "terminal", "agent"],
    shortcut: "Ctrl+Maj+Tab",
    available: withTerminals,
    run: (ctx) => step(-1, ctx),
  },
  {
    id: "canvas.release",
    label: "Rendre la main au canvas",
    section: "Navigation",
    keywords: ["canvas", "clavier", "dessin"],
    shortcut: "Maj+Échap",
    available: inProject,
    run: () => releaseToCanvas(),
  },
  {
    id: "canvas.overview",
    label: "Vue d'ensemble",
    section: "Navigation",
    keywords: ["ensemble", "tout", "voir", "agents"],
    shortcut: "Ctrl+Maj+A",
    available: inProject,
    run: () => overview(),
  },
];

/** The context of a command, read at this moment from the stores and the keyboard focus. */
export function commandContext(): CommandContext {
  const project =
    projectsStore.getState().view === "project" &&
    workspacesStore.getState().status === "ready" &&
    canvasStore.getState().api !== null;
  if (!project) return { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
  const workspaceId = workspacesStore.getState().activeId;
  const nodes = nodesStore.getState().nodes;
  const terminals = canvasStore.getState().nodeIds.filter((id) => nodes[id]?.kind === "terminal");
  const remembered = workspaceId ? lastTerminalOf(workspaceId) : null;
  const terminalId = terminalWithKeyboard() ?? (remembered && terminals.includes(remembered) ? remembered : null);
  return { project, workspaceId, terminalCount: terminals.length, terminalId };
}
```

- [ ] **Step 5: Write the listener and install it**

`src/commands/dispatch.ts` :

```ts
import { commandFor, runCommand, type Command, type CommandContext } from "./command";
import { COMMANDS, commandContext } from "./registry";
import { isModalOpen, shortcutOf } from "./shortcuts";

/**
 * The application's single keydown listener (spec fenêtre §6.2): on the
 * window, in the capture phase, ahead of xterm, the fields, Excalidraw and
 * WebView2. A recognized shortcut whose command is available is consumed: it
 * reaches neither the terminal, nor its agent, nor Excalidraw.
 */
export function installShortcuts(
  target: Window,
  commands: readonly Command[] = COMMANDS,
  context: () => CommandContext = commandContext,
): () => void {
  const listener = (event: KeyboardEvent) => {
    const shortcut = shortcutOf(event);
    if (!shortcut || isModalOpen(target.document)) return;
    const ctx = context();
    const command = commandFor(commands, shortcut, ctx);
    if (!command) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runCommand(command, ctx);
  };
  target.addEventListener("keydown", listener, { capture: true });
  return () => target.removeEventListener("keydown", listener, { capture: true });
}
```

`src/main.tsx` — après `startTheme(…)` :

```tsx
import { trackTerminalFocus } from "./canvas/keyboardFocus";
import { installShortcuts } from "./commands/dispatch";
```

```tsx
startTheme(matchMedia("(prefers-color-scheme: dark)"));
// For the app's whole life (spec fenêtre §6.2, §8).
installShortcuts(window);
trackTerminalFocus(document);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands/registry.test.ts src/commands/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 8: Commit**

```bash
rm -f *.stackdump
git add src/commands/command.ts src/commands/registry.ts src/commands/registry.test.ts src/commands/dispatch.ts src/commands/dispatch.test.ts src/main.tsx
git commit -m "feat(commands): command registry and the global shortcut listener

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Vérification et installateur

**Files:**
- Aucun (sauf correctif né d'un constat, avec son test d'abord rouge et une décision au journal).

**Interfaces:**
- Consumes: tâches 1 à 6.
- Produces: `src-tauri/target/release/bundle/nsis/dummyPlane_0.1.0_x64-setup.exe`.

- [ ] **Step 1: Check the app still starts on the probe profile**

L'application de développement fermée (`crisp\closedev.ps1`), lancer `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'` en arrière-plan, attendre la fenêtre (titre « dummyPlane — … », tiret long), la capturer par `PrintWindow` (`crisp\printwin.ps1 -Out …`), sans souris ni clavier, puis la fermer.
Expected : la fenêtre du projet s'affiche comme après R2 (terminaux, barres, panneau) ; aucune erreur dans le journal de `pnpm tauri dev`. Les raccourcis eux-mêmes se vérifient à la main (étape 3).

- [ ] **Step 2: Build the installer**

Run : `pnpm tauri build > "$SCRATCH/e1-build.log" 2>&1` (en arrière-plan)
Expected : `Finished 1 bundle at: …\dummyPlane_0.1.0_x64-setup.exe` ; sous-système PE de `src-tauri/target/release/dummyplane.exe` : `2`.

- [ ] **Step 3: Hand over**

Donner à Mathieu l'installateur et ses vérifications (spec fenêtre §10 J7, §11) : dans un workspace à groupes en blocs, depuis un terminal Claude Code en train d'écrire, Ctrl+Tab et Ctrl+Maj+Tab (l'ordre, le retour au début, le clignement d'accent, la saisie immédiate, aucun caractère envoyé à l'agent) ; un terminal hors de l'écran ou zoomé : la vue le ramène à 100 % ; Maj+Échap puis R : un rectangle ; Ctrl+Maj+A : tous les nœuds en vue ; les raccourcis depuis un terminal Codex et un PowerShell ; rien pendant le dialogue de fermeture d'un agent.
