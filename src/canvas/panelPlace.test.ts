import { expect, it } from "vitest";
import { PANEL_WIDTH } from "./panelPlace";

it("is wide enough for the panel's five tabs", () => {
  expect(PANEL_WIDTH).toBe(336);
});
