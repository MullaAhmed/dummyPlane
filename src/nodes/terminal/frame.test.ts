import { describe, expect, it } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import { frameStyle } from "./frame";

describe("frameStyle", () => {
  it("frames a node with a neutral hairline, not its agent's tint, and no glow", () => {
    const style = frameStyle(false, false);
    expect(style.border).toBe("1px solid var(--dp-line)");
    expect(style.boxShadow).toBeUndefined();
  });

  it("puts a selected node in a single 1px ink frame, waiting or not: no second line inside, no glow", () => {
    for (const waiting of [false, true]) {
      const style = frameStyle(true, waiting);
      expect(style.border).toBe("1px solid var(--dp-accent)");
      expect(style.outline).toBeUndefined();
      expect(style.boxShadow).toBeUndefined();
    }
  });

  it("gives a waiting node a hairline in the wait colour, without a halo", () => {
    const style = frameStyle(false, true);
    expect(style.border).toBe("1px solid var(--dp-wait)");
    expect(style.boxShadow).toBeUndefined();
  });
});

it("draws no waiting glow over a terminal or a fleet any more", () => {
  for (const file of ["nodes/terminal/TerminalNode.tsx", "nodes/fleet/FleetNode.tsx", "nodes/terminal/frame.ts"]) {
    expect(readSource(file), file).not.toMatch(/WAITING_GLOW|inset 0 0 28px/);
  }
});
