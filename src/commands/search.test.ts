import { describe, expect, it } from "vitest";
import { matchScore, normalize, rank, rankSections } from "./search";

describe("normalize", () => {
  it("drops case and accents", () => {
    expect(normalize("Padmé ÉCOLE")).toBe("padme ecole");
  });
});

describe("matchScore (spec fenêtre §7.1)", () => {
  it("finds regardless of case and accents, with letters in order, not necessarily together", () => {
    expect(matchScore("padme", "Padmé")).not.toBeNull();
    expect(matchScore("BATMAN", "Batman")).not.toBeNull();
    expect(matchScore("pdm", "Padmé")).not.toBeNull();
    expect(matchScore("emdap", "Padmé")).toBeNull();
  });

  it("reads the keywords too, every term having to match", () => {
    expect(matchScore("batman cl", "Batman", ["Claude", "Backend", "Workspace 1"])).not.toBeNull();
    expect(matchScore("batman co", "Batman", ["Claude"])).toBeNull();
  });

  it("puts a word start before a match inside a word, and the label before the keywords", () => {
    expect(matchScore("th", "Thor")!).toBeGreaterThan(matchScore("th", "Arthur")!);
    expect(matchScore("ba", "Batgirl", ["Claude"])!).toBeGreaterThan(matchScore("ba", "Flash", ["Backend"])!);
  });
});

describe("rank", () => {
  const items = [
    { label: "Arthur", keywords: [] },
    { label: "Thor", keywords: [] },
    { label: "Batman", keywords: ["Claude"] },
  ];
  const textOf = (item: { label: string; keywords: string[] }) => item;

  it("keeps every item in its order without a search", () => {
    expect(rank(items, "  ", textOf)).toEqual(items);
  });

  it("keeps the matches only, best first, ties in their order", () => {
    expect(rank(items, "th", textOf).map((i) => i.label)).toEqual(["Thor", "Arthur"]);
    expect(rank(items, "zz", textOf)).toEqual([]);
  });

  it("breaks a tie by the share of the label the search covers", () => {
    const tied = [
      { label: "Rename workspace", keywords: [] },
      { label: "Rename", keywords: [] },
      { label: "Pause all", keywords: [] },
      { label: "Pause", keywords: [] },
    ];
    expect(rank(tied, "rename", textOf).map((i) => i.label)).toEqual(["Rename", "Rename workspace"]);
    expect(rank(tied, "pause", textOf).map((i) => i.label)).toEqual(["Pause", "Pause all"]);
  });
});

describe("rankSections", () => {
  const textOf = (item: { label: string; keywords: string[] }) => item;
  const sections = [
    { label: "Navigation", items: [{ label: "Hide the Agents panel", keywords: [] }] },
    { label: "Agents", items: [{ label: "Pause all", keywords: [] }] },
    { label: "Terminal · Batman", items: [{ label: "Pause", keywords: [] }] },
  ];

  it("puts the section of the best match first while searching: its first line is the one chosen", () => {
    expect(rankSections(sections, "pause", textOf).map((s) => s.label)).toEqual(["Terminal · Batman", "Agents", "Navigation"]);
  });

  it("keeps the sections in their order without a search", () => {
    expect(rankSections(sections, " ", textOf).map((s) => s.label)).toEqual(["Navigation", "Agents", "Terminal · Batman"]);
  });
});

describe("search details (plan F1 findings)", () => {
  it("puts the exact word before a longer word starting with the term", () => {
    expect(matchScore("tho", "Tho")!).toBeGreaterThan(matchScore("tho", "Thor")!);
    const items = [{ label: "Thor", keywords: [] }, { label: "Tho", keywords: [] }];
    expect(rank(items, "tho", (i) => i).map((i) => i.label)).toEqual(["Tho", "Thor"]);
  });

  it("splits words at apostrophes", () => {
    expect(matchScore("prompt", "Shell's prompt")).toBe(matchScore("prompt", "Shell prompt"));
    expect(matchScore("prompt", "Shell’s prompt")!).toBeGreaterThanOrEqual(4);
  });

  it("unfolds the ligatures œ and æ", () => {
    expect(normalize("Cœur Æon")).toBe("coeur aeon");
    expect(matchScore("coeur", "Cœur")).not.toBeNull();
  });
});
