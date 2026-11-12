import { describe, expect, it } from "vitest";
import { cliRouted, LEVELS, levelModel, MODEL_CHOICES, modelLabel, readCliLevels, readCliModel, readLevel, ROUTER_LEVELS } from "./router";

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

  it("picks Claude's model from its own table, another CLI's from the user's map, none where the map is empty", () => {
    const levels = { codex: { faible: "gpt-mini", eleve: "gpt-big" } };
    expect(levelModel("claude", "faible", {})).toBe("claude-haiku-5-5");
    expect(levelModel("claude", "extreme", levels)).toBe("claude-fable-5-2");
    expect(levelModel("codex", "faible", levels)).toBe("gpt-mini");
    expect(levelModel("codex", "eleve", levels)).toBe("gpt-big");
    // A level the map leaves empty, an empty map, a CLI dummyPlane passes no model to: nothing.
    expect(levelModel("codex", "moyen", levels)).toBeUndefined();
    expect(levelModel("codex", "faible", {})).toBeUndefined();
    expect(levelModel("gemini", "faible", levels)).toBeUndefined();
    expect(cliRouted("claude", {})).toBe(true);
    expect(cliRouted("codex", {})).toBe(false);
    expect(cliRouted("codex", levels)).toBe(true);
  });

  it("keeps only the models a command line takes, never a Claude one for another CLI", () => {
    expect(readCliModel(" gpt-5.6-luna ")).toBe("gpt-5.6-luna");
    expect(readCliModel("o4[mini]")).toBe("o4[mini]");
    for (const bad of ["", "  ", "-m", "gpt 5", "gpt;rm", "a".repeat(65), "opus", "claude-haiku-5-5", 5]) expect(readCliModel(bad)).toBeUndefined();
    expect(readCliLevels({ codex: { faible: "gpt-mini", moyen: "bad model", huge: "gpt-x" }, gemini: { faible: "g" } })).toEqual({ codex: { faible: "gpt-mini" } });
    expect(readCliLevels(null)).toEqual({});
    expect(readCliLevels({ codex: "gpt" })).toEqual({});
  });

  it("words its table from the levels, never retyped", () => {
    expect(ROUTER_LEVELS).toBe("low Haiku 5.5, medium Sonnet 5.5, high Opus 5.5, extreme Fable 5.2");
  });
});
