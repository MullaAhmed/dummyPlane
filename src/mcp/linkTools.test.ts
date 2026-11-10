// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { wireActivityStore } from "@/canvas/wireActivity";
import { markLaunching } from "@/fleet/spawnFamily";
import { withAgentLink, withWire } from "@/fleet/wires";
import { notify } from "@/mission/events";
import { terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { answer } from "./router";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" } }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "line 1\nline 2") }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));

const call = (nodeId: string, name: string, args: Record<string, unknown> = {}) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } }) as Promise<{ content: { text: string }[]; isError?: boolean }>;
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

const element = (kind: "terminal" | "orchestrator", id: string, x: number) => ({ ...createNodeElement(kind, { x, y: 0 }), id }) as unknown as ExcalidrawElement;
const nodes = [element("terminal", "isis", 0), element("terminal", "thot", 1200), element("terminal", "horus", 2400), element("terminal", "sh", 3600), element("orchestrator", "chef", 4800)];
let scene: readonly ExcalidrawElement[] = nodes;

const terminal = (id: string, name: string, agent: "claude" | "shell" = "claude") =>
  nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: "", name, agent, cwd: "C:/code", shell: "default", command: "" } });

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElements: () => scene.filter((e) => !e.isDeleted), getSceneElementsIncludingDeleted: () => scene } as never });
  await terminal("isis", "Isis");
  await terminal("thot", "Thot");
  await terminal("horus", "Horus");
  await terminal("sh", "Shell", "shell");
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
});
beforeEach(() => {
  scene = nodes;
  vi.mocked(notify).mockClear();
  vi.mocked(terminalText).mockClear();
  terminalStatusStore.getState().set("thot", { state: "running" });
  terminalStatusStore.getState().set("isis", { state: "running" });
});
afterEach(() => {
  agentActivityStore.setState({ activities: {} });
  wireActivityStore.setState({ pulses: {} });
});

describe("linked agents' tools", () => {
  it("are listed for agents after their own tools, and refused to an orchestrator", async () => {
    const list = (await answer({ callId: 1, nodeId: "isis", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["declare_steps", "step", "report", "spawn_agent", "linked_agents", "message_agent", "read_agent", "notes"]);
    const manager = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(manager.tools.map((t) => t.name)).not.toContain("message_agent");
    expect(textOf(await call("chef", "message_agent", { agent: "Isis", text: "hi" }))).toBe("This tool is for agents.");
  });

  it("say no agent is linked when no wire joins the caller to another agent, an orchestrator's wire included", async () => {
    scene = withWire(nodes, "chef", "isis");
    expect(textOf(await call("isis", "linked_agents"))).toContain("No agent is linked to you");
    const refused = await call("isis", "message_agent", { agent: "Chef", text: "hi" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("No agent is linked to you");
    expect(notify).not.toHaveBeenCalled();
  });

  it("list the linked agents from either end, with their state and how they are linked", async () => {
    scene = withAgentLink(nodes, "isis", "thot");
    expect(JSON.parse(textOf(await call("isis", "linked_agents")))).toEqual([{ name: "Thot", id: "thot", state: "idle", relation: "linked" }]);
    expect(JSON.parse(textOf(await call("thot", "linked_agents")))).toEqual([{ name: "Isis", id: "isis", state: "idle", relation: "linked" }]);
    expect(textOf(await call("horus", "linked_agents"))).toContain("No agent is linked to you");
  });

  it("message a linked agent either way, typed as a [dummyPlane] line saying who sends it", async () => {
    scene = withAgentLink(nodes, "isis", "thot");
    const sent = await call("isis", "message_agent", { agent: "thot", text: "The API is ready,\nplease rebase." });
    expect(sent.isError).toBeUndefined();
    expect(textOf(sent)).toContain("Sent to Thot");
    expect(notify).toHaveBeenCalledWith("thot", expect.stringMatching(/^Message from Isis \(a linked agent.*\): The API is ready, please rebase\.$/));
    // The light runs from the wire's start (isis) to its end (thot).
    expect(wireActivityStore.getState().pulses.thot).toMatchObject({ direction: "toAgent", orchestratorId: "isis" });
    await call("thot", "message_agent", { agent: "Isis", text: "Rebased." });
    expect(notify).toHaveBeenLastCalledWith("isis", expect.stringContaining("Message from Thot"));
    // Back the other way along the same wire.
    expect(wireActivityStore.getState().pulses.thot).toMatchObject({ direction: "toOrchestrator", orchestratorId: "isis" });
  });

  it("refuse an agent that is not linked, naming those that are, and send nothing", async () => {
    scene = withAgentLink(nodes, "isis", "thot");
    const refused = await call("isis", "message_agent", { agent: "Horus", text: "hi" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe('"Horus" is not linked to you. Linked: Thot.');
    expect((await call("isis", "read_agent", { agent: "Horus" })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(terminalText).not.toHaveBeenCalled();
  });

  it("refuse once the wire is deleted: unlinking is deleting the wire", async () => {
    const linked = withAgentLink(nodes, "isis", "thot");
    scene = linked.map((e) => (e.type === "arrow" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect((await call("isis", "message_agent", { agent: "Thot", text: "hi" })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuse an empty message and a stopped agent; hold a message while a dialog waits for the user", async () => {
    scene = withAgentLink(nodes, "isis", "thot");
    expect(textOf(await call("isis", "message_agent", { agent: "Thot", text: "  " }))).toBe("Nothing to send (text).");
    expect(textOf(await call("isis", "message_agent", { agent: "Thot" }))).toBe("Nothing to send (text).");
    expect(textOf(await call("isis", "message_agent", { text: "hi" }))).toBe("Name the linked agent (agent).");
    terminalStatusStore.getState().set("thot", { state: "stopped" });
    expect(textOf(await call("isis", "message_agent", { agent: "Thot", text: "hi" }))).toContain("Thot is stopped");
    expect(notify).not.toHaveBeenCalled();
    terminalStatusStore.getState().set("thot", { state: "running" });
    agentActivityStore.setState({ activities: { thot: { activity: "waiting", since: 1 } } });
    expect(textOf(await call("isis", "message_agent", { agent: "Thot", text: "hi" }))).toContain("typed as soon as it is answered");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("never reach a plain shell, even wired: it would run the message as a command", async () => {
    // A wire drawn to a shell some other way than "+ Link".
    scene = withWire(nodes, "isis", "sh");
    expect(textOf(await call("isis", "linked_agents"))).toContain("No agent is linked to you");
    expect((await call("isis", "message_agent", { agent: "Shell", text: "rm -rf ." })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("read the end of a linked agent's terminal, 50 lines by default, 200 at most", async () => {
    scene = withAgentLink(nodes, "isis", "thot");
    expect(textOf(await call("isis", "read_agent", { agent: "Thot" }))).toBe("line 1\nline 2");
    expect(terminalText).toHaveBeenLastCalledWith("thot", 50);
    await call("thot", "read_agent", { agent: "isis", lines: 5000 });
    expect(terminalText).toHaveBeenLastCalledWith("isis", 200);
  });

  it("see a sub-agent and its parent as linked through spawn_agent's wire", async () => {
    await nodesStore.getState().update("horus", { spawnedBy: "isis" });
    try {
      scene = withWire(nodes, "isis", "horus", "calm", true);
      expect(JSON.parse(textOf(await call("isis", "linked_agents")))).toMatchObject([{ name: "Horus", relation: "sub-agent" }]);
      expect(JSON.parse(textOf(await call("horus", "linked_agents")))).toMatchObject([{ name: "Isis", relation: "parent" }]);
    } finally {
      await nodesStore.getState().update("horus", { spawnedBy: undefined });
    }
  });

  it("refuse a sub-agent still starting: its shell runs before its Claude", async () => {
    scene = withWire(nodes, "isis", "horus", "calm", true);
    terminalStatusStore.getState().set("horus", { state: "running" });
    markLaunching("horus", true);
    try {
      expect(textOf(await call("isis", "message_agent", { agent: "Horus", text: "hi" }))).toContain("Horus is still starting");
      expect(notify).not.toHaveBeenCalled();
    } finally {
      markLaunching("horus", false);
    }
    expect(textOf(await call("isis", "message_agent", { agent: "Horus", text: "hi" }))).toContain("Sent to Horus");
  });
});
