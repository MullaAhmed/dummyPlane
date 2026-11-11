// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ptySendText } from "@/ipc/pty";
import { typedAgo } from "@/nodes/terminal/registry";
import { remoteBusy } from "@/agents/remoteControl";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { installMissionEvents, notify, pendingEvents } from "./events";
import { whenReady } from "./ready";
import type { Member } from "./mission";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity) }));
vi.mock("@/agents/remoteControl", () => ({ remoteBusy: vi.fn(() => false) }));
vi.mock("./ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));

/** Lets the started fleet's readiness settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const member = (nodeId: string, name: string, sentAt?: number): Member => ({ nodeId, name, task: "t", budgetMin: 5, linked: false, branch: `dummyplane/m-${nodeId}`, worktree: "C:/w", sentAt });
const activity = (nodeId: string, value: "idle" | "working" | "waiting") => agentActivityStore.getState().apply({ nodeId, activity: value, since: 0 });
const status = (nodeId: string, state: "running" | "stopped" | "exited") =>
  terminalStatusStore.getState().set(nodeId, state === "exited" ? { state, code: 0 } : { state });
const sent = () => vi.mocked(ptySendText).mock.calls.map(([id, text]) => `${id}: ${text}`);

let uninstall: () => void;
beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, members: [member("batman", "Batman", 1), member("aquaman", "Aquaman")] } },
  });
  uninstall = installMissionEvents();
});
afterAll(() => uninstall());
beforeEach(async () => {
  status("chef", "running");
  await tick();
  activity("chef", "idle");
  status("batman", "running");
  activity("batman", "working");
  vi.mocked(ptySendText).mockClear();
});

describe("events to the fleet (spec orchestrateur §7.5)", () => {
  it("holds a line while a Remote Control flow is typing in the fleet (backlog 27 oct)", async () => {
    vi.useFakeTimers();
    vi.mocked(remoteBusy).mockReturnValueOnce(true).mockReturnValue(false);
    notify("chef", "Batman a rendu compte");
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte"]);
    vi.useRealTimers();
  });

  it("waits for the user to stop typing before it types a line (backlog H2)", async () => {
    vi.useFakeTimers();
    vi.mocked(typedAgo).mockReturnValueOnce(1000).mockReturnValue(Infinity);
    notify("chef", "Batman a rendu compte");
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte"]);
    vi.useRealTimers();
  });

  it("types a line in a free fleet at once", () => {
    notify("chef", "Batman a rendu compte (termine) : fait");
    expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte (termine) : fait"]);
  });

  it("holds the lines while it waits for the user or is stopped, then sends them in order", async () => {
    activity("chef", "waiting");
    notify("chef", "un");
    notify("chef", "deux");
    expect(sent()).toEqual([]);
    expect(pendingEvents("chef")).toEqual(["un", "deux"]);
    activity("chef", "working");
    status("chef", "stopped");
    notify("chef", "trois");
    status("chef", "running");
    await tick();
    expect(sent()).toEqual(["chef: [dummyPlane] un", "chef: [dummyPlane] deux", "chef: [dummyPlane] trois"]);
    expect(pendingEvents("chef")).toEqual([]);
  });

  it("tells it when a member waits for the user or stops, once its sub-task is sent", () => {
    activity("batman", "waiting");
    status("batman", "exited");
    status("aquaman", "running");
    activity("aquaman", "waiting");
    expect(sent()).toEqual([
      "chef: [dummyPlane] Batman is waiting for the user (a dialog is open in its terminal).",
      "chef: [dummyPlane] Batman stopped: its terminal is no longer running.",
    ]);
  });

  it("tells it in English when the interface is (spec première version §7.1)", () => {
    try {
      activity("batman", "waiting");
      status("batman", "exited");
      expect(sent()).toEqual([
        "chef: [dummyPlane] Batman is waiting for the user (a dialog is open in its terminal).",
        "chef: [dummyPlane] Batman stopped: its terminal is no longer running.",
      ]);
    } finally {
    }
  });

  it("counts a member's terminal removed from the canvas as stopped", () => {
    terminalStatusStore.getState().remove("batman");
    expect(sent()).toEqual(["chef: [dummyPlane] Batman stopped: its terminal is no longer running."]);
  });

  it("waits for a restarted fleet's Claude to be up, never typing into its trust dialog (final review H2)", async () => {
    let up!: (ready: boolean) => void;
    vi.mocked(whenReady).mockImplementationOnce(() => new Promise((resolve) => (up = resolve)));
    status("chef", "stopped");
    status("chef", "running");
    notify("chef", "Batman a rendu compte");
    await tick();
    expect(sent()).toEqual([]);
    const calls = vi.mocked(whenReady).mock.calls;
    expect(calls[calls.length - 1][2]).toBe(false);
    up(true);
    await vi.waitFor(() => expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte"]));
  });

  it("puts back a line that could not be typed, for the fleet's next start (final review H2)", async () => {
    vi.mocked(ptySendText).mockRejectedValueOnce(new Error("NotFound"));
    notify("chef", "perdu ?");
    await tick();
    expect(pendingEvents("chef")).toEqual(["perdu ?"]);
    status("chef", "stopped");
    status("chef", "running");
    await vi.waitFor(() => expect(sent()).toEqual(["chef: [dummyPlane] perdu ?", "chef: [dummyPlane] perdu ?"]));
    expect(pendingEvents("chef")).toEqual([]);
  });
});

describe("a mission its Manager runs (spec babysitter Fleet)", () => {
  beforeAll(async () => {
    await nodesStore.getState().create("sitter", {
      workspaceId: "w1",
      kind: "fleet",
      payload: { name: "Sitter", mission: { state: "en_cours", maxAgents: 4, manager: "boss", members: [member("robin", "Robin", 1)] } },
    });
    await nodesStore.getState().create("boss", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/w", shell: "default", command: "", role: "manager", fleet: "sitter" },
    });
  });

  beforeEach(async () => {
    status("sitter", "running");
    status("boss", "running");
    status("robin", "running");
    await tick();
    activity("sitter", "idle");
    activity("boss", "idle");
    activity("robin", "working");
    vi.mocked(ptySendText).mockClear();
  });

  it("types a team agent's question and its stop into the Manager, never into the Fleet", async () => {
    activity("robin", "waiting");
    status("robin", "stopped");
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()).toEqual([
      "boss: [dummyPlane] Robin is waiting for the user (a dialog is open in its terminal).",
      "boss: [dummyPlane] Robin stopped: its terminal is no longer running.",
    ]);
  });

  it("tells the Fleet, in one line each, when its Manager waits for the user or stops", async () => {
    activity("boss", "waiting");
    await vi.waitFor(() => expect(sent()).toEqual(["sitter: [dummyPlane] Manager is waiting for the user (a dialog is open in its terminal)."]));
    activity("boss", "idle");
    status("boss", "stopped");
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]).toBe("sitter: [dummyPlane] Manager stopped: its terminal is no longer running. The board waits: relaunch it from its node, or stop_mission.");
  });

  it("holds the Manager's lines until its prompt is up after a start", async () => {
    status("boss", "stopped");
    vi.mocked(ptySendText).mockClear();
    let ready!: (value: boolean) => void;
    vi.mocked(whenReady).mockReturnValueOnce(new Promise((resolve) => (ready = resolve)));
    status("boss", "running");
    notify("boss", "You run the mission");
    await tick();
    expect(sent()).toEqual([]);
    ready(true);
    await vi.waitFor(() => expect(sent()).toEqual(["boss: [dummyPlane] You run the mission"]));
  });
});
