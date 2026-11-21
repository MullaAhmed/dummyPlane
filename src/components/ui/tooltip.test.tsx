// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HINT_DELAY_MS, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { tabTo } from "./tabTo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return host;
}

const pair = (
  <>
    <Tooltip>
      <TooltipTrigger>A</TooltipTrigger>
      <TooltipContent>Hint A</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger>B</TooltipTrigger>
      <TooltipContent>Hint B</TooltipContent>
    </Tooltip>
  </>
);

/** Opens A's hint (a focus opens it at once), closes it, then points at B: B's hint, if it opened at once. */
async function hintAfterNeighbour(host: HTMLElement): Promise<Element | null> {
  const [a, b] = [...host.querySelectorAll("button")];
  await act(async () => tabTo(a));
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain("Hint A");
  await act(async () => a.blur());
  await act(async () => {
    b.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
  });
  return [...document.querySelectorAll('[data-slot="tooltip-content"]')].find((n) => n.textContent?.includes("Hint B")) ?? null;
}

it("opens a hint's neighbour at once, unanimated, once one hint has been open: the app's one provider governs them all", async () => {
  const host = await mount(<TooltipProvider delayDuration={HINT_DELAY_MS}>{pair}</TooltipProvider>);
  const hint = await hintAfterNeighbour(host);
  expect(hint?.getAttribute("data-state")).toBe("instant-open");
  // Only a delayed open animates: the skip-delay one shows at once.
  expect(hint!.className).toContain("data-[state=delayed-open]:animate-in");
  // No animation on the bare class or on instant-open (`data-open:` never matches a tooltip's states).
  expect(hint!.className).not.toMatch(/data-\[state=instant-open\]:animate|(?<![\w:[\]-])animate-in(?![\w-])/);
});

it("still works rendered alone, with no provider above it, and then waits its own delay", async () => {
  const host = await mount(pair);
  // Each lone hint has a provider of its own: B's waits the full delay.
  expect(await hintAfterNeighbour(host)).toBeNull();
});

it("opens on a focus only when Tab, Shift+Tab or an arrow brought it, never on one the app hands back after Enter, Escape or a click", async () => {
  const host = await mount(<TooltipProvider delayDuration={HINT_DELAY_MS}>{pair}</TooltipProvider>);
  const [a, b] = [...host.querySelectorAll("button")];
  const hint = () => document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? null;
  const key = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent("keydown", init));
  // A menu, a dialog or a panel closes on Escape, or a launch on Enter, and hands the focus back: no hint.
  for (const init of [{ key: "Escape" }, { key: "Enter" }]) {
    key(init);
    await act(async () => a.focus());
    expect(hint(), init.key).toBeNull();
    await act(async () => a.blur());
  }
  // A press of the pointer, then a focus given back: no hint either.
  window.dispatchEvent(new PointerEvent("pointerdown"));
  await act(async () => a.focus());
  expect(hint()).toBeNull();
  await act(async () => a.blur());
  // Ctrl+Tab goes from terminal to terminal: not the keyboard walking the controls.
  key({ key: "Tab", ctrlKey: true });
  await act(async () => a.focus());
  expect(hint()).toBeNull();
  await act(async () => a.blur());
  // Shift+Tab and an arrow do open it, and a blur closes it.
  key({ key: "Tab", shiftKey: true });
  await act(async () => a.focus());
  expect(hint()).toContain("Hint A");
  await act(async () => a.blur());
  expect(document.querySelector('[data-slot="tooltip-content"][data-state$="open"]')).toBeNull();
  key({ key: "ArrowDown" });
  await act(async () => b.focus());
  expect(hint()).toContain("Hint B");
});

it("does not open on a focus long after the Tab: the key's moving is over", async () => {
  const host = await mount(pair);
  const [a] = [...host.querySelectorAll("button")];
  const now = vi.spyOn(performance, "now");
  now.mockReturnValue(1000);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  now.mockReturnValue(1500);
  await act(async () => a.focus());
  expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  now.mockRestore();
});
