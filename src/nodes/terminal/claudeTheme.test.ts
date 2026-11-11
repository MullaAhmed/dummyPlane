import { describe, expect, it } from "vitest";
import type { ThemeChoice } from "@/app/theme";
import { contrast } from "@/theme/colorMath";
import { readSource } from "@/theme/cssBlocks";
import { terminalThemeFor, type TerminalTheme } from "./terminalTheme";

/**
 * Claude's own colours in a dummyPlane terminal (src-tauri/src/agents/claude_theme.rs):
 * its ANSI-only dark theme, whose 16 colours are the palette's xterm theme, with
 * the overrides of claude_theme.json. Every pair Claude draws text on is
 * recomputed here, in each palette.
 */
const theme = JSON.parse(readSource("../src-tauri/src/agents/claude_theme.json")) as {
  name: string;
  base: string;
  overrides: Record<string, string>;
};
const PALETTES: ThemeChoice[] = ["calm", "electric", "expressive"];

/** What `dark-ansi` draws a key in, before the overrides (Claude Code 2.1.322). */
const DARK_ANSI: Record<string, string> = {
  text: "ansi:whiteBright",
  userMessageBackground: "ansi:blackBright",
  composerSidebarBackground: "ansi:blackBright",
  memoryBackgroundColor: "ansi:blackBright",
  bashMessageBackgroundColor: "ansi:black",
  diffAdded: "ansi:green",
  diffRemoved: "ansi:red",
  diffAddedDimmed: "ansi:green",
  diffRemovedDimmed: "ansi:red",
  diffAddedWord: "ansi:greenBright",
  diffRemovedWord: "ansi:redBright",
};

/** xterm's 256-colour cube and grey ramp, which dummyPlane leaves as they are. */
function cube(n: number): string {
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  if (n >= 232) {
    const grey = 8 + 10 * (n - 232);
    return `#${hex(grey)}${hex(grey)}${hex(grey)}`;
  }
  const levels = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return `#${hex(levels[Math.floor(i / 36)])}${hex(levels[Math.floor(i / 6) % 6])}${hex(levels[i % 6])}`;
}

/** A theme value as the palette's terminal draws it: `ansi:redBright` is xterm's `brightRed`. */
function resolve(value: string, palette: ThemeChoice): string {
  const terminal = terminalThemeFor(palette);
  const ansi = /^ansi:([a-z]+?)(Bright)?$/.exec(value);
  if (ansi) {
    const [, hue, bright] = ansi;
    const key = (bright ? `bright${hue[0].toUpperCase()}${hue.slice(1)}` : hue) as keyof TerminalTheme;
    expect(terminal[key], value).toBeDefined();
    return terminal[key];
  }
  const indexed = /^ansi256\((\d+)\)$/.exec(value);
  if (indexed && Number(indexed[1]) >= 16) return cube(Number(indexed[1]));
  throw new Error(`no colour for ${value}`);
}

const colour = (key: string, palette: ThemeChoice) => resolve(theme.overrides[key] ?? DARK_ANSI[key], palette);

it("is Claude's ANSI-only dark theme: its colours are the palette's own, and switch with it", () => {
  expect(theme.base).toBe("dark-ansi");
  expect(theme.name).toBe("dummyPlane");
  for (const value of Object.values(theme.overrides)) expect(value).toMatch(/^(ansi:[a-zA-Z]+|ansi256\((1[6-9]|[2-9]\d|1\d\d|2[0-4]\d|25[0-5])\))$/);
  // The cube's reference points.
  expect(cube(16)).toBe("#000000");
  expect(cube(22)).toBe("#005f00");
  expect(cube(196)).toBe("#ff0000");
  expect(cube(231)).toBe("#ffffff");
  expect(cube(232)).toBe("#080808");
});

describe.each(PALETTES)("in %s", (palette) => {
  const text = colour("text", palette);
  const body = terminalThemeFor(palette).background;

  it("writes a message's text on its panels at 4.5:1 or more: none in the dim text colour", () => {
    for (const key of ["userMessageBackground", "composerSidebarBackground", "memoryBackgroundColor", "bashMessageBackgroundColor"]) {
      expect(contrast(text, colour(key, palette)), key).toBeGreaterThanOrEqual(4.5);
    }
    // `dark-ansi` alone would not: its panels are the dim text colour.
    expect(contrast(text, resolve(DARK_ANSI.userMessageBackground, palette))).toBeLessThan(4.5);
  });

  it("writes a diff's lines on its green and red at 4.5:1 or more", () => {
    for (const key of ["diffAdded", "diffRemoved", "diffAddedDimmed", "diffRemovedDimmed"]) {
      expect(contrast(text, colour(key, palette)), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a changed word legible both ways: its highlight under the text, its +/- count on the body", () => {
    for (const key of ["diffAddedWord", "diffRemovedWord"]) {
      expect(contrast(text, colour(key, palette)), `${key} under the text`).toBeGreaterThanOrEqual(3);
      expect(contrast(colour(key, palette), body), `${key} on the body`).toBeGreaterThanOrEqual(3);
    }
  });
});
