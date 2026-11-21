import { expect, it } from "vitest";
import { BOTTOM_BAR_HEIGHT } from "@/shell/layout";
import { FOOT_CLEARANCE, footLift } from "./footLift";

/** A Fleet 717x600 at the scene's origin; the view at 960x600. */
const node = { x: 0, y: 0, width: 717, height: 600 };
const view = (scrollY: number, zoom = 1) => ({ scrollY, zoom, height: 600 });

it("stands the actions over the command bar's band, one gap up", () => {
  expect(FOOT_CLEARANCE).toBe(BOTTOM_BAR_HEIGHT + 8);
});

it("lifts nothing while the node's foot is in view, or before its place is known", () => {
  // Its foot at y 400.
  expect(footLift(node, view(-200), 300)).toBe(0);
  expect(footLift(undefined, view(0), 300)).toBe(0);
  expect(footLift(node, { scrollY: 0, zoom: 1, height: 0 }, 300)).toBe(0);
});

it("lifts the actions by what of the node runs below the band at 960x600, in the node's own pixels", () => {
  // At 100 %: its foot at y 690, the band's top at 532: 158 px.
  expect(footLift(node, view(90), 300)).toBe(690 - (600 - FOOT_CLEARANCE));
  // At 50 %: the same 158 screen px are 316 of the node's.
  expect(footLift(node, view(780, 0.5), 400)).toBe(Math.round(((600 + 780) * 0.5 - (600 - FOOT_CLEARANCE)) / 0.5));
});

it("never lifts them past the top of the panel's body: over the header or the terminal", () => {
  expect(footLift(node, view(500), 120)).toBe(120);
  expect(footLift(node, view(500), -5)).toBe(0);
});
