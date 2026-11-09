# dummyPlane — Plan D2 : structure façon canvas libre (jalon R2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La coquille d'dummyPlane devient celle de la maquette v3 : barre de titre (projet, compteurs, boutons de fenêtre façon Windows) et onglets façon navigateur en verre au-dessus d'un canvas plein cadre, rail d'outils à gauche, rail d'activités à droite, panneau Agents flottant, puce git, barre de consigne et zoom flottants en bas, accueil et menus en verre — les pastilles, puces, rails en pilule, panneau Flotte et bande de déplacement disparaissent.

**Architecture:** Chaque élément de la nouvelle coquille est un composant testé seul (tâches 2 à 6) ; la tâche 7 les assemble dans `ProjectView`, `HomeScreen` et `App`, puis supprime l'ancienne coquille. Les menus, popovers, listes, dialogues et toasts passent en verre par des règles CSS sur leurs `data-slot` (sans réécrire les composants shadcn). L'état du panneau Agents (ouvert, filtre) vit dans un petit magasin enregistré dans `settings`.

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind 4, Radix (shadcn), lucide-react, sonner 2.0.8, Excalidraw 0.18.1 (figé), Tauri 2.12, Vitest 5 (happy-dom, `@tauri-apps/api/mocks`).

**Spec:** `docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md` (§4.4, §5, §7, §9, §10 R2, §11). Maquette : `.superpowers/brainstorm/maquette-dummyplane-v3.html`.

## Global Constraints

- Barre de titre 38 px, verre dense ; à gauche logo puis projet ⌄ (projets récents, « Tous les projets… », « Fermer le projet ») ; centre vide jusqu'à J8 ; à droite compteurs en mono cliquables (`● N` en cours, masqué à 0 ; `● N` attend, masqué à 0 ; `● N actifs`), puis boutons de fenêtre 46 × 38 collés au coin, « Fermer dummyPlane » rouge `#C42B1C` au survol (spec §5.1).
- Onglets 34 px, verre dense, façon navigateur : coins arrondis en haut (6 px), actif sur `--ov-tab-on` bordé de `--ov-glass-line` avec filet d'accent de 2 px en haut, badge d'agents vivants, × au survol, `+` à la fin ; le vide de la rangée déplace la fenêtre (spec §5.2).
- Rail gauche (verre léger, centré, boutons 36 × 34) : Sélection (V), Main (H), Formes ⌄, Texte (T), Stylo ⌄, Gomme (E), Image, ＋ (catalogue, Nouvelle console, Lancer 4 agents, Orchestrateur), Ajuster ; menus à droite du rail (spec §5.4).
- Rail droit : Agents (pastille ambre du nombre qui attendent), Réglages (menu à gauche du rail) ; « Fonctions » arrive avec J8 (spec §5.5).
- Panneau Agents : à gauche du rail droit, sous les onglets, 318 px, jusqu'à la barre de consigne au plus, verre dense ; en-tête « AGENTS » + Lancer un agent, Nouvelle console, Composer un groupe, Tout mettre en pause, Tout reprendre, ⋯ (Lancer 4 agents, Tout replier, Tout déplier), ✕ ; filtres Tous, En cours, Attend, Prêts, Arrêtés ; arbre par groupe repliable, « Hors groupe », « Orchestrateurs » ; ouvert ou fermé selon `ui.agentsPanel` (spec §5.6).
- Panneau de propriétés : verre dense, à droite du rail gauche (spec §5.7).
- Bas : puce git (verre léger, 32 px, nombre de fichiers en accent, masquée hors dépôt), barre de consigne (verre léger, 680 px, 46 px, rayon 16, « Envoyer » accent rayon 10), zoom `− 100 % +` ; toasts en bas à droite au-dessus du zoom, offre de reprise comprise (spec §5.8).
- Accueil : même barre de titre (logo, « dummyPlane », boutons de fenêtre), fond aux halos sans grille, « Projets » + « Ajouter un projet » (accent), cartes en verre (spec §5.9).
- Menus, dialogues, palettes : verre dense, rayons de §4.4 (menus 12, dialogues 16, toasts 14), ombre `--ov-shadow`, voile des dialogues `rgba(0,0,0,.25)` flou 3 px (spec §5.10).
- Disparaissent : pastilles du haut, bande de déplacement de J6, rails en pilule, panneau Flotte, puces du bas, barre de commande en pilule, classes `ov-chip` (spec §5.11).
- `TOP_ROW_HEIGHT` = barre de titre + onglets = 72 px ; zone utile de J7 = canvas moins 72 px en haut et moins 60 px en bas (spec §7).
- Échec d'enregistrement d'un réglage : toast « Réglage non enregistré : <raison> » (spec §9).
- Interface en français ; code et commentaires en anglais ; Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; supprimer les `*.stackdump` avant chaque commit.
- Tests : `pnpm test` ; `pnpm exec tsc --noEmit` et `pnpm build` propres ; test ciblé : `pnpm exec vitest run <fichiers>`. Les tests qui lisent du CSS ou des sources passent par `readSource` / `sourceFiles` de `src/theme/cssBlocks.ts` (Vitest renvoie un texte vide pour le CSS).
- Ne jamais lancer l'exécutable release ni l'installateur depuis la session ; vérification dans l'application sur le profil `dev.dummyplane.probe`, sans souris si Mathieu peut être sur le poste.

### Décisions du plan (portées à Mathieu à la remise)

1. **Compteurs de la barre de titre** : « en cours » et « attend » comptent le workspace affiché (comme le panneau qu'ils ouvrent, filtré) ; « actifs » reste le compte du projet entier (comme aujourd'hui et sur l'accueil).
2. **Panneau Agents par défaut** : ouvert tant qu'aucun choix n'est enregistré (la maquette le montre ouvert).
3. **Lignes du panneau** : `AgentRow` est conservé tel quel (partagé avec l'orchestrateur) ; son aspect suit R3.
4. **Panneau de propriétés** : centré verticalement comme le rail gauche (dont la hauteur varie), au lieu d'« aligné sur son haut ».
5. **Écrans de chargement et d'erreur** : ils reçoivent la même barre de titre que l'accueil, pour que la fenêtre reste déplaçable et fermable.

## Review Focus

1. La fenêtre reste déplaçable et fermable sur chaque écran (chargement, erreur, accueil, projet) : barre de titre partout (tests : tâche 2 `TitleBar`, tâche 7 `StatusScreen`, `HomeScreen`).
2. Un clic sur un bouton de la barre de titre ou un onglet ne déplace jamais la fenêtre ; le vide le fait (tests : tâche 2 « drag only on empty space », tâche 3 rangée d'onglets).
3. Un compteur à 0 disparaît ; un clic ouvre le panneau filtré sur ce qu'il compte (tests : tâche 2 `AgentCounts`).
4. Le panneau Agents retrouve l'état ouvert ou fermé du dernier lancement ; sans réglage il est ouvert ; un échec d'enregistrement le dit (tests : tâche 2 `agentsPanel`).
5. Rien ne reste de l'ancienne coquille (pastilles, puces, rails en pilule, toasts en haut, bandeaux à 64 px) (tests : tâche 7, balayage des sources ; tâche 6 toasts).

---

## File Structure

- `index.html`, `src/index.css` : variante `dark` sur `data-theme`, verre des surfaces shadcn et des toasts, fin de `ov-chip`.
- `src/shell/layout.ts` : hauteurs des barres.
- `src/shell/buttons.tsx` (nouveau) : `ToolButton`, `IconButton`, `AccentButton` (remplacent `ui.tsx`).
- `src/shell/WindowControls.tsx`, `src/shell/TitleBar.tsx` (nouveau), `src/shell/ProjectPicker.tsx`, `src/shell/AgentCounts.tsx` (nouveau) : barre de titre.
- `src/fleet/agentCounts.ts` (nouveau), `src/fleet/agentsPanel.ts` (nouveau) : compteurs et état du panneau.
- `src/shell/WorkspaceTabs.tsx` : onglets façon navigateur.
- `src/fleet/AgentsPanel.tsx` (nouveau), `src/fleet/quickActions.ts` (nouveau), `src/shell/ActivityRail.tsx` (nouveau), `src/fleet/AgentMenu.tsx`, `src/fleet/ComposeGroup.tsx`, `src/shell/SettingsMenu.tsx`, `src/fleet/fleetView.ts` : panneau et rail droit.
- `src/shell/ToolRail.tsx` (nouveau), `src/shell/tools.ts`, `src/shell/ShapesMenu.tsx`, `src/shell/PenMenu.tsx`, `src/theme/excalidraw.css` : rail gauche et panneau de propriétés.
- `src/shell/CommandBar.tsx`, `src/fleet/CommandInput.tsx`, `src/shell/GitChip.tsx`, `src/shell/ZoomControl.tsx`, `src/shell/AppToaster.tsx`, `src/fleet/ResumeAllToast.tsx`, `src/fleet/LinkMode.tsx`, `src/fleet/PlacementGhost.tsx` : bas de l'écran et bandeaux.
- `src/shell/ProjectView.tsx`, `src/shell/StatusScreen.tsx` (nouveau), `src/App.tsx`, `src/home/HomeScreen.tsx`, `src/home/ProjectCard.tsx`, `src/app/boot.ts`, `src/store/ui.ts` : assemblage.
- Supprimés : `TopBar.tsx`, `DragStrip.tsx` (+ test), `LeftRail.tsx`, `RightRail.tsx`, `ActionChips.tsx`, `LiveCount.tsx`, `ui.tsx`, `src/fleet/FleetPanel.tsx`.

---

### Task 1: Les bases de la structure

**Files:**
- Create: `src/theme/structure.test.ts`
- Create: `src/shell/buttons.tsx`
- Create: `src/shell/buttons.test.tsx`
- Modify: `index.html:2`
- Modify: `src/index.css` (variante `dark`, verre des surfaces, en fin de fichier)
- Modify: `src/components/ui/sonner.tsx` (variables des toasts)
- Modify: `src/shell/layout.ts`
- Modify: `src/shell/DragStrip.test.tsx` (hauteur attendue)

**Interfaces:**
- Consumes: `readSource` (`src/theme/cssBlocks.ts`).
- Produces: `TITLE_BAR_HEIGHT = 38`, `TABS_HEIGHT = 34`, `TOP_ROW_HEIGHT = 72`, `BOTTOM_BAR_HEIGHT = 60` ; `ToolButton(props: ComponentProps<"button"> & { label: string; active?: boolean })`, `IconButton(props: ComponentProps<"button"> & { label: string })`, `AccentButton(props: ComponentProps<"button">)`.

- [ ] **Step 1: Write the failing tests**

`src/theme/structure.test.ts` :

```ts
import { expect, it } from "vitest";
import { TABS_HEIGHT, TITLE_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { readSource } from "./cssBlocks";

const index = readSource("index.css");

it("binds Tailwind's dark variant to the dark theme, not to a fixed class (spec identité §4.5)", () => {
  expect(readSource("../index.html")).not.toMatch(/class="dark"/);
  expect(index).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));');
});

it("puts menus, popovers, lists, dialogs and toasts in dense glass (spec identité §5.10)", () => {
  for (const slot of ["dropdown-menu-content", "dropdown-menu-sub-content", "popover-content", "select-content", "dialog-content"]) {
    expect(index).toContain(`[data-slot="${slot}"]`);
  }
  expect(index).toMatch(/\[data-slot="select-content"\] \{[^}]*var\(--ov-glass-strong\)[^}]*var\(--ov-blur\)[^}]*border-radius: 12px/);
  expect(index).toMatch(/\[data-slot="dialog-content"\] \{[^}]*var\(--ov-glass-strong\)[^}]*border-radius: 16px/);
  expect(index).toMatch(/\[data-slot="dialog-overlay"\] \{[^}]*rgb\(0 0 0 \/ 0\.25\)[^}]*blur\(3px\)/);
  expect(index).toMatch(/:root\[data-transparency="off"\] \[data-slot="dialog-overlay"\] \{[^}]*backdrop-filter: none/);
  expect(index).toMatch(/\[data-sonner-toast\]\[data-styled="true"\] \{[^}]*var\(--ov-glass-strong\)[^}]*border-radius: 14px/);
});

it("stacks the title bar and the tabs: 72 px of canvas under them (spec identité §7)", () => {
  expect([TITLE_BAR_HEIGHT, TABS_HEIGHT, TOP_ROW_HEIGHT]).toEqual([38, 34, 72]);
});
```

`src/shell/buttons.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AccentButton, IconButton, ToolButton } from "./buttons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("names every icon button and marks the active rail tool (spec identité §5.4)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <ToolButton label="Texte (T)" active />
        <ToolButton label="Gomme (E)" />
        <IconButton label="Nouveau workspace" />
        <AccentButton>Ajouter un projet</AccentButton>
      </>,
    ),
  );
  const [text, eraser, plus, accent] = [...host.querySelectorAll("button")];
  expect([text.title, text.getAttribute("aria-label"), text.getAttribute("aria-pressed")]).toEqual(["Texte (T)", "Texte (T)", "true"]);
  expect(text.className).toContain("bg-ov-accent-soft");
  expect(eraser.getAttribute("aria-pressed")).toBe("false");
  expect(plus.getAttribute("aria-label")).toBe("Nouveau workspace");
  expect(accent.className).toContain("text-ov-on-accent");
  expect(accent.className).toContain("rounded-[10px]");
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/theme/structure.test.ts src/shell/buttons.test.tsx`
Expected: FAIL — `class="dark"` présent ; `TITLE_BAR_HEIGHT` non exporté ; `./buttons` introuvable.

- [ ] **Step 3: Write the bases**

`index.html` — la balise devient `<html lang="fr">`.

`src/index.css` — remplacer la ligne de la variante :

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

et ajouter en fin de fichier, hors de toute `@layer` (une règle non rangée passe devant les classes utilitaires des composants shadcn) :

```css
/* Menus, popovers, lists and dialogs in dense glass (spec identité §5.10). */
[data-slot="dropdown-menu-content"],
[data-slot="dropdown-menu-sub-content"],
[data-slot="popover-content"],
[data-slot="select-content"] {
  background: var(--ov-glass-strong);
  backdrop-filter: var(--ov-blur);
  -webkit-backdrop-filter: var(--ov-blur);
  border: 1px solid var(--ov-glass-line);
  border-radius: 12px;
  box-shadow: var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-shadow);
}

[data-slot="dialog-content"] {
  background: var(--ov-glass-strong);
  backdrop-filter: var(--ov-blur);
  -webkit-backdrop-filter: var(--ov-blur);
  border: 1px solid var(--ov-glass-line);
  border-radius: 16px;
  box-shadow: var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-shadow);
}

[data-slot="dialog-overlay"] {
  background: rgb(0 0 0 / 0.25);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

/* The veil follows the transparency setting too. */
:root[data-transparency="off"] [data-slot="dialog-overlay"] {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

@media (prefers-reduced-transparency: reduce) {
  [data-slot="dialog-overlay"] {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* Toasts, in the bottom-right corner (spec identité §5.8). */
[data-sonner-toast][data-styled="true"] {
  background: var(--ov-glass-strong);
  backdrop-filter: var(--ov-blur);
  -webkit-backdrop-filter: var(--ov-blur);
  border-color: var(--ov-glass-line);
  border-radius: 14px;
  box-shadow: var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-shadow);
}
```

`src/components/ui/sonner.tsx` — dans le `style` du `Sonner`, les variables suivent le verre :

```tsx
          "--normal-bg": "var(--ov-glass-strong)",
          "--normal-text": "var(--ov-text)",
          "--normal-border": "var(--ov-glass-line)",
          "--border-radius": "14px",
```

`src/shell/layout.ts` (fichier complet) :

```ts
/** The title bar (spec identité §5.1). */
export const TITLE_BAR_HEIGHT = 38;

/** The workspace tabs under it (spec identité §5.2). */
export const TABS_HEIGHT = 34;

/**
 * What the bars cover at the top of a project's canvas: the "zone utile" of
 * spec fenêtre §6.4 starts below it (as amended by spec identité §7).
 */
export const TOP_ROW_HEIGHT = TITLE_BAR_HEIGHT + TABS_HEIGHT;

/** The command bar's band at the bottom: 14 px margin, 46 px bar (spec identité §5.8). */
export const BOTTOM_BAR_HEIGHT = 60;
```

`src/shell/DragStrip.test.tsx` — la bande (supprimée à la tâche 7) suit la nouvelle hauteur : remplacer `expect(TOP_ROW_HEIGHT).toBe(56);` par `expect(TOP_ROW_HEIGHT).toBe(72);`.

`src/shell/buttons.tsx` :

```tsx
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Labelled = { label: string };

/** A button of the floating rails (spec identité §5.4, §5.5): 36 × 34, the active one in the accent. */
export function ToolButton({ label, active = false, className, ...props }: ComponentProps<"button"> & Labelled & { active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative grid h-[34px] w-9 shrink-0 place-items-center rounded-[9px] text-ov-text-2 transition-colors hover:bg-ov-hover hover:text-ov-text [&_svg]:size-4",
        active && "bg-ov-accent-soft text-ov-accent hover:bg-ov-accent-soft hover:text-ov-accent",
        className,
      )}
      {...props}
    />
  );
}

/** A small icon button of panels, tabs and bars. */
export function IconButton({ label, className, ...props }: ComponentProps<"button"> & Labelled) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-[6px] text-ov-text-2 transition-colors hover:bg-ov-hover hover:text-ov-text [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

/** The main action of a screen or a popover (spec identité §4.4: radius 10). */
export function AccentButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-ov-accent px-3.5 text-[13px] font-semibold text-ov-on-accent transition-[filter] hover:brightness-110 disabled:opacity-40 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/theme/structure.test.ts src/shell/buttons.test.tsx src/shell/DragStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add index.html src/index.css src/components/ui/sonner.tsx src/shell/layout.ts src/shell/buttons.tsx src/shell/buttons.test.tsx src/theme/structure.test.ts src/shell/DragStrip.test.tsx
git commit -m "feat(shell): glass menus, dialogs and toasts, bar heights and shared buttons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: La barre de titre

**Files:**
- Create: `src/fleet/agentsPanel.ts`, `src/fleet/agentsPanel.test.ts`
- Create: `src/fleet/agentCounts.ts`
- Create: `src/shell/AgentCounts.tsx`, `src/shell/AgentCounts.test.tsx`
- Create: `src/shell/TitleBar.tsx`, `src/shell/TitleBar.test.tsx`
- Modify: `src/shell/WindowControls.tsx`, `src/shell/WindowControls.test.tsx`
- Modify: `src/shell/ProjectPicker.tsx`

**Interfaces:**
- Consumes: `TITLE_BAR_HEIGHT`, `IconButton` (tâche 1) ; `Logo` ; `FleetFilter` (`"all" | "working" | "waiting" | "idle" | "stopped"`, `src/fleet/fleetView.ts`) ; `getSetting`, `setSetting` ; `useRunningCount(workspaceIds)` (`src/store/running.ts`), `useActivities()`, `useNodes`, `terminalStatusStore`, `useCanvas`.
- Produces:
  - `agentsPanelStore` (`{ open: boolean; filter: FleetFilter }`), `useAgentsPanel(selector)`, `AGENTS_PANEL_KEY = "ui.agentsPanel"`, `readAgentsPanel(raw: unknown): boolean`, `loadAgentsPanel(): Promise<void>`, `setAgentsPanel(open: boolean): void`, `setAgentsFilter(filter: FleetFilter): void`, `showAgents(filter: FleetFilter): void` ;
  - `agentCounts(ids: readonly string[], statuses: Record<string, { state: string } | undefined>, activities: Record<string, { activity: string } | undefined>): { working: number; waiting: number }`, `useWorkspaceAgentCounts(): { working: number; waiting: number }` ;
  - `AgentCounts()`, `TitleBar({ leading, trailing }: { leading: ReactNode; trailing?: ReactNode })`, `WindowControls()` (boutons « Réduire », « Agrandir » / « Restaurer », « Fermer dummyPlane »), `WindowCorner()` (gardé jusqu'à la tâche 7).

- [ ] **Step 1: Write the failing tests**

`src/fleet/agentsPanel.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { agentsPanelStore, loadAgentsPanel, readAgentsPanel, setAgentsPanel, showAgents } from "./agentsPanel";

let saved: unknown[];

beforeEach(() => {
  saved = [];
  agentsPanelStore.setState({ open: false, filter: "all" });
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("the agents panel's state (spec identité §5.6)", () => {
  it("is open unless it was closed", () => {
    expect(readAgentsPanel("closed")).toBe(false);
    for (const raw of ["open", null, undefined, 3]) expect(readAgentsPanel(raw)).toBe(true);
  });

  it("comes back as it was left, open when nothing is saved", async () => {
    mockIPC((cmd) => (cmd === "get_setting" ? "closed" : undefined));
    await loadAgentsPanel();
    expect(agentsPanelStore.getState().open).toBe(false);
    mockIPC((cmd) => (cmd === "get_setting" ? null : undefined));
    await loadAgentsPanel();
    expect(agentsPanelStore.getState().open).toBe(true);
  });

  it("remembers each opening and closing", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
    });
    setAgentsPanel(true);
    setAgentsPanel(false);
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved).toEqual([
      { key: "ui.agentsPanel", value: "open" },
      { key: "ui.agentsPanel", value: "closed" },
    ]);
  });

  it("opens on what a counter of the title bar counts", () => {
    mockIPC(() => undefined);
    showAgents("waiting");
    expect(agentsPanelStore.getState()).toEqual({ open: true, filter: "waiting" });
  });

  it("says so when the choice cannot be saved, and keeps it", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    mockIPC(() => {
      throw new Error("disque plein");
    });
    setAgentsPanel(true);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Réglage non enregistré : .*disque plein/)));
    expect(agentsPanelStore.getState().open).toBe(true);
  });
});
```

`src/shell/AgentCounts.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentCounts } from "@/fleet/agentCounts";
import { agentsPanelStore } from "@/fleet/agentsPanel";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { AgentCounts } from "./AgentCounts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => mockIPC(() => undefined));
afterEach(() => clearMocks());

it("counts the running agents at work and waiting, never the stopped ones", () => {
  const statuses = { a: { state: "running" }, b: { state: "running" }, c: { state: "stopped" }, d: { state: "running" } };
  const activities = { a: { activity: "working" }, b: { activity: "waiting" }, c: { activity: "working" }, d: { activity: "idle" } };
  expect(agentCounts(["a", "b", "c", "d"], statuses, activities)).toEqual({ working: 1, waiting: 1 });
});

it("hides a counter at 0 and opens the panel on what it counts", async () => {
  for (const id of ["t1", "t2"]) {
    await nodesStore.getState().create(id, {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: id, name: id, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
    terminalStatusStore.getState().set(id, { state: "running" });
  }
  agentActivityStore.getState().apply({ nodeId: "t1", activity: "waiting", since: 0 });
  agentActivityStore.getState().apply({ nodeId: "t2", activity: "idle", since: 0 });
  canvasStore.getState().setNodeIds(["t1", "t2"]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AgentCounts />));
  expect(host.querySelector('[aria-label="Agents en cours"]')).toBeNull();
  const waiting = host.querySelector<HTMLButtonElement>('[aria-label="Agents qui attendent ta réponse"]')!;
  expect(waiting.textContent).toContain("1");
  await act(async () => waiting.click());
  expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "waiting" });
  expect(host.querySelector('[aria-label="Agents actifs du projet"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
```

`src/shell/TitleBar.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { TITLE_BAR_HEIGHT } from "./layout";
import { TitleBar } from "./TitleBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockWindows("main");
  mockIPC((cmd) => (cmd === "plugin:window|is_maximized" ? false : undefined), { shouldMockEvents: true });
});
afterEach(() => clearMocks());

it("moves the window from its empty space only, with the logo, its content and the window buttons", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TitleBar leading={<button type="button">mk-webapp</button>} trailing={<span>3</span>} />));
  const bar = host.firstElementChild as HTMLElement;
  expect(bar.style.height).toBe(`${TITLE_BAR_HEIGHT}px`);
  // Bare attributes: Tauri drags only on clicks aimed at the bar or its spacer.
  const regions = [...host.querySelectorAll("[data-tauri-drag-region]")];
  expect(regions.map((r) => r.getAttribute("data-tauri-drag-region"))).toEqual(["", ""]);
  expect(regions[0]).toBe(bar);
  expect(regions[1].querySelector("button")).toBeNull();
  expect(bar.querySelector("svg path")!.getAttribute("stroke")).toBe("#D97757");
  for (const label of ["Réduire", "Agrandir", "Fermer dummyPlane"]) expect(host.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
```

`src/shell/WindowControls.test.tsx` — l'étiquette du bouton de fermeture devient « Fermer dummyPlane », et le test « sits on an opaque pill » est remplacé :

```tsx
it("closes from a Windows-style corner button that turns red on hover", () => {
  const close = button("Fermer dummyPlane")!;
  expect(close.className).toContain("w-[46px]");
  expect(close.className).toContain("hover:bg-[#C42B1C]");
});
```

(dans le test « minimizes, maximizes and asks to close the window », remplacer `button("Fermer")` par `button("Fermer dummyPlane")`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/fleet/agentsPanel.test.ts src/shell/AgentCounts.test.tsx src/shell/TitleBar.test.tsx src/shell/WindowControls.test.tsx`
Expected: FAIL — modules introuvables ; pas de bouton « Fermer dummyPlane ».

- [ ] **Step 3: Write the panel state and the counts**

`src/fleet/agentsPanel.ts` :

```ts
import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { getSetting, setSetting } from "@/ipc/db";
import type { FleetFilter } from "./fleetView";

/** Spec identité §5.6: the panel comes back as it was left. */
export const AGENTS_PANEL_KEY = "ui.agentsPanel";

interface AgentsPanelState {
  open: boolean;
  filter: FleetFilter;
}

export const agentsPanelStore = createStore<AgentsPanelState>()(() => ({ open: true, filter: "all" }));

export function useAgentsPanel<T>(selector: (state: AgentsPanelState) => T): T {
  return useStore(agentsPanelStore, selector);
}

/** Open unless it was closed: the panel shows the fleet to a new user. */
export function readAgentsPanel(raw: unknown): boolean {
  return raw !== "closed";
}

/** At boot. An unreadable setting keeps the panel open. */
export async function loadAgentsPanel() {
  try {
    agentsPanelStore.setState({ open: readAgentsPanel(await getSetting<unknown>(AGENTS_PANEL_KEY)) });
  } catch (error) {
    console.warn(`agents panel: ${String(error)}`);
  }
}

export function setAgentsPanel(open: boolean) {
  agentsPanelStore.setState({ open });
  void setSetting(AGENTS_PANEL_KEY, open ? "open" : "closed").catch((error: unknown) => {
    toast.error(`Réglage non enregistré : ${String(error)}`);
  });
}

export function setAgentsFilter(filter: FleetFilter) {
  agentsPanelStore.setState({ filter });
}

/** A counter of the title bar: the panel, on what it counts. */
export function showAgents(filter: FleetFilter) {
  setAgentsFilter(filter);
  setAgentsPanel(true);
}
```

`src/fleet/agentCounts.ts` :

```ts
import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { useActivities } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";

/** Running agents at work and waiting for an answer, among `ids`. */
export function agentCounts(
  ids: readonly string[],
  statuses: Record<string, { state: string } | undefined>,
  activities: Record<string, { activity: string } | undefined>,
): { working: number; waiting: number } {
  let working = 0;
  let waiting = 0;
  for (const id of ids) {
    if (statuses[id]?.state !== "running") continue;
    if (activities[id]?.activity === "working") working += 1;
    if (activities[id]?.activity === "waiting") waiting += 1;
  }
  return { working, waiting };
}

/** The counts of the workspace on screen: what the agents panel shows (plan D2, décision 1). */
export function useWorkspaceAgentCounts(): { working: number; waiting: number } {
  const nodeIds = useCanvas((s) => s.nodeIds);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();
  return agentCounts(
    nodeIds.filter((id) => nodes[id]?.kind === "terminal"),
    statuses,
    activities,
  );
}
```

- [ ] **Step 4: Write the title bar**

`src/shell/AgentCounts.tsx` :

```tsx
import type { ReactNode } from "react";
import { useWorkspaceAgentCounts } from "@/fleet/agentCounts";
import { showAgents } from "@/fleet/agentsPanel";
import type { FleetFilter } from "@/fleet/fleetView";
import { plural } from "@/lib/format";
import { useRunningCount } from "@/store/running";
import { useWorkspaces } from "@/store/workspaces";

function Count({ label, color, filter, children }: { label: string; color: string; filter: FleetFilter; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => showAgents(filter)}
      className="flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 font-mono text-[11.5px] text-ov-text-2 hover:bg-ov-hover hover:text-ov-text"
    >
      <span className="size-[7px] rounded-full" style={{ backgroundColor: color }} />
      {children}
    </button>
  );
}

/** The title bar's counters (spec identité §5.1): each opens the agents panel on what it counts. */
export function AgentCounts() {
  const { working, waiting } = useWorkspaceAgentCounts();
  const workspaces = useWorkspaces((s) => s.workspaces);
  const running = useRunningCount(workspaces.map((w) => w.id));
  return (
    <div className="flex items-center gap-0.5">
      {working > 0 && (
        <Count label="Agents en cours" color="var(--ov-accent)" filter="working">
          {working}
        </Count>
      )}
      {waiting > 0 && (
        <Count label="Agents qui attendent ta réponse" color="var(--ov-wait)" filter="waiting">
          {waiting}
        </Count>
      )}
      <Count label="Agents actifs du projet" color="var(--ov-ok)" filter="all">
        {plural(running, "actif", "actifs")}
      </Count>
    </div>
  );
}
```

`src/shell/WindowControls.tsx` — boutons façon Windows, collés au coin ; remplacer `WindowButton` et le conteneur de `WindowControls` :

```tsx
function WindowButton({ label, danger, className, ...props }: ComponentProps<"button"> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "grid h-[38px] w-[46px] shrink-0 place-items-center text-ov-text-2 transition-colors hover:bg-ov-hover hover:text-ov-text [&_svg]:size-4",
        danger && "hover:bg-[#C42B1C] hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

/** Réduire, Agrandir / Restaurer, Fermer dummyPlane, Windows-style in the title bar's corner (spec identité §5.1). */
export function WindowControls() {
  const maximized = useMaximized();
  const appWindow = getCurrentWindow();
  return (
    <div className="flex shrink-0 items-stretch">
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
      <WindowButton label="Fermer dummyPlane" danger onClick={() => perform(() => appWindow.close(), "Fermeture impossible")}>
        <X />
      </WindowButton>
    </div>
  );
}
```

(`WindowCorner` reste tel quel jusqu'à la tâche 7.)

`src/shell/TitleBar.tsx` :

```tsx
import type { ReactNode } from "react";
import { TITLE_BAR_HEIGHT } from "./layout";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";

/**
 * The title bar (spec identité §5.1): the logo, `leading` (the project picker,
 * or the app's name), a spacer, `trailing` (the agent counts), the window
 * buttons in the corner. The bar and its spacer carry Tauri's bare drag
 * attribute: a click aimed at them moves the window, a double-click maximizes
 * it; a click on any button inside does not.
 */
export function TitleBar({ leading, trailing }: { leading: ReactNode; trailing?: ReactNode }) {
  return (
    <div
      data-tauri-drag-region=""
      className="ov-glass-strong flex w-full shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 pl-3"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      <Logo />
      {leading}
      <div data-tauri-drag-region="" className="h-full flex-1" />
      {trailing}
      <WindowControls />
    </div>
  );
}
```

`src/shell/ProjectPicker.tsx` — déclencheur de barre de titre, et « Fermer le projet » à la fin du menu ; remplacer l'import de `PillButton` et le `DropdownMenuTrigger` :

```tsx
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-[26px] items-center gap-1 rounded-[6px] px-2 text-[13px] font-semibold text-ov-text hover:bg-ov-hover"
        >
          <span className="max-w-48 truncate">{active?.name ?? "Projet"}</span>
          <ChevronDown className="size-3.5 text-ov-text-2" />
        </button>
      </DropdownMenuTrigger>
```

et après « Tous les projets… » :

```tsx
        <DropdownMenuItem onSelect={() => void projectsStore.getState().close()}>Fermer le projet</DropdownMenuItem>
```

(supprimer l'import de `PillButton`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/fleet/agentsPanel.test.ts src/shell/AgentCounts.test.tsx src/shell/TitleBar.test.tsx src/shell/WindowControls.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
rm -f *.stackdump
git add src/fleet/agentsPanel.ts src/fleet/agentsPanel.test.ts src/fleet/agentCounts.ts src/shell/AgentCounts.tsx src/shell/AgentCounts.test.tsx src/shell/TitleBar.tsx src/shell/TitleBar.test.tsx src/shell/WindowControls.tsx src/shell/WindowControls.test.tsx src/shell/ProjectPicker.tsx
git commit -m "feat(shell): title bar with the project, agent counts and Windows buttons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Les onglets façon navigateur

**Files:**
- Create: `src/shell/WorkspaceTabs.test.tsx`
- Modify: `src/shell/WorkspaceTabs.tsx`

**Interfaces:**
- Consumes: `TABS_HEIGHT`, `IconButton` (tâche 1) ; `useWorkspaces`, `workspacesStore` ; `useRunningCount`.
- Produces: `WorkspaceTabs()` : la rangée complète (34 px, verre dense, déplacement de la fenêtre par son vide).

- [ ] **Step 1: Write the failing test**

`src/shell/WorkspaceTabs.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { workspacesStore } from "@/store/workspaces";
import { TABS_HEIGHT } from "./layout";
import { WorkspaceTabs } from "./WorkspaceTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockIPC(() => undefined);
  workspacesStore.setState({
    workspaces: [
      { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null },
      { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null },
    ],
    activeId: "w2",
  } as never);
});
afterEach(() => clearMocks());

it("shows the workspaces as browser tabs on a row that moves the window (spec identité §5.2)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<WorkspaceTabs />));
  const row = host.firstElementChild as HTMLElement;
  expect(row.getAttribute("data-tauri-drag-region")).toBe("");
  expect(row.style.height).toBe(`${TABS_HEIGHT}px`);
  const tabs = [...row.querySelectorAll<HTMLElement>("[data-tab]")];
  expect(tabs.map((t) => t.dataset.tab)).toEqual(["w1", "w2"]);
  expect(tabs[1].dataset.active).toBe("true");
  expect(tabs[1].className).toContain("bg-ov-tab-on");
  expect(row.querySelector('[aria-label="Nouveau workspace"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/shell/WorkspaceTabs.test.tsx`
Expected: FAIL — la racine n'a pas l'attribut de déplacement.

(Si le type `Workspace` diffère des champs utilisés, ajuster le test aux champs réels de `src/store/workspaces.ts` et noter une décision au journal.)

- [ ] **Step 3: Restyle the tabs**

`src/index.css` — dans `@theme inline`, ajouter la couleur d'onglet actif :

```css
  --color-ov-tab-on: var(--ov-tab-on);
```

`src/shell/WorkspaceTabs.tsx` — remplacer l'import de `PillButton` par :

```tsx
import { IconButton } from "./buttons";
import { TABS_HEIGHT } from "./layout";
```

le champ de renommage :

```tsx
      <Input
        autoFocus
        defaultValue={workspace.name}
        className="mb-0.5 h-[28px] w-40 rounded-[6px]"
```

le conteneur de l'onglet (le `<div onContextMenu=…>`) :

```tsx
    <div
      data-tab={workspace.id}
      data-active={active}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        "group relative top-px flex h-[30px] shrink-0 items-center rounded-t-[6px] border border-b-0 pl-3.5 pr-1 text-[12.5px]",
        active
          ? "border-ov-glass-line bg-ov-tab-on text-ov-text before:absolute before:inset-x-2.5 before:-top-px before:h-0.5 before:rounded-full before:bg-ov-accent"
          : "border-transparent text-ov-text-2 hover:bg-ov-hover hover:text-ov-text",
      )}
    >
```

le badge :

```tsx
          className={cn(
            "ml-2 rounded-full px-1.5 font-mono text-[10px]",
            active ? "bg-ov-accent-soft text-ov-accent" : "bg-ov-field text-ov-text-2",
          )}
```

le bouton ⋯ (survol, comme un × d'onglet) :

```tsx
            className="ml-1 grid size-5 place-items-center rounded-[4px] opacity-0 group-hover:opacity-100 hover:bg-ov-hover data-[state=open]:opacity-100"
```

et la rangée complète :

```tsx
/** Workspace tabs of the open project, then "+" (spec identité §5.2). The row's empty space moves the window. */
export function WorkspaceTabs() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  return (
    <div
      data-tauri-drag-region=""
      className="ov-glass-strong flex w-full items-end gap-0.5 overflow-x-auto rounded-none border-x-0 border-t-0 px-2.5"
      style={{ height: TABS_HEIGHT }}
    >
      {workspaces.map((workspace) => (
        <WorkspaceTab
          key={workspace.id}
          workspace={workspace}
          active={workspace.id === activeId}
          canRemove={workspaces.length > 1}
        />
      ))}
      <IconButton
        label="Nouveau workspace"
        className="mb-0.5 size-[28px]"
        onClick={() => void workspacesStore.getState().create().catch(fail("Création impossible"))}
      >
        <Plus />
      </IconButton>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/shell/WorkspaceTabs.test.tsx`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/index.css src/shell/WorkspaceTabs.tsx src/shell/WorkspaceTabs.test.tsx
git commit -m "feat(shell): browser-like workspace tabs on a window-dragging row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Le panneau Agents et le rail d'activités

**Files:**
- Create: `src/fleet/quickActions.ts`
- Create: `src/fleet/AgentsPanel.tsx`, `src/fleet/AgentsPanel.test.tsx`
- Create: `src/shell/ActivityRail.tsx`, `src/shell/ActivityRail.test.tsx`
- Modify: `src/fleet/AgentMenu.tsx` (déclencheur en paramètre, Nouvelle console, Lancer 4 agents)
- Modify: `src/fleet/ComposeGroup.tsx` (déclencheur et côté en paramètres)
- Modify: `src/shell/SettingsMenu.tsx` (déclencheur et côté en paramètres)
- Modify: `src/fleet/fleetView.ts` (« Prêts ») et son test s'il cite « Inactifs »
- Modify: `src/shell/ActionChips.tsx`, `src/shell/LeftRail.tsx` (via `ProjectView`), `src/shell/TopBar.tsx` (appels mis à jour jusqu'à leur suppression en tâche 7)

**Interfaces:**
- Consumes: `IconButton`, `ToolButton`, `TOP_ROW_HEIGHT`, `BOTTOM_BAR_HEIGHT` (tâche 1) ; `useAgentsPanel`, `setAgentsPanel`, `setAgentsFilter`, `useWorkspaceAgentCounts` (tâche 2) ; `fleetSections`, `filterCounts`, `fleetStateOf`, `FLEET_FILTERS`, `AgentRow`, `pauseAll`, `resumeAll`, `workspaceTerminalIds`, `readOrchestratorPayload`.
- Produces:
  - `newConsole(): void`, `launchFour(): void` (`src/fleet/quickActions.ts`) ;
  - `AgentMenu({ trigger, side }: { trigger: (open: boolean) => ReactElement; side?: "right" | "left" | "bottom" })` ;
  - `ComposeGroup({ trigger, side }: { trigger: ReactElement; side?: "top" | "left" | "bottom" })` ;
  - `SettingsMenu({ trigger, side, align }: { trigger: ReactElement; side?: "bottom" | "left"; align?: "start" | "end" })` ;
  - `AgentsPanel()`, `ActivityRail()`.

- [ ] **Step 1: Write the failing tests**

`src/fleet/AgentsPanel.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { agentsPanelStore } from "./agentsPanel";
import { AgentsPanel } from "./AgentsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mockIPC(() => undefined);
  agentsPanelStore.setState({ open: true, filter: "all" });
  await nodesStore.getState().create("ada", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Ada", name: "Ada", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set("ada", { state: "stopped" });
  canvasStore.getState().setNodeIds(["ada"]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AgentsPanel />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const byLabel = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

it("floats under the tabs, down to the command bar at most, with the chips' actions (spec identité §5.6)", () => {
  const panel = host.firstElementChild as HTMLElement;
  expect(panel.style.top).toBe(`${TOP_ROW_HEIGHT + 14}px`);
  expect(panel.style.maxHeight).toBe(`calc(100% - ${TOP_ROW_HEIGHT + 14 + BOTTOM_BAR_HEIGHT + 14}px)`);
  for (const label of ["Lancer un agent", "Nouvelle console", "Composer un groupe", "Tout mettre en pause", "Tout reprendre", "Plus d'actions", "Fermer le panneau"]) {
    expect(byLabel(label), label).not.toBeNull();
  }
});

it("filters on the store's filter, labelled Prêts for idle agents", async () => {
  const filters = [...host.querySelectorAll<HTMLButtonElement>("[data-filter]")];
  expect(filters.map((f) => f.textContent?.replace(/\d+$/, ""))).toEqual(["Tous", "En cours", "Attend", "Prêts", "Arrêtés"]);
  await act(async () => filters[4].click());
  expect(agentsPanelStore.getState().filter).toBe("stopped");
  expect(filters[4].dataset.on).toBe("true");
});

it("folds a group and closes", async () => {
  expect(host.textContent).toContain("Ada");
  await act(async () => host.querySelector<HTMLButtonElement>("[data-section]")!.click());
  expect(host.textContent).not.toContain("Ada");
  await act(async () => byLabel("Fermer le panneau")!.click());
  expect(agentsPanelStore.getState().open).toBe(false);
});
```

`src/shell/ActivityRail.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/fleet/agentsPanel";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { ActivityRail } from "./ActivityRail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => mockIPC(() => undefined));
afterEach(() => clearMocks());

it("toggles the agents panel and shows how many agents wait (spec identité §5.5)", async () => {
  await nodesStore.getState().create("alan", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Alan", name: "Alan", agent: "codex", cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set("alan", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "alan", activity: "waiting", since: 0 });
  canvasStore.getState().setNodeIds(["alan"]);
  agentsPanelStore.setState({ open: false, filter: "all" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ActivityRail />));
  const agents = host.querySelector<HTMLButtonElement>('[aria-label="Agents"]')!;
  expect(agents.querySelector("[data-pip]")?.textContent).toBe("1");
  await act(async () => agents.click());
  expect(agentsPanelStore.getState().open).toBe(true);
  expect(host.querySelector('[aria-label="Réglages"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/fleet/AgentsPanel.test.tsx src/shell/ActivityRail.test.tsx`
Expected: FAIL — modules introuvables.

- [ ] **Step 3: Move the chips' actions, open the menus' triggers**

`src/fleet/quickActions.ts` (déplacé d'`ActionChips`, comportement inchangé) :

```ts
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { nextGroupName } from "@/canvas/groups";
import { agentsStore } from "./agentsStore";
import { defaultAgent } from "./catalog";
import { launchGroup } from "./groups";
import { defaultLaunchOptions, launchAgent } from "./launchAgent";
import { viewportCenter } from "./placement";

const reportLaunchError = (error: unknown) => toast.error(`Lancement impossible : ${String(error)}`);

/** "Nouvelle console": the default agent at the center of the view (spec habillage §5.6). */
export function newConsole() {
  const agent = defaultAgent(agentsStore.getState().agents);
  const center = viewportCenter(canvasStore.getState().view);
  void launchAgent(agent, defaultLaunchOptions(), center).catch(reportLaunchError);
}

/** "Lancer 4 agents": a Général group of four default agents (spec habillage §11.3). */
export function launchFour() {
  const agent = defaultAgent(agentsStore.getState().agents);
  const name = nextGroupName(canvasStore.getState().frames);
  void launchGroup({ name, role: "general", agents: [agent, agent, agent, agent] }).catch(reportLaunchError);
}
```

`src/shell/ActionChips.tsx` — importer `newConsole`, `launchFour` depuis `@/fleet/quickActions`, supprimer les deux fonctions locales et leurs imports devenus inutiles, et passer à `ComposeGroup` son déclencheur : `<ComposeGroup trigger={<ChipButton>Groupe</ChipButton>} />`.

`src/fleet/AgentMenu.tsx` :
- signature : `export function AgentMenu({ trigger, side = "right" }: { trigger: (open: boolean) => ReactElement; side?: "right" | "left" | "bottom" })` (importer `type ReactElement` depuis `react`) ;
- déclencheur : `<PopoverTrigger asChild>{trigger(open)}</PopoverTrigger>` (supprimer l'import de `RoundButton` et d'`Asterisk`) ;
- contenu : `<PopoverContent side={side} align="start" className="w-72 p-2">` ;
- avant le bouton « Orchestrateur », deux entrées :

```tsx
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  newConsole();
                }}
                className="mt-1 flex items-center gap-2.5 rounded-lg border-t border-ov-line px-2 py-1.5 text-left hover:bg-ov-hover"
              >
                <span className="grid size-7 place-items-center rounded-md bg-ov-field text-ov-text-2">
                  <SquareTerminal className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-ov-text">Nouvelle console</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  launchFour();
                }}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ov-hover"
              >
                <span className="grid size-7 place-items-center rounded-md bg-ov-field text-ov-text-2">
                  <Layers className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-ov-text">Lancer 4 agents</span>
              </button>
```

(importer `Layers`, `SquareTerminal` depuis `lucide-react` et `launchFour`, `newConsole` depuis `./quickActions` ; le bouton « Orchestrateur » perd sa classe `mt-1 … border-t border-ov-line` et garde le reste.)

`src/shell/LeftRail.tsx` — en attendant sa suppression (tâche 7), `ProjectView` lui passe `agentButton={<AgentMenu trigger={(open) => <RoundButton label="Lancer un agent" active={open}><Asterisk className={open ? undefined : "text-ov-accent"} /></RoundButton>} />}` (imports dans `ProjectView` : `RoundButton` de `./ui`, `Asterisk` de `lucide-react`).

`src/fleet/ComposeGroup.tsx` :
- signature : `export function ComposeGroup({ trigger, side = "top" }: { trigger: ReactElement; side?: "top" | "left" | "bottom" })` ;
- `<PopoverTrigger asChild>{trigger}</PopoverTrigger>` (supprimer l'import de `ChipButton`) ;
- `<PopoverContent side={side} sideOffset={10} className="flex w-[360px] flex-col gap-3 p-3">`.

`src/shell/SettingsMenu.tsx` :
- signature : `export function SettingsMenu({ trigger, side = "bottom", align = "end" }: { trigger: ReactElement; side?: "bottom" | "left"; align?: "start" | "end" })` ;
- `<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>` (supprimer l'import de `RoundButton` et de `Settings`) ;
- `<DropdownMenuContent side={side} align={align} className="w-56">`.

`src/shell/TopBar.tsx` — en attendant sa suppression : `<SettingsMenu trigger={<RoundButton label="Réglages" className="border border-ov-line bg-ov-surface shadow-ov"><Settings /></RoundButton>} />` (imports `RoundButton` de `./ui`, `Settings` de `lucide-react`).

`src/fleet/fleetView.ts` — `{ id: "idle", label: "Prêts" }` (et dans `fleetView.test.ts`, toute attente « Inactifs » devient « Prêts »).

- [ ] **Step 4: Write the panel and the rail**

`src/fleet/AgentsPanel.tsx` :

```tsx
import { useState } from "react";
import { ChevronDown, Ellipsis, Layers, Network, Pause, Play, Plus, SquareTerminal, X } from "lucide-react";
import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { focusNode } from "@/canvas/focusNode";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { readOrchestratorPayload } from "@/nodes/types";
import { IconButton } from "@/shell/buttons";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { useActivities } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { AgentMenu } from "./AgentMenu";
import { AgentRow } from "./AgentRow";
import { setAgentsFilter, setAgentsPanel, useAgentsPanel } from "./agentsPanel";
import { pauseAll, resumeAll, workspaceTerminalIds } from "./broadcast";
import { AGENTS } from "./catalog";
import { ComposeGroup } from "./ComposeGroup";
import { FLEET_FILTERS, filterCounts, fleetSections, fleetStateOf, type FleetAgent } from "./fleetView";
import { countsText } from "./groupSummary";
import { launchFour, newConsole } from "./quickActions";

const OUTSIDE = "outside";

/** The agents of the workspace on screen, by group (spec identité §5.6); it replaces the fleet panel. */
export function AgentsPanel() {
  const filter = useAgentsPanel((s) => s.filter);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const now = useNow(15_000);
  const nodeIds = useCanvas((s) => s.nodeIds);
  const frames = useCanvas((s) => s.frames);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();

  const agents: FleetAgent[] = nodeIds.flatMap((id) => {
    const payload = terminalOf(nodes[id]);
    if (!payload) return [];
    const status = statuses[id] ?? { state: "stopped" as const };
    const state = fleetStateOf(status, activities[id]);
    return [{ id, name: payload.name || AGENTS[payload.agent].label, agent: payload.agent, state, since: state === "stopped" ? undefined : activities[id]?.since }];
  });
  const orchestrators = nodeIds.flatMap((id) =>
    nodes[id]?.kind === "orchestrator" ? [{ id, name: readOrchestratorPayload(nodes[id]?.payload).name }] : [],
  );
  const counts = filterCounts(agents);
  const sections = fleetSections(agents, frames, filter);
  const keyOf = (id: string | null) => id ?? OUTSIDE;
  const fold = (key: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <aside
      className="ov-glass-strong absolute right-[72px] z-30 flex w-[318px] flex-col overflow-hidden rounded-[14px]"
      style={{ top: TOP_ROW_HEIGHT + 14, maxHeight: `calc(100% - ${TOP_ROW_HEIGHT + 14 + BOTTOM_BAR_HEIGHT + 14}px)` }}
    >
      <header className="flex h-9 shrink-0 items-center border-b border-ov-line pl-3 pr-1.5">
        <span className="ov-label">Agents</span>
        <div className="ml-auto flex items-center">
          <AgentMenu side="left" trigger={() => <IconButton label="Lancer un agent"><Plus /></IconButton>} />
          <IconButton label="Nouvelle console" onClick={newConsole}>
            <SquareTerminal />
          </IconButton>
          <ComposeGroup side="left" trigger={<IconButton label="Composer un groupe"><Layers /></IconButton>} />
          <IconButton label="Tout mettre en pause" onClick={() => void pauseAll(workspaceTerminalIds())}>
            <Pause />
          </IconButton>
          <IconButton label="Tout reprendre" onClick={() => void resumeAll(workspaceTerminalIds())}>
            <Play />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Plus d'actions">
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={launchFour}>Lancer 4 agents</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFolded(new Set([...sections.map((s) => keyOf(s.id)), "orchestrators"]))}>
                Tout replier
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFolded(new Set())}>Tout déplier</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label="Fermer le panneau" onClick={() => setAgentsPanel(false)}>
            <X />
          </IconButton>
        </div>
      </header>
      <div className="flex shrink-0 gap-px px-2 pb-1.5 pt-2">
        {FLEET_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-filter={id}
            data-on={id === filter}
            onClick={() => setAgentsFilter(id)}
            className={cn(
              "whitespace-nowrap rounded-[4px] px-1.5 py-0.5 text-[11.5px]",
              id === filter ? "bg-ov-accent-soft text-ov-accent" : "text-ov-text-2 hover:bg-ov-hover",
            )}
          >
            {label}
            <span className="ml-1 font-mono text-[10.5px]">{counts[id]}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sections.length === 0 && orchestrators.length === 0 && <p className="py-4 text-center text-xs text-ov-text-2">Aucun agent</p>}
        {sections.map((section) => {
          const key = keyOf(section.id);
          const open = !folded.has(key);
          return (
            <section key={key}>
              <button
                type="button"
                data-section={key}
                onClick={() => fold(key)}
                className="flex h-[26px] w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[11.5px] hover:bg-ov-hover"
              >
                <ChevronDown className={cn("size-3.5 text-ov-text-2 transition-transform", !open && "-rotate-90")} />
                <span className="size-2 rounded-[2px]" style={{ backgroundColor: section.color ?? "var(--ov-text-3)" }} />
                <span className="font-semibold tracking-[0.03em] text-ov-text uppercase">{section.name}</span>
                <span className="ml-auto font-mono text-[10.5px] text-ov-text-2">
                  {countsText(section.agents.length, section.agents.filter((a) => a.state === "working").length)}
                </span>
              </button>
              {open &&
                section.agents.map((a) => (
                  <AgentRow
                    key={a.id}
                    id={a.id}
                    onOpen={() => focusNode(a.id)}
                    trailing={
                      <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-ov-text-2">
                        {a.since !== undefined ? formatDuration(now - a.since) : ""}
                      </span>
                    }
                  />
                ))}
            </section>
          );
        })}
        {orchestrators.length > 0 && (
          <section>
            <button
              type="button"
              data-section="orchestrators"
              onClick={() => fold("orchestrators")}
              className="flex h-[26px] w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[11.5px] hover:bg-ov-hover"
            >
              <ChevronDown className={cn("size-3.5 text-ov-text-2 transition-transform", folded.has("orchestrators") && "-rotate-90")} />
              <span className="font-semibold tracking-[0.03em] text-ov-text uppercase">Orchestrateurs</span>
              <span className="ml-auto font-mono text-[10.5px] text-ov-text-2">{orchestrators.length}</span>
            </button>
            {!folded.has("orchestrators") &&
              orchestrators.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => focusNode(o.id)}
                  className="flex h-[26px] w-full items-center gap-2 rounded-[6px] pl-6 pr-2 text-left text-[12.5px] hover:bg-ov-hover"
                >
                  <Network className="size-3.5 text-ov-accent" />
                  <span className="truncate font-semibold text-ov-text">{o.name}</span>
                </button>
              ))}
          </section>
        )}
      </div>
    </aside>
  );
}
```

`src/shell/ActivityRail.tsx` :

```tsx
import { Settings, Users } from "lucide-react";
import { useWorkspaceAgentCounts } from "@/fleet/agentCounts";
import { setAgentsPanel, useAgentsPanel } from "@/fleet/agentsPanel";
import { ToolButton } from "./buttons";
import { SettingsMenu } from "./SettingsMenu";

/** The rail on the right: the activities (spec identité §5.5). "Fonctions" comes with J8. */
export function ActivityRail() {
  const open = useAgentsPanel((s) => s.open);
  const { waiting } = useWorkspaceAgentCounts();
  return (
    <nav className="ov-glass absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-[14px] p-[5px]">
      <ToolButton label="Agents" active={open} onClick={() => setAgentsPanel(!open)}>
        <Users />
        {waiting > 0 && (
          <span
            data-pip
            className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-ov-wait px-1 font-mono text-[9.5px] font-semibold leading-3.5 text-ov-on-role"
          >
            {waiting}
          </span>
        )}
      </ToolButton>
      <span aria-hidden className="my-1 h-px w-6 bg-ov-line" />
      <SettingsMenu
        side="left"
        align="start"
        trigger={
          <ToolButton label="Réglages">
            <Settings />
          </ToolButton>
        }
      />
    </nav>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/fleet/AgentsPanel.test.tsx src/shell/ActivityRail.test.tsx src/fleet/fleetView.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
rm -f *.stackdump
git add src/fleet/quickActions.ts src/fleet/AgentsPanel.tsx src/fleet/AgentsPanel.test.tsx src/shell/ActivityRail.tsx src/shell/ActivityRail.test.tsx src/fleet/AgentMenu.tsx src/fleet/ComposeGroup.tsx src/shell/SettingsMenu.tsx src/fleet/fleetView.ts src/fleet/fleetView.test.ts src/shell/ActionChips.tsx src/shell/ProjectView.tsx src/shell/TopBar.tsx
git commit -m "feat(fleet): floating agents panel and activity rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Le rail d'outils et le panneau de propriétés

**Files:**
- Create: `src/shell/ToolRail.tsx`, `src/shell/ToolRail.test.tsx`
- Modify: `src/shell/tools.ts`, `src/shell/tools.test.ts` (outil Main)
- Modify: `src/shell/ShapesMenu.tsx`, `src/shell/PenMenu.tsx` (`ToolButton`)
- Modify: `src/theme/excalidraw.css` (panneau de propriétés)
- Modify: `src/theme/structure.test.ts` (panneau de propriétés)

**Interfaces:**
- Consumes: `ToolButton` (tâche 1) ; `AgentMenu({ trigger, side })` (tâche 4) ; `canvasStore`, `useCanvas`.
- Produces: `ToolRail()` ; `RailTool` inclut `"hand"`.

- [ ] **Step 1: Write the failing tests**

`src/shell/ToolRail.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { ToolRail } from "./ToolRail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => mockIPC(() => undefined));
afterEach(() => clearMocks());

it("offers the canvas tools in the spec's order, the hand included (spec identité §5.4)", async () => {
  const setActiveTool = vi.fn();
  canvasStore.setState({ api: { setActiveTool } as unknown as ExcalidrawImperativeAPI });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ToolRail />));
  const labels = [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Sélection (V)", "Main (H)", "Formes", "Texte (T)", "Stylo (P)", "Gomme (E)", "Image", "Lancer un agent", "Ajuster la vue"]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Main (H)"]')!.click());
  expect(setActiveTool).toHaveBeenCalledWith({ type: "hand" });
  await act(async () => root.unmount());
  host.remove();
});
```

`src/shell/tools.test.ts` — dans `railToolOf`, `expect(railToolOf("hand")).toBeNull();` devient `expect(railToolOf("hand")).toBe("hand");`.

`src/theme/structure.test.ts` — ajouter :

```ts
it("docks Excalidraw's properties panel in glass, right of the tool rail (spec identité §5.7)", () => {
  const excalidraw = readSource("theme/excalidraw.css");
  expect(excalidraw).toMatch(/\.excalidraw \.App-menu__left \{[^}]*left: 70px;[^}]*var\(--ov-glass-strong\)[^}]*var\(--ov-blur\)[^}]*border-radius: 14px/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/shell/ToolRail.test.tsx src/shell/tools.test.ts src/theme/structure.test.ts`
Expected: FAIL — `./ToolRail` introuvable ; `railToolOf("hand")` vaut `null` ; panneau à `left: 76px`.

- [ ] **Step 3: Write the rail**

`src/shell/tools.ts` — `RailTool` et `railToolOf` :

```ts
export type RailTool = "selection" | "hand" | "shapes" | "text" | "pen" | "eraser" | "image";
```

```ts
    case "hand":
      return "hand";
```

(ajouté avant `case "rectangle":`.)

`src/shell/ShapesMenu.tsx` et `src/shell/PenMenu.tsx` — remplacer `RoundButton` (import `./ui`) par `ToolButton` (import `./buttons`), mêmes props.

`src/shell/ToolRail.tsx` :

```tsx
import { Eraser, Hand, Image as ImageIcon, Maximize, MousePointer2, Plus, Type } from "lucide-react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { AgentMenu } from "@/fleet/AgentMenu";
import { ToolButton } from "./buttons";
import { PenMenu } from "./PenMenu";
import { ShapesMenu } from "./ShapesMenu";
import { railToolOf, type ShapeTool } from "./tools";

type Tool = "selection" | "hand" | "text" | "eraser" | "image" | ShapeTool;

const setTool = (type: Tool) => canvasStore.getState().api?.setActiveTool({ type });

function fitAll() {
  const api = canvasStore.getState().api;
  const elements = api?.getSceneElements() ?? [];
  if (api && elements.length > 0) {
    api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
  }
}

const Separator = () => <span aria-hidden className="my-1 h-px w-6 bg-ov-line" />;

/**
 * The canvas tools, floating on the left (spec identité §5.4). They replace
 * Excalidraw's toolbar and follow its active tool, keyboard shortcuts included.
 */
export function ToolRail() {
  const tool = useCanvas((s) => s.view.tool);
  const active = railToolOf(tool);
  return (
    <nav className="ov-glass absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-[14px] p-[5px]">
      <ToolButton label="Sélection (V)" active={active === "selection"} onClick={() => setTool("selection")}>
        <MousePointer2 />
      </ToolButton>
      <ToolButton label="Main (H)" active={active === "hand"} onClick={() => setTool("hand")}>
        <Hand />
      </ToolButton>
      <ShapesMenu active={active === "shapes"} current={tool} onPick={setTool} />
      <ToolButton label="Texte (T)" active={active === "text"} onClick={() => setTool("text")}>
        <Type />
      </ToolButton>
      <PenMenu active={active === "pen"} />
      <ToolButton label="Gomme (E)" active={active === "eraser"} onClick={() => setTool("eraser")}>
        <Eraser />
      </ToolButton>
      <ToolButton label="Image" active={active === "image"} onClick={() => setTool("image")}>
        <ImageIcon />
      </ToolButton>
      <Separator />
      <AgentMenu
        trigger={(open) => (
          <ToolButton label="Lancer un agent" active={open} className={open ? undefined : "text-ov-accent"}>
            <Plus />
          </ToolButton>
        )}
      />
      <Separator />
      <ToolButton label="Ajuster la vue" onClick={fitAll}>
        <Maximize />
      </ToolButton>
    </nav>
  );
}
```

`src/theme/excalidraw.css` — le panneau de propriétés, dans le bloc `.excalidraw .App-menu__left` :

```css
.excalidraw .App-menu__left {
  position: fixed;
  left: 70px;
  top: 50%;
  transform: translateY(-50%);
  width: 232px;
  max-height: calc(100vh - 160px) !important;
  padding: 12px !important;
  background: var(--ov-glass-strong);
  backdrop-filter: var(--ov-blur);
  -webkit-backdrop-filter: var(--ov-blur);
  border: 1px solid var(--ov-glass-line);
  border-radius: 14px;
  box-shadow: var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-shadow);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/shell/ToolRail.test.tsx src/shell/tools.test.ts src/theme/structure.test.ts`, puis `pnpm test`, `pnpm exec tsc --noEmit`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/shell/ToolRail.tsx src/shell/ToolRail.test.tsx src/shell/tools.ts src/shell/tools.test.ts src/shell/ShapesMenu.tsx src/shell/PenMenu.tsx src/theme/excalidraw.css src/theme/structure.test.ts
git commit -m "feat(shell): floating tool rail with the hand, glass properties panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Le bas de l'écran, les toasts et les bandeaux

**Files:**
- Modify: `src/shell/CommandBar.tsx` (barre et indice)
- Modify: `src/fleet/CommandInput.tsx:199-212` (bouton Envoyer)
- Modify: `src/shell/GitChip.tsx`, `src/shell/ZoomControl.tsx`
- Modify: `src/shell/AppToaster.tsx`, `src/shell/AppToaster.test.tsx`
- Modify: `src/fleet/ResumeAllToast.tsx`
- Modify: `src/fleet/LinkMode.tsx:51`, `src/fleet/PlacementGhost.tsx:61`
- Modify: `src/theme/structure.test.ts`

**Interfaces:**
- Consumes: `IconButton`, `TOP_ROW_HEIGHT` (tâche 1).
- Produces: `TOAST_BOTTOM = 58` (`src/shell/AppToaster.tsx`).

- [ ] **Step 1: Write the failing tests**

`src/shell/AppToaster.test.tsx` — le test « starts the toasts shown at the top below the top row… » est remplacé par :

```tsx
it("keeps every toast in the bottom-right corner, above the zoom control (spec identité §5.8)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast.custom(() => <div>Reprendre toutes les conversations ?</div>, { duration: Infinity });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const toaster = host.querySelector<HTMLElement>('[data-sonner-toaster][data-y-position="bottom"][data-x-position="right"]');
  expect(toaster).not.toBeNull();
  expect(parseFloat(toaster!.style.getPropertyValue("--offset-bottom"))).toBe(TOAST_BOTTOM);
  expect(TOAST_BOTTOM).toBeGreaterThanOrEqual(14 + 32 + 12);
  await act(async () => root.unmount());
  host.remove();
});
```

(importer `TOAST_BOTTOM` depuis `./AppToaster` ; supprimer l'import de `TOP_ROW_HEIGHT` s'il n'est plus utilisé.)

`src/theme/structure.test.ts` — ajouter :

```ts
it("leaves nothing at the top of the canvas but the bars: no top toast, no banner under the tabs", () => {
  const sources = sourceFiles();
  for (const [file, text] of Object.entries(sources)) {
    expect(/position: "top-right"/.test(text), `${file} : toast en haut`).toBe(false);
    expect(/\btop-16\b/.test(text), `${file} : bandeau à 64 px, sous les onglets`).toBe(false);
  }
});

it("draws the bottom row and its command bar in glass (spec identité §5.8)", () => {
  for (const file of ["shell/CommandBar.tsx", "shell/GitChip.tsx", "shell/ZoomControl.tsx"]) {
    expect(readSource(file), file).toMatch(/ov-glass\b/);
  }
  expect(readSource("shell/CommandBar.tsx")).toContain("w-[680px]");
  expect(readSource("fleet/CommandInput.tsx")).toContain("rounded-[10px]");
});
```

(importer `sourceFiles` depuis `./cssBlocks`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/shell/AppToaster.test.tsx src/theme/structure.test.ts`
Expected: FAIL — `TOAST_BOTTOM` non exporté ; `top-right` dans `ResumeAllToast.tsx`, `top-16` dans `LinkMode.tsx` et `PlacementGhost.tsx` ; pas de verre en bas.

- [ ] **Step 3: Write the bottom row**

`src/shell/AppToaster.tsx` (fichier complet) :

```tsx
import { useTheme } from "@/app/theme";
import { Toaster } from "@/components/ui/sonner";

/** Toasts sit above the zoom control: 14 px margin, 32 px control, 12 px gap (spec identité §5.8). */
export const TOAST_BOTTOM = 58;

/** The app's toasts, in the app's theme, all in the bottom-right corner. */
export function AppToaster() {
  const theme = useTheme();
  return <Toaster theme={theme} position="bottom-right" offset={{ bottom: TOAST_BOTTOM, right: 12 }} />;
}
```

`src/fleet/ResumeAllToast.tsx` — supprimer `position: "top-right",` des options de `toast.custom` ; le conteneur et les boutons :

```tsx
    <div className="ov-glass-strong flex w-[360px] items-start gap-3 rounded-[14px] p-3 text-ov-text">
```

```tsx
          <button type="button" className="h-7 rounded-[8px] bg-ov-accent px-3 text-xs font-semibold text-ov-on-accent" onClick={resumeAll}>
            Oui
          </button>
          <button type="button" className="h-7 rounded-[8px] bg-ov-field px-3 text-xs text-ov-text" onClick={answer}>
            Non
          </button>
```

`src/fleet/LinkMode.tsx` et `src/fleet/PlacementGhost.tsx` — le bandeau d'aide passe sous les onglets, en verre (importer `TOP_ROW_HEIGHT` depuis `@/shell/layout`) :

```tsx
      <div
        className="ov-glass-strong pointer-events-none fixed left-1/2 -translate-x-1/2 rounded-[10px] px-3 py-1 text-xs text-ov-text-2"
        style={{ top: TOP_ROW_HEIGHT + 14 }}
      >
```

`src/shell/CommandBar.tsx` — la barre :

```tsx
    <div className="ov-glass pointer-events-auto flex min-h-[46px] w-[680px] max-w-[calc(100vw-360px)] items-end gap-3 rounded-[16px] py-[7px] pl-3.5 pr-[7px]">
```

et l'indice :

```tsx
    <div className="ov-glass-strong pointer-events-auto flex items-center gap-2 rounded-[10px] py-1 pl-3 pr-1 text-xs text-ov-text-2">
```

(son bouton ×, `rounded-[6px]` au lieu de `rounded-full`.)

`src/fleet/CommandInput.tsx` — le bouton Envoyer : étiqueté dans la barre, icône seule dans l'orchestrateur :

```tsx
      <button
        type="button"
        aria-label="Envoyer"
        title={canSend ? "Envoyer" : nothingTargeted ? emptyHint : "Écris une consigne"}
        disabled={!canSend}
        onClick={send}
        className={cn(
          "flex shrink-0 items-center justify-center gap-1.5 font-semibold",
          compact ? "size-7 rounded-[8px]" : "h-8 rounded-[10px] px-3 text-[12.5px]",
          canSend ? "bg-ov-accent text-ov-on-accent" : "bg-ov-field text-ov-text-3",
        )}
      >
        <ArrowUp className="size-4" />
        {!compact && "Envoyer"}
      </button>
```

`src/shell/GitChip.tsx` — `if (!status) return null;` et le conteneur :

```tsx
    <div title={path} className="ov-glass pointer-events-auto flex h-8 items-center gap-1.5 rounded-[14px] px-2.5 font-mono text-[11.5px] text-ov-text-2">
      <GitBranch className="size-3.5" />
      {status.branch}
      {status.changed > 0 && <span className="text-ov-accent">{status.changed}</span>}
    </div>
```

`src/shell/ZoomControl.tsx` — remplacer `RoundButton` par `IconButton` (import `./buttons`), et le conteneur :

```tsx
    <div className="ov-glass pointer-events-auto flex h-8 items-center rounded-[14px] px-0.5">
```

(les deux boutons : `<IconButton label="Dézoomer" …>` et `<IconButton label="Zoomer" …>`, sans `className="size-7"`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/shell/AppToaster.test.tsx src/theme/structure.test.ts`, puis `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: PASS ; tout passe.

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add src/shell/CommandBar.tsx src/fleet/CommandInput.tsx src/shell/GitChip.tsx src/shell/ZoomControl.tsx src/shell/AppToaster.tsx src/shell/AppToaster.test.tsx src/fleet/ResumeAllToast.tsx src/fleet/LinkMode.tsx src/fleet/PlacementGhost.tsx src/theme/structure.test.ts
git commit -m "feat(shell): glass command bar, git chip and zoom; toasts bottom-right

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: L'assemblage, l'accueil et la fin de l'ancienne coquille

**Files:**
- Create: `src/shell/StatusScreen.tsx`, `src/shell/StatusScreen.test.tsx`
- Modify: `src/shell/ProjectView.tsx` (assemblage)
- Modify: `src/App.tsx`
- Modify: `src/home/HomeScreen.tsx`, `src/home/HomeScreen.test.tsx`, `src/home/ProjectCard.tsx`
- Modify: `src/app/boot.ts` (`loadAgentsPanel`)
- Modify: `src/store/ui.ts` (fin de `fleetOpen`)
- Modify: `src/shell/WindowControls.tsx` (fin de `WindowCorner`)
- Modify: `src/index.css` (fin de `.ov-chip`)
- Modify: `src/theme/structure.test.ts`
- Delete: `src/shell/TopBar.tsx`, `src/shell/DragStrip.tsx`, `src/shell/DragStrip.test.tsx`, `src/shell/LeftRail.tsx`, `src/shell/RightRail.tsx`, `src/shell/ActionChips.tsx`, `src/shell/LiveCount.tsx`, `src/shell/ui.tsx`, `src/fleet/FleetPanel.tsx`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `StatusScreen({ message }: { message: string })`.

- [ ] **Step 1: Write the failing tests**

`src/shell/StatusScreen.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { StatusScreen } from "./StatusScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockWindows("main");
  mockIPC((cmd) => (cmd === "plugin:window|is_maximized" ? false : undefined), { shouldMockEvents: true });
});
afterEach(() => clearMocks());

it("keeps the window movable and closable while loading or failing", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StatusScreen message="Chargement…" />));
  expect(host.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  expect(host.querySelector('[aria-label="Fermer dummyPlane"]')).not.toBeNull();
  expect(host.textContent).toContain("Chargement…");
  await act(async () => root.unmount());
  host.remove();
});
```

`src/home/HomeScreen.test.tsx` — l'accueil reçoit la barre de titre : ajouter `mockWindows("main")` et l'option `{ shouldMockEvents: true }` (avec la réponse `false` à `plugin:window|is_maximized`) au `mockIPC` du `beforeEach`, puis remplacer les deux tests par :

```tsx
it("puts the title bar on top and scrolls the projects under it, never into it (spec identité §5.9)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<HomeScreen />));
  const bar = host.querySelector("[data-tauri-drag-region]")!;
  expect(bar.querySelector("svg path")!.getAttribute("stroke")).toBe("#D97757");
  expect(bar.textContent).toContain("dummyPlane");
  const header = host.querySelector("header")!;
  expect(header.textContent).toContain("Projets");
  expect(header.textContent).toContain("Ajouter un projet");
  let scroller = header.parentElement;
  while (scroller && !scroller.className.includes("overflow-auto")) scroller = scroller.parentElement;
  expect(bar.compareDocumentPosition(scroller!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(scroller!.contains(bar)).toBe(false);
  expect(host.innerHTML).not.toContain("var(--ov-dot)");
  await act(async () => root.unmount());
  host.remove();
});
```

`src/theme/structure.test.ts` — ajouter :

```ts
it("keeps nothing of the habillage shell (spec identité §5.11)", () => {
  const files = sourceFiles();
  for (const gone of ["shell/TopBar.tsx", "shell/DragStrip.tsx", "shell/LeftRail.tsx", "shell/RightRail.tsx", "shell/ActionChips.tsx", "shell/LiveCount.tsx", "shell/ui.tsx", "fleet/FleetPanel.tsx"]) {
    expect(files[gone], gone).toBeUndefined();
  }
  for (const [file, text] of Object.entries(files)) {
    expect(/\bov-chip\b|PillButton|ChipButton|RoundButton|fleetOpen|WindowCorner/.test(text), file).toBe(false);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/shell/StatusScreen.test.tsx src/home/HomeScreen.test.tsx src/theme/structure.test.ts`
Expected: FAIL — `./StatusScreen` introuvable ; pas de barre de titre sur l'accueil ; anciens fichiers présents.

- [ ] **Step 3: Assemble**

`src/shell/StatusScreen.tsx` :

```tsx
import { TitleBar } from "./TitleBar";

/** Loading and error screens keep the title bar: the window stays movable and closable. */
export function StatusScreen({ message }: { message: string }) {
  return (
    <div className="ov-ambient flex h-screen flex-col">
      <TitleBar leading={<span className="text-[13px] font-semibold text-ov-text">dummyPlane</span>} />
      <div className="grid flex-1 place-items-center text-sm text-ov-text-2">{message}</div>
    </div>
  );
}
```

`src/App.tsx` (rendu complet) :

```tsx
  return (
    <>
      {view === "home" && <HomeScreen />}
      {view === "project" && <ProjectView />}
      {view === "loading" && <StatusScreen message="Chargement…" />}
      {view === "error" && <StatusScreen message={`Impossible de charger les projets : ${error}`} />}
      <AppToaster />
    </>
  );
```

(imports : supprimer `DragStrip` et `WindowCorner`, ajouter `StatusScreen` depuis `@/shell/StatusScreen`.)

`src/shell/ProjectView.tsx` (fichier complet) :

```tsx
import { useEffect } from "react";
import { Canvas } from "@/canvas/Canvas";
import { AgentsPanel } from "@/fleet/AgentsPanel";
import { useAgentsPanel } from "@/fleet/agentsPanel";
import { agentsStore } from "@/fleet/agentsStore";
import { LinkMode } from "@/fleet/LinkMode";
import { PlacementGhost } from "@/fleet/PlacementGhost";
import { useWorkspaces } from "@/store/workspaces";
import { ActivityRail } from "./ActivityRail";
import { AgentCounts } from "./AgentCounts";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { CloseGroupDialog } from "./CloseGroupDialog";
import { CommandBar, CommandHint } from "./CommandBar";
import { GitChip } from "./GitChip";
import { ProjectPicker } from "./ProjectPicker";
import { TitleBar } from "./TitleBar";
import { ToolRail } from "./ToolRail";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { ZoomControl } from "./ZoomControl";

/**
 * The open project (spec identité §5): the canvas fills the window, under the
 * glass bars; everything else floats on it.
 */
export function ProjectView() {
  const status = useWorkspaces((s) => s.status);
  const error = useWorkspaces((s) => s.error);
  const activeId = useWorkspaces((s) => s.activeId);
  const panelOpen = useAgentsPanel((s) => s.open);

  useEffect(() => {
    void agentsStore.getState().load();
  }, []);

  return (
    <div className="ov-ambient relative h-screen w-screen overflow-hidden">
      {status === "ready" && activeId ? (
        <>
          <Canvas key={activeId} workspaceId={activeId} />
          <ToolRail />
          <ActivityRail />
          {panelOpen && <AgentsPanel />}
          <div className="absolute bottom-[14px] left-3 z-30">
            <GitChip />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-[14px] z-30 flex flex-col items-center gap-2">
            <CommandHint />
            <CommandBar />
          </div>
          <div className="absolute bottom-[14px] right-3 z-30">
            <ZoomControl />
          </div>
          <PlacementGhost />
          <LinkMode />
        </>
      ) : (
        <div className="grid h-full place-items-center text-sm text-ov-text-2">
          {status === "error" ? `Impossible de charger les workspaces : ${error}` : "Chargement…"}
        </div>
      )}
      <div className="absolute inset-x-0 top-0 z-30">
        <TitleBar leading={<ProjectPicker />} trailing={<AgentCounts />} />
        <WorkspaceTabs />
      </div>
      <CloseAgentDialog />
      <CloseGroupDialog />
    </div>
  );
}
```

`src/home/HomeScreen.tsx` — la racine, la barre de titre, le défilement sous elle, plus de grille de points :

```tsx
  return (
    <div className="ov-ambient flex h-screen w-screen flex-col">
      <TitleBar leading={<span className="text-[13px] font-semibold text-ov-text">dummyPlane</span>} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative mx-auto max-w-5xl px-8 pb-12 pt-8">
          <header className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-ov-text">Projets</h1>
            <AccentButton onClick={() => void addProject()}>
              <FolderPlus /> Ajouter un projet
            </AccentButton>
          </header>
```

(le reste — liste vide, grille de cartes — inchangé ; imports : supprimer `DotGridBackground`, `dotGrid`, `TOP_ROW_HEIGHT`, `Logo`, `PillButton` ; ajouter `TitleBar` depuis `@/shell/TitleBar` et `AccentButton` depuis `@/shell/buttons`.)

`src/home/ProjectCard.tsx` — la carte en verre :

```tsx
        "ov-glass-strong group rounded-[14px] p-4 transition-colors",
        openable && "cursor-pointer hover:border-ov-accent/60",
```

`src/app/boot.ts` — après `await loadThemeSettings();` : `await loadAgentsPanel();` (import depuis `@/fleet/agentsPanel`).

`src/store/ui.ts` — supprimer `fleetOpen` et `setFleetOpen` (interface et magasin).

`src/shell/WindowControls.tsx` — supprimer `WindowCorner`.

`src/index.css` — supprimer la règle `.ov-chip` et son commentaire.

Supprimer : `git rm src/shell/TopBar.tsx src/shell/DragStrip.tsx src/shell/DragStrip.test.tsx src/shell/LeftRail.tsx src/shell/RightRail.tsx src/shell/ActionChips.tsx src/shell/LiveCount.tsx src/shell/ui.tsx src/fleet/FleetPanel.tsx`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/shell/StatusScreen.test.tsx src/home/HomeScreen.test.tsx src/theme/structure.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe (tout import restant d'un fichier supprimé est une erreur de type : le corriger vers son remplaçant).

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add -A src
git commit -m "feat(shell): assemble the free-canvas shell, glass home, drop the habillage shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Vérification dans l'application et installateur

**Files:**
- Aucun (sauf correctif né d'un constat, avec son test d'abord rouge et une décision au journal).

**Interfaces:**
- Consumes: tâches 1 à 7.
- Produces: `src-tauri/target/release/bundle/nsis/dummyPlane_0.1.0_x64-setup.exe`.

- [ ] **Step 1: Check both themes on the probe profile**

L'application de développement fermée, forcer `ui.theme` à `"dark"` dans `%APPDATA%\dev.dummyplane.probe\dummyplane.db` (table `settings`, `value_json` `'"dark"'`), lancer `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'`, capturer par `PrintWindow` (sans focus ni souris) ; puis `"light"`, relancer, capturer ; remettre `"system"`.
Expected (comparer à la maquette v3) :
- barre de titre en verre : logo, projet ⌄, compteurs, boutons de fenêtre au coin ;
- onglets façon navigateur, actif avec filet d'accent ;
- canvas plein cadre sous les barres, halos ;
- rail gauche (outils, ＋), rail droit (Agents avec pastille si un agent attend, Réglages) ;
- panneau Agents ouvert (filtres, groupes, lignes), lisible dans les deux thèmes ;
- en bas : puce git, barre de consigne avec « Envoyer », zoom ; toast de reprise en bas à droite ;
- aucun reste des pastilles, puces ou rails en pilule.

- [ ] **Step 2: Build the installer**

Run : `pnpm tauri build > "$SCRATCH/d2-build.log" 2>&1` (en arrière-plan)
Expected : `Finished 1 bundle at: …\dummyPlane_0.1.0_x64-setup.exe` ; sous-système PE de `src-tauri/target/release/dummyplane.exe` : `2`.

- [ ] **Step 3: Hand over**

Donner à Mathieu l'installateur et ses vérifications (spec §10, R2) : déplacer la fenêtre par la barre de titre et le vide des onglets, double-clic pour agrandir ; boutons de fenêtre ; menu du projet (récents, Tous les projets, Fermer le projet) ; compteurs → panneau filtré ; panneau Agents (ouvrir, fermer, relancer l'application : il revient comme laissé ; filtres ; replier un groupe ; actions de la barre d'outils) ; rail gauche (chaque outil, Main, Formes, Stylo, ＋ et ses nouvelles entrées) ; Réglages depuis le rail droit ; barre de consigne et « Envoyer » ; menus et dialogues en verre ; l'accueil.
