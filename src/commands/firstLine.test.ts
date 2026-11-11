// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import type { CommandContext } from "./command";
import { functionSections } from "./functions";
import { COMMANDS } from "./registry";

vi.mock("@excalidraw/excalidraw", () => ({}));

const fromBatman: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman" };
const chosen = (query: string) => functionSections(COMMANDS, fromBatman, query)[0]?.items[0];

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s1" },
  });
  canvasStore.setState({
    frames: [{ id: "g1", name: "Backend", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["batman"] }],
  });
  terminalStatusStore.getState().set("batman", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 0 });
});

describe("the line chosen by a search, from a Claude terminal", () => {
  it("is the function of the terminal of the moment, not a loose match in an earlier section", () => {
    expect(chosen("pause")).toMatchObject({ label: "Pause", section: "Terminal · Batman" });
    expect(chosen("restart")).toMatchObject({ label: "Restart", section: "Terminal · Batman" });
    expect(chosen("rename")).toMatchObject({ label: "Rename", section: "Terminal · Batman" });
  });

  it("still finds the others by their own words", () => {
    expect(chosen("rename workspace")?.label).toBe("Rename workspace");
    expect(chosen("all pause")?.label).toBe("Pause all");
    expect(chosen("launch claude")?.label).toBe("Launch Claude");
  });
});
