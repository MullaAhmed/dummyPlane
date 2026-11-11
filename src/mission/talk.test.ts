// @vitest-environment happy-dom
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createNodeElement } from "@/canvas/nodeElement";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { fleetTargets, isTalkWire, isWire, withWire } from "@/agents/wires";
import { ptySendText } from "@/ipc/pty";
import { linkTool } from "@/mcp/linkTools";
import { managerTool } from "@/mcp/fleetTools";
import { report } from "@/mcp/agentTools";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { agentActivityStore } from "@/store/agentActivity";
import { notify } from "./events";
import type { Member } from "./mission";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(() => Promise.resolve()) }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("./queue", () => ({ afterReport: vi.fn(() => Promise.resolve()), pumpQueue: vi.fn(() => Promise.resolve()), giveNext: vi.fn() }));
// The workspace's scene, stored (not on screen): what talk() reads and writes.
let scene: ExcalidrawElement[] = [];
vi.mock("@/agents/sceneAccess", () => ({
  sceneAccess: vi.fn(() => ({ shown: false, elements: () => scene, write: (elements: readonly ExcalidrawElement[]) => (scene = [...elements]) })),
}));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: "C:/w", shell: "default", command: "", ...extra });
const member = (nodeId: string, name: string): Member => ({ nodeId, name, task: name, budgetMin: 20, linked: false, branch: `b-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 1 });
const node = (kind: "fleet" | "terminal", id: string, x: number, y: number) => ({ ...createNodeElement(kind, { x, y }), id });
const wires = () => scene.filter((e) => !e.isDeleted && e.type === "arrow" && isWire(e)) as ExcalidrawArrowElement[];
const between = (a: string, b: string) => wires().filter((w) => [w.startBinding?.elementId, w.endBinding?.elementId].sort().join() === [a, b].sort().join());

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  clearWirePulses();
  nodesStore.setState({ nodes: {} });
  await nodesStore.getState().create("sitter", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, manager: "boss", members: [member("robin", "Robin"), member("cyborg", "Cyborg"), member("batman", "Batman")] } },
  });
  await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: terminal("Manager", { role: "manager", fleet: "sitter" }) });
  await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload: terminal("Robin", { spawnedBy: "boss" }) });
  await nodesStore.getState().create("cyborg", { workspaceId: "w1", kind: "terminal", payload: terminal("Cyborg", { spawnedBy: "boss" }) });
  // Batman was linked to the Fleet before the mission: no wire to the Manager.
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal("Batman") });
  for (const id of ["sitter", "boss", "robin", "cyborg", "batman"]) terminalStatusStore.getState().set(id, { state: "running" });
  agentActivityStore.setState({ activities: {} });
  scene = [node("fleet", "sitter", 0, 0), node("terminal", "boss", 1000, 900), node("terminal", "robin", 1000, 1500), node("terminal", "cyborg", 1800, 1500), node("terminal", "batman", 3000, 0)];
  scene = withWire(scene, "boss", "robin", undefined, true);
  scene = withWire(scene, "boss", "cyborg", undefined, true);
});

describe("wires form when the agents of a mission talk", () => {
  it("draws a dashed talk wire between two teammates at their first message, and lights it on every message", () => {
    expect(linkTool("robin", "message_agent", { agent: "Cyborg", text: "Your API is ready" })?.isError).toBeUndefined();
    expect(notify).toHaveBeenCalledWith("cyborg", expect.stringContaining("Message from Robin"));
    const [talk] = between("robin", "cyborg");
    expect(isTalkWire(talk)).toBe(true);
    expect(talk.strokeStyle).toBe("dashed");
    expect(wireActivityStore.getState().pulses.cyborg).toMatchObject({ direction: "toAgent", fleetId: "robin" });
    // The second message takes the same wire, the other way.
    linkTool("cyborg", "message_agent", { agent: "Robin", text: "Thanks" });
    expect(between("robin", "cyborg")).toHaveLength(1);
    expect(wireActivityStore.getState().pulses.cyborg).toMatchObject({ direction: "toFleet", fleetId: "robin" });
    // Never a team link: the Fleet's team is what it is wired to by hand.
    expect(fleetTargets(scene, "sitter").nodeIds).toEqual([]);
  });

  it("lets a team agent message its Manager over their spawn wire, with no new wire, as a team agent's message", () => {
    linkTool("robin", "message_agent", { agent: "Manager", text: "Which branch?" });
    expect(notify).toHaveBeenCalledWith("boss", expect.stringContaining("answer with write"));
    expect(between("robin", "boss")).toHaveLength(1);
    expect(wireActivityStore.getState().pulses.robin).toMatchObject({ direction: "toFleet", fleetId: "boss" });
  });

  it("draws the wire when the Manager writes to a team agent it has none to", async () => {
    expect((await managerTool("boss", "ecrire", { agent: "Batman", texte: "Merge the mission's branch" })).isError).toBeUndefined();
    expect(ptySendText).toHaveBeenCalledWith("batman", "Merge the mission's branch");
    const [talk] = between("boss", "batman");
    expect(isTalkWire(talk)).toBe(true);
    expect(talk.startBinding?.elementId).toBe("boss");
    expect(fleetTargets(scene, "sitter").nodeIds).toEqual([]);
  });

  it("takes a report up the spawn wire to the Manager, and draws one to a team agent that had none", () => {
    report("robin", { resume: "Login done", statut: "termine" });
    expect(between("robin", "boss")).toHaveLength(1);
    expect(wireActivityStore.getState().pulses.robin).toMatchObject({ direction: "toFleet", fleetId: "boss" });
    report("batman", { resume: "Docs done", statut: "termine" });
    expect(isTalkWire(between("batman", "boss")[0])).toBe(true);
    expect(notify).toHaveBeenCalledWith("boss", "Batman reported (done): Docs done");
    expect(vi.mocked(notify).mock.calls.some(([id]) => id === "sitter")).toBe(false);
  });
});
