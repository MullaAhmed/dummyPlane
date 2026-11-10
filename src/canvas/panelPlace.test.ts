import { describe, expect, it } from "vitest";
import { besideRect, PANEL_GAP, PANEL_WIDTH } from "./panelPlace";

const canvas = { width: 1200, height: 800 };

describe("the place of a selected terminal's panel", () => {
  it("sits on the terminal's right, its top on the terminal's", () => {
    expect(besideRect({ x: 100, y: 150, width: 400, height: 300 }, canvas)).toEqual({ left: 500 + PANEL_GAP, top: 150, maxHeight: 800 - 60 - 150 });
  });

  it("goes to the left when the right has no room", () => {
    expect(besideRect({ x: 700, y: 100, width: 400, height: 300 }, canvas).left).toBe(700 - PANEL_GAP - PANEL_WIDTH);
  });

  it("is wide enough for its five tabs, and measures the room on the right with that width", () => {
    expect(PANEL_WIDTH).toBe(336);
    // 892 + 336 would run under the activity rail (1130): the panel takes the terminal's left.
    expect(besideRect({ x: 480, y: 100, width: 400, height: 300 }, canvas).left).toBe(480 - PANEL_GAP - PANEL_WIDTH);
  });

  it("keeps clear of the rails on both sides", () => {
    // On the left, the right being taken: never under the tool rail.
    expect(besideRect({ x: 200, y: 100, width: 900, height: 300 }, canvas).left).toBe(70);
    // On the right: never under the activity rail.
    expect(besideRect({ x: 20, y: 100, width: 900, height: 300 }, canvas).left).toBe(1200 - 70 - PANEL_WIDTH);
  });

  it("takes the side with more room when neither has enough", () => {
    expect(besideRect({ x: 20, y: 100, width: 1100, height: 300 }, canvas).left).toBe(1200 - 70 - PANEL_WIDTH);
    expect(besideRect({ x: 80, y: 100, width: 1100, height: 300 }, canvas).left).toBe(70);
  });

  it("stays inside the canvas when the terminal's top is off screen", () => {
    expect(besideRect({ x: 100, y: -300, width: 400, height: 600 }, canvas).top).toBe(60);
    expect(besideRect({ x: 100, y: 900, width: 400, height: 300 }, canvas).top).toBe(800 - 60 - 200);
  });
});
