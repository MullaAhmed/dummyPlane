import { describe, expect, it } from "vitest";
import { clip, MAX_EXCERPT, MAX_LINE, plainText, sentencesOf, spawnedTask, taskExcerpt, taskSummary } from "./taskSummary";

/** A brief as an orchestrating agent writes one: a "You are…" opening, then setup, steps and paths. */
const BRIEF = `You are fixing a readability problem in dummyPlane (Tauri 2 + React 19 + Tailwind 4 desktop canvas of AI agent terminals). The user said: "when a sub agent is created, under the terminal name the task summary should also be readable".

## Setup (do this first)
1. Your own worktree: from D:\\Projects\\dummyPlane run \`git worktree add -b fix/subagent-task-summary .claude/worktrees/subagent-summary\`, then work ONLY there.
2. Install: \`bunx pnpm@9 install --frozen-lockfile\` there. Typecheck \`node node_modules/typescript/bin/tsc --noEmit -p .\`.
3. Do NOT launch the app.

## Find what the user sees
Two kinds of sub-agent exist; check both and fix whichever shows the task under the name badly:
- A terminal opened by an agent's spawn_agent tool: src/agents/spawn.ts (what it stores: name, title, task).
- Claude's built-in subagents shown as cells: src/nodes/subagent/SubagentNode.tsx.

## Finish
Tests next to what you change, full suite green. Then call report with a summary.`;

describe("taskSummary", () => {
  it("says a long brief in its first sentence, without the « You are » lead-in nor its aside", () => {
    expect(taskSummary(BRIEF)).toBe("Fixing a readability problem in dummyPlane");
  });

  it("skips a sentence that only says who the agent is", () => {
    expect(taskSummary("You are a senior TypeScript engineer. Your job is to add retry logic to the fetch wrapper in src/net/fetch.ts.")).toBe(
      "Add retry logic to the fetch wrapper in src/net/fetch.ts",
    );
    expect(taskSummary("You're an expert reviewer.\n\nPlease review the diff of feat/login for security issues.")).toBe(
      "Review the diff of feat/login for security issues",
    );
  });

  it("keeps a role sentence when it is all there is", () => {
    expect(taskSummary("You are the release manager")).toBe("You are the release manager");
  });

  it("reads a labelled task first, wherever it sits", () => {
    expect(taskSummary("## Context\nThe app is a Tauri canvas.\n\n**Task:** fix the flaky `spawn.test.ts`. Then report.")).toBe("Fix the flaky spawn.test.ts");
    expect(taskSummary("# Brief\n\n## Goal\nMake the minimized card readable in the calm palette.\n\n## Rules\nNo new tokens.")).toBe(
      "Make the minimized card readable in the calm palette",
    );
  });

  it("takes no label from a how-to section", () => {
    expect(taskSummary("Port the clock widget to React 19.\n\n## Report\nSummary: one line of what changed.")).toBe("Port the clock widget to React 19");
  });

  it("takes a how-to word for one only as a label or a heading: as a verb or a noun it starts a task", () => {
    expect(taskSummary("Test the login flow end to end.\n\nUse the staging account.")).toBe("Test the login flow end to end");
    expect(taskSummary("Set up the CI for the Rust crate.\n\nUse GitHub Actions.")).toBe("Set up the CI for the Rust crate");
    expect(taskSummary("Context menu is misplaced on the canvas.\n\nIt opens off screen.")).toBe("Context menu is misplaced on the canvas");
    expect(taskSummary("Report the failing tests to the fleet.\n\nOne line each.")).toBe("Report the failing tests to the fleet");
    expect(taskSummary("# Test the spawn layout\n\nIt breaks past three levels.")).toBe("Test the spawn layout");
    expect(taskSummary("Context: the app uses Tauri.\n\nFix the build on Windows.")).toBe("Fix the build on Windows");
  });

  it("reads no label in a hyphenated word, nor a lead-in in a plain « First » or « Now »", () => {
    expect(taskSummary("Task-runner config is broken on Windows.")).toBe("Task-runner config is broken on Windows");
    expect(taskSummary("Request-level caching drops the auth header.")).toBe("Request-level caching drops the auth header");
    expect(taskSummary("Task - wire the budget bar.")).toBe("Wire the budget bar");
    expect(taskSummary("First paint is slow on the home screen.")).toBe("First paint is slow on the home screen");
    expect(taskSummary("First, read the spec. Then write the parser.")).toBe("Read the spec");
  });

  it("takes a heading that opens the brief as its title", () => {
    expect(taskSummary("# Fix the flaky spawn test\n\nThe test fails on CI about 1 in 5 runs. Find out why.")).toBe("Fix the flaky spawn test");
  });

  it("skips setup sections, list markers, fences and the app's own tag", () => {
    const task = "[dummyPlane · sub-agent of Atlas]\n## Setup\n- cd D:/code/api\n```sh\npnpm i\n```\n\nThen rename the `user_id` column to `account_id` across the API.";
    expect(taskSummary(task)).toBe("Rename the user_id column to account_id across the API");
  });

  it("ends no sentence at a path's, a version's or an abbreviation's dot", () => {
    expect(taskSummary("Update spawn.ts and NodeHeader.tsx for React 19.2, e.g. the header. Then run the tests.")).toBe(
      "Update spawn.ts and NodeHeader.tsx for React 19.2, e.g. the header",
    );
  });

  it("drops polite and second-person lead-ins", () => {
    expect(taskSummary("Can you please check why the wires flicker on zoom?")).toBe("Check why the wires flicker on zoom");
    expect(taskSummary("I need you to write the changelog entry for 0.9.")).toBe("Write the changelog entry for 0.9");
    expect(taskSummary("You will implement the Git panel's blame view.")).toBe("Implement the Git panel's blame view");
  });

  it("says a task in another language as it is", () => {
    expect(taskSummary("Corrige l'affichage du nom sous le terminal. Ensuite lance les tests.")).toBe("Corrige l'affichage du nom sous le terminal");
    expect(taskSummary("修复终端标题。然后运行测试。")).toBe("修复终端标题。");
  });

  it("keeps names and paths as written, capitalizing only a plain word", () => {
    expect(taskSummary("dummyPlane needs a dark scrollbar")).toBe("dummyPlane needs a dark scrollbar");
    expect(taskSummary("src/agents/spawn.ts: store the task")).toBe("src/agents/spawn.ts: store the task");
  });

  it("is never empty for a task with words, and cut at a word past its length", () => {
    expect(taskSummary("```\nls -la\n```")).toBe("ls -la");
    expect(taskSummary("D:\\Projects\\dummyPlane")).toBe("D:\\Projects\\dummyPlane");
    const long = taskSummary(`Refactor ${"the very long module ".repeat(20)}now.`);
    expect(long.length).toBeLessThanOrEqual(MAX_LINE);
    expect(long.endsWith("…")).toBe(true);
    expect(taskSummary("")).toBe("");
  });
});

describe("taskExcerpt", () => {
  it("gives the task's prose and items, plain, without its setup or how-to sections", () => {
    const excerpt = taskExcerpt(BRIEF);
    expect(excerpt.startsWith("You are fixing a readability problem in dummyPlane (Tauri 2")).toBe(true);
    expect(excerpt).toContain("Two kinds of sub-agent exist");
    expect(excerpt).not.toContain("worktree add");
    expect(excerpt).not.toContain("##");
    expect(excerpt).not.toContain("`");
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT);
  });

  it("keeps a short task whole", () => {
    expect(taskExcerpt("Write the tests")).toBe("Write the tests");
  });
});

describe("spawnedTask", () => {
  const terminal = { title: "Claude · api" };

  it("is nothing for a terminal nobody spawned", () => {
    expect(spawnedTask(terminal)).toBeNull();
  });

  it("says the spawner's title, and the task in its tooltip", () => {
    expect(spawnedTask({ title: "Task summary", spawnedBy: "superman", task: BRIEF })).toEqual({
      line: "Task summary",
      detail: taskExcerpt(BRIEF),
    });
  });

  it("does not repeat a task its line already says", () => {
    expect(spawnedTask({ title: "Write the tests", spawnedBy: "batman", task: "Write the tests" })).toEqual({ line: "Write the tests", detail: "Write the tests" });
  });

  it("says in a line the raw title of a terminal spawned before tasks were kept", () => {
    const title = "You are fixing a readability problem in dummyPlane (Tauri…";
    expect(spawnedTask({ title, spawnedBy: "superman" })).toEqual({ line: "Fixing a readability problem in dummyPlane", detail: title });
  });
});

describe("the pieces", () => {
  it("plainText takes markdown off and leaves snake_case alone", () => {
    expect(plainText("**Fix** the [header](http://x) in `NodeHeader.tsx`, _quickly_, keep snake_case_name")).toBe(
      "Fix the header in NodeHeader.tsx, quickly, keep snake_case_name",
    );
  });

  it("sentencesOf splits at a stop followed by a capital", () => {
    expect(sentencesOf("Fix it. Then test v1.2 i.e. the build. Done!")).toEqual(["Fix it.", "Then test v1.2 i.e. the build.", "Done!"]);
  });

  it("clip cuts at a word", () => {
    expect(clip("one two three four", 12)).toBe("one two…");
    expect(clip("short", 12)).toBe("short");
  });
});
