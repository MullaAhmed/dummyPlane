// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { linkedClaudeAgents } from "@/mission/store";
import { notesTool, notesToolSpec } from "./agentTool";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/store", () => ({ linkedClaudeAgents: vi.fn(() => [{ nodeId: "isis", name: "Isis" }, { nodeId: "thot", name: "Thoth" }]) }));

const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
let asked: { command: string; args: unknown }[];

beforeEach(() => {
  asked = [];
  mockIPC((command, args) => {
    asked.push({ command, args });
    if (command === "notes_agent_list") return [{ name: "Auth", attached: true }, { name: "Deploy", attached: false }];
    if (command === "notes_agent_read") {
      if ((args as { name: string }).name === "bad") throw { kind: "invalidInput", message: "path refused: bad" };
      return "# Auth\nbody";
    }
    return undefined;
  });
});
afterEach(() => {
  clearMocks();
});

describe("the notes tool (spec notes §3)", () => {
  it("takes one optional argument and changes nothing", () => {
    const spec = notesToolSpec();
    expect(spec.name).toBe("notes");
    expect(spec.inputSchema).toMatchObject({ type: "object", properties: { name: { type: "string" } } });
    expect(spec.inputSchema).not.toHaveProperty("required");
  });

  it("lists the notes, those of the agent's group marked", async () => {
    const text = textOf(await notesTool("anubis", false, {}));
    expect(text).toContain("Auth (attached to your group)");
    expect(text).toContain("Deploy");
    expect(text).not.toContain("Deploy (attached");
    expect(asked[0]).toMatchObject({ command: "notes_agent_list", args: { nodeIds: ["anubis"] } });
  });

  it("asks for the fleet's agents too", async () => {
    await notesTool("chef", true, {});
    expect(linkedClaudeAgents).toHaveBeenCalledWith("chef");
    expect(asked[0]).toMatchObject({ args: { nodeIds: ["chef", "isis", "thot"] } });
  });

  it("reads a note by its name", async () => {
    expect(textOf(await notesTool("anubis", false, { name: "Auth" }))).toBe("# Auth\nbody");
    expect(asked[0]).toMatchObject({ command: "notes_agent_read", args: { nodeId: "anubis", name: "Auth" } });
  });

  it("gives a refused path back as a readable error", async () => {
    const result = await notesTool("anubis", false, { name: "bad" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("path refused");
  });

  it("refuses a name that is no text", async () => {
    const result = await notesTool("anubis", false, { name: 3 });
    expect(result.isError).toBe(true);
    expect(asked).toEqual([]);
  });

  it("says when there are no notes", async () => {
    mockIPC(() => []);
    expect(textOf(await notesTool("anubis", false, {}))).toContain("No notes in this project");
  });

  it("cuts a very long note, and says so", async () => {
    mockIPC(() => "x".repeat(200_000));
    const text = textOf(await notesTool("anubis", false, { name: "long" }));
    expect(text.length).toBeLessThan(101_000);
    expect(text).toContain("note cut");
  });

  it("describes itself in English", () => {
    expect(notesToolSpec().description).toContain("Markdown");
  });
});
