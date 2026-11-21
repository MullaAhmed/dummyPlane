import { describe, expect, it } from "vitest";
import { dialogOf } from "./dialogScreen";
import { MCP_ONE, MCP_MANY, MCP_AUTH_NOTICE, PERMISSION, TRUST, LOGIN, CLAUDE, WORKING, QUOTED, CODEX_TRUST, CODEX } from "./dialogFixtures";

describe("dialogOf", () => {
  it("reads Claude Code's question about a project's new MCP server, its choices and the one selected", () => {
    expect(dialogOf(MCP_ONE)).toEqual({
      kind: "mcp",
      title: "New MCP server found in this project: supabase",
      detail: "MCP servers may execute code or access system resources. All tool calls",
      options: ["Use this MCP server", "Use this and all future MCP servers in this project", "Continue without using this MCP server"],
      selected: 2,
    });
    expect(dialogOf(MCP_MANY)).toMatchObject({ kind: "mcp", title: "8 new MCP servers found in this project", options: ["Enable selected"] });
  });

  it("reads a permission request: its tool, what it is for, its question, and when Claude Code refuses it by itself", () => {
    expect(dialogOf(PERMISSION)).toEqual({
      kind: "permission",
      title: "Bash command",
      detail: "Stop background run and delete stray T11 artifacts in worktree",
      question: "Do you want to proceed?",
      options: ["1. Yes", "2. No"],
      selected: 0,
      blocksInMs: 110_000,
    });
  });

  it("reads a trust question and the login screen, which names no keys", () => {
    expect(dialogOf(TRUST)).toMatchObject({
      kind: "trust",
      question: "Quick safety check: Is this a project you created or one you trust?",
      options: ["No, exit", "Yes, I trust this folder"],
      selected: 0,
    });
    expect(dialogOf(LOGIN)).toMatchObject({ kind: "login", title: "Select login method:", selected: 0 });
    expect(dialogOf(CODEX_TRUST, "codex")).toMatchObject({ kind: "trust", options: ["1. Trust and continue", "2. Back to Agent Command Center"], selected: 0 });
  });

  it("sees no dialog in a prompt, a turn at work, nor in a dialog's words quoted above a prompt", () => {
    expect(dialogOf(CLAUDE)).toBeNull();
    expect(dialogOf(WORKING)).toBeNull();
    expect(dialogOf(QUOTED)).toBeNull();
    // Even right above its prompt.
    expect(dialogOf(QUOTED.replace("\n\n● Thor waits on the MCP question.\n", "\n"))).toBeNull();
    expect(dialogOf(`${LOGIN}\n\n${CLAUDE}`)).toBeNull();
    expect(dialogOf(CODEX, "codex")).toBeNull();
    // Claude Code's real "1 MCP server needs authentication" notice, above its prompt: not the MCP-selection dialog.
    expect(dialogOf(`${MCP_AUTH_NOTICE}\n\n${CLAUDE}`)).toBeNull();
    expect(dialogOf("")).toBeNull();
    // A CLI dummyPlane cannot read draws no dialog it knows.
    expect(dialogOf(MCP_ONE, "gemini")).toBeNull();
  });

  it("keeps each text on one line and short: it is typed into another agent's terminal", () => {
    const long = MCP_ONE.replace("supabase", "x".repeat(400));
    const read = dialogOf(long)!;
    expect(read.title.length).toBeLessThanOrEqual(160);
    expect(read.title.endsWith("…")).toBe(true);
    expect(read.title).not.toMatch(/\n/);
  });
});
