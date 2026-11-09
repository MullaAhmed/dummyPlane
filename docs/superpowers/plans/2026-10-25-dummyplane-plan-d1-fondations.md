# dummyPlane — Plan D1 : fondations de l'identité (jalon R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dummyPlane prend sa propre identité de fond : thèmes Argile (sombre) et Ivoire (clair) suivant Windows, jetons de verre et halos, polices Inter et JetBrains Mono, logo onde, plus aucune trace de l'orbe ni de l'orange de Symvibe — la disposition actuelle restant en place jusqu'à R2.

**Architecture:** Les jetons des deux thèmes vivent dans `src/theme/tokens.css`, sélectionnés par `data-theme` sur `<html>` ; les anciens noms de jetons (`--ov-surface-2`, `--ov-card`…) deviennent des alias pour que les composants actuels se recolorent sans être réécrits (R2 et R3 les remplacent). `src/app/theme.ts` résout le thème (choix enregistré, mode de Windows), l'applique à la racine et le fournit à Excalidraw, aux toasts et aux couleurs du stylo. Le logo est un composant SVG ; l'icône est régénérée par `tauri icon`.

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind 4, Excalidraw 0.18.1 (figé), sonner 2.0.8, xterm 6, `@fontsource-variable/inter` 5.3.0, `@fontsource-variable/jetbrains-mono` 5.3.0, Vitest 5 (happy-dom, `@tauri-apps/api/mocks`), Tauri 2.12.

**Spec:** `docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md` (§4, §9, §10 R1, §11, §12). Maquette de référence : `.superpowers/brainstorm/maquette-dummyplane-v3.html`.

## Global Constraints

- Jetons, valeurs exactes de la spec §4.2 (tableau) ; rien d'autre que ces valeurs pour les jetons nommés.
- Verre : `backdrop-filter: blur(18px) saturate(150%)` ; sans transparence (`prefers-reduced-transparency: reduce` ou réglage Désactivés) : verres = `--ov-surface`, pas de flou (spec §4.2).
- Thème : réglage `ui.theme` = `system` (défaut) | `light` | `dark` ; `ui.transparency` = `on` (défaut) | `off` ; valeurs illisibles → défauts, sans message ; échec d'enregistrement → toast « Réglage non enregistré : <raison> », le choix s'applique quand même (spec §4.5, §9).
- Terminaux toujours sombres : corps et fond xterm `#1A1918` dans les deux thèmes (spec §3, §4.2).
- Polices : Inter (interface), JetBrains Mono (états, chiffres, raccourcis), Cascadia Code (terminaux, inchangée) ; dépendances à version exacte (spec §4.3, §13).
- Logo : tuile `#1A1918` rayon 14/64, onde `#D97757`, chemin `M10 36 C 18 14, 26 14, 32 32 S 46 50, 54 26`, trait 7, extrémités rondes (spec §4.1).
- Aucune marque, logo ni police d'Anthropic (spec §12).
- Interface en français ; code et commentaires en anglais ; Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; supprimer les `*.stackdump` avant chaque commit.
- Tests : `pnpm test` ; `pnpm exec tsc --noEmit` et `pnpm build` propres. Lancer un test ciblé : `pnpm exec vitest run <fichiers>`.
- Ne jamais lancer l'exécutable release ni l'installateur depuis la session ; la vérification dans l'application se fait sur le profil `dev.dummyplane.probe`, sans prendre la souris si Mathieu peut être sur le poste.

### Décisions du plan (portées à Mathieu à la remise)

1. **Formes** : la spec (§10, R1) cite « formes des éléments existants ». Les pastilles, rails, puces et la barre de commande actuels sont supprimés par R2 ; R1 ne les remodèle pas (travail jeté). R1 neutralise seulement la bordure dégradée des puces (`ov-chip`, propre à Symvibe).
2. **Verre** : R1 définit les jetons et les utilitaires `ov-glass`, `ov-glass-strong`, `ov-ambient` ; seuls les halos (`ov-ambient`) sont visibles en R1. Les éléments en verre arrivent avec R2 (spec §5).
3. **Thème de la fenêtre** : au lieu du thème Tauri de la fenêtre (spec §4.5), la racine reçoit `color-scheme` (barres de défilement, contrôles natifs du WebView). Forcer le thème Tauri changerait ce que WebView2 rapporte pour `prefers-color-scheme` et casserait le mode Système ; la fenêtre n'a plus d'éléments natifs visibles depuis J6.
4. **Alias** : les anciens noms de jetons restent, pointés sur les nouveaux, jusqu'à ce que R2 et R3 réécrivent les composants qui les lisent.

## Review Focus

1. Un réglage enregistré illisible ou corrompu (`ui.theme` = « bleu », nombre, absent ; lecture qui échoue) donne Système et transparence activée, sans erreur ni écran vide (tests : tâche 3, `readThemeChoice`, `readTransparency`, `loadThemeSettings`).
2. Windows passe de clair à sombre pendant que l'application tourne : en mode Système tout suit aussitôt (jetons, Excalidraw, toasts) ; en mode forcé rien ne bouge (tests : tâche 3 « follows Windows live », tâche 4 toasts).
3. Transparence coupée (Windows ou réglage) : chaque verre devient opaque et le flou disparaît, dans les deux thèmes (tests : tâche 1, règles de repli).
4. Un trait dessiné en sombre garde sa teinte en clair, et la pastille de couleur du stylo montre ce qui sera tracé dans le thème courant ; l'export PNG suit le thème (tests : tâche 5, `displayColorFor`, `sceneColorFor`, `exportBackground`).
5. Aucun reste de l'ancienne identité ne rend le thème clair illisible (fond `#322f28` sous un texte sombre, orange `#f4602e`, Geist, orbe) (tests : tâche 6, balayage des sources ; tâche 4, `StatusPill`).

---

## File Structure

- `src/theme/tokens.css` (réécrit) : jetons des deux thèmes, alias, repli sans transparence.
- `src/theme/cssBlocks.ts` (nouveau) : aide de test, lit les propriétés d'une règle CSS.
- `src/theme/tokens.test.ts` (nouveau) : contrat des jetons (spec §4.2).
- `src/index.css` : polices, correspondances Tailwind des nouveaux jetons, utilitaires `ov-glass`, `ov-glass-strong`, `ov-ambient`, fin de l'orbe, puce neutre.
- `src/theme/fonts.test.ts` (nouveau) : dépendances et déclarations de polices.
- `src/theme/excalidraw.css` : variables d'Excalidraw pour les deux thèmes, Inter.
- `src/app/theme.ts` (nouveau) et `src/app/theme.test.ts` : thème, transparence, réglages.
- `src/main.tsx`, `src/app/boot.ts`, `src/shell/SettingsMenu.tsx` : démarrage et choix du thème.
- `src/canvas/Canvas.tsx`, `src/shell/AppToaster.tsx`, `src/canvas/overlay/DotGrid.tsx`, `src/shell/ProjectView.tsx`, `src/home/HomeScreen.tsx` : thème et halos appliqués.
- `src/nodes/terminal/terminalTheme.ts` (nouveau), `registry.ts`, `StatusPill.tsx` : terminaux et badge d'état.
- `src/theme/sceneColors.ts`, `src/shell/tools.ts`, `src/shell/PenMenu.tsx`, `src/canvas/sceneDefaults.ts`, `src/shell/sceneFiles.ts`, `src/fleet/wires.ts` : couleurs du canvas selon le thème.
- `src/shell/Logo.tsx` (nouveau), `src/shell/CommandBar.tsx`, `src/nodes/orchestrator/OrchestratorNode.tsx` : logo, fin de l'orbe.
- `src/theme/identity.test.ts` (nouveau) : balayage des restes de l'ancienne identité.
- `src-tauri/icons/source/wave.svg` (nouveau), icônes régénérées ; `orb.svg` supprimé.

---

### Task 1: Les jetons des deux thèmes

**Files:**
- Create: `src/theme/cssBlocks.ts`
- Create: `src/theme/tokens.test.ts`
- Modify: `src/theme/tokens.css` (réécrit)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: rien.
- Produces: jetons CSS `--ov-*` de la spec §4.2 sous `:root, :root[data-theme="dark"]` et `:root[data-theme="light"]` ; alias `--ov-surface-2`, `--ov-command`, `--ov-selected`, `--ov-working`, `--ov-waiting`, `--ov-idle`, `--ov-done`, `--ov-live` (bloc `:root`), `--ov-card`, `--ov-terminal-head` (par thème) ; `--ov-blur` ; classes `ov-glass`, `ov-glass-strong`, `ov-ambient` ; utilitaires Tailwind `bg-ov-field`, `text-ov-text-3`, `text-ov-on-accent`, `text-ov-wait`, `text-ov-ok`, `shadow-ov-float` ; `cssBlock(css: string, selector: string): Record<string, string>`.

- [ ] **Step 1: Write the test helper and the failing test**

`src/theme/cssBlocks.ts` :

```ts
/**
 * Test helper: the custom properties declared by the first CSS rule whose
 * selector list is exactly `selector`, e.g. `:root[data-theme="light"]`.
 */
export function cssBlock(css: string, selector: string): Record<string, string> {
  const head = css.indexOf(`${selector} {`);
  if (head < 0) throw new Error(`no rule "${selector}"`);
  const open = css.indexOf("{", head);
  const body = css.slice(open + 1, css.indexOf("}", open));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
```

`src/theme/tokens.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import index from "../index.css?raw";
import { cssBlock } from "./cssBlocks";
import tokens from "./tokens.css?raw";

// Spec identité §4.2, column by column.
const DARK: Record<string, string> = {
  "--ov-canvas": "#232220",
  "--ov-dot": "rgba(255,255,255,.07)",
  "--ov-surface": "#2B2A27",
  "--ov-field": "rgba(255,255,255,.05)",
  "--ov-line": "rgba(255,255,255,.09)",
  "--ov-hover": "rgba(255,255,255,.07)",
  "--ov-text": "#F5F4EF",
  "--ov-text-2": "#B3B0A8",
  "--ov-text-3": "#86837C",
  "--ov-accent": "#D97757",
  "--ov-accent-soft": "rgba(217,119,87,.18)",
  "--ov-on-accent": "#1F1E1D",
  "--ov-wait": "#D4A27F",
  "--ov-ok": "#8FA876",
  "--ov-danger": "#E5534B",
  "--ov-terminal": "#1A1918",
  "--ov-glass": "rgba(40,39,36,.52)",
  "--ov-glass-strong": "rgba(42,41,38,.84)",
  "--ov-glass-line": "rgba(255,255,255,.10)",
  "--ov-glass-hi": "inset 0 1px 0 rgba(255,255,255,.07)",
  "--ov-glass-edge": "0 0 0 1px rgba(0,0,0,.28)",
  "--ov-tray": "rgba(255,255,255,.028)",
  "--ov-head": "rgba(32,31,29,.70)",
  "--ov-tab-on": "rgba(255,255,255,.08)",
  "--ov-glow-1": "rgba(217,119,87,.16)",
  "--ov-glow-2": "rgba(143,168,118,.12)",
  "--ov-glow-3": "rgba(106,155,204,.08)",
  "--ov-shadow": "0 12px 40px rgba(0,0,0,.45)",
  "--ov-float-shadow": "0 8px 28px rgba(0,0,0,.32)",
  "--ov-draw": "#E8E5DD",
};
const LIGHT: Record<string, string> = {
  "--ov-canvas": "#F7F5EF",
  "--ov-dot": "rgba(41,38,27,.10)",
  "--ov-surface": "#FFFFFF",
  "--ov-field": "rgba(255,255,255,.60)",
  "--ov-line": "rgba(41,38,27,.10)",
  "--ov-hover": "rgba(41,38,27,.06)",
  "--ov-text": "#29261B",
  "--ov-text-2": "#625F57",
  "--ov-text-3": "#8F8C83",
  "--ov-accent": "#C2603F",
  "--ov-accent-soft": "rgba(194,96,63,.13)",
  "--ov-on-accent": "#FFFFFF",
  "--ov-wait": "#B07D3A",
  "--ov-ok": "#5E7A43",
  "--ov-danger": "#C93C37",
  "--ov-terminal": "#1A1918",
  "--ov-glass": "rgba(255,255,255,.50)",
  "--ov-glass-strong": "rgba(252,251,248,.88)",
  "--ov-glass-line": "rgba(255,255,255,.80)",
  "--ov-glass-hi": "inset 0 1px 0 rgba(255,255,255,.90)",
  "--ov-glass-edge": "0 0 0 1px rgba(41,38,27,.08)",
  "--ov-tray": "rgba(255,255,255,.38)",
  "--ov-head": "rgba(255,255,255,.66)",
  "--ov-tab-on": "rgba(255,255,255,.88)",
  "--ov-glow-1": "rgba(217,119,87,.16)",
  "--ov-glow-2": "rgba(106,155,204,.14)",
  "--ov-glow-3": "rgba(143,168,118,.12)",
  "--ov-shadow": "0 12px 40px rgba(41,38,27,.16)",
  "--ov-float-shadow": "0 8px 28px rgba(41,38,27,.10)",
  "--ov-draw": "#29261B",
};
const OPAQUE = { "--ov-glass": "var(--ov-surface)", "--ov-glass-strong": "var(--ov-surface)", "--ov-head": "var(--ov-terminal-head)", "--ov-blur": "none" };

describe("design tokens (spec identité §4.2)", () => {
  it("defines every token of the dark theme, Argile, with the spec's value", () => {
    expect(cssBlock(tokens, ':root, :root[data-theme="dark"]')).toMatchObject(DARK);
  });

  it("defines every token of the light theme, Ivoire, with the spec's value", () => {
    expect(cssBlock(tokens, ':root[data-theme="light"]')).toMatchObject(LIGHT);
  });

  it("keeps the habillage names as aliases until R2 and R3 rebuild their components", () => {
    const shared = cssBlock(tokens, ":root");
    for (const alias of ["--ov-surface-2", "--ov-command", "--ov-selected", "--ov-working", "--ov-waiting", "--ov-idle", "--ov-done", "--ov-live"]) {
      expect(shared[alias], alias).toMatch(/^var\(--ov-/);
    }
    for (const themed of [':root, :root[data-theme="dark"]', ':root[data-theme="light"]']) {
      expect(cssBlock(tokens, themed)).toHaveProperty("--ov-card");
      expect(cssBlock(tokens, themed)).toHaveProperty("--ov-terminal-head");
    }
    expect(shared["--ov-blur"]).toBe("blur(18px) saturate(150%)");
  });

  it("turns every glass opaque without transparency, from Windows or from the setting", () => {
    expect(tokens).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(cssBlock(tokens, ':root[data-theme="dark"], :root[data-theme="light"]')).toMatchObject(OPAQUE);
    expect(cssBlock(tokens, ':root[data-theme][data-transparency="off"]')).toMatchObject(OPAQUE);
  });

  it("offers the glass and ambient utilities built on these tokens", () => {
    expect(index).toMatch(/\.ov-glass \{[^}]*var\(--ov-glass\)[^}]*var\(--ov-blur\)/);
    expect(index).toMatch(/\.ov-glass-strong \{[^}]*var\(--ov-glass-strong\)[^}]*var\(--ov-blur\)/);
    expect(index).toMatch(/\.ov-ambient \{[^}]*var\(--ov-glow-1\)[^}]*var\(--ov-glow-2\)[^}]*var\(--ov-glow-3\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/theme/tokens.test.ts`
Expected: FAIL — `no rule ":root, :root[data-theme="dark"]"` (le fichier actuel n'a qu'un bloc `:root` sombre) et absence des utilitaires.

- [ ] **Step 3: Write the tokens**

`src/theme/tokens.css` (fichier complet) :

```css
/* Design tokens (spec identité §4.2): Argile (dark) and Ivoire (light). The
   theme is written on <html data-theme> by src/app/theme.ts. */

/* Both themes. */
:root {
  --ov-blur: blur(18px) saturate(150%);
  /* Aliases of the habillage tokens: the components reading them are rebuilt
     by milestones R2 and R3, which drop these names. */
  --ov-surface-2: var(--ov-surface);
  --ov-command: var(--ov-surface);
  --ov-selected: var(--ov-accent-soft);
  --ov-working: var(--ov-accent);
  --ov-waiting: var(--ov-wait);
  --ov-idle: var(--ov-text-3);
  --ov-done: var(--ov-ok);
  --ov-live: var(--ov-ok);
}

:root, :root[data-theme="dark"] {
  color-scheme: dark;
  --ov-canvas: #232220;
  --ov-dot: rgba(255,255,255,.07);
  --ov-surface: #2B2A27;
  --ov-field: rgba(255,255,255,.05);
  --ov-line: rgba(255,255,255,.09);
  --ov-hover: rgba(255,255,255,.07);
  --ov-text: #F5F4EF;
  --ov-text-2: #B3B0A8;
  --ov-text-3: #86837C;
  --ov-accent: #D97757;
  --ov-accent-soft: rgba(217,119,87,.18);
  --ov-on-accent: #1F1E1D;
  --ov-wait: #D4A27F;
  --ov-ok: #8FA876;
  --ov-danger: #E5534B;
  --ov-terminal: #1A1918;
  --ov-glass: rgba(40,39,36,.52);
  --ov-glass-strong: rgba(42,41,38,.84);
  --ov-glass-line: rgba(255,255,255,.10);
  --ov-glass-hi: inset 0 1px 0 rgba(255,255,255,.07);
  --ov-glass-edge: 0 0 0 1px rgba(0,0,0,.28);
  --ov-tray: rgba(255,255,255,.028);
  --ov-head: rgba(32,31,29,.70);
  --ov-tab-on: rgba(255,255,255,.08);
  --ov-glow-1: rgba(217,119,87,.16);
  --ov-glow-2: rgba(143,168,118,.12);
  --ov-glow-3: rgba(106,155,204,.08);
  --ov-shadow: 0 12px 40px rgba(0,0,0,.45);
  --ov-float-shadow: 0 8px 28px rgba(0,0,0,.32);
  --ov-draw: #E8E5DD;
  --ov-card: #30302D;
  --ov-terminal-head: #232220;
}

:root[data-theme="light"] {
  color-scheme: light;
  --ov-canvas: #F7F5EF;
  --ov-dot: rgba(41,38,27,.10);
  --ov-surface: #FFFFFF;
  --ov-field: rgba(255,255,255,.60);
  --ov-line: rgba(41,38,27,.10);
  --ov-hover: rgba(41,38,27,.06);
  --ov-text: #29261B;
  --ov-text-2: #625F57;
  --ov-text-3: #8F8C83;
  --ov-accent: #C2603F;
  --ov-accent-soft: rgba(194,96,63,.13);
  --ov-on-accent: #FFFFFF;
  --ov-wait: #B07D3A;
  --ov-ok: #5E7A43;
  --ov-danger: #C93C37;
  --ov-terminal: #1A1918;
  --ov-glass: rgba(255,255,255,.50);
  --ov-glass-strong: rgba(252,251,248,.88);
  --ov-glass-line: rgba(255,255,255,.80);
  --ov-glass-hi: inset 0 1px 0 rgba(255,255,255,.90);
  --ov-glass-edge: 0 0 0 1px rgba(41,38,27,.08);
  --ov-tray: rgba(255,255,255,.38);
  --ov-head: rgba(255,255,255,.66);
  --ov-tab-on: rgba(255,255,255,.88);
  --ov-glow-1: rgba(217,119,87,.16);
  --ov-glow-2: rgba(106,155,204,.14);
  --ov-glow-3: rgba(143,168,118,.12);
  --ov-shadow: 0 12px 40px rgba(41,38,27,.16);
  --ov-float-shadow: 0 8px 28px rgba(41,38,27,.10);
  --ov-draw: #29261B;
  --ov-card: #F5F3EC;
  --ov-terminal-head: #F0EEE6;
}

/* Without transparency (spec identité §4.2): Windows' setting… */
@media (prefers-reduced-transparency: reduce) {
  :root[data-theme="dark"], :root[data-theme="light"] {
    --ov-glass: var(--ov-surface);
    --ov-glass-strong: var(--ov-surface);
    --ov-head: var(--ov-terminal-head);
    --ov-blur: none;
  }
}

/* …or dummyPlane's (Réglages › Effets de transparence). */
:root[data-theme][data-transparency="off"] {
  --ov-glass: var(--ov-surface);
  --ov-glass-strong: var(--ov-surface);
  --ov-head: var(--ov-terminal-head);
  --ov-blur: none;
}
```

`src/index.css` — dans `@theme inline`, après `--color-ov-live: var(--ov-live);`, ajouter :

```css
  --color-ov-field: var(--ov-field);
  --color-ov-text-3: var(--ov-text-3);
  --color-ov-on-accent: var(--ov-on-accent);
  --color-ov-wait: var(--ov-wait);
  --color-ov-ok: var(--ov-ok);
  --shadow-ov-float: var(--ov-float-shadow);
```

Dans le bloc `:root` des variables shadcn, remplacer les deux `#ffffff` :

```css
  --primary-foreground: var(--ov-on-accent);
```

```css
  --sidebar-primary-foreground: var(--ov-on-accent);
```

Dans `@layer components`, avant `.ov-chip`, ajouter :

```css
  /* Glass (spec identité §4.2): light glass for rails and floating bars… */
  .ov-glass {
    background: var(--ov-glass);
    backdrop-filter: var(--ov-blur);
    -webkit-backdrop-filter: var(--ov-blur);
    border: 1px solid var(--ov-glass-line);
    box-shadow: var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-float-shadow);
  }

  /* …dense glass for everything that carries text. */
  .ov-glass-strong {
    background: var(--ov-glass-strong);
    backdrop-filter: var(--ov-blur);
    -webkit-backdrop-filter: var(--ov-blur);
    border: 1px solid var(--ov-glass-line);
    box-shadow: var(--ov-glass-hi), var(--ov-glass-edge), var(--ov-float-shadow);
  }

  /* The canvas color and three soft lights, fixed to the screen, that give
     the glass something to blur (spec identité §4.2). */
  .ov-ambient {
    background-color: var(--ov-canvas);
    background-image:
      radial-gradient(760px 520px at 16% 28%, var(--ov-glow-1), transparent 70%),
      radial-gradient(720px 560px at 86% 84%, var(--ov-glow-2), transparent 70%),
      radial-gradient(520px 420px at 62% 12%, var(--ov-glow-3), transparent 70%);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/theme/tokens.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite and the type check**

Run: `pnpm test` puis `pnpm exec tsc --noEmit`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/theme/cssBlocks.ts src/theme/tokens.test.ts src/theme/tokens.css src/index.css
git commit -m "feat(theme): Argile and Ivoire tokens, glass and ambient utilities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Inter et JetBrains Mono

**Files:**
- Create: `src/theme/fonts.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (par pnpm)
- Modify: `src/index.css`
- Modify: `src/theme/excalidraw.css`

**Interfaces:**
- Consumes: rien.
- Produces: familles `"Inter Variable"` (`font-sans`) et `"JetBrains Mono Variable"` (`font-mono`).

- [ ] **Step 1: Write the failing test**

`src/theme/fonts.test.ts` :

```ts
import { expect, it } from "vitest";
import pkg from "../../package.json";
import index from "../index.css?raw";
import excalidraw from "./excalidraw.css?raw";

const deps: Record<string, string> = pkg.dependencies;

it("bundles Inter and JetBrains Mono at exact versions, and no longer Geist (spec identité §4.3)", () => {
  expect(deps["@fontsource-variable/inter"]).toBe("5.3.0");
  expect(deps["@fontsource-variable/jetbrains-mono"]).toBe("5.3.0");
  expect(deps["@fontsource-variable/geist"]).toBeUndefined();
  expect(deps["@fontsource-variable/geist-mono"]).toBeUndefined();
});

it("sets them as the interface and mono fonts, Excalidraw's UI included", () => {
  expect(index).toContain('@import "@fontsource-variable/inter";');
  expect(index).toContain('@import "@fontsource-variable/jetbrains-mono";');
  expect(index).toContain('--font-sans: "Inter Variable", sans-serif;');
  expect(index).toContain('--font-mono: "JetBrains Mono Variable", ui-monospace, monospace;');
  expect(excalidraw).toContain('"Inter Variable"');
  expect(`${index}${excalidraw}`).not.toContain("Geist");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/theme/fonts.test.ts`
Expected: FAIL — `expected undefined to be '5.3.0'`.

- [ ] **Step 3: Swap the fonts**

Run: `pnpm remove @fontsource-variable/geist @fontsource-variable/geist-mono` puis `pnpm add -E @fontsource-variable/inter@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0`
Expected: `package.json` porte `"@fontsource-variable/inter": "5.3.0"` et `"@fontsource-variable/jetbrains-mono": "5.3.0"`.

`src/index.css` — remplacer les deux imports Geist :

```css
@import "@fontsource-variable/inter";
@import "@fontsource-variable/jetbrains-mono";
```

et dans `@theme inline` :

```css
  --font-sans: "Inter Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
```

`src/theme/excalidraw.css` — remplacer les deux `"Geist Variable", sans-serif` (variable `--ui-font` et noms des cadres) par `"Inter Variable", sans-serif`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/theme/fonts.test.ts`, puis `pnpm test`, `pnpm exec tsc --noEmit` et `pnpm build`
Expected: PASS ; build Vite terminé (les polices sont copiées dans `dist/assets`).

- [ ] **Step 5: Commit**

```bash
rm -f *.stackdump
git add package.json pnpm-lock.yaml src/theme/fonts.test.ts src/index.css src/theme/excalidraw.css
git commit -m "feat(theme): Inter and JetBrains Mono replace Geist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Le thème et ses réglages

**Files:**
- Create: `src/app/theme.ts`
- Create: `src/app/theme.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/app/boot.ts`
- Modify: `src/shell/SettingsMenu.tsx`

**Interfaces:**
- Consumes: `getSetting<T>(key)`, `setSetting(key, value)` de `@/ipc/db` (commandes `get_setting` `{ key }`, `set_setting` `{ key, value }`).
- Produces:
  - `type ThemeChoice = "system" | "light" | "dark"`, `type Theme = "light" | "dark"`, `THEME_KEY = "ui.theme"`, `TRANSPARENCY_KEY = "ui.transparency"` ;
  - `readThemeChoice(raw: unknown): ThemeChoice`, `readTransparency(raw: unknown): boolean`, `resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme` ;
  - `themeStore` (Zustand vanilla : `{ choice: ThemeChoice; systemDark: boolean; transparency: boolean }`), `currentTheme(): Theme`, `useTheme(): Theme`, `useThemeSettings(): { choice: ThemeChoice; transparency: boolean }` ;
  - `applyTheme(root?: HTMLElement): void`, `startTheme(media: SystemScheme): void`, `loadThemeSettings(): Promise<void>`, `setThemeChoice(choice: ThemeChoice): Promise<void>`, `setTransparency(on: boolean): Promise<void>` ;
  - `interface SystemScheme { matches: boolean; addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void }`.

- [ ] **Step 1: Write the failing tests**

`src/app/theme.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import {
  loadThemeSettings,
  readThemeChoice,
  readTransparency,
  resolveTheme,
  setThemeChoice,
  setTransparency,
  startTheme,
  themeStore,
  type SystemScheme,
} from "./theme";

class FakeScheme implements SystemScheme {
  private listeners: ((event: { matches: boolean }) => void)[] = [];
  constructor(public matches: boolean) {}
  addEventListener(_type: "change", listener: (event: { matches: boolean }) => void) {
    this.listeners.push(listener);
  }
  /** Windows switches between light and dark apps. */
  switch(dark: boolean) {
    this.matches = dark;
    for (const listener of this.listeners) listener({ matches: dark });
  }
}

const root = document.documentElement;

beforeEach(() => {
  themeStore.setState({ choice: "system", systemDark: true, transparency: true });
  delete root.dataset.theme;
  delete root.dataset.transparency;
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("resolveTheme", () => {
  it("follows Windows in System mode and ignores it when forced", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("reading the saved settings", () => {
  it("falls back to System for anything but light or dark", () => {
    expect(readThemeChoice("light")).toBe("light");
    expect(readThemeChoice("dark")).toBe("dark");
    expect(readThemeChoice("system")).toBe("system");
    for (const junk of ["bleu", 3, null, undefined, {}]) expect(readThemeChoice(junk)).toBe("system");
  });

  it("keeps transparency on unless it was turned off", () => {
    expect(readTransparency("off")).toBe(false);
    for (const value of ["on", null, 0, "OFF", undefined]) expect(readTransparency(value)).toBe(true);
  });
});

describe("startTheme", () => {
  it("follows Windows live in System mode: tokens and native controls", () => {
    const scheme = new FakeScheme(true);
    startTheme(scheme);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    scheme.switch(false);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("stays on a forced theme when Windows changes", () => {
    const scheme = new FakeScheme(false);
    startTheme(scheme);
    themeStore.setState({ choice: "dark" });
    scheme.switch(false);
    expect(root.dataset.theme).toBe("dark");
  });

  it("marks the root when transparency is off, and only then", () => {
    startTheme(new FakeScheme(true));
    themeStore.setState({ transparency: false });
    expect(root.dataset.transparency).toBe("off");
    themeStore.setState({ transparency: true });
    expect(root.dataset.transparency).toBeUndefined();
  });
});

describe("loadThemeSettings", () => {
  it("reads the saved choice and transparency", async () => {
    mockIPC((cmd, args) => {
      if (cmd !== "get_setting") return;
      return (args as { key: string }).key === "ui.theme" ? "light" : "off";
    });
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "light", transparency: false });
  });

  it("keeps the defaults, without error, when the settings are unreadable or cannot be read", async () => {
    mockIPC((cmd) => (cmd === "get_setting" ? 42 : undefined));
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "system", transparency: true });
    mockIPC(() => {
      throw new Error("base verrouillée");
    });
    await expect(loadThemeSettings()).resolves.toBeUndefined();
    expect(themeStore.getState()).toMatchObject({ choice: "system", transparency: true });
  });
});

describe("changing the settings", () => {
  it("applies at once and saves the choice", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
    });
    startTheme(new FakeScheme(true));
    await setThemeChoice("light");
    await setTransparency(false);
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.transparency).toBe("off");
    expect(saved).toEqual([
      { key: "ui.theme", value: "light" },
      { key: "ui.transparency", value: "off" },
    ]);
  });

  it("keeps the choice for the session and says so when it cannot be saved", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    mockIPC(() => {
      throw new Error("disque plein");
    });
    startTheme(new FakeScheme(true));
    await setThemeChoice("light");
    expect(root.dataset.theme).toBe("light");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Réglage non enregistré : .*disque plein/));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/app/theme.test.ts`
Expected: FAIL — `Failed to resolve import "./theme"`.

- [ ] **Step 3: Write the theme module**

`src/app/theme.ts` :

```ts
import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { getSetting, setSetting } from "@/ipc/db";

/** Spec identité §4.5. */
export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "ui.theme";
export const TRANSPARENCY_KEY = "ui.transparency";

/** Anything but light or dark (missing, corrupted) means System. */
export function readThemeChoice(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** Transparency stays on unless it was explicitly turned off. */
export function readTransparency(raw: unknown): boolean {
  return raw !== "off";
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice !== "system") return choice;
  return systemDark ? "dark" : "light";
}

interface ThemeState {
  choice: ThemeChoice;
  /** Windows' light or dark mode for apps, as the WebView reports it. */
  systemDark: boolean;
  transparency: boolean;
}

export const themeStore = createStore<ThemeState>()(() => ({ choice: "system", systemDark: true, transparency: true }));

export function currentTheme(): Theme {
  const { choice, systemDark } = themeStore.getState();
  return resolveTheme(choice, systemDark);
}

export function useTheme(): Theme {
  return useStore(themeStore, (s) => resolveTheme(s.choice, s.systemDark));
}

export function useThemeSettings(): { choice: ThemeChoice; transparency: boolean } {
  return useStore(themeStore, useShallow((s) => ({ choice: s.choice, transparency: s.transparency })));
}

/**
 * The theme on the root element: the tokens (`data-theme`), the WebView's own
 * scrollbars and form controls (`color-scheme`), the opaque fallback
 * (`data-transparency`). The window's Tauri theme is left alone: forcing it
 * would change what the WebView reports for `prefers-color-scheme`.
 */
export function applyTheme(root: HTMLElement = document.documentElement) {
  const { transparency } = themeStore.getState();
  const theme = currentTheme();
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (transparency) delete root.dataset.transparency;
  else root.dataset.transparency = "off";
}

/** Windows' color scheme, as `matchMedia("(prefers-color-scheme: dark)")` gives it. */
export interface SystemScheme {
  matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

/** Before the first render: follows Windows, live, until the saved choice is read. */
export function startTheme(scheme: SystemScheme) {
  themeStore.setState({ systemDark: scheme.matches });
  scheme.addEventListener("change", (event) => themeStore.setState({ systemDark: event.matches }));
  themeStore.subscribe(() => applyTheme());
  applyTheme();
}

/** At boot. Unreadable or unreachable settings keep the defaults, silently (spec identité §9). */
export async function loadThemeSettings() {
  try {
    const [choice, transparency] = await Promise.all([getSetting<unknown>(THEME_KEY), getSetting<unknown>(TRANSPARENCY_KEY)]);
    themeStore.setState({ choice: readThemeChoice(choice), transparency: readTransparency(transparency) });
  } catch (error) {
    console.warn(`theme settings: ${String(error)}`);
  }
}

async function save(key: string, value: string) {
  await setSetting(key, value).catch((error: unknown) => {
    toast.error(`Réglage non enregistré : ${String(error)}`);
  });
}

/** Applies at once; the choice stays for the session even if it cannot be saved. */
export async function setThemeChoice(choice: ThemeChoice) {
  themeStore.setState({ choice });
  await save(THEME_KEY, choice);
}

export async function setTransparency(on: boolean) {
  themeStore.setState({ transparency: on });
  await save(TRANSPARENCY_KEY, on ? "on" : "off");
}
```

`src/main.tsx` — démarrer le thème avant le premier rendu :

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startTheme } from "./app/theme";
import "./index.css";

startTheme(matchMedia("(prefers-color-scheme: dark)"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/app/boot.ts` — lire les réglages au tout début de `boot()` :

```ts
import { loadThemeSettings } from "./theme";
```

```ts
  booting ??= (async () => {
    await loadThemeSettings();
    await onPtyExit(({ nodeId, exitCode }) => {
```

`src/shell/SettingsMenu.tsx` — ajouter aux imports :

```tsx
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readThemeChoice, setThemeChoice, setTransparency, useThemeSettings } from "@/app/theme";
```

et, en tête du contenu du menu (avant « Exporter la scène… »), avec `const { choice, transparency } = useThemeSettings();` en tête du composant :

```tsx
        <DropdownMenuLabel className="ov-label">Thème</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(value) => void setThemeChoice(readThemeChoice(value))}>
          <DropdownMenuRadioItem value="system">Système</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Clair (Ivoire)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Sombre (Argile)</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuCheckboxItem checked={transparency} onCheckedChange={(on) => void setTransparency(on === true)}>
          Effets de transparence
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/app/theme.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the whole suite and the type check**

Run: `pnpm test` puis `pnpm exec tsc --noEmit`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/app/theme.ts src/app/theme.test.ts src/main.tsx src/app/boot.ts src/shell/SettingsMenu.tsx
git commit -m "feat(theme): System, light and dark themes, with a transparency switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Le thème partout

**Files:**
- Create: `src/nodes/terminal/terminalTheme.ts`
- Create: `src/nodes/terminal/terminalTheme.test.ts`
- Create: `src/canvas/overlay/DotGrid.test.tsx`
- Modify: `src/shell/AppToaster.test.tsx`
- Modify: `src/shell/AppToaster.tsx`
- Modify: `src/canvas/Canvas.tsx:147`
- Modify: `src/theme/excalidraw.css` (bloc des variables)
- Modify: `src/canvas/overlay/DotGrid.tsx:9`
- Modify: `src/shell/ProjectView.tsx:29`
- Modify: `src/home/HomeScreen.tsx`
- Modify: `src/nodes/terminal/registry.ts:60`
- Modify: `src/nodes/terminal/StatusPill.tsx:9-10`

**Interfaces:**
- Consumes: `useTheme(): Theme`, `themeStore` (tâche 3) ; `cssBlock` (tâche 1).
- Produces: `TERMINAL_THEME: { background: string; cursor: string; selectionBackground: string }`.

- [ ] **Step 1: Write the failing tests**

`src/shell/AppToaster.test.tsx` — ajouter l'import du magasin et un test :

```tsx
import { themeStore } from "@/app/theme";
```

```tsx
it("follows the app's theme, live", async () => {
  themeStore.setState({ choice: "light", systemDark: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast("Consigne envoyée");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const toaster = () => host.querySelector<HTMLElement>("[data-sonner-toaster]")!;
  expect(toaster().dataset.sonnerTheme).toBe("light");
  await act(async () => themeStore.setState({ choice: "dark" }));
  expect(toaster().dataset.sonnerTheme).toBe("dark");
  await act(async () => root.unmount());
  host.remove();
});
```

`src/nodes/terminal/terminalTheme.test.ts` :

```ts
import { expect, it } from "vitest";
import { cssBlock } from "@/theme/cssBlocks";
import tokens from "@/theme/tokens.css?raw";
import { TERMINAL_THEME } from "./terminalTheme";

it("draws xterm on the node's body color, dark in both themes (spec identité §4.2)", () => {
  for (const theme of [':root, :root[data-theme="dark"]', ':root[data-theme="light"]']) {
    expect(cssBlock(tokens, theme)["--ov-terminal"]).toBe(TERMINAL_THEME.background);
  }
  expect(TERMINAL_THEME).toEqual({ background: "#1A1918", cursor: "#D97757", selectionBackground: "#D9775755" });
});
```

`src/canvas/overlay/DotGrid.test.tsx` :

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { DotGridBackground } from "./DotGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("draws only the dots, so the ambient lights under it show through", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<DotGridBackground step={20} x={0} y={0} />));
  const grid = host.firstElementChild as HTMLElement;
  expect(grid.className).not.toMatch(/\bbg-/);
  expect(grid.style.backgroundImage).toContain("var(--ov-dot)");
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/shell/AppToaster.test.tsx src/nodes/terminal/terminalTheme.test.ts src/canvas/overlay/DotGrid.test.tsx`
Expected: FAIL — le toaster reste `dark` (thème figé) ; `./terminalTheme` introuvable ; la grille porte `bg-ov-canvas`.

- [ ] **Step 3: Apply the theme**

`src/nodes/terminal/terminalTheme.ts` :

```ts
/**
 * xterm's colors: terminals stay dark in both themes (spec identité §3), on the
 * node body's `--ov-terminal`, with the terracotta cursor.
 */
export const TERMINAL_THEME = { background: "#1A1918", cursor: "#D97757", selectionBackground: "#D9775755" };
```

`src/nodes/terminal/registry.ts` — importer `TERMINAL_THEME` depuis `./terminalTheme` et remplacer la ligne du thème :

```ts
    theme: { ...TERMINAL_THEME },
```

`src/nodes/terminal/StatusPill.tsx` — les deux tons sur fond fixe deviennent thémés :

```ts
  live: "bg-ov-card text-ov-text",
  ready: "bg-ov-card text-ov-text",
```

`src/shell/AppToaster.tsx` (fichier complet) :

```tsx
import { useTheme } from "@/app/theme";
import { Toaster } from "@/components/ui/sonner";
import { TOP_ROW_HEIGHT } from "./layout";

/**
 * The app's toasts, in the app's theme. Those shown at the top (the offer to
 * resume every conversation) start below the top row, never over the window
 * buttons (spec fenêtre §4.3); the other sides keep sonner's default offset.
 */
export function AppToaster() {
  const theme = useTheme();
  return <Toaster theme={theme} position="bottom-right" offset={{ top: TOP_ROW_HEIGHT + 8 }} />;
}
```

`src/canvas/Canvas.tsx` — importer `useTheme` depuis `@/app/theme`, lire `const theme = useTheme();` dans le composant `Canvas`, et passer à Excalidraw :

```tsx
          theme={theme}
```

`src/theme/excalidraw.css` — remplacer le bloc `.excalidraw.theme--dark { … }` par un bloc valable dans les deux thèmes (`:root` lui donne la priorité sur les règles d'Excalidraw, quel que soit l'ordre des feuilles) :

```css
/* Both themes: Excalidraw's own variables follow the dummyPlane tokens. */
:root .excalidraw.excalidraw {
  --color-selection: var(--ov-accent);
  --color-primary: var(--ov-accent);
  --color-primary-darker: color-mix(in srgb, var(--ov-accent) 85%, black);
  --color-primary-darkest: color-mix(in srgb, var(--ov-accent) 70%, black);
  --color-primary-light: var(--ov-accent-soft);
  --color-primary-light-darker: color-mix(in srgb, var(--ov-accent) 30%, transparent);
  --color-primary-hover: color-mix(in srgb, var(--ov-accent) 85%, white);
  --color-brand-hover: color-mix(in srgb, var(--ov-accent) 85%, white);
  --color-brand-active: color-mix(in srgb, var(--ov-accent) 85%, black);
  --color-surface-primary-container: var(--ov-accent-soft);
  --color-on-primary-container: var(--ov-text);
  --island-bg-color: var(--ov-surface);
  --popup-secondary-bg-color: var(--ov-card);
  --input-bg-color: var(--ov-card);
  --input-border-color: var(--ov-line);
  --input-hover-bg-color: var(--ov-hover);
  --button-gray-1: var(--ov-card);
  --button-gray-2: var(--ov-hover);
  --button-gray-3: color-mix(in srgb, var(--ov-text) 14%, transparent);
  --color-surface-high: var(--ov-hover);
  --color-surface-mid: var(--ov-card);
  --color-surface-low: var(--ov-surface);
  --color-surface-lowest: var(--ov-canvas);
  --color-on-surface: var(--ov-text);
  --color-border-outline: var(--ov-line);
  --color-border-outline-variant: var(--ov-line);
  --dialog-border-color: var(--ov-line);
  --overlay-bg-color: rgb(0 0 0 / 0.45);
  --shadow-island: var(--ov-shadow);
  --modal-shadow: var(--ov-shadow);
  --color-slider-track: var(--ov-line);
  --focus-highlight-color: var(--ov-accent-soft);
}
```

`src/canvas/overlay/DotGrid.tsx` — la grille ne peint plus que les points :

```tsx
      className="pointer-events-none absolute inset-0"
```

`src/shell/ProjectView.tsx` — la racine porte la couleur du canvas et les halos :

```tsx
    <div className="ov-ambient relative h-screen w-screen overflow-hidden">
```

`src/home/HomeScreen.tsx` — idem pour l'accueil :

```tsx
    <div className="ov-ambient relative h-screen w-screen">
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/shell/AppToaster.test.tsx src/nodes/terminal/terminalTheme.test.ts src/canvas/overlay/DotGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/nodes/terminal/terminalTheme.ts src/nodes/terminal/terminalTheme.test.ts src/canvas/overlay/DotGrid.test.tsx src/shell/AppToaster.test.tsx src/shell/AppToaster.tsx src/canvas/Canvas.tsx src/theme/excalidraw.css src/canvas/overlay/DotGrid.tsx src/shell/ProjectView.tsx src/home/HomeScreen.tsx src/nodes/terminal/registry.ts src/nodes/terminal/StatusPill.tsx
git commit -m "feat(theme): the canvas, Excalidraw, toasts and terminals follow the theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Les couleurs du canvas selon le thème

En sombre, Excalidraw dessine le canvas à travers `invert(93%) hue-rotate(180deg)` : la couleur affichée n'est pas la couleur enregistrée. En clair, il n'y a pas d'inversion. La palette du stylo est donc définie par les couleurs **enregistrées** (ce que l'on voit en clair) ; en sombre, elles gardent leur teinte avec une clarté inversée.

**Files:**
- Modify: `src/theme/sceneColors.ts`
- Modify: `src/theme/sceneColors.test.ts`
- Modify: `src/shell/tools.ts` (palette), `src/shell/tools.test.ts`
- Modify: `src/shell/PenMenu.tsx`
- Modify: `src/canvas/sceneDefaults.ts`, `src/canvas/sceneDefaults.test.ts`
- Modify: `src/shell/sceneFiles.ts`, `src/shell/SettingsMenu.tsx`
- Modify: `src/fleet/wires.ts:8`

**Interfaces:**
- Consumes: `type Theme`, `useTheme()`, `currentTheme()` (tâche 3).
- Produces: `displayColorFor(scene: string, theme: Theme): string`, `sceneColorFor(display: string, theme: Theme): string`, `exportBackground(theme: Theme): { exportWithDarkMode: boolean; viewBackgroundColor: string }` ; `PEN_COLORS: { label: string; scene: string }[]` ; `exportPng(api, name, theme: Theme)`.

- [ ] **Step 1: Write the failing tests**

`src/theme/sceneColors.test.ts` — ajouter :

```ts
import { displayColorFor, exportBackground, sceneColorFor } from "./sceneColors";
```

```ts
describe("colors in each theme", () => {
  it("shows a stored color as is in light, through Excalidraw's inversion in dark", () => {
    expect(displayColorFor("#C2603F", "light")).toBe("#C2603F");
    expect(displayColorFor("#C2603F", "dark")).toBe(toDisplayColor("#C2603F"));
  });

  it("stores what was picked as is in light, inverted back in dark", () => {
    expect(sceneColorFor("#3F74A8", "light")).toBe("#3F74A8");
    expect(sceneColorFor("#3F74A8", "dark")).toBe(toSceneColor("#3F74A8"));
  });

  it("exports a PNG in the theme on screen, on its canvas color", () => {
    expect(exportBackground("light")).toEqual({ exportWithDarkMode: false, viewBackgroundColor: "#F7F5EF" });
    expect(exportBackground("dark")).toEqual({ exportWithDarkMode: true, viewBackgroundColor: toSceneColor("#232220") });
  });
});
```

`src/shell/tools.test.ts` — remplacer le test des couleurs du stylo :

```ts
  it("offers eight pen colors, stored once for both themes, ink first", () => {
    expect(PEN_COLORS).toHaveLength(8);
    expect(PEN_COLORS[0]).toEqual({ label: "Encre", scene: "#29261B" });
    for (const { scene } of PEN_COLORS) expect(scene).toMatch(/^#[0-9A-F]{6}$/);
  });
```

`src/canvas/sceneDefaults.test.ts` — la valeur attendue du trait par défaut devient l'encre :

```ts
    expect(SCENE_DEFAULTS.currentItemStrokeColor).toBe("#29261B");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/theme/sceneColors.test.ts src/shell/tools.test.ts src/canvas/sceneDefaults.test.ts`
Expected: FAIL — `displayColorFor` n'est pas exporté ; `PEN_COLORS[0]` vaut `{ label: "Crème", display: "#EDE8DF" }` ; trait par défaut `#0b0500`.

- [ ] **Step 3: Write the implementation**

`src/theme/sceneColors.ts` — ajouter en fin de fichier :

```ts
import type { Theme } from "@/app/theme";

/** The color the canvas shows, in `theme`, for a stored element color. */
export function displayColorFor(sceneHex: string, theme: Theme): string {
  return theme === "dark" ? toDisplayColor(sceneHex) : sceneHex;
}

/** The color to store so that the canvas shows `displayHex` in `theme`. */
export function sceneColorFor(displayHex: string, theme: Theme): string {
  return theme === "dark" ? toSceneColor(displayHex) : displayHex;
}

/** A PNG export looks like the canvas on screen (spec identité §4.5). */
export function exportBackground(theme: Theme): { exportWithDarkMode: boolean; viewBackgroundColor: string } {
  return theme === "dark"
    ? { exportWithDarkMode: true, viewBackgroundColor: toSceneColor("#232220") }
    : { exportWithDarkMode: false, viewBackgroundColor: "#F7F5EF" };
}
```

(placer l'`import type` en tête du fichier, avec un commentaire d'une ligne au-dessus des trois fonctions si le fichier en a l'usage.)

`src/shell/tools.ts` — la palette, en couleurs enregistrées :

```ts
/**
 * Pen colors as stored (spec identité §4.2): what the light theme shows; the
 * dark theme shows the same hues with their lightness inverted.
 */
export const PEN_COLORS: { label: string; scene: string }[] = [
  { label: "Encre", scene: "#29261B" },
  { label: "Terre cuite", scene: "#C2603F" },
  { label: "Olive", scene: "#5E7A43" },
  { label: "Ocre", scene: "#B07D3A" },
  { label: "Rouge", scene: "#C93C37" },
  { label: "Ciel", scene: "#3F74A8" },
  { label: "Lavande", scene: "#7C66B0" },
  { label: "Ardoise", scene: "#625F57" },
];
```

`src/shell/PenMenu.tsx` — l'état garde la couleur enregistrée ; les pastilles montrent la couleur affichée dans le thème courant ; la couleur personnalisée est choisie telle qu'on la voit :

```tsx
import { useTheme } from "@/app/theme";
import { displayColorFor, sceneColorFor } from "@/theme/sceneColors";
```

```tsx
  const theme = useTheme();
  const [color, setColor] = useState(PEN_COLORS[0].scene);
```

```tsx
    api.updateScene({
      appState: { currentItemStrokeColor: nextColor, currentItemStrokeWidth: nextWidth },
    });
```

```tsx
          {PEN_COLORS.map(({ label, scene }) => (
            <button
              key={scene}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => choose({ color: scene })}
              className={cn(
                "size-6 rounded-full ring-offset-2 ring-offset-ov-surface-2",
                scene === color && "ring-2 ring-ov-accent",
              )}
              style={{ backgroundColor: displayColorFor(scene, theme) }}
            />
          ))}
```

```tsx
              onChange={(e) => choose({ color: sceneColorFor(e.target.value, theme) })}
```

`src/canvas/sceneDefaults.ts` — le trait par défaut est l'encre de la palette (supprimer l'import de `toSceneColor`) :

```ts
import { PEN_COLORS } from "@/shell/tools";
```

```ts
  currentItemStrokeColor: PEN_COLORS[0].scene,
```

`src/shell/sceneFiles.ts` — l'export PNG prend le thème :

```ts
import type { Theme } from "@/app/theme";
import { exportBackground } from "@/theme/sceneColors";
```

```ts
export async function exportPng(api: ExcalidrawImperativeAPI, name: string, theme: Theme) {
  const blob = await exportToBlob({
    elements: api.getSceneElements(),
    appState: { ...api.getAppState(), exportBackground: true, ...exportBackground(theme) },
    files: api.getFiles(),
    mimeType: "image/png",
  });
```

(supprimer l'import de `toSceneColor` s'il n'est plus utilisé.)

`src/shell/SettingsMenu.tsx` — passer le thème courant :

```tsx
import { currentTheme, readThemeChoice, setThemeChoice, setTransparency, useThemeSettings } from "@/app/theme";
```

```tsx
        <DropdownMenuItem onSelect={() => run((api) => exportPng(api, name, currentTheme()), "Export impossible")}>
```

`src/fleet/wires.ts` — la couleur des liaisons, enregistrée, devient la terre cuite :

```ts
export const WIRE_COLOR = "#C2603F";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/theme/sceneColors.test.ts src/shell/tools.test.ts src/canvas/sceneDefaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the type check**

Run: `pnpm test` puis `pnpm exec tsc --noEmit`
Expected: tout passe (corriger tout test qui lisait encore `display` dans `PEN_COLORS` ou `WIRE_COLOR` `#f4602e`, en lui donnant la nouvelle valeur).

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/theme/sceneColors.ts src/theme/sceneColors.test.ts src/shell/tools.ts src/shell/tools.test.ts src/shell/PenMenu.tsx src/canvas/sceneDefaults.ts src/canvas/sceneDefaults.test.ts src/shell/sceneFiles.ts src/shell/SettingsMenu.tsx src/fleet/wires.ts
git commit -m "feat(theme): pen colors, default stroke and PNG export in each theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Le logo onde, la fin de l'orbe

**Files:**
- Create: `src/shell/Logo.tsx`
- Create: `src/theme/identity.test.ts`
- Create: `src-tauri/icons/source/wave.svg`
- Delete: `src-tauri/icons/source/orb.svg`
- Modify: `src/home/HomeScreen.tsx` (orbe de l'en-tête)
- Modify: `src/shell/CommandBar.tsx:45` (orbe)
- Modify: `src/nodes/orchestrator/OrchestratorNode.tsx:54-56` (orbe, orange)
- Modify: `src/index.css` (règles `.ov-orb`, `.ov-orb-live`, `@keyframes ov-orb-spin`, `.ov-chip`)
- Modify (régénérés) : `src-tauri/icons/*`
- Modify: `src/home/HomeScreen.test.tsx`

**Interfaces:**
- Consumes: rien des autres tâches.
- Produces: `Logo({ size }: { size?: number })`.

- [ ] **Step 1: Write the failing tests**

`src/theme/identity.test.ts` :

```ts
import { expect, it } from "vitest";

// Every source file but the tests, as text.
const sources = import.meta.glob(["/src/**/*.{ts,tsx,css}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// What the habillage spec took from Symvibe (spec identité §5.11, §12).
const FORBIDDEN: [RegExp, string][] = [
  [/#f4602e/i, "l'orange de Symvibe"],
  [/#322f28/i, "le fond fixe des badges d'état"],
  [/#12110e/i, "l'ancien fond du canvas"],
  [/Geist/, "la police Geist"],
  [/ov-orb/, "l'orbe"],
  [/#4fc2c2/i, "la bordure dégradée des puces"],
];

it("keeps no trace of the habillage identity", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(50);
  for (const [file, text] of Object.entries(sources)) {
    for (const [pattern, what] of FORBIDDEN) expect(pattern.test(text), `${file} : ${what}`).toBe(false);
  }
});
```

`src/home/HomeScreen.test.tsx` — ajouter un test :

```tsx
it("shows the wave logo next to the name", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<HomeScreen />));
  const logo = host.querySelector("header svg")!;
  expect(logo.querySelector("path")!.getAttribute("d")).toBe("M10 36 C 18 14, 26 14, 32 32 S 46 50, 54 26");
  expect(logo.querySelector("path")!.getAttribute("stroke")).toBe("#D97757");
  await act(async () => root.unmount());
  host.remove();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/theme/identity.test.ts src/home/HomeScreen.test.tsx`
Expected: FAIL — `src/index.css : l'orbe` (et l'orange, la bordure dégradée, l'orbe de `CommandBar`, d'`OrchestratorNode`, de `HomeScreen`) ; pas de `svg` dans l'en-tête de l'accueil.

- [ ] **Step 3: Write the logo and remove the orb**

`src/shell/Logo.tsx` :

```tsx
/** dummyPlane's mark (spec identité §4.1): a terracotta wave on a slate tile. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="14" fill="#1A1918" />
      <path
        d="M10 36 C 18 14, 26 14, 32 32 S 46 50, 54 26"
        stroke="#D97757"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

`src/home/HomeScreen.tsx` — importer `Logo` depuis `@/shell/Logo` et remplacer `<span className="ov-orb size-8" aria-hidden />` par :

```tsx
              <Logo size={32} />
```

`src/shell/CommandBar.tsx` — l'invite remplace l'orbe :

```tsx
      <span className="mb-1.5 shrink-0 text-base font-bold text-ov-accent" aria-hidden>
        ›
      </span>
```

`src/nodes/orchestrator/OrchestratorNode.tsx` — ajouter `Network` à l'import de `lucide-react` ; le cadre prend l'accent du thème, l'icône réseau remplace l'orbe :

```tsx
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-ov-surface-2" style={frameStyle("var(--ov-accent)", selected, false)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-ov-line px-3">
        <Network className="size-4 shrink-0 text-ov-accent" />
```

`src/index.css` — supprimer les règles `.ov-orb`, `.ov-orb-live` et `@keyframes ov-orb-spin` (et leurs commentaires), et rendre la puce neutre jusqu'à sa suppression par R2 :

```css
  /* Chips of the bottom row, until R2 replaces them (spec identité §5.11). */
  .ov-chip {
    border: 1px solid var(--ov-line);
    background: var(--ov-surface);
  }
```

`src-tauri/icons/source/wave.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1A1918"/>
  <path d="M10 36 C 18 14, 26 14, 32 32 S 46 50, 54 26" stroke="#D97757" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>
```

Run: `git rm src-tauri/icons/source/orb.svg`, puis `pnpm tauri icon src-tauri/icons/source/wave.svg`, puis `rm -rf src-tauri/icons/android src-tauri/icons/ios`
Expected: icônes régénérées ; `git status --short src-tauri/icons` ne montre ni `android/` ni `ios/`.

- [ ] **Step 4: Run the tests to verify they pass, and look at the icon**

Run: `pnpm exec vitest run src/theme/identity.test.ts src/home/HomeScreen.test.tsx`
Expected: PASS.

Ouvrir `src-tauri/icons/128x128.png` et `32x32.png` (lecture d'image).
Expected: tuile ardoise arrondie, onde terre cuite ; coins transparents.

- [ ] **Step 5: Run the whole suite, the type check and the build**

Run: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
rm -f *.stackdump
git add src/shell/Logo.tsx src/theme/identity.test.ts src/home/HomeScreen.tsx src/home/HomeScreen.test.tsx src/shell/CommandBar.tsx src/nodes/orchestrator/OrchestratorNode.tsx src/index.css src-tauri/icons
git commit -m "feat(identity): the wave logo and icon replace the orange orb

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Vérification dans l'application et installateur

**Files:**
- Aucun (sauf correctif né d'un constat, avec son test d'abord rouge et une décision au journal).

**Interfaces:**
- Consumes: tâches 1 à 6.
- Produces: `src-tauri/target/release/bundle/nsis/dummyPlane_0.1.0_x64-setup.exe`.

- [ ] **Step 1: Force the light theme in the probe database**

L'application de développement doit être fermée. Avec Python :

```python
import os, sqlite3
db = os.path.expandvars(r"%APPDATA%\dev.dummyplane.probe\dummyplane.db")
con = sqlite3.connect(db)
con.execute("INSERT INTO settings(key, value_json) VALUES('ui.theme', '\"light\"') "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
con.commit()
con.close()
```

- [ ] **Step 2: Check the light theme**

Run (en arrière-plan) : `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'`, puis une capture de la fenêtre par `PrintWindow` (sans focus ni souris).
Expected : canvas ivoire avec halos doux, texte ardoise en Inter, accent terre cuite, dessins d'Excalidraw sombres sur clair, terminaux toujours sombres (fond `#1A1918`), badges d'état lisibles, aucune orbe (accueil, barre de commande, orchestrateur), logo onde sur l'accueil.

- [ ] **Step 3: Check the dark theme**

Fermer l'application (`WM_CLOSE`), remettre `ui.theme` à `"dark"` comme à l'étape 1, relancer et capturer.
Expected : canvas Argile `#232220` avec halos, texte crème, accent terre cuite, dessins clairs, mêmes terminaux. Fermer l'application, puis remettre `ui.theme` à `"system"`.

- [ ] **Step 4: Build the installer**

Run : `pnpm tauri build > "$SCRATCH/d1-build.log" 2>&1` (en arrière-plan)
Expected : `Finished 1 bundle at: …\dummyPlane_0.1.0_x64-setup.exe`. Contrôler le sous-système de `src-tauri/target/release/dummyplane.exe` (en-tête PE, comme au plan C1) : `2`.

- [ ] **Step 5: Hand over**

Donner à Mathieu le chemin de l'installateur et ses vérifications (spec §10, R1) : passer Windows en clair puis en sombre (Paramètres › Personnalisation › Couleurs) et voir l'application suivre ; Réglages › Thème force l'un ou l'autre ; Réglages › Effets de transparence ; transparence coupée dans Windows ; icône onde dans le menu Démarrer et la barre des tâches ; le stylo et sa palette dans les deux thèmes ; un export PNG dans chaque thème.
