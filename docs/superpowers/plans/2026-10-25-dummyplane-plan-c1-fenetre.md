# dummyPlane — Plan C1 : fenêtre et livraison (jalon J6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une fenêtre sans barre Windows (bande de déplacement, boutons Réduire / Agrandir / Fermer, titre « dummyPlane — <projet> », orbe pour icône), livrée par un installateur NSIS en release, sans console.

**Architecture:** Tout se passe côté front et configuration ; aucun code Rust ne change. `tauri.conf.json` passe la fenêtre en `decorations: false` et le bundle en NSIS français par utilisateur ; la capacité `default` reçoit les permissions de fenêtre. Une bande transparente fixe (`DragStrip`, attribut `data-tauri-drag-region` géré par le script injecté de Tauri) couvre la rangée du haut ; `WindowControls` porte les trois boutons et suit l'état agrandi par l'événement de redimensionnement ; `windowTitle.ts` tient le titre à jour depuis `projectsStore`. L'icône est générée par `tauri icon` depuis un SVG de l'orbe.

**Tech Stack:** Tauri 2.12 (`@tauri-apps/api` 2.12.4, CLI 2.12.4), React 19, TypeScript, Zustand, Tailwind 4, lucide-react, Vitest 5 (+ happy-dom, `@tauri-apps/api/mocks`).

**Spec:** `docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md` (§4, §5, §9, §10 J6, §11, §12 risque 2).

## Global Constraints

- Interface en français ; code et commentaires en anglais.
- Bande de déplacement : toute la largeur, 56 premiers pixels (16 px de marge + 32 px de pastille + 8 px), au-dessus du canvas et sous les pastilles ; seuls les clics directs sur la bande déplacent (double-clic : agrandir / restaurer) (spec §4.2).
- Boutons : Réduire, Agrandir / Restaurer, Fermer, après Réglages ; 32 × 32 px, rayon 8, sans fond ; survol `--ov-hover` ; Fermer au survol : fond `--ov-danger`, icône blanche ; icônes Lucide `Minus`, `Square` / `Copy`, `X` ; info-bulles « Réduire », « Agrandir », « Restaurer », « Fermer » (spec §4.3).
- Fermer demande la fermeture (`close`), jamais `destroy` : la sauvegarde avant fermeture (`onCloseRequested`) s'exécute (spec §4.3).
- Titre : « dummyPlane » hors projet, « dummyPlane — <nom du projet> » (tiret cadratin entouré d'espaces) (spec §4.5).
- Icône : disque de 92 % du carré, dégradé radial centré à 35 % / 30 % : `#FFD48A` (0 %), `#F4602E` (55 %), `#8A2A10` (100 %), sans lueur, fond transparent (spec §4.6).
- Livraison : installateur NSIS par utilisateur, en français ; l'identifiant reste `dev.dummyplane.app` (spec §5).
- Une action de fenêtre qui échoue affiche un toast « <Action> impossible : <raison> » (spec §9).
- Tests : `pnpm test` ; `pnpm exec tsc --noEmit` et `pnpm build` propres ; `cargo check --manifest-path src-tauri/Cargo.toml` valide les permissions de la capacité.
- Ne jamais lancer depuis la session l'exécutable release ni l'installateur : ils ouvrent la vraie base (`dev.dummyplane.app`) et relanceraient les agents de Mathieu. Les vérifications dans l'application se font en développement sur le profil `dev.dummyplane.probe`, et seulement quand Mathieu n'utilise pas le poste.
- Supprimer les `*.stackdump` à la racine avant chaque commit.
- Conventional Commits ; chaque message de commit finit par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Les pastilles et menus de la rangée du haut restent cliquables : la bande ne contient rien et ne réagit qu'aux clics qui la visent directement (tests : tâche 2, `DragStrip`).
2. Agrandie autrement que par le bouton (double-clic sur la bande, Win+↑, ancrage), la fenêtre affiche « Restaurer » ; restaurée, « Agrandir » (tests : tâche 2, `WindowControls`, événement de redimensionnement).
3. Sur l'accueil, à la largeur minimale (960 px) comme défilé, l'en-tête commence sous la bande : « Ajouter un projet » ne peut pas déclencher un déplacement (tests : tâche 2, `HomeScreen`).
4. Fermer par le bouton pendant qu'un titre est en cours d'édition l'enregistre : le bouton demande `close` (qui passe par `onCloseRequested`), jamais `destroy` (tests : tâche 2, `WindowControls`).
5. Renommer le projet ouvert, revenir à l'accueil ou fermer le projet met le titre à jour ; un projet disparu donne « dummyPlane » (tests : tâche 1, `syncWindowTitle`, `titleFor`).

---

## File Structure

- `src/app/windowTitle.ts` (nouveau) : `titleFor` (pur) et `syncWindowTitle` (abonnement à `projectsStore`).
- `src/app/boot.ts` : appelle `syncWindowTitle()` au démarrage.
- `src/app/windowConfig.test.ts` (nouveau) : contrat de `tauri.conf.json` et de la capacité `default`.
- `src/shell/layout.ts` (nouveau) : `TOP_ROW_HEIGHT` (56), partagé avec le jalon J7.
- `src/shell/DragStrip.tsx` (nouveau) : la bande de déplacement.
- `src/shell/WindowControls.tsx` (nouveau) : `WindowControls`, `WindowCorner` (boutons en coin hors projet).
- `src/shell/TopBar.tsx` : boutons après Réglages.
- `src/App.tsx` : bande partout, boutons en coin hors projet.
- `src/home/HomeScreen.tsx` : en-tête sous la bande.
- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json` : fenêtre, permissions, bundle.
- `src-tauri/icons/source/orb.svg` (nouveau) et icônes régénérées dans `src-tauri/icons/`.

---

### Task 1: Le titre de la fenêtre

**Files:**
- Create: `src/app/windowTitle.ts`
- Create: `src/app/windowTitle.test.ts`
- Create: `src/app/windowConfig.test.ts`
- Modify: `src/app/boot.ts`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `projectsStore`, `ProjectsView` (`"loading" | "home" | "project" | "error"`) de `@/store/projects` ; `Project` de `@/ipc/db`.
- Produces: `titleFor(view: ProjectsView, projects: readonly Project[], activeId: string | null): string` ; `syncWindowTitle(): () => void`.

- [ ] **Step 1: Write the failing tests**

`src/app/windowTitle.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Project } from "@/ipc/db";
import { projectsStore } from "@/store/projects";
import { syncWindowTitle, titleFor } from "./windowTitle";

const hermes: Project = {
  id: "p1",
  name: "Hermes",
  path: "C:\\hermes",
  position: 0,
  lastOpenedAt: 0,
  workspaceCount: 1,
  missing: false,
  liveAgents: 0,
};

describe("titleFor", () => {
  it("names the open project after the app", () => {
    expect(titleFor("project", [hermes], "p1")).toBe("dummyPlane — Hermes");
  });

  it("is the app's name outside a project, or when the project is gone", () => {
    expect(titleFor("home", [hermes], "p1")).toBe("dummyPlane");
    expect(titleFor("loading", [], null)).toBe("dummyPlane");
    expect(titleFor("project", [hermes], "gone")).toBe("dummyPlane");
  });
});

describe("syncWindowTitle", () => {
  let titles: string[];

  beforeEach(() => {
    titles = [];
    mockWindows("main");
    mockIPC((cmd, args) => {
      if (cmd === "plugin:window|set_title") titles.push((args as { value: string }).value);
    });
  });
  afterEach(() => clearMocks());

  it("follows the project opened, renamed and closed, until stopped", () => {
    projectsStore.setState({ view: "home", projects: [hermes], activeId: null });
    const stop = syncWindowTitle();
    projectsStore.setState({ view: "project", activeId: "p1" });
    projectsStore.setState({ projects: [{ ...hermes }] }); // same title: not set again
    projectsStore.setState({ projects: [{ ...hermes, name: "Hermès" }] });
    projectsStore.setState({ view: "home", activeId: null });
    stop();
    projectsStore.setState({ view: "project", activeId: "p1" });
    expect(titles).toEqual(["dummyPlane", "dummyPlane — Hermes", "dummyPlane — Hermès", "dummyPlane"]);
    expect(document.title).toBe("dummyPlane");
  });
});
```

`src/app/windowConfig.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";

describe("window configuration (spec fenêtre §4.7)", () => {
  it("lets the page set the window title", () => {
    expect(capability.permissions).toContain("core:window:allow-set-title");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/app/windowTitle.test.ts src/app/windowConfig.test.ts`
Expected: FAIL — `windowTitle.test.ts` cannot resolve `./windowTitle` ; `windowConfig.test.ts` : `expected [ 'core:default', … ] to include 'core:window:allow-set-title'`.

- [ ] **Step 3: Write the implementation**

`src/app/windowTitle.ts` :

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Project } from "@/ipc/db";
import { projectsStore, type ProjectsView } from "@/store/projects";

/** The window's title (spec fenêtre §4.5): the taskbar and Alt+Tab name the open project. */
export function titleFor(view: ProjectsView, projects: readonly Project[], activeId: string | null): string {
  const project = view === "project" ? projects.find((p) => p.id === activeId) : undefined;
  return project ? `dummyPlane — ${project.name}` : "dummyPlane";
}

/** Keeps the window title on the project shown; returns the function that stops it. */
export function syncWindowTitle(): () => void {
  let shown: string | null = null;
  const apply = () => {
    const { view, projects, activeId } = projectsStore.getState();
    const title = titleFor(view, projects, activeId);
    if (title === shown) return;
    shown = title;
    document.title = title;
    // A title that fails to change is only cosmetic: no toast.
    void getCurrentWindow()
      .setTitle(title)
      .catch((error: unknown) => console.warn(`window title: ${String(error)}`));
  };
  apply();
  return projectsStore.subscribe(apply);
}
```

`src/app/boot.ts` — importer `syncWindowTitle` et l'appeler juste avant `projectsStore.getState().init()` :

```ts
import { syncWindowTitle } from "./windowTitle";
```

```ts
    setForgetWorkspaces(forgetWorkspaces);
    syncWindowTitle();
    await projectsStore.getState().init();
```

`src-tauri/capabilities/default.json` — liste `permissions` :

```json
  "permissions": [
    "core:default",
    "core:window:allow-destroy",
    "core:window:allow-set-title",
    "opener:default",
    "dialog:default"
  ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/app/windowTitle.test.ts src/app/windowConfig.test.ts`
Expected: PASS (4 tests).

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: `Finished` sans erreur (la permission existe).

- [ ] **Step 5: Run the whole suite and the type check**

Run: `pnpm test` puis `pnpm exec tsc --noEmit`
Expected: tout passe ; aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/app/windowTitle.ts src/app/windowTitle.test.ts src/app/windowConfig.test.ts src/app/boot.ts src-tauri/capabilities/default.json
git commit -m "feat(window): the title names the open project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: La barre de titre intégrée

**Files:**
- Create: `src/shell/layout.ts`
- Create: `src/shell/DragStrip.tsx`
- Create: `src/shell/DragStrip.test.tsx`
- Create: `src/shell/WindowControls.tsx`
- Create: `src/shell/WindowControls.test.tsx`
- Create: `src/home/HomeScreen.test.tsx`
- Modify: `src/app/windowConfig.test.ts`
- Modify: `src/shell/TopBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/home/HomeScreen.tsx`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: rien des autres tâches.
- Produces: `TOP_ROW_HEIGHT = 56` (`src/shell/layout.ts`, utilisé par J7 pour la zone utile) ; `DragStrip()` ; `WindowControls()` ; `WindowCorner()`.

- [ ] **Step 1: Write the failing tests**

`src/app/windowConfig.test.ts` — ajouter l'import de la configuration et deux tests (fichier complet) :

```ts
import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import conf from "../../src-tauri/tauri.conf.json";

describe("window configuration (spec fenêtre §4.7)", () => {
  it("lets the page set the window title", () => {
    expect(capability.permissions).toContain("core:window:allow-set-title");
  });

  it("draws its own title bar", () => {
    expect(conf.app.windows[0].decorations).toBe(false);
  });

  it("lets the page move, minimize, maximize and close the window", () => {
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-start-dragging",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-close",
      ]),
    );
  });
});
```

`src/shell/DragStrip.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { DragStrip } from "./DragStrip";
import { TOP_ROW_HEIGHT } from "./layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("moves the window from its own empty space only, across the top row", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<DragStrip />));
  const strip = host.firstElementChild as HTMLElement;
  // A bare attribute: Tauri's script drags only on clicks that target the strip
  // itself, so the pills and menus drawn over it stay clickable.
  expect(strip.getAttribute("data-tauri-drag-region")).toBe("");
  expect(strip.childElementCount).toBe(0);
  expect(strip.style.height).toBe(`${TOP_ROW_HEIGHT}px`);
  expect(TOP_ROW_HEIGHT).toBe(56);
  await act(async () => root.unmount());
  host.remove();
});
```

`src/shell/WindowControls.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WindowControls } from "./WindowControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let calls: string[];
let maximized: boolean;
let host: HTMLDivElement;
let root: Root;

/** Lets the isMaximized() round trip and React's update finish. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(async () => {
  calls = [];
  maximized = false;
  mockWindows("main");
  mockIPC(
    (cmd) => {
      if (cmd === "plugin:window|is_maximized") return maximized;
      if (cmd.startsWith("plugin:window|")) calls.push(cmd.slice("plugin:window|".length));
    },
    { shouldMockEvents: true },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WindowControls />));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

it("minimizes, maximizes and asks to close the window", async () => {
  await act(async () => button("Réduire")!.click());
  await act(async () => button("Agrandir")!.click());
  await act(async () => button("Fermer")!.click());
  // close, never destroy: the save before closing (onCloseRequested) runs.
  expect(calls).toEqual(["minimize", "toggle_maximize", "close"]);
});

it("follows the maximized state, however it changed", async () => {
  expect(button("Agrandir")).not.toBeNull();
  maximized = true; // double-click on the strip, Win+Up, snapping…
  await act(async () => emit("tauri://resize", { width: 1920, height: 1080 }));
  await settle();
  expect(button("Restaurer")).not.toBeNull();
  expect(button("Agrandir")).toBeNull();
  maximized = false;
  await act(async () => emit("tauri://resize", { width: 1440, height: 900 }));
  await settle();
  expect(button("Agrandir")).not.toBeNull();
});
```

`src/home/HomeScreen.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { HomeScreen } from "./HomeScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockIPC((cmd) => (cmd === "list_projects" ? [] : undefined));
});
afterEach(() => clearMocks());

it("starts its header below the window's drag strip, at any width", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<HomeScreen />));
  const content = host.querySelector("header")!.parentElement!;
  // Spec fenêtre §4.4: "Ajouter un projet" never sits under the strip or the window buttons.
  expect(parseFloat(content.style.paddingTop)).toBeGreaterThan(TOP_ROW_HEIGHT);
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/app/windowConfig.test.ts src/shell/DragStrip.test.tsx src/shell/WindowControls.test.tsx src/home/HomeScreen.test.tsx`
Expected: FAIL — `windowConfig` : `decorations` vaut `undefined` et les quatre permissions manquent ; `DragStrip` et `WindowControls` : modules introuvables ; `HomeScreen` : module `@/shell/layout` introuvable.

- [ ] **Step 3: Write the configuration**

`src-tauri/tauri.conf.json` — fenêtre `main` :

```json
      {
        "label": "main",
        "title": "dummyPlane",
        "width": 1440,
        "height": 900,
        "minWidth": 960,
        "minHeight": 600,
        "decorations": false,
        "dragDropEnabled": false
      }
```

`src-tauri/capabilities/default.json` — liste `permissions` :

```json
  "permissions": [
    "core:default",
    "core:window:allow-destroy",
    "core:window:allow-set-title",
    "core:window:allow-start-dragging",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "opener:default",
    "dialog:default"
  ]
```

(`core:default` donne déjà `allow-is-maximized` et `allow-internal-toggle-maximize`, ce dernier utilisé par le double-clic de la bande.)

- [ ] **Step 4: Write the components**

`src/shell/layout.ts` :

```ts
/**
 * Height of the top row: 16 px margin, 32 px pills, 8 px below them (spec
 * fenêtre §4.2). It is the window's drag strip, and no canvas.
 */
export const TOP_ROW_HEIGHT = 56;
```

`src/shell/DragStrip.tsx` :

```tsx
import { TOP_ROW_HEIGHT } from "./layout";

/**
 * The window's title bar (spec fenêtre §4.2): the empty space of the top row
 * moves the window, a double-click maximizes it. Tauri's injected script reads
 * the bare attribute as "clicks on this element only", so the pills drawn over
 * the strip stay clickable.
 */
export function DragStrip() {
  return (
    <div
      data-tauri-drag-region=""
      aria-hidden
      className="fixed inset-x-0 top-0 z-20"
      style={{ height: TOP_ROW_HEIGHT }}
    />
  );
}
```

`src/shell/WindowControls.tsx` :

```tsx
import { useEffect, useState, type ComponentProps } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Whether the window is maximized, read again after every resize: the button, a double-click on the strip, Win+Up, snapping. */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let alive = true;
    const read = () =>
      void appWindow.isMaximized().then(
        (value) => alive && setMaximized(value),
        () => undefined,
      );
    read();
    const unlisten = appWindow.onResized(read);
    return () => {
      alive = false;
      void unlisten.then((stop) => stop());
    };
  }, []);
  return maximized;
}

function perform(action: () => Promise<void>, failure: string) {
  void action().catch((error: unknown) => toast.error(`${failure} : ${String(error)}`));
}

function WindowButton({ label, danger, className, ...props }: ComponentProps<"button"> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[8px] text-ov-text-2 transition-colors hover:bg-ov-hover hover:text-ov-text [&_svg]:size-4",
        danger && "hover:bg-ov-danger hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

/** Réduire, Agrandir / Restaurer, Fermer (spec fenêtre §4.3). */
export function WindowControls() {
  const maximized = useMaximized();
  const appWindow = getCurrentWindow();
  return (
    <div className="flex items-center gap-1">
      <WindowButton label="Réduire" onClick={() => perform(() => appWindow.minimize(), "Réduction impossible")}>
        <Minus />
      </WindowButton>
      <WindowButton
        label={maximized ? "Restaurer" : "Agrandir"}
        onClick={() =>
          perform(() => appWindow.toggleMaximize(), maximized ? "Restauration impossible" : "Agrandissement impossible")
        }
      >
        {maximized ? <Copy /> : <Square />}
      </WindowButton>
      {/* close, not destroy: onCloseRequested saves first (src/app/close.ts). */}
      <WindowButton label="Fermer" danger onClick={() => perform(() => appWindow.close(), "Fermeture impossible")}>
        <X />
      </WindowButton>
    </div>
  );
}

/** The window buttons outside a project (home, loading, error), in the top-right corner (spec fenêtre §4.4). */
export function WindowCorner() {
  return (
    <div className="fixed right-4 top-4 z-30">
      <WindowControls />
    </div>
  );
}
```

`src/shell/TopBar.tsx` — importer `WindowControls` et l'ajouter après `SettingsMenu` :

```tsx
import { WindowControls } from "./WindowControls";
```

```tsx
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        <LiveCount />
        <SettingsMenu />
        <WindowControls />
      </div>
```

`src/App.tsx` — la bande partout, les boutons en coin hors projet (le projet les porte dans sa barre du haut) :

```tsx
import { DragStrip } from "@/shell/DragStrip";
import { WindowCorner } from "@/shell/WindowControls";
```

```tsx
  return (
    <>
      {view === "home" && <HomeScreen />}
      {view === "project" && <ProjectView />}
      {(view === "loading" || view === "error") && (
        <div className="grid h-screen place-items-center bg-ov-canvas text-sm text-ov-text-2">
          {view === "error" ? `Impossible de charger les projets : ${error}` : "Chargement…"}
        </div>
      )}
      <DragStrip />
      {view !== "project" && <WindowCorner />}
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
```

`src/home/HomeScreen.tsx` — l'en-tête commence sous la bande (64 px au lieu de 48) :

```tsx
import { TOP_ROW_HEIGHT } from "@/shell/layout";
```

```tsx
      <div className="relative mx-auto max-w-5xl px-8 pb-12" style={{ paddingTop: TOP_ROW_HEIGHT + 8 }}>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- src/app/windowConfig.test.ts src/shell/DragStrip.test.tsx src/shell/WindowControls.test.tsx src/home/HomeScreen.test.tsx`
Expected: PASS (7 tests).

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: `Finished` sans erreur (permissions valides).

- [ ] **Step 6: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, puis `pnpm build`
Expected: tout passe ; aucune erreur de type ; build Vite terminé.

- [ ] **Step 7: Commit**

```bash
rm -f *.stackdump
git add src/shell/layout.ts src/shell/DragStrip.tsx src/shell/DragStrip.test.tsx src/shell/WindowControls.tsx src/shell/WindowControls.test.tsx src/home/HomeScreen.test.tsx src/home/HomeScreen.tsx src/app/windowConfig.test.ts src/shell/TopBar.tsx src/App.tsx src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(window): own title bar with a drag strip and window buttons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: L'icône de l'orbe

Pas de test automatisé : les icônes sont générées. La vérification est visuelle (étape 3).

**Files:**
- Create: `src-tauri/icons/source/orb.svg`
- Modify (régénérés) : `src-tauri/icons/*.png`, `src-tauri/icons/icon.ico`, `src-tauri/icons/icon.icns`

**Interfaces:**
- Consumes: rien.
- Produces: les icônes de `src-tauri/icons/` listées par `tauri.conf.json` (liste inchangée).

- [ ] **Step 1: Write the source**

`src-tauri/icons/source/orb.svg` — le dégradé de `.ov-orb` (CSS `radial-gradient(circle at 35% 30%, …)`, dont le rayon par défaut va jusqu'au coin le plus éloigné : √(0,65² + 0,70²) ≈ 0,955 de la boîte), sur un disque de 92 % du carré :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="orb" cx="0.35" cy="0.30" r="0.955">
      <stop offset="0" stop-color="#FFD48A"/>
      <stop offset="0.55" stop-color="#F4602E"/>
      <stop offset="1" stop-color="#8A2A10"/>
    </radialGradient>
  </defs>
  <circle cx="512" cy="512" r="471" fill="url(#orb)"/>
</svg>
```

- [ ] **Step 2: Generate the icons**

Run: `pnpm tauri icon src-tauri/icons/source/orb.svg`
Expected: la commande écrit les icônes dans `src-tauri/icons/` (`icon.ico`, `icon.icns`, `icon.png`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `Square*Logo.png`, `StoreLogo.png`).

Si elle refuse le SVG, le rendre d'abord en PNG 1024 transparent avec Edge sans interface, puis générer depuis le PNG :

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu --default-background-color=00000000 --window-size=1024,1024 --screenshot="$(cygpath -w "$PWD/src-tauri/icons/source/orb.png")" "file:///$(cygpath -m "$PWD/src-tauri/icons/source/orb.svg")"
pnpm tauri icon src-tauri/icons/source/orb.png
```

Puis retirer ce que la commande génère pour mobile (application de bureau seulement) :

Run: `git status --short src-tauri/icons` ; si `src-tauri/icons/android/` ou `src-tauri/icons/ios/` apparaissent : `rm -rf src-tauri/icons/android src-tauri/icons/ios`.

- [ ] **Step 3: Look at the result**

Ouvrir `src-tauri/icons/128x128.png` et `src-tauri/icons/32x32.png` (outil de lecture d'image).
Expected: un disque orange, clair en haut à gauche, sombre en bas à droite, fond transparent ; plus de logo Tauri.

- [ ] **Step 4: Commit**

```bash
rm -f *.stackdump
git add src-tauri/icons
git commit -m "feat(icon): the orange orb as the app icon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Vérification dans l'application

**Files:**
- Aucun, sauf si l'étape 3 échoue (étapes 4 à 8).

**Interfaces:**
- Consumes: tâches 1 à 3.
- Produces: rien (ou `ResizeHandles` si le redimensionnement natif manque).

- [ ] **Step 1: Launch the development app on the probe profile**

Ne piloter l'interface que si Mathieu n'utilise pas le poste ; sinon passer directement aux étapes de vérification de Mathieu (§10 J6) et le dire dans le compte rendu.

Run (en arrière-plan) : `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'`
Expected: la fenêtre s'ouvre sans barre Windows ; titre de la fenêtre (liste des fenêtres) « dummyPlane — <projet> » ou « dummyPlane ».

- [ ] **Step 2: Check the strip and the buttons**

Faire une capture, puis :
1. glisser depuis un vide de la rangée du haut (entre les onglets de workspace et `● N actifs`) : la fenêtre se déplace ;
2. double-cliquer au même endroit : la fenêtre s'agrandit et le bouton du milieu devient « Restaurer » (icône `Copy`) ; double-cliquer encore : restaurée, « Agrandir » ;
3. cliquer le sélecteur de projet et Réglages : leurs menus s'ouvrent (pas de déplacement) ;
4. Réduire : la fenêtre passe dans la barre des tâches ; la rouvrir ;
5. Agrandir puis Restaurer par le bouton ;
6. à l'accueil (`← Accueil`) : la bande et les trois boutons en haut à droite, « Ajouter un projet » sous la bande ; revenir au projet.

Expected: chaque point se comporte comme décrit.

- [ ] **Step 3: Check the resize by the edges**

Fenêtre restaurée, glisser le bord droit vers la droite de 100 px, puis le coin bas-droit.
Expected: la fenêtre s'élargit, puis s'agrandit en largeur et en hauteur. Si oui : fermer l'application par le bouton Fermer (vérifie la fermeture, qui sauvegarde), la tâche est finie, sans commit. Si non : étapes 4 à 8 (risque 2 de la spec).

- [ ] **Step 4 (si le bord ne redimensionne pas): Write the failing test**

`src/app/windowConfig.test.ts` — ajouter :

```ts
  it("lets the page resize the undecorated window by its edges", () => {
    expect(capability.permissions).toContain("core:window:allow-start-resize-dragging");
  });
```

`src/shell/ResizeHandles.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ResizeHandles } from "./ResizeHandles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let resized: unknown[];

beforeEach(() => {
  resized = [];
  mockWindows("main");
  mockIPC((cmd, args) => {
    if (cmd === "plugin:window|start_resize_dragging") resized.push((args as { value: unknown }).value);
  });
});
afterEach(() => clearMocks());

it("starts a native resize from each edge and corner", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ResizeHandles />));
  const handles = host.querySelectorAll<HTMLElement>("[data-resize]");
  expect(handles).toHaveLength(8);
  for (const handle of handles) {
    handle.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
  }
  expect(resized).toEqual(["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"]);
  await act(async () => root.unmount());
  host.remove();
});
```

Run: `pnpm test -- src/app/windowConfig.test.ts src/shell/ResizeHandles.test.tsx`
Expected: FAIL (permission absente, module introuvable).

- [ ] **Step 5 (si le bord ne redimensionne pas): Write the handles**

`src-tauri/capabilities/default.json` : ajouter `"core:window:allow-start-resize-dragging"` à `permissions`.

`src/shell/ResizeHandles.tsx` :

```tsx
import type { CSSProperties } from "react";
import { getCurrentWindow, type ResizeDirection } from "@tauri-apps/api/window";

const EDGE = 6;
const CORNER = 12;

/** Edges first, then corners: a corner, drawn last, wins where they overlap. */
const HANDLES: { direction: ResizeDirection; style: CSSProperties }[] = [
  { direction: "North", style: { left: 0, right: 0, top: 0, height: EDGE, cursor: "ns-resize" } },
  { direction: "South", style: { left: 0, right: 0, bottom: 0, height: EDGE, cursor: "ns-resize" } },
  { direction: "East", style: { top: 0, bottom: 0, right: 0, width: EDGE, cursor: "ew-resize" } },
  { direction: "West", style: { top: 0, bottom: 0, left: 0, width: EDGE, cursor: "ew-resize" } },
  { direction: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" } },
  { direction: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" } },
  { direction: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" } },
  { direction: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" } },
];

/** Invisible edges that resize the undecorated window when Windows does not (spec fenêtre §12, risk 2). */
export function ResizeHandles() {
  return (
    <>
      {HANDLES.map(({ direction, style }) => (
        <div
          key={direction}
          data-resize={direction}
          className="fixed z-[60]"
          style={style}
          onMouseDown={(event) => {
            if (event.button === 0) void getCurrentWindow().startResizeDragging(direction);
          }}
        />
      ))}
    </>
  );
}
```

`src/App.tsx` : rendre `<ResizeHandles />` juste après `<DragStrip />` (import `import { ResizeHandles } from "@/shell/ResizeHandles";`).

- [ ] **Step 6 (si le bord ne redimensionne pas): Run the tests**

Run: `pnpm test -- src/app/windowConfig.test.ts src/shell/ResizeHandles.test.tsx`, puis `pnpm test`, `pnpm exec tsc --noEmit`, `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: tout passe.

- [ ] **Step 7 (si le bord ne redimensionne pas): Check again in the app**

Reprendre l'étape 3 (l'application recharge le front ; relancer si la capacité a changé).
Expected: les bords et les coins redimensionnent.

- [ ] **Step 8 (si le bord ne redimensionne pas): Commit**

```bash
rm -f *.stackdump
git add src/shell/ResizeHandles.tsx src/shell/ResizeHandles.test.tsx src/app/windowConfig.test.ts src/App.tsx src-tauri/capabilities/default.json
git commit -m "fix(window): resize the undecorated window by its edges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: L'installateur

**Files:**
- Modify: `src/app/windowConfig.test.ts`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: tâches 1 à 4.
- Produces: `src-tauri/target/release/bundle/nsis/dummyPlane_0.1.0_x64-setup.exe`.

- [ ] **Step 1: Write the failing test**

`src/app/windowConfig.test.ts` — ajouter :

```ts
  it("ships as a French per-user NSIS installer (spec fenêtre §5)", () => {
    expect(conf.bundle.targets).toEqual(["nsis"]);
    expect(conf.bundle.windows.nsis).toEqual({ installMode: "currentUser", languages: ["French"] });
    expect(conf.identifier).toBe("dev.dummyplane.app");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- src/app/windowConfig.test.ts`
Expected: FAIL — `expected 'all' to deeply equal [ 'nsis' ]`.

- [ ] **Step 3: Write the bundle configuration**

`src-tauri/tauri.conf.json` — bloc `bundle` :

```json
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "languages": ["French"]
      }
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test` puis `pnpm exec tsc --noEmit`
Expected: tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/app/windowConfig.test.ts src-tauri/tauri.conf.json
git commit -m "build: ship dummyPlane as a French per-user NSIS installer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Build the installer**

Arrêter l'application de développement si elle tourne. Puis (plusieurs minutes, en arrière-plan avec un journal) :

Run: `pnpm tauri build > "$SCRATCH/c1-build.log" 2>&1` (`$SCRATCH` : le dossier de travail de la session)
Expected: le journal finit par `Finished 1 bundle at:` suivi du chemin `…\src-tauri\target\release\bundle\nsis\dummyPlane_0.1.0_x64-setup.exe`. Ni l'exécutable ni l'installateur ne sont lancés.

- [ ] **Step 7: Check that the executable has no console**

Lire le sous-système Windows dans l'en-tête PE de l'exécutable release (2 = fenêtre, 3 = console) :

Run:

```bash
python -I - src-tauri/target/release/dummyplane.exe <<'EOF'
import struct, sys
data = open(sys.argv[1], "rb").read()
pe = struct.unpack_from("<I", data, 0x3C)[0]
assert data[pe:pe + 4] == b"PE\0\0"
print(struct.unpack_from("<H", data, pe + 24 + 68)[0])
EOF
```

Expected: `2`.

- [ ] **Step 8: Hand over**

Donner à Mathieu le chemin de l'installateur et ses vérifications (spec §10 J6) : installer, lancer depuis le menu Démarrer (pas de console, orbe, titre « dummyPlane — <projet> » dans Alt+Tab), déplacer, double-cliquer, ancrer, redimensionner, les trois boutons. Lui rappeler de fermer l'exécutable `j5` avant : les deux partagent la base et relanceraient les agents deux fois (spec §12, risque 3).
