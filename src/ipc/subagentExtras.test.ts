// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { readTerminalPayload } from "@/nodes/types";
import { checkSubagentExtras, readSubagentExtras } from "./subagentExtras";

describe("a sub-agent's stored pick", () => {
  it("keeps each kind picked, an empty one included (it means none), and drops what is no list of names", () => {
    expect(readSubagentExtras({ skills: [" deploy ", "deploy", "", 3], mcpServers: [], plugins: "pdf" })).toEqual({ skills: ["deploy"], mcpServers: [] });
    // A kind left out is the CLI's defaults: it stays out.
    expect(readSubagentExtras({ plugins: ["a@b"] })).toEqual({ plugins: ["a@b"] });
    expect(readSubagentExtras({})).toBeUndefined();
    expect(readSubagentExtras({ skills: null })).toBeUndefined();
    expect(readSubagentExtras("skills")).toBeUndefined();
    expect(readSubagentExtras(null)).toBeUndefined();
  });

  it("survives a save and a reload with its terminal, so a restart or a resume launches it the same", () => {
    const saved = { title: "Tests", name: "Robin", agent: "codex", cwd: "C:/code", shell: "pwsh", command: "", extras: { skills: [], mcpServers: ["supabase"] } };
    expect(readTerminalPayload(JSON.parse(JSON.stringify(saved)))?.extras).toEqual({ skills: [], mcpServers: ["supabase"] });
    expect(readTerminalPayload({ ...saved, extras: { skills: "x" } })).not.toHaveProperty("extras");
  });

  it("reads Rust's checked pick back, a kind it leaves out read as none picked", async () => {
    mockIPC((cmd, args) => (cmd === "check_subagent_extras" ? { ...(args as { pick: object }).pick, plugins: undefined } : undefined));
    await expect(checkSubagentExtras("claude", "C:/code", undefined, { skills: ["deploy"] })).resolves.toEqual({ skills: ["deploy"] });
  });
});
