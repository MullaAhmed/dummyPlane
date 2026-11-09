# dummyPlane — Plan 1 : socle, canvas et pont PTY (jalons 1 à 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une app Tauri 2 qui affiche un canvas Excalidraw multi-workspaces, un prototype go/no-go des nœuds intégrés, et un pont PTY Rust testé capable de lancer un vrai PowerShell (et donc `claude`) dans un nœud.

**Architecture:** Le front (React, zustand) possède le canvas et les workspaces, Excalidraw possède la géométrie, Rust possède les processus. La sortie des PTY passe en octets bruts par un `Channel` Tauri 2. Le jalon 2 se termine par une décision consignée dans la spec (§15) : on garde Excalidraw comme moteur (option A) ou on bascule sur l'option B. Le plan 2 (jalons 4 à 9) sera écrit après cette décision.

**Tech Stack:** Tauri 2 (≥ 2.5.1), Rust édition 2024, `portable-pty` 0.9.0, React 19, TypeScript ~6.0, Vite 8, Tailwind CSS 4.3.3, shadcn 4.22.1 (Radix, preset nova), `@excalidraw/excalidraw` 0.18.1, `@xterm/xterm` 6.0.0, zustand 5.0.16, Vitest 5.0.5 + happy-dom 21.0.4.

**Spec:** `docs/superpowers/specs/2026-10-23-dummyplane-v1-design.md`

## Global Constraints

- Plateforme cible : Windows 11 (machine de Mathieu : Node 22.13.1, pnpm 10.12.1, Rust nightly 1.94, Git for Windows, PowerShell 5.1, pas de `pwsh`).
- Tauri **2** (le crate `tauri` 3.0.0-alpha existe : ne pas l'utiliser). Le template fixe `tauri = "2"`.
- Gestionnaire de paquets : pnpm. Versions exactes à installer : celles de la ligne *Tech Stack*.
- **jsdom est interdit** pour les tests : jsdom 30 exige Node ≥ 22.22.2. Utiliser `happy-dom` (`// @vitest-environment happy-dom`).
- Code et commentaires en anglais ; textes de l'interface en français ; spec et docs en français.
- Le front ne contient aucun SQL. Toute commande Rust renvoie `Result<T, AppError>`, sérialisé en `{ kind, message }` avec `kind` ∈ `invalidInput | notFound | pty | io`.
- La sortie des PTY reste en **octets** de bout en bout (`Channel<tauri::ipc::Response>` → `ArrayBuffer`) ; ne jamais la décoder en chaîne morceau par morceau.
- ConPTY est créé par `portable-pty` avec `PSEUDOCONSOLE_INHERIT_CURSOR` : il envoie `ESC[6n` et attend la réponse avant de lancer le programme. Xterm.js répond tout seul ; les tests doivent répondre eux-mêmes (`ESC[1;1R`).
- Fenêtre principale : `dragDropEnabled: false`.
- Polices Excalidraw servies localement (`window.EXCALIDRAW_ASSET_PATH = "/"`, fichiers dans `public/fonts`, ignorés par git).
- Ne pas modifier de fichier texte avec `Get-Content`/`Set-Content` de PowerShell 5.1 : l'encodage casse les accents. Utiliser les outils d'édition de fichiers.
- Commits au format Conventional Commits, sur la branche `feat/dummyplane-v1`, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commandes de test : `pnpm test` (Vitest) et `cargo test --manifest-path src-tauri/Cargo.toml`.
- Des avertissements `dead_code` Rust sont attendus pendant les tâches 8 à 11 ; ils disparaissent à la tâche 12, quand les modules sont branchés.

## Review Focus

- **Dossier de travail avec espaces et accents** (`C:\Users\…\Mes projets é`) : le terminal doit démarrer dedans. Test : `runs_in_a_folder_with_spaces_and_accents` (tâche 11).
- **Caractère UTF-8 coupé entre deux lectures du PTY** (`é` = `0xC3 0xA9`) : les octets doivent arriver intacts à Xterm. Test : `keeps a UTF-8 sequence split across chunks as raw bytes` (tâche 12).
- **Conteneur caché ou replié** : `fit()` donne 0×0 ; le PTY doit recevoir au moins 1×1 au lieu d'une erreur. Test : `size_is_clamped_to_one_cell_when_the_host_is_hidden` (tâche 11).
- **Suppression du workspace actif ou du dernier workspace** : il reste toujours un workspace, et le voisin est sélectionné. Tests du store (tâche 5).
- **Titre de nœud avec apostrophes, guillemets ou `%`** passé à `claude -n` : la commande tapée ne doit ni casser ni étendre de variable, quel que soit le shell. Tests `quotes_for_*` (tâche 9).

---

## Jalon 1 — Socle

### Task 1 : Générer l'app Tauri 2 + React + TypeScript

**Files:**
- Create : tout le squelette du template `create-tauri-app` (`package.json`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `src/`, `src-tauri/`, `.gitignore`, `.vscode/`)
- Modify : `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `index.html`, `src/App.tsx`
- Delete : `src/App.css`, `src/assets/`, `public/tauri.svg`, `public/vite.svg`

**Interfaces:**
- Consumes : rien.
- Produces : une app qui compile ; fenêtre `main` ; identifiant `dev.dummyplane.app` ; crate lib `dummyplane_lib` avec `pub fn run()`.

- [ ] **Step 1 : Générer le template dans un dossier temporaire et le copier dans le dépôt**

Le dépôt n'est pas vide (README, docs) : on génère ailleurs puis on copie. Dans Git Bash, depuis la racine du dépôt :

```bash
T=$(mktemp -d)
(cd "$T" && pnpm dlx create-tauri-app@4.7.5 dummyplane --template react-ts --manager pnpm --identifier dev.dummyplane.app --tauri-version 2 --yes)
cp -r "$T/dummyplane/." .
git checkout -- README.md
rm -rf "$T" src/App.css src/assets public/tauri.svg public/vite.svg
```

Attendu : `git status` montre les nouveaux fichiers, et `README.md` n'est pas modifié.

- [ ] **Step 2 : Configurer la fenêtre**

Remplacer tout `src-tauri/tauri.conf.json` par :

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "dummyPlane",
  "version": "0.1.0",
  "identifier": "dev.dummyplane.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "dummyPlane",
        "width": 1440,
        "height": 900,
        "minWidth": 960,
        "minHeight": 600,
        "dragDropEnabled": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`dragDropEnabled: false` est obligatoire : sinon, sous Windows, Tauri capte tous les glisser-déposer et ceux du HTML ne fonctionnent plus (spec §6.1).

- [ ] **Step 3 : Renseigner le paquet Rust**

Dans `src-tauri/Cargo.toml`, remplacer les deux lignes `description = "A Tauri App"` et `authors = ["you"]` par :

```toml
description = "dummyPlane: a local-first canvas of real terminals for AI coding agents"
authors = ["Mathieu Kerbel"]
```

- [ ] **Step 4 : Remplacer la page et le composant de démo**

`index.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>dummyPlane</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/App.tsx` :

```tsx
export default function App() {
  return <h1>dummyPlane</h1>;
}
```

- [ ] **Step 5 : Installer et vérifier la compilation**

```bash
pnpm install
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Attendu : `pnpm build` se termine par `✓ built in …` ; `cargo check` se termine par `Finished`.

- [ ] **Step 6 : Vérifier l'app à la main**

Lancer `pnpm tauri dev`. Attendu : une fenêtre « dummyPlane » de 1440×900 affiche le titre dummyPlane. Fermer la fenêtre.

- [ ] **Step 7 : Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + React + TypeScript app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2 : Tailwind v4, shadcn/ui et thème sombre

**Files:**
- Create : `src/index.css`, `components.json`, `src/lib/utils.ts`, `src/components/ui/{button,input,dropdown-menu,sonner}.tsx` (générés par shadcn)
- Modify : `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `index.html`, `src/App.tsx`, `package.json`

**Interfaces:**
- Consumes : Task 1.
- Produces : alias d'import `@/…` → `src/…` ; composants `Button`, `Input`, `DropdownMenu*`, `Toaster` ; classe `dark` sur `<html>`.

- [ ] **Step 1 : Installer Tailwind et les types Node**

```bash
pnpm add tailwindcss@4.3.3 @tailwindcss/vite@4.3.3
pnpm add -D @types/node
```

- [ ] **Step 2 : Feuille de style et alias `@`**

`src/index.css` (shadcn la complétera à l'étape 4) :

```css
@import "tailwindcss";
```

Dans `tsconfig.json`, ajouter dans `compilerOptions` (sans `baseUrl`, déprécié en TypeScript 6) :

```json
    "paths": {
      "@/*": ["./src/*"]
    },
```

Remplacer tout `vite.config.ts` par :

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Tauri expects a fixed port and its own Rust errors left visible.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

Remplacer tout `src/main.tsx` par :

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3 : Initialiser shadcn**

```bash
pnpm dlx shadcn@4.22.1 init -b radix -p nova -y --no-monorepo
```

Sans `-p nova`, la commande attend un choix au clavier et bloque. Attendu : `Project initialization completed.`, un `components.json` (`"style": "radix-nova"`), `src/lib/utils.ts`, et `src/index.css` complété (variables de thème, bloc `.dark`).

- [ ] **Step 4 : Ajouter les composants utilisés par ce plan**

```bash
pnpm dlx shadcn@4.22.1 add button input dropdown-menu sonner -y
```

Attendu : les quatre fichiers dans `src/components/ui/`.

- [ ] **Step 5 : Activer le thème sombre et afficher un bouton**

Dans `index.html`, remplacer `<html lang="fr">` par `<html lang="fr" class="dark">`.

`src/App.tsx` :

```tsx
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

export default function App() {
  return (
    <div className="grid h-screen place-items-center">
      <Button>dummyPlane</Button>
      <Toaster theme="dark" />
    </div>
  );
}
```

Le `Toaster` généré par shadcn lit `next-themes` ; sans fournisseur de thème il retombe sur `system`. On force donc `theme="dark"` (la prop passée écrase la valeur lue).

- [ ] **Step 6 : Vérifier**

```bash
pnpm build
```

Attendu : succès. Puis `pnpm tauri dev` : fond sombre, bouton clair centré.

- [ ] **Step 7 : Commit**

```bash
git add -A
git commit -m "feat: add Tailwind v4, shadcn/ui and dark theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3 : Premier aller-retour IPC (`ping`) et Vitest

**Files:**
- Create : `src/ipc/invoke.ts`, `src/ipc/invoke.test.ts`, `src/ipc/app.ts`, `src-tauri/src/commands.rs`
- Modify : `src-tauri/src/lib.rs`, `src/App.tsx`, `package.json`

**Interfaces:**
- Consumes : Task 2.
- Produces :
  - TS `class AppError extends Error { kind: AppErrorKind }`, `type AppErrorKind = "invalidInput" | "notFound" | "pty" | "io"` ;
  - TS `call<T>(command: string, args?: Record<string, unknown>): Promise<T>` (rejette toujours un `AppError`) ;
  - TS `ping(): Promise<string>` ;
  - Rust `#[tauri::command] pub fn ping() -> String` dans `commands.rs`.

- [ ] **Step 1 : Installer Vitest et happy-dom, ajouter le script de test**

```bash
pnpm add -D vitest@5.0.5 happy-dom@21.0.4
```

Dans `package.json`, ajouter dans `scripts` : `"test": "vitest run",`.

- [ ] **Step 2 : Écrire le test du wrapper `call`**

`src/ipc/invoke.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { AppError, call } from "./invoke";

afterEach(() => clearMocks());

it("returns the command result", async () => {
  mockIPC((cmd) => (cmd === "ping" ? "pong" : undefined));
  await expect(call<string>("ping")).resolves.toBe("pong");
});

it("turns a Rust AppError payload into an AppError instance", async () => {
  mockIPC(() => {
    throw { kind: "notFound", message: "dossier introuvable" };
  });
  const error = await call("pty_write").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ kind: "notFound", message: "dossier introuvable" });
});

it("wraps unexpected failures as io errors", async () => {
  mockIPC(() => {
    throw "boom";
  });
  await expect(call("ping")).rejects.toMatchObject({ kind: "io", message: "boom" });
});
```

- [ ] **Step 3 : Vérifier que le test échoue**

Run : `pnpm test`
Attendu : FAIL, `Failed to resolve import "./invoke"`.

- [ ] **Step 4 : Écrire le wrapper**

`src/ipc/invoke.ts` :

```ts
import { invoke } from "@tauri-apps/api/core";

export type AppErrorKind = "invalidInput" | "notFound" | "pty" | "io";

/** Error raised by a Tauri command; mirrors Rust's `AppError` (`{ kind, message }`). */
export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }
}

function isAppErrorPayload(value: unknown): value is { kind: AppErrorKind; message: string } {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

/** `invoke` with Rust errors turned into `AppError` instances. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isAppErrorPayload(error)) throw new AppError(error.kind, error.message);
    throw new AppError("io", String(error));
  }
}
```

`src/ipc/app.ts` :

```ts
import { call } from "./invoke";

export const ping = () => call<string>("ping");
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run : `pnpm test`
Attendu : `Tests  3 passed (3)`.

- [ ] **Step 6 : Commande Rust `ping`**

`src-tauri/src/commands.rs` :

```rust
#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}
```

Remplacer tout `src-tauri/src/lib.rs` par :

```rust
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running the dummyPlane application");
}
```

- [ ] **Step 7 : Bouton de test dans l'interface**

`src/App.tsx` :

```tsx
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ping } from "@/ipc/app";

export default function App() {
  const check = async () => {
    try {
      toast.success(`Rust a répondu : ${await ping()}`);
    } catch (error) {
      toast.error(String(error));
    }
  };
  return (
    <div className="grid h-screen place-items-center">
      <Button onClick={check}>Tester l'IPC</Button>
      <Toaster theme="dark" />
    </div>
  );
}
```

- [ ] **Step 8 : Vérifier**

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Attendu : succès des deux. Puis `pnpm tauri dev`, clic sur « Tester l'IPC » : un toast « Rust a répondu : pong ».

- [ ] **Step 9 : Commit**

```bash
git add -A
git commit -m "feat: add ping command and typed invoke wrapper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Jalon 2 — Canvas et prototype

Les polices Excalidraw locales, prévues au jalon 1 dans la spec, sont faites ici (tâche 4) : Excalidraw n'est installé qu'à ce moment.

### Task 4 : Canvas Excalidraw et insertion de nœuds

**Files:**
- Create : `scripts/copy-excalidraw-fonts.mjs`, `src/canvas/nodeElement.ts`, `src/canvas/nodeElement.test.ts`, `src/canvas/Canvas.tsx`, `src/canvas/InsertMenu.tsx`, `src/nodes/NodeHost.tsx`
- Modify : `package.json`, `.gitignore`, `index.html`, `src/App.tsx`

**Interfaces:**
- Consumes : `Button`, `DropdownMenu*`, `Toaster` (Task 2).
- Produces :
  - `type NodeKind = "terminal" | "note" | "kanban" | "git"` ;
  - `createNodeElement(kind: NodeKind, center: { x: number; y: number }): ExcalidrawEmbeddableElement` ;
  - `isdummyPlaneLink(link: string): boolean` ;
  - `nodeKindOf(element: ExcalidrawElement): NodeKind | null` ;
  - `<NodeHost element={NonDeleted<ExcalidrawEmbeddableElement>} />` ;
  - `<InsertMenu onInsert={(kind: NodeKind) => void} />`.

- [ ] **Step 1 : Installer Excalidraw et copier ses polices à chaque installation**

```bash
pnpm add @excalidraw/excalidraw@0.18.1
```

`scripts/copy-excalidraw-fonts.mjs` :

```js
// Copies Excalidraw's fonts into public/fonts so the canvas never fetches them
// from a CDN (local-first). Runs on every install; public/fonts is git-ignored.
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url));
const target = fileURLToPath(new URL("../public/fonts", import.meta.url));

if (!existsSync(source)) {
  console.error(`Excalidraw fonts not found at ${source}`);
  process.exit(1);
}
cpSync(source, target, { recursive: true });
console.log(`Excalidraw fonts copied to ${target}`);
```

Dans `package.json`, ajouter dans `scripts` : `"postinstall": "node scripts/copy-excalidraw-fonts.mjs",`.
Ajouter à la fin de `.gitignore` :

```
# Excalidraw fonts, copied by scripts/copy-excalidraw-fonts.mjs
public/fonts/
```

Run : `pnpm install`
Attendu : `Excalidraw fonts copied to …\public\fonts` (environ 14 Mo, surtout la police chinoise Xiaolai).

- [ ] **Step 2 : Indiquer à Excalidraw où sont ses polices**

Remplacer tout `index.html` par :

```html
<!doctype html>
<html lang="fr" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>dummyPlane</title>
    <!-- Excalidraw loads its fonts from <EXCALIDRAW_ASSET_PATH>fonts/…; they are copied to public/fonts so the app works offline. -->
    <script>
      window.EXCALIDRAW_ASSET_PATH = "/";
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3 : Écrire les tests des éléments de nœud**

`src/canvas/nodeElement.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement, isdummyPlaneLink, nodeKindOf } from "./nodeElement";

describe("createNodeElement", () => {
  it("centers a terminal on the given point and links it to its own id", () => {
    const element = createNodeElement("terminal", { x: 100, y: 50 });
    expect(element).toMatchObject({ type: "embeddable", x: -260, y: -170, width: 720, height: 440 });
    expect(element.link).toBe(`dummyplane://terminal/${element.id}`);
    expect(element.customData).toEqual({ kind: "terminal" });
  });

  it("gives every node a fresh id", () => {
    expect(createNodeElement("note", { x: 0, y: 0 }).id).not.toBe(createNodeElement("note", { x: 0, y: 0 }).id);
  });
});

describe("isdummyPlaneLink", () => {
  it("accepts our node links only", () => {
    expect(isdummyPlaneLink("dummyplane://kanban/3f2a-b1")).toBe(true);
    expect(isdummyPlaneLink("https://youtube.com/watch?v=x")).toBe(false);
    expect(isdummyPlaneLink("dummyplane://browser/1")).toBe(false);
    expect(isdummyPlaneLink("dummyplane://note/1?x=<script>")).toBe(false);
  });
});

describe("nodeKindOf", () => {
  it("reads the kind of an dummyPlane embeddable", () => {
    expect(nodeKindOf(createNodeElement("git", { x: 0, y: 0 }))).toBe("git");
  });

  it("ignores other elements and unknown kinds", () => {
    const rectangle = { ...createNodeElement("note", { x: 0, y: 0 }), type: "rectangle" } as unknown as ExcalidrawElement;
    expect(nodeKindOf(rectangle)).toBeNull();
    const unknown = { ...createNodeElement("note", { x: 0, y: 0 }), customData: { kind: "browser" } };
    expect(nodeKindOf(unknown)).toBeNull();
  });
});
```

- [ ] **Step 4 : Vérifier que les tests échouent**

Run : `pnpm test`
Attendu : FAIL, `Failed to resolve import "./nodeElement"`.

- [ ] **Step 5 : Implémenter les éléments de nœud**

`src/canvas/nodeElement.ts` :

```ts
import type { ExcalidrawElement, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";

export type NodeKind = "terminal" | "note" | "kanban" | "git";

const NODE_KINDS: readonly NodeKind[] = ["terminal", "note", "kanban", "git"];

const DEFAULT_SIZE: Record<NodeKind, { width: number; height: number }> = {
  terminal: { width: 720, height: 440 },
  note: { width: 320, height: 240 },
  kanban: { width: 640, height: 400 },
  git: { width: 360, height: 320 },
};

const LINK_PATTERN = /^dummyplane:\/\/(terminal|note|kanban|git)\/[\w-]+$/;

/** Only our own nodes may be embedded: no arbitrary iframes on the canvas. */
export function isdummyPlaneLink(link: string): boolean {
  return LINK_PATTERN.test(link);
}

export function nodeKindOf(element: ExcalidrawElement): NodeKind | null {
  const kind: unknown = element.customData?.kind;
  return element.type === "embeddable" && NODE_KINDS.includes(kind as NodeKind) ? (kind as NodeKind) : null;
}

/**
 * Builds a complete embeddable element for an dummyPlane node, centered on `center`
 * (scene coordinates). Excalidraw's skeleton API does not accept embeddables, so
 * every base field is set here; `index: null` lets Excalidraw assign the order.
 */
export function createNodeElement(kind: NodeKind, center: { x: number; y: number }): ExcalidrawEmbeddableElement {
  const id = crypto.randomUUID();
  const { width, height } = DEFAULT_SIZE[kind];
  const random = () => Math.floor(Math.random() * 2 ** 31);
  return {
    id,
    type: "embeddable",
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    angle: 0 as ExcalidrawEmbeddableElement["angle"],
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
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
    link: `dummyplane://${kind}/${id}`,
    locked: false,
    customData: { kind },
  };
}
```

- [ ] **Step 6 : Vérifier que les tests passent**

Run : `pnpm test`
Attendu : `Tests  8 passed (8)` (3 de la tâche 3 + 5 ici).

- [ ] **Step 7 : Composants du canvas**

`src/nodes/NodeHost.tsx` (provisoire : la tâche 6 branche le prototype de terminal) :

```tsx
import { memo } from "react";
import type { NonDeleted, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "@/canvas/nodeElement";

/** Renders the dummyPlane node behind an Excalidraw embeddable, chosen by its kind. */
export const NodeHost = memo(function NodeHost({ element }: { element: NonDeleted<ExcalidrawEmbeddableElement> }) {
  const kind = nodeKindOf(element);
  return (
    <div className="grid h-full place-items-center rounded-md border bg-card text-sm text-muted-foreground">
      {kind ? `Nœud ${kind} (à venir)` : "Nœud inconnu"}
    </div>
  );
}, (prev, next) => prev.element.id === next.element.id);
```

`src/canvas/InsertMenu.tsx` :

```tsx
import { Plus, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NodeKind } from "./nodeElement";

const ITEMS: { kind: NodeKind; label: string; icon: typeof SquareTerminal }[] = [
  { kind: "terminal", label: "Terminal", icon: SquareTerminal },
];

export function InsertMenu({ onInsert }: { onInsert: (kind: NodeKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> Insérer
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ITEMS.map(({ kind, label, icon: Icon }) => (
          <DropdownMenuItem key={kind} onSelect={() => onInsert(kind)}>
            <Icon /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/canvas/Canvas.tsx` :

```tsx
import { useCallback, useState } from "react";
import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { NodeHost } from "@/nodes/NodeHost";
import { InsertMenu } from "./InsertMenu";
import { createNodeElement, isdummyPlaneLink, type NodeKind } from "./nodeElement";

export function Canvas() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  const insert = useCallback(
    (kind: NodeKind) => {
      if (!api) return;
      const { scrollX, scrollY, zoom, width, height } = api.getAppState();
      const center = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), createNodeElement(kind, center)],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  return (
    <div className="relative h-full w-full">
      <Excalidraw
        theme="dark"
        langCode="fr-FR"
        excalidrawAPI={setApi}
        validateEmbeddable={isdummyPlaneLink}
        renderEmbeddable={(element) => <NodeHost element={element} />}
        renderTopRightUI={() => <InsertMenu onInsert={insert} />}
      />
    </div>
  );
}
```

`src/App.tsx` :

```tsx
import { Toaster } from "@/components/ui/sonner";
import { Canvas } from "@/canvas/Canvas";

export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <main className="min-w-0 flex-1">
        <Canvas />
      </main>
      <Toaster theme="dark" />
    </div>
  );
}
```

- [ ] **Step 8 : Vérifier**

Run : `pnpm build` puis `pnpm test`
Attendu : build réussi (un avertissement de taille de chunk est normal) ; `Tests  8 passed`.

À la main, `pnpm tauri dev` :
1. Le canvas Excalidraw remplit la fenêtre, en thème sombre et en français.
2. Écrire un texte avec l'outil Texte : la police dessinée à la main s'affiche.
3. DevTools (clic droit → Inspecter), onglet Réseau, recharger : aucune requête vers un CDN (`unpkg`, `esm.sh`, `jsdelivr`) ; les polices viennent de `/fonts/…`.
4. « Insérer » → « Terminal » : un cadre « Nœud terminal (à venir) » apparaît au centre ; on peut le déplacer et le redimensionner.

- [ ] **Step 9 : Commit**

```bash
git add -A
git commit -m "feat: add Excalidraw canvas with embeddable dummyPlane nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5 : Workspaces en mémoire

**Files:**
- Create : `src/store/workspaces.ts`, `src/store/workspaces.test.ts`, `src/canvas/sceneChanges.ts`, `src/canvas/sceneChanges.test.ts`, `src/sidebar/WorkspaceSidebar.tsx`
- Modify : `src/canvas/Canvas.tsx`, `src/App.tsx`, `package.json`

**Interfaces:**
- Consumes : `createNodeElement`, `isdummyPlaneLink`, `NodeHost`, `InsertMenu` (Task 4) ; `Input`, `Button`, `DropdownMenu*` ; `cn` de `@/lib/utils`.
- Produces :
  - `interface Workspace { id: string; name: string }` ;
  - `interface SavedScene { elements: readonly ExcalidrawElement[]; appState: Pick<AppState, "scrollX" | "scrollY" | "zoom"> }` ;
  - `createWorkspacesStore()` (store zustand vanilla), `workspacesStore`, `useWorkspaces(selector)` ; actions `create(name?) → id`, `rename(id, name)`, `remove(id)`, `select(id)`, `saveScene(id, scene)` ;
  - `createChangeDetector<A extends unknown[]>(keyOf: (...args: A) => string): (...args: A) => boolean` ;
  - `<Canvas workspaceId={string} />`, `<WorkspaceSidebar />`.

- [ ] **Step 1 : Installer zustand**

```bash
pnpm add zustand@5.0.16
```

- [ ] **Step 2 : Écrire les tests du store et du détecteur de changements**

`src/store/workspaces.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspacesStore } from "./workspaces";

let store: ReturnType<typeof createWorkspacesStore>;
const state = () => store.getState();
const names = () => state().workspaces.map((w) => w.name);

beforeEach(() => {
  store = createWorkspacesStore();
});

describe("workspaces store", () => {
  it("starts with one active workspace", () => {
    expect(names()).toEqual(["Workspace 1"]);
    expect(state().activeId).toBe(state().workspaces[0].id);
  });

  it("creates a workspace, numbers it and makes it active", () => {
    const id = state().create();
    expect(names()).toEqual(["Workspace 1", "Workspace 2"]);
    expect(state().activeId).toBe(id);
    state().create("  API  ");
    expect(names()[2]).toBe("API");
  });

  it("renames with trimming and ignores blank names", () => {
    const id = state().activeId;
    state().rename(id, "  Front  ");
    state().rename(id, "   ");
    expect(names()).toEqual(["Front"]);
  });

  it("never removes the last workspace", () => {
    state().remove(state().activeId);
    expect(names()).toEqual(["Workspace 1"]);
  });

  it("selects the next workspace when the active one is removed, or the previous when it was last", () => {
    const [a] = state().workspaces;
    const b = state().create();
    const c = state().create();
    state().select(b);
    state().remove(b);
    expect(state().activeId).toBe(c);
    state().remove(c);
    expect(state().activeId).toBe(a.id);
  });

  it("keeps the active workspace when another one is removed and drops its scene", () => {
    const a = state().activeId;
    const b = state().create();
    state().saveScene(b, { elements: [], appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 as never } } });
    state().select(a);
    state().remove(b);
    expect(state().activeId).toBe(a);
    expect(state().scenes[b]).toBeUndefined();
  });

  it("ignores selection of an unknown workspace", () => {
    const before = state().activeId;
    state().select("nope");
    expect(state().activeId).toBe(before);
  });
});
```

`src/canvas/sceneChanges.test.ts` :

```ts
import { expect, it } from "vitest";
import { createChangeDetector } from "./sceneChanges";

it("reports a change only when the key differs from the last one", () => {
  const changed = createChangeDetector((version: number, zoom: number) => `${version}:${zoom}`);
  expect(changed(1, 1)).toBe(true);
  expect(changed(1, 1)).toBe(false); // pointer move: same scene, same viewport
  expect(changed(2, 1)).toBe(true); // element edited
  expect(changed(2, 1.5)).toBe(true); // zoomed
});

it("keeps separate state per detector", () => {
  const a = createChangeDetector((v: number) => String(v));
  const b = createChangeDetector((v: number) => String(v));
  a(1);
  expect(b(1)).toBe(true);
});
```

- [ ] **Step 3 : Vérifier qu'ils échouent**

Run : `pnpm test`
Attendu : FAIL, `Failed to resolve import "./workspaces"` et `"./sceneChanges"`.

- [ ] **Step 4 : Implémenter**

`src/canvas/sceneChanges.ts` :

```ts
/**
 * Excalidraw calls onChange on every pointer move. Only a different key (scene
 * version plus viewport) is a change worth saving.
 */
export function createChangeDetector<A extends unknown[]>(keyOf: (...args: A) => string) {
  let lastKey: string | undefined;
  return (...args: A): boolean => {
    const key = keyOf(...args);
    if (key === lastKey) return false;
    lastKey = key;
    return true;
  };
}
```

`src/store/workspaces.ts` :

```ts
import { createStore, useStore } from "zustand";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export interface Workspace {
  id: string;
  name: string;
}

/** What a workspace remembers of its canvas. Persisted to SQLite in milestone 5. */
export interface SavedScene {
  elements: readonly ExcalidrawElement[];
  appState: Pick<AppState, "scrollX" | "scrollY" | "zoom">;
}

export interface WorkspacesState {
  workspaces: Workspace[];
  activeId: string;
  scenes: Record<string, SavedScene>;
  create: (name?: string) => string;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  select: (id: string) => void;
  saveScene: (id: string, scene: SavedScene) => void;
}

export function createWorkspacesStore() {
  const first: Workspace = { id: crypto.randomUUID(), name: "Workspace 1" };
  return createStore<WorkspacesState>()((set, get) => ({
    workspaces: [first],
    activeId: first.id,
    scenes: {},

    create: (name) => {
      const workspace = { id: crypto.randomUUID(), name: name?.trim() || `Workspace ${get().workspaces.length + 1}` };
      set((s) => ({ workspaces: [...s.workspaces, workspace], activeId: workspace.id }));
      return workspace.id;
    },

    rename: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) }));
    },

    // There is always at least one workspace; removing the active one selects its
    // neighbor (the next one, or the previous one when it was last).
    remove: (id) => {
      const { workspaces, activeId, scenes } = get();
      const index = workspaces.findIndex((w) => w.id === id);
      if (index === -1 || workspaces.length === 1) return;
      const remaining = workspaces.filter((w) => w.id !== id);
      const nextActive = id === activeId ? remaining[Math.min(index, remaining.length - 1)].id : activeId;
      const { [id]: _removed, ...otherScenes } = scenes;
      set({ workspaces: remaining, activeId: nextActive, scenes: otherScenes });
    },

    select: (id) => {
      if (get().workspaces.some((w) => w.id === id)) set({ activeId: id });
    },

    saveScene: (id, scene) => set((s) => ({ scenes: { ...s.scenes, [id]: scene } })),
  }));
}

export const workspacesStore = createWorkspacesStore();

export function useWorkspaces<T>(selector: (state: WorkspacesState) => T): T {
  return useStore(workspacesStore, selector);
}
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run : `pnpm test`
Attendu : `Tests  17 passed (17)`.

- [ ] **Step 6 : Brancher le canvas sur le workspace actif**

Remplacer tout `src/canvas/Canvas.tsx` par :

```tsx
import { useCallback, useMemo, useState } from "react";
import { CaptureUpdateAction, Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { NodeHost } from "@/nodes/NodeHost";
import { workspacesStore } from "@/store/workspaces";
import { InsertMenu } from "./InsertMenu";
import { createNodeElement, isdummyPlaneLink, type NodeKind } from "./nodeElement";
import { createChangeDetector } from "./sceneChanges";

const sceneKey = (elements: readonly ExcalidrawElement[], appState: AppState) =>
  `${getSceneVersion(elements)}:${appState.scrollX}:${appState.scrollY}:${appState.zoom.value}`;

/** One Excalidraw instance per workspace; remounted (via `key`) when switching. */
export function Canvas({ workspaceId }: { workspaceId: string }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const initialData = useMemo(() => workspacesStore.getState().scenes[workspaceId] ?? null, [workspaceId]);
  const hasChanged = useMemo(() => createChangeDetector(sceneKey), [workspaceId]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!hasChanged(elements, appState)) return;
      const { scrollX, scrollY, zoom } = appState;
      workspacesStore.getState().saveScene(workspaceId, { elements, appState: { scrollX, scrollY, zoom } });
    },
    [workspaceId, hasChanged],
  );

  const insert = useCallback(
    (kind: NodeKind) => {
      if (!api) return;
      const { scrollX, scrollY, zoom, width, height } = api.getAppState();
      const center = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), createNodeElement(kind, center)],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  return (
    <div className="relative h-full w-full">
      <Excalidraw
        theme="dark"
        langCode="fr-FR"
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        validateEmbeddable={isdummyPlaneLink}
        renderEmbeddable={(element) => <NodeHost element={element} />}
        renderTopRightUI={() => <InsertMenu onInsert={insert} />}
      />
    </div>
  );
}
```

- [ ] **Step 7 : Barre latérale des workspaces**

`src/sidebar/WorkspaceSidebar.tsx` :

```tsx
import { useState } from "react";
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspaces, workspacesStore, type Workspace } from "@/store/workspaces";

export function WorkspaceSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const { create, select } = workspacesStore.getState();

  if (collapsed) {
    return (
      <aside className="flex w-10 flex-col items-center border-r bg-sidebar py-2">
        <Button size="icon" variant="ghost" aria-label="Afficher les workspaces" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <header className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-semibold">Workspaces</span>
        <div className="flex">
          <Button size="icon" variant="ghost" aria-label="Nouveau workspace" onClick={() => create()}>
            <Plus />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Masquer" onClick={() => setCollapsed(true)}>
            <PanelLeftClose />
          </Button>
        </div>
      </header>
      <nav className="flex flex-col gap-0.5 px-2">
        {workspaces.map((workspace) => (
          <WorkspaceRow
            key={workspace.id}
            workspace={workspace}
            active={workspace.id === activeId}
            canRemove={workspaces.length > 1}
            onSelect={() => select(workspace.id)}
          />
        ))}
      </nav>
    </aside>
  );
}

function WorkspaceRow(props: { workspace: Workspace; active: boolean; canRemove: boolean; onSelect: () => void }) {
  const { workspace, active, canRemove, onSelect } = props;
  const [editing, setEditing] = useState(false);
  const { rename, remove } = workspacesStore.getState();

  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={workspace.name}
        className="h-8"
        onBlur={(e) => {
          rename(workspace.id, e.currentTarget.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex h-8 items-center rounded-md pl-2 text-sm hover:bg-sidebar-accent",
        active && "bg-sidebar-accent font-medium",
      )}
    >
      <button className="flex-1 truncate text-left" onClick={onSelect} onDoubleClick={() => setEditing(true)}>
        {workspace.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100" aria-label="Actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Renommer</DropdownMenuItem>
          <DropdownMenuItem disabled={!canRemove} variant="destructive" onSelect={() => remove(workspace.id)}>
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

Remplacer tout `src/App.tsx` par :

```tsx
import { Toaster } from "@/components/ui/sonner";
import { Canvas } from "@/canvas/Canvas";
import { WorkspaceSidebar } from "@/sidebar/WorkspaceSidebar";
import { useWorkspaces } from "@/store/workspaces";

export default function App() {
  const activeId = useWorkspaces((s) => s.activeId);
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <WorkspaceSidebar />
      <main className="min-w-0 flex-1">
        <Canvas key={activeId} workspaceId={activeId} />
      </main>
      <Toaster theme="dark" />
    </div>
  );
}
```

- [ ] **Step 8 : Vérifier**

Run : `pnpm build` puis `pnpm test`
Attendu : succès ; `Tests  17 passed`.

À la main (`pnpm tauri dev`) :
1. Dessiner un rectangle dans « Workspace 1 ». Créer un workspace avec « + » : canvas vide.
2. Revenir sur « Workspace 1 » : le rectangle et la position de la vue sont restaurés.
3. Double-cliquer sur un nom : il devient éditable ; Entrée valide, Échap annule.
4. « … » → « Supprimer » est grisé quand il ne reste qu'un workspace.

- [ ] **Step 9 : Commit**

```bash
git add -A
git commit -m "feat: add in-memory workspaces with sidebar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6 : Outils du prototype go/no-go

Ce code est **jetable** : il sert à vérifier les critères de la spec §15, puis il sera supprimé au début du plan 2. Seul `src/canvas/hitTest.ts` sera réutilisé (dépôt sur un terminal, jalon 6).

**Files:**
- Create : `src/canvas/hitTest.ts`, `src/canvas/hitTest.test.ts`, `src/spike/diagnostics.ts`, `src/spike/registry.ts`, `src/spike/SpikeTerminal.tsx`, `src/spike/dropInterceptor.ts`, `src/spike/SpikePanel.tsx`
- Modify : `src/nodes/NodeHost.tsx`, `src/canvas/Canvas.tsx`, `package.json`

**Interfaces:**
- Consumes : `createNodeElement`, `nodeKindOf` (Task 4) ; `workspacesStore` et `createChangeDetector` (Task 5).
- Produces :
  - `findTerminalAt(elements: readonly ExcalidrawElement[], x: number, y: number): ExcalidrawElement | null` ;
  - `SNIPPET_MIME = "application/x-dummyplane-snippet"` et `installDropInterceptor(container, api, onSnippet, onMiss): () => void` ;
  - registre `getSpikeTerminal(nodeId)`, `mountInto(entry, host, nodeId)`, `spikeEntries()`, `short(nodeId)` (la tâche 12 y ajoute `realTerminals`).

- [ ] **Step 1 : Installer Xterm**

```bash
pnpm add @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 @xterm/addon-webgl@0.19.0
```

- [ ] **Step 2 : Écrire les tests de la recherche du terminal sous un point**

`src/canvas/hitTest.test.ts` :

```ts
import { expect, it } from "vitest";
import { createNodeElement } from "./nodeElement";
import { findTerminalAt } from "./hitTest";

// Terminals are 720x440; centered on (360, 220) they span x 0..720, y 0..440.
const at = (x: number, y: number) => createNodeElement("terminal", { x: x + 360, y: y + 220 });

it("finds the terminal under the point", () => {
  const terminal = at(0, 0);
  expect(findTerminalAt([terminal], 10, 10)).toBe(terminal);
  expect(findTerminalAt([terminal], 800, 10)).toBeNull();
});

it("prefers the topmost terminal when two overlap", () => {
  const below = at(0, 0);
  const above = at(100, 100);
  expect(findTerminalAt([below, above], 200, 200)).toBe(above);
});

it("skips deleted terminals and other node kinds", () => {
  const deleted = { ...at(0, 0), isDeleted: true };
  const note = createNodeElement("note", { x: 10, y: 10 });
  expect(findTerminalAt([deleted, note], 10, 10)).toBeNull();
});
```

- [ ] **Step 3 : Vérifier qu'ils échouent**

Run : `pnpm test`
Attendu : FAIL, `Failed to resolve import "./hitTest"`.

- [ ] **Step 4 : Implémenter**

`src/canvas/hitTest.ts` :

```ts
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "./nodeElement";

/**
 * Topmost live terminal node containing the scene point, or null. Later elements
 * are drawn above earlier ones, so the array is searched from the end. Rotation
 * is ignored: nodes are never rotated in practice.
 */
export function findTerminalAt(elements: readonly ExcalidrawElement[], x: number, y: number): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element.isDeleted || nodeKindOf(element) !== "terminal") continue;
    const inside = x >= element.x && x <= element.x + element.width && y >= element.y && y <= element.y + element.height;
    if (inside) return element;
  }
  return null;
}
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run : `pnpm test`
Attendu : `Tests  20 passed (20)`.

- [ ] **Step 6 : Écrire les outils du prototype**

`src/spike/diagnostics.ts` :

```ts
import { createStore, useStore } from "zustand";

// Throwaway (milestone 2 prototype): an on-screen log so criteria can be checked
// without opening devtools. Deleted once the go/no-go decision is recorded.
interface DiagnosticsState {
  lines: string[];
  blockKeyPropagation: boolean;
  log: (line: string) => void;
  setBlockKeyPropagation: (value: boolean) => void;
}

export const diagnostics = createStore<DiagnosticsState>()((set) => ({
  lines: [],
  blockKeyPropagation: false,
  log: (line) =>
    set((s) => ({ lines: [`${new Date().toLocaleTimeString()} ${line}`, ...s.lines].slice(0, 40) })),
  setBlockKeyPropagation: (value) => set({ blockKeyPropagation: value }),
}));

export const log = (line: string) => diagnostics.getState().log(line);

export function useDiagnostics<T>(selector: (s: DiagnosticsState) => T): T {
  return useStore(diagnostics, selector);
}
```

`src/spike/registry.ts` :

```ts
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { log } from "./diagnostics";

// Throwaway (milestone 2 prototype). Terminals live outside React so an
// embeddable that Excalidraw unmounts (off-screen, workspace switch) keeps its
// xterm instance; remounting moves the existing DOM element into the new host.
export interface SpikeEntry {
  term: Terminal;
  fit: FitAddon;
  opened: boolean;
}

const entries = new Map<string, SpikeEntry>();
const PROMPT = "\x1b[32mspike\x1b[0m$ ";

export function spikeEntries(): ReadonlyMap<string, SpikeEntry> {
  return entries;
}

export function getSpikeTerminal(nodeId: string): SpikeEntry {
  const existing = entries.get(nodeId);
  if (existing) return existing;
  const term = new Terminal({ fontFamily: "Cascadia Code, Consolas, monospace", fontSize: 13, cursorBlink: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const entry: SpikeEntry = { term, fit, opened: false };
  entries.set(nodeId, entry);
  attachLocalEcho(nodeId, term);
  return entry;
}

/** Puts the terminal into `host`: `open` the first time, re-parent afterwards. */
export function mountInto(entry: SpikeEntry, host: HTMLElement, nodeId: string) {
  if (!entry.opened) {
    entry.term.open(host);
    entry.opened = true;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        log(`[${short(nodeId)}] contexte WebGL perdu → rendu DOM`);
        webgl.dispose();
      });
      entry.term.loadAddon(webgl);
    } catch (error) {
      log(`[${short(nodeId)}] WebGL indisponible : ${String(error)}`);
    }
    entry.term.write(`Prototype ${short(nodeId)} — écho local\r\n${PROMPT}`);
    log(`[${short(nodeId)}] créé`);
  } else if (entry.term.element && entry.term.element.parentElement !== host) {
    host.appendChild(entry.term.element);
    log(`[${short(nodeId)}] remonté avec son état (${entry.term.buffer.active.length} lignes)`);
  }
  entry.fit.fit();
}

export const short = (nodeId: string) => nodeId.slice(0, 4);

function attachLocalEcho(nodeId: string, term: Terminal) {
  term.onData((data) => {
    if (data === "\x1b") {
      log(`[${short(nodeId)}] Échap reçu par le terminal ✔`);
      return;
    }
    if (data.startsWith("\x1b")) {
      log(`[${short(nodeId)}] séquence ${JSON.stringify(data)}`);
      return;
    }
    for (const char of data) {
      if (char === "\r") term.write(`\r\n${PROMPT}`);
      else if (char === "\x7f") term.write("\b \b");
      else if (char >= " ") term.write(char);
    }
  });
}
```

`src/spike/SpikeTerminal.tsx` :

```tsx
import { useEffect, useRef } from "react";
import { diagnostics } from "./diagnostics";
import { getSpikeTerminal, mountInto } from "./registry";

// Throwaway (milestone 2 prototype): an xterm with local echo inside an embeddable.
export function SpikeTerminal({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const entry = getSpikeTerminal(nodeId);
    mountInto(entry, host, nodeId);
    const observer = new ResizeObserver(() => entry.fit.fit());
    observer.observe(host);
    // Native listener: stops keys from bubbling to Excalidraw's document handlers
    // when the "block propagation" toggle is on (criterion 2 fallback).
    const stopKeys = (event: KeyboardEvent) => {
      if (diagnostics.getState().blockKeyPropagation) event.stopPropagation();
    };
    host.addEventListener("keydown", stopKeys);
    return () => {
      observer.disconnect();
      host.removeEventListener("keydown", stopKeys);
    };
  }, [nodeId]);

  return <div ref={hostRef} className="h-full w-full bg-[#1e1e1e] p-1" />;
}
```

`src/spike/dropInterceptor.ts` :

```ts
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { findTerminalAt } from "@/canvas/hitTest";

export const SNIPPET_MIME = "application/x-dummyplane-snippet";

/**
 * Catches our own drag payloads in the capture phase, before Excalidraw turns
 * dropped text into a text element, and routes them to the terminal under the
 * pointer. Other drags are left to Excalidraw.
 */
export function installDropInterceptor(
  container: HTMLElement,
  api: ExcalidrawImperativeAPI,
  onSnippet: (nodeId: string, text: string) => void,
  onMiss: () => void,
): () => void {
  const isOurs = (event: DragEvent) => event.dataTransfer?.types.includes(SNIPPET_MIME) ?? false;
  const terminalAt = (event: DragEvent) => {
    const { x, y } = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, api.getAppState());
    return findTerminalAt(api.getSceneElements(), x, y);
  };

  const onDragOver = (event: DragEvent) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = terminalAt(event) ? "copy" : "none";
  };

  const onDrop = (event: DragEvent) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = terminalAt(event);
    if (target) onSnippet(target.id, event.dataTransfer!.getData(SNIPPET_MIME));
    else onMiss();
  };

  container.addEventListener("dragover", onDragOver, true);
  container.addEventListener("drop", onDrop, true);
  return () => {
    container.removeEventListener("dragover", onDragOver, true);
    container.removeEventListener("drop", onDrop, true);
  };
}
```

`src/spike/SpikePanel.tsx` :

```tsx
import { useEffect, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Button } from "@/components/ui/button";
import { createNodeElement, nodeKindOf } from "@/canvas/nodeElement";
import { diagnostics, log, useDiagnostics } from "./diagnostics";
import { installDropInterceptor, SNIPPET_MIME } from "./dropInterceptor";
import { getSpikeTerminal, short, spikeEntries } from "./registry";

// Throwaway (milestone 2 prototype): tools to check the go/no-go criteria of
// spec §15 by hand. Deleted once the decision is recorded.
export function SpikePanel({ api, container }: { api: ExcalidrawImperativeAPI; container: HTMLElement }) {
  const lines = useDiagnostics((s) => s.lines);
  const blockKeys = useDiagnostics((s) => s.blockKeyPropagation);
  const fps = useFps();

  useEffect(
    () =>
      installDropInterceptor(
        container,
        api,
        (nodeId, text) => {
          getSpikeTerminal(nodeId).term.paste(text);
          log(`[${short(nodeId)}] snippet collé ✔ (aucune Entrée envoyée)`);
        },
        () => log("dépôt hors d'un terminal : ignoré"),
      ),
    [api, container],
  );

  // A tool change while typing in a terminal means an Excalidraw shortcut leaked.
  useEffect(() => {
    let tool = api.getAppState().activeTool.type;
    return api.onChange((_elements, appState) => {
      if (appState.activeTool.type !== tool) {
        tool = appState.activeTool.type;
        log(`outil Excalidraw → ${tool}`);
      }
    });
  }, [api]);

  const addTerminals = (count: number) => {
    const { scrollX, scrollY, zoom, width, height } = api.getAppState();
    const origin = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
    const added = Array.from({ length: count }, (_, i) =>
      createNodeElement("terminal", { x: origin.x + (i % 5) * 760, y: origin.y + Math.floor(i / 5) * 480 }),
    );
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...added],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const flood = () => {
    const until = performance.now() + 5000;
    const tick = () => {
      for (const { term } of spikeEntries().values()) {
        for (let i = 0; i < 20; i++) term.write(`\x1b[3${i % 7}m${"█".repeat(60)} ${i}\x1b[0m\r\n`);
      }
      if (performance.now() < until) requestAnimationFrame(tick);
      else log("flood terminé");
    };
    requestAnimationFrame(tick);
  };

  const listBindings = () => {
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((e) => [e.id, e]));
    const arrows = elements.filter((e) => e.type === "arrow");
    if (arrows.length === 0) log("aucune flèche");
    for (const arrow of arrows) {
      if (arrow.type !== "arrow") continue;
      const describe = (id: string | undefined) => {
        const target = id ? byId.get(id) : undefined;
        return target ? `${nodeKindOf(target) ?? target.type}:${short(target.id)}` : "libre";
      };
      log(`flèche ${short(arrow.id)} : ${describe(arrow.startBinding?.elementId)} → ${describe(arrow.endBinding?.elementId)}`);
    }
  };

  return (
    <div className="pointer-events-auto absolute bottom-16 left-3 z-10 w-80 rounded-md border bg-card/95 p-2 text-xs shadow-lg">
      <div className="mb-2 flex items-center justify-between font-semibold">
        <span>Prototype jalon 2</span>
        <span className={fps < 40 ? "text-destructive" : "text-green-400"}>{fps} img/s</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => addTerminals(10)}>+10 terminaux</Button>
        <Button size="sm" variant="outline" onClick={flood}>Flood 5 s</Button>
        <Button size="sm" variant="outline" onClick={listBindings}>Liaisons</Button>
        <Button
          size="sm"
          variant={blockKeys ? "default" : "outline"}
          onClick={() => diagnostics.getState().setBlockKeyPropagation(!blockKeys)}
        >
          Bloquer touches : {blockKeys ? "oui" : "non"}
        </Button>
      </div>
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData(SNIPPET_MIME, "echo depuis le glisser-déposer")}
        className="mb-2 cursor-grab rounded border border-dashed p-1 text-center"
      >
        ⇢ Glisse-moi sur un terminal
      </div>
      <ol className="max-h-48 overflow-auto font-mono">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </div>
  );
}

function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let handle = requestAnimationFrame(function frame(now) {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      handle = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(handle);
  }, []);
  return fps;
}
```

- [ ] **Step 7 : Brancher le prototype dans le canvas**

Remplacer tout `src/nodes/NodeHost.tsx` par :

```tsx
import { memo } from "react";
import type { NonDeleted, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "@/canvas/nodeElement";
import { SpikeTerminal } from "@/spike/SpikeTerminal";

/** Renders the dummyPlane node behind an Excalidraw embeddable, chosen by its kind. */
export const NodeHost = memo(function NodeHost({ element }: { element: NonDeleted<ExcalidrawEmbeddableElement> }) {
  switch (nodeKindOf(element)) {
    case "terminal":
      return <SpikeTerminal nodeId={element.id} />;
    default:
      return <div className="grid h-full place-items-center bg-card text-muted-foreground">Nœud inconnu</div>;
  }
}, (prev, next) => prev.element.id === next.element.id);
```

Remplacer tout `src/canvas/Canvas.tsx` par (ajouts par rapport à la tâche 5 : `containerRef` et `SpikePanel`) :

```tsx
import { useCallback, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { NodeHost } from "@/nodes/NodeHost";
import { workspacesStore } from "@/store/workspaces";
import { SpikePanel } from "@/spike/SpikePanel";
import { InsertMenu } from "./InsertMenu";
import { createNodeElement, isdummyPlaneLink, type NodeKind } from "./nodeElement";
import { createChangeDetector } from "./sceneChanges";

const sceneKey = (elements: readonly ExcalidrawElement[], appState: AppState) =>
  `${getSceneVersion(elements)}:${appState.scrollX}:${appState.scrollY}:${appState.zoom.value}`;

/** One Excalidraw instance per workspace; remounted (via `key`) when switching. */
export function Canvas({ workspaceId }: { workspaceId: string }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialData = useMemo(() => workspacesStore.getState().scenes[workspaceId] ?? null, [workspaceId]);
  const hasChanged = useMemo(() => createChangeDetector(sceneKey), [workspaceId]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!hasChanged(elements, appState)) return;
      const { scrollX, scrollY, zoom } = appState;
      workspacesStore.getState().saveScene(workspaceId, { elements, appState: { scrollX, scrollY, zoom } });
    },
    [workspaceId, hasChanged],
  );

  const insert = useCallback(
    (kind: NodeKind) => {
      if (!api) return;
      const { scrollX, scrollY, zoom, width, height } = api.getAppState();
      const center = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), createNodeElement(kind, center)],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <Excalidraw
        theme="dark"
        langCode="fr-FR"
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        validateEmbeddable={isdummyPlaneLink}
        renderEmbeddable={(element) => <NodeHost element={element} />}
        renderTopRightUI={() => <InsertMenu onInsert={insert} />}
      />
      {api && containerRef.current && <SpikePanel api={api} container={containerRef.current} />}
    </div>
  );
}
```

- [ ] **Step 8 : Vérifier**

Run : `pnpm build` puis `pnpm test`
Attendu : succès ; `Tests  20 passed`.
`pnpm tauri dev` : « Insérer » → « Terminal » affiche un Xterm avec l'invite verte `spike$`, et le panneau « Prototype jalon 2 » est en bas à gauche.

- [ ] **Step 9 : Commit**

```bash
git add -A
git commit -m "feat: add go/no-go prototype tools for embeddable terminals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7 : Passer le prototype avec Mathieu et consigner la décision

Cette tâche **demande Mathieu** : l'exécutant lance l'app, lui donne le protocole ci-dessous, et note ses observations. Ne pas deviner les résultats.

**Files:**
- Modify : `docs/superpowers/specs/2026-10-23-dummyplane-v1-design.md` (§15, sous-section « Décision »)

**Interfaces:**
- Consumes : l'app de la tâche 6.
- Produces : la décision A (Excalidraw) ou B (React Flow par-dessus Excalidraw), écrite dans la spec.

- [ ] **Step 1 : Lancer l'app**

Run : `pnpm tauri dev`

- [ ] **Step 2 : Dérouler le protocole avec Mathieu**

| # | Action | Résultat attendu pour « go » |
|---|---|---|
| 1 | Insérer un terminal, cliquer dedans, taper `r`, `o`, `t`, `Suppr`, `Entrée` | Le texte s'affiche dans le terminal ; aucune ligne « outil Excalidraw → … » dans le journal ; le nœud n'est pas supprimé |
| 2 | Dans le terminal actif, appuyer sur Échap | Le journal affiche « Échap reçu par le terminal ✔ ». Sinon, activer « Bloquer touches : oui » et recommencer |
| 3 | Molette au-dessus du terminal actif, puis au-dessus du canvas vide | Le terminal défile (taper d'abord quelques `Entrée`), puis le canvas défile ou zoome |
| 4 | Redimensionner le nœud par une poignée d'Excalidraw (vue à 100 %) | Le texte du terminal se réorganise à la nouvelle taille, sans flou |
| 5 | Taper du texte, déplacer la vue loin du nœud, revenir ; puis changer de workspace et revenir | Le texte tapé est toujours là ; le journal indique « remonté avec son état » au retour de workspace |
| 6 | Glisser « ⇢ Glisse-moi sur un terminal » sur un terminal, puis sur le canvas vide | Le texte `echo depuis le glisser-déposer` apparaît dans le terminal sans Entrée ; sur le canvas vide, aucun élément texte n'est créé et le journal indique « ignoré » |
| 7 | Avec l'outil Flèche, tracer une flèche d'un terminal à un autre, puis « Liaisons » | Le journal affiche `flèche … : terminal:xxxx → terminal:yyyy` |
| 8 | « +10 terminaux », « Flood 5 s », puis déplacer et zoomer le canvas pendant le flood | Le compteur reste au-dessus de 40 img/s environ, sans saccade gênante ; aucun terminal noir |

- [ ] **Step 3 : Consigner la décision**

Dans la spec, remplacer la ligne `*À compléter à la fin du jalon 2, avec les observations de chaque critère.*` par un tableau `| Critère | Observation | OK ? |` rempli avec les observations de Mathieu, suivi d'une ligne : `**Décision : option A (Excalidraw).**` ou `**Décision : option B (React Flow par-dessus Excalidraw).**`, et, si un contournement a été nécessaire (par exemple « Bloquer touches »), une phrase qui le décrit.

Règle de décision (spec §15) : un échec non corrigible sur 1, 2, 6 ou 8 entraîne l'option B.

- [ ] **Step 4 : Commit**

```bash
git add docs/superpowers/specs/2026-10-23-dummyplane-v1-design.md
git commit -m "docs: record milestone 2 go/no-go decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5 : Si la décision est B, s'arrêter**

Prévenir Mathieu que les tâches 8 à 12 (pont PTY) restent valables, mais que le plan 2 devra intégrer React Flow. Continuer avec les tâches 8 à 12 seulement s'il le confirme.

---

## Jalon 3 — Pont PTY en Rust

### Task 8 : Tampon de scrollback

**Files:**
- Create : `src-tauri/src/pty/mod.rs`, `src-tauri/src/pty/scrollback.rs`
- Modify : `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes : rien.
- Produces : `pub const SCROLLBACK_CAPACITY: usize = 512 * 1024` ; `pub struct Scrollback` avec `new(capacity: usize) -> Self`, `push(&mut self, bytes: &[u8])`, `snapshot(&self) -> Vec<u8>`.

- [ ] **Step 1 : Déclarer le module**

`src-tauri/src/pty/mod.rs` :

```rust
pub mod scrollback;
```

Dans `src-tauri/src/lib.rs`, ajouter `mod pty;` sous `mod commands;`.

- [ ] **Step 2 : Écrire les tests avec une implémentation vide**

`src-tauri/src/pty/scrollback.rs` :

```rust
use std::collections::VecDeque;

/// Per-terminal cap on retained output (spec §5.6).
pub const SCROLLBACK_CAPACITY: usize = 512 * 1024;

pub struct Scrollback {
    buf: VecDeque<u8>,
    capacity: usize,
    truncated: bool,
}

impl Scrollback {
    pub fn new(capacity: usize) -> Self {
        Self { buf: VecDeque::new(), capacity, truncated: false }
    }

    pub fn push(&mut self, _bytes: &[u8]) {
        todo!()
    }

    pub fn snapshot(&self) -> Vec<u8> {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_everything_below_capacity() {
        let mut sb = Scrollback::new(16);
        sb.push(b"hello ");
        sb.push(b"world");
        assert_eq!(sb.snapshot(), b"hello world");
    }

    #[test]
    fn drops_oldest_bytes_and_replays_from_first_newline() {
        let mut sb = Scrollback::new(10);
        sb.push(b"\x1b[31mred\nline2\n");
        // 15 bytes into 10: the color escape is dropped, "red\nline2\n" is kept.
        assert_eq!(sb.snapshot(), b"\x1b[0mline2\n");
    }

    #[test]
    fn keeps_the_tail_of_a_chunk_larger_than_capacity() {
        let mut sb = Scrollback::new(4);
        sb.push(b"abcdef\ngh");
        assert_eq!(sb.snapshot(), b"\x1b[0mgh");
    }

    #[test]
    fn replays_whole_buffer_when_truncated_without_newline() {
        let mut sb = Scrollback::new(4);
        sb.push(b"abcdefgh");
        assert_eq!(sb.snapshot(), b"\x1b[0mefgh");
    }

    #[test]
    fn empty_buffer_snapshot_is_empty() {
        let mut sb = Scrollback::new(4);
        sb.push(b"");
        assert!(sb.snapshot().is_empty());
    }
}
```

- [ ] **Step 3 : Vérifier que les tests échouent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml scrollback`
Attendu : 5 tests FAILED, `not yet implemented`.

- [ ] **Step 4 : Implémenter**

Remplacer tout `src-tauri/src/pty/scrollback.rs` par :

```rust
use std::collections::VecDeque;

/// Per-terminal cap on retained output (spec §5.6).
pub const SCROLLBACK_CAPACITY: usize = 512 * 1024;

/// SGR reset, prepended when replaying a truncated buffer so colors left open by
/// dropped output don't bleed into the restored screen.
const RESET_ATTRIBUTES: &[u8] = b"\x1b[0m";

/// Ring buffer of the most recent raw PTY output, replayed when a terminal is
/// re-attached or restored after a restart.
pub struct Scrollback {
    buf: VecDeque<u8>,
    capacity: usize,
    truncated: bool,
}

impl Scrollback {
    pub fn new(capacity: usize) -> Self {
        Self { buf: VecDeque::new(), capacity, truncated: false }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        if bytes.len() >= self.capacity {
            self.buf.clear();
            self.buf.extend(&bytes[bytes.len() - self.capacity..]);
            self.truncated = true;
            return;
        }
        let overflow = (self.buf.len() + bytes.len()).saturating_sub(self.capacity);
        if overflow > 0 {
            self.buf.drain(..overflow);
            self.truncated = true;
        }
        self.buf.extend(bytes);
    }

    /// Bytes that are safe to write into a fresh terminal. Once old output has been
    /// dropped the buffer may begin in the middle of an escape sequence, so we skip
    /// to the first newline and reset attributes before the rest.
    pub fn snapshot(&self) -> Vec<u8> {
        let data: Vec<u8> = self.buf.iter().copied().collect();
        if !self.truncated {
            return data;
        }
        let start = data.iter().position(|&b| b == b'\n').map_or(0, |i| i + 1);
        let mut out = Vec::with_capacity(RESET_ATTRIBUTES.len() + data.len() - start);
        out.extend_from_slice(RESET_ATTRIBUTES);
        out.extend_from_slice(&data[start..]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_everything_below_capacity() {
        let mut sb = Scrollback::new(16);
        sb.push(b"hello ");
        sb.push(b"world");
        assert_eq!(sb.snapshot(), b"hello world");
    }

    #[test]
    fn drops_oldest_bytes_and_replays_from_first_newline() {
        let mut sb = Scrollback::new(10);
        sb.push(b"\x1b[31mred\nline2\n");
        // 15 bytes into 10: the color escape is dropped, "red\nline2\n" is kept.
        assert_eq!(sb.snapshot(), b"\x1b[0mline2\n");
    }

    #[test]
    fn keeps_the_tail_of_a_chunk_larger_than_capacity() {
        let mut sb = Scrollback::new(4);
        sb.push(b"abcdef\ngh");
        assert_eq!(sb.snapshot(), b"\x1b[0mgh");
    }

    #[test]
    fn replays_whole_buffer_when_truncated_without_newline() {
        let mut sb = Scrollback::new(4);
        sb.push(b"abcdefgh");
        assert_eq!(sb.snapshot(), b"\x1b[0mefgh");
    }

    #[test]
    fn empty_buffer_snapshot_is_empty() {
        let mut sb = Scrollback::new(4);
        sb.push(b"");
        assert!(sb.snapshot().is_empty());
    }
}
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml scrollback`
Attendu : `test result: ok. 5 passed`.

- [ ] **Step 6 : Commit**

```bash
git add src-tauri/src/pty src-tauri/src/lib.rs
git commit -m "feat(pty): add scrollback ring buffer with safe replay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9 : Erreurs typées et plan de lancement (shells, préréglages, Claude)

**Files:**
- Create : `src-tauri/src/error.rs`, `src-tauri/src/pty/shell.rs`
- Modify : `src-tauri/src/pty/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes : rien.
- Produces :
  - `pub enum AppError { InvalidInput(String), NotFound(String), Pty(String), Io(std::io::Error) }`, `AppError::kind(&self) -> &'static str`, `pub type AppResult<T>` ; sérialisation `{ kind, message }` ;
  - `ShellKind` (`default|powershell|pwsh|cmd|gitbash`), `Preset` (`claude|aider|codex|shell|custom`), `ClaudeMode` (`new|resume|continue`), `ClaudeLaunch { mode, session_id, title }`, `SpawnSpec { cwd, shell, preset, command, claude }` (désérialisés en camelCase) ;
  - `ShellSyntax`, `ShellProgram { program, args, syntax }`, `SpawnPlan { program: PathBuf, args: Vec<String>, cwd: PathBuf, env: Vec<(String, String)>, initial_input: Option<String> }` ;
  - `type Locate<'a> = &'a dyn Fn(&str) -> Option<PathBuf>`, `which_locate(name)`, `resolve_shell(kind, locate)`, `find_git_bash(git)`, `quote(syntax, value)`, `preset_command(spec, syntax)`, `build_plan(node_id, spec, locate) -> AppResult<SpawnPlan>`.

- [ ] **Step 1 : Ajouter les dépendances**

```bash
cd src-tauri
cargo add thiserror@2 which@8.0.6
cargo add uuid@1 --features v4
cargo add --dev tempfile@3
cd ..
```

- [ ] **Step 2 : Type d'erreur commun, avec son test**

`src-tauri/src/error.rs` :

```rust
use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Error returned by every Tauri command. Serialized as `{ kind, message }` so the
/// frontend can branch on `kind` without parsing human-readable text.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Pty(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::InvalidInput(_) => "invalidInput",
            AppError::NotFound(_) => "notFound",
            AppError::Pty(_) => "pty",
            AppError::Io(_) => "io",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_kind_and_message() {
        let json = serde_json::to_value(AppError::NotFound("no such folder".into())).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "notFound", "message": "no such folder" }));
    }
}
```

Dans `src-tauri/src/lib.rs`, ajouter `mod error;` sous `mod commands;`. Dans `src-tauri/src/pty/mod.rs`, ajouter `pub mod shell;`.

- [ ] **Step 3 : Écrire les tests du plan de lancement, avec des fonctions vides**

`src-tauri/src/pty/shell.rs` — types complets, fonctions en `todo!()`, et le module de tests définitif :

```rust
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    Default,
    PowerShell,
    Pwsh,
    Cmd,
    GitBash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Claude,
    Aider,
    Codex,
    Shell,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeMode {
    New,
    Resume,
    Continue,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLaunch {
    pub mode: ClaudeMode,
    pub session_id: String,
    pub title: String,
}

/// What the frontend asks for when it starts a terminal (spec §9).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnSpec {
    pub cwd: String,
    pub shell: ShellKind,
    pub preset: Preset,
    #[serde(default)]
    pub command: String,
    pub claude: Option<ClaudeLaunch>,
}

/// Quoting rules differ per shell, so each resolved shell carries its syntax.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellSyntax {
    PowerShell,
    Cmd,
    Posix,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellProgram {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub syntax: ShellSyntax,
}

/// Everything needed to start a process in a PTY, independent of Tauri.
#[derive(Debug, Clone)]
pub struct SpawnPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    /// Typed into the shell right after it starts, e.g. `claude --resume <id>\r`.
    pub initial_input: Option<String>,
}

/// Finds an executable on PATH. Injected so tests don't depend on the machine.
pub type Locate<'a> = &'a dyn Fn(&str) -> Option<PathBuf>;

pub fn which_locate(name: &str) -> Option<PathBuf> {
    which::which(name).ok()
}

pub fn resolve_shell(_kind: ShellKind, _locate: Locate) -> AppResult<ShellProgram> {
    todo!()
}

pub fn find_git_bash(_git: &Path) -> Option<PathBuf> {
    todo!()
}

pub fn quote(_syntax: ShellSyntax, _value: &str) -> String {
    todo!()
}

pub fn preset_command(_spec: &SpawnSpec, _syntax: ShellSyntax) -> AppResult<Option<String>> {
    todo!()
}

pub fn build_plan(_node_id: &str, _spec: &SpawnSpec, _locate: Locate) -> AppResult<SpawnPlan> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";

    fn nothing_on_path(_: &str) -> Option<PathBuf> {
        None
    }

    fn spec(preset: Preset, claude: Option<ClaudeLaunch>) -> SpawnSpec {
        SpawnSpec {
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            shell: ShellKind::Cmd,
            preset,
            command: String::new(),
            claude,
        }
    }

    fn claude(mode: ClaudeMode, title: &str) -> Option<ClaudeLaunch> {
        Some(ClaudeLaunch { mode, session_id: SESSION.into(), title: title.into() })
    }

    #[test]
    fn quotes_for_powershell_doubling_all_single_quote_variants() {
        assert_eq!(quote(ShellSyntax::PowerShell, "it's"), "'it''s'");
        assert_eq!(quote(ShellSyntax::PowerShell, "l\u{2019}api"), "'l\u{2019}\u{2019}api'");
        assert_eq!(quote(ShellSyntax::PowerShell, "$env:PATH"), "'$env:PATH'");
    }

    #[test]
    fn quotes_for_posix_shells() {
        assert_eq!(quote(ShellSyntax::Posix, "it's"), r"'it'\''s'");
    }

    #[test]
    fn quotes_for_cmd_by_dropping_expansion_characters() {
        assert_eq!(quote(ShellSyntax::Cmd, "50% \"done\"!"), "\"50 done\"");
    }

    #[test]
    fn new_claude_session_passes_id_and_title() {
        let cmd = preset_command(&spec(Preset::Claude, claude(ClaudeMode::New, "Mon agent")), ShellSyntax::PowerShell).unwrap();
        assert_eq!(cmd.as_deref(), Some("claude --session-id 0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10 -n 'Mon agent'"));
    }

    #[test]
    fn new_claude_session_without_title_omits_name() {
        let cmd = preset_command(&spec(Preset::Claude, claude(ClaudeMode::New, "  ")), ShellSyntax::Posix).unwrap();
        assert_eq!(cmd.as_deref(), Some("claude --session-id 0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10"));
    }

    #[test]
    fn resume_and_continue_modes() {
        let resume = preset_command(&spec(Preset::Claude, claude(ClaudeMode::Resume, "x")), ShellSyntax::Cmd).unwrap();
        assert_eq!(resume.as_deref(), Some("claude --resume 0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10"));
        let cont = preset_command(&spec(Preset::Claude, claude(ClaudeMode::Continue, "x")), ShellSyntax::Cmd).unwrap();
        assert_eq!(cont.as_deref(), Some("claude --continue"));
    }

    #[test]
    fn rejects_a_session_id_that_is_not_a_uuid() {
        let launch = Some(ClaudeLaunch { mode: ClaudeMode::Resume, session_id: "x; rm -rf /".into(), title: String::new() });
        let err = preset_command(&spec(Preset::Claude, launch), ShellSyntax::Posix).unwrap_err();
        assert_eq!(err.kind(), "invalidInput");
    }

    #[test]
    fn custom_preset_requires_a_command() {
        let mut s = spec(Preset::Custom, None);
        assert_eq!(preset_command(&s, ShellSyntax::Cmd).unwrap_err().kind(), "invalidInput");
        s.command = "  npm run dev ".into();
        assert_eq!(preset_command(&s, ShellSyntax::Cmd).unwrap().as_deref(), Some("npm run dev"));
    }

    #[test]
    fn shell_preset_types_nothing() {
        assert_eq!(preset_command(&spec(Preset::Shell, None), ShellSyntax::Cmd).unwrap(), None);
    }

    #[test]
    fn plan_types_command_with_carriage_return_and_sets_env() {
        let plan = build_plan("node-1", &spec(Preset::Aider, None), &nothing_on_path).unwrap();
        assert_eq!(plan.program, PathBuf::from("cmd.exe"));
        assert_eq!(plan.initial_input.as_deref(), Some("aider\r"));
        assert!(plan.env.contains(&("DUMMYPLANE_NODE_ID".into(), "node-1".into())));
        assert!(plan.env.contains(&("TERM".into(), "xterm-256color".into())));
    }

    #[test]
    fn plan_rejects_missing_working_directory() {
        let mut s = spec(Preset::Shell, None);
        s.cwd = "Z:/definitely/not/here".into();
        assert_eq!(build_plan("n", &s, &nothing_on_path).unwrap_err().kind(), "notFound");
    }

    #[test]
    fn pwsh_must_be_on_path() {
        assert_eq!(resolve_shell(ShellKind::Pwsh, &nothing_on_path).unwrap_err().kind(), "notFound");
        let found = resolve_shell(ShellKind::Pwsh, &|_| Some(PathBuf::from("C:/pwsh/pwsh.exe"))).unwrap();
        assert_eq!(found.syntax, ShellSyntax::PowerShell);
        assert_eq!(found.args, vec!["-NoLogo".to_string()]);
    }

    #[test]
    fn finds_git_bash_from_either_git_location() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("bin")).unwrap();
        std::fs::write(root.path().join("bin").join("bash.exe"), b"").unwrap();
        let expected = Some(root.path().join("bin").join("bash.exe"));
        assert_eq!(find_git_bash(&root.path().join("cmd").join("git.exe")), expected);
        assert_eq!(find_git_bash(&root.path().join("mingw64").join("bin").join("git.exe")), expected);
        assert_eq!(find_git_bash(Path::new("C:/nowhere/git.exe")), None);
    }

    #[test]
    fn deserializes_spawn_spec_from_frontend_json() {
        let json = serde_json::json!({
            "cwd": "C:/code", "shell": "gitbash", "preset": "claude", "command": "",
            "claude": { "mode": "resume", "sessionId": SESSION, "title": "t" }
        });
        let s: SpawnSpec = serde_json::from_value(json).unwrap();
        assert_eq!(s.shell, ShellKind::GitBash);
        assert_eq!(s.claude.unwrap().mode, ClaudeMode::Resume);
    }
}
```

- [ ] **Step 4 : Vérifier que les tests échouent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml`
Attendu : `error::tests::serializes_as_kind_and_message` et `deserializes_spawn_spec_from_frontend_json` passent ; les 13 autres tests de `pty::shell` échouent avec `not yet implemented`.

- [ ] **Step 5 : Implémenter**

Dans `src-tauri/src/pty/shell.rs`, remplacer les cinq fonctions en `todo!()` (de `pub fn resolve_shell` jusqu'à la fin de `pub fn build_plan`) par :

```rust
pub fn resolve_shell(kind: ShellKind, locate: Locate) -> AppResult<ShellProgram> {
    let program = |name: &str, fallback: &str, args: &[&str], syntax| ShellProgram {
        program: locate(name).unwrap_or_else(|| PathBuf::from(fallback)),
        args: args.iter().map(|a| a.to_string()).collect(),
        syntax,
    };
    match kind {
        ShellKind::Default if cfg!(windows) => resolve_shell(ShellKind::PowerShell, locate),
        ShellKind::Default => Ok(ShellProgram {
            program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()).into(),
            args: vec!["-l".into()],
            syntax: ShellSyntax::Posix,
        }),
        ShellKind::PowerShell => Ok(program("powershell", "powershell.exe", &["-NoLogo"], ShellSyntax::PowerShell)),
        ShellKind::Cmd => Ok(program("cmd", "cmd.exe", &[], ShellSyntax::Cmd)),
        ShellKind::Pwsh => locate("pwsh")
            .map(|p| ShellProgram { program: p, args: vec!["-NoLogo".into()], syntax: ShellSyntax::PowerShell })
            .ok_or_else(|| AppError::NotFound("pwsh introuvable dans le PATH".into())),
        ShellKind::GitBash => locate("git")
            .and_then(|git| find_git_bash(&git))
            .map(|p| ShellProgram { program: p, args: vec!["--login".into(), "-i".into()], syntax: ShellSyntax::Posix })
            .ok_or_else(|| AppError::NotFound("Git Bash introuvable".into())),
    }
}

/// Git for Windows ships `bin\bash.exe` at its root, while `git.exe` lives in `cmd\`
/// or `mingw64\bin\`. Walking up from git avoids picking WSL's `bash.exe` from PATH.
pub fn find_git_bash(git: &Path) -> Option<PathBuf> {
    git.ancestors()
        .skip(1)
        .take(4)
        .map(|dir| dir.join("bin").join("bash.exe"))
        .find(|candidate| candidate.is_file())
}

/// Quotes one argument for the given shell's interactive syntax.
pub fn quote(syntax: ShellSyntax, value: &str) -> String {
    match syntax {
        // PowerShell also treats typographic single quotes as quote characters.
        ShellSyntax::PowerShell => {
            let mut out = String::from("'");
            for c in value.chars() {
                if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
                    out.push(c);
                }
                out.push(c);
            }
            out.push('\'');
            out
        }
        ShellSyntax::Posix => format!("'{}'", value.replace('\'', r"'\''")),
        // cmd has no reliable escape for `%` and `!` inside quotes, so we drop the
        // characters cmd would interpret rather than risk variable expansion.
        ShellSyntax::Cmd => {
            let safe: String = value.chars().filter(|c| !matches!(c, '"' | '%' | '!' | '^')).collect();
            format!("\"{safe}\"")
        }
    }
}

/// The command typed into the shell for a preset, or `None` for a plain shell.
pub fn preset_command(spec: &SpawnSpec, syntax: ShellSyntax) -> AppResult<Option<String>> {
    Ok(match spec.preset {
        Preset::Shell => None,
        Preset::Aider => Some("aider".into()),
        Preset::Codex => Some("codex".into()),
        Preset::Custom => {
            let command = spec.command.trim();
            if command.is_empty() {
                return Err(AppError::InvalidInput("la commande personnalisée est vide".into()));
            }
            Some(command.to_string())
        }
        Preset::Claude => Some(claude_command(spec.claude.as_ref(), syntax)?),
    })
}

fn claude_command(launch: Option<&ClaudeLaunch>, syntax: ShellSyntax) -> AppResult<String> {
    let launch = launch.ok_or_else(|| AppError::InvalidInput("options Claude manquantes".into()))?;
    if launch.mode == ClaudeMode::Continue {
        return Ok("claude --continue".into());
    }
    // Parsing guarantees the id is a bare UUID, so it never needs quoting.
    let session = uuid::Uuid::parse_str(&launch.session_id)
        .map_err(|_| AppError::InvalidInput(format!("identifiant de session invalide : {}", launch.session_id)))?;
    Ok(match launch.mode {
        ClaudeMode::Resume => format!("claude --resume {session}"),
        _ if launch.title.trim().is_empty() => format!("claude --session-id {session}"),
        _ => format!("claude --session-id {session} -n {}", quote(syntax, launch.title.trim())),
    })
}

pub fn build_plan(node_id: &str, spec: &SpawnSpec, locate: Locate) -> AppResult<SpawnPlan> {
    let cwd = PathBuf::from(&spec.cwd);
    if !cwd.is_dir() {
        return Err(AppError::NotFound(format!("dossier introuvable : {}", spec.cwd)));
    }
    let shell = resolve_shell(spec.shell, locate)?;
    let initial_input = preset_command(spec, shell.syntax)?.map(|command| format!("{command}\r"));
    Ok(SpawnPlan {
        program: shell.program,
        args: shell.args,
        cwd,
        env: vec![
            ("TERM".into(), "xterm-256color".into()),
            ("COLORTERM".into(), "truecolor".into()),
            ("DUMMYPLANE".into(), "1".into()),
            ("DUMMYPLANE_NODE_ID".into(), node_id.into()),
        ],
        initial_input,
    })
}
```

- [ ] **Step 6 : Vérifier que les tests passent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml`
Attendu : `test result: ok. 20 passed` (5 scrollback + 1 erreur + 14 shell).

- [ ] **Step 7 : Commit**

```bash
git add src-tauri
git commit -m "feat(pty): plan shell launches with Claude session flags and safe quoting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10 : Préréglages et shells disponibles

**Files:**
- Create : `src-tauri/src/presets.rs`
- Modify : `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes : `Preset`, `ShellKind`, `Locate`, `find_git_bash` (Task 9).
- Produces : `pub struct PresetInfo { pub id: Preset, pub available: bool }` (sérialisé `{ id, available }`), `list_presets(locate) -> Vec<PresetInfo>`, `list_shells(locate) -> Vec<ShellKind>`.

- [ ] **Step 1 : Écrire les tests avec des fonctions vides**

`src-tauri/src/presets.rs` :

```rust
use serde::Serialize;

use crate::pty::shell::{find_git_bash, Locate, Preset, ShellKind};

/// Availability of a launch preset; labels live in the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: Preset,
    pub available: bool,
}

pub fn list_presets(_locate: Locate) -> Vec<PresetInfo> {
    todo!()
}

pub fn list_shells(_locate: Locate) -> Vec<ShellKind> {
    let _ = find_git_bash;
    todo!()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn marks_agents_available_only_when_found_on_path() {
        let locate = |name: &str| (name == "claude").then(|| PathBuf::from("C:/npm/claude.cmd"));
        let presets = list_presets(&locate);
        let available: Vec<_> = presets.iter().filter(|p| p.available).map(|p| p.id).collect();
        assert_eq!(available, vec![Preset::Claude, Preset::Shell, Preset::Custom]);
    }

    #[test]
    fn serializes_preset_ids_in_lowercase() {
        let json = serde_json::to_value(PresetInfo { id: Preset::Claude, available: true }).unwrap();
        assert_eq!(json, serde_json::json!({ "id": "claude", "available": true }));
    }

    #[cfg(windows)]
    #[test]
    fn lists_builtin_windows_shells_and_optional_pwsh() {
        assert_eq!(list_shells(&|_| None), vec![ShellKind::PowerShell, ShellKind::Cmd]);
        let with_pwsh = list_shells(&|name: &str| (name == "pwsh").then(|| PathBuf::from("C:/pwsh.exe")));
        assert_eq!(with_pwsh, vec![ShellKind::PowerShell, ShellKind::Cmd, ShellKind::Pwsh]);
    }
}
```

Dans `src-tauri/src/lib.rs`, ajouter `mod presets;` sous `mod error;`.

- [ ] **Step 2 : Vérifier que les tests échouent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml presets`
Attendu : `marks_agents_available_only_when_found_on_path` et `lists_builtin_windows_shells_and_optional_pwsh` FAILED (`not yet implemented`) ; `serializes_preset_ids_in_lowercase` passe.

- [ ] **Step 3 : Implémenter**

Remplacer les deux fonctions en `todo!()` par :

```rust
pub fn list_presets(locate: Locate) -> Vec<PresetInfo> {
    let on_path = |name: &str| locate(name).is_some();
    vec![
        PresetInfo { id: Preset::Claude, available: on_path("claude") },
        PresetInfo { id: Preset::Aider, available: on_path("aider") },
        PresetInfo { id: Preset::Codex, available: on_path("codex") },
        PresetInfo { id: Preset::Shell, available: true },
        PresetInfo { id: Preset::Custom, available: true },
    ]
}

/// Shells that can actually be started on this machine, default first.
pub fn list_shells(locate: Locate) -> Vec<ShellKind> {
    let mut shells = if cfg!(windows) {
        vec![ShellKind::PowerShell, ShellKind::Cmd]
    } else {
        vec![ShellKind::Default]
    };
    if locate("pwsh").is_some() {
        shells.push(ShellKind::Pwsh);
    }
    if cfg!(windows) && locate("git").and_then(|git| find_git_bash(&git)).is_some() {
        shells.push(ShellKind::GitBash);
    }
    shells
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml presets`
Attendu : `test result: ok. 3 passed`.

- [ ] **Step 5 : Commit**

```bash
git add src-tauri/src
git commit -m "feat(pty): report available presets and shells

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11 : Sessions PTY et gestionnaire

**Files:**
- Create : `src-tauri/src/pty/session.rs`
- Modify : `src-tauri/src/pty/mod.rs`, `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes : `SpawnPlan` (Task 9), `Scrollback`, `SCROLLBACK_CAPACITY` (Task 8), `AppError` (Task 9).
- Produces :
  - `pub trait OutputSink: Send { fn send(&self, bytes: &[u8]) -> bool; }` ;
  - `pub fn pty_size(cols: u16, rows: u16) -> PtySize` (bornes min 1) ; `pub use portable_pty::PtySize` ;
  - `#[derive(Default)] pub struct PtyManager` avec :
    - `spawn(&self, node_id: &str, plan: SpawnPlan, size: PtySize, sink: Box<dyn OutputSink>, on_exit: impl FnOnce(Option<u32>) + Send + 'static) -> AppResult<Option<u32>>` (renvoie le pid) ;
    - `attach(&self, node_id, sink) -> bool`, `write(&self, node_id, data: &[u8]) -> AppResult<()>`, `resize(&self, node_id, size) -> AppResult<()>`, `kill(&self, node_id)`, `kill_all(&self)`, `list(&self) -> Vec<String>`, `scrollback(&self, node_id) -> Option<Vec<u8>>`.

- [ ] **Step 1 : Ajouter `portable-pty`**

```bash
cd src-tauri
cargo add portable-pty@0.9.0
cd ..
```

- [ ] **Step 2 : Écrire la session**

`src-tauri/src/pty/session.rs` :

```rust
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::scrollback::{Scrollback, SCROLLBACK_CAPACITY};
use super::shell::SpawnPlan;
use crate::error::{AppError, AppResult};

/// Receives raw PTY output. Implemented by the Tauri channel in production and by
/// an in-memory buffer in tests.
pub trait OutputSink: Send {
    /// Returns false once the receiver is gone, so the reader stops forwarding to it.
    fn send(&self, bytes: &[u8]) -> bool;
}

/// Scrollback and sink share one lock so that re-attaching (snapshot + sink swap)
/// can never miss or duplicate a chunk the reader is forwarding at the same time.
struct Output {
    scrollback: Scrollback,
    sink: Option<Box<dyn OutputSink>>,
}

pub struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    output: Mutex<Output>,
    pub pid: Option<u32>,
}

pub struct Started {
    pub session: Arc<Session>,
    pub child: Box<dyn Child + Send + Sync>,
    pub reader: JoinHandle<()>,
}

pub fn pty_err(err: impl std::fmt::Display) -> AppError {
    AppError::Pty(err.to_string())
}

impl Session {
    pub fn start(plan: SpawnPlan, size: PtySize, sink: Box<dyn OutputSink>) -> AppResult<Started> {
        let pair = native_pty_system().openpty(size).map_err(pty_err)?;
        let mut cmd = CommandBuilder::new(&plan.program);
        cmd.args(&plan.args);
        cmd.cwd(&plan.cwd);
        for (key, value) in &plan.env {
            cmd.env(key, value);
        }
        let child = pair.slave.spawn_command(cmd).map_err(pty_err)?;
        // The child owns its end now; keeping ours open would delay EOF on exit.
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(pty_err)?;
        let mut writer = pair.master.take_writer().map_err(pty_err)?;
        if let Some(input) = &plan.initial_input {
            writer.write_all(input.as_bytes())?;
        }

        let session = Arc::new(Session {
            writer: Mutex::new(writer),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(child.clone_killer()),
            output: Mutex::new(Output { scrollback: Scrollback::new(SCROLLBACK_CAPACITY), sink: Some(sink) }),
            pid: child.process_id(),
        });
        let reader = spawn_reader(reader, session.clone());
        Ok(Started { session, child, reader })
    }

    pub fn write(&self, data: &[u8]) -> AppResult<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, size: PtySize) -> AppResult<()> {
        if let Some(master) = self.master.lock().unwrap().as_ref() {
            master.resize(size).map_err(pty_err)?;
        }
        Ok(())
    }

    /// Best effort: the process may already be gone.
    pub fn kill(&self) {
        let _ = self.killer.lock().unwrap().kill();
    }

    /// Closing the pseudo console is what lets the reader reach EOF on Windows.
    pub fn close(&self) {
        self.master.lock().unwrap().take();
    }

    pub fn attach(&self, sink: Box<dyn OutputSink>) {
        let mut output = self.output.lock().unwrap();
        let snapshot = output.scrollback.snapshot();
        if !snapshot.is_empty() {
            sink.send(&snapshot);
        }
        output.sink = Some(sink);
    }

    pub fn scrollback(&self) -> Vec<u8> {
        self.output.lock().unwrap().scrollback.snapshot()
    }
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, session: Arc<Session>) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    let mut output = session.output.lock().unwrap();
                    output.scrollback.push(chunk);
                    if output.sink.as_ref().is_some_and(|sink| !sink.send(chunk)) {
                        output.sink = None;
                    }
                }
            }
        }
    })
}
```

- [ ] **Step 3 : Écrire les tests du gestionnaire, avec des méthodes vides**

Remplacer tout `src-tauri/src/pty/mod.rs` par :

```rust
pub mod scrollback;
pub mod session;
pub mod shell;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub use portable_pty::PtySize;

use crate::error::AppResult;
use session::{OutputSink, Session};
use shell::SpawnPlan;

/// Owns every running terminal, keyed by canvas node id.
#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
}

pub fn pty_size(_cols: u16, _rows: u16) -> PtySize {
    todo!()
}

impl PtyManager {
    pub fn spawn(
        &self,
        _node_id: &str,
        _plan: SpawnPlan,
        _size: PtySize,
        _sink: Box<dyn OutputSink>,
        _on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> AppResult<Option<u32>> {
        todo!()
    }

    pub fn attach(&self, _node_id: &str, _sink: Box<dyn OutputSink>) -> bool {
        todo!()
    }

    pub fn write(&self, _node_id: &str, _data: &[u8]) -> AppResult<()> {
        todo!()
    }

    pub fn resize(&self, _node_id: &str, _size: PtySize) -> AppResult<()> {
        todo!()
    }

    pub fn kill(&self, _node_id: &str) {
        todo!()
    }

    pub fn kill_all(&self) {
        todo!()
    }

    pub fn list(&self) -> Vec<String> {
        todo!()
    }

    pub fn scrollback(&self, _node_id: &str) -> Option<Vec<u8>> {
        let _ = &self.sessions;
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_is_clamped_to_one_cell_when_the_host_is_hidden() {
        // fit() reports 0x0 for a collapsed or not-yet-laid-out container.
        let size = pty_size(0, 0);
        assert_eq!((size.cols, size.rows), (1, 1));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use super::*;

    #[derive(Clone, Default)]
    struct VecSink(Arc<Mutex<Vec<u8>>>);

    impl OutputSink for VecSink {
        fn send(&self, bytes: &[u8]) -> bool {
            self.0.lock().unwrap().extend_from_slice(bytes);
            true
        }
    }

    impl VecSink {
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
        }
    }

    fn cmd_plan(args: &[&str], initial_input: Option<&str>) -> SpawnPlan {
        SpawnPlan {
            program: "cmd.exe".into(),
            args: args.iter().map(|a| a.to_string()).collect(),
            cwd: std::env::temp_dir(),
            env: vec![],
            initial_input: initial_input.map(str::to_string),
        }
    }

    fn wait_until(what: &str, mut cond: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !cond() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// ConPTY is created with PSEUDOCONSOLE_INHERIT_CURSOR, so it asks for the cursor
    /// position (`ESC[6n`) and blocks until it gets an answer. xterm.js answers in the
    /// app; tests have to play that role.
    fn spawn_answering(mgr: &PtyManager, id: &str, plan: SpawnPlan, sink: VecSink) -> mpsc::Receiver<Option<u32>> {
        let (tx, rx) = mpsc::channel();
        mgr.spawn(id, plan, pty_size(80, 24), Box::new(sink.clone()), move |code| {
            let _ = tx.send(code);
        })
        .unwrap();
        wait_until("cursor position query", || sink.text().contains("\x1b[6n"));
        mgr.write(id, b"\x1b[1;1R").unwrap();
        rx
    }

    #[test]
    fn streams_output_and_reports_exit_code() {
        let mgr = PtyManager::default();
        let sink = VecSink::default();
        let exited = spawn_answering(&mgr, "a", cmd_plan(&["/c", "echo dummyplane-hello"], None), sink.clone());
        let code = exited.recv_timeout(Duration::from_secs(20)).expect("process should exit");
        assert_eq!(code, Some(0));
        assert!(sink.text().contains("dummyplane-hello"), "output: {:?}", sink.text());
        assert!(mgr.list().is_empty());
        assert!(mgr.scrollback("a").is_none());
    }

    #[test]
    fn types_initial_input_before_the_cursor_query_is_answered() {
        let mgr = PtyManager::default();
        let sink = VecSink::default();
        let exited = spawn_answering(&mgr, "b", cmd_plan(&[], Some("echo from-initial\r")), sink.clone());
        wait_until("initial input output", || sink.text().contains("from-initial"));
        mgr.write("b", b"echo from-write\rexit\r").unwrap();
        exited.recv_timeout(Duration::from_secs(20)).expect("cmd should exit");
        assert!(sink.text().contains("from-write"), "output: {:?}", sink.text());
    }

    #[test]
    fn runs_in_a_folder_with_spaces_and_accents() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("Mes projets é");
        std::fs::create_dir(&folder).unwrap();
        let mut plan = cmd_plan(&["/c", "cd"], None);
        plan.cwd = folder.clone();
        let sink = VecSink::default();
        let exited = spawn_answering(&PtyManager::default(), "e", plan, sink.clone());
        assert_eq!(exited.recv_timeout(Duration::from_secs(20)).expect("should exit"), Some(0));
        assert!(sink.text().contains("Mes projets é"), "output: {:?}", sink.text());
    }

    #[test]
    fn attach_replays_scrollback_to_the_new_sink() {
        let mgr = PtyManager::default();
        let first = VecSink::default();
        let exited = spawn_answering(&mgr, "c", cmd_plan(&[], Some("echo before-attach\r")), first.clone());
        wait_until("first output", || first.text().contains("before-attach"));
        let second = VecSink::default();
        assert!(mgr.attach("c", Box::new(second.clone())));
        assert!(second.text().contains("before-attach"));
        mgr.kill("c");
        exited.recv_timeout(Duration::from_secs(20)).expect("killed process should exit");
        assert!(!mgr.attach("c", Box::new(VecSink::default())));
    }

    #[test]
    fn rejects_a_second_spawn_for_the_same_node_and_resizes() {
        let mgr = PtyManager::default();
        let exited = spawn_answering(&mgr, "d", cmd_plan(&[], None), VecSink::default());
        let again = mgr.spawn("d", cmd_plan(&[], None), pty_size(80, 24), Box::new(VecSink::default()), |_| {});
        assert_eq!(again.unwrap_err().kind(), "invalidInput");
        mgr.resize("d", pty_size(120, 40)).unwrap();
        assert_eq!(mgr.list(), vec!["d".to_string()]);
        mgr.kill_all();
        exited.recv_timeout(Duration::from_secs(20)).expect("kill_all should stop it");
    }

    #[test]
    fn unknown_terminals_are_not_found_and_kill_is_idempotent() {
        let mgr = PtyManager::default();
        assert_eq!(mgr.write("nope", b"x").unwrap_err().kind(), "notFound");
        assert_eq!(mgr.resize("nope", pty_size(80, 24)).unwrap_err().kind(), "notFound");
        mgr.kill("nope");
    }
}
```

- [ ] **Step 4 : Vérifier que les tests échouent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml pty::`
Attendu : les 7 tests de `pty::tests` et `pty::windows_tests` FAILED (`not yet implemented`) ; les tests `pty::scrollback` et `pty::shell` passent toujours.

- [ ] **Step 5 : Implémenter le gestionnaire**

Dans `src-tauri/src/pty/mod.rs`, remplacer le bloc qui va de `use crate::error::AppResult;` jusqu'à la fin du `impl PtyManager` (avant `#[cfg(test)]`) par :

```rust
use crate::error::{AppError, AppResult};
use session::{OutputSink, Session, Started};
use shell::SpawnPlan;

/// Owns every running terminal, keyed by canvas node id.
#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
}

pub fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

impl PtyManager {
    pub fn spawn(
        &self,
        node_id: &str,
        plan: SpawnPlan,
        size: PtySize,
        sink: Box<dyn OutputSink>,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> AppResult<Option<u32>> {
        let mut sessions = self.sessions.lock().unwrap();
        if sessions.contains_key(node_id) {
            return Err(AppError::InvalidInput(format!("le terminal {node_id} tourne déjà")));
        }
        let Started { session, mut child, reader } = Session::start(plan, size, sink)?;
        sessions.insert(node_id.to_string(), session.clone());
        drop(sessions);

        let pid = session.pid;
        let sessions = self.sessions.clone();
        let node_id = node_id.to_string();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            session.close();
            // Join so every byte reaches the sink before the exit is reported.
            let _ = reader.join();
            sessions.lock().unwrap().remove(&node_id);
            on_exit(code);
        });
        Ok(pid)
    }

    /// Sends the current scrollback to `sink`, then streams new output to it.
    /// Returns false when no session is running for `node_id`.
    pub fn attach(&self, node_id: &str, sink: Box<dyn OutputSink>) -> bool {
        match self.get(node_id) {
            Some(session) => {
                session.attach(sink);
                true
            }
            None => false,
        }
    }

    pub fn write(&self, node_id: &str, data: &[u8]) -> AppResult<()> {
        self.require(node_id)?.write(data)
    }

    pub fn resize(&self, node_id: &str, size: PtySize) -> AppResult<()> {
        self.require(node_id)?.resize(size)
    }

    /// Idempotent: killing a terminal that already exited is not an error.
    pub fn kill(&self, node_id: &str) {
        if let Some(session) = self.get(node_id) {
            session.kill();
        }
    }

    pub fn kill_all(&self) {
        for session in self.sessions.lock().unwrap().values() {
            session.kill();
        }
    }

    pub fn list(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }

    pub fn scrollback(&self, node_id: &str) -> Option<Vec<u8>> {
        self.get(node_id).map(|session| session.scrollback())
    }

    fn get(&self, node_id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().unwrap().get(node_id).cloned()
    }

    fn require(&self, node_id: &str) -> AppResult<Arc<Session>> {
        self.get(node_id)
            .ok_or_else(|| AppError::NotFound(format!("aucun terminal actif pour {node_id}")))
    }
}
```

- [ ] **Step 6 : Vérifier que les tests passent**

Run : `cargo test --manifest-path src-tauri/Cargo.toml`
Attendu : `test result: ok. 30 passed` (5 scrollback + 1 erreur + 14 shell + 3 presets + 7 pty), en moins d'une seconde pour les tests PTY. Si un test PTY reste bloqué 20 s puis échoue sur `cursor position query`, vérifier que rien ne filtre la sortie du PTY avant `VecSink`.

- [ ] **Step 7 : Commit**

```bash
git add src-tauri
git commit -m "feat(pty): run processes in ConPTY sessions with scrollback and re-attach

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12 : Commandes Tauri, API front et vrai PowerShell dans le prototype

**Files:**
- Create : `src/ipc/pty.ts`, `src/ipc/pty.test.ts`
- Modify : `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/spike/registry.ts`, `src/spike/SpikePanel.tsx`

**Interfaces:**
- Consumes : `PtyManager`, `pty_size`, `OutputSink` (Task 11) ; `build_plan`, `which_locate`, `SpawnSpec`, `ShellKind` (Task 9) ; `list_presets`, `list_shells`, `PresetInfo` (Task 10) ; `call` (Task 3).
- Produces :
  - commandes Rust `pty_spawn(nodeId, spec, cols, rows, onData) -> Option<u32>`, `pty_attach(nodeId, onData) -> bool`, `pty_write(nodeId, data)`, `pty_resize(nodeId, cols, rows)`, `pty_kill(nodeId)`, `pty_list() -> Vec<String>`, `get_scrollback(nodeId) -> octets bruts`, `list_presets() -> Vec<PresetInfo>`, `list_shells() -> Vec<ShellKind>` ; événement `pty-exit` `{ nodeId, exitCode }` ;
  - TS `ptySpawn`, `ptyAttach`, `ptyWrite`, `ptyResize`, `ptyKill`, `ptyList`, `listPresets`, `listShells`, `getScrollback`, `onPtyExit`, `toBytes`, et les types `ShellKind`, `Preset`, `ClaudeMode`, `ClaudeLaunch`, `SpawnSpec`, `PresetInfo`, `PtyExitEvent`.

- [ ] **Step 1 : Écrire les tests de l'API front**

`src/ipc/pty.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { getScrollback, ptyWrite, toBytes } from "./pty";

afterEach(() => clearMocks());

it("passes ArrayBuffer payloads through untouched", () => {
  const buffer = new Uint8Array([0x1b, 0x5b, 0x6d]).buffer;
  expect(Array.from(toBytes(buffer))).toEqual([0x1b, 0x5b, 0x6d]);
});

it("keeps a UTF-8 sequence split across chunks as raw bytes", () => {
  // "é" is 0xC3 0xA9; a PTY read can end between the two bytes.
  expect(Array.from(toBytes([0x61, 0xc3]))).toEqual([0x61, 0xc3]);
  expect(Array.from(toBytes(new Uint8Array([0xa9]).buffer))).toEqual([0xa9]);
});

it("sends camelCase arguments to Rust commands", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    received = { cmd, args };
  });
  await ptyWrite("node-1", "ls\r");
  expect(received).toEqual({ cmd: "pty_write", args: { nodeId: "node-1", data: "ls\r" } });
});

it("decodes scrollback returned as raw bytes", async () => {
  mockIPC(() => new Uint8Array([104, 105]).buffer);
  expect(new TextDecoder().decode(await getScrollback("node-1"))).toBe("hi");
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent**

Run : `pnpm test`
Attendu : FAIL, `Failed to resolve import "./pty"`.

- [ ] **Step 3 : Écrire l'API front**

`src/ipc/pty.ts` :

```ts
import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./invoke";

export type ShellKind = "default" | "powershell" | "pwsh" | "cmd" | "gitbash";
export type Preset = "claude" | "aider" | "codex" | "shell" | "custom";
export type ClaudeMode = "new" | "resume" | "continue";

export interface ClaudeLaunch {
  mode: ClaudeMode;
  sessionId: string;
  title: string;
}

/** Mirrors Rust's `SpawnSpec` (spec §9). */
export interface SpawnSpec {
  cwd: string;
  shell: ShellKind;
  preset: Preset;
  command: string;
  claude?: ClaudeLaunch;
}

export interface PresetInfo {
  id: Preset;
  available: boolean;
}

export interface PtyExitEvent {
  nodeId: string;
  exitCode: number | null;
}

/** Raw channel payloads arrive as ArrayBuffer; Tauri < 2.5.1 sent small ones as number[]. */
export function toBytes(message: ArrayBuffer | number[]): Uint8Array {
  return message instanceof ArrayBuffer ? new Uint8Array(message) : Uint8Array.from(message);
}

// Output stays as bytes end to end: decoding chunk by chunk would corrupt UTF-8
// sequences split across reads, while xterm's write(Uint8Array) decodes statefully.
function byteChannel(onData: (bytes: Uint8Array) => void): Channel<ArrayBuffer | number[]> {
  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (message) => onData(toBytes(message));
  return channel;
}

export function ptySpawn(
  nodeId: string,
  spec: SpawnSpec,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
): Promise<number | null> {
  return call("pty_spawn", { nodeId, spec, cols, rows, onData: byteChannel(onData) });
}

/** Reconnects to a live session; the current scrollback is sent first. */
export function ptyAttach(nodeId: string, onData: (bytes: Uint8Array) => void): Promise<boolean> {
  return call("pty_attach", { nodeId, onData: byteChannel(onData) });
}

export const ptyWrite = (nodeId: string, data: string) => call<void>("pty_write", { nodeId, data });
export const ptyResize = (nodeId: string, cols: number, rows: number) => call<void>("pty_resize", { nodeId, cols, rows });
export const ptyKill = (nodeId: string) => call<void>("pty_kill", { nodeId });
export const ptyList = () => call<string[]>("pty_list");
export const listPresets = () => call<PresetInfo[]>("list_presets");
export const listShells = () => call<ShellKind[]>("list_shells");

export async function getScrollback(nodeId: string): Promise<Uint8Array> {
  return toBytes(await call<ArrayBuffer | number[]>("get_scrollback", { nodeId }));
}

export function onPtyExit(handler: (event: PtyExitEvent) => void): Promise<UnlistenFn> {
  return listen<PtyExitEvent>("pty-exit", (event) => handler(event.payload));
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `pnpm test`
Attendu : `Tests  24 passed (24)`.

- [ ] **Step 5 : Commandes Rust**

Remplacer tout `src-tauri/src/commands.rs` par :

```rust
use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, State};

use crate::error::AppResult;
use crate::presets::{self, PresetInfo};
use crate::pty::session::OutputSink;
use crate::pty::shell::{build_plan, which_locate, ShellKind, SpawnSpec};
use crate::pty::{pty_size, PtyManager};

/// Forwards PTY output to the webview as raw bytes (an `ArrayBuffer` in JS).
struct ChannelSink(Channel<Response>);

impl OutputSink for ChannelSink {
    fn send(&self, bytes: &[u8]) -> bool {
        self.0.send(Response::new(bytes.to_vec())).is_ok()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    node_id: String,
    exit_code: Option<u32>,
}

#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    pty: State<'_, PtyManager>,
    node_id: String,
    spec: SpawnSpec,
    cols: u16,
    rows: u16,
    on_data: Channel<Response>,
) -> AppResult<Option<u32>> {
    let plan = build_plan(&node_id, &spec, &which_locate)?;
    let exited_id = node_id.clone();
    pty.spawn(&node_id, plan, pty_size(cols, rows), Box::new(ChannelSink(on_data)), move |exit_code| {
        let _ = app.emit("pty-exit", PtyExitEvent { node_id: exited_id, exit_code });
    })
}

#[tauri::command]
pub async fn pty_attach(pty: State<'_, PtyManager>, node_id: String, on_data: Channel<Response>) -> AppResult<bool> {
    Ok(pty.attach(&node_id, Box::new(ChannelSink(on_data))))
}

#[tauri::command]
pub async fn pty_write(pty: State<'_, PtyManager>, node_id: String, data: String) -> AppResult<()> {
    pty.write(&node_id, data.as_bytes())
}

#[tauri::command]
pub async fn pty_resize(pty: State<'_, PtyManager>, node_id: String, cols: u16, rows: u16) -> AppResult<()> {
    pty.resize(&node_id, pty_size(cols, rows))
}

#[tauri::command]
pub async fn pty_kill(pty: State<'_, PtyManager>, node_id: String) -> AppResult<()> {
    pty.kill(&node_id);
    Ok(())
}

#[tauri::command]
pub async fn pty_list(pty: State<'_, PtyManager>) -> AppResult<Vec<String>> {
    Ok(pty.list())
}

/// Live scrollback only for now; milestone 5 falls back to the copy saved in SQLite.
#[tauri::command]
pub async fn get_scrollback(pty: State<'_, PtyManager>, node_id: String) -> AppResult<Response> {
    Ok(Response::new(pty.scrollback(&node_id).unwrap_or_default()))
}

#[tauri::command]
pub async fn list_presets() -> AppResult<Vec<PresetInfo>> {
    Ok(presets::list_presets(&which_locate))
}

#[tauri::command]
pub async fn list_shells() -> AppResult<Vec<ShellKind>> {
    Ok(presets::list_shells(&which_locate))
}
```

Les commandes PTY sont `async` pour s'exécuter hors du thread principal (une commande synchrone de Tauri tourne sur le thread de l'interface).

Remplacer tout `src-tauri/src/lib.rs` par :

```rust
mod commands;
mod error;
mod presets;
mod pty;

use tauri::Manager;

use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::pty_spawn,
            commands::pty_attach,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_list,
            commands::get_scrollback,
            commands::list_presets,
            commands::list_shells,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the dummyPlane application");

    app.run(|handle, event| {
        // Agents must not outlive the window that shows them.
        if let tauri::RunEvent::Exit = event {
            handle.state::<PtyManager>().kill_all();
        }
    });
}
```

- [ ] **Step 6 : Vérifier la compilation sans avertissement**

Run : `cargo build --manifest-path src-tauri/Cargo.toml` puis `cargo test --manifest-path src-tauri/Cargo.toml`
Attendu : aucune ligne `warning:` ; `test result: ok. 30 passed`.

- [ ] **Step 7 : Ajouter un vrai PowerShell au prototype**

Remplacer tout `src/spike/registry.ts` par :

```ts
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { homeDir } from "@tauri-apps/api/path";
import "@xterm/xterm/css/xterm.css";
import { ptyResize, ptySpawn, ptyWrite } from "@/ipc/pty";
import { log } from "./diagnostics";

// Throwaway (milestone 2 prototype). Terminals live outside React so an
// embeddable that Excalidraw unmounts (off-screen, workspace switch) keeps its
// xterm instance; remounting moves the existing DOM element into the new host.
export interface SpikeEntry {
  term: Terminal;
  fit: FitAddon;
  opened: boolean;
}

const entries = new Map<string, SpikeEntry>();
/** Node ids that get a real PowerShell instead of the local echo (milestone 3 check). */
export const realTerminals = new Set<string>();
const PROMPT = "\x1b[32mspike\x1b[0m$ ";

export function spikeEntries(): ReadonlyMap<string, SpikeEntry> {
  return entries;
}

export function getSpikeTerminal(nodeId: string): SpikeEntry {
  const existing = entries.get(nodeId);
  if (existing) return existing;
  const term = new Terminal({ fontFamily: "Cascadia Code, Consolas, monospace", fontSize: 13, cursorBlink: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const entry: SpikeEntry = { term, fit, opened: false };
  entries.set(nodeId, entry);
  if (!realTerminals.has(nodeId)) attachLocalEcho(nodeId, term);
  return entry;
}

/** Puts the terminal into `host`: `open` the first time, re-parent afterwards. */
export function mountInto(entry: SpikeEntry, host: HTMLElement, nodeId: string) {
  if (!entry.opened) {
    entry.term.open(host);
    entry.opened = true;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        log(`[${short(nodeId)}] contexte WebGL perdu → rendu DOM`);
        webgl.dispose();
      });
      entry.term.loadAddon(webgl);
    } catch (error) {
      log(`[${short(nodeId)}] WebGL indisponible : ${String(error)}`);
    }
    entry.fit.fit();
    if (realTerminals.has(nodeId)) void startRealPty(nodeId, entry);
    else entry.term.write(`Prototype ${short(nodeId)} — écho local\r\n${PROMPT}`);
    log(`[${short(nodeId)}] créé`);
  } else if (entry.term.element && entry.term.element.parentElement !== host) {
    host.appendChild(entry.term.element);
    log(`[${short(nodeId)}] remonté avec son état (${entry.term.buffer.active.length} lignes)`);
  }
  entry.fit.fit();
}

export const short = (nodeId: string) => nodeId.slice(0, 4);

async function startRealPty(nodeId: string, { term }: SpikeEntry) {
  term.onData((data) => void ptyWrite(nodeId, data));
  term.onResize(({ cols, rows }) => void ptyResize(nodeId, cols, rows));
  try {
    const spec = { cwd: await homeDir(), shell: "default", preset: "shell", command: "" } as const;
    await ptySpawn(nodeId, spec, term.cols, term.rows, (bytes) => term.write(bytes));
    log(`[${short(nodeId)}] PowerShell réel démarré`);
  } catch (error) {
    term.write(`\r\n\x1b[31mÉchec du lancement : ${String(error)}\x1b[0m\r\n`);
  }
}

function attachLocalEcho(nodeId: string, term: Terminal) {
  term.onData((data) => {
    if (data === "\x1b") {
      log(`[${short(nodeId)}] Échap reçu par le terminal ✔`);
      return;
    }
    if (data.startsWith("\x1b")) {
      log(`[${short(nodeId)}] séquence ${JSON.stringify(data)}`);
      return;
    }
    for (const char of data) {
      if (char === "\r") term.write(`\r\n${PROMPT}`);
      else if (char === "\x7f") term.write("\b \b");
      else if (char >= " ") term.write(char);
    }
  });
}
```

Dans `src/spike/SpikePanel.tsx`, faire trois modifications.

Remplacer la ligne d'import du registre :

```tsx
import { getSpikeTerminal, short, spikeEntries } from "./registry";
```

par :

```tsx
import { onPtyExit } from "@/ipc/pty";
import { getSpikeTerminal, realTerminals, short, spikeEntries } from "./registry";
```

Remplacer le début de `addTerminals` :

```tsx
  const addTerminals = (count: number) => {
    const { scrollX, scrollY, zoom, width, height } = api.getAppState();
    const origin = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
    const added = Array.from({ length: count }, (_, i) =>
      createNodeElement("terminal", { x: origin.x + (i % 5) * 760, y: origin.y + Math.floor(i / 5) * 480 }),
    );
```

par :

```tsx
  useEffect(() => {
    const unlisten = onPtyExit(({ nodeId, exitCode }) => log(`[${short(nodeId)}] processus terminé (code ${exitCode})`));
    return () => void unlisten.then((stop) => stop());
  }, []);

  const addTerminals = (count: number, real = false) => {
    const { scrollX, scrollY, zoom, width, height } = api.getAppState();
    const origin = { x: width / 2 / zoom.value - scrollX, y: height / 2 / zoom.value - scrollY };
    const added = Array.from({ length: count }, (_, i) =>
      createNodeElement("terminal", { x: origin.x + (i % 5) * 760, y: origin.y + Math.floor(i / 5) * 480 }),
    );
    if (real) added.forEach((element) => realTerminals.add(element.id));
```

Remplacer la ligne du bouton « +10 terminaux » :

```tsx
        <Button size="sm" variant="outline" onClick={() => addTerminals(10)}>+10 terminaux</Button>
```

par :

```tsx
        <Button size="sm" variant="outline" onClick={() => addTerminals(10)}>+10 terminaux</Button>
        <Button size="sm" variant="outline" onClick={() => addTerminals(1, true)}>+ PowerShell réel</Button>
```

- [ ] **Step 8 : Vérification complète**

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Attendu : `Tests  24 passed`, build réussi, `test result: ok. 30 passed`.

À la main (`pnpm tauri dev`), avec Mathieu si possible :
1. « + PowerShell réel » : le terminal affiche l'invite PowerShell dans le dossier personnel, avec les couleurs du profil.
2. Taper `dir` puis Entrée : la liste s'affiche, les accents sont corrects.
3. Taper `claude` puis Entrée : Claude Code démarre **avec le compte existant**, sans demander de connexion. Taper `/exit` : retour à PowerShell.
4. Taper `exit` : le journal affiche « processus terminé (code 0) ».
5. Relancer un PowerShell réel, puis fermer la fenêtre dummyPlane : dans le Gestionnaire des tâches, aucun `powershell.exe` ni `node.exe` (Claude) lancé par dummyPlane ne reste.

- [ ] **Step 9 : Commit**

```bash
git add -A
git commit -m "feat(pty): expose PTY commands over Tauri channels and wire a real shell into the prototype

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Fin du plan 1

À la fin de la tâche 12 :
- la décision A/B est consignée dans la spec §15 ;
- le pont PTY est testé (30 tests Rust, dont 5 avec un vrai ConPTY) et vérifié à la main avec une vraie session Claude Code ;
- le prochain document est le plan 2 (jalons 4 à 9), écrit à partir de la décision. Il commencera par supprimer `src/spike/` et remplacer `SpikeTerminal` par le vrai nœud Terminal.

Reportés au plan 2, conformément à la spec : écriture du scrollback en SQLite et à la fermeture (jalon 5), journaux via `tauri-plugin-log` (§10), sélecteur de dossier (`tauri-plugin-dialog`, jalon 4). Écart assumé : l'arrêt des terminaux se fait sur `RunEvent::Exit` (la spec citait `ExitRequested`, qui peut être annulé ; `Exit` est le dernier événement garanti).
