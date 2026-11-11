import { expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { sourceFiles } from "./cssBlocks";

// What the habillage spec took from Symvibe.
const FORBIDDEN: [RegExp, string][] = [
  [/#f4602e/i, "Symvibe's orange"],
  [/#322f28/i, "the fixed background of the status badges"],
  [/#12110e/i, "the old canvas background"],
  [/Geist/, "the Geist font"],
  [/dp-orb/, "the orb"],
  [/#4fc2c2/i, "the gradient border of the chips"],
];

it("keeps no trace of the habillage identity", () => {
  const sources = sourceFiles();
  expect(Object.keys(sources).length).toBeGreaterThan(50);
  for (const [file, text] of Object.entries(sources)) {
    for (const [pattern, what] of FORBIDDEN) expect(pattern.test(text), `${file} : ${what}`).toBe(false);
  }
});
