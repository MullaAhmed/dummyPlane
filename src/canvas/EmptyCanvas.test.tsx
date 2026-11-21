// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { EmptyCanvas, isEmptyScene } from "./EmptyCanvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => document.body.replaceChildren());

const render = async (show: boolean) => {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(<EmptyCanvas show={show} />));
  return host;
};

it("names the two ways to start an agent that exist, and no key that does nothing", async () => {
  const text = (await render(true)).textContent;
  expect(text).toBe("Right-click to launch an agentOr Ctrl+Shift+P, then type “launch”");
  expect(text).not.toContain("Ctrl+K");
});

it("shows nothing when told not to", async () => {
  expect((await render(false)).querySelector("[data-empty-canvas]")).toBeNull();
});

it("is text only: no button, no image, nothing to press", async () => {
  const host = await render(true);
  expect(host.querySelectorAll("button, a, svg, img, [tabindex]")).toHaveLength(0);
});

it("takes a scene for empty when nothing on it is left: deleted elements do not count", () => {
  expect(isEmptyScene([])).toBe(true);
  expect(isEmptyScene([{ isDeleted: true }, { isDeleted: true }])).toBe(true);
  expect(isEmptyScene([{ isDeleted: true }, { isDeleted: false }])).toBe(false);
});
