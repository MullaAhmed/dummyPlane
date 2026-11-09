// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { messages } from "@/i18n";
import { nextGroupName, type SceneFrame } from "./groups";
import { canvasMessages } from "./messages";

const named = (name: string) => ({ name }) as SceneFrame;

it("names new groups in English, skipping a name already taken", () => {
  expect(nextGroupName([])).toBe("Group 1");
  expect(nextGroupName([named("Group 1"), named("Group 2")])).toBe("Group 3");
});

it("speaks English for the canvas texts", () => {
  expect(messages(canvasMessages).saveFailed("disk full")).toBe("Could not save: disk full");
  expect(messages(canvasMessages).loading).toBe("Loading…");
});
