import { expect, it, vi } from "vitest";
import { cn } from "cn";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { cssBlock, readSource, sourceFiles } from "./cssBlocks";

/** The interface's 13 px step, as components write it. */
const UI = "text-(length:--text-ui)";

/**
 * Files other agents are rewriting right now: they may still carry `text-[13px]`
 * until their owner moves them to the step. Allowed, not required: drop a name
 * once its file is clean.
 */
const PENDING = new Set<string>([]);

it("names 13 px as a step of the type scale, between text-xs and text-sm", () => {
  expect(cssBlock(readSource("index.css"), "@theme inline")["--text-ui"]).toBe("13px");
});

it("survives cn beside a text colour and replaces another size, where the bare text-ui would be dropped", () => {
  for (const ink of ["text-dp-text", "text-dp-text-2", "text-dp-text-3", "text-dp-on-role"]) {
    expect(cn(UI, ink)).toBe(`${UI} ${ink}`);
    expect(cn(ink, UI)).toBe(`${ink} ${UI}`);
  }
  // A font size: it replaces the component's own, at every breakpoint.
  expect(cn("text-sm", UI)).toBe(UI);
  expect(cn("text-base md:text-sm", UI, `md:${UI}`)).toBe(`${UI} md:${UI}`);
  // Why the step is not written `text-ui`: cn merges like tailwind-merge, which reads it as a colour.
  expect(cn("text-ui text-dp-text"), "cn now keeps text-ui: the bare name may replace the arbitrary form").toBe("text-dp-text");
});

it("sizes text on the scale: no arbitrary pixel size (nothing under 12 px), and never the bare text-ui", () => {
  for (const [file, text] of Object.entries(sourceFiles())) {
    // index.css defines the step and explains the trap in words.
    if (file !== "index.css") expect(/(?<![-\w])text-ui\b/.test(text), `${file}: cn drops text-ui, write ${UI}`).toBe(false);
    if (PENDING.has(file)) continue;
    expect(text.match(/\btext-\[\d+(\.\d+)?px\]/g) ?? [], `${file}: an arbitrary font size`).toEqual([]);
  }
});
