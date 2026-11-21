// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readSource, sourceFiles } from "@/theme/cssBlocks";
import { TITLE_BAR_HEIGHT } from "./layout";
import { OVERLAY_COLLISION_PADDING, OVERLAY_MARGIN, OVERLAY_TOP } from "./overlayBounds";

// Slow under the load of the full suite: this file reads every source file.
vi.setConfig({ testTimeout: 30_000 });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The class string of a shadcn part, as written in its file: the first string after `data-slot="<slot>"`. */
function slotClasses(file: string, slot: string): string[] {
  const text = readSource(file);
  const at = text.indexOf(`data-slot="${slot}"`);
  expect(at, `${file} renders ${slot}`).toBeGreaterThanOrEqual(0);
  return /"([^"]*)"/.exec(text.slice(text.indexOf("className", at)))![1].split(/\s+/);
}

describe("the bounds of an overlay at the 960x600 minimum", () => {
  it("starts one gap under the title bar and keeps that gap from the other edges", () => {
    expect(OVERLAY_TOP).toBe(TITLE_BAR_HEIGHT + OVERLAY_MARGIN);
    expect(OVERLAY_COLLISION_PADDING).toEqual({ top: TITLE_BAR_HEIGHT + 8, right: 8, bottom: 8, left: 8 });
  });

  it("gives every menu, popover and select that padding by default, and none of their call sites a number of its own", () => {
    for (const [file, count] of [
      ["components/ui/popover.tsx", 1],
      ["components/ui/dropdown-menu.tsx", 2],
      ["components/ui/select.tsx", 1],
    ] as const) {
      const text = readSource(file);
      expect(text.match(/collisionPadding = OVERLAY_COLLISION_PADDING,/g) ?? [], file).toHaveLength(count);
      expect(text.match(/collisionPadding=\{collisionPadding\}/g) ?? [], file).toHaveLength(count);
    }
    // A padding of 12 let the Settings menu and the point menus climb over the title bar (y 12 at 960x600).
    for (const [file, text] of Object.entries(sourceFiles())) {
      if (file.startsWith("components/ui/")) continue;
      expect(text.match(/collisionPadding=\{\d+\}/g) ?? [], file).toEqual([]);
    }
  });

  it("caps menus and sub-menus at the room left on their side, and scrolls inside past it", () => {
    for (const slot of ["dropdown-menu-content", "dropdown-menu-sub-content"]) {
      expect(slotClasses("components/ui/dropdown-menu.tsx", slot), slot).toEqual(
        expect.arrayContaining(["max-h-(--radix-dropdown-menu-content-available-height)", "overflow-x-hidden", "overflow-y-auto"]),
      );
    }
    expect(slotClasses("components/ui/select.tsx", "select-content")).toEqual(expect.arrayContaining(["max-h-(--radix-select-content-available-height)", "overflow-y-auto"]));
  });

  it("caps a popover the same way, a call site's own cap and overflow winning", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (className?: string) =>
      act(async () =>
        root.render(
          <Popover open>
            <PopoverTrigger>open</PopoverTrigger>
            <PopoverContent className={className}>rows</PopoverContent>
          </Popover>,
        ),
      );
    await render();
    const classes = () => [...document.querySelector("[data-slot='popover-content']")!.classList];
    expect(classes()).toEqual(expect.arrayContaining(["max-h-(--radix-popover-content-available-height)", "overflow-x-hidden", "overflow-y-auto"]));
    // The notifications' popover: its own cap, its list scrolling inside.
    await render("max-h-[min(36rem,var(--radix-popover-content-available-height))] overflow-hidden");
    expect(classes()).toContain("max-h-[min(36rem,var(--radix-popover-content-available-height))]");
    expect(classes()).toContain("overflow-hidden");
    expect(classes()).not.toContain("max-h-(--radix-popover-content-available-height)");
    expect(classes()).not.toContain("overflow-y-auto");
    await act(async () => root.unmount());
  });
});
