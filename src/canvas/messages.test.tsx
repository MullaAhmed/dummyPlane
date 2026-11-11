// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { messages } from "@/i18n";
import { canvasMessages } from "./messages";

it("speaks English for the canvas texts", () => {
  // What failed, in the app's words: the error itself goes under it, never into the title (Alerts).
  expect(messages(canvasMessages).saveFailed).toBe("Could not save the canvas");
  expect(messages(canvasMessages).loading).toBe("Loading…");
});
