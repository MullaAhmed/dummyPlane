# Menu radial au clic droit (jalon J9) — plan G1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un clic droit ouvre sous le curseur un anneau de 8 boutons propre à ce qui est dessous (fond, terminal, groupe, orchestrateur, dessin), chaque bouton étant une commande du registre.

**Architecture:** Les ponts vers Excalidraw (`src/radial/bridges.ts`) d'abord, vérifiés dans l'application réelle. Le contexte des commandes reçoit le point du clic et la cible ; les fonctions nouvelles entrent au registre. Trois modules purs (visée, geste, anneaux), un magasin, l'anneau et ses écouteurs en capture sur `window`.

**Tech Stack:** React 19, TypeScript, Zustand 5, Excalidraw 0.18.1 (figé), xterm 6, lucide-react 1.61, Vitest + happy-dom, Tauri 2 (WebView2).

**Spec:** `docs/superpowers/specs/2026-10-26-dummyplane-menu-radial-design.md` (amendée à l'écriture de ce plan : ↗ du fond = « Lancer Shell »). Elle étend la spec fenêtre (`docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md`) et la spec identité.

## Global Constraints

- Textes de l'interface en français, exactement ceux de la spec (§4, §5.1, §7).
- Commits conventionnels en anglais, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` et `Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc` ; `rm -f *.stackdump` avant chaque commit.
- Fichiers commités en CRLF dans l'arbre de travail : les scripts Python normalisent par `.replace('\r\n', '\n')` avant de chercher.
- Deux fichiers d'un même dossier ne diffèrent jamais que par la casse.
- Un test qui atteint `@excalidraw/excalidraw` à l'exécution le simule : `vi.mock("@excalidraw/excalidraw", () => ({}))`.
- Excalidraw 0.18.1, `cmdk` 1.1.1, lucide-react : versions inchangées ; aucune dépendance ajoutée.
- Une fonction, une commande : chaque bouton de l'anneau est une commande du registre (spec fenêtre §3).
- Vérification dans l'application seulement sur le profil `dev.dummyplane.probe` (`pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'`, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`), pilotée par `$SCRATCH/crisp/cdp.mjs` (événements envoyés à la page, jamais à la souris ni au clavier du poste) ; jamais l'exécutable release, l'installateur ni les copies `dummyPlane-builds`. `$SCRATCH` = `C:\Users\Spectrum\AppData\Local\Temp\claude\C--Users-Spectrum-Documents-02-Code-Projects-dummyplane\ad63cad8-678d-4423-9eed-07d3b57cfba8\scratchpad`.

## Review Focus

1. Un clic droit dans le texte d'un terminal qui a une sélection : la sélection d'xterm survit à l'appui, « Copier » la copie (test : tâche 6 « the press kept from xterm »).
2. « Coller » sur le fond colle au point du clic, pas sous l'anneau : la commande part une image après la fermeture (tests : tâche 6 « runs the slot a slide points at… », tâche 1 « pastes at the point »).
3. Un anneau ouvert près d'un bord reste entier dans la fenêtre (test : tâche 5 « keeps the ring inside the window »).
4. Clic droit dans un champ de texte (renommage, barre de commande, champ d'orchestrateur) : ni anneau ni menu bloqué (test : tâche 6 « keeps the native behavior in a text field »).
5. « Plus… » ouvre réellement le menu d'Excalidraw : l'écouteur qui bloque les `contextmenu` laisse passer le sien (test : tâche 6 « blocks the native menu on the canvas, lets « Plus… » through »).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/radial/bridges.ts` (créé) | Ponts vers Excalidraw : raccourcis, copie, collage au point, texte au point, menu natif ; lecture du presse-papiers. |
| `src/radial/target.ts` (créé) | Visée (pure, spec §6.4). |
| `src/radial/gesture.ts` (créé) | Positions, direction visée, glisser, décalage aux bords (pur). |
| `src/radial/rings.ts` (créé) | Les cinq anneaux et la ligne d'un bouton (`lineOf`). |
| `src/radial/radialState.ts` (créé) | Magasin de l'anneau ouvert. |
| `src/radial/choose.ts` (créé) | Exécution d'un bouton après la fermeture. |
| `src/radial/install.ts` (créé) | Écouteurs en capture sur `window` et `ringAt`. |
| `src/radial/RadialMenu.tsx` (créé) | L'anneau, sa pastille, ses fermetures. |
| `src/nodes/orchestrator/field.ts` (créé) | Coller dans le champ d'un orchestrateur. |
| `src/commands/catalog/orchestrator.ts` (créé) | Fonctions de l'orchestrateur (anneau seulement). |
| `src/commands/command.ts` | `CommandContext` : `at`, `groupId`, `orchestratorId`. |
| `src/fleet/placement.ts` | `clientOf` (inverse de `sceneOf`). |
| `src/fleet/quickActions.ts`, `src/fleet/groups.ts` | Création au point. |
| `src/fleet/AgentMenu.tsx`, `src/commands/uiRequests.ts` | « Autre agent… » au point ; renommage d'orchestrateur. |
| `src/commands/catalog/agents.ts`, `current.ts`, `drawing.ts`, `src/commands/registry.ts` | Fonctions nouvelles. |
| `src/nodes/terminal/registry.ts` | `terminalSelection`, `pasteIntoTerminal`. |
| `src/nodes/orchestrator/OrchestratorNode.tsx` | Le nom répond à « Renommer ». |
| `src/shell/ProjectView.tsx`, `src/main.tsx`, `src/index.css` | Montage, écouteurs, animation. |

---

### Task 1: Les ponts vers Excalidraw

**Files:**
- Create: `src/radial/bridges.ts`, `src/radial/bridges.test.ts`
- Modify (hors dépôt) : `$SCRATCH/crisp/cdp.mjs` (étapes souris)

**Interfaces:**
- Produces: `focusCanvas(): void` ; `type CanvasKey = { key: string; code: string; ctrl?: boolean; shift?: boolean }` ; `CANVAS_KEYS: { duplicate, front, back, lock, delete }` ; `pressCanvasKey(key: CanvasKey): void` ; `copyCanvasSelection(): void` ; `readClipboard(): Promise<DataTransfer | null>` ; `readClipboardText(): Promise<string | null>` ; `pasteOnCanvasAt(client: Point): Promise<void>` ; `startTextAt(client: Point): void` ; `openNativeMenuAt(client: Point): void` ; `isNativeMenu(event: Event): boolean`. `Point` = `{ x: number; y: number }` de `@/fleet/terminals`.

- [ ] **Step 1: Write the failing test**

`src/radial/bridges.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  CANVAS_KEYS,
  copyCanvasSelection,
  isNativeMenu,
  openNativeMenuAt,
  pasteOnCanvasAt,
  pressCanvasKey,
  readClipboardText,
  startTextAt,
} from "./bridges";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

let box: HTMLElement;
let canvas: HTMLCanvasElement;
const seen: Event[] = [];
const cleanups: (() => void)[] = [];
const listen = (target: EventTarget, type: string) => {
  const record = (event: Event) => seen.push(event);
  target.addEventListener(type, record);
  cleanups.push(() => target.removeEventListener(type, record));
};
const clipboard = (read: () => Promise<unknown>) =>
  Object.defineProperty(navigator, "clipboard", { value: { read }, configurable: true });
const textItem = (text: string) => ({ types: ["text/plain"], getType: async () => new Blob([text], { type: "text/plain" }) });

beforeEach(() => {
  document.body.innerHTML =
    '<div class="excalidraw"><div class="excalidraw-container" tabindex="0"><canvas class="excalidraw__canvas interactive"></canvas></div></div><input id="field" />';
  box = document.querySelector<HTMLElement>(".excalidraw-container")!;
  canvas = document.querySelector("canvas")!;
  seen.length = 0;
  listen(box, "keydown");
  listen(canvas, "dblclick");
  listen(canvas, "contextmenu");
  listen(document, "copy");
  listen(document, "paste");
  listen(document, "pointermove");
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("Excalidraw's own actions, driven from outside (spec menu radial §6.3)", () => {
  it("sends Excalidraw's own shortcut to its container, the canvas taking the keyboard", () => {
    document.getElementById("field")!.focus();
    pressCanvasKey(CANVAS_KEYS.front);
    const key = seen[0] as KeyboardEvent;
    expect([key.type, key.code, key.ctrlKey, key.shiftKey]).toEqual(["keydown", "BracketRight", true, true]);
    expect(document.activeElement).toBe(box);
  });

  it("copies through Excalidraw's copy listener, the canvas having the keyboard", () => {
    let focused: Element | null = null;
    document.addEventListener("copy", () => (focused = document.activeElement), { once: true });
    copyCanvasSelection();
    expect(seen.map((e) => e.type)).toEqual(["copy"]);
    expect((seen[0] as ClipboardEvent).clipboardData).not.toBeNull();
    expect(focused).toBe(box);
  });

  it("pastes at the point: the pointer moves there first, then the clipboard comes as a paste", async () => {
    clipboard(async () => [textItem("hello")]);
    await pasteOnCanvasAt({ x: 40, y: 50 });
    expect(seen.map((e) => e.type)).toEqual(["pointermove", "paste"]);
    expect([(seen[0] as PointerEvent).clientX, (seen[0] as PointerEvent).clientY]).toEqual([40, 50]);
    expect((seen[1] as ClipboardEvent).clipboardData!.getData("text/plain")).toBe("hello");
  });

  it("says when the clipboard is empty or cannot be read, and pastes nothing", async () => {
    clipboard(async () => []);
    await pasteOnCanvasAt({ x: 1, y: 1 });
    expect(toast).toHaveBeenCalledWith("Presse-papiers vide");
    clipboard(() => Promise.reject(new Error("denied")));
    await pasteOnCanvasAt({ x: 1, y: 1 });
    expect(toast.error).toHaveBeenCalledWith("Lecture du presse-papiers impossible");
    expect(seen).toEqual([]);
  });

  it("reads the clipboard's text, null when there is none", async () => {
    clipboard(async () => [textItem("echo hi")]);
    expect(await readClipboardText()).toBe("echo hi");
    clipboard(async () => [{ types: ["image/png"], getType: async () => new Blob([], { type: "image/png" }) }]);
    expect(await readClipboardText()).toBeNull();
    expect(toast).toHaveBeenCalledWith("Presse-papiers vide");
  });

  it("starts a text at the point by a double-click on the canvas", () => {
    startTextAt({ x: 12, y: 34 });
    const click = seen[0] as MouseEvent;
    expect([click.type, click.clientX, click.clientY]).toEqual(["dblclick", 12, 34]);
  });

  it("opens Excalidraw's menu at the point with a contextmenu it marks as its own", () => {
    openNativeMenuAt({ x: 5, y: 6 });
    const menu = seen[0] as MouseEvent;
    expect([menu.type, menu.clientX, menu.clientY, menu.button]).toEqual(["contextmenu", 5, 6, 2]);
    expect(isNativeMenu(menu)).toBe(true);
    expect(isNativeMenu(new MouseEvent("contextmenu"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/radial/bridges.test.ts`
Expected: FAIL — `./bridges` introuvable.

- [ ] **Step 3: Write the bridges**

`src/radial/bridges.ts` :

```ts
import { toast } from "sonner";
import type { Point } from "@/fleet/terminals";

/** Excalidraw's container: its keys, copy and paste act when it has the keyboard. */
const container = () => document.querySelector<HTMLElement>(".excalidraw-container");
/** The canvas Excalidraw reads pointers from, above its static one. */
const interactiveCanvas = () => document.querySelector<HTMLCanvasElement>(".excalidraw canvas.interactive");

/** The keyboard to the canvas, the selection kept (`releaseToCanvas` clears it). */
export function focusCanvas() {
  container()?.focus();
}

export interface CanvasKey {
  key: string;
  code: string;
  ctrl?: boolean;
  shift?: boolean;
}

/** Excalidraw's own shortcuts for what its API cannot do: its keyTests read these fields (0.18.1). */
export const CANVAS_KEYS = {
  duplicate: { key: "d", code: "KeyD", ctrl: true },
  front: { key: "]", code: "BracketRight", ctrl: true, shift: true },
  back: { key: "[", code: "BracketLeft", ctrl: true, shift: true },
  lock: { key: "L", code: "KeyL", ctrl: true, shift: true },
  delete: { key: "Delete", code: "Delete" },
} satisfies Record<string, CanvasKey>;

export function pressCanvasKey({ key, code, ctrl = false, shift = false }: CanvasKey) {
  focusCanvas();
  container()?.dispatchEvent(new KeyboardEvent("keydown", { key, code, ctrlKey: ctrl, shiftKey: shift, bubbles: true, cancelable: true }));
}

/** Copier: Excalidraw's `copy` listener writes the selection to the system clipboard itself. */
export function copyCanvasSelection() {
  focusCanvas();
  document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
}

/** The clipboard as a paste carries it; null, with a toast, when empty or unreadable (spec menu radial §7). */
export async function readClipboard(): Promise<DataTransfer | null> {
  const data = new DataTransfer();
  try {
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type.startsWith("image/")) data.items.add(new File([blob], "image", { type }));
        else data.setData(type, await blob.text());
      }
    }
  } catch {
    toast.error("Lecture du presse-papiers impossible");
    return null;
  }
  if (data.types.length === 0) {
    toast("Presse-papiers vide");
    return null;
  }
  return data;
}

/** The clipboard's text, for a terminal or an orchestrator; null, with a toast, when there is none. */
export async function readClipboardText(): Promise<string | null> {
  const data = await readClipboard();
  if (!data) return null;
  const text = data.getData("text/plain");
  if (text === "") toast("Presse-papiers vide");
  return text === "" ? null : text;
}

/** Coller at a window point: Excalidraw pastes where the pointer last moved, over its canvas only. */
export async function pasteOnCanvasAt(client: Point) {
  const data = await readClipboard();
  if (!data) return;
  focusCanvas();
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: client.x, clientY: client.y, bubbles: true }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}

/** Texte: a text starts at a window point, as by a double-click on the canvas. */
export function startTextAt(client: Point) {
  focusCanvas();
  interactiveCanvas()?.dispatchEvent(new MouseEvent("dblclick", { clientX: client.x, clientY: client.y, bubbles: true, cancelable: true }));
}

const nativeMenus = new WeakSet<Event>();

/** « Plus… »: Excalidraw's own menu at a window point; the ring's listener lets this one through. */
export function openNativeMenuAt(client: Point) {
  const event = new MouseEvent("contextmenu", { clientX: client.x, clientY: client.y, button: 2, bubbles: true, cancelable: true });
  nativeMenus.add(event);
  interactiveCanvas()?.dispatchEvent(event);
}

export function isNativeMenu(event: Event): boolean {
  return nativeMenus.has(event);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/radial/bridges.test.ts`, puis `pnpm exec tsc --noEmit`
Expected: PASS (7 tests) ; types propres.

- [ ] **Step 5: Teach `cdp.mjs` the mouse**

Dans `$SCRATCH/crisp/cdp.mjs`, ajouter avant `else if (kind === "eval" || kind === "click")` :

```js
  else if (kind === "mouse") {
    // mouse:<pressed|moved|released>,<x>,<y>,<left|right|none>
    const [type, x, y, button] = arg.split(",");
    const pressed = type === "pressed" || type === "released";
    await send("Input.dispatchMouseEvent", {
      type: `mouse${type[0].toUpperCase()}${type.slice(1)}`,
      x: Number(x),
      y: Number(y),
      button,
      buttons: button === "left" ? 1 : button === "right" ? 2 : 0,
      clickCount: pressed ? 1 : 0,
    });
  }
```

- [ ] **Step 6: Check the bridges in the real app**

1. App de sonde fermée (`crisp\closedev.ps1`), lancer en arrière-plan (PowerShell) : `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'; pnpm tauri dev --config '{\"identifier\":\"dev.dummyplane.probe\"}' *> "$SCRATCH\crisp\dev-g1.log"` ; attendre que `curl -s http://127.0.0.1:9223/json` liste `localhost:1420`.
2. Dans un workspace vide : `node cdp.mjs 9223 key:Ctrl+Shift+P wait:400 "text:nouveau workspace" wait:300 key:Enter wait:1500`.
3. Un rectangle, sélectionné à la fin du tracé : `node cdp.mjs 9223 "eval:document.querySelector('.excalidraw-container').focus()" key:r mouse:pressed,500,400,left mouse:moved,580,450,left mouse:moved,650,500,left mouse:released,650,500,left wait:300`.
4. Les ponts, chacun suivi de l'état de la scène (`S` = `import('/src/canvas/canvasStore.ts').then(m => m.canvasStore.getState().api)`, `B` = `import('/src/radial/bridges.ts')`) :
   - copie : `eval:B.then(b => b.copyCanvasSelection())` puis `eval:navigator.clipboard.readText().then(t => t.includes('excalidraw/clipboard'))` → `true` ;
   - collage au point : `eval:B.then(b => b.pasteOnCanvasAt({ x: 800, y: 300 }))` puis le nombre de rectangles (`S.then(a => a.getSceneElements().filter(e => e.type === 'rectangle').length)`) → 2, le nouveau près de (800, 300) ;
   - dupliquer, supprimer : `pressCanvasKey(CANVAS_KEYS.duplicate)` → 3 ; `pressCanvasKey(CANVAS_KEYS.delete)` → 2 ;
   - premier plan, arrière-plan : l'indice dans `getSceneElements()` de l'élément sélectionné passe en dernier, puis en premier ;
   - verrouiller : `pressCanvasKey(CANVAS_KEYS.lock)` → l'élément sélectionné a `locked: true` ;
   - texte au point : `startTextAt({ x: 600, y: 650 })` → `S.then(a => a.getAppState().editingTextElement !== null)` → `true`, puis `key:Escape` ;
   - menu natif : `openNativeMenuAt({ x: 575, y: 400 })` → `document.querySelector('.context-menu') !== null` → `true`, puis `key:Escape`.
5. Capture (`crisp\printwin.ps1 -Out "$SCRATCH\crisp\g1-bridges.png"`), fermeture (`crisp\closedev.ps1`).

Expected : chaque pont fait ce qui est dit. **Si un pont échoue (presse-papiers illisible dans WebView2, menu qui ne s'ouvre pas…), s'arrêter et soumettre le problème à Mathieu (spec §6.3).**

- [ ] **Step 7: Commit**

```bash
rm -f *.stackdump
git add src/radial/bridges.ts src/radial/bridges.test.ts
git commit -m "feat(radial): bridges to Excalidraw's own shortcuts, clipboard, text and menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 2: Le contexte et la création au point

**Files:**
- Modify: `src/commands/command.ts`, `src/fleet/placement.ts`, `src/fleet/placement.test.ts`, `src/fleet/quickActions.ts`, `src/fleet/groups.ts`, `src/commands/uiRequests.ts`, `src/fleet/AgentMenu.tsx`, `src/commands/catalog/agents.ts`, `src/commands/catalog/agents.test.ts`, `src/shell/sharedActions.test.ts`, `src/shell/ToolRail.test.tsx`

**Interfaces:**
- Consumes: `sceneOf`, `viewportCenter` (`src/fleet/placement.ts`) ; `launchAgent(agent, options, center)` ; `addOrchestrator(workspaceId, center)` ; `launchGroup(plan, options)`.
- Produces: `CommandContext.at?: Point`, `.groupId?: string | null`, `.orchestratorId?: string | null` ; `clientOf(scene: Point, view): Point` ; `launchAt(agent, at?)`, `newConsole(at?)`, `launchFour(at?)`, `placeOrchestrator(at?)` ; `launchGroup(plan, options?, center?)` ; `UiRequest` `agentMenu` : `{ view: "agents" | "options" | "ollama"; at?: Point }` ; commande `agent.other` (« Autre agent… »).

- [ ] **Step 1: Write the failing tests**

`src/fleet/placement.test.ts` — ajouter (importer `clientOf` avec `sceneOf`) :

```ts
it("finds the window point of a scene point, the inverse of sceneOf (the radial menu's paste and text)", () => {
  const view = { scrollX: -40, scrollY: 25, zoom: 2, offsetLeft: 8, offsetTop: 30 };
  const client = { x: 300, y: 200 };
  expect(clientOf(sceneOf(client, view), view)).toEqual(client);
});
```

`src/shell/sharedActions.test.ts` — ajouter le simulacre (après les autres `vi.mock`) et le test ; importer `launchFour` avec `launchAt`, et `launchGroup` depuis `@/fleet/groups` :

```ts
vi.mock("@/fleet/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fleet/groups")>()),
  launchGroup: vi.fn(() => Promise.resolve()),
}));
```

```ts
it("launches an agent, places an orchestrator or a group of four where the radial menu was opened", () => {
  launchAt("codex", { x: 10, y: 20 });
  expect(vi.mocked(launchAgent).mock.calls.at(-1)?.[2]).toEqual({ x: 10, y: 20 });
  placeOrchestrator({ x: 30, y: 40 });
  expect(addOrchestrator).toHaveBeenLastCalledWith("w1", { x: 30, y: 40 });
  launchFour({ x: 50, y: 60 });
  expect(vi.mocked(launchGroup).mock.calls.at(-1)?.[2]).toEqual({ x: 50, y: 60 });
});
```

`src/commands/catalog/agents.test.ts` :
- dans « lists the spec's functions, in its order », insérer `"Autre agent…"` après `"Lancer un agent personnalisé…"` ;
- dans « launches an agent at the center of the view… », remplacer `expect(launchAt).toHaveBeenCalledWith("claude")` par `expect(launchAt).toHaveBeenCalledWith("claude", undefined)` ;
- ajouter :

```ts
  it("creates where the radial menu was opened, when it says where", async () => {
    const at = { x: 10, y: 20 };
    await find("agent.launch.claude").run({ ...busy, at });
    expect(launchAt).toHaveBeenLastCalledWith("claude", at);
    await find("agent.four").run({ ...busy, at });
    expect(launchFour).toHaveBeenLastCalledWith(at);
    await find("agent.orchestrator").run({ ...busy, at });
    expect(placeOrchestrator).toHaveBeenLastCalledWith(at);
    await find("agent.launch.ollama").run({ ...busy, at });
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "ollama", at });
  });

  it("opens the Agent menu on its catalog, the chosen agent launched at the radial menu's point (« Autre agent… »)", async () => {
    await find("agent.other").run({ ...busy, at: { x: 1, y: 2 } });
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "agents", at: { x: 1, y: 2 } });
  });
```

`src/shell/ToolRail.test.tsx` — ajouter le simulacre et le test ; compléter le simulacre de `@/fleet/quickActions` avec `placeOrchestrator: vi.fn()` ; importer `launchAgent` depuis `@/fleet/launchAgent` et `agentsStore` depuis `@/fleet/agentsStore` :

```ts
vi.mock("@/fleet/launchAgent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fleet/launchAgent")>()),
  launchAgent: vi.fn(() => Promise.resolve()),
}));
```

```tsx
it("launches the agent chosen in the ＋ menu where the radial menu was opened (« Autre agent… »)", async () => {
  await act(async () => requestUi({ kind: "agentMenu", view: "agents", at: { x: 10, y: 20 } }));
  await act(async () => agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never));
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect(menu.textContent).toContain("lancé là où tu as cliqué");
  const claude = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Claude"))!;
  await act(async () => claude.click());
  expect(launchAgent).toHaveBeenCalledWith("claude", expect.objectContaining({ shell: expect.any(String) }), { x: 10, y: 20 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/fleet/placement.test.ts src/shell/sharedActions.test.ts src/commands/catalog/agents.test.ts src/shell/ToolRail.test.tsx`
Expected: FAIL — `clientOf` introuvable ; `launchAgent` appelé au centre ; « Autre agent… » absent ; pas de « lancé là où tu as cliqué ».

- [ ] **Step 3: Write the context and the creation at a point**

`src/commands/command.ts` — importer `import type { Point } from "@/fleet/terminals";` et compléter `CommandContext` :

```ts
  /** Where the radial menu was opened, in scene coordinates: what it creates goes there (spec menu radial §6.1). */
  at?: Point;
  /** The group the radial menu points at; else the current terminal's (spec menu radial §6.1). */
  groupId?: string | null;
  /** The orchestrator the radial menu points at. */
  orchestratorId?: string | null;
```

`src/fleet/placement.ts` — ajouter après `sceneOf` :

```ts
/** The window point of a scene point, the inverse of `sceneOf`. */
export function clientOf(scene: Point, view: Viewport): Point {
  return {
    x: (scene.x + view.scrollX) * view.zoom + view.offsetLeft,
    y: (scene.y + view.scrollY) * view.zoom + view.offsetTop,
  };
}
```

`src/fleet/quickActions.ts` — importer `import type { Point } from "./terminals";` ; remplacer les quatre fonctions :

```ts
/** An agent at `at`, else at the center of the view, in the group under it if any (spec habillage §11.3, spec menu radial §4.1). */
export function launchAt(agent: AgentId, at?: Point) {
  const center = at ?? viewportCenter(canvasStore.getState().view);
  void launchAgent(agent, defaultLaunchOptions(), center).catch(reportLaunchError);
}

/** "Nouvelle console": the default agent (spec habillage §5.6). */
export function newConsole(at?: Point) {
  launchAt(defaultAgent(agentsStore.getState().agents), at);
}

/** "Lancer 4 agents": a Général group of four default agents (spec habillage §11.3). */
export function launchFour(at?: Point) {
  const agent = defaultAgent(agentsStore.getState().agents);
  const name = nextGroupName(canvasStore.getState().frames);
  void launchGroup({ name, role: "general", agents: [agent, agent, agent, agent] }, defaultLaunchOptions(), at).catch(reportLaunchError);
}

/** « Orchestrateur »: at `at`, else at the center of the view, like a launch (plan F2, décision 3). */
export function placeOrchestrator(at?: Point) {
  const workspaceId = workspacesStore.getState().activeId;
  if (!workspaceId) return;
  void addOrchestrator(workspaceId, at ?? viewportCenter(canvasStore.getState().view)).catch(reportLaunchError);
}
```

`src/fleet/groups.ts` — `launchGroup` reçoit le centre :

```ts
export async function launchGroup(plan: GroupPlan, options: LaunchOptions = defaultLaunchOptions(), at?: Point) {
```

et `const center = viewportCenter(view);` devient `const center = at ?? viewportCenter(view);` (importer `type Point` depuis `./terminals` ; la doc dit « around `at`, else the view's center »).

`src/commands/uiRequests.ts` — importer `import type { Point } from "@/fleet/terminals";` ; la variante devient :

```ts
  | { kind: "agentMenu"; view: "agents" | "options" | "ollama"; at?: Point }
```

`src/fleet/AgentMenu.tsx` :
- importer `toast` (`sonner`), `launchAgent` (avec `defaultLaunchOptions`, `./launchAgent`), `placeOrchestrator` (avec `launchFour, newConsole`, `./quickActions`), `type Point` (`./terminals`) ;
- après `const requestedView = useRef<View | null>(null);` : `const [placeAt, setPlaceAt] = useState<Point | null>(null);` ;
- l'effet d'ouverture commence par `if (!open) { setPlaceAt(null); return; }` ;
- le gestionnaire de `useUiRequest("agentMenu", …)` fait `requestedView.current = request.view; setPlaceAt(request.at ?? null); setOpen(true); return true;` ;
- `place` devient :

```ts
  const place = (agent: AgentId, launch: LaunchOptions) => {
    setOpen(false);
    // « Autre agent… » of the radial menu: launched where the right click was (spec menu radial §4.1).
    if (placeAt) void launchAgent(agent, launch, placeAt).catch((error: unknown) => toast.error(`Lancement impossible : ${String(error)}`));
    else uiStore.getState().setPlacing({ agent, options: launch });
  };
```

- « Nouvelle console » appelle `newConsole(placeAt ?? undefined)`, « Lancer 4 agents » `launchFour(placeAt ?? undefined)`, « Orchestrateur » `if (placeAt) placeOrchestrator(placeAt); else uiStore.getState().setPlacing({ orchestrator: true });` ;
- le pied dit `{placeAt ? "lancé là où tu as cliqué" : "puis clique sur le canvas pour le poser"}`.

`src/commands/catalog/agents.ts` — chaque `run` passe le point :
- « Lancer <agent> » : `run: (ctx) => (agent === "ollama" ? requestUi({ kind: "agentMenu", view: "ollama", at: ctx.at }) : launchAt(agent, ctx.at))` ;
- `agent.custom` : `run: (ctx) => requestUi({ kind: "agentMenu", view: "options", at: ctx.at })` ;
- `agent.console`, `agent.four`, `agent.orchestrator` : `run: (ctx) => newConsole(ctx.at)`, `launchFour(ctx.at)`, `placeOrchestrator(ctx.at)` ;
- après `agent.custom`, la fonction nouvelle :

```ts
  {
    id: "agent.other",
    label: "Autre agent…",
    section: "Agents",
    keywords: ["agent", "catalogue", "lancer"],
    available: inProject,
    // The ＋ menu's catalog; from the radial menu, the agent starts at its point (spec menu radial §4.1).
    run: (ctx) => requestUi({ kind: "agentMenu", view: "agents", at: ctx.at }),
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/fleet/placement.test.ts src/shell/sharedActions.test.ts src/commands/catalog/agents.test.ts src/shell/ToolRail.test.tsx`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/command.ts src/fleet/placement.ts src/fleet/placement.test.ts src/fleet/quickActions.ts src/fleet/groups.ts src/commands/uiRequests.ts src/fleet/AgentMenu.tsx src/commands/catalog/agents.ts src/commands/catalog/agents.test.ts src/shell/sharedActions.test.ts src/shell/ToolRail.test.tsx
git commit -m "feat(commands): commands know where the radial menu was opened and create there

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 3: Terminal, groupe et orchestrateur

**Files:**
- Modify: `src/nodes/terminal/registry.ts`, `src/commands/catalog/current.ts`, `src/commands/catalog/current.test.ts`, `src/commands/uiRequests.ts`, `src/nodes/orchestrator/OrchestratorNode.tsx`, `src/commands/registry.ts`
- Create: `src/nodes/orchestrator/field.ts`, `src/nodes/orchestrator/field.test.ts`, `src/commands/catalog/orchestrator.ts`, `src/commands/catalog/orchestrator.test.ts`, `src/nodes/orchestrator/OrchestratorNode.test.tsx`

**Interfaces:**
- Consumes: `readClipboardText` (tâche 1) ; `CommandContext.groupId`, `.orchestratorId` (tâche 2) ; `arrive`, `showNode` ; `focusGroup` ; `pauseAll`, `resumeAll` ; `groupMembers` ; `removeOrchestrator` ; `uiStore.setLinking`.
- Produces: `terminalSelection(nodeId): string`, `pasteIntoTerminal(nodeId, text): void` ; commandes `terminal.copy`, `terminal.paste`, `group.pause`, `group.resume`, `group.frame` ; `ORCHESTRATOR: readonly Command[]` (`orchestrator.write`, `.rename`, `.link`, `.paste`, `.remove`) ; `UiRequest` `renameOrchestrator { id }` ; `insertIntoField(field, text)`, `pasteIntoOrchestrator(nodeId, text): Promise<void>` ; `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...ORCHESTRATOR, ...DRAWING, ...SCENE, ...APP]`.

- [ ] **Step 1: Write the failing tests**

`src/commands/catalog/current.test.ts` :
- simulacres : `@/fleet/groups` reçoit `groupMembers: vi.fn(() => ["isis"])` ; `@/fleet/broadcast` reçoit `pauseAll: vi.fn(() => Promise.resolve())` et `resumeAll: vi.fn(() => Promise.resolve())` ; `@/nodes/terminal/registry` reçoit `terminalSelection: vi.fn(() => "")` et `pasteIntoTerminal: vi.fn()` ; ajouter `vi.mock("@/radial/bridges", () => ({ readClipboardText: vi.fn(() => Promise.resolve("echo hi")) }));` ; importer `pauseAll`, `terminalSelection`, `pasteIntoTerminal`, `focusGroup` comme les autres ;
- la liste des libellés devient :

```ts
      "Renommer",
      "Dupliquer",
      "Relancer",
      "Arrêter le processus",
      "Mettre en pause",
      "Reprendre",
      "Fermer",
      "Copier",
      "Coller",
      "Renommer le groupe",
      "Ajouter un agent…",
      "Relier un orchestrateur",
      "Dégrouper",
      "Fermer le groupe",
      "Mettre le groupe en pause",
      "Reprendre le groupe",
      "Cadrer le groupe",
```

- « offers each function under the rules of its button » : pour Isis, insérer `"terminal.copy", "terminal.paste"` après `"terminal.close"` et ajouter `"group.pause", "group.resume", "group.frame"` à la fin ; pour Thot : `["terminal.rename", "terminal.duplicate", "terminal.relaunch", "terminal.close", "terminal.copy", "terminal.paste"]` ;
- ajouter :

```ts
  it("copies the terminal's selection, greyed without one, and pastes the clipboard into it", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    expect(find("terminal.copy").disabled!(ctx("isis"))).toBe("aucune sélection");
    vi.mocked(terminalSelection).mockReturnValue("ls -la");
    expect(find("terminal.copy").disabled!(ctx("isis"))).toBeNull();
    await find("terminal.copy").run(ctx("isis"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ls -la");
    await find("terminal.paste").run(ctx("isis"));
    expect(pasteIntoTerminal).toHaveBeenCalledWith("isis", "echo hi");
  });

  it("acts on the group the radial menu points at, not the terminal's", async () => {
    const pointed = { ...ctx("thot"), groupId: "g1" };
    expect(sectionOf(find("group.rename"), pointed)).toBe("Groupe · Serveurs");
    await find("group.pause").run(pointed);
    expect(pauseAll).toHaveBeenCalledWith(["isis"]);
    await find("group.frame").run(pointed);
    expect(focusGroup).toHaveBeenLastCalledWith("g1");
    expect(find("group.pause").available({ ...ctx("thot"), groupId: "gone" })).toBe(false);
  });
```

`src/nodes/orchestrator/field.test.ts` :

```ts
// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { arrive } from "@/canvas/arrive";
import { insertIntoField, pasteIntoOrchestrator } from "./field";

vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn() }));

it("puts text at the cursor as if typed, React's change handler seeing it", () => {
  const field = document.createElement("textarea");
  field.value = "ab";
  field.setSelectionRange(1, 1);
  const input = vi.fn();
  field.addEventListener("input", input);
  insertIntoField(field, "X");
  expect(field.value).toBe("aXb");
  expect(field.selectionStart).toBe(2);
  expect(input).toHaveBeenCalledTimes(1);
});

it("pastes into an orchestrator's field once the arrival gave it the keyboard", async () => {
  document.body.innerHTML = '<div data-orchestrator="chef"><textarea></textarea></div>';
  const field = document.querySelector("textarea")!;
  vi.mocked(arrive).mockImplementation(() => {
    requestAnimationFrame(() => field.focus());
    return true;
  });
  await pasteIntoOrchestrator("chef", "hello");
  expect(arrive).toHaveBeenCalledWith("chef");
  expect(field.value).toBe("hello");
});
```

`src/commands/catalog/orchestrator.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { arrive, showNode } from "@/canvas/arrive";
import { removeOrchestrator } from "@/fleet/orchestrators";
import { pasteIntoOrchestrator } from "@/nodes/orchestrator/field";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { labelOf, sectionOf, type CommandContext } from "../command";
import { pendingUiRequest } from "../uiRequests";
import { ORCHESTRATOR } from "./orchestrator";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(), showNode: vi.fn() }));
vi.mock("@/fleet/orchestrators", () => ({ removeOrchestrator: vi.fn() }));
vi.mock("@/nodes/orchestrator/field", () => ({ pasteIntoOrchestrator: vi.fn(() => Promise.resolve()) }));
vi.mock("@/radial/bridges", () => ({ readClipboardText: vi.fn(() => Promise.resolve("texte")) }));

const palette: CommandContext = { project: true, workspaceId: "w1", terminalCount: 0, terminalId: null };
const ring: CommandContext = { ...palette, orchestratorId: "chef" };
const find = (id: string) => ORCHESTRATOR.find((c) => c.id === id)!;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef de backend" } });
});

describe("Orchestrateur · <nom> (spec menu radial §4.4, §6.2)", () => {
  it("is the radial menu's only: the palette never points at an orchestrator", () => {
    expect(ORCHESTRATOR.filter((c) => c.available(palette))).toEqual([]);
    expect(ORCHESTRATOR.map((c) => labelOf(c, ring))).toEqual(["Écrire une consigne", "Renommer", "Relier", "Coller", "Supprimer"]);
    expect(sectionOf(find("orchestrator.rename"), ring)).toBe("Orchestrateur · chef de backend");
  });

  it("does what the orchestrator's own controls do", async () => {
    await find("orchestrator.write").run(ring);
    expect(arrive).toHaveBeenCalledWith("chef");
    await find("orchestrator.rename").run(ring);
    expect(showNode).toHaveBeenCalledWith("chef");
    expect(pendingUiRequest()).toEqual({ kind: "renameOrchestrator", id: "chef" });
    await find("orchestrator.link").run(ring);
    expect(uiStore.getState().linking).toBe("chef");
    await find("orchestrator.paste").run(ring);
    expect(pasteIntoOrchestrator).toHaveBeenCalledWith("chef", "texte");
    await find("orchestrator.remove").run(ring);
    expect(removeOrchestrator).toHaveBeenCalledWith("chef");
  });
});
```

`src/nodes/orchestrator/OrchestratorNode.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { requestUi } from "@/commands/uiRequests";
import { nodesStore } from "@/store/nodes";
import { OrchestratorNode } from "./OrchestratorNode";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens its name editor on request (« Renommer » of its radial menu)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef de backend" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OrchestratorNode nodeId="chef" />));
  expect(host.querySelector("header input")).toBeNull();
  await act(async () => requestUi({ kind: "renameOrchestrator", id: "chef" }));
  const field = host.querySelector<HTMLInputElement>("header input")!;
  expect(field.value).toBe("chef de backend");
  expect(document.activeElement).toBe(field);
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/catalog/current.test.ts src/nodes/orchestrator src/commands/catalog/orchestrator.test.ts`
Expected: FAIL — commandes absentes, `./field` et `./orchestrator` introuvables, pas d'éditeur de nom sur demande.

- [ ] **Step 3: Write the terminal's clipboard, the group's functions and the orchestrator's**

`src/nodes/terminal/registry.ts` — ajouter après `focusTerminal` (pas de test unitaire : xterm ne se charge pas sous happy-dom ; vérifié dans l'application à la tâche 7) :

```ts
/** The terminal's selection, empty without one (« Copier » of its radial menu). */
export function terminalSelection(nodeId: string): string {
  return entries.get(nodeId)?.term.getSelection() ?? "";
}

/** Text pasted into a terminal as by Ctrl+V: bracketed when its program asks for it. */
export function pasteIntoTerminal(nodeId: string, text: string) {
  entries.get(nodeId)?.term.paste(text);
}
```

`src/commands/catalog/current.ts` :
- imports : `isGroup` avec `groupOf` (`@/canvas/groups`) ; `pauseAll`, `resumeAll` avec `canPause…` (`@/fleet/broadcast`) ; `groupMembers` avec `requestCloseGroup, ungroup` (`@/fleet/groups`) ; `pasteIntoTerminal, terminalSelection` avec `relaunchTerminal, stopTerminal` (`@/nodes/terminal/registry`) ; `import { readClipboardText } from "@/radial/bridges";` ;
- `groupOfCurrent` devient :

```ts
/** The group the radial menu points at, else the group of the terminal of the moment. */
function groupOfCurrent(ctx: CommandContext): SceneGroup | null {
  const frames = canvasStore.getState().frames;
  if (ctx.project && ctx.groupId) {
    const group = frames.find((f) => f.id === ctx.groupId);
    return group && isGroup(group) ? group : null;
  }
  return payloadOf(ctx) && ctx.terminalId ? groupOf(frames, ctx.terminalId) : null;
}
```

- après la commande `terminal.close` :

```ts
  {
    id: "terminal.copy",
    label: "Copier",
    section: terminalSection,
    keywords: ["copier", "sélection", "presse-papiers"],
    available: hasTerminal,
    disabled: (ctx) => (terminalSelection(terminalId(ctx)) ? null : "aucune sélection"),
    run: async (ctx) => {
      await navigator.clipboard.writeText(terminalSelection(terminalId(ctx)));
    },
  },
  {
    id: "terminal.paste",
    label: "Coller",
    section: terminalSection,
    keywords: ["coller", "presse-papiers"],
    available: hasTerminal,
    run: async (ctx) => {
      const text = await readClipboardText();
      if (text !== null) pasteIntoTerminal(terminalId(ctx), text);
    },
  },
```

- à la fin de `CURRENT` :

```ts
  {
    id: "group.pause",
    label: "Mettre le groupe en pause",
    section: groupSection,
    keywords: ["groupe", "pause"],
    available: hasGroup,
    run: async (ctx) => {
      await pauseAll(groupMembers(groupId(ctx)));
    },
  },
  {
    id: "group.resume",
    label: "Reprendre le groupe",
    section: groupSection,
    keywords: ["groupe", "reprendre"],
    available: hasGroup,
    run: async (ctx) => {
      await resumeAll(groupMembers(groupId(ctx)));
    },
  },
  {
    id: "group.frame",
    label: "Cadrer le groupe",
    section: groupSection,
    keywords: ["groupe", "cadrer", "voir"],
    available: hasGroup,
    run: (ctx) => {
      focusGroup(groupId(ctx));
    },
  },
```

`src/commands/uiRequests.ts` — ajouter la variante `| { kind: "renameOrchestrator"; id: string }`.

`src/nodes/orchestrator/field.ts` :

```ts
import { arrive } from "@/canvas/arrive";

/** Text put at the cursor of a field as if typed: React's change handler sees it (a plain `value =` would not). */
export function insertIntoField(field: HTMLTextAreaElement, text: string) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setValue?.call(field, field.value.slice(0, start) + text + field.value.slice(end));
  field.setSelectionRange(start + text.length, start + text.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** How many frames the field is waited for: the arrival offers it the keyboard as long (canvas/arrive.ts). */
const FRAMES = 10;

/** « Coller » of an orchestrator's radial menu: the arrival gives its field the keyboard, then the text goes in. */
export async function pasteIntoOrchestrator(nodeId: string, text: string) {
  arrive(nodeId);
  for (let frame = 0; frame < FRAMES; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const field = document.querySelector<HTMLTextAreaElement>(`[data-orchestrator="${nodeId}"] textarea`);
    if (field && document.activeElement === field) {
      insertIntoField(field, text);
      return;
    }
  }
}
```

`src/commands/catalog/orchestrator.ts` :

```ts
import { arrive, showNode } from "@/canvas/arrive";
import { removeOrchestrator } from "@/fleet/orchestrators";
import { pasteIntoOrchestrator } from "@/nodes/orchestrator/field";
import { readClipboardText } from "@/radial/bridges";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import type { Command, CommandContext } from "../command";
import { requestUi } from "../uiRequests";

/** The orchestrator the radial menu points at; the palette never sets one (spec menu radial §6.2). */
function orchestratorOf(ctx: CommandContext): string | null {
  const id = ctx.project ? ctx.orchestratorId : null;
  return id && nodesStore.getState().nodes[id]?.kind === "orchestrator" ? id : null;
}

const hasOrchestrator = (ctx: CommandContext) => orchestratorOf(ctx) !== null;
// `available` guarantees it before `run`.
const id = (ctx: CommandContext) => ctx.orchestratorId as string;

function section(ctx: CommandContext): string {
  const record = nodesStore.getState().nodes[ctx.orchestratorId ?? ""];
  const name = record?.kind === "orchestrator" ? (record.payload as { name?: string }).name : undefined;
  return `Orchestrateur · ${name ?? ""}`;
}

export const ORCHESTRATOR: readonly Command[] = [
  { id: "orchestrator.write", label: "Écrire une consigne", section, keywords: ["consigne", "orchestrateur"], available: hasOrchestrator, run: (ctx) => void arrive(id(ctx)) },
  {
    id: "orchestrator.rename",
    label: "Renommer",
    section,
    keywords: ["nom", "orchestrateur"],
    available: hasOrchestrator,
    run: (ctx) => {
      showNode(id(ctx));
      requestUi({ kind: "renameOrchestrator", id: id(ctx) });
    },
  },
  { id: "orchestrator.link", label: "Relier", section, keywords: ["relier", "orchestrateur"], available: hasOrchestrator, run: (ctx) => uiStore.getState().setLinking(id(ctx)) },
  {
    id: "orchestrator.paste",
    label: "Coller",
    section,
    keywords: ["coller", "presse-papiers"],
    available: hasOrchestrator,
    run: async (ctx) => {
      const text = await readClipboardText();
      if (text !== null) await pasteIntoOrchestrator(id(ctx), text);
    },
  },
  { id: "orchestrator.remove", label: "Supprimer", section, keywords: ["supprimer", "orchestrateur"], available: hasOrchestrator, run: (ctx) => removeOrchestrator(id(ctx)) },
];
```

`src/nodes/orchestrator/OrchestratorNode.tsx` — `NameField` reçoit `nodeId` et répond à la demande ; l'appel devient `<NameField nodeId={nodeId} value={record.payload.name} onCommit={(name) => renameOrchestrator(nodeId, name)} />` ; importer `useUiRequest` :

```tsx
function NameField({ nodeId, value, onCommit }: { nodeId: string; value: string; onCommit: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  // « Renommer » of the orchestrator's radial menu.
  useUiRequest("renameOrchestrator", (request) => {
    if (request.id !== nodeId) return false;
    setEditing(true);
    return true;
  });
```

(si `NameInput` ne prend pas le clavier à son montage, lui donner `autoFocus` sur son `<input>`.)

`src/commands/registry.ts` — importer `ORCHESTRATOR` depuis `./catalog/orchestrator` ; `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...ORCHESTRATOR, ...DRAWING, ...SCENE, ...APP]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands src/nodes/orchestrator`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/nodes/terminal/registry.ts src/commands/catalog/current.ts src/commands/catalog/current.test.ts src/commands/uiRequests.ts src/nodes/orchestrator/OrchestratorNode.tsx src/nodes/orchestrator/OrchestratorNode.test.tsx src/nodes/orchestrator/field.ts src/nodes/orchestrator/field.test.ts src/commands/catalog/orchestrator.ts src/commands/catalog/orchestrator.test.ts src/commands/registry.ts
git commit -m "feat(commands): copy and paste in a terminal, a group's pause and frame, an orchestrator's functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 4: Les dessins

**Files:**
- Modify: `src/commands/catalog/drawing.ts`, `src/commands/catalog/drawing.test.ts`

**Interfaces:**
- Consumes: `pressCanvasKey`, `CANVAS_KEYS`, `copyCanvasSelection`, `pasteOnCanvasAt`, `startTextAt`, `openNativeMenuAt` (tâche 1) ; `clientOf` (tâche 2).
- Produces: commandes `drawing.copy`, `.paste`, `.duplicate`, `.front`, `.back`, `.lock`, `.delete`, `.more` (ajoutées à `DRAWING`, après « Rétablir ») ; `selectionLocked(): boolean` ; `tool.text` commence un texte à `ctx.at` quand il est donné.

- [ ] **Step 1: Write the failing tests**

`src/commands/catalog/drawing.test.ts` :
- ajouter le simulacre :

```ts
vi.mock("@/radial/bridges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/radial/bridges")>()),
  pressCanvasKey: vi.fn(),
  copyCanvasSelection: vi.fn(),
  pasteOnCanvasAt: vi.fn(() => Promise.resolve()),
  startTextAt: vi.fn(),
  openNativeMenuAt: vi.fn(),
}));
```

- importer `CANVAS_KEYS, copyCanvasSelection, openNativeMenuAt, pasteOnCanvasAt, pressCanvasKey, startTextAt` depuis `@/radial/bridges` ;
- la liste de « lists the tools… » se termine désormais par :

```ts
      ["Annuler", "Ctrl+Z"],
      ["Rétablir", "Ctrl+Y"],
      ["Copier", "Ctrl+C"],
      ["Coller", "Ctrl+V"],
      ["Dupliquer", "Ctrl+D"],
      ["Premier plan", "Ctrl+Maj+]"],
      ["Arrière-plan", "Ctrl+Maj+["],
      ["Verrouiller", "Ctrl+Maj+L"],
      ["Supprimer", "Suppr"],
      ["Plus…", null],
```

- ajouter :

```ts
describe("Dessin, sur la sélection (spec menu radial §4.5)", () => {
  const view = { scrollX: 0, scrollY: 0, zoom: 2, width: 800, height: 600, offsetLeft: 5, offsetTop: 7, tool: "selection", selectedIds: [], editingFrame: null };
  const scene = (selected: Record<string, boolean>, locked = false) =>
    canvasStore.setState({
      view,
      api: {
        setActiveTool,
        updateScene,
        getAppState: () => ({ selectedElementIds: selected }),
        getSceneElements: () => [{ id: "r1", locked }],
      } as unknown as ExcalidrawImperativeAPI,
    });
  const run = (id: string, ctx: CommandContext = busy) => DRAWING.find((c) => c.id === id)!.run(ctx);

  it("acts on the selection with Excalidraw's own keys, offered only with a selection", async () => {
    scene({});
    expect(DRAWING.filter((c) => c.id.startsWith("drawing.") && c.available(busy)).map((c) => c.id)).toEqual(["drawing.paste"]);
    scene({ r1: true });
    await run("drawing.duplicate");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.duplicate);
    await run("drawing.front");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.front);
    await run("drawing.back");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.back);
    await run("drawing.delete");
    expect(pressCanvasKey).toHaveBeenLastCalledWith(CANVAS_KEYS.delete);
    await run("drawing.copy");
    expect(copyCanvasSelection).toHaveBeenCalled();
  });

  it("names the lock after the selection's state", () => {
    scene({ r1: true });
    expect(labelOf(DRAWING.find((c) => c.id === "drawing.lock")!, busy)).toBe("Verrouiller");
    scene({ r1: true }, true);
    expect(labelOf(DRAWING.find((c) => c.id === "drawing.lock")!, busy)).toBe("Déverrouiller");
  });

  it("pastes and starts a text where the radial menu was opened, else at the middle of the canvas", async () => {
    scene({});
    await run("drawing.paste", { ...busy, at: { x: 10, y: 20 } });
    expect(pasteOnCanvasAt).toHaveBeenLastCalledWith({ x: 25, y: 47 });
    await run("drawing.paste");
    expect(pasteOnCanvasAt).toHaveBeenLastCalledWith({ x: 405, y: 307 });
    await run("tool.text", { ...busy, at: { x: 10, y: 20 } });
    expect(startTextAt).toHaveBeenLastCalledWith({ x: 25, y: 47 });
    await run("tool.text");
    expect(setActiveTool).toHaveBeenLastCalledWith({ type: "text" });
  });

  it("offers « Plus… » in the radial menu only: Excalidraw's menu at its point", async () => {
    scene({ r1: true });
    const more = DRAWING.find((c) => c.id === "drawing.more")!;
    expect(more.available(busy)).toBe(false);
    expect(more.available({ ...busy, at: { x: 10, y: 20 } })).toBe(true);
    await more.run({ ...busy, at: { x: 10, y: 20 } });
    expect(openNativeMenuAt).toHaveBeenCalledWith({ x: 25, y: 47 });
  });
});
```

(importer `type CommandContext` avec `labelOf`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/catalog/drawing.test.ts`
Expected: FAIL — les commandes `drawing.*` manquent.

- [ ] **Step 3: Write the drawing functions**

`src/commands/catalog/drawing.ts` :
- imports : `import type { Point } from "@/fleet/terminals";`, `import { clientOf } from "@/fleet/placement";`, `import { CANVAS_KEYS, copyCanvasSelection, openNativeMenuAt, pasteOnCanvasAt, pressCanvasKey, startTextAt } from "@/radial/bridges";`, `type CommandContext` avec `Command` ;
- après `pressCanvasKey` local (renommé `pressUndoKey`, ses deux appels aussi, pour ne pas masquer celui des ponts) :

```ts
/** The ids Excalidraw has selected. */
function selectedIds(): string[] {
  const selection = canvasStore.getState().api?.getAppState().selectedElementIds ?? {};
  return Object.keys(selection).filter((id) => selection[id]);
}

/** Every selected element is locked: « Déverrouiller », as Excalidraw's own menu says. */
export function selectionLocked(): boolean {
  const ids = new Set(selectedIds());
  const selected = canvasStore.getState().api?.getSceneElements().filter((e) => ids.has(e.id)) ?? [];
  return selected.length > 0 && selected.every((e) => e.locked);
}

const withSelection = (ctx: CommandContext) => inProject(ctx) && selectedIds().length > 0;

/** The window point of the radial menu's click, else the middle of the canvas. */
function pointOf(ctx: CommandContext): Point {
  const { view } = canvasStore.getState();
  return ctx.at ? clientOf(ctx.at, view) : { x: view.offsetLeft + view.width / 2, y: view.offsetTop + view.height / 2 };
}
```

- les outils : `run: (ctx) => (type === "text" && ctx.at ? startTextAt(pointOf(ctx)) : pickTool(type))` ;
- après « Rétablir » dans `DRAWING` :

```ts
  { id: "drawing.copy", label: "Copier", section: "Dessin", keywords: ["copier", "presse-papiers"], keys: "Ctrl+C", available: withSelection, run: () => copyCanvasSelection() },
  { id: "drawing.paste", label: "Coller", section: "Dessin", keywords: ["coller", "presse-papiers"], keys: "Ctrl+V", available: inProject, run: (ctx) => pasteOnCanvasAt(pointOf(ctx)) },
  { id: "drawing.duplicate", label: "Dupliquer", section: "Dessin", keywords: ["dupliquer", "copie"], keys: "Ctrl+D", available: withSelection, run: () => pressCanvasKey(CANVAS_KEYS.duplicate) },
  { id: "drawing.front", label: "Premier plan", section: "Dessin", keywords: ["devant", "ordre", "plan"], keys: "Ctrl+Maj+]", available: withSelection, run: () => pressCanvasKey(CANVAS_KEYS.front) },
  { id: "drawing.back", label: "Arrière-plan", section: "Dessin", keywords: ["derrière", "ordre", "plan"], keys: "Ctrl+Maj+[", available: withSelection, run: () => pressCanvasKey(CANVAS_KEYS.back) },
  {
    id: "drawing.lock",
    label: () => (selectionLocked() ? "Déverrouiller" : "Verrouiller"),
    section: "Dessin",
    keywords: ["verrouiller", "déverrouiller", "figer"],
    keys: "Ctrl+Maj+L",
    available: withSelection,
    run: () => pressCanvasKey(CANVAS_KEYS.lock),
  },
  // Agents in the selection go through the closing guard (spec habillage §7.5).
  { id: "drawing.delete", label: "Supprimer", section: "Dessin", keywords: ["supprimer", "effacer"], keys: "Suppr", available: withSelection, run: () => pressCanvasKey(CANVAS_KEYS.delete) },
  // The radial menu's only: Excalidraw's full menu at its point (spec menu radial §4.5).
  { id: "drawing.more", label: "Plus…", section: "Dessin", keywords: ["menu", "plus"], available: (ctx) => withSelection(ctx) && ctx.at !== undefined, run: (ctx) => openNativeMenuAt(pointOf(ctx)) },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe (`registry.test` : aucun identifiant en double).

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/catalog/drawing.ts src/commands/catalog/drawing.test.ts
git commit -m "feat(commands): copy, paste, duplicate, order, lock and delete drawings from the palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 5: Visée, geste et anneaux

**Files:**
- Create: `src/radial/target.ts`, `src/radial/target.test.ts`, `src/radial/gesture.ts`, `src/radial/gesture.test.ts`, `src/radial/rings.ts`, `src/radial/rings.test.ts`

**Interfaces:**
- Consumes: `nodeKindOf` ; `COMMANDS`, `labelOf`, `Command`, `CommandContext` ; `selectionLocked` (tâche 4) ; `defaultAgent`, `AGENTS`, `agentsStore`.
- Produces: `type RadialTarget` ; `isTextField(element): boolean` ; `domTarget(element): RadialTarget | null` ; `sceneTarget(pick: ScenePick): RadialTarget` ; `RING_RADIUS = 84`, `BUTTON_SIZE = 44`, `PILL_GAP = 8`, `DEAD_ZONE = 24`, `SLIDE_THRESHOLD = 6` ; `slotPosition(slot): Point` (décalage depuis le centre) ; `slotAt(center, pointer): number | null` ; `isSlide(press, pointer): boolean` ; `ringCenter(point, window): Point` ; `type RingKind = "canvas" | "terminal" | "group" | "orchestrator" | "selection"` ; `RINGS: Record<RingKind, readonly (RingSlot | null)[]>` ; `lineOf(slot, ctx, commands?): RingLine | null` avec `RingLine = { command: Command; label: string; Icon: Icon; enabled: boolean; reason: string | null; danger: boolean }`.

- [ ] **Step 1: Write the failing tests**

`src/radial/gesture.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { isSlide, ringCenter, slotAt, slotPosition } from "./gesture";

describe("the ring's geometry (spec menu radial §5)", () => {
  it("places the eight buttons clockwise from the top, 84 px from the center", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(slotPosition)).toEqual([
      { x: 0, y: -84 },
      { x: 59, y: -59 },
      { x: 84, y: 0 },
      { x: 59, y: 59 },
      { x: 0, y: 84 },
      { x: -59, y: 59 },
      { x: -84, y: 0 },
      { x: -59, y: -59 },
    ]);
  });

  it("points at the slot in the pointer's direction, by eighths, nothing in the dead zone", () => {
    const center = { x: 100, y: 100 };
    const toward = (dx: number, dy: number) => slotAt(center, { x: 100 + dx, y: 100 + dy });
    expect([toward(0, -50), toward(40, -40), toward(50, 0), toward(40, 40), toward(0, 50), toward(-40, 40), toward(-50, 0), toward(-40, -40)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(toward(19, -50)).toBe(0);
    expect(toward(22, -40)).toBe(1);
    expect(toward(10, 10)).toBeNull();
  });

  it("tells a slide from a click by 6 px", () => {
    expect(isSlide({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
    expect(isSlide({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true);
  });

  it("keeps the ring inside the window, its pill included, 8 px from the edges", () => {
    const window = { width: 1000, height: 800 };
    expect(ringCenter({ x: 500, y: 400 }, window)).toEqual({ x: 500, y: 400 });
    expect(ringCenter({ x: 10, y: 10 }, window)).toEqual({ x: 114, y: 114 });
    expect(ringCenter({ x: 995, y: 795 }, window)).toEqual({ x: 886, y: 654 });
  });
});
```

`src/radial/target.test.ts` :

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { domTarget, isTextField, sceneTarget, type ScenePick } from "./target";

const element = (id: string, fields: Record<string, unknown>) =>
  ({ id, type: "rectangle", x: 0, y: 0, width: 100, height: 100, angle: 0, strokeWidth: 2, isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;
const pick = (point: { x: number; y: number }, elements: ExcalidrawElement[], fields: Partial<ScenePick> = {}): ScenePick => ({
  point,
  zoom: 1,
  elements,
  selectedIds: [],
  groupIds: new Set(),
  ...fields,
});

describe("what is under a right press (spec menu radial §6.4)", () => {
  it("reads a node's body from the page, and leaves text fields their own right click", () => {
    document.body.innerHTML =
      '<div data-terminal="isis"><div class="xterm"><span id="text"></span><textarea id="xterm-input"></textarea></div><input id="name" /></div><div data-orchestrator="chef"><span id="chef"></span><textarea id="field"></textarea></div><div id="else"></div>';
    const at = (id: string) => document.getElementById(id)!;
    expect(domTarget(at("text"))).toEqual({ kind: "terminal", id: "isis" });
    expect(domTarget(at("chef"))).toEqual({ kind: "orchestrator", id: "chef" });
    expect(domTarget(at("else"))).toBeNull();
    expect([isTextField(at("xterm-input")), isTextField(at("name")), isTextField(at("field")), isTextField(at("text"))]).toEqual([false, true, true, false]);
  });

  it("finds the topmost drawing by its outline, turned with it", () => {
    const below = element("below", {});
    const above = element("above", { x: 50, y: 50 });
    expect(sceneTarget(pick({ x: 60, y: 60 }, [below, above]))).toEqual({ kind: "selection", ids: ["above"] });
    expect(sceneTarget(pick({ x: 10, y: 10 }, [below, above]))).toEqual({ kind: "selection", ids: ["below"] });
    // A square turned by 45°: its unturned corner is empty.
    const turned = element("turned", { angle: Math.PI / 4 });
    expect(sceneTarget(pick({ x: 2, y: 2 }, [turned]))).toEqual({ kind: "canvas" });
    expect(sceneTarget(pick({ x: 50, y: 5 }, [turned]))).toEqual({ kind: "selection", ids: ["turned"] });
  });

  it("finds a line by its stroke, not by the box around it", () => {
    const line = element("line", { type: "line", width: 200, height: 200, points: [[0, 0], [200, 200]] });
    expect(sceneTarget(pick({ x: 103, y: 100 }, [line]))).toEqual({ kind: "selection", ids: ["line"] });
    expect(sceneTarget(pick({ x: 150, y: 50 }, [line]))).toEqual({ kind: "canvas" });
    expect(sceneTarget(pick({ x: 120, y: 100 }, [line], { zoom: 0.2 }))).toEqual({ kind: "selection", ids: ["line"] });
  });

  it("keeps the selection when the press is inside it, a lone node excepted", () => {
    const a = element("a", {});
    const b = element("b", { x: 300 });
    expect(sceneTarget(pick({ x: 200, y: 50 }, [a, b], { selectedIds: ["a", "b"] }))).toEqual({ kind: "selection", ids: ["a", "b"] });
    const terminal = element("isis", { type: "embeddable", customData: { kind: "terminal" } });
    expect(sceneTarget(pick({ x: 50, y: 50 }, [terminal], { selectedIds: ["isis"] }))).toEqual({ kind: "terminal", id: "isis" });
  });

  it("finds a node drawn on the canvas, a group by its frame or its label, an ordinary frame as a drawing", () => {
    const chef = element("chef", { type: "embeddable", customData: { kind: "orchestrator" }, x: 500 });
    const group = element("g1", { type: "frame", x: 0, y: 200, width: 400, height: 300 });
    const plain = element("f2", { type: "frame", x: 600, y: 200, width: 200, height: 200 });
    const member = element("ra", { type: "embeddable", customData: { kind: "terminal" }, x: 20, y: 220, frameId: "g1" });
    const scene = [group, plain, member, chef];
    const groups = { groupIds: new Set(["g1"]) };
    expect(sceneTarget(pick({ x: 550, y: 50 }, scene, groups))).toEqual({ kind: "orchestrator", id: "chef" });
    expect(sceneTarget(pick({ x: 50, y: 250 }, scene, groups))).toEqual({ kind: "terminal", id: "ra" });
    expect(sceneTarget(pick({ x: 300, y: 450 }, scene, groups))).toEqual({ kind: "group", id: "g1" });
    expect(sceneTarget(pick({ x: 50, y: 185 }, scene, groups))).toEqual({ kind: "group", id: "g1" });
    expect(sceneTarget(pick({ x: 700, y: 300 }, scene, groups))).toEqual({ kind: "selection", ids: ["f2"] });
    expect(sceneTarget(pick({ x: 900, y: 900 }, scene, groups))).toEqual({ kind: "canvas" });
  });
});
```

`src/radial/rings.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import type { CommandContext } from "@/commands/command";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/fleet/agentsStore";
import { AGENTS } from "@/fleet/catalog";
import { nodesStore } from "@/store/nodes";
import { lineOf, RINGS } from "./rings";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "isis", at: { x: 0, y: 0 }, groupId: "g1", orchestratorId: "chef" };
const labels = (kind: keyof typeof RINGS) => RINGS[kind].map((slot) => (slot ? lineOf(slot, ctx)!.label : null));

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef" } });
  canvasStore.setState({ frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["isis"] }] });
  agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never);
});

describe("the rings (spec menu radial §4)", () => {
  it("gives each ring 8 positions, each a function of the registry, never twice", () => {
    for (const [kind, slots] of Object.entries(RINGS)) {
      expect(slots, kind).toHaveLength(8);
      const ids = slots.flatMap((slot) => (slot ? [typeof slot.command === "function" ? slot.command(ctx) : slot.command] : []));
      expect(new Set(ids).size, kind).toBe(ids.length);
      for (const id of ids) expect(COMMANDS.some((c) => c.id === id), id).toBe(true);
    }
  });

  it("names each ring's positions as the spec does, clockwise from the top", () => {
    expect(labels("canvas")).toEqual(["Lancer Claude", "Lancer Shell", "Lancer 4 agents", "Orchestrateur", "Coller", "Texte", "Autre agent…", "Vue d'ensemble"]);
    expect(labels("terminal")).toEqual(["Copier", "Coller", "Renommer", "Relancer", "Fermer", "Dupliquer", "Mettre en pause", "Arrêter le processus"]);
    expect(labels("group")).toEqual(["Ajouter un agent…", "Renommer le groupe", "Relier un orchestrateur", "Mettre le groupe en pause", "Fermer le groupe", "Dégrouper", "Reprendre le groupe", "Cadrer le groupe"]);
    expect(labels("orchestrator")).toEqual(["Écrire une consigne", null, "Renommer", null, "Supprimer", null, "Relier", "Coller"]);
    expect(labels("selection")).toEqual(["Copier", "Coller", "Dupliquer", "Premier plan", "Supprimer", "Arrière-plan", "Verrouiller", "Plus…"]);
  });

  it("puts the default agent at the top of the canvas ring, with its icon", () => {
    agentsStore.setState({ agents: [{ id: "codex", available: true }] } as never);
    const top = lineOf(RINGS.canvas[0]!, ctx)!;
    expect([top.label, top.Icon]).toEqual(["Lancer Codex", AGENTS.codex.Icon]);
    agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never);
  });

  it("greys what cannot run, with its reason, and marks what ends something", () => {
    const copy = lineOf(RINGS.terminal[0]!, ctx)!;
    expect([copy.enabled, copy.reason]).toEqual([false, "aucune sélection"]);
    const stop = lineOf(RINGS.terminal[7]!, ctx)!;
    expect([stop.enabled, stop.reason]).toEqual([false, null]);
    expect(lineOf(RINGS.terminal[4]!, ctx)!.danger).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/radial`
Expected: FAIL — `./gesture`, `./target`, `./rings` introuvables.

- [ ] **Step 3: Write the three modules**

`src/radial/gesture.ts` :

```ts
import type { Point } from "@/fleet/terminals";

/** From the click point to each button's center (spec menu radial §5.1). */
export const RING_RADIUS = 84;
export const BUTTON_SIZE = 44;
/** Between the lowest button and the name pill. */
export const PILL_GAP = 8;
const PILL_HEIGHT = 24;
/** Closer to the center, a slide points at nothing (§5.2). */
export const DEAD_ZONE = 24;
/** Farther from the press, the right button slides rather than clicks. */
export const SLIDE_THRESHOLD = 6;
const MARGIN = 8;
const REACH = RING_RADIUS + BUTTON_SIZE / 2;

/** Where button `slot` sits from the ring's center: 0 at the top, clockwise. */
export function slotPosition(slot: number): Point {
  const angle = ((slot * 45 - 90) * Math.PI) / 180;
  // `+ 0` turns -0 into 0.
  return { x: Math.round(RING_RADIUS * Math.cos(angle)) + 0, y: Math.round(RING_RADIUS * Math.sin(angle)) + 0 };
}

/** The slot a slide points at: the eighth of the circle the pointer is in, none in the dead zone. */
export function slotAt(center: Point, pointer: Point): number | null {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
  const fromTop = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return (((Math.round(fromTop / 45) % 8) + 8) % 8);
}

export function isSlide(press: Point, pointer: Point): boolean {
  return Math.hypot(pointer.x - press.x, pointer.y - press.y) > SLIDE_THRESHOLD;
}

/** The ring's center: the click point, moved off the window's edges so that the ring and its pill show whole. */
export function ringCenter(point: Point, window: { width: number; height: number }): Point {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  return {
    x: clamp(point.x, REACH + MARGIN, window.width - REACH - MARGIN),
    y: clamp(point.y, REACH + MARGIN, window.height - REACH - PILL_GAP - PILL_HEIGHT - MARGIN),
  };
}
```

`src/radial/target.ts` :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "@/canvas/nodeElement";
import type { Point } from "@/fleet/terminals";

/** What a right press points at (spec menu radial §6.4). */
export type RadialTarget =
  | { kind: "canvas" }
  | { kind: "terminal"; id: string }
  | { kind: "orchestrator"; id: string }
  | { kind: "group"; id: string }
  | { kind: "selection"; ids: string[] };

/** A text field keeps its own right click (§5.2); xterm's hidden input is not one. */
export function isTextField(element: Element): boolean {
  if (element.closest(".xterm")) return false;
  return element.closest("input, textarea, [contenteditable='true'], [contenteditable='']") !== null;
}

/** A node's body, read from the page; null elsewhere. */
export function domTarget(element: Element): RadialTarget | null {
  const terminal = element.closest("[data-terminal]")?.getAttribute("data-terminal");
  if (terminal) return { kind: "terminal", id: terminal };
  const orchestrator = element.closest("[data-orchestrator]")?.getAttribute("data-orchestrator");
  if (orchestrator) return { kind: "orchestrator", id: orchestrator };
  return null;
}

export interface ScenePick {
  /** The press, in scene coordinates. */
  point: Point;
  zoom: number;
  /** Live elements, bottom to top. */
  elements: readonly ExcalidrawElement[];
  selectedIds: readonly string[];
  /** Frames that are dummyPlane groups. */
  groupIds: ReadonlySet<string>;
}

/** Screen pixels around a stroke or an outline that still count as on it. */
const TOLERANCE = 6;
/** The band above a group's frame where its label sits (canvas/overlay/GroupLabels.tsx). */
const LABEL_HEIGHT = 24;

/** `point` in the element's own axes: Excalidraw turns an element around its center. */
function unturned(element: ExcalidrawElement, point: Point): Point {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

function hits(element: ExcalidrawElement, point: Point, tolerance: number): boolean {
  const p = unturned(element, point);
  if ((element.type === "line" || element.type === "arrow" || element.type === "freedraw") && "points" in element) {
    const reach = tolerance + element.strokeWidth / 2;
    const points = element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y }));
    if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= reach;
    return points.slice(1).some((b, i) => distanceToSegment(p, points[i], b) <= reach);
  }
  return p.x >= element.x - tolerance && p.x <= element.x + element.width + tolerance && p.y >= element.y - tolerance && p.y <= element.y + element.height + tolerance;
}

/** The box around elements, turned ones included. */
function boundsOf(elements: readonly ExcalidrawElement[]) {
  const corners = elements.flatMap((e) => {
    const cx = e.x + e.width / 2;
    const cy = e.y + e.height / 2;
    const cos = Math.cos(e.angle);
    const sin = Math.sin(e.angle);
    return [
      [e.x, e.y],
      [e.x + e.width, e.y],
      [e.x, e.y + e.height],
      [e.x + e.width, e.y + e.height],
    ].map(([x, y]) => ({ x: cx + (x - cx) * cos - (y - cy) * sin, y: cy + (x - cx) * sin + (y - cy) * cos }));
  });
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** What the scene has under a press (§6.4, steps 3 to 6). */
export function sceneTarget({ point, zoom, elements, selectedIds, groupIds }: ScenePick): RadialTarget {
  const tolerance = TOLERANCE / zoom;
  const selected = elements.filter((e) => selectedIds.includes(e.id));
  const loneNode = selected.length === 1 && nodeKindOf(selected[0]) !== null;
  if (selected.length > 0 && !loneNode) {
    const box = boundsOf(selected);
    if (point.x >= box.x1 - tolerance && point.x <= box.x2 + tolerance && point.y >= box.y1 - tolerance && point.y <= box.y2 + tolerance) {
      return { kind: "selection", ids: selected.map((e) => e.id) };
    }
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element.type === "frame" || element.type === "magicframe" || !hits(element, point, tolerance)) continue;
    const kind = nodeKindOf(element);
    if (kind === "terminal" || kind === "orchestrator") return { kind, id: element.id };
    return { kind: "selection", ids: [element.id] };
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const frame = elements[i];
    if (frame.type !== "frame") continue;
    const group = groupIds.has(frame.id);
    const top = frame.y - (group ? LABEL_HEIGHT / zoom : 0);
    if (point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= top && point.y <= frame.y + frame.height) {
      return group ? { kind: "group", id: frame.id } : { kind: "selection", ids: [frame.id] };
    }
  }
  return { kind: "canvas" };
}
```

`src/radial/rings.ts` :

```ts
import type { ComponentType } from "react";
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  Focus,
  Layers,
  Link,
  Lock,
  LockOpen,
  MessageSquare,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Scan,
  SendToBack,
  Square,
  Terminal,
  Trash2,
  Type,
  Ungroup,
  UserPlus,
  X,
} from "lucide-react";
import { labelOf, type Command, type CommandContext } from "@/commands/command";
import { selectionLocked } from "@/commands/catalog/drawing";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/fleet/agentsStore";
import { AGENTS, defaultAgent } from "@/fleet/catalog";

export type RingKind = "canvas" | "terminal" | "group" | "orchestrator" | "selection";
type Icon = ComponentType<{ className?: string }>;

export interface RingSlot {
  /** The registry's command, or the one of the moment (« Mettre en pause » / « Reprendre »). */
  command: string | ((ctx: CommandContext) => string);
  icon: Icon;
  /** The icon of the moment (the default agent's, the lock's). */
  iconOf?: (ctx: CommandContext) => Icon;
  /** Ends something: its icon in red. */
  danger?: boolean;
}

const defaultLaunch = () => `agent.launch.${defaultAgent(agentsStore.getState().agents)}`;
const resumes = (ctx: CommandContext) => COMMANDS.find((c) => c.id === "terminal.resume")?.available(ctx) ?? false;

/** The five rings, positions clockwise from the top (spec menu radial §4). */
export const RINGS: Record<RingKind, readonly (RingSlot | null)[]> = {
  canvas: [
    { command: defaultLaunch, icon: Play, iconOf: () => AGENTS[defaultAgent(agentsStore.getState().agents)].Icon },
    { command: "agent.launch.shell", icon: Terminal },
    { command: "agent.four", icon: Layers },
    { command: "agent.orchestrator", icon: Network },
    { command: "drawing.paste", icon: ClipboardPaste },
    { command: "tool.text", icon: Type },
    { command: "agent.other", icon: Plus },
    { command: "canvas.overview", icon: Scan },
  ],
  terminal: [
    { command: "terminal.copy", icon: Copy },
    { command: "terminal.paste", icon: ClipboardPaste },
    { command: "terminal.rename", icon: Pencil },
    { command: "terminal.relaunch", icon: RotateCw },
    { command: "terminal.close", icon: X, danger: true },
    { command: "terminal.duplicate", icon: CopyPlus },
    { command: (ctx) => (resumes(ctx) ? "terminal.resume" : "terminal.pause"), icon: Pause, iconOf: (ctx) => (resumes(ctx) ? Play : Pause) },
    { command: "terminal.stop", icon: Square },
  ],
  group: [
    { command: "group.addAgent", icon: UserPlus },
    { command: "group.rename", icon: Pencil },
    { command: "group.orchestrate", icon: Network },
    { command: "group.pause", icon: Pause },
    { command: "group.close", icon: X, danger: true },
    { command: "group.ungroup", icon: Ungroup },
    { command: "group.resume", icon: Play },
    { command: "group.frame", icon: Focus },
  ],
  orchestrator: [
    { command: "orchestrator.write", icon: MessageSquare },
    null,
    { command: "orchestrator.rename", icon: Pencil },
    null,
    { command: "orchestrator.remove", icon: Trash2, danger: true },
    null,
    { command: "orchestrator.link", icon: Link },
    { command: "orchestrator.paste", icon: ClipboardPaste },
  ],
  selection: [
    { command: "drawing.copy", icon: Copy },
    { command: "drawing.paste", icon: ClipboardPaste },
    { command: "drawing.duplicate", icon: CopyPlus },
    { command: "drawing.front", icon: BringToFront },
    { command: "drawing.delete", icon: Trash2, danger: true },
    { command: "drawing.back", icon: SendToBack },
    { command: "drawing.lock", icon: Lock, iconOf: () => (selectionLocked() ? LockOpen : Lock) },
    { command: "drawing.more", icon: Ellipsis },
  ],
};

export interface RingLine {
  command: Command;
  label: string;
  Icon: Icon;
  enabled: boolean;
  /** Why it is greyed, when the command says. */
  reason: string | null;
  danger: boolean;
}

/** A button as it shows now: its command, name, icon, and whether it can run (spec menu radial §5.1). */
export function lineOf(slot: RingSlot, ctx: CommandContext, commands: readonly Command[] = COMMANDS): RingLine | null {
  const id = typeof slot.command === "function" ? slot.command(ctx) : slot.command;
  const command = commands.find((c) => c.id === id);
  if (!command) return null;
  const available = command.available(ctx);
  const reason = available ? (command.disabled?.(ctx) ?? null) : null;
  return { command, label: labelOf(command, ctx), Icon: slot.iconOf?.(ctx) ?? slot.icon, enabled: available && reason === null, reason, danger: slot.danger ?? false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/radial`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/radial/target.ts src/radial/target.test.ts src/radial/gesture.ts src/radial/gesture.test.ts src/radial/rings.ts src/radial/rings.test.ts
git commit -m "feat(radial): what a right press points at, the slide's geometry and the five rings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 6: L'anneau

**Files:**
- Create: `src/radial/radialState.ts`, `src/radial/choose.ts`, `src/radial/install.ts`, `src/radial/install.test.ts`, `src/radial/RadialMenu.tsx`, `src/radial/RadialMenu.test.tsx`
- Modify: `src/shell/ProjectView.tsx`, `src/main.tsx`, `src/index.css`

**Interfaces:**
- Consumes: tâches 1 à 5 ; `commandContext()` ; `sceneOf` ; `isGroup` ; `runCommand`.
- Produces: `radialStore`, `openRadial(ring)`, `closeRadial()`, `updateRadial(patch)`, `useRadial(selector)` ; `type RadialOpen = { client: Point; center: Point; kind: RingKind; context: CommandContext; pressed: boolean; sliding: boolean; hovered: number | null }` ; `chooseSlot(slot)` ; `ringAt(element, client)` ; `installRadial(win): () => void` ; `<RadialMenu />`.

- [ ] **Step 1: Write the failing tests**

`src/radial/install.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { requestClose } from "@/fleet/terminals";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { openNativeMenuAt } from "./bridges";
import { installRadial } from "./install";
import { radialStore } from "./radialState";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/fleet/terminals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fleet/terminals")>()),
  requestClose: vi.fn(),
}));

const rect = { id: "r1", type: "rectangle", x: 100, y: 100, width: 100, height: 80, angle: 0, strokeWidth: 2, isDeleted: false, frameId: null } as unknown as ExcalidrawElement;
const updateScene = vi.fn();
let uninstall: () => void;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(() => {
  document.body.innerHTML =
    '<div class="excalidraw"><div class="excalidraw-container" tabindex="0"><canvas class="excalidraw__canvas interactive"></canvas><div class="excalidraw__embeddable-container"><div data-terminal="isis"><div class="xterm"><span id="text">PS C:\\&gt;</span></div><input id="name" /></div></div></div></div>';
  updateScene.mockClear();
  canvasStore.setState({
    api: { getSceneElements: () => [rect], getAppState: () => ({ selectedElementIds: {} }), updateScene } as unknown as ExcalidrawImperativeAPI,
    view: { scrollX: 0, scrollY: 0, zoom: 1, width: 1000, height: 800, offsetLeft: 0, offsetTop: 0, tool: "selection", selectedIds: [], editingFrame: null },
    frames: [],
    nodeIds: ["isis"],
  });
  projectsStore.setState({ view: "project" } as never);
  workspacesStore.setState({ status: "ready", activeId: "w1" } as never);
  radialStore.setState({ ring: null });
  uninstall = installRadial(window);
});
afterEach(() => uninstall());

const pointer = (target: Element, type: string, x: number, y: number, button = 2) => {
  const event = new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const canvas = () => document.querySelector("canvas")!;
const text = () => document.getElementById("text")!;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe("opening the ring (spec menu radial §5.2, §6.4)", () => {
  it("opens the terminal's ring on a right press in its text, the press kept from xterm", () => {
    const xterm = vi.fn();
    text().addEventListener("pointerdown", xterm);
    const press = pointer(text(), "pointerdown", 300, 300);
    expect(xterm).not.toHaveBeenCalled();
    expect(press.defaultPrevented).toBe(true);
    expect(radialStore.getState().ring).toMatchObject({ kind: "terminal", client: { x: 300, y: 300 }, context: { terminalId: "isis", at: { x: 300, y: 300 } } });
  });

  it("opens the canvas ring on the empty canvas, at the scene point of the click", () => {
    pointer(canvas(), "pointerdown", 500, 400);
    expect(radialStore.getState().ring).toMatchObject({ kind: "canvas", context: { at: { x: 500, y: 400 } } });
  });

  it("selects a drawing alone before opening its ring", () => {
    pointer(canvas(), "pointerdown", 150, 140);
    expect(radialStore.getState().ring!.kind).toBe("selection");
    expect(updateScene).toHaveBeenCalledWith({ appState: { selectedElementIds: { r1: true }, selectedGroupIds: {}, activeEmbeddable: null } });
  });

  it("keeps the native behavior in a text field", () => {
    const name = document.getElementById("name")!;
    pointer(name, "pointerdown", 10, 10);
    expect(radialStore.getState().ring).toBeNull();
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    name.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("blocks the native menu on the canvas, lets « Plus… » through", () => {
    const excalidraw = vi.fn();
    canvas().addEventListener("contextmenu", excalidraw);
    const blocked = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas().dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(excalidraw).not.toHaveBeenCalled();
    openNativeMenuAt({ x: 1, y: 1 });
    expect(excalidraw).toHaveBeenCalledTimes(1);
  });
});

describe("choosing in the ring", () => {
  it("runs the slot a slide points at when the right button comes up, a frame after the ring left (Fermer, below)", async () => {
    pointer(text(), "pointerdown", 300, 300);
    pointer(text(), "pointermove", 300, 380);
    expect(radialStore.getState().ring!.hovered).toBe(4);
    pointer(text(), "pointerup", 300, 380);
    expect(radialStore.getState().ring).toBeNull();
    expect(requestClose).not.toHaveBeenCalled();
    await nextFrame();
    expect(requestClose).toHaveBeenCalledWith("isis");
  });

  it("stays open after a short right click; Escape, the wheel or a press outside close it", () => {
    const open = () => {
      pointer(canvas(), "pointerdown", 500, 400);
      pointer(canvas(), "pointerup", 502, 401);
    };
    open();
    expect(radialStore.getState().ring).toMatchObject({ pressed: false, sliding: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(radialStore.getState().ring).toBeNull();
    open();
    window.dispatchEvent(new WheelEvent("wheel"));
    expect(radialStore.getState().ring).toBeNull();
    open();
    pointer(canvas(), "pointerdown", 700, 100, 0);
    expect(radialStore.getState().ring).toBeNull();
  });
});
```

`src/radial/RadialMenu.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { pendingUiRequest } from "@/commands/uiRequests";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { openRadial, radialStore, updateRadial } from "./radialState";
import { RadialMenu } from "./RadialMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(async () => {
  radialStore.setState({ ring: null });
  workspacesStore.setState({ activeId: "w1" } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<RadialMenu />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const open = () =>
  act(async () =>
    openRadial({
      kind: "terminal",
      client: { x: 300, y: 300 },
      center: { x: 300, y: 300 },
      context: { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "isis", at: { x: 300, y: 300 } },
      pressed: false,
      sliding: false,
      hovered: null,
    }),
  );
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("[data-slot]")];

it("draws the ring around the click, clockwise from the top (spec menu radial §4.2, §5.1)", async () => {
  await open();
  expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Copier", "Coller", "Renommer", "Relancer", "Fermer", "Dupliquer", "Mettre en pause", "Arrêter le processus"]);
  expect([buttons()[0].style.left, buttons()[0].style.top, buttons()[2].style.left, buttons()[2].style.top]).toEqual(["0px", "-84px", "84px", "0px"]);
  expect(document.querySelector<HTMLElement>("[data-radial]")!.style.left).toBe("300px");
});

it("greys what cannot run; its pill tells the name and why; a click on it does nothing", async () => {
  await open();
  const copy = buttons()[0];
  expect(copy.getAttribute("aria-disabled")).toBe("true");
  await act(async () => updateRadial({ hovered: 0 }));
  expect(document.querySelector("[data-radial]")!.textContent).toContain("Copier · aucune sélection");
  await act(async () => copy.click());
  expect(radialStore.getState().ring).not.toBeNull();
});

it("closes, then runs the chosen function on the next frame (« Renommer » opens the header's name editor)", async () => {
  await open();
  await act(async () => buttons()[2].click());
  expect(radialStore.getState().ring).toBeNull();
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(pendingUiRequest()).toEqual({ kind: "renameTerminal", id: "isis" });
});

it("closes on its ×, and when the workspace changes or a dialog opens (spec menu radial §7)", async () => {
  await open();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Fermer le menu"]')!.click());
  expect(radialStore.getState().ring).toBeNull();
  await open();
  await act(async () => workspacesStore.setState({ activeId: "w2" } as never));
  expect(radialStore.getState().ring).toBeNull();
  await open();
  await act(async () => uiStore.getState().setClosing({ agents: ["isis"], remove: ["isis"] }));
  expect(radialStore.getState().ring).toBeNull();
  uiStore.getState().setClosing(null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/radial/install.test.ts src/radial/RadialMenu.test.tsx`
Expected: FAIL — `./install`, `./radialState`, `./RadialMenu` introuvables.

- [ ] **Step 3: Write the ring**

`src/radial/radialState.ts` :

```ts
import { createStore, useStore } from "zustand";
import type { CommandContext } from "@/commands/command";
import type { Point } from "@/fleet/terminals";
import type { RingKind } from "./rings";

export interface RadialOpen {
  /** Where the right button went down, in the window. */
  client: Point;
  /** The ring's center: the click point moved off the window's edges. */
  center: Point;
  kind: RingKind;
  context: CommandContext;
  /** The right button is still down. */
  pressed: boolean;
  /** It moved more than 6 px: its release runs the slot it points at. */
  sliding: boolean;
  /** The slot under the pointer, or pointed at by the slide. */
  hovered: number | null;
}

export const radialStore = createStore<{ ring: RadialOpen | null }>()(() => ({ ring: null }));

export function openRadial(ring: RadialOpen) {
  radialStore.setState({ ring });
}

export function closeRadial() {
  radialStore.setState({ ring: null });
}

export function updateRadial(patch: Partial<RadialOpen>) {
  const { ring } = radialStore.getState();
  if (ring) radialStore.setState({ ring: { ...ring, ...patch } });
}

export function useRadial<T>(selector: (state: { ring: RadialOpen | null }) => T): T {
  return useStore(radialStore, selector);
}
```

`src/radial/choose.ts` :

```ts
import { runCommand } from "@/commands/command";
import { closeRadial, radialStore } from "./radialState";
import { lineOf, RINGS } from "./rings";

/**
 * Closes the ring, then runs the slot's command on the next frame, once the
 * ring has left the screen: Excalidraw pastes only over its canvas (spec menu
 * radial §6.3). Evaluated now: a target gone meanwhile does nothing (§7).
 */
export function chooseSlot(slot: number) {
  const { ring } = radialStore.getState();
  closeRadial();
  const definition = ring ? RINGS[ring.kind][slot] : null;
  const line = ring && definition ? lineOf(definition, ring.context) : null;
  if (!ring || !line?.enabled) return;
  requestAnimationFrame(() => runCommand(line.command, ring.context));
}
```

`src/radial/install.ts` :

```ts
import { canvasStore } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import type { CommandContext } from "@/commands/command";
import { commandContext } from "@/commands/registry";
import { sceneOf } from "@/fleet/placement";
import type { Point } from "@/fleet/terminals";
import { isNativeMenu } from "./bridges";
import { chooseSlot } from "./choose";
import { isSlide, ringCenter, slotAt } from "./gesture";
import { closeRadial, openRadial, radialStore, updateRadial } from "./radialState";
import type { RingKind } from "./rings";
import { domTarget, isTextField, sceneTarget } from "./target";

/** The canvas or a node: where a right click is the ring's. */
function onCanvas(element: Element): boolean {
  return (
    element.closest(".excalidraw__embeddable-container") !== null ||
    (element instanceof HTMLCanvasElement && element.classList.contains("interactive"))
  );
}

/** The ring a right press opens, and its context (spec menu radial §6.1, §6.4); null where it opens none. */
export function ringAt(element: Element, client: Point): { kind: RingKind; context: CommandContext } | null {
  const { api, view, frames } = canvasStore.getState();
  if (!api || !onCanvas(element) || isTextField(element)) return null;
  const at = sceneOf(client, view);
  const selection = api.getAppState().selectedElementIds;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const target =
    domTarget(element) ??
    sceneTarget({ point: at, zoom: view.zoom, elements: api.getSceneElements(), selectedIds, groupIds: new Set(frames.filter(isGroup).map((f) => f.id)) });
  const context: CommandContext = { ...commandContext(), at };
  switch (target.kind) {
    case "terminal":
      return { kind: "terminal", context: { ...context, terminalId: target.id } };
    case "orchestrator":
      return { kind: "orchestrator", context: { ...context, orchestratorId: target.id } };
    case "group":
      return { kind: "group", context: { ...context, groupId: target.id } };
    case "selection": {
      // As Excalidraw does: a drawing outside the selection becomes the selection; the keys go to the canvas.
      const same = target.ids.length === selectedIds.length && target.ids.every((id) => selection[id]);
      api.updateScene({
        appState: same
          ? { activeEmbeddable: null }
          : { selectedElementIds: Object.fromEntries(target.ids.map((id) => [id, true])), selectedGroupIds: {}, activeEmbeddable: null },
      });
      return { kind: "selection", context };
    }
    default:
      return { kind: "canvas", context };
  }
}

/** The right click opens the ring; the native menu never opens unasked (spec menu radial §5.2). */
export function installRadial(win: Window): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const { ring } = radialStore.getState();
    const element = event.target instanceof Element ? event.target : null;
    if (event.button === 2 && element) {
      const client = { x: event.clientX, y: event.clientY };
      const opened = ringAt(element, client);
      if (!opened) {
        if (ring) closeRadial();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const center = ringCenter(client, { width: win.innerWidth, height: win.innerHeight });
      openRadial({ ...opened, client, center, pressed: true, sliding: false, hovered: null });
      return;
    }
    if (ring && !element?.closest("[data-radial]")) closeRadial();
  };
  const onPointerMove = (event: PointerEvent) => {
    const { ring } = radialStore.getState();
    if (!ring?.pressed) return;
    const pointer = { x: event.clientX, y: event.clientY };
    if (!ring.sliding && !isSlide(ring.client, pointer)) return;
    updateRadial({ sliding: true, hovered: slotAt(ring.center, pointer) });
  };
  const onPointerUp = (event: PointerEvent) => {
    const { ring } = radialStore.getState();
    if (event.button !== 2 || !ring?.pressed) return;
    event.preventDefault();
    event.stopPropagation();
    if (!ring.sliding) updateRadial({ pressed: false });
    else if (ring.hovered === null) closeRadial();
    else chooseSlot(ring.hovered);
  };
  const onContextMenu = (event: MouseEvent) => {
    if (isNativeMenu(event)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (radialStore.getState().ring || (element && onCanvas(element) && !isTextField(element))) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !radialStore.getState().ring) return;
    event.preventDefault();
    event.stopPropagation();
    closeRadial();
  };
  const onWheel = () => {
    if (radialStore.getState().ring) closeRadial();
  };
  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["contextmenu", onContextMenu as EventListener],
    ["keydown", onKeyDown as EventListener],
    ["wheel", onWheel],
  ];
  for (const [type, listener] of listeners) win.addEventListener(type, listener, true);
  return () => {
    for (const [type, listener] of listeners) win.removeEventListener(type, listener, true);
  };
}
```

`src/radial/RadialMenu.tsx` :

```tsx
import { useEffect } from "react";
import { X } from "lucide-react";
import { paletteStore } from "@/commands/paletteState";
import { cn } from "@/lib/utils";
import { projectsStore } from "@/store/projects";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { chooseSlot } from "./choose";
import { BUTTON_SIZE, PILL_GAP, RING_RADIUS, slotPosition } from "./gesture";
import { closeRadial, radialStore, updateRadial, useRadial } from "./radialState";
import { lineOf, RINGS } from "./rings";

/** The ring closes when its context goes: another workspace or project, a dialog, the palette (spec menu radial §7). */
function closeOnLeave() {
  const close = () => {
    if (radialStore.getState().ring) closeRadial();
  };
  const unsubscribes = [
    workspacesStore.subscribe((s, prev) => s.activeId !== prev.activeId && close()),
    projectsStore.subscribe((s, prev) => (s.view !== prev.view || s.activeId !== prev.activeId) && close()),
    uiStore.subscribe((s) => (s.closing !== null || s.closingGroup !== null) && close()),
    paletteStore.subscribe((s) => s.open && close()),
  ];
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/** The ring of the right click (spec menu radial §5). */
export function RadialMenu() {
  const ring = useRadial((s) => s.ring);
  useEffect(closeOnLeave, []);
  if (!ring) return null;
  const lines = RINGS[ring.kind].map((slot) => (slot ? lineOf(slot, ring.context) : null));
  const pill = ring.hovered !== null ? lines[ring.hovered] : null;
  return (
    <div data-radial className="ov-radial-in pointer-events-none fixed z-[45]" style={{ left: ring.center.x, top: ring.center.y }}>
      {lines.map((line, slot) => {
        if (!line) return null;
        const at = slotPosition(slot);
        return (
          <button
            key={slot}
            type="button"
            data-slot={slot}
            aria-label={line.label}
            aria-disabled={!line.enabled}
            className={cn(
              "ov-glass-strong pointer-events-auto absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-ov-text transition-transform duration-100",
              ring.hovered === slot && line.enabled && "scale-[1.06] bg-ov-accent-soft ring-1 ring-ov-accent",
              !line.enabled && "opacity-40",
            )}
            style={{ left: at.x, top: at.y }}
            onPointerEnter={() => updateRadial({ hovered: slot })}
            onPointerLeave={() => updateRadial({ hovered: null })}
            onClick={() => line.enabled && chooseSlot(slot)}
          >
            <line.Icon className={cn("size-[18px]", line.danger && "text-ov-danger")} />
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Fermer le menu"
        onClick={closeRadial}
        className="ov-glass-strong pointer-events-auto absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-ov-text-2"
        style={{ left: 0, top: 0 }}
      >
        <X className="size-4" />
      </button>
      {pill && (
        <div
          className="ov-glass-strong absolute -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-xs text-ov-text"
          style={{ left: 0, top: RING_RADIUS + BUTTON_SIZE / 2 + PILL_GAP }}
        >
          {pill.reason ? `${pill.label} · ${pill.reason}` : pill.label}
        </div>
      )}
    </div>
  );
}
```

`src/index.css` — à la fin :

```css
/* The radial menu opens from its center (spec menu radial §5.1). */
@keyframes ov-radial-in {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.ov-radial-in {
  animation: ov-radial-in 120ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .ov-radial-in {
    animation: none;
  }
}
```

`src/shell/ProjectView.tsx` — importer `RadialMenu` depuis `@/radial/RadialMenu` et le monter après `<LinkMode />`.

`src/main.tsx` — importer `installRadial` depuis `./radial/install` ; après `trackTerminalFocus(document);` : `installRadial(window);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/radial`, puis `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: PASS ; tout passe ; build propre.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/radial/radialState.ts src/radial/choose.ts src/radial/install.ts src/radial/install.test.ts src/radial/RadialMenu.tsx src/radial/RadialMenu.test.tsx src/shell/ProjectView.tsx src/main.tsx src/index.css
git commit -m "feat(radial): the right click opens a ring of eight functions under the pointer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EKtj2evd4bskqWkTAj8hc"
```

---

### Task 7: Vérification réelle et livraison

**Files:**
- Aucun (sauf correctif né d'un constat, avec son test d'abord rouge et une décision au journal).

**Interfaces:**
- Consumes: tâches 1 à 6.
- Produces: `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J9.exe` ; raccourci « dummyPlane (dernière build) » repointé.

- [ ] **Step 1: Check the ring in the real app**

App de sonde lancée comme à la tâche 1 (port 9223), fenêtre visible (`ShowWindow` sans activation si elle est réduite). Dans le workspace de test de la tâche 1 (un rectangle) et dans un workspace à agents, avec `node cdp.mjs 9223 …` (`mouse:pressed,x,y,right` / `mouse:released,x,y,right` pour le clic droit, `mouse:moved,…` pour glisser) :
1. Clic droit bref sur le fond : 8 boutons, `document.querySelectorAll('[data-slot]').length` → 8 ; capture.
2. « Lancer Shell » (clic gauche sur la position ↗, centre + (59, -59)) : un terminal Shell apparaît au point du clic (son élément de scène contient le point).
3. Clic droit sur le rectangle : anneau des dessins ; « Plus… » → `.context-menu` présent ; Échap.
4. Copier puis Coller (anneau du fond, position ↓) : un rectangle de plus au point du clic.
5. Clic droit maintenu sur le terminal, glisser de 80 px vers le bas, relâcher : « Fermer <nom> ? » (dialogue de garde) ; Annuler.
6. Dans le terminal : texte sélectionné (glisser gauche dans xterm), clic droit, « Copier » → `navigator.clipboard.readText()` contient le texte ; « Coller » → le texte arrive dans le terminal.
7. Clic droit sur l'étiquette d'un groupe : anneau du groupe (`aria-label` « Ajouter un agent… » en tête).
8. Clic droit près du bord droit : `[data-radial]` entier dans la fenêtre.
9. Clic droit dans le champ de la barre de commande : pas d'anneau.
Expected : chaque point comme dit ; captures dans `$SCRATCH\crisp\g1-*.png`. Un écart devient un correctif (test d'abord rouge) et une décision au journal.

- [ ] **Step 2: Build the installer and the test copy**

Run : `pnpm tauri build > "$SCRATCH/g1-build.log" 2>&1` (en arrière-plan), puis copier `src-tauri\target\release\dummyplane.exe` en `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J9.exe` et repointer le raccourci du bureau.
Expected : `Finished 1 bundle at: …\dummyPlane_0.1.0_x64-setup.exe` ; sous-système PE `2` ; copie et raccourci en place.

- [ ] **Step 3: Hand over**

Donner à Mathieu la version et ses vérifications (spec menu radial §8) : les critères de §1.1 ; Copier puis Coller dans un terminal et entre deux dessins ; « Autre agent… » lance Codex au point du clic ; un anneau près d'un bord ; le geste « maintenir et glisser ».
