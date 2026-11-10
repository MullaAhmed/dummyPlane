import { expect, it } from "vitest";
import { readSource } from "@/theme/cssBlocks";

/** Runs public/first-paint.js against a fake page. matchMedia throws: the palette must not depend on it. */
function paint(stored: Record<string, string>) {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const storage = { getItem: (key: string) => stored[key] ?? null };
  const noMedia = () => {
    throw new Error("matchMedia must not be used for the palette");
  };
  new Function("document", "localStorage", "matchMedia", readSource("../public/first-paint.js"))({ documentElement: root }, storage, noMedia);
  return root;
}

it("paints the saved palette before the app loads, expressive by default", () => {
  expect(paint({})).toMatchObject({ dataset: { palette: "expressive", theme: "dark" }, style: { colorScheme: "dark" } });
  expect(paint({ "dp.theme": "calm" })).toMatchObject({ dataset: { palette: "calm", theme: "light" }, style: { colorScheme: "light" } });
  expect(paint({ "dp.theme": "electric" })).toMatchObject({ dataset: { palette: "electric", theme: "dark" }, style: { colorScheme: "dark" } });
});

it("falls back to expressive for unknown or old choices", () => {
  for (const old of ["system", "light", "dark", "bleu"]) {
    expect(paint({ "dp.theme": old })).toMatchObject({ dataset: { palette: "expressive", theme: "dark" } });
  }
});

it("paints opaque whatever an older version saved: no transparency switch on the root", () => {
  const saved: Record<string, string>[] = [{}, { "dp.transparency": "off" }, { "dp.transparency": "on" }, { "dp.theme": "calm", "dp.transparency": "on" }];
  for (const stored of saved) {
    const root = paint(stored);
    expect(root.dataset.transparency, JSON.stringify(stored)).toBeUndefined();
    expect(Object.keys(root.dataset).sort(), JSON.stringify(stored)).toEqual(["palette", "theme"]);
  }
});

it("is loaded by the page, from its own origin (the CSP forbids inline scripts)", () => {
  expect(readSource("../index.html")).toMatch(/<script src="\/first-paint\.js"><\/script>/);
});

it("is fed by the theme module", () => {
  const theme = readSource("app/theme.ts");
  expect(theme).toContain('"dp.theme"');
  expect(theme).not.toContain('"dp.transparency"');
  expect(readSource("../public/first-paint.js")).not.toContain("dp.transparency");
});
