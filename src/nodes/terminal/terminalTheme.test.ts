import { expect, it } from "vitest";
import { cssBlock, readSource } from "@/theme/cssBlocks";
import { TERMINAL_COLORS, terminalThemeFor } from "./terminalTheme";

const tokens = readSource("theme/tokens.css");

it("draws xterm on the node's body color in every palette, dark in each (spec identité §4.2)", () => {
  const selectors = {
    calm: ':root[data-palette="calm"]',
    electric: ':root[data-palette="electric"]',
    expressive: ':root, :root[data-palette="expressive"]',
  } as const;
  for (const [palette, selector] of Object.entries(selectors) as [keyof typeof selectors, string][]) {
    expect(cssBlock(tokens, selector)["--dp-terminal"]).toBe(terminalThemeFor(palette).background);
  }
});

it("cursors and selections take the palette's accent", () => {
  expect(terminalThemeFor("calm")).toEqual({ background: "#0F2921", cursor: "#F52B94", selectionBackground: "#F52B9455" });
  expect(terminalThemeFor("electric")).toEqual({ background: "#0D1556", cursor: "#B6F52B", selectionBackground: "#B6F52B55" });
  expect(terminalThemeFor("expressive")).toEqual({ background: "#0B0B0E", cursor: "#FF781B", selectionBackground: "#FF781B55" });
  expect(Object.keys(TERMINAL_COLORS).sort()).toEqual(["calm", "electric", "expressive"]);
});
