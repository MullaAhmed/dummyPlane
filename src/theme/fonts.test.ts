import { expect, it } from "vitest";
import pkg from "../../package.json";
import { readSource } from "./cssBlocks";

const deps: Record<string, string> = pkg.dependencies;
const index = readSource("index.css");
const excalidraw = readSource("theme/excalidraw.css");

it("bundles Inter and JetBrains Mono at exact versions, and no longer Geist", () => {
  expect(deps["@fontsource-variable/inter"]).toBe("5.3.0");
  expect(deps["@fontsource-variable/jetbrains-mono"]).toBe("5.3.0");
  expect(deps["@fontsource-variable/geist"]).toBeUndefined();
  expect(deps["@fontsource-variable/geist-mono"]).toBeUndefined();
});

it("sets them as the interface and mono fonts, Excalidraw's UI included", () => {
  expect(index).toContain('@import "@fontsource-variable/inter";');
  expect(index).toContain('@import "@fontsource-variable/jetbrains-mono";');
  expect(index).toContain('--font-sans: "Inter Variable", sans-serif;');
  expect(index).toContain('--font-mono: "JetBrains Mono Variable", ui-monospace, monospace;');
  expect(excalidraw).toContain('"Inter Variable"');
  expect(`${index}${excalidraw}`).not.toContain("Geist");
});
