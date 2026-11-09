import { describe, expect, it } from "vitest";
import { nextName, nextPantheon, PANTHEONS } from "./names";

describe("pantheons", () => {
  it("has 12 pantheons of 16 distinct names", () => {
    expect(PANTHEONS.map((p) => p.id)).toEqual([
      "egyptian",
      "greek",
      "norse",
      "japanese",
      "celtic",
      "hindu",
      "aztec",
      "mesopotamian",
      "slavic",
      "chinese",
      "roman",
      "yoruba",
    ]);
    for (const pantheon of PANTHEONS) {
      expect(pantheon.names).toHaveLength(16);
      expect(new Set(pantheon.names.map((n) => n.toLowerCase())).size).toBe(16);
      for (const name of pantheon.names) expect(name).not.toMatch(/\s/);
    }
  });
});

describe("nextPantheon", () => {
  it("takes the first pantheon not used in the workspace, then starts over", () => {
    expect(nextPantheon([])).toBe("egyptian");
    expect(nextPantheon(["egyptian", null, undefined])).toBe("greek");
    expect(nextPantheon(PANTHEONS.map((p) => p.id))).toBe("egyptian");
  });
});

describe("nextName", () => {
  it("takes the first free name, ignoring case", () => {
    expect(nextName("egyptian", [])).toBe("Isis");
    expect(nextName("egyptian", ["isis", "Horus"])).toBe("Osiris");
    expect(nextName("greek", [])).toBe("Athena");
  });

  it("adds 2, then 3, once every name is taken", () => {
    const egyptian = PANTHEONS[0].names;
    expect(nextName("egyptian", [...egyptian])).toBe("Isis 2");
    expect(nextName("egyptian", [...egyptian, "Isis 2"])).toBe("Osiris 2");
    expect(nextName("egyptian", [...egyptian, ...egyptian.map((n) => `${n} 2`)])).toBe("Isis 3");
  });

  it("falls back to the first pantheon for an unknown id", () => {
    expect(nextName("atlantean", [])).toBe("Isis");
  });
});
