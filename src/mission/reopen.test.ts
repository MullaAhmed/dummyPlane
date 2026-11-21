// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { sceneAccess } from "@/agents/sceneAccess";
import { createGroupFrame, groupInfoOf } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { notify } from "./events";
import { fleetTool } from "@/mcp/fleetTools";
import { reopenManager } from "./manager";
import { readMission, type Member, type Mission } from "./mission";
import { installMissionRestore, restoreReopened } from "./restore";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "never" }, newElementWith: (e: object, fields: object) => ({ ...e, ...fields }) }));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), markForAutostart: vi.fn() }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("@/agents/sceneAccess", () => ({ sceneAccess: vi.fn() }));
vi.mock("@/agents/spawnTree", () => ({ reflowSpawnTree: vi.fn() }));

const session = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", ...extra });
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({ nodeId, name, task: `t-${name}`, budgetMin: 30, linked: false, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 1, ...extra });

/** The workspace's scene, as `sceneAccess` reads and writes it. */
let scene: ExcalidrawElement[] = [];
const node = (kind: "fleet" | "kanban" | "terminal", id: string, x: number, y: number, extra: Partial<ExcalidrawElement> = {}) =>
  ({ ...createNodeElement(kind, { x, y }), id, ...extra }) as unknown as ExcalidrawElement;
const live = (id: string) => scene.filter((e) => e.id === id && !e.isDeleted);

async function mission(extra: Partial<Mission> = {}, members: Member[] = []) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Chef",
      session: session("Chef", { role: "orchestrator" }),
      mission: { state: "en_cours", maxAgents: 4, name: "Auth", task: "Add sign-in", branch: "dummyplane/auth", manager: "boss", board: "board", members, ...extra },
    },
  });
  for (const m of members) await nodesStore.getState().create(m.nodeId, { workspaceId: "w1", kind: "terminal", payload: session(m.name, { spawnedBy: "boss", claudeSessionId: `s-${m.name}` }) });
}

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  nodesStore.setState({ nodes: {} });
  scene = [node("fleet", "chef", 0, 0), node("kanban", "board", 900, 0)];
  vi.mocked(sceneAccess).mockImplementation(() => ({ elements: () => scene, write: (next: readonly ExcalidrawElement[]) => void (scene = [...next]), shown: false }) as never);
  vi.mocked(relaunchTerminal).mockImplementation(async (id) => terminalStatusStore.getState().set(id, { state: "running" }));
  for (const id of ["chef", "boss", "robin", "flash"]) terminalStatusStore.getState().remove(id);
});

describe("the Fleet's relaunch of a Manager closed while its mission runs", () => {
  it("brings it back under the same node, in its team's group, on its own conversation (closed since dummyPlane started)", async () => {
    const frame = { ...createGroupFrame({ x: 900, y: 700, width: 900, height: 900 }, "Mission Auth", { role: "general", pantheon: "marvel" }), id: "team" } as ExcalidrawElement;
    await mission({}, [member("robin", "Robin")]);
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: session("Manager", { role: "manager", fleet: "chef", claudeSessionId: "s-boss" }) });
    // Closed by the user: its record stays in memory, its element is deleted.
    nodesStore.getState().close("boss");
    scene = [...scene, frame, node("terminal", "robin", 1300, 1300, { frameId: "team" }), node("terminal", "boss", 1300, 900, { isDeleted: true, frameId: "team", version: 7 })];
    expect(await reopenManager("chef")).toBeNull();
    // One element under that id, alive, in the team's group: never a second one beside the deleted one.
    expect(scene.filter((e) => e.id === "boss")).toHaveLength(1);
    // The newer version of the one it was.
    expect(live("boss")[0]).toMatchObject({ frameId: "team" });
    expect(live("boss")[0].version).toBeGreaterThan(7);
    expect(scene.filter((e) => e.type === "frame" && !e.isDeleted)).toHaveLength(1);
    expect(nodesStore.getState().isClosed("boss")).toBe(false);
    expect(relaunchTerminal).toHaveBeenCalledExactlyOnceWith("boss", expect.objectContaining({ claudeSessionId: "s-boss", role: "manager" }), "resume");
    // Its board's wire, drawn again.
    const wires = scene.filter((e) => e.type === "arrow" && !e.isDeleted) as ExcalidrawArrowElement[];
    expect(wires.some((w) => [w.startBinding?.elementId, w.endBinding?.elementId].sort().join() === "board,boss")).toBe(true);
  });

  it("makes it again after a restart, its node gone, on the conversation the mission kept, under the board in a group of its own", async () => {
    await mission({ managerSession: { nodeId: "boss", agent: "claude", name: "Manager 2", claudeSessionId: "kept" } });
    expect(await reopenManager("chef")).toBeNull();
    const payload = terminalOf(nodesStore.getState().nodes.boss);
    expect(payload).toMatchObject({ name: "Manager 2", role: "manager", fleet: "chef", claudeSessionId: "kept" });
    expect(relaunchTerminal).toHaveBeenCalledExactlyOnceWith("boss", expect.objectContaining({ claudeSessionId: "kept" }), "resume");
    const [manager] = live("boss");
    // Under the board, as the go-ahead places it.
    expect(manager.y).toBeGreaterThan(scene.find((e) => e.id === "board")!.y);
    const frame = scene.find((e) => e.id === manager.frameId)!;
    expect(groupInfoOf(frame)).toBeTruthy();
  });

  it("never takes another Manager's kept conversation: a new one", async () => {
    await mission({ managerSession: { nodeId: "old", agent: "claude", name: "Manager", claudeSessionId: "kept" } });
    expect(await reopenManager("chef")).toBeNull();
    const id = terminalOf(nodesStore.getState().nodes.boss)?.claudeSessionId;
    expect(id).toBeTruthy();
    expect(id).not.toBe("kept");
  });

  it("keeps the Manager's conversation with the mission while it runs, as its node changes it", async () => {
    await mission();
    const watching = installMissionRestore([]);
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: session("Manager", { role: "manager", fleet: "chef", claudeSessionId: "s1" }) });
    expect(missionOf(nodesStore.getState().nodes.chef)?.managerSession).toEqual({ nodeId: "boss", agent: "claude", name: "Manager", claudeSessionId: "s1" });
    // A /clear in its terminal: its next resume takes up the new conversation.
    nodesStore.getState().update("boss", { claudeSessionId: "s2" });
    expect(missionOf(nodesStore.getState().nodes.chef)?.managerSession?.claudeSessionId).toBe("s2");
    watching();
  });

  it("after a restart, the Fleet hears its Manager is gone; its relaunch gives the Manager one line: what it runs, who is at work, back, or not", async () => {
    await mission({ managerSession: { nodeId: "boss", agent: "claude", name: "Manager", claudeSessionId: "s-boss" } }, [member("robin", "Robin"), member("flash", "Flash")]);
    scene = [...scene, node("terminal", "robin", 900, 1400), node("terminal", "flash", 1400, 1400)];
    const watching = installMissionRestore([]);
    // The user resumes the Fleet: the mission's restore finds its Manager gone.
    terminalStatusStore.getState().set("chef", { state: "running" });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("is no longer on the canvas: its team stays stopped. If the mission must go on, relaunch brings Manager back")));
    expect(relaunchTerminal).not.toHaveBeenCalled();
    // Robin was started again by hand meanwhile; Flash was not.
    terminalStatusStore.getState().set("robin", { state: "running" });
    vi.mocked(notify).mockClear();
    expect(await reopenManager("chef")).toBeNull();
    restoreReopened("chef", "Chef");
    await vi.waitFor(() => expect(vi.mocked(relaunchTerminal).mock.calls.map(([id]) => id)).toEqual(["boss", "flash"]));
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    // Its start reads as no second return of the mission: one line, not two.
    await new Promise((resolve) => setTimeout(resolve, 10));
    watching();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "boss",
      'Chef re-opened you on your own conversation: your terminal had been closed or had stopped. You run the mission "Auth" for Chef: Add sign-in. Its board is board. Mission branch: dummyplane/auth. Max active agents: 4. ' +
        "At work: Robin. Back on their own conversations: Flash: each stopped mid-turn, see where it stands with read_output, then write it what is left. Read mission, team and board, then go on from where things stand.",
    );
  });
});


/** A mission as a restart reads it back from the saved scene's nodes: through its JSON, nothing kept in memory. */
async function savedMission(extra: Record<string, unknown>, members: Member[]) {
  const raw = JSON.parse(
    JSON.stringify({ state: "en_cours", maxAgents: 4, name: "Auth", task: "Add sign-in", branch: "dummyplane/auth", manager: "boss", board: "board", members, managerSession: { nodeId: "boss", agent: "claude", name: "Manager", claudeSessionId: "kept" }, ...extra }),
  );
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session: session("Chef", { role: "orchestrator" }), mission: readMission(raw) } });
}

const team = () => ({ ...createGroupFrame({ x: 900, y: 700, width: 600, height: 500 }, "Mission Auth", { role: "general", pantheon: "marvel" }), id: "team" }) as ExcalidrawElement;
const frames = () => scene.filter((e) => e.type === "frame" && !e.isDeleted);

describe("the team's group, found again after a restart when nobody stands in it", () => {
  it("is the one the mission kept: the Manager and every member closed, the group alone on the canvas, one group still", async () => {
    // Robin was closed: no element, no row left of it. The group stays, empty.
    await savedMission({ teamFrame: "team" }, [member("robin", "Robin")]);
    scene = [...scene, team()];
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(1);
    expect(live("boss")[0]).toMatchObject({ frameId: "team" });
    expect(missionOf(nodesStore.getState().nodes.chef)?.teamFrame).toBe("team");
    // Closed again, and re-opened again: still the one group.
    nodesStore.getState().close("boss");
    scene = scene.map((e) => (e.id === "boss" ? { ...e, isDeleted: true } : e));
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(1);
    expect(live("boss")).toHaveLength(1);
    expect(live("boss")[0]).toMatchObject({ frameId: "team" });
  });

  it("is the one the Fleet's relaunch re-opens its Manager in, however many times it is called: one group", async () => {
    await savedMission({ teamFrame: "team" }, [member("robin", "Robin"), member("flash", "Flash")]);
    scene = [...scene, team()];
    for (let n = 0; n < 2; n++) {
      expect((await fleetTool("chef", "relaunch", {})).isError).toBeFalsy();
      expect(frames()).toHaveLength(1);
      expect(live("boss")).toHaveLength(1);
      expect(live("boss")[0]).toMatchObject({ frameId: "team" });
      nodesStore.getState().close("boss");
      scene = scene.map((e) => (e.id === "boss" ? { ...e, isDeleted: true } : e));
    }
  });

  it("is found by its name in a mission saved before it kept the id, and kept from then on", async () => {
    await savedMission({}, [member("robin", "Robin")]);
    scene = [...scene, team()];
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(1);
    expect(live("boss")[0]).toMatchObject({ frameId: "team" });
    expect(missionOf(nodesStore.getState().nodes.chef)?.teamFrame).toBe("team");
  });

  it("never takes the group of another Fleet's mission: a new one is made, and kept", async () => {
    await nodesStore.getState().create("other", { workspaceId: "w1", kind: "fleet", payload: { name: "Other", session: session("Other", { role: "orchestrator" }), mission: { state: "en_cours", maxAgents: 4, name: "Auth", manager: "boss2", board: "board2", teamFrame: "team", members: [] } } });
    await savedMission({}, []);
    scene = [...scene, team()];
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(2);
    const own = missionOf(nodesStore.getState().nodes.chef)?.teamFrame;
    expect(own).toBeTruthy();
    expect(own).not.toBe("team");
    expect(live("boss")[0].frameId).toBe(own);
  });

  it("makes one group when the mission has none, and kept: its next re-open finds it", async () => {
    await savedMission({}, []);
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(1);
    expect(missionOf(nodesStore.getState().nodes.chef)?.teamFrame).toBe(frames()[0].id);
    nodesStore.getState().close("boss");
    scene = scene.map((e) => (e.id === "boss" ? { ...e, isDeleted: true } : e));
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(1);
  });

  it("is not looked for where the user took it away: its group deleted, a new one is made", async () => {
    await savedMission({ teamFrame: "team" }, []);
    scene = [...scene, { ...team(), isDeleted: true }];
    expect(await reopenManager("chef")).toBeNull();
    expect(frames()).toHaveLength(1);
    expect(frames()[0].id).not.toBe("team");
    expect(missionOf(nodesStore.getState().nodes.chef)?.teamFrame).toBe(frames()[0].id);
  });
});

describe("relaunch, as the Fleet calls it", () => {
  const text = (result: { content: { text: string }[] }) => result.content[0].text;
  const reopened =
    "Manager is back on the canvas, in its team's group under the board, and starts again on its own conversation; it hears where the team stands once it is up. Tell the user in one line that you re-opened Manager and why: they may have closed it on purpose. stop_mission ends the mission.";

  it("re-opens its Manager closed since dummyPlane started", async () => {
    await mission();
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: session("Manager", { role: "manager", fleet: "chef", claudeSessionId: "s-boss" }) });
    nodesStore.getState().close("boss");
    scene = [...scene, node("terminal", "boss", 900, 900, { isDeleted: true })];
    expect(text(await fleetTool("chef", "relaunch", {}))).toBe(reopened);
    expect(live("boss")).toHaveLength(1);
    expect(relaunchTerminal).toHaveBeenCalledWith("boss", expect.objectContaining({ claudeSessionId: "s-boss" }), "resume");
  });

  it("re-opens its Manager closed before a restart, its node gone, on its kept conversation", async () => {
    await mission({ managerSession: { nodeId: "boss", agent: "claude", name: "Manager", claudeSessionId: "kept" } });
    expect(text(await fleetTool("chef", "relaunch", { agent: "Manager" }))).toBe(reopened);
    expect(live("boss")).toHaveLength(1);
    expect(relaunchTerminal).toHaveBeenCalledWith("boss", expect.objectContaining({ claudeSessionId: "kept" }), "resume");
  });

  it("refuses once the mission is cleaned up, its Manager gone with it: plan again", async () => {
    await mission({ state: "plan", manager: undefined, board: undefined });
    expect(text(await fleetTool("chef", "relaunch", {}))).toBe("No mission is running: nothing for Manager to run, nothing to relaunch. Plan again with the user (propose_plan) for what is left.");
    expect(relaunchTerminal).not.toHaveBeenCalled();
  });
});
