import { describe, expect, it } from "vitest";
import { frameStyle, WAITING_GLOW } from "./frame";

describe("frameStyle", () => {
  it("borders a node in its agent's tint, without glow", () => {
    const style = frameStyle("#e8743b", false, false);
    expect(style.border).toContain("#e8743b");
    expect(style.boxShadow).toBeUndefined();
  });

  it("puts a selected node in the accent, waiting or not", () => {
    for (const waiting of [false, true]) {
      const style = frameStyle("#e8743b", true, waiting);
      expect(style.border).toBe("1.5px solid var(--dp-accent)");
      expect(style.boxShadow).toContain("var(--dp-accent)");
    }
  });

  it("borders a waiting node in amber", () => {
    expect(frameStyle("#e8743b", false, true).border).toBe("1px solid var(--dp-waiting)");
  });
});

describe("WAITING_GLOW", () => {
  // Excalidraw clips what overflows an embeddable: the glow is drawn inside the node.
  it("is an amber glow inside the node", () => {
    expect(WAITING_GLOW).toMatch(/^inset /);
    expect(WAITING_GLOW).toContain("var(--dp-waiting)");
  });
});
