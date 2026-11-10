import { describe, expect, it } from "vitest";
import type { ITheme } from "@xterm/xterm";
import { createStore } from "zustand";
import type { ThemeChoice } from "@/app/theme";
import { cssBlock, readSource } from "@/theme/cssBlocks";
import { followPalette, TERMINAL_COLORS, terminalThemeFor } from "./terminalTheme";

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

it("cursors and selections take the palette's light color", () => {
  expect(terminalThemeFor("calm")).toEqual({ background: "#0F2921", cursor: "#EDE3CC", selectionBackground: "#EDE3CC55" });
  expect(terminalThemeFor("electric")).toEqual({ background: "#0D1556", cursor: "#F4F4F1", selectionBackground: "#F4F4F155" });
  expect(terminalThemeFor("expressive")).toEqual({ background: "#0B0B0E", cursor: "#F4F4F1", selectionBackground: "#F4F4F155" });
  expect(Object.keys(TERMINAL_COLORS).sort()).toEqual(["calm", "electric", "expressive"]);
});

describe("terminals follow the palette chosen in Settings", () => {
  function fakeTerminal() {
    return { options: { theme: terminalThemeFor("expressive") as ITheme } };
  }

  it("gives every existing terminal the new colors when the palette changes", () => {
    const store = createStore<{ choice: ThemeChoice }>()(() => ({ choice: "expressive" }));
    const terminals = [fakeTerminal(), fakeTerminal()];
    const stop = followPalette(store, () => terminals);
    store.setState({ choice: "calm" });
    for (const term of terminals) expect(term.options.theme).toEqual(terminalThemeFor("calm"));
    stop();
  });

  it("leaves terminals alone when the palette does not change", () => {
    const store = createStore<{ choice: ThemeChoice; transparency: boolean }>()(() => ({ choice: "calm", transparency: true }));
    const term = fakeTerminal();
    const stop = followPalette(store, () => [term]);
    store.setState({ transparency: false });
    expect(term.options.theme).toEqual(terminalThemeFor("expressive"));
    stop();
  });

  it("stops updating once unsubscribed, and never holds the terminals it is given", () => {
    const store = createStore<{ choice: ThemeChoice }>()(() => ({ choice: "expressive" }));
    const term = fakeTerminal();
    const stop = followPalette(store, () => [term]);
    stop();
    store.setState({ choice: "electric" });
    expect(term.options.theme).toEqual(terminalThemeFor("expressive"));
  });
});
