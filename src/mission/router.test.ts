import { describe, expect, it } from "vitest";
import { LEVELS, MODEL_CHOICES, modelFor, modelLabel, readLevel, ROUTER_LEVELS } from "./router";

describe("the model router", () => {
  it("gives each level of difficulty its model", () => {
    expect(Object.fromEntries(Object.entries(LEVELS).map(([level, { model }]) => [level, model]))).toEqual({
      faible: "claude-haiku-5-5",
      moyen: "claude-sonnet-5-5",
      eleve: "claude-opus-5-5",
      extreme: "claude-fable-5-2",
    });
  });

  it("routes to the models the edit panel offers, one table for both", () => {
    expect(Object.values(LEVELS).map(({ model, modelLabel }) => ({ model, modelLabel }))).toEqual([...MODEL_CHOICES]);
  });

  it("names a Claude model of another version by its family and version, any other model as it is", () => {
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel("sonnet")).toBe("sonnet");
    expect(modelLabel("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-20250514");
    expect(modelLabel("gpt-5.6-luna")).toBe("gpt-5.6-luna");
  });

  it("reads a level as the fleet writes it, accents and case aside", () => {
    expect(readLevel("Élevé")).toBe("eleve");
    expect(readLevel("extrême")).toBe("extreme");
    expect(readLevel(" faible ")).toBe("faible");
    expect(readLevel("énorme")).toBeUndefined();
    expect(readLevel(3)).toBeUndefined();
  });

  it("chooses a model only when the mission's router is on and the sub-task has a level", () => {
    expect(modelFor({ router: true }, { level: "faible" })).toBe("claude-haiku-5-5");
    expect(modelFor({ router: false }, { level: "faible" })).toBeUndefined();
    expect(modelFor({}, { level: "extreme" })).toBeUndefined();
    expect(modelFor({ router: true }, {})).toBeUndefined();
  });

  it("is routed by the agent's own router as well, and an agent whose own is off never vetoes the mission's", () => {
    expect(modelFor({}, { level: "eleve" }, { router: true })).toBe("claude-opus-5-5");
    expect(modelFor({ router: true }, { level: "eleve" }, { router: false })).toBe("claude-opus-5-5");
    expect(modelFor({ router: true }, { level: "eleve" }, {})).toBe("claude-opus-5-5");
    expect(modelFor({}, { level: "eleve" }, { router: false })).toBeUndefined();
    // Still no level, no model.
    expect(modelFor({}, {}, { router: true })).toBeUndefined();
  });

  it("words its table from the levels, never retyped", () => {
    expect(ROUTER_LEVELS).toBe("low Haiku 5.5, medium Sonnet 5.5, high Opus 5.5, extreme Fable 5.2");
  });
});
