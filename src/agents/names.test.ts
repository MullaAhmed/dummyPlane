import { describe, expect, it } from "vitest";
import { nextName, nextPantheon, PANTHEONS, pantheonById } from "./names";

describe("pantheons", () => {
  it("has 5 pantheons of 16 distinct names", () => {
    expect(PANTHEONS.map((p) => p.id)).toEqual(["dc", "marvel", "throne-of-glass", "star-wars", "lord-of-the-rings"]);
    for (const pantheon of PANTHEONS) {
      expect(pantheon.names).toHaveLength(16);
      expect(new Set(pantheon.names.map((n) => n.toLowerCase())).size).toBe(16);
      // One word of letters: typed after `@`, quoted in a command line, used as a folder name.
      for (const name of pantheon.names) expect(name).toMatch(/^[A-Za-z]+$/);
    }
  });

  it("gives no agent the name of the `@all` target", () => {
    for (const pantheon of PANTHEONS) expect(pantheon.names.map((n) => n.toLowerCase())).not.toContain("all");
  });
});

describe("pantheonById", () => {
  it("finds a pantheon by its id", () => {
    expect(pantheonById("marvel").id).toBe("marvel");
  });

  it("reads an old mythology as one of today's pantheons, each old one apart from the next", () => {
    expect(pantheonById("egyptian").id).toBe("dc");
    expect(pantheonById("greek").id).toBe("marvel");
    expect(pantheonById("norse").id).toBe("throne-of-glass");
  });

  it("falls back to the first pantheon for an unknown id, or none", () => {
    expect(pantheonById("atlantean").id).toBe("dc");
    expect(pantheonById("constructor").id).toBe("dc");
    expect(pantheonById(null).id).toBe("dc");
    expect(pantheonById(undefined).id).toBe("dc");
  });
});

describe("nextPantheon", () => {
  it("takes the first pantheon not used in the workspace, then starts over", () => {
    expect(nextPantheon([])).toBe("dc");
    expect(nextPantheon(["dc", null, undefined])).toBe("marvel");
    expect(nextPantheon(PANTHEONS.map((p) => p.id))).toBe("dc");
  });

  it("counts an old mythology as the pantheon it reads as", () => {
    expect(nextPantheon(["egyptian"])).toBe("marvel");
    expect(nextPantheon(["egyptian", "greek"])).toBe("throne-of-glass");
  });
});

describe("nextName", () => {
  it("takes the first free name, ignoring case", () => {
    expect(nextName("dc", [])).toBe("Batman");
    expect(nextName("dc", ["batman", "Aquaman"])).toBe("Superman");
    expect(nextName("marvel", [])).toBe("Thor");
    expect(nextName("throne-of-glass", [])).toBe("Celaena");
  });

  it("adds 2, then 3, once every name is taken", () => {
    const dc = PANTHEONS[0].names;
    expect(nextName("dc", [...dc])).toBe("Batman 2");
    expect(nextName("dc", [...dc, "Batman 2"])).toBe("Superman 2");
    expect(nextName("dc", [...dc, ...dc.map((n) => `${n} 2`)])).toBe("Batman 3");
  });

  it("falls back to the first pantheon for an unknown id", () => {
    expect(nextName("atlantean", [])).toBe("Batman");
  });

  it("draws from the pantheon an old mythology reads as", () => {
    expect(nextName("greek", [])).toBe("Thor");
  });
});
