// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AccentButton, IconButton, ToolButton } from "./buttons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("names every icon button and marks the active rail tool", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <ToolButton toggle label="Texte (T)" active />
        <ToolButton toggle label="Gomme (E)" />
        <IconButton label="Nouveau workspace" />
        <AccentButton>Ajouter un projet</AccentButton>
      </>,
    ),
  );
  const [text, eraser, plus, accent] = [...host.querySelectorAll("button")];
  expect([text.getAttribute("aria-label"), text.getAttribute("aria-pressed")]).toEqual(["Texte (T)", "true"]);
  // A rail tool names itself in a hint, not a native title: the two would stack.
  expect(text.hasAttribute("title")).toBe(false);
  expect(text.className).toContain("bg-dp-accent-soft");
  // A tool that is not in force is an off toggle.
  expect(eraser.getAttribute("aria-pressed")).toBe("false");
  // An icon button names itself in the same hint as the rails', never a native title: a bar mixing both shows two tooltips.
  expect(plus.hasAttribute("title")).toBe(false);
  expect(plus.getAttribute("aria-label")).toBe("Nouveau workspace");
  expect(accent.className).toContain("text-dp-on-accent");
  expect(accent.className).toContain("rounded-md");
  await act(async () => root.unmount());
  host.remove();
});

it("sizes the buttons on the control scale: a rail tool 36 px, an icon button 28 px, an accent button 32 px or the `lg` 36 px", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <ToolButton label="Texte (T)" />
        <IconButton label="Nouveau workspace" />
        <AccentButton>Ajouter</AccentButton>
        <AccentButton size="lg">Installer</AccentButton>
      </>,
    ),
  );
  const [tool, icon, accent, large] = [...host.querySelectorAll("button")];
  expect(tool.className).toMatch(/\bsize-9\b/);
  expect(tool.className, "off the h-7/8/9 scale").not.toContain("h-8.5");
  expect(icon.className).toMatch(/\bsize-7\b/);
  expect(accent.className).toMatch(/\bh-8\b/);
  expect(large.className).toMatch(/\bh-9\b/);
  await act(async () => root.unmount());
  host.remove();
});

it("shows an icon button's name on keyboard focus, in the rails' hint, and keeps it shut while its menu is open", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const hint = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
  await act(async () => root.render(<IconButton label="Nouveau workspace" />));
  await act(async () => host.querySelector("button")!.focus());
  expect(hint()).toBe("Nouveau workspace");
  await act(async () => root.render(<IconButton label="Nouveau workspace" aria-expanded />));
  expect(hint()).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("shows a rail tool's name on keyboard focus, and keeps it shut while the tool's menu is open", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const hint = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
  await act(async () => root.render(<ToolButton label="Gomme (E)" />));
  await act(async () => host.querySelector("button")!.focus());
  expect(hint()).toBe("Gomme (E)");
  await act(async () => root.render(<ToolButton label="Gomme (E)" aria-expanded />));
  expect(hint()).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("says `aria-pressed` only on a real toggle: a one-shot action or a menu trigger is not \"toggle, not pressed\" (P2-7)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <ToolButton label="Fit the view" />
        <ToolButton label="Settings" aria-expanded={false} />
        <ToolButton label="Code Studio" active aria-current="page" />
        <ToolButton toggle label="Agents" active={false} />
      </>,
    ),
  );
  const [fit, settings, code, agents] = [...host.querySelectorAll("button")];
  for (const action of [fit, settings, code]) expect(action.hasAttribute("aria-pressed"), action.getAttribute("aria-label")!).toBe(false);
  // Where the user is: aria-current, and the same accent look as an active tool.
  expect(code.getAttribute("aria-current")).toBe("page");
  expect(code.className).toContain("bg-dp-accent-soft");
  expect(agents.getAttribute("aria-pressed")).toBe("false");
  await act(async () => root.unmount());
  host.remove();
});

it("marks every rail's real toggles, and only them (the tools, the pen, the shapes, the agents panel, the file tree)", async () => {
  const { readSource } = await import("@/theme/cssBlocks");
  const toggles = (file: string) => (readSource(file).match(/<(?:Rail|Tool)Button toggle(?=[\s>])/g) ?? []).length;
  expect(toggles("shell/ToolRail.tsx")).toBe(5);
  expect(toggles("shell/ActivityRail.tsx")).toBe(1);
  expect(toggles("shell/ShapesMenu.tsx")).toBe(1);
  expect(toggles("shell/PenMenu.tsx")).toBe(1);
  expect(toggles("studio/CodeWorkspace.tsx")).toBe(1);
  // The workspaces it goes to say where the user is.
  expect(readSource("shell/ActivityRail.tsx").match(/aria-current=\{(code|notes)OnScreen \? "page" : undefined\}/g)).toHaveLength(2);
});
