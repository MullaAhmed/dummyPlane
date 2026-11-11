// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { wireActivityStore } from "@/canvas/wireActivity";
import { markLaunching } from "@/agents/spawnFamily";
import { withAgentLink, withWire } from "@/agents/wires";
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

const element = (kind: "terminal" | "fleet", id: string, x: number) => ({ ...createNodeElement(kind, { x, y: 0 }), id }) as unknown as ExcalidrawElement;
const nodes = [element("terminal", "batman", 0), element("terminal", "cyborg", 1200), element("terminal", "aquaman", 2400), element("terminal", "sh", 3600), element("fleet", "chef", 4800)];
let scene: readonly ExcalidrawElement[] = nodes;

const terminal = (id: string, name: string, agent: "claude" | "shell" = "claude") =>
  nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: "", name, agent, cwd: "C:/code", shell: "default", command: "" } });

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElements: () => scene.filter((e) => !e.isDeleted), getSceneElementsIncludingDeleted: () => scene } as never });
  await terminal("batman", "Batman");
  await terminal("cyborg", "Cyborg");
  await terminal("aquaman", "Aquaman");
  await terminal("sh", "Shell", "shell");
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
});
beforeEach(() => {
  scene = nodes;
  vi.mocked(notify).mockClear();
  vi.mocked(terminalText).mockClear();
  terminalStatusStore.getState().set("cyborg", { state: "running" });
  terminalStatusStore.getState().set("batman", { state: "running" });
});
afterEach(() => {
  agentActivityStore.setState({ activities: {} });
  wireActivityStore.setState({ pulses: {} });
});

describe("linked agents' tools", () => {
  it("are listed for agents after their own tools, and refused to a fleet", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["declare_steps", "step", "report", "spawn_agent", "linked_agents", "message_agent", "read_agent", "linked_boards", "add_board_card", "move_board_card", "show_output", "output_guide", "read_node", "notes"]);
    const manager = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(manager.tools.map((t) => t.name)).not.toContain("message_agent");
    expect(textOf(await call("chef", "message_agent", { agent: "Batman", text: "hi" }))).toBe("This tool is for agents.");
  });

  it("say no agent is linked when no wire joins the caller to another agent; a fleet's wire lists the Fleet, not an agent", async () => {
    scene = nodes;
    expect(textOf(await call("batman", "linked_agents"))).toContain("No agent is linked to you");
    const refused = await call("batman", "message_agent", { agent: "Cyborg", text: "hi" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("No agent is linked to you");
    // The Fleet that commands it is its own relation (`./handOff.test.ts`).
    scene = withWire(nodes, "chef", "batman");
    expect(JSON.parse(textOf(await call("batman", "linked_agents")))).toEqual([{ name: "Chef", id: "chef", state: "stopped", relation: "fleet" }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("list the linked agents from either end, with their state and how they are linked", async () => {
    scene = withAgentLink(nodes, "batman", "cyborg");
    expect(JSON.parse(textOf(await call("batman", "linked_agents")))).toEqual([{ name: "Cyborg", id: "cyborg", state: "idle", relation: "linked" }]);
    expect(JSON.parse(textOf(await call("cyborg", "linked_agents")))).toEqual([{ name: "Batman", id: "batman", state: "idle", relation: "linked" }]);
    expect(textOf(await call("aquaman", "linked_agents"))).toContain("No agent is linked to you");
  });

  it("message a linked agent either way, typed as a [dummyPlane] line saying who sends it", async () => {
    scene = withAgentLink(nodes, "batman", "cyborg");
    const sent = await call("batman", "message_agent", { agent: "cyborg", text: "The API is ready,\nplease rebase." });
    expect(sent.isError).toBeUndefined();
    expect(textOf(sent)).toContain("Sent to Cyborg");
    expect(notify).toHaveBeenCalledWith("cyborg", expect.stringMatching(/^Message from Batman \(a linked agent.*\): The API is ready, please rebase\.$/));
    // The light runs from the wire's start (batman) to its end (cyborg).
    expect(wireActivityStore.getState().pulses.cyborg).toMatchObject({ direction: "toAgent", fleetId: "batman" });
    await call("cyborg", "message_agent", { agent: "Batman", text: "Rebased." });
    expect(notify).toHaveBeenLastCalledWith("batman", expect.stringContaining("Message from Cyborg"));
    // Back the other way along the same wire.
    expect(wireActivityStore.getState().pulses.cyborg).toMatchObject({ direction: "toFleet", fleetId: "batman" });
  });

  it("refuse an agent that is not linked, naming those that are, and send nothing", async () => {
    scene = withAgentLink(nodes, "batman", "cyborg");
    const refused = await call("batman", "message_agent", { agent: "Aquaman", text: "hi" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe('"Aquaman" is not linked to you. Linked: Cyborg.');
    expect((await call("batman", "read_agent", { agent: "Aquaman" })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(terminalText).not.toHaveBeenCalled();
  });

  it("refuse once the wire is deleted: unlinking is deleting the wire", async () => {
    const linked = withAgentLink(nodes, "batman", "cyborg");
    scene = linked.map((e) => (e.type === "arrow" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect((await call("batman", "message_agent", { agent: "Cyborg", text: "hi" })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuse an empty message and a stopped agent; hold a message while a dialog waits for the user", async () => {
    scene = withAgentLink(nodes, "batman", "cyborg");
    expect(textOf(await call("batman", "message_agent", { agent: "Cyborg", text: "  " }))).toBe("Nothing to send (text).");
    expect(textOf(await call("batman", "message_agent", { agent: "Cyborg" }))).toBe("Nothing to send (text).");
    expect(textOf(await call("batman", "message_agent", { text: "hi" }))).toBe("Name the linked agent (agent).");
    terminalStatusStore.getState().set("cyborg", { state: "stopped" });
    expect(textOf(await call("batman", "message_agent", { agent: "Cyborg", text: "hi" }))).toContain("Cyborg is stopped");
    expect(notify).not.toHaveBeenCalled();
    terminalStatusStore.getState().set("cyborg", { state: "running" });
    agentActivityStore.setState({ activities: { cyborg: { activity: "waiting", since: 1 } } });
    expect(textOf(await call("batman", "message_agent", { agent: "Cyborg", text: "hi" }))).toContain("typed as soon as it is answered");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("never reach a plain shell, even wired: it would run the message as a command", async () => {
    // A wire drawn to a shell some other way than "+ Link".
    scene = withWire(nodes, "batman", "sh");
    expect(textOf(await call("batman", "linked_agents"))).toContain("No agent is linked to you");
    expect((await call("batman", "message_agent", { agent: "Shell", text: "rm -rf ." })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("read the end of a linked agent's terminal, 50 lines by default, 200 at most", async () => {
    scene = withAgentLink(nodes, "batman", "cyborg");
    expect(textOf(await call("batman", "read_agent", { agent: "Cyborg" }))).toBe("line 1\nline 2");
    expect(terminalText).toHaveBeenLastCalledWith("cyborg", 50);
    await call("cyborg", "read_agent", { agent: "batman", lines: 5000 });
    expect(terminalText).toHaveBeenLastCalledWith("batman", 200);
  });

  it("see a sub-agent and its parent as linked through spawn_agent's wire", async () => {
    await nodesStore.getState().update("aquaman", { spawnedBy: "batman" });
    try {
      scene = withWire(nodes, "batman", "aquaman", "calm", true);
      expect(JSON.parse(textOf(await call("batman", "linked_agents")))).toMatchObject([{ name: "Aquaman", relation: "sub-agent" }]);
      expect(JSON.parse(textOf(await call("aquaman", "linked_agents")))).toMatchObject([{ name: "Batman", relation: "parent" }]);
    } finally {
      await nodesStore.getState().update("aquaman", { spawnedBy: undefined });
    }
  });

  it("refuse a sub-agent still starting: its shell runs before its Claude", async () => {
    scene = withWire(nodes, "batman", "aquaman", "calm", true);
    terminalStatusStore.getState().set("aquaman", { state: "running" });
    markLaunching("aquaman", true);
    try {
      expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: "hi" }))).toContain("Aquaman is still starting");
      expect(notify).not.toHaveBeenCalled();
    } finally {
      markLaunching("aquaman", false);
    }
    expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: "hi" }))).toContain("Sent to Aquaman");
  });
});
