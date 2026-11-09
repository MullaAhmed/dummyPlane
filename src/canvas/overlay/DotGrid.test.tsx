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
  expect(grid.style.backgroundImage).toContain("var(--dp-dot)");
  await act(async () => root.unmount());
  host.remove();
});
