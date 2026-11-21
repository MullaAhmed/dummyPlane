// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { sceneAccess } from "@/agents/sceneAccess";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { notify } from "./events";
import type { Member, Mission } from "./mission";
import { installMissionRestore, isRestoring } from "./restore";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn() }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("@/agents/sceneAccess", () => ({ sceneAccess: vi.fn() }));
// The mission's wires, as the scene gets them: one element per wire drawn.
vi.mock("@/agents/wires", () => ({ withWireBetween: vi.fn((elements: { id: string }[], from: string, to: string) => [...elements, { id: `${from}>${to}` }]) }));

const session = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: "C:/w", shell: "default", command: "", claudeSessionId: `s-${name}`, ...extra });
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({ nodeId, name, task: `t-${name}`, budgetMin: 30, linked: false, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 1, ...extra });
const write = vi.fn();
let onScene: string[] = [];

async function mission(members: Member[], extra: Partial<Mission> = {}) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", session: session("Chef", { role: "orchestrator" }), mission: { state: "en_cours", maxAgents: 4, name: "Auth", manager: "m1", board: "b1", members, ...extra } },
  });
  await nodesStore.getState().create("m1", { workspaceId: "w1", kind: "terminal", payload: session("Manager", { role: "manager", fleet: "chef" }) });
  for (const m of members) await nodesStore.getState().create(m.nodeId, { workspaceId: "w1", kind: "terminal", payload: session(m.name, { spawnedBy: "m1" }) });
}

/** The user resumes `id` (its node, "Resume all"): it runs again. */
const resumeByHand = (id: string) => terminalStatusStore.getState().set(id, { state: "running" });

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  onScene = ["chef", "m1", "b1", "batman", "n1", "n2", "n3", "n4"];
  vi.mocked(sceneAccess).mockImplementation(() => ({ elements: () => onScene.map((id) => ({ id, isDeleted: false })), write }) as never);
  vi.mocked(relaunchTerminal).mockImplementation(async (id) => terminalStatusStore.getState().set(id, { state: "running" }));
  for (const id of ["chef", "m1", "batman", "n1", "n2", "n3", "n4"]) terminalStatusStore.getState().remove(id);
});

describe("a mission dummyPlane's restart stopped", () => {
  const team = () => [
    member("batman", "Batman"),
    member("n1", "Aquaman", { report: { summary: "ok", status: "termine", at: 1 } }),
    member("n2", "Shazam"),
    member("n3", "Cyborg", { handedTo: "Batman" }),
  ];

  it("starts again with its Fleet: the Manager, then each agent on its sub-task, on its own conversation; the Manager hears who is back and who is not", async () => {
    await mission(team());
    // Shazam's terminal was closed before dummyPlane quit.
    onScene = onScene.filter((id) => id !== "n2");
    const watching = installMissionRestore([]);
    const restoringNow: boolean[] = [];
    vi.mocked(relaunchTerminal).mockImplementation(async (id) => {
      restoringNow.push(isRestoring(id));
      terminalStatusStore.getState().set(id, { state: "running" });
    });
    resumeByHand("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    watching();
    // The Manager first, then the one agent still at work; neither the one that reported nor the one that handed over.
    expect(vi.mocked(relaunchTerminal).mock.calls.map(([id, , mode]) => [id, mode])).toEqual([
      ["m1", "resume"],
      ["batman", "resume"],
    ]);
    // Their own "restarted" lines are folded into the summary.
    expect(restoringNow).toEqual([true, true]);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "m1",
      "dummyPlane restarted, which stopped the mission's agents. Back on their own conversations: Batman. Each stopped mid-turn: see where it stands with read_output, then write it what is left. " +
        'Not started again: Shazam (its terminal was closed: reassign its sub-task to "new", a new agent in its worktree, on its branch).',
    );
    // Its board wired again to its Fleet and its Manager.
    expect(write).toHaveBeenCalledWith(expect.arrayContaining([{ id: "chef>b1" }, { id: "b1>m1" }]));
  });

  it("starts again with its Manager just the same, once", async () => {
    await mission([member("batman", "Batman")]);
    const watching = installMissionRestore([]);
    resumeByHand("m1");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    resumeByHand("chef");
    await new Promise((resolve) => setTimeout(resolve, 10));
    watching();
    expect(vi.mocked(relaunchTerminal).mock.calls.map(([id]) => id)).toEqual(["batman"]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("leaves an agent stopped while Max active agents are at work, and says so", async () => {
    await mission([member("batman", "Batman"), member("n4", "Flash", { sentAt: undefined, brief: "b" })], { maxAgents: 1 });
    const watching = installMissionRestore([]);
    resumeByHand("m1");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    watching();
    // Flash's sub-task was never typed: it holds its seat, and gets it once its terminal runs (`./redeliver`).
    expect(vi.mocked(relaunchTerminal).mock.calls.map(([id]) => id)).toEqual(["n4"]);
    expect(vi.mocked(notify).mock.calls[0][1]).toContain("Not started again: Batman (Max active agents, 1, are at work: relaunch it once a seat frees up).");
  });

  it("does nothing after a webview reload: the mission never stopped", async () => {
    await mission([member("batman", "Batman")]);
    const watching = installMissionRestore(["chef", "m1", "batman"]);
    resumeByHand("chef");
    await new Promise((resolve) => setTimeout(resolve, 10));
    watching();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("decides once its Fleet runs, its nodes read after dummyPlane started (a project's are read once it is shown)", async () => {
    const watching = installMissionRestore([]);
    await mission([member("batman", "Batman")]);
    resumeByHand("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    watching();
    expect(vi.mocked(relaunchTerminal).mock.calls.map(([id]) => id)).toEqual(["m1", "batman"]);
  });

  it("leaves alone a mission whose Fleet ran already since dummyPlane started: no restart stopped it", async () => {
    await mission([member("batman", "Batman")]);
    const watching = installMissionRestore([]);
    resumeByHand("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    vi.clearAllMocks();
    // Later the same day, its terminal stops and the user starts it again: the members are the Manager's to relaunch.
    terminalStatusStore.getState().set("chef", { state: "exited", code: 1 });
    terminalStatusStore.getState().set("batman", { state: "exited", code: 1 });
    resumeByHand("chef");
    await new Promise((resolve) => setTimeout(resolve, 10));
    watching();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("leaves the team stopped when its Manager was closed, and tells the Fleet", async () => {
    await mission([member("batman", "Batman")]);
    onScene = onScene.filter((id) => id !== "m1");
    const watching = installMissionRestore([]);
    resumeByHand("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    watching();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith("chef", expect.stringContaining("the terminal of its Manager (Manager) is no longer on the canvas: its team stays stopped"));
  });
});
