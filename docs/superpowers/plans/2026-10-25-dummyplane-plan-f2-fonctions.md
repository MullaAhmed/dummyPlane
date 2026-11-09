# dummyPlane — Plan F2 : le catalogue des fonctions (jalon J8, partie 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toute action d'dummyPlane se trouve par Ctrl+Maj+P : les fonctions de la spec fenêtre §7.3 (Navigation, Workspaces, Agents, Terminal · <prénom>, Groupe · <nom>, Dessin, Scène, Projets, Fenêtre, Aide) entrent au registre de commandes, chacune faisant exactement ce que fait déjà son bouton ou son entrée de menu.

**Architecture:** Les actions aujourd'hui enfermées dans des composants (ajuster la vue, zoom, export, à propos, ajout de projet, suppression de workspace, boutons de fenêtre, lancement au centre) sont sorties dans de petits modules que boutons et registre appellent. Les fonctions qui ouvrent un menu ou un renommage passent par des « demandes d'interface » (`requestUi`) qu'écoute le composant concerné. Le catalogue est rangé par sections dans `src/commands/catalog/`, et `registry.ts` les assemble dans l'ordre de la spec. Une commande peut avoir un libellé et une section qui dépendent du moment, une touche affichée et un motif de grisé.

**Tech Stack:** React 19, TypeScript (lib ES2020), Zustand 5, cmdk 1.1.1, Radix (shadcn), Excalidraw 0.18.1 (figé), Tauri 2.12, Vitest 5 (happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md` §7.3, §8, §9, §11 ; amendée par `docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md` (panneau Agents au lieu du panneau Flotte, rail d'outils avec la Main). Ordre fixé par Mathieu le 2026-10-25 : F2, puis le menu radial (qui réutilisera ce registre), puis R3.

## Global Constraints

- Sections et fonctions (spec fenêtre §7.3), dans cet ordre :
  - **Navigation** (projet ouvert ; « Aller à… » toujours) : Terminal suivant, Terminal précédent, Aller à…, Vue d'ensemble, Rendre la main au canvas, Ajuster à la scène, Zoom 100 %, Écrire une consigne (curseur dans la barre de consigne), Afficher / Masquer le panneau Agents, Accueil, Fermer le projet.
  - **Workspaces** (projet ouvert ; Supprimer : pas le dernier) : Nouveau workspace, Renommer le workspace (renommage dans l'onglet), Supprimer le workspace (confirmation existante).
  - **Agents** (projet ouvert) : Lancer Claude, Codex, Gemini, Qwen Code, Cursor, OpenCode, Aider, Ollama, Shell ; Lancer un agent personnalisé… (ouvre le menu Agent) ; Nouvelle console ; Lancer 4 agents ; Orchestrateur ; Composer un groupe… ; Tout mettre en pause ; Tout reprendre.
  - **Terminal · <prénom>** (un terminal courant) : Renommer, Dupliquer, Relancer, Arrêter le processus (processus vivant), Mettre en pause, Reprendre (mêmes règles que le survol des lignes du panneau), Fermer.
  - **Groupe · <nom>** (le terminal courant est membre d'un groupe) : Renommer le groupe, Ajouter un agent… (ouvre le menu du groupe), Relier un orchestrateur, Dégrouper, Fermer le groupe.
  - **Dessin** (projet ouvert) : Sélection, Rectangle, Ellipse, Losange, Ligne, Flèche, Cadre, Texte, Stylo, Gomme, Image, Annuler, Rétablir — avec leurs touches d'Excalidraw affichées.
  - **Scène** (projet ouvert) : Exporter la scène…, Importer une scène…, Exporter en PNG….
  - **Projets** (accueil) : Ajouter un projet.
  - **Fenêtre** (toujours) : Réduire, Agrandir / Restaurer (selon l'état), Fermer dummyPlane.
  - **Aide** (toujours) : À propos d'dummyPlane.
- Une fonction indisponible dans le contexte n'est pas listée ; le contexte est celui de l'ouverture de la palette (écran, workspace affiché, terminal courant et son groupe).
- Chaque fonction fait exactement ce que fait son bouton, sa puce ou son entrée de menu (mêmes dialogues de confirmation, mêmes toasts). Les lancements d'agent posent au centre de la vue avec la règle de « Nouvelle console » (dans le groupe sous le centre de la vue s'il y en a un), avec les options par défaut du menu Agent ; un agent non détecté apparaît comme dans le menu Agent (grisé, « <binaire> introuvable dans le PATH »). Un outil de dessin choisi rend le clavier au canvas.
- Échec : toast « <Action> impossible : <raison> » (spec fenêtre §9).
- Interface en français ; code et commentaires en anglais ; TypeScript lib ES2020.
- Tests : `pnpm test` ; `pnpm exec tsc --noEmit` et `pnpm build` propres ; test ciblé : `pnpm exec vitest run <fichiers>`. Un test qui charge un module atteignant `@excalidraw/excalidraw` à l'exécution le simule (`vi.mock("@excalidraw/excalidraw", () => ({}))`). Sous Windows, deux fichiers d'un même dossier ne doivent jamais ne différer que par la casse.
- Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; supprimer les `*.stackdump` avant chaque commit.
- Ne jamais lancer l'exécutable release ni l'installateur depuis la session (l'dummyPlane installé de Mathieu peut tourner : ne jamais le fermer) ; vérification sur le profil `dev.dummyplane.probe` sans souris ni clavier ; après le build, copie `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J8b.exe` et raccourci « dummyPlane (dernière build) » repointé.

### Décisions du plan (portées à Mathieu à la remise)

1. **Lancer Ollama…** ouvre le menu Agent sur le choix du modèle (un lancement Ollama sans modèle ne démarre rien d'utile) ; les huit autres agents se lancent directement.
2. **Relancer** reprend la session pour Claude (comme « Reprendre la dernière conversation »), relance à neuf pour les autres agents ; les autres variantes restent dans le menu ⟳ de l'en-tête.
3. **Orchestrateur** se pose directement au centre de la vue (règle des lancements de §7.3), sans passer par le mode de pose du menu.
4. **Composer un groupe…** et **Ajouter un agent…** ouvrent leur fenêtre dans le panneau Agents (ouvert au besoin, filtre « Tous ») : ce sont les seuls endroits toujours à l'écran où elles sont ancrées.
5. **Dessin** compte aussi la **Main** (H), présente dans le rail depuis R2 ; **Annuler / Rétablir** envoient Ctrl+Z / Ctrl+Y au canvas (l'API d'Excalidraw 0.18 n'expose pas l'historique).

## Review Focus

1. Une fonction du terminal ou du groupe agit sur celui qui avait le clavier à l'ouverture de la palette, pas sur un autre (tests : tâche 6 « acts on the terminal of the moment »).
2. Un agent non détecté est listé grisé avec la raison, et la palette ne le choisit jamais (test : tâche 5 « greys an agent not found… »).
3. Un renommage demandé par la palette garde le clavier dans son champ (pas de vol de focus, pas de validation immédiate) (tests : tâche 3 « opens its name editor on request », tâche 6 « shows the terminal without taking the keyboard »).
4. « Supprimer le workspace » n'est jamais proposé pour le dernier workspace et passe par la confirmation existante (test : tâche 4 « never deletes the last workspace »).
5. « Agrandir / Restaurer » suit l'état réel de la fenêtre (test : tâche 2 « publishes the maximized state », tâche 4 « names the maximize command after the window's state »).

---

## File Structure

- `src/commands/command.ts`, `src/commands/functions.ts`, `src/commands/Palette.tsx` : libellés et sections selon le moment, touche affichée, lignes grisées.
- `src/canvas/viewActions.ts`, `src/shell/sceneActions.ts`, `src/app/about.ts`, `src/home/addProject.ts`, `src/shell/workspaceActions.ts`, `src/shell/windowState.ts`, `src/shell/commandBarFocus.ts` (nouveaux) ; `src/fleet/quickActions.ts` : actions partagées.
- `src/commands/uiRequests.ts` (nouveau) ; `src/canvas/arrive.ts` (`showNode`) ; écouteurs dans `WorkspaceTabs`, `TerminalHeader`, `AgentMenu`, `ComposeGroup`, `GroupMenu`.
- `src/commands/catalog/navigation.ts`, `workspaces.ts`, `app.ts`, `agents.ts`, `current.ts`, `drawing.ts` (nouveaux) ; `src/commands/registry.ts` les assemble.

---

### Task 1: Des commandes selon le moment

**Files:**
- Modify: `src/commands/command.ts`, `src/commands/functions.ts`, `src/commands/functions.test.ts`, `src/commands/Palette.tsx`

**Interfaces:**
- Consumes: `rank` (F1).
- Produces:
  - `Command.label: string | ((ctx: CommandContext) => string)` ; `Command.section: string | ((ctx: CommandContext) => string)` ; `Command.keys?: string` (touche affichée seulement) ; `Command.disabled?: (ctx: CommandContext) => string | null` (raison du grisé) ;
  - `labelOf(command: Command, ctx: CommandContext): string`, `sectionOf(command: Command, ctx: CommandContext): string` ;
  - `interface FunctionLine { command: Command; label: string; section: string; hint: string | null; disabled: string | null }` ; `functionSections(commands, ctx, query): { label: string; items: FunctionLine[] }[]`.

- [ ] **Step 1: Write the failing test**

`src/commands/functions.test.ts` — ajouter :

```ts
  it("names a line and its section after the moment, shows its key, and why it is greyed", () => {
    const rename: Command = {
      id: "terminal.rename",
      label: (c) => `Renommer ${c.terminalId}`,
      section: (c) => `Terminal · ${c.terminalId}`,
      keywords: [],
      keys: "F2",
      available: () => true,
      run: () => undefined,
    };
    const codex: Command = {
      id: "agent.launch.codex",
      label: "Lancer Codex",
      section: "Agents",
      keywords: [],
      available: () => true,
      disabled: () => "codex introuvable dans le PATH",
      run: () => undefined,
    };
    const sections = functionSections([rename, codex], { ...ctx, terminalId: "Isis" }, "");
    expect(sections.map((s) => s.label)).toEqual(["Terminal · Isis", "Agents"]);
    expect(sections[0].items[0]).toMatchObject({ label: "Renommer Isis", hint: "F2", disabled: null });
    expect(sections[1].items[0]).toMatchObject({ label: "Lancer Codex", hint: null, disabled: "codex introuvable dans le PATH" });
    expect(labelOf(rename, { ...ctx, terminalId: "Thot" })).toBe("Renommer Thot");
    expect(sectionOf(codex, ctx)).toBe("Agents");
  });
```

(importer `labelOf`, `sectionOf` depuis `./command`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/functions.test.ts`
Expected: FAIL — `labelOf` introuvable ; types de `label` et `section` trop étroits.

- [ ] **Step 3: Widen the commands**

`src/commands/command.ts` — l'interface `Command` devient :

```ts
export interface Command {
  id: string;
  /** Fixed, or read when the palette lists it (« Agrandir » / « Restaurer »). */
  label: string | ((ctx: CommandContext) => string);
  /** Fixed, or named after the moment (« Terminal · Isis »). */
  section: string | ((ctx: CommandContext) => string);
  keywords: readonly string[];
  shortcut?: Shortcut;
  /** A key shown at the right for display only: Excalidraw's one-letter tools. */
  keys?: string;
  available: (ctx: CommandContext) => boolean;
  /** Listed but greyed, with why: an agent not found on this computer, as in the Agent menu. */
  disabled?: (ctx: CommandContext) => string | null;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export function labelOf(command: Command, ctx: CommandContext): string {
  return typeof command.label === "function" ? command.label(ctx) : command.label;
}

export function sectionOf(command: Command, ctx: CommandContext): string {
  return typeof command.section === "function" ? command.section(ctx) : command.section;
}
```

et dans `runCommand`, le toast prend `labelOf(command, ctx)` au lieu de `command.label`.

`src/commands/functions.ts` (fichier complet) :

```ts
import { labelOf, sectionOf, type Command, type CommandContext } from "./command";
import { rank } from "./search";

/** A line of the functions mode, as listed at this moment. */
export interface FunctionLine {
  command: Command;
  label: string;
  section: string;
  /** Its shortcut, or the key Excalidraw gives it. */
  hint: string | null;
  /** Why it cannot run, when it is listed greyed. */
  disabled: string | null;
}

/**
 * The functions mode (spec fenêtre §7.3): the commands available at that
 * moment, by section in the registry's order, each ranked by the search. The
 * palette's own command is not listed in it.
 */
export function functionSections(commands: readonly Command[], ctx: CommandContext, query: string): { label: string; items: FunctionLine[] }[] {
  const lines = commands
    .filter((c) => c.id !== "palette.functions" && c.available(ctx))
    .map(
      (command): FunctionLine => ({
        command,
        label: labelOf(command, ctx),
        section: sectionOf(command, ctx),
        hint: command.shortcut ?? command.keys ?? null,
        disabled: command.disabled?.(ctx) ?? null,
      }),
    );
  const labels: string[] = [];
  for (const line of lines) if (!labels.includes(line.section)) labels.push(line.section);
  return labels
    .map((label) => ({
      label,
      items: rank(
        lines.filter((l) => l.section === label),
        query,
        (l) => ({ label: l.label, keywords: l.command.keywords }),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
```

`src/commands/Palette.tsx` — les lignes de fonctions deviennent des `FunctionLine` ; remplacer le calcul des clés :

```tsx
  const keys =
    mode === "goTo"
      ? goToList.flatMap((s) => s.items.map((i) => i.key))
      : functionList.flatMap((s) => s.items.filter((l) => l.disabled === null).map((l) => l.command.id));
```

et le rendu des fonctions :

```tsx
            {mode === "functions" &&
              context &&
              functionList.map((section) => (
                <Command.Group key={section.label} heading={section.label}>
                  {section.items.map((line) => (
                    <Command.Item
                      key={line.command.id}
                      value={line.command.id}
                      disabled={line.disabled !== null}
                      className={`${ITEM} data-[disabled=true]:opacity-50`}
                      onSelect={() => {
                        closePalette();
                        runCommand(line.command, context);
                      }}
                    >
                      <span className="truncate text-ov-text">{line.label}</span>
                      {line.disabled !== null ? (
                        <span className="ml-auto shrink-0 text-[11px] text-ov-text-3">{line.disabled}</span>
                      ) : (
                        line.hint && <span className="ml-auto shrink-0 font-mono text-[11px] text-ov-text-3">{line.hint}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands`, puis `pnpm exec tsc --noEmit`
Expected: PASS ; aucune erreur.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/command.ts src/commands/functions.ts src/commands/functions.test.ts src/commands/Palette.tsx
git commit -m "feat(commands): labels and sections of the moment, shown keys, greyed lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Les actions partagées

**Files:**
- Create: `src/canvas/viewActions.ts`, `src/canvas/viewActions.test.ts`
- Create: `src/shell/sceneActions.ts`, `src/shell/sceneActions.test.ts`
- Create: `src/app/about.ts`, `src/home/addProject.ts`, `src/shell/workspaceActions.ts`, `src/shell/windowState.ts`, `src/shell/commandBarFocus.ts`
- Create: `src/shell/sharedActions.test.ts`
- Modify: `src/shell/ToolRail.tsx`, `src/shell/ZoomControl.tsx`, `src/shell/SettingsMenu.tsx`, `src/home/HomeScreen.tsx`, `src/shell/WorkspaceTabs.tsx`, `src/shell/WindowControls.tsx`, `src/shell/WindowControls.test.tsx`, `src/shell/CommandBar.tsx`, `src/fleet/quickActions.ts`

**Interfaces:**
- Produces: `fitScene(): void`, `zoomTo(next: number): void` ; `exportCurrentScene(): void`, `importIntoScene(): void`, `exportCurrentPng(): void` ; `showAbout(): Promise<void>` ; `addProject(): Promise<void>` ; `removeWorkspace(workspace: Workspace, running: number): Promise<void>` ; `windowStore` (`{ maximized: boolean }`), `minimizeWindow()`, `toggleMaximizeWindow()`, `closeWindow()` ; `focusCommandBar(doc?: Document): boolean` ; `launchAt(agent: AgentId): void`, `placeOrchestrator(): void` (avec `newConsole`, `launchFour`).

- [ ] **Step 1: Write the failing tests**

`src/canvas/viewActions.test.ts` :

```ts
// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { fitScene, zoomTo } from "./viewActions";

const scrollToContent = vi.fn();
const updateScene = vi.fn();
const withScene = (elements: unknown[]) =>
  canvasStore.setState({
    api: { getSceneElements: () => elements, scrollToContent, updateScene } as unknown as ExcalidrawImperativeAPI,
    view: { ...EMPTY_VIEW, zoom: 0.5, width: 1000, height: 800 },
  });

beforeEach(() => {
  scrollToContent.mockClear();
  updateScene.mockClear();
});

it("fits the whole scene, and leaves an empty one alone (« Ajuster »)", () => {
  withScene([{ id: "a" }]);
  fitScene();
  expect(scrollToContent).toHaveBeenCalledWith([{ id: "a" }], { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
  withScene([]);
  fitScene();
  expect(scrollToContent).toHaveBeenCalledTimes(1);
});

it("zooms around the view's center (« Zoom 100 % » and the zoom control)", () => {
  withScene([]);
  zoomTo(1);
  expect(updateScene.mock.calls[0][0].appState.zoom.value).toBe(1);
});
```

`src/shell/sceneActions.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { workspacesStore } from "@/store/workspaces";
import { exportCurrentPng, exportCurrentScene, importIntoScene } from "./sceneActions";
import { exportPng, exportScene, importScene } from "./sceneFiles";

vi.mock("./sceneFiles", () => ({
  exportScene: vi.fn(() => Promise.resolve(true)),
  importScene: vi.fn(() => Promise.reject(new Error("fichier illisible"))),
  exportPng: vi.fn(() => Promise.resolve(true)),
}));

const api = {} as ExcalidrawImperativeAPI;

beforeEach(() => {
  canvasStore.setState({ api });
  workspacesStore.setState({ workspaces: [{ id: "w1", name: "Backend" }], activeId: "w1" } as never);
});
afterEach(() => vi.restoreAllMocks());

it("exports the scene on screen under its workspace's name, as the settings menu did", async () => {
  exportCurrentScene();
  exportCurrentPng();
  expect(exportScene).toHaveBeenCalledWith(api, "Backend");
  expect(vi.mocked(exportPng).mock.calls[0].slice(0, 2)).toEqual([api, "Backend"]);
});

it("says so when an import fails", async () => {
  const error = vi.spyOn(toast, "error").mockImplementation(() => "");
  importIntoScene();
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Import impossible : .*fichier illisible/)));
  expect(importScene).toHaveBeenCalledWith(api);
});
```

`src/shell/sharedActions.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { showAbout } from "@/app/about";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { launchAt, placeOrchestrator } from "@/fleet/quickActions";
import { launchAgent } from "@/fleet/launchAgent";
import { addOrchestrator } from "@/fleet/orchestrators";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import { focusCommandBar } from "./commandBarFocus";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/fleet/launchAgent", () => ({ launchAgent: vi.fn(() => Promise.resolve()), defaultLaunchOptions: () => ({ cwd: "C:/code", shell: "default", title: "", command: "" }) }));
vi.mock("@/fleet/orchestrators", () => ({ addOrchestrator: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  mockIPC((cmd) => (cmd === "plugin:app|version" ? "0.1.0" : undefined));
  canvasStore.setState({ view: { ...EMPTY_VIEW, width: 1000, height: 800 } });
  workspacesStore.setState({ activeId: "w1" } as never);
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("tells dummyPlane's version (« À propos d'dummyPlane »)", async () => {
  await showAbout();
  expect(toast).toHaveBeenCalledWith("dummyPlane 0.1.0", { description: "Canvas d'agents local et open source." });
});

it("launches an agent, or places an orchestrator, at the center of the view", () => {
  launchAt("codex");
  const [agent, , center] = vi.mocked(launchAgent).mock.calls[0];
  expect(agent).toBe("codex");
  expect(center).toEqual({ x: 500, y: 400 });
  placeOrchestrator();
  expect(addOrchestrator).toHaveBeenCalledWith("w1", { x: 500, y: 400 });
});

it("puts the cursor in the command bar's field (« Écrire une consigne »)", () => {
  expect(focusCommandBar()).toBe(false);
  document.body.innerHTML = '<div data-command-bar><textarea></textarea></div>';
  expect(focusCommandBar()).toBe(true);
  expect(document.activeElement).toBe(document.querySelector("textarea"));
  expect(readSource("shell/CommandBar.tsx")).toContain("data-command-bar");
});

it("keeps one implementation of each action: the buttons call the shared ones", () => {
  expect(readSource("shell/ToolRail.tsx")).toContain("fitScene");
  expect(readSource("shell/ZoomControl.tsx")).toContain("zoomTo(");
  expect(readSource("shell/SettingsMenu.tsx")).toContain("exportCurrentScene");
  expect(readSource("shell/SettingsMenu.tsx")).toContain("showAbout");
  expect(readSource("home/HomeScreen.tsx")).toContain('from "./addProject"');
  expect(readSource("shell/WorkspaceTabs.tsx")).toContain('from "./workspaceActions"');
  expect(readSource("shell/WindowControls.tsx")).toContain("toggleMaximizeWindow");
});
```

`src/shell/WindowControls.test.tsx` — dans « follows the maximized state, however it changed », après `expect(button("Restaurer")).not.toBeNull();`, ajouter :

```tsx
  // Published for the palette's « Agrandir » / « Restaurer ».
  expect(windowStore.getState().maximized).toBe(true);
```

et après le retour à `Agrandir` : `expect(windowStore.getState().maximized).toBe(false);` (importer `windowStore` depuis `./windowState`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/canvas/viewActions.test.ts src/shell/sceneActions.test.ts src/shell/sharedActions.test.ts src/shell/WindowControls.test.tsx`
Expected: FAIL — modules introuvables.

- [ ] **Step 3: Write the shared actions**

`src/canvas/viewActions.ts` :

```ts
import type { NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { canvasStore } from "./canvasStore";
import { zoomAroundCenter } from "./zoom";

/** « Ajuster la vue » of the rail, « Ajuster à la scène » of the palette: the whole scene in view. */
export function fitScene() {
  const api = canvasStore.getState().api;
  const elements = api?.getSceneElements() ?? [];
  if (api && elements.length > 0) api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
}

/** The zoom control's steps and « Zoom 100 % »: `next`, around the view's center. */
export function zoomTo(next: number) {
  const { api, view } = canvasStore.getState();
  if (!api) return;
  const target = zoomAroundCenter(view, next);
  api.updateScene({
    appState: { zoom: { value: target.zoom as NormalizedZoomValue }, scrollX: target.scrollX, scrollY: target.scrollY },
  });
}
```

`src/shell/sceneActions.ts` :

```ts
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { currentTheme } from "@/app/theme";
import { canvasStore } from "@/canvas/canvasStore";
import { workspacesStore } from "@/store/workspaces";
import { exportPng, exportScene, importScene } from "./sceneFiles";

function run(action: (api: ExcalidrawImperativeAPI) => Promise<boolean>, failure: string) {
  const api = canvasStore.getState().api;
  if (!api) return;
  action(api).catch((error: unknown) => toast.error(`${failure} : ${String(error)}`));
}

/** The file name of the scene on screen: its workspace's. */
function sceneName(): string {
  const { workspaces, activeId } = workspacesStore.getState();
  return workspaces.find((w) => w.id === activeId)?.name ?? "scene";
}

/** « Exporter la scène… » of the settings menu and the palette. */
export const exportCurrentScene = () => run((api) => exportScene(api, sceneName()), "Export impossible");

/** « Importer une scène… ». */
export const importIntoScene = () => run(importScene, "Import impossible");

/** « Exporter en PNG… », in the app's theme. */
export const exportCurrentPng = () => run((api) => exportPng(api, sceneName(), currentTheme()), "Export impossible");
```

`src/app/about.ts` :

```ts
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";

/** « À propos d'dummyPlane » of the settings menu and the palette. */
export async function showAbout() {
  const version = await getVersion();
  toast(`dummyPlane ${version}`, { description: "Canvas d'agents local et open source." });
}
```

`src/home/addProject.ts` (déplacé de `HomeScreen.tsx`, comportement inchangé) :

```ts
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { projectsStore } from "@/store/projects";

/** « Ajouter un projet » of the home screen and the palette: a folder, picked in Windows' dialog. */
export async function addProject() {
  const picked = await open({ directory: true, title: "Dossier du projet" });
  if (typeof picked !== "string") return;
  await projectsStore
    .getState()
    .add(picked)
    .catch((error: unknown) => toast.error(`Ajout impossible : ${String(error)}`));
}
```

`src/shell/workspaceActions.ts` (déplacé de `WorkspaceTabs.tsx`, comportement inchangé) :

```ts
import { ask } from "@tauri-apps/plugin-dialog";
import { forgetWorkspaces } from "@/app/forget";
import { flushAll } from "@/lib/flush";
import { plural } from "@/lib/format";
import { workspacesStore, type Workspace } from "@/store/workspaces";

/** Deletes a workspace after confirmation, stopping its terminals (spec V1 §8.5): the tab's × and the palette. */
export async function removeWorkspace(workspace: Workspace, running: number) {
  const consequence =
    running > 0
      ? `${plural(running, "agent sera arrêté", "agents seront arrêtés")} et son contenu effacé.`
      : "Son contenu sera effacé.";
  const confirmed = await ask(`Supprimer « ${workspace.name} » ? ${consequence}`, {
    title: "Supprimer le workspace",
    kind: "warning",
    okLabel: "Supprimer",
    cancelLabel: "Annuler",
  });
  if (!confirmed) return;
  // Pending saves are written first: once the row is gone they would fail.
  await flushAll();
  await workspacesStore.getState().remove(workspace.id);
  forgetWorkspaces([workspace.id]);
}
```

`src/shell/windowState.ts` :

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { createStore } from "zustand";

/** Whether the window is maximized, kept by the window buttons: « Agrandir » or « Restaurer » in the palette. */
export const windowStore = createStore<{ maximized: boolean }>()(() => ({ maximized: false }));

function perform(action: () => Promise<void>, failure: string) {
  void action().catch((error: unknown) => toast.error(`${failure} : ${String(error)}`));
}

export function minimizeWindow() {
  perform(() => getCurrentWindow().minimize(), "Réduction impossible");
}

export function toggleMaximizeWindow() {
  const failure = windowStore.getState().maximized ? "Restauration impossible" : "Agrandissement impossible";
  perform(() => getCurrentWindow().toggleMaximize(), failure);
}

/** close, not destroy: onCloseRequested saves first (src/app/close.ts). */
export function closeWindow() {
  perform(() => getCurrentWindow().close(), "Fermeture impossible");
}
```

`src/shell/commandBarFocus.ts` :

```ts
/** « Écrire une consigne »: the cursor in the command bar's field. False when it is not on screen. */
export function focusCommandBar(doc: Document = document): boolean {
  const field = doc.querySelector<HTMLTextAreaElement>("[data-command-bar] textarea");
  field?.focus();
  return field !== null;
}
```

`src/fleet/quickActions.ts` (fichier complet) :

```ts
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { nextGroupName } from "@/canvas/groups";
import type { AgentId } from "@/ipc/pty";
import { workspacesStore } from "@/store/workspaces";
import { agentsStore } from "./agentsStore";
import { defaultAgent } from "./catalog";
import { launchGroup } from "./groups";
import { defaultLaunchOptions, launchAgent } from "./launchAgent";
import { addOrchestrator } from "./orchestrators";
import { viewportCenter } from "./placement";

const reportLaunchError = (error: unknown) => toast.error(`Lancement impossible : ${String(error)}`);

/** An agent at the center of the view, in the group under it if any, with the default options (spec habillage §11.3, spec fenêtre §7.3). */
export function launchAt(agent: AgentId) {
  const center = viewportCenter(canvasStore.getState().view);
  void launchAgent(agent, defaultLaunchOptions(), center).catch(reportLaunchError);
}

/** "Nouvelle console": the default agent at the center of the view (spec habillage §5.6). */
export function newConsole() {
  launchAt(defaultAgent(agentsStore.getState().agents));
}

/** "Lancer 4 agents": a Général group of four default agents (spec habillage §11.3). */
export function launchFour() {
  const agent = defaultAgent(agentsStore.getState().agents);
  const name = nextGroupName(canvasStore.getState().frames);
  void launchGroup({ name, role: "general", agents: [agent, agent, agent, agent] }).catch(reportLaunchError);
}

/** « Orchestrateur » of the palette: at the center of the view, like a launch (plan F2, décision 3). */
export function placeOrchestrator() {
  const workspaceId = workspacesStore.getState().activeId;
  if (!workspaceId) return;
  void addOrchestrator(workspaceId, viewportCenter(canvasStore.getState().view)).catch(reportLaunchError);
}
```

- [ ] **Step 4: Point the buttons at the shared actions**

- `src/shell/ToolRail.tsx` : supprimer `fitAll` (et l'import de `canvasStore` s'il n'est plus utilisé hors `setTool`), importer `fitScene` depuis `@/canvas/viewActions`, et `onClick={fitScene}` sur « Ajuster la vue ».
- `src/shell/ZoomControl.tsx` : supprimer `apply` et ses imports (`NormalizedZoomValue`, `zoomAroundCenter`, `canvasStore`), importer `zoomTo` depuis `@/canvas/viewActions` ; `onClick={() => zoomTo(stepZoom(zoom, -1))}`, `onClick={() => zoomTo(1)}`, `onClick={() => zoomTo(stepZoom(zoom, 1))}`.
- `src/shell/SettingsMenu.tsx` : supprimer `run`, `name`, et les imports devenus inutiles (`getVersion`, `ExcalidrawImperativeAPI`, `toast`, `canvasStore`, `currentTheme`, `useWorkspaces`, `exportPng`, `exportScene`, `importScene`) ; les entrées deviennent `onSelect={exportCurrentScene}`, `onSelect={importIntoScene}`, `onSelect={exportCurrentPng}`, `onSelect={() => void showAbout()}` (imports depuis `./sceneActions` et `@/app/about`).
- `src/home/HomeScreen.tsx` : supprimer `addProject` et ses imports (`open`, `toast`), importer `addProject` depuis `./addProject`.
- `src/shell/WorkspaceTabs.tsx` : supprimer `removeWorkspace` et ses imports (`ask`, `forgetWorkspaces`, `flushAll`), importer `removeWorkspace` depuis `./workspaceActions`.
- `src/shell/WindowControls.tsx` : supprimer `perform` ; dans `useMaximized`, `read` publie aussi l'état : `(value) => { if (!alive) return; setMaximized(value); windowStore.setState({ maximized: value }); }` ; les boutons appellent `minimizeWindow`, `toggleMaximizeWindow`, `closeWindow` (imports depuis `./windowState` ; `toast` n'y sert plus).
- `src/shell/CommandBar.tsx` : la racine de la barre reçoit `data-command-bar`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/canvas/viewActions.test.ts src/shell/sceneActions.test.ts src/shell/sharedActions.test.ts src/shell/WindowControls.test.tsx`, puis `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: PASS ; tout passe (aucun comportement des boutons ne change).

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/canvas/viewActions.ts src/canvas/viewActions.test.ts src/shell/sceneActions.ts src/shell/sceneActions.test.ts src/app/about.ts src/home/addProject.ts src/shell/workspaceActions.ts src/shell/windowState.ts src/shell/commandBarFocus.ts src/shell/sharedActions.test.ts src/shell/ToolRail.tsx src/shell/ZoomControl.tsx src/shell/SettingsMenu.tsx src/home/HomeScreen.tsx src/shell/WorkspaceTabs.tsx src/shell/WindowControls.tsx src/shell/WindowControls.test.tsx src/shell/CommandBar.tsx src/fleet/quickActions.ts
git commit -m "refactor(shell): one implementation of each action, for the buttons and the palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Les demandes d'interface

**Files:**
- Create: `src/commands/uiRequests.ts`, `src/commands/uiRequests.test.tsx`
- Modify: `src/canvas/arrive.ts`, `src/canvas/arrive.test.ts` (`showNode`)
- Modify: `src/shell/WorkspaceTabs.tsx`, `src/shell/WorkspaceTabs.test.tsx`
- Modify: `src/nodes/terminal/TerminalHeader.tsx` ; Create: `src/nodes/terminal/TerminalHeader.test.tsx`
- Modify: `src/fleet/AgentMenu.tsx`, `src/shell/ToolRail.tsx`, `src/shell/ToolRail.test.tsx`
- Modify: `src/fleet/ComposeGroup.tsx`, `src/fleet/GroupMenu.tsx`, `src/fleet/AgentsPanel.tsx`, `src/fleet/AgentsPanel.test.tsx`

**Interfaces:**
- Produces: `type UiRequest = { kind: "renameWorkspace"; id: string } | { kind: "renameTerminal"; id: string } | { kind: "agentMenu"; view: "options" | "ollama" } | { kind: "composeGroup" } | { kind: "groupMenu"; id: string }` ; `requestUi(request: UiRequest): void` ; `pendingUiRequest(): UiRequest | null` ; `useUiRequest(kind, handle: (request) => boolean, enabled?: boolean): void` ; `showNode(nodeId: string): boolean` ; prop `answersRequests?: boolean` de `AgentMenu`, `ComposeGroup`, `GroupMenu`.

- [ ] **Step 1: Write the failing tests**

`src/commands/uiRequests.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { pendingUiRequest, requestUi, useUiRequest } from "./uiRequests";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Tab({ id, seen }: { id: string; seen: string[] }) {
  useUiRequest("renameWorkspace", (request) => {
    if (request.id !== id) return false;
    seen.push(id);
    return true;
  });
  return null;
}

it("lets the right component answer a request, once, even one made before it mounted", async () => {
  const seen: string[] = [];
  requestUi({ kind: "renameWorkspace", id: "w2" });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <Tab id="w1" seen={seen} />
        <Tab id="w2" seen={seen} />
      </>,
    ),
  );
  expect(seen).toEqual(["w2"]);
  expect(pendingUiRequest()).toBeNull();
  await act(async () => requestUi({ kind: "renameWorkspace", id: "w1" }));
  expect(seen).toEqual(["w2", "w1"]);
  // A request nobody answers stays pending, never mistaken for another kind.
  await act(async () => requestUi({ kind: "composeGroup" }));
  expect(pendingUiRequest()).toEqual({ kind: "composeGroup" });
  await act(async () => root.unmount());
});
```

`src/canvas/arrive.test.ts` — ajouter :

```ts
describe("showNode", () => {
  const updateScene = vi.fn();
  const withScene = (appState: Record<string, unknown>) =>
    canvasStore.setState({
      api: {
        getSceneElements: () => [isis],
        getAppState: () => ({ ...appState, zoom: { value: appState.zoom } }),
        updateScene,
      } as unknown as ExcalidrawImperativeAPI,
    });

  beforeEach(() => updateScene.mockClear());

  it("shows the terminal without taking the keyboard or activating it (a rename in its header takes it)", () => {
    withScene({ ...at100, zoom: 0.5 });
    expect(showNode("isis")).toBe(true);
    const { appState } = updateScene.mock.calls[0][0];
    expect(appState.zoom.value).toBe(1);
    expect(appState).not.toHaveProperty("activeEmbeddable");
    withScene(at100);
    updateScene.mockClear();
    showNode("isis");
    expect(updateScene).not.toHaveBeenCalled();
    expect(showNode("closed")).toBe(false);
  });
});
```

(importer `showNode` avec `arrivalView`, `arrive`, `needsMove`.)

`src/shell/WorkspaceTabs.test.tsx` — ajouter :

```tsx
it("opens a tab's name editor on request (« Renommer le workspace »)", async () => {
  await act(async () => requestUi({ kind: "renameWorkspace", id: "w2" }));
  const field = row().querySelector("input")!;
  expect(field.value).toBe("Backend");
  expect(document.activeElement).toBe(field);
});
```

(importer `requestUi` depuis `@/commands/uiRequests`.)

`src/nodes/terminal/TerminalHeader.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { requestUi } from "@/commands/uiRequests";
import { TerminalHeader } from "./TerminalHeader";

vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens its name editor on request, with the keyboard (« Renommer » of the palette)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const payload = { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={payload} status={{ state: "stopped" }} />));
  expect(host.querySelector("input")).toBeNull();
  await act(async () => requestUi({ kind: "renameTerminal", id: "thot" }));
  expect(host.querySelector("input")).toBeNull();
  await act(async () => requestUi({ kind: "renameTerminal", id: "isis" }));
  const field = host.querySelector("input")!;
  expect(field.value).toBe("Isis");
  expect(document.activeElement).toBe(field);
  await act(async () => root.unmount());
  host.remove();
});
```

`src/shell/ToolRail.test.tsx` — ajouter :

```tsx
it("opens the ＋ menu on request, on the custom command's options or on Ollama's models", async () => {
  await act(async () => requestUi({ kind: "agentMenu", view: "options" }));
  expect(document.querySelector('[data-slot="popover-content"]')!.textContent).toContain("Lancer la commande personnalisée");
});
```

(importer `requestUi` depuis `@/commands/uiRequests`.)

`src/fleet/AgentsPanel.test.tsx` — ajouter :

```tsx
it("opens « Composer un groupe » and a group's menu on request", async () => {
  await act(async () => requestUi({ kind: "composeGroup" }));
  expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () =>
    canvasStore.setState({
      frames: [{ id: "g1", name: "Backend", x: 0, y: 0, width: 10, height: 10, group: { role: "general", pantheon: "egypt" }, memberIds: ["ada"] }],
    }),
  );
  await act(async () => requestUi({ kind: "groupMenu", id: "g1" }));
  expect([...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toContain("Renommer");
});
```

(importer `requestUi` depuis `@/commands/uiRequests`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/uiRequests.test.tsx src/canvas/arrive.test.ts src/shell/WorkspaceTabs.test.tsx src/nodes/terminal/TerminalHeader.test.tsx src/shell/ToolRail.test.tsx src/fleet/AgentsPanel.test.tsx`
Expected: FAIL — `./uiRequests` introuvable ; `showNode` introuvable.

- [ ] **Step 3: Write the requests**

`src/commands/uiRequests.ts` :

```ts
import { useEffect, useRef } from "react";
import { createStore } from "zustand";

/** Something a command asks a component on screen to do: edit a name, open its menu (plan F2). */
export type UiRequest =
  | { kind: "renameWorkspace"; id: string }
  | { kind: "renameTerminal"; id: string }
  | { kind: "agentMenu"; view: "options" | "ollama" }
  | { kind: "composeGroup" }
  | { kind: "groupMenu"; id: string };

type RequestOf<K extends UiRequest["kind"]> = Extract<UiRequest, { kind: K }>;

const requestStore = createStore<{ request: UiRequest | null }>()(() => ({ request: null }));

export function requestUi(request: UiRequest) {
  requestStore.setState({ request });
}

export function pendingUiRequest(): UiRequest | null {
  return requestStore.getState().request;
}

/**
 * Answers the requests of `kind` this component handles: `handle` returns
 * true when the request is for it, which consumes it. A request made just
 * before the component mounts (the agents panel opened by the same command)
 * is answered on mount.
 */
export function useUiRequest<K extends UiRequest["kind"]>(kind: K, handle: (request: RequestOf<K>) => boolean, enabled = true) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    if (!enabled) return;
    const answer = () => {
      const { request } = requestStore.getState();
      if (request?.kind === kind && latest.current(request as RequestOf<K>)) requestStore.setState({ request: null });
    };
    answer();
    return requestStore.subscribe(answer);
  }, [kind, enabled]);
}
```

`src/canvas/arrive.ts` — ajouter :

```ts
/** Brings a node whole into the zone utile at 100 % if it is not, without activating it or taking the keyboard. False when it is gone. */
export function showNode(nodeId: string): boolean {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return false;
  const app = api.getAppState();
  const view = { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value, width: app.width, height: app.height };
  if (needsMove(element, view)) api.updateScene({ appState: arrivalView(element, view) });
  return true;
}
```

- [ ] **Step 4: Make the components answer**

- `src/shell/WorkspaceTabs.tsx`, dans `WorkspaceTab`, avant le `if (editing)` :

```tsx
  // « Renommer le workspace » of the palette.
  useUiRequest("renameWorkspace", (request) => {
    if (request.id !== workspace.id) return false;
    setEditing(true);
    return true;
  });
```

- `src/nodes/terminal/TerminalHeader.tsx`, dans `TerminalHeader`, après les `useState` :

```tsx
  // « Renommer » of the palette.
  useUiRequest("renameTerminal", (request) => {
    if (request.id !== nodeId) return false;
    setEditing(true);
    return true;
  });
```

- `src/fleet/AgentMenu.tsx` : la signature reçoit `answersRequests = false` ; une référence garde la vue demandée, que l'effet d'ouverture respecte :

```tsx
export function AgentMenu({
  trigger,
  side = "right",
  answersRequests = false,
}: {
  trigger: (open: boolean) => ReactElement;
  side?: "right" | "left" | "bottom";
  /** The tool rail's menu answers the palette's « Lancer un agent personnalisé… » and « Lancer Ollama… ». */
  answersRequests?: boolean;
}) {
```

```tsx
  const requestedView = useRef<View | null>(null);

  useEffect(() => {
    if (!open) return;
    setView(requestedView.current ?? "agents");
    requestedView.current = null;
    void agentsStore.getState().load();
  }, [open]);

  useUiRequest(
    "agentMenu",
    (request) => {
      requestedView.current = request.view;
      setOpen(true);
      return true;
    },
    answersRequests,
  );
```

(importer `useRef` ; l'ancien effet `useEffect(() => { if (!open) return; setView("agents"); … }, [open])` est remplacé par celui-ci.)

- `src/shell/ToolRail.tsx` : `<AgentMenu answersRequests trigger={…} />`.
- `src/fleet/ComposeGroup.tsx` : la signature reçoit `answersRequests = false`, et après les `useState` :

```tsx
  useUiRequest(
    "composeGroup",
    () => {
      setOpen(true);
      return true;
    },
    answersRequests,
  );
```

- `src/fleet/GroupMenu.tsx` : le menu devient contrôlé et répond aux demandes quand `answersRequests` :

```tsx
export function GroupMenu({ groupId, trigger, answersRequests = false }: { groupId: string; trigger?: ReactElement; answersRequests?: boolean }) {
  const [open, setOpen] = useState(false);
  const agents = useAgents((s) => s.agents);
  const available = (id: string) => agents.some((agent) => agent.id === id && agent.available);
  // « Ajouter un agent… » of the palette opens the panel's copy of this menu.
  useUiRequest(
    "groupMenu",
    (request) => {
      if (request.id !== groupId) return false;
      setOpen(true);
      return true;
    },
    answersRequests,
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
```

(importer `useState`.)

- `src/fleet/AgentsPanel.tsx` : `<ComposeGroup side="left" answersRequests trigger={…} />` et `<GroupMenu groupId={section.id} answersRequests trigger={…} />`.

(Chaque fichier importe `useUiRequest` depuis `@/commands/uiRequests`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands/uiRequests.test.tsx src/canvas/arrive.test.ts src/shell/WorkspaceTabs.test.tsx src/nodes/terminal/TerminalHeader.test.tsx src/shell/ToolRail.test.tsx src/fleet/AgentsPanel.test.tsx`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/commands/uiRequests.ts src/commands/uiRequests.test.tsx src/canvas/arrive.ts src/canvas/arrive.test.ts src/shell/WorkspaceTabs.tsx src/shell/WorkspaceTabs.test.tsx src/nodes/terminal/TerminalHeader.tsx src/nodes/terminal/TerminalHeader.test.tsx src/fleet/AgentMenu.tsx src/shell/ToolRail.tsx src/shell/ToolRail.test.tsx src/fleet/ComposeGroup.tsx src/fleet/GroupMenu.tsx src/fleet/AgentsPanel.tsx src/fleet/AgentsPanel.test.tsx
git commit -m "feat(commands): commands can ask a tab, a header or a menu to open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Navigation, Workspaces, Projets, Fenêtre, Aide

**Files:**
- Create: `src/commands/catalog/navigation.ts`, `src/commands/catalog/workspaces.ts`, `src/commands/catalog/app.ts`
- Create: `src/commands/catalog/navigation.test.ts`
- Modify: `src/commands/registry.ts`, `src/commands/registry.test.ts`

**Interfaces:**
- Consumes: tâches 1 à 3 ; `arrive`, `terminalOrder`, `stepTerminal`, `overview`, `releaseToCanvas` (J7) ; `openPalette` (F1) ; `agentsPanelStore`, `setAgentsPanel` ; `projectsStore` (`view`, `goHome`, `close`) ; `workspacesStore` (`workspaces`, `activeId`, `create`) ; `countRunning`.
- Produces: `NAVIGATION`, `WORKSPACES`, `APP: readonly Command[]` ; `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...APP]` (les tâches 5 à 7 insèrent leurs sections avant `APP`).

- [ ] **Step 1: Write the failing test**

`src/commands/catalog/navigation.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { showAbout } from "@/app/about";
import { fitScene, zoomTo } from "@/canvas/viewActions";
import { agentsPanelStore } from "@/fleet/agentsPanelState";
import { addProject } from "@/home/addProject";
import { focusCommandBar } from "@/shell/commandBarFocus";
import { closeWindow, minimizeWindow, toggleMaximizeWindow, windowStore } from "@/shell/windowState";
import { removeWorkspace } from "@/shell/workspaceActions";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { labelOf, type Command, type CommandContext } from "../command";
import { pendingUiRequest } from "../uiRequests";
import { APP } from "./app";
import { NAVIGATION } from "./navigation";
import { WORKSPACES } from "./workspaces";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(), showNode: vi.fn() }));
vi.mock("@/canvas/viewActions", () => ({ fitScene: vi.fn(), zoomTo: vi.fn() }));
vi.mock("@/shell/commandBarFocus", () => ({ focusCommandBar: vi.fn() }));
vi.mock("@/shell/workspaceActions", () => ({ removeWorkspace: vi.fn(() => Promise.resolve()) }));
vi.mock("@/app/about", () => ({ showAbout: vi.fn(() => Promise.resolve()) }));
vi.mock("@/home/addProject", () => ({ addProject: vi.fn(() => Promise.resolve()) }));
vi.mock("@/shell/windowState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shell/windowState")>()),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
}));

const home: CommandContext = { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 2, terminalId: "isis" };
const find = (list: readonly Command[], id: string) => list.find((c) => c.id === id)!;
const goHome = vi.fn();
const close = vi.fn(() => Promise.resolve());

beforeEach(() => {
  mockIPC(() => undefined);
  projectsStore.setState({ view: "project", goHome, close } as never);
  workspacesStore.setState({
    workspaces: [
      { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null },
      { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null },
    ],
    activeId: "w1",
  } as never);
});
afterAll(() => clearMocks());

describe("Navigation (spec fenêtre §7.3)", () => {
  it("lists the spec's functions, in its order", () => {
    agentsPanelStore.setState({ open: true });
    expect(NAVIGATION.filter((c) => c.id !== "palette.functions").map((c) => labelOf(c, busy))).toEqual([
      "Terminal suivant",
      "Terminal précédent",
      "Aller à…",
      "Vue d'ensemble",
      "Rendre la main au canvas",
      "Ajuster à la scène",
      "Zoom 100 %",
      "Écrire une consigne",
      "Masquer le panneau Agents",
      "Accueil",
      "Fermer le projet",
    ]);
  });

  it("does what the buttons do", async () => {
    await find(NAVIGATION, "canvas.fit").run(busy);
    expect(fitScene).toHaveBeenCalled();
    await find(NAVIGATION, "canvas.zoom100").run(busy);
    expect(zoomTo).toHaveBeenCalledWith(1);
    await find(NAVIGATION, "commandBar.focus").run(busy);
    expect(focusCommandBar).toHaveBeenCalled();
    await find(NAVIGATION, "project.home").run(busy);
    expect(goHome).toHaveBeenCalled();
    await find(NAVIGATION, "project.close").run(busy);
    expect(close).toHaveBeenCalled();
  });

  it("shows or hides the agents panel, named after its state", async () => {
    agentsPanelStore.setState({ open: false });
    const toggle = find(NAVIGATION, "agentsPanel.toggle");
    expect(labelOf(toggle, busy)).toBe("Afficher le panneau Agents");
    await toggle.run(busy);
    expect(agentsPanelStore.getState().open).toBe(true);
    expect(labelOf(toggle, busy)).toBe("Masquer le panneau Agents");
  });

  it("offers nothing but « Aller à… » outside a project", () => {
    expect(NAVIGATION.filter((c) => c.available(home)).map((c) => c.id)).toEqual(["palette.goTo", "palette.functions"]);
  });
});

describe("Workspaces", () => {
  it("creates, renames in the tab, deletes after the existing confirmation", async () => {
    const create = vi.fn(() => Promise.resolve());
    workspacesStore.setState({ create } as never);
    await find(WORKSPACES, "workspace.new").run(busy);
    expect(create).toHaveBeenCalled();
    await find(WORKSPACES, "workspace.rename").run(busy);
    expect(pendingUiRequest()).toEqual({ kind: "renameWorkspace", id: "w1" });
    await find(WORKSPACES, "workspace.delete").run(busy);
    expect(removeWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }), 0);
  });

  it("never deletes the last workspace", () => {
    expect(find(WORKSPACES, "workspace.delete").available(busy)).toBe(true);
    workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null }] } as never);
    expect(find(WORKSPACES, "workspace.delete").available(busy)).toBe(false);
  });
});

describe("Projets, Fenêtre, Aide", () => {
  it("adds a project at home only", async () => {
    const add = find(APP, "project.add");
    expect(add.available(busy)).toBe(false);
    projectsStore.setState({ view: "home" } as never);
    expect(add.available(home)).toBe(true);
    await add.run(home);
    expect(addProject).toHaveBeenCalled();
  });

  it("drives the window and tells the version, everywhere", async () => {
    for (const id of ["window.minimize", "window.maximize", "window.close", "app.about"]) expect(find(APP, id).available(home)).toBe(true);
    await find(APP, "window.minimize").run(home);
    await find(APP, "window.maximize").run(home);
    await find(APP, "window.close").run(home);
    await find(APP, "app.about").run(home);
    expect([minimizeWindow, toggleMaximizeWindow, closeWindow, showAbout].every((f) => vi.mocked(f).mock.calls.length === 1)).toBe(true);
  });

  it("names the maximize command after the window's state", () => {
    windowStore.setState({ maximized: false });
    expect(labelOf(find(APP, "window.maximize"), home)).toBe("Agrandir");
    windowStore.setState({ maximized: true });
    expect(labelOf(find(APP, "window.maximize"), home)).toBe("Restaurer");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/catalog/navigation.test.ts`
Expected: FAIL — `./navigation`, `./workspaces`, `./app` introuvables.

- [ ] **Step 3: Write the sections**

`src/commands/catalog/navigation.ts` (les commandes de J7 et F1 y déménagent, dans l'ordre de la spec) :

```ts
import { arrive } from "@/canvas/arrive";
import { overview, releaseToCanvas } from "@/canvas/canvasFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { stepTerminal, terminalOrder } from "@/canvas/terminalOrder";
import { fitScene, zoomTo } from "@/canvas/viewActions";
import { agentsPanelStore, setAgentsPanel } from "@/fleet/agentsPanelState";
import { focusCommandBar } from "@/shell/commandBarFocus";
import { projectsStore } from "@/store/projects";
import type { Command, CommandContext } from "../command";
import { openPalette } from "../paletteState";

export const inProject = (ctx: CommandContext) => ctx.project;
const withTerminals = (ctx: CommandContext) => ctx.project && ctx.terminalCount > 0;
const always = () => true;

/** Ctrl+Tab and Ctrl+Maj+Tab (spec fenêtre §6.3): the next terminal in reading order, then the arrival (§6.4). */
function step(direction: 1 | -1, ctx: CommandContext) {
  const api = canvasStore.getState().api;
  if (!api) return;
  const target = stepTerminal(terminalOrder(api.getSceneElements()), ctx.terminalId, direction);
  if (target) arrive(target);
}

export const NAVIGATION: readonly Command[] = [
  { id: "terminal.next", label: "Terminal suivant", section: "Navigation", keywords: ["suivant", "terminal", "agent"], shortcut: "Ctrl+Tab", available: withTerminals, run: (ctx) => step(1, ctx) },
  { id: "terminal.previous", label: "Terminal précédent", section: "Navigation", keywords: ["précédent", "terminal", "agent"], shortcut: "Ctrl+Maj+Tab", available: withTerminals, run: (ctx) => step(-1, ctx) },
  { id: "palette.goTo", label: "Aller à…", section: "Navigation", keywords: ["chercher", "rechercher", "terminal", "groupe", "workspace", "projet"], shortcut: "Ctrl+P", available: always, run: (ctx) => openPalette("goTo", ctx) },
  { id: "canvas.overview", label: "Vue d'ensemble", section: "Navigation", keywords: ["ensemble", "tout", "voir", "agents"], shortcut: "Ctrl+Maj+A", available: inProject, run: () => overview() },
  { id: "canvas.release", label: "Rendre la main au canvas", section: "Navigation", keywords: ["canvas", "clavier", "dessin"], shortcut: "Maj+Échap", available: inProject, run: () => releaseToCanvas() },
  { id: "canvas.fit", label: "Ajuster à la scène", section: "Navigation", keywords: ["ajuster", "vue", "tout"], available: inProject, run: () => fitScene() },
  { id: "canvas.zoom100", label: "Zoom 100 %", section: "Navigation", keywords: ["zoom", "taille", "réelle"], available: inProject, run: () => zoomTo(1) },
  { id: "commandBar.focus", label: "Écrire une consigne", section: "Navigation", keywords: ["consigne", "commande", "barre"], available: inProject, run: () => void focusCommandBar() },
  {
    id: "agentsPanel.toggle",
    label: () => (agentsPanelStore.getState().open ? "Masquer le panneau Agents" : "Afficher le panneau Agents"),
    section: "Navigation",
    keywords: ["agents", "panneau", "flotte"],
    available: inProject,
    run: () => setAgentsPanel(!agentsPanelStore.getState().open),
  },
  { id: "project.home", label: "Accueil", section: "Navigation", keywords: ["projets", "accueil"], available: inProject, run: () => projectsStore.getState().goHome() },
  { id: "project.close", label: "Fermer le projet", section: "Navigation", keywords: ["fermer", "projet"], available: inProject, run: () => projectsStore.getState().close() },
  { id: "palette.functions", label: "Rechercher une fonction…", section: "Navigation", keywords: ["fonction", "commande", "action"], shortcut: "Ctrl+Maj+P", available: always, run: (ctx) => openPalette("functions", ctx) },
];
```

`src/commands/catalog/workspaces.ts` :

```ts
import { removeWorkspace } from "@/shell/workspaceActions";
import { nodesStore } from "@/store/nodes";
import { countRunning } from "@/store/running";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import type { Command } from "../command";
import { requestUi } from "../uiRequests";
import { inProject } from "./navigation";

const onScreen = () => {
  const { workspaces, activeId } = workspacesStore.getState();
  return workspaces.find((w) => w.id === activeId);
};

export const WORKSPACES: readonly Command[] = [
  {
    id: "workspace.new",
    label: "Nouveau workspace",
    section: "Workspaces",
    keywords: ["onglet", "nouveau", "workspace"],
    available: inProject,
    run: async () => {
      await workspacesStore.getState().create();
    },
  },
  {
    id: "workspace.rename",
    label: "Renommer le workspace",
    section: "Workspaces",
    keywords: ["onglet", "nom", "workspace"],
    available: inProject,
    run: (ctx) => {
      if (ctx.workspaceId) requestUi({ kind: "renameWorkspace", id: ctx.workspaceId });
    },
  },
  {
    id: "workspace.delete",
    label: "Supprimer le workspace",
    section: "Workspaces",
    keywords: ["onglet", "supprimer", "workspace"],
    // Never the last one (spec fenêtre §7.3), like the tab's ×.
    available: (ctx) => ctx.project && workspacesStore.getState().workspaces.length > 1,
    run: async () => {
      const workspace = onScreen();
      if (!workspace) return;
      const running = countRunning(nodesStore.getState().nodes, terminalStatusStore.getState().statuses, [workspace.id]);
      await removeWorkspace(workspace, running);
    },
  },
];
```

`src/commands/catalog/app.ts` :

```ts
import { showAbout } from "@/app/about";
import { addProject } from "@/home/addProject";
import { closeWindow, minimizeWindow, toggleMaximizeWindow, windowStore } from "@/shell/windowState";
import { projectsStore } from "@/store/projects";
import type { Command } from "../command";

const always = () => true;

/** Projets, Fenêtre and Aide (spec fenêtre §7.3), the last sections of the palette. */
export const APP: readonly Command[] = [
  {
    id: "project.add",
    label: "Ajouter un projet",
    section: "Projets",
    keywords: ["projet", "dossier", "ajouter"],
    available: () => projectsStore.getState().view === "home",
    run: () => addProject(),
  },
  { id: "window.minimize", label: "Réduire", section: "Fenêtre", keywords: ["fenêtre", "réduire"], available: always, run: () => minimizeWindow() },
  {
    id: "window.maximize",
    label: () => (windowStore.getState().maximized ? "Restaurer" : "Agrandir"),
    section: "Fenêtre",
    keywords: ["fenêtre", "agrandir", "restaurer", "plein écran"],
    available: always,
    run: () => toggleMaximizeWindow(),
  },
  { id: "window.close", label: "Fermer dummyPlane", section: "Fenêtre", keywords: ["fenêtre", "fermer", "quitter"], available: always, run: () => closeWindow() },
  { id: "app.about", label: "À propos d'dummyPlane", section: "Aide", keywords: ["version", "aide", "à propos"], available: always, run: () => showAbout() },
];
```

`src/commands/registry.ts` — `COMMANDS` assemble les sections (les fonctions `step`, `inProject`, `withTerminals` et les imports devenus inutiles quittent ce fichier) :

```ts
import { APP } from "./catalog/app";
import { NAVIGATION } from "./catalog/navigation";
import { WORKSPACES } from "./catalog/workspaces";

/** Every function of the application, by section in the spec's order (spec fenêtre §7.3). */
export const COMMANDS: readonly Command[] = [...NAVIGATION, ...WORKSPACES, ...APP];
```

`src/commands/registry.test.ts` — les tests d'ordre et de disponibilité exacts laissent la place aux catalogues ; remplacer les deux premiers tests par :

```ts
  it("names each command once and gives each shortcut to one command", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const shortcuts = COMMANDS.flatMap((c) => (c.shortcut ? [c.shortcut] : []));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(new Set(shortcuts)).toEqual(new Set(["Ctrl+Tab", "Ctrl+Maj+Tab", "Ctrl+P", "Ctrl+Maj+P", "Maj+Échap", "Ctrl+Maj+A"]));
  });

  it("offers the terminal steps only with terminals, the palette everywhere", () => {
    const ids = (ctx: CommandContext) => COMMANDS.filter((c) => c.available(ctx)).map((c) => c.id);
    expect(ids(home)).toEqual(expect.arrayContaining(["palette.goTo", "palette.functions"]));
    expect(ids(home)).not.toContain("terminal.next");
    expect(ids(empty)).not.toContain("terminal.next");
    expect(ids(busy)).toEqual(expect.arrayContaining(["terminal.next", "terminal.previous", "canvas.release", "canvas.overview"]));
  });
```

et ajouter en tête `vi.mock("@excalidraw/excalidraw", () => ({}));`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/commands`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/catalog/navigation.ts src/commands/catalog/workspaces.ts src/commands/catalog/app.ts src/commands/catalog/navigation.test.ts src/commands/registry.ts src/commands/registry.test.ts
git commit -m "feat(commands): navigation, workspaces, projects, window and help in the palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Les agents

**Files:**
- Create: `src/commands/catalog/agents.ts`, `src/commands/catalog/agents.test.ts`
- Modify: `src/commands/registry.ts`, `src/commands/Palette.test.tsx`

**Interfaces:**
- Consumes: `launchAt`, `newConsole`, `launchFour`, `placeOrchestrator` (tâche 2) ; `requestUi` (tâche 3) ; `agentsStore` (`agents: { id; available }[]`) ; `AGENTS` (`label`, `vendor`, `binary`) ; `pauseAll`, `resumeAll`, `workspaceTerminalIds` ; `setAgentsPanel`.
- Produces: `AGENT_COMMANDS: readonly Command[]` ; `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...APP]`.

- [ ] **Step 1: Write the failing tests**

`src/commands/catalog/agents.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { agentsPanelStore } from "@/fleet/agentsPanelState";
import { agentsStore } from "@/fleet/agentsStore";
import { pauseAll, resumeAll } from "@/fleet/broadcast";
import { launchAt, launchFour, newConsole, placeOrchestrator } from "@/fleet/quickActions";
import { labelOf, type Command, type CommandContext } from "../command";
import { pendingUiRequest } from "../uiRequests";
import { AGENT_COMMANDS } from "./agents";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/fleet/quickActions", () => ({ launchAt: vi.fn(), newConsole: vi.fn(), launchFour: vi.fn(), placeOrchestrator: vi.fn() }));
vi.mock("@/fleet/broadcast", () => ({ pauseAll: vi.fn(() => Promise.resolve()), resumeAll: vi.fn(() => Promise.resolve()), workspaceTerminalIds: () => ["isis"] }));

const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "isis" };
const find = (id: string) => AGENT_COMMANDS.find((c) => c.id === id)!;

beforeEach(() => {
  mockIPC(() => undefined);
  agentsStore.setState({
    agents: [
      { id: "claude", available: true },
      { id: "codex", available: false },
      { id: "shell", available: true },
    ],
  } as never);
});
afterAll(() => clearMocks());

describe("Agents (spec fenêtre §7.3)", () => {
  it("lists the spec's functions, in its order", () => {
    expect(AGENT_COMMANDS.map((c) => labelOf(c, busy))).toEqual([
      "Lancer Claude",
      "Lancer Codex",
      "Lancer Gemini",
      "Lancer Qwen Code",
      "Lancer Cursor",
      "Lancer OpenCode",
      "Lancer Aider",
      "Lancer Ollama…",
      "Lancer Shell",
      "Lancer un agent personnalisé…",
      "Nouvelle console",
      "Lancer 4 agents",
      "Orchestrateur",
      "Composer un groupe…",
      "Tout mettre en pause",
      "Tout reprendre",
    ]);
  });

  it("launches an agent at the center of the view, greys one not found like the Agent menu", async () => {
    expect(find("agent.launch.claude").disabled!(busy)).toBeNull();
    expect(find("agent.launch.codex").disabled!(busy)).toBe("codex introuvable dans le PATH");
    await find("agent.launch.claude").run(busy);
    expect(launchAt).toHaveBeenCalledWith("claude");
  });

  it("opens the Agent menu on Ollama's models and on the custom command", async () => {
    await find("agent.launch.ollama").run(busy);
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "ollama" });
    await find("agent.custom").run(busy);
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "options" });
  });

  it("does what the panel and the ＋ menu do", async () => {
    await find("agent.console").run(busy);
    await find("agent.four").run(busy);
    await find("agent.orchestrator").run(busy);
    await find("agents.pauseAll").run(busy);
    await find("agents.resumeAll").run(busy);
    expect([newConsole, launchFour, placeOrchestrator].every((f) => vi.mocked(f).mock.calls.length === 1)).toBe(true);
    expect(pauseAll).toHaveBeenCalledWith(["isis"]);
    expect(resumeAll).toHaveBeenCalledWith(["isis"]);
  });

  it("composes a group from the agents panel, opened if needed", async () => {
    agentsPanelStore.setState({ open: false });
    await find("group.compose").run(busy);
    expect(agentsPanelStore.getState().open).toBe(true);
    expect(pendingUiRequest()).toEqual({ kind: "composeGroup" });
  });

  it("is offered in a project only", () => {
    const home: CommandContext = { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
    expect(AGENT_COMMANDS.filter((c: Command) => c.available(home))).toEqual([]);
  });
});
```

`src/commands/Palette.test.tsx` — ajouter :

```tsx
  it("greys an agent not found on this computer, with why, and never chooses it", async () => {
    agentsStore.setState({ agents: [{ id: "claude", available: false }] } as never);
    await act(async () => openPalette("functions", busy));
    await act(async () => setPaletteQuery("> lancer claude"));
    const line = items().find((i) => i.textContent?.startsWith("Lancer Claude"))!;
    expect(line.getAttribute("data-disabled")).toBe("true");
    expect(line.textContent).toContain("claude introuvable dans le PATH");
    expect(selected()).not.toBe(line);
  });
```

(importer `agentsStore` depuis `@/fleet/agentsStore`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/commands/catalog/agents.test.ts src/commands/Palette.test.tsx`
Expected: FAIL — `./agents` introuvable ; pas de « Lancer Claude » dans la palette.

- [ ] **Step 3: Write the section**

`src/commands/catalog/agents.ts` :

```ts
import { setAgentsPanel } from "@/fleet/agentsPanelState";
import { agentsStore } from "@/fleet/agentsStore";
import { pauseAll, resumeAll, workspaceTerminalIds } from "@/fleet/broadcast";
import { AGENTS } from "@/fleet/catalog";
import { launchAt, launchFour, newConsole, placeOrchestrator } from "@/fleet/quickActions";
import type { AgentId } from "@/ipc/pty";
import type { Command } from "../command";
import { requestUi } from "../uiRequests";
import { inProject } from "./navigation";

/** The agents of « Lancer … », in the spec's order (spec fenêtre §7.3). */
const LAUNCHED: readonly AgentId[] = ["claude", "codex", "gemini", "qwen", "cursor", "opencode", "aider", "ollama", "shell"];

/** Like the Agent menu: an agent not found on this computer is listed greyed, with why. */
const notFound = (agent: AgentId) => () =>
  agentsStore.getState().agents.some((a) => a.id === agent && a.available) ? null : `${AGENTS[agent].binary} introuvable dans le PATH`;

export const AGENT_COMMANDS: readonly Command[] = [
  ...LAUNCHED.map(
    (agent): Command => ({
      id: `agent.launch.${agent}`,
      // Ollama starts on a model: its menu opens on them (plan F2, décision 1).
      label: agent === "ollama" ? "Lancer Ollama…" : `Lancer ${AGENTS[agent].label}`,
      section: "Agents",
      keywords: [AGENTS[agent].label, AGENTS[agent].vendor, "agent", "lancer"],
      available: inProject,
      disabled: notFound(agent),
      run: () => (agent === "ollama" ? requestUi({ kind: "agentMenu", view: "ollama" }) : launchAt(agent)),
    }),
  ),
  {
    id: "agent.custom",
    label: "Lancer un agent personnalisé…",
    section: "Agents",
    keywords: ["commande", "personnalisé", "agent"],
    available: inProject,
    run: () => requestUi({ kind: "agentMenu", view: "options" }),
  },
  { id: "agent.console", label: "Nouvelle console", section: "Agents", keywords: ["console", "terminal"], available: inProject, run: () => newConsole() },
  { id: "agent.four", label: "Lancer 4 agents", section: "Agents", keywords: ["quatre", "groupe", "agents"], available: inProject, run: () => launchFour() },
  { id: "agent.orchestrator", label: "Orchestrateur", section: "Agents", keywords: ["orchestrateur", "chef"], available: inProject, run: () => placeOrchestrator() },
  {
    id: "group.compose",
    label: "Composer un groupe…",
    section: "Agents",
    keywords: ["groupe", "composer", "rôle"],
    available: inProject,
    // Its window is anchored in the agents panel (plan F2, décision 4).
    run: () => {
      setAgentsPanel(true);
      requestUi({ kind: "composeGroup" });
    },
  },
  {
    id: "agents.pauseAll",
    label: "Tout mettre en pause",
    section: "Agents",
    keywords: ["pause", "interrompre", "tout"],
    available: inProject,
    run: async () => {
      await pauseAll(workspaceTerminalIds());
    },
  },
  {
    id: "agents.resumeAll",
    label: "Tout reprendre",
    section: "Agents",
    keywords: ["reprendre", "continuer", "tout"],
    available: inProject,
    run: async () => {
      await resumeAll(workspaceTerminalIds());
    },
  },
];
```

`src/commands/registry.ts` — `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...APP]` (import depuis `./catalog/agents`).

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm exec vitest run src/commands`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/catalog/agents.ts src/commands/catalog/agents.test.ts src/commands/registry.ts src/commands/Palette.test.tsx
git commit -m "feat(commands): launch any agent, a console, a group or an orchestrator from the palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Le terminal et le groupe du moment

**Files:**
- Create: `src/commands/catalog/current.ts`, `src/commands/catalog/current.test.ts`
- Modify: `src/commands/registry.ts`

**Interfaces:**
- Consumes: `showNode` (tâche 3) ; `requestUi` ; `focusGroup` (F1) ; `canPause`, `canResume`, `pauseAgents`, `resumeAgent`, `AgentFacts` ; `duplicateTerminal`, `requestClose` ; `relaunchTerminal`, `stopTerminal` ; `orchestrateGroup` ; `ungroup`, `requestCloseGroup` ; `groupOf` ; `setAgentsFilter`, `setAgentsPanel` ; `uiStore.setRenamingGroup`.
- Produces: `CURRENT: readonly Command[]` ; `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...APP]`.

- [ ] **Step 1: Write the failing test**

`src/commands/catalog/current.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { showNode } from "@/canvas/arrive";
import { focusGroup } from "@/canvas/canvasFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/fleet/agentsPanelState";
import { pauseAgents, resumeAgent } from "@/fleet/broadcast";
import { requestCloseGroup, ungroup } from "@/fleet/groups";
import { orchestrateGroup } from "@/fleet/orchestrators";
import { duplicateTerminal, requestClose } from "@/fleet/terminals";
import { relaunchTerminal, stopTerminal } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { labelOf, sectionOf, type CommandContext } from "../command";
import { pendingUiRequest } from "../uiRequests";
import { CURRENT } from "./current";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/arrive", () => ({ showNode: vi.fn(() => true), arrive: vi.fn() }));
vi.mock("@/canvas/canvasFocus", () => ({ focusGroup: vi.fn(() => true), releaseToCanvas: vi.fn() }));
vi.mock("@/fleet/broadcast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fleet/broadcast")>()),
  pauseAgents: vi.fn(() => Promise.resolve(1)),
  resumeAgent: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@/fleet/groups", () => ({ requestCloseGroup: vi.fn(), ungroup: vi.fn() }));
vi.mock("@/fleet/orchestrators", () => ({ orchestrateGroup: vi.fn(() => Promise.resolve()) }));
vi.mock("@/fleet/terminals", () => ({ duplicateTerminal: vi.fn(() => Promise.resolve()), requestClose: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn() }));

const ctx = (terminalId: string | null): CommandContext => ({ project: true, workspaceId: "w1", terminalCount: 2, terminalId });
const find = (id: string) => CURRENT.find((c) => c.id === id)!;
const ids = (c: CommandContext) => CURRENT.filter((command) => command.available(c)).map((command) => command.id);

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s1" },
  });
  await nodesStore.getState().create("thot", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Thot", name: "Thot", agent: "codex", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(() => {
  canvasStore.setState({
    frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["isis"] }],
  });
  terminalStatusStore.getState().set("isis", { state: "running" });
  terminalStatusStore.getState().set("thot", { state: "stopped" });
  agentActivityStore.getState().apply({ nodeId: "isis", activity: "working", since: 0 });
});
afterAll(() => clearMocks());

describe("Terminal · <prénom> and Groupe · <nom> (spec fenêtre §7.3)", () => {
  it("names its sections after the terminal of the moment and its group", () => {
    expect(sectionOf(find("terminal.rename"), ctx("isis"))).toBe("Terminal · Isis");
    expect(sectionOf(find("group.rename"), ctx("isis"))).toBe("Groupe · Serveurs");
    expect(CURRENT.map((c) => labelOf(c, ctx("isis")))).toEqual([
      "Renommer",
      "Dupliquer",
      "Relancer",
      "Arrêter le processus",
      "Mettre en pause",
      "Reprendre",
      "Fermer",
      "Renommer le groupe",
      "Ajouter un agent…",
      "Relier un orchestrateur",
      "Dégrouper",
      "Fermer le groupe",
    ]);
  });

  it("offers each function under the rules of its button", () => {
    expect(ids(ctx(null))).toEqual([]);
    // Isis runs and works: no Reprendre; in a group.
    expect(ids(ctx("isis"))).toEqual([
      "terminal.rename",
      "terminal.duplicate",
      "terminal.relaunch",
      "terminal.stop",
      "terminal.pause",
      "terminal.close",
      "group.rename",
      "group.addAgent",
      "group.orchestrate",
      "group.ungroup",
      "group.close",
    ]);
    // Thot is stopped and outside any group.
    expect(ids(ctx("thot"))).toEqual(["terminal.rename", "terminal.duplicate", "terminal.relaunch", "terminal.close"]);
  });

  it("acts on the terminal of the moment, as its header and the panel's row do", async () => {
    await find("terminal.duplicate").run(ctx("isis"));
    expect(duplicateTerminal).toHaveBeenCalledWith("w1", "isis");
    await find("terminal.relaunch").run(ctx("isis"));
    expect(vi.mocked(relaunchTerminal).mock.calls[0][0]).toBe("isis");
    expect(vi.mocked(relaunchTerminal).mock.calls[0][2]).toBe("resume");
    await find("terminal.relaunch").run(ctx("thot"));
    expect(vi.mocked(relaunchTerminal).mock.calls[1][2]).toBe("new");
    await find("terminal.stop").run(ctx("isis"));
    expect(stopTerminal).toHaveBeenCalledWith("isis");
    await find("terminal.pause").run(ctx("isis"));
    expect(pauseAgents).toHaveBeenCalledWith(["isis"]);
    agentActivityStore.getState().apply({ nodeId: "isis", activity: "idle", since: 0 });
    await find("terminal.resume").run(ctx("isis"));
    expect(resumeAgent).toHaveBeenCalledWith("isis");
    await find("terminal.close").run(ctx("thot"));
    expect(requestClose).toHaveBeenCalledWith("thot");
  });

  it("shows the terminal without taking the keyboard, then opens its name editor", async () => {
    await find("terminal.rename").run(ctx("thot"));
    expect(showNode).toHaveBeenCalledWith("thot");
    expect(pendingUiRequest()).toEqual({ kind: "renameTerminal", id: "thot" });
  });

  it("acts on the group of the moment, as its menu does", async () => {
    await find("group.orchestrate").run(ctx("isis"));
    expect(orchestrateGroup).toHaveBeenCalledWith("g1");
    await find("group.ungroup").run(ctx("isis"));
    expect(ungroup).toHaveBeenCalledWith("g1");
    await find("group.close").run(ctx("isis"));
    expect(requestCloseGroup).toHaveBeenCalledWith("g1");
    agentsPanelStore.setState({ open: false, filter: "waiting" });
    await find("group.addAgent").run(ctx("isis"));
    expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "all" });
    expect(pendingUiRequest()).toEqual({ kind: "groupMenu", id: "g1" });
    await find("group.rename").run(ctx("isis"));
    expect(focusGroup).toHaveBeenCalledWith("g1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/catalog/current.test.ts`
Expected: FAIL — `./current` introuvable.

- [ ] **Step 3: Write the section**

`src/commands/catalog/current.ts` :

```ts
import { showNode } from "@/canvas/arrive";
import { focusGroup } from "@/canvas/canvasFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { groupOf, type SceneGroup } from "@/canvas/groups";
import { setAgentsFilter, setAgentsPanel } from "@/fleet/agentsPanelState";
import { canPause, canResume, pauseAgents, resumeAgent, type AgentFacts } from "@/fleet/broadcast";
import { AGENTS } from "@/fleet/catalog";
import { requestCloseGroup, ungroup } from "@/fleet/groups";
import { orchestrateGroup } from "@/fleet/orchestrators";
import { duplicateTerminal, requestClose } from "@/fleet/terminals";
import type { TerminalPayload } from "@/nodes/types";
import { relaunchTerminal, stopTerminal } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import type { Command, CommandContext } from "../command";
import { requestUi } from "../uiRequests";

/** The terminal of the moment (spec fenêtre §7.3): the one that had the keyboard when the palette opened. */
function payloadOf(ctx: CommandContext): TerminalPayload | undefined {
  return ctx.project && ctx.terminalId ? terminalOf(nodesStore.getState().nodes[ctx.terminalId]) : undefined;
}

function groupOfCurrent(ctx: CommandContext): SceneGroup | null {
  return payloadOf(ctx) && ctx.terminalId ? groupOf(canvasStore.getState().frames, ctx.terminalId) : null;
}

function factsOf(ctx: CommandContext): AgentFacts | null {
  const payload = payloadOf(ctx);
  if (!payload || !ctx.terminalId) return null;
  return { agent: payload.agent, running: isRunning(ctx.terminalId), activity: agentActivityStore.getState().activities[ctx.terminalId]?.activity };
}

const hasTerminal = (ctx: CommandContext) => payloadOf(ctx) !== undefined;
const hasGroup = (ctx: CommandContext) => groupOfCurrent(ctx) !== null;
// `available` guarantees both before `run`.
const terminalId = (ctx: CommandContext) => ctx.terminalId as string;
const groupId = (ctx: CommandContext) => (groupOfCurrent(ctx) as SceneGroup).id;

function terminalSection(ctx: CommandContext): string {
  const payload = payloadOf(ctx);
  return `Terminal · ${payload ? payload.name || AGENTS[payload.agent].label : ""}`;
}

const groupSection = (ctx: CommandContext) => `Groupe · ${groupOfCurrent(ctx)?.name ?? ""}`;

export const CURRENT: readonly Command[] = [
  {
    id: "terminal.rename",
    label: "Renommer",
    section: terminalSection,
    keywords: ["nom", "prénom", "terminal"],
    available: hasTerminal,
    // The view moves if needed, without the keyboard: the name editor takes it.
    run: (ctx) => {
      showNode(terminalId(ctx));
      requestUi({ kind: "renameTerminal", id: terminalId(ctx) });
    },
  },
  {
    id: "terminal.duplicate",
    label: "Dupliquer",
    section: terminalSection,
    keywords: ["copie", "dupliquer", "terminal"],
    available: hasTerminal,
    run: async (ctx) => {
      if (ctx.workspaceId) await duplicateTerminal(ctx.workspaceId, terminalId(ctx));
    },
  },
  {
    id: "terminal.relaunch",
    label: "Relancer",
    section: terminalSection,
    keywords: ["relancer", "redémarrer", "reprendre"],
    available: hasTerminal,
    // Claude resumes its session, other agents start anew (plan F2, décision 2).
    run: (ctx) => {
      const payload = payloadOf(ctx) as TerminalPayload;
      relaunchTerminal(terminalId(ctx), payload, payload.agent === "claude" && payload.claudeSessionId ? "resume" : "new");
    },
  },
  {
    id: "terminal.stop",
    label: "Arrêter le processus",
    section: terminalSection,
    keywords: ["arrêter", "tuer", "processus"],
    available: (ctx) => hasTerminal(ctx) && isRunning(terminalId(ctx)),
    run: (ctx) => stopTerminal(terminalId(ctx)),
  },
  {
    id: "terminal.pause",
    label: "Mettre en pause",
    section: terminalSection,
    keywords: ["pause", "interrompre"],
    available: (ctx) => {
      const facts = factsOf(ctx);
      return facts !== null && canPause(facts);
    },
    run: async (ctx) => {
      await pauseAgents([terminalId(ctx)]);
    },
  },
  {
    id: "terminal.resume",
    label: "Reprendre",
    section: terminalSection,
    keywords: ["reprendre", "continuer"],
    available: (ctx) => {
      const facts = factsOf(ctx);
      return facts !== null && canResume(facts);
    },
    run: async (ctx) => {
      await resumeAgent(terminalId(ctx));
    },
  },
  {
    id: "terminal.close",
    label: "Fermer",
    section: terminalSection,
    keywords: ["fermer", "terminal"],
    available: hasTerminal,
    run: (ctx) => requestClose(terminalId(ctx)),
  },
  {
    id: "group.rename",
    label: "Renommer le groupe",
    section: groupSection,
    keywords: ["groupe", "nom"],
    available: hasGroup,
    // Its label edits the name: the group comes into view first.
    run: (ctx) => {
      const id = groupId(ctx);
      focusGroup(id);
      requestAnimationFrame(() => uiStore.getState().setRenamingGroup(id));
    },
  },
  {
    id: "group.addAgent",
    label: "Ajouter un agent…",
    section: groupSection,
    keywords: ["groupe", "agent", "ajouter"],
    available: hasGroup,
    // The group's menu, in the agents panel (plan F2, décision 4).
    run: (ctx) => {
      setAgentsFilter("all");
      setAgentsPanel(true);
      requestUi({ kind: "groupMenu", id: groupId(ctx) });
    },
  },
  {
    id: "group.orchestrate",
    label: "Relier un orchestrateur",
    section: groupSection,
    keywords: ["orchestrateur", "relier", "groupe"],
    available: hasGroup,
    run: async (ctx) => {
      await orchestrateGroup(groupId(ctx));
    },
  },
  { id: "group.ungroup", label: "Dégrouper", section: groupSection, keywords: ["groupe", "dégrouper"], available: hasGroup, run: (ctx) => ungroup(groupId(ctx)) },
  { id: "group.close", label: "Fermer le groupe", section: groupSection, keywords: ["groupe", "fermer"], available: hasGroup, run: (ctx) => requestCloseGroup(groupId(ctx)) },
];
```

`src/commands/registry.ts` — `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...APP]` (import depuis `./catalog/current`).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/commands`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/catalog/current.ts src/commands/catalog/current.test.ts src/commands/registry.ts
git commit -m "feat(commands): the terminal and the group of the moment in the palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dessin et Scène

**Files:**
- Create: `src/commands/catalog/drawing.ts`, `src/commands/catalog/drawing.test.ts`
- Modify: `src/commands/registry.ts`

**Interfaces:**
- Consumes: `releaseToCanvas` (J7) ; `exportCurrentScene`, `importIntoScene`, `exportCurrentPng` (tâche 2) ; `canvasStore.api.setActiveTool`.
- Produces: `DRAWING`, `SCENE: readonly Command[]` ; `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...DRAWING, ...SCENE, ...APP]`.

- [ ] **Step 1: Write the failing test**

`src/commands/catalog/drawing.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { exportCurrentPng, exportCurrentScene, importIntoScene } from "@/shell/sceneActions";
import { labelOf, type CommandContext } from "../command";
import { DRAWING, SCENE } from "./drawing";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/shell/sceneActions", () => ({ exportCurrentScene: vi.fn(), importIntoScene: vi.fn(), exportCurrentPng: vi.fn() }));

const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 0, terminalId: null };
const setActiveTool = vi.fn();
const updateScene = vi.fn();
let container: HTMLDivElement;
const keys: KeyboardEvent[] = [];

beforeEach(() => {
  setActiveTool.mockClear();
  keys.length = 0;
  canvasStore.setState({ api: { setActiveTool, updateScene } as unknown as ExcalidrawImperativeAPI });
  document.body.innerHTML = '<div class="excalidraw excalidraw-container" tabindex="0"></div><textarea></textarea>';
  container = document.querySelector<HTMLDivElement>(".excalidraw-container")!;
  container.addEventListener("keydown", (e) => keys.push(e));
});
afterEach(() => document.body.replaceChildren());

describe("Dessin (spec fenêtre §7.3)", () => {
  it("lists the tools, the hand included, with Excalidraw's keys, then Annuler and Rétablir", () => {
    expect(DRAWING.map((c) => [labelOf(c, busy), c.keys ?? null])).toEqual([
      ["Sélection", "V"],
      ["Main", "H"],
      ["Rectangle", "R"],
      ["Ellipse", "O"],
      ["Losange", "D"],
      ["Ligne", "L"],
      ["Flèche", "A"],
      ["Cadre", "F"],
      ["Texte", "T"],
      ["Stylo", "P"],
      ["Gomme", "E"],
      ["Image", null],
      ["Annuler", "Ctrl+Z"],
      ["Rétablir", "Ctrl+Y"],
    ]);
  });

  it("picks a tool and gives the keyboard to the canvas", async () => {
    document.querySelector("textarea")!.focus();
    await DRAWING.find((c) => c.id === "tool.rectangle")!.run(busy);
    expect(setActiveTool).toHaveBeenCalledWith({ type: "rectangle" });
    expect(document.activeElement).toBe(container);
  });

  it("undoes and redoes with Excalidraw's own keys, sent to its container", async () => {
    await DRAWING.find((c) => c.id === "edit.undo")!.run(busy);
    await DRAWING.find((c) => c.id === "edit.redo")!.run(busy);
    expect(keys.map((k) => [k.key, k.ctrlKey])).toEqual([
      ["z", true],
      ["y", true],
    ]);
  });
});

describe("Scène", () => {
  it("exports, imports and saves a PNG as the settings menu does", async () => {
    expect(SCENE.map((c) => labelOf(c, busy))).toEqual(["Exporter la scène…", "Importer une scène…", "Exporter en PNG…"]);
    for (const command of SCENE) await command.run(busy);
    expect([exportCurrentScene, importIntoScene, exportCurrentPng].every((f) => vi.mocked(f).mock.calls.length === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/commands/catalog/drawing.test.ts`
Expected: FAIL — `./drawing` introuvable.

- [ ] **Step 3: Write the sections**

`src/commands/catalog/drawing.ts` :

```ts
import { releaseToCanvas } from "@/canvas/canvasFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { exportCurrentPng, exportCurrentScene, importIntoScene } from "@/shell/sceneActions";
import type { Command } from "../command";
import { inProject } from "./navigation";

type Tool = "selection" | "hand" | "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "frame" | "text" | "freedraw" | "eraser" | "image";

/** The tools of the rail and the shapes menu, with the one-letter key Excalidraw gives them. */
const TOOLS: readonly { label: string; type: Tool; keys?: string }[] = [
  { label: "Sélection", type: "selection", keys: "V" },
  { label: "Main", type: "hand", keys: "H" },
  { label: "Rectangle", type: "rectangle", keys: "R" },
  { label: "Ellipse", type: "ellipse", keys: "O" },
  { label: "Losange", type: "diamond", keys: "D" },
  { label: "Ligne", type: "line", keys: "L" },
  { label: "Flèche", type: "arrow", keys: "A" },
  { label: "Cadre", type: "frame", keys: "F" },
  { label: "Texte", type: "text", keys: "T" },
  { label: "Stylo", type: "freedraw", keys: "P" },
  { label: "Gomme", type: "eraser", keys: "E" },
  { label: "Image", type: "image" },
];

/** A drawing tool, then the keyboard to the canvas (spec fenêtre §7.3). */
function pickTool(type: Tool) {
  canvasStore.getState().api?.setActiveTool({ type });
  releaseToCanvas();
}

/** Annuler / Rétablir: Excalidraw's own keys, sent to its container (its API has no undo). */
function pressCanvasKey(key: "z" | "y") {
  releaseToCanvas();
  const container = document.querySelector<HTMLElement>(".excalidraw-container");
  container?.dispatchEvent(new KeyboardEvent("keydown", { key, code: key === "z" ? "KeyZ" : "KeyY", ctrlKey: true, bubbles: true, cancelable: true }));
}

export const DRAWING: readonly Command[] = [
  ...TOOLS.map(
    ({ label, type, keys }): Command => ({
      id: `tool.${type}`,
      label,
      section: "Dessin",
      keywords: ["outil", "dessin", label],
      keys,
      available: inProject,
      run: () => pickTool(type),
    }),
  ),
  { id: "edit.undo", label: "Annuler", section: "Dessin", keywords: ["annuler", "défaire"], keys: "Ctrl+Z", available: inProject, run: () => pressCanvasKey("z") },
  { id: "edit.redo", label: "Rétablir", section: "Dessin", keywords: ["rétablir", "refaire"], keys: "Ctrl+Y", available: inProject, run: () => pressCanvasKey("y") },
];

export const SCENE: readonly Command[] = [
  { id: "scene.export", label: "Exporter la scène…", section: "Scène", keywords: ["exporter", "fichier", "scène"], available: inProject, run: () => exportCurrentScene() },
  { id: "scene.import", label: "Importer une scène…", section: "Scène", keywords: ["importer", "fichier", "scène"], available: inProject, run: () => importIntoScene() },
  { id: "scene.png", label: "Exporter en PNG…", section: "Scène", keywords: ["image", "png", "exporter"], available: inProject, run: () => exportCurrentPng() },
];
```

`src/commands/registry.ts` — `COMMANDS = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...DRAWING, ...SCENE, ...APP]` (import depuis `./catalog/drawing`).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/commands`, puis `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/commands/catalog/drawing.ts src/commands/catalog/drawing.test.ts src/commands/registry.ts
git commit -m "feat(commands): drawing tools, undo, redo and the scene's files in the palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Vérification et livraison

**Files:**
- Aucun (sauf correctif né d'un constat, avec son test d'abord rouge et une décision au journal).

**Interfaces:**
- Consumes: tâches 1 à 7.
- Produces: `src-tauri/target/release/bundle/nsis/dummyPlane_0.1.0_x64-setup.exe` ; `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J8b.exe` ; raccourci « dummyPlane (dernière build) » repointé.

- [ ] **Step 1: Check the app still starts on the probe profile**

L'application de développement de la sonde fermée (`crisp\closedev.ps1`, qui ne vise que `target\debug`), lancer `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'` en arrière-plan, attendre une fenêtre dont l'exécutable est `…\target\debug\dummyplane.exe`, la capturer (`crisp\printwin.ps1 -Out …`) puis la fermer.
Expected : la fenêtre du projet s'affiche comme après F1 ; aucune erreur dans le journal de `pnpm tauri dev`.

- [ ] **Step 2: Build the installer and the test copy**

Run : `pnpm tauri build > "$SCRATCH/f2-build.log" 2>&1` (en arrière-plan), puis copier `src-tauri\target\release\dummyplane.exe` en `C:\Users\Spectrum\dummyPlane-builds\dummyPlane-J8b.exe` et repointer le raccourci du bureau.
Expected : `Finished 1 bundle at: …\dummyPlane_0.1.0_x64-setup.exe` ; sous-système PE `2` ; copie et raccourci en place.

- [ ] **Step 3: Hand over**

Donner à Mathieu la version et ses vérifications (spec fenêtre §10 J8, partie fonctions) : Ctrl+Maj+P puis, depuis un terminal Claude : « pause » (Mettre en pause), « relancer », « renommer » (l'en-tête passe en édition) ; « lancer codex » (grisé si Codex n'est pas installé) ; « composer » ; « ajouter un agent » (menu du groupe dans le panneau) ; « exporter » ; « rectangle » puis dessiner ; « annuler » ; « agrandir » / « restaurer » ; « nouveau workspace » ; « supprimer le workspace » (confirmation) ; à l'accueil, « ajouter un projet ».
