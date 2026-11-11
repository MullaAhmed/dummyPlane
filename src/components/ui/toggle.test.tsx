// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { readSource, sourceFiles } from "@/theme/cssBlocks";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { toggleVariants } from "./toggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
  return [...host.querySelectorAll<HTMLButtonElement>("button")];
}

const classes = (el: Element) => [...el.classList];

it("draws the house choice: the chosen one on the accent's tint with an accent border, never the tint alone (P2-57, P2-23)", async () => {
  const [on, off] = await mount(
    <ToggleGroup type="single" value="a">
      <ToggleGroupItem variant="choice" size="sm" value="a">A</ToggleGroupItem>
      <ToggleGroupItem variant="choice" size="sm" value="b">B</ToggleGroupItem>
    </ToggleGroup>,
  );
  expect(on.getAttribute("aria-checked")).toBe("true");
  expect(off.getAttribute("aria-checked")).toBe("false");
  for (const item of [on, off]) {
    expect(classes(item)).toEqual(
      expect.arrayContaining([
        // The border is there at rest, transparent: choosing moves nothing.
        "border",
        "border-transparent",
        "data-[state=on]:border-dp-accent",
        "data-[state=on]:bg-dp-accent-soft",
        "data-[state=on]:text-dp-text",
        "hover:bg-dp-hover",
        "text-xs",
        "font-normal",
        "text-dp-text-2",
        "min-w-0",
        "h-7",
        "active:scale-[0.97]",
        "focus-visible:ring-dp-accent/70",
        "duration-(--dp-dur-fast)",
        "ease-(--dp-ease-out)",
      ]),
    );
    // The shadcn skin is gone: on and hover were the same --muted fill.
    expect(classes(item).filter((c) => /bg-muted|text-foreground|text-\(length:--text-ui\)|min-w-7/.test(c))).toEqual([]);
  }
});

it("lets a call site keep its own rest look over the choice's: a hairline, or the card's fill", () => {
  // As ToggleGroupItem merges them: the variant first, the call site after.
  const hairline = cn(toggleVariants({ variant: "choice", size: "sm" }), "border-dp-line").split(" ");
  expect(hairline).toContain("border-dp-line");
  expect(hairline).toContain("data-[state=on]:border-dp-accent");
  expect(hairline).not.toContain("border-transparent");
});

it("rings the chosen swatch in the accent on aria-checked, which a hint's trigger cannot take over", async () => {
  const [on] = await mount(
    <ToggleGroup type="single" value="red">
      <ToggleGroupItem variant="swatch" value="red" aria-label="Red" style={{ backgroundColor: "#f00" }} />
      <ToggleGroupItem variant="swatch" value="blue" aria-label="Blue" style={{ backgroundColor: "#00f" }} />
    </ToggleGroup>,
  );
  expect(on.getAttribute("aria-checked")).toBe("true");
  expect(classes(on)).toEqual(expect.arrayContaining(["size-6", "rounded-full", "p-0", "aria-checked:ring-2", "aria-checked:ring-dp-accent", "hover:ring-dp-text-3", "active:scale-[0.97]"]));
  // The default size's height and padding do not outrank the swatch's 24 px.
  expect(classes(on).filter((c) => /^(h-|px-|min-w-8)/.test(c))).toEqual([]);
});

it("restates no toggle recipe at a call site: the motion, press and chosen look come from the variant", () => {
  const callSites = Object.entries(sourceFiles()).filter(([file, text]) => /<ToggleGroupItem\b/.test(text) && !file.startsWith("components/ui/"));
  expect(callSites.length).toBeGreaterThan(5);
  // OptionItem is a full-width row (no press, its dot carries the choice): it keeps its own skin.
  const ROWS = ["components/OptionList.tsx"];
  for (const [file, text] of callSites) {
    if (ROWS.includes(file)) continue;
    expect(text.match(/data-\[state=on\]:bg-dp-accent-soft|aria-checked:ring-dp-accent|data-\[state=on\]:ring-dp-accent/g) ?? [], file).toEqual([]);
  }
  expect(readSource("components/PanelTabs.tsx")).toContain('<ToggleGroupItem variant="choice" size="sm"');
});
