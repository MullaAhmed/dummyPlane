import { describe, expect, it } from "vitest";
import { findDuplicateWork, normalisedTitle, type ActiveWork, type Candidate } from "./duplicateTask";

const work = (extra: Partial<ActiveWork> = {}): ActiveWork => ({ agentId: "thor", name: "Thor", state: "working", ...extra });
const dup = (candidate: Candidate, ...active: ActiveWork[]) => findDuplicateWork(candidate, active)?.name ?? null;

/** What every brief of one mission repeats: a long tail of shared rules. */
const RULES =
  "Work in your own worktree and branch. Run vitest and tsc through node directly, logs and scratch go in D:\\temp. Never launch the app, never push, " +
  "no co-authored trailer. Add one changelog line under Unreleased and report the files changed, the tests and what you were unsure of. " +
  "Keep your diff local: a new module plus small call-site changes, and rebase when main moves. Declare your steps, delegate what suits a sub-agent, " +
  "commit on your own branch, then report with a summary, a status, and what the user will have to check by hand.";

describe("the same task", () => {
  it("is the same Kanban card, whatever the words", () => {
    expect(dup({ title: "Banners", brief: "x", card: "c1" }, work({ title: "Recolour", brief: "y", card: "c1" }))).toBe("Thor");
  });

  it("is never another card, whatever the words", () => {
    const same = { title: "Banners on the new palettes", brief: "Recolour the README banners and badges in the Dark and Expressive palettes." };
    expect(dup({ ...same, card: "c2" }, work({ ...same, card: "c1" }))).toBeNull();
  });

  it("is the same title, case, punctuation, spacing and accents folded", () => {
    const thor = work({ title: "Banners on the new palettes" });
    expect(dup({ title: "  BANNERS on the   new palettes! " }, thor)).toBe("Thor");
    expect(dup({ title: "banners, on the new-palettes" }, thor)).toBe("Thor");
    expect(dup({ title: "Bannèrs on the new palettes" }, thor)).toBe("Thor");
    expect(dup({ title: "Banners on the old palettes" }, thor)).toBeNull();
    expect(normalisedTitle("Hello,   World — v2!")).toBe("hello world v2");
  });

  it("is not a title too short to say anything", () => {
    expect(dup({ title: "Fix" }, work({ title: "fix" }))).toBeNull();
  });

  it("is a brief with most of its words shared", () => {
    const thor = work({ brief: "Recolour the README banners and badges in the Dark and Expressive palette, then commit the images on your branch." });
    expect(dup({ brief: "Please recolour banners and badges for the Expressive palette in dark mode; update the images." }, thor)).toBe("Thor");
    // Plurals and word order do not matter.
    expect(dup({ brief: "Badges and banners, recolour the images: README, Dark palette, Expressive palette." }, thor)).toBe("Thor");
  });

  it("is a brief given twice under two titles", () => {
    const brief = "Add a guard so that a second agent cannot start on a task another agent is already working on, and refuse it in plain English.";
    expect(dup({ title: "Guard", brief }, work({ title: "No duplicate agents", brief }))).toBe("Thor");
  });

  it("is a brief with the same rules and the same task said again in other words", () => {
    const first = `Recolour the README banners and badges in the Dark palette. ${RULES}`;
    const again = `Dark palette: recolour the README badges and banners. ${RULES}`;
    expect(dup({ brief: again }, work({ brief: first }))).toBe("Thor");
    // The rules said first.
    expect(dup({ brief: `${RULES} ${again}` }, work({ brief: `${RULES} ${first}` }))).toBe("Thor");
    // The very same brief, rules and all.
    expect(dup({ brief: first }, work({ brief: first }))).toBe("Thor");
  });
});

describe("two different tasks on one repo", () => {
  it("are not flagged: recolouring the banners and linking agents to the Kanban board", () => {
    expect(dup({ title: "Link agents to the Kanban board", brief: "link agents to the Kanban board" }, work({ title: "Banners on the new palettes", brief: "recolour the banners" }))).toBeNull();
    expect(dup({ brief: "link agents to the Kanban board" }, work({ brief: "recolour the banners" }))).toBeNull();
  });

  it("are not flagged when their briefs only share the rules they were both given", () => {
    const banners = `Recolour the README banners and badges in the Dark palette. ${RULES}`;
    const kanban = `Link every agent to its card on the Kanban board. ${RULES}`;
    expect(dup({ brief: kanban }, work({ brief: banners }))).toBeNull();
    // The same tasks, their rules said first.
    expect(dup({ brief: `${RULES} Link every agent to its card on the Kanban board.` }, work({ brief: `${RULES} Recolour the README banners and badges in the Dark palette.` }))).toBeNull();
  });

  it("are not flagged when one template is aimed at two different files", () => {
    const tests = (file: string) => `Write the unit tests for ${file}: cover the happy path, the errors and the edge cases, and keep every test small and fast.`;
    expect(dup({ brief: tests("src/mcp/agentTools.ts") }, work({ brief: tests("src/mission/queue.ts") }))).toBeNull();
    expect(dup({ title: "Add tests", brief: tests("spawnAgent") }, work({ title: "Add tests", brief: tests("pumpQueue") }))).toBeNull();
    // Aimed at the same file, it is the same job.
    expect(dup({ brief: tests("src/mcp/agentTools.ts") }, work({ brief: tests("src/mcp/agentTools.ts") }))).toBe("Thor");
  });

  it("are not flagged for a short brief: too little to tell", () => {
    expect(dup({ brief: "Fix the build" }, work({ brief: "Fix the build" }))).toBeNull();
    expect(dup({ brief: "Fix the failing build today" }, work({ brief: "Fix the failing build today" }))).toBeNull();
  });

  it("are not flagged for a brief that shares a few words only", () => {
    const thor = work({ brief: "Recolour the README banners and badges in the Dark and Expressive palettes, and commit the images." });
    expect(dup({ brief: "Recolour the title bar and the tabs of the settings window in the Dark palette." }, thor)).toBeNull();
  });
});

describe("who counts", () => {
  const brief = "Recolour the README banners and badges in the Dark and Expressive palettes, then commit the images.";

  it("is an agent working, waiting or starting", () => {
    for (const state of ["working", "waiting", "starting"] as const) expect(dup({ brief }, work({ brief, state }))).toBe("Thor");
  });

  it("is not an agent idle, stopped or done", () => {
    for (const state of ["idle", "stopped", "done"] as const) expect(dup({ brief, card: "c1", title: "Banners" }, work({ brief, card: "c1", title: "Banners", state }))).toBeNull();
  });

  it("is the first of those at work, however many are not", () => {
    const found = findDuplicateWork({ card: "c1" }, [work({ card: "c1", state: "idle" }), work({ agentId: "loki", name: "Loki", card: "c1" }), work({ agentId: "odin", name: "Odin", card: "c1" })]);
    expect(found?.agentId).toBe("loki");
  });

  it("is nobody when nobody is at work", () => {
    expect(findDuplicateWork({ title: "Banners", brief, card: "c1" }, [])).toBeNull();
  });

  it("is nobody for a task that says nothing", () => {
    expect(dup({}, work({ title: "Banners", brief, card: "c1" }))).toBeNull();
  });
});
