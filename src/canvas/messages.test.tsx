// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { messages } from "@/i18n";
import { canvasMessages } from "./messages";

it("speaks English for the canvas texts", () => {
  expect(messages(canvasMessages).saveFailed("disk full")).toBe("Could not save: disk full");
  expect(messages(canvasMessages).loading).toBe("Loading…");
});
