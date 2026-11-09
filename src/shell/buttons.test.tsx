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
  expect(text.className).toContain("bg-dp-accent-soft");
  expect(eraser.getAttribute("aria-pressed")).toBe("false");
  expect(plus.getAttribute("aria-label")).toBe("Nouveau workspace");
  expect(accent.className).toContain("text-dp-on-accent");
  expect(accent.className).toContain("rounded-[10px]");
  await act(async () => root.unmount());
  host.remove();
});
