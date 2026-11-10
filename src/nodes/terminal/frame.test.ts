import { describe, expect, it } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import { frameStyle } from "./frame";

describe("frameStyle", () => {
  it("frames a node with a neutral hairline, not its agent's tint, and no glow", () => {
    const style = frameStyle(false, false);
    expect(style.border).toBe("1px solid var(--dp-line)");
    expect(style.boxShadow).toBeUndefined();
  });

  it("puts a selected node in a 1px ink frame, waiting or not, with a paper line inside so it reads on a dark body", () => {
    for (const waiting of [false, true]) {
      const style = frameStyle(true, waiting);
      expect(style.border).toBe("1px solid var(--dp-accent)");
      // An outline just inside the border paints over the header and the terminal, where an inset shadow would hide under them.
      expect([style.outline, style.outlineOffset]).toEqual(["1px solid var(--dp-on-accent)", "-2px"]);
      expect(style.boxShadow).toBeUndefined();
    }
  });

  it("gives a waiting node a hairline in the wait colour, without a halo", () => {
    const style = frameStyle(false, true);
    expect(style.border).toBe("1px solid var(--dp-wait)");
    expect(style.boxShadow).toBeUndefined();
  });
});

it("draws no waiting glow over a terminal or an orchestrator any more", () => {
  for (const file of ["nodes/terminal/TerminalNode.tsx", "nodes/orchestrator/OrchestratorNode.tsx", "nodes/terminal/frame.ts"]) {
    expect(readSource(file), file).not.toMatch(/WAITING_GLOW|inset 0 0 28px/);
  }
});
