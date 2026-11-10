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
  expect([text.getAttribute("aria-label"), text.getAttribute("aria-pressed")]).toEqual(["Texte (T)", "true"]);
  // A rail tool names itself in a hint, not a native title: the two would stack.
  expect(text.hasAttribute("title")).toBe(false);
  expect(text.className).toContain("bg-dp-accent-soft");
  expect(eraser.getAttribute("aria-pressed")).toBe("false");
  expect([plus.title, plus.getAttribute("aria-label")]).toEqual(["Nouveau workspace", "Nouveau workspace"]);
  expect(accent.className).toContain("text-dp-on-accent");
  expect(accent.className).toContain("rounded-md");
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
