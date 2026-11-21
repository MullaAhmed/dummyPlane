// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { wireActivityStore } from "@/canvas/wireActivity";
import { wakeFinished, wakingUp } from "@/agents/finishedStop";
import { fullCap } from "@/agents/seats";
import { atWork, markLaunching, markReported, releaseWake, unmarkReported, WAKE_HOLD_MS } from "@/agents/spawnFamily";
import { spawnedTask } from "@/agents/taskSummary";
import { withAgentLink, withWire } from "@/agents/wires";
import { activeWork } from "@/mission/activeWork";
import { notify, sendCommand } from "@/mission/events";
import { terminalText } from "@/nodes/terminal/registry";
import { MAX_STORED_TASK, readTerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { answer } from "./router";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" } }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "line 1\nline 2"), isLiveInRust: vi.fn(() => false) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn(), sendCommand: vi.fn() }));
// The start of a stopped finished agent (`@/agents/finishedStop`): its own tests cover it, here it is a promise the test resolves.
vi.mock("@/agents/finishedStop", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/agents/finishedStop")>()), wakeFinished: vi.fn(), wakingUp: vi.fn() }));

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
  // The seat a message held for a sub-agent is its own test's.
  for (const id of ["aquaman", "cyborg", "batman", "robin"]) releaseWake(id);
  agentActivityStore.setState({ activities: {} });
  wireActivityStore.setState({ pulses: {} });
});

describe("linked agents' tools", () => {
  it("are listed for agents after their own tools, and refused to a fleet", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["declare_steps", "step", "report", "spawn_agent", "installed_extras", "linked_agents", "message_agent", "read_agent", "linked_boards", "add_board_card", "move_board_card", "open_board", "show_output", "output_guide", "run_command", "answer_dialog", "hand_off", "read_node", "notes"]);
    const manager = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(manager.tools.map((t) => t.name)).not.toContain("message_agent");
    // A Fleet reaches its mission's Manager with a tool of its own (`./router.test.ts`).
    expect(manager.tools.map((t) => t.name)).toContain("message_manager");
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

describe("new work for a sub-agent that reported", () => {
  const payloadOf = (id: string) => terminalOf(nodesStore.getState().nodes[id])!;
  const FINISHED = { title: "005 W1 mint.py implementer", task: "Implement mint.py for W1.", lastReport: { status: "done" as const, summary: "mint.py is in." } };
  const NEW_WORK = "Write the 007 tests for mint.py, then report.";

  beforeEach(() => {
    scene = withWire(nodes, "batman", "aquaman", "calm", true);
    terminalStatusStore.getState().set("aquaman", { state: "running" });
    nodesStore.getState().update("aquaman", { spawnedBy: "batman", ...FINISHED });
    // As in the app, where the typed message clears the report (`onNewWork`): its work is read before it is sent.
    vi.mocked(notify).mockImplementation((id) => nodesStore.getState().update(id, { lastReport: undefined }));
    vi.mocked(sendCommand).mockClear();
  });
  afterEach(() => {
    vi.mocked(notify).mockImplementation(() => undefined);
    nodesStore.getState().update("aquaman", { spawnedBy: undefined, title: "", task: undefined, lastReport: undefined, staleTitle: undefined, agent: "claude" });
    nodesStore.getState().update("cyborg", { title: "", task: undefined, lastReport: undefined });
  });

  it("takes the title its parent gives, and the message as its task", async () => {
    expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" }))).toContain("Sent to Aquaman");
    expect(payloadOf("aquaman")).toMatchObject({ title: "007 mint.py tests", task: NEW_WORK });
    expect(payloadOf("aquaman").staleTitle).toBeUndefined();
    expect(spawnedTask(payloadOf("aquaman"))?.line).toBe("007 mint.py tests");
    // The message itself goes as any other; then its Claude session takes the title as its name.
    expect(notify).toHaveBeenCalledWith("aquaman", expect.stringMatching(/^Message from Batman .*: Write the 007 tests for mint\.py, then report\.$/));
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith("aquaman", "/rename 007 mint.py tests");
    expect(vi.mocked(notify).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendCommand).mock.invocationCallOrder[0]);
  });

  it("counts the re-tasked sub-agent at work again: it holds a seat once more", async () => {
    // Its report was marked for the app's run when it reported.
    markReported("aquaman");
    expect(atWork("aquaman")).toBe(false);
    await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" });
    expect(atWork("aquaman")).toBe(true);
  });

  it("renames only a Claude session: a Codex sub-agent takes the title on its terminal alone", async () => {
    nodesStore.getState().update("aquaman", { agent: "codex" });
    await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" });
    expect(payloadOf("aquaman").title).toBe("007 mint.py tests");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("without a title keeps it, but its line and the duplicate guard say the new task", async () => {
    await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK });
    expect(payloadOf("aquaman")).toMatchObject({ title: "005 W1 mint.py implementer", task: NEW_WORK, staleTitle: true });
    // No title, no new name: its session keeps the one it has.
    expect(sendCommand).not.toHaveBeenCalled();
    const line = spawnedTask(payloadOf("aquaman"))?.line;
    expect(line).toBe("Write the 007 tests for mint.py, then report");
    // Its report cleared by the message, it is at work again, on the new task.
    expect(payloadOf("aquaman").lastReport).toBeUndefined();
    expect(activeWork("w1", ["batman"])).toEqual([expect.objectContaining({ agentId: "aquaman", title: line, brief: NEW_WORK })]);
  });

  it("takes a title given with later work, cut as spawn_agent cuts one", async () => {
    await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK });
    nodesStore.getState().update("aquaman", { lastReport: FINISHED.lastReport });
    await call("batman", "message_agent", { agent: "Aquaman", text: "Fix the 008 bug.", title: `008 ${"x".repeat(80)}` });
    expect(payloadOf("aquaman").title).toHaveLength(60);
    expect(payloadOf("aquaman")).toMatchObject({ task: "Fix the 008 bug." });
    expect(payloadOf("aquaman").staleTitle).toBeUndefined();
  });

  it("never keeps a long task cut inside an emoji: read_node says it through Rust, which refuses half of one", async () => {
    // 🎉 straddles the cut: its first half would be the last unit kept.
    await call("batman", "message_agent", { agent: "Aquaman", text: `${"x".repeat(MAX_STORED_TASK - 1)}🎉 then report.` });
    expect(payloadOf("aquaman").task).toBe("x".repeat(MAX_STORED_TASK - 1));
  });

  it("changes nothing for a sub-agent still on its task, nor for a message not sent", async () => {
    nodesStore.getState().update("aquaman", { lastReport: undefined });
    await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" });
    expect(payloadOf("aquaman")).toMatchObject({ title: FINISHED.title, task: FINISHED.task });
    nodesStore.getState().update("aquaman", { lastReport: FINISHED.lastReport });
    terminalStatusStore.getState().set("aquaman", { state: "stopped" });
    // Refused, not started again: it has no conversation to take up (no Claude session id). With one, its parent's
    // message wakes it (below, "to a finished sub-agent whose session dummyPlane stopped").
    expect((await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" })).isError).toBe(true);
    expect(payloadOf("aquaman")).toMatchObject({ title: FINISHED.title, task: FINISHED.task });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  describe("to a finished sub-agent whose session dummyPlane stopped", () => {
    let wake: (ready: boolean) => void;
    /** The start under way, as `wakingUp` gives it back until it ends. */
    let starting: Promise<boolean> | undefined;
    beforeEach(() => {
      nodesStore.getState().update("aquaman", { claudeSessionId: "s-aquaman", stoppedFinished: true });
      terminalStatusStore.getState().set("aquaman", { state: "exited", code: 1 });
      starting = undefined;
      vi.mocked(wakeFinished).mockReset().mockImplementation(() => (starting ??= new Promise<boolean>((resolve) => (wake = resolve))));
      vi.mocked(wakingUp).mockReset().mockImplementation(() => starting);
    });
    afterEach(() => {
      vi.mocked(wakingUp).mockReset();
      nodesStore.getState().update("aquaman", { claudeSessionId: undefined, stoppedFinished: undefined });
    });

    it("starts it again on its conversation, and types the message once its session is ready", async () => {
      const result = await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain("Aquaman had finished, and dummyPlane stopped its session to free memory");
      expect(wakeFinished).toHaveBeenCalledExactlyOnceWith("aquaman", expect.any(Function));
      // Its new work is its own at once; nothing is typed while its session opens: it would land in its shell.
      expect(payloadOf("aquaman")).toMatchObject({ title: "007 mint.py tests", task: NEW_WORK });
      expect(notify).not.toHaveBeenCalled();
      expect(sendCommand).not.toHaveBeenCalled();
      terminalStatusStore.getState().set("aquaman", { state: "running" });
      wake(true);
      await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("aquaman", expect.stringContaining(NEW_WORK)));
      expect(sendCommand).toHaveBeenCalledExactlyOnceWith("aquaman", "/rename 007 mint.py tests");
    });

    it("waits for the same start with a second message, and tells the sender when it does not start", async () => {
      await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK });
      await call("batman", "message_agent", { agent: "Aquaman", text: "And the 008 bug." });
      expect(wakeFinished).toHaveBeenCalledTimes(1);
      wake(false);
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
      expect(vi.mocked(notify).mock.calls).toEqual([
        ["batman", "Aquaman did not start again, or its session did not open: your message was not sent."],
        ["batman", "Aquaman did not start again, or its session did not open: your message was not sent."],
      ]);
    });

    it("is refused while the cap is full, as a message to any finished sub-agent is: it would take a seat, and nothing starts", async () => {
      const cap = subagentSettingsStore.getState().maxSpawned;
      nodesStore.getState().update("cyborg", { spawnedBy: "batman" });
      subagentSettingsStore.setState({ maxSpawned: 1 });
      try {
        const refused = await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK });
        expect(refused.isError).toBe(true);
        expect(textOf(refused)).toContain("No seat is free: 1 of 1 sub-agent at work");
        expect(wakeFinished).not.toHaveBeenCalled();
        expect(payloadOf("aquaman").lastReport).toEqual(FINISHED.lastReport);
      } finally {
        subagentSettingsStore.setState({ maxSpawned: cap });
        nodesStore.getState().update("cyborg", { spawnedBy: undefined });
      }
    });

    it("holds the seat of the session it starts, takes a second message to it for no new seat, and lets go when the session does not open", async () => {
      const cap = subagentSettingsStore.getState().maxSpawned;
      subagentSettingsStore.setState({ maxSpawned: 1 });
      try {
        expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK }))).toContain("starts again on its own conversation");
        expect(fullCap()).toMatchObject({ held: 1, max: 1 });
        expect((await call("batman", "message_agent", { agent: "Aquaman", text: "And the 008 bug." })).isError).toBeUndefined();
        wake(false);
        await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("batman", expect.stringContaining("did not start again")));
        expect(fullCap()).toBeNull();
      } finally {
        subagentSettingsStore.setState({ maxSpawned: cap });
      }
    });

    it("refuses a linked peer's message that would start its session again with the cap full, as its parent's is", async () => {
      const cap = subagentSettingsStore.getState().maxSpawned;
      // Cyborg, a sub-agent at work, holds the one seat; it is not Aquaman's parent, so its message is no new work.
      nodesStore.getState().update("cyborg", { spawnedBy: "batman" });
      scene = withAgentLink(nodes, "cyborg", "aquaman");
      subagentSettingsStore.setState({ maxSpawned: 1 });
      try {
        const refused = await call("cyborg", "message_agent", { agent: "Aquaman", text: "Which fixture did you use?" });
        expect(refused.isError).toBe(true);
        expect(textOf(refused)).toContain("No seat is free: 1 of 1 sub-agent at work");
        expect(wakeFinished).not.toHaveBeenCalled();
      } finally {
        subagentSettingsStore.setState({ maxSpawned: cap });
        nodesStore.getState().update("cyborg", { spawnedBy: undefined });
      }
    });

    it("wakes a finished sub-agent stopped since an app restart for its parent's new work", async () => {
      nodesStore.getState().update("aquaman", { stoppedFinished: undefined });
      terminalStatusStore.getState().set("aquaman", { state: "stopped" });
      expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK }))).toContain("starts again on its own conversation");
      expect(wakeFinished).toHaveBeenCalledWith("aquaman", expect.any(Function));
    });
  });

  describe("while the cap on sub-agents running at once is full", () => {
    let cap: number;
    beforeEach(() => {
      cap = subagentSettingsStore.getState().maxSpawned;
      // Cyborg, another sub-agent of Batman's, is at work: the one seat of the cap. Aquaman's report freed its own.
      nodesStore.getState().update("cyborg", { spawnedBy: "batman" });
      scene = withWire(withWire(nodes, "batman", "aquaman", "calm", true), "batman", "cyborg", "calm", true);
      subagentSettingsStore.setState({ maxSpawned: 1 });
      markReported("aquaman");
    });
    afterEach(() => {
      subagentSettingsStore.setState({ maxSpawned: cap });
      nodesStore.getState().update("cyborg", { spawnedBy: undefined });
      unmarkReported("aquaman");
      unmarkReported("cyborg");
    });

    it("refuses new work for a sub-agent that reported, which would take a seat: it says who holds the seats and what to do, and changes nothing", async () => {
      const refused = await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK, title: "007 mint.py tests" });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toMatch(
        /^No seat is free: 1 of 1 sub-agent at work \(the most sub-agents at once, set in dummyPlane's Settings and shared by every project\): Cyborg \(code\)\. Not sent: Aquaman has reported, and new work would take a seat again\. /,
      );
      // Batman has a shell: it may be told to do the work itself.
      expect(textOf(refused)).toContain("Wait for one to report and send it again, or do this work yourself.");
      expect(textOf(refused)).toContain("A message that only answers an agent still at work goes through.");
      // Nothing typed, nothing renamed, its report still standing and no seat taken.
      expect(notify).not.toHaveBeenCalled();
      expect(sendCommand).not.toHaveBeenCalled();
      expect(payloadOf("aquaman")).toMatchObject({ title: FINISHED.title, task: FINISHED.task, lastReport: FINISHED.lastReport });
      expect(atWork("aquaman")).toBe(false);
    });

    it("tells a manager sub-agent to wait for its own and ask its parent, never to do the work itself", async () => {
      nodesStore.getState().update("batman", { coordinator: true });
      try {
        const refused = await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK });
        expect(refused.isError).toBe(true);
        expect(textOf(refused)).toContain("tell your parent with message_agent");
        expect(textOf(refused)).not.toContain("do this work yourself");
      } finally {
        nodesStore.getState().update("batman", { coordinator: undefined });
      }
    });

    it("lets a message through to an agent still at work, and an answer that starts no work: neither takes a seat", async () => {
      // Cyborg holds the seat itself: a message to it is no new seat.
      expect(textOf(await call("batman", "message_agent", { agent: "Cyborg", text: "Use the other fixture." }))).toContain("Sent to Cyborg");
      expect(notify).toHaveBeenCalledWith("cyborg", expect.stringContaining("Use the other fixture."));
      // A sub-agent answering its parent starts no work for anyone.
      expect(textOf(await call("cyborg", "message_agent", { agent: "Batman", text: "The fixture is in." }))).toContain("Sent to Batman");
    });

    // The report is kept with the node (`lastReport`), the set `markReported` fills only for the app's run: a line from a
    // linked peer, not the parent, wakes the reported agent into work all the same (`onNewWork`), whether the app ran
    // since its report or was restarted since.
    for (const [when, restart] of [
      ["while the app runs", () => undefined],
      [
        "after an app restart",
        () => {
          // What the next start has of it: the node as saved and read back, and no set of the sub-agents that reported.
          expect(readTerminalPayload(JSON.parse(JSON.stringify(payloadOf("aquaman"))))).toMatchObject({ spawnedBy: "batman", lastReport: FINISHED.lastReport });
          unmarkReported("aquaman");
        },
      ],
    ] as const) {
      describe(`a line from a linked peer to a sub-agent that reported, ${when}`, () => {
        beforeEach(() => {
          restart();
          scene = withAgentLink(scene, "cyborg", "aquaman");
        });

        it("is refused while the cap is full, as its parent's new work is: it would take a seat, and nothing is typed", async () => {
          const refused = await call("cyborg", "message_agent", { agent: "Aquaman", text: "FYI the fixture changed." });
          expect(refused.isError).toBe(true);
          expect(textOf(refused)).toContain("No seat is free: 1 of 1 sub-agent at work");
          expect(textOf(refused)).toContain("Not sent: Aquaman has reported, and new work would take a seat again.");
          expect(notify).not.toHaveBeenCalled();
          // Its report stands, and it holds no seat: the cap still has the one seat Cyborg holds.
          expect(payloadOf("aquaman").lastReport).toEqual(FINISHED.lastReport);
          expect(atWork("aquaman")).toBe(false);
          expect(fullCap()).toMatchObject({ held: 1, max: 1 });
        });

        it("takes the seat it wakes the agent into when one is free, and keeps it once typed", async () => {
          subagentSettingsStore.setState({ maxSpawned: 2 });
          expect(textOf(await call("cyborg", "message_agent", { agent: "Aquaman", text: "FYI the fixture changed." }))).toContain("Sent to Aquaman");
          // Typed (the report cleared): working, and counted, never seatless.
          expect(payloadOf("aquaman").lastReport).toBeUndefined();
          expect(atWork("aquaman")).toBe(true);
          expect(fullCap()).toMatchObject({ held: 2, max: 2 });
          // A second line to it, now at work, is no new seat; another reported sub-agent's would be refused.
          expect(textOf(await call("cyborg", "message_agent", { agent: "Aquaman", text: "And the other one." }))).toContain("Sent to Aquaman");
        });
      });
    }

    it("leaves a mission's team agent alone: its Manager's Max active agents counts it, not this cap", async () => {
      await terminal("robin", "Robin");
      await nodesStore.getState().create("mgr", { workspaceId: "w1", kind: "terminal", payload: { title: "", name: "Manager", agent: "claude", cwd: "C:/code", shell: "default", command: "", role: "manager", fleet: "chef" } });
      scene = withAgentLink([...scene, element("terminal", "robin", 6000)], "cyborg", "robin");
      nodesStore.getState().update("robin", { spawnedBy: "mgr", ...FINISHED });
      terminalStatusStore.getState().set("robin", { state: "running" });
      try {
        expect(textOf(await call("cyborg", "message_agent", { agent: "Robin", text: "FYI the fixture changed." }))).toContain("Sent to Robin");
        expect(fullCap()).toMatchObject({ held: 1, max: 1 });
      } finally {
        terminalStatusStore.getState().set("robin", { state: "stopped" });
        nodesStore.getState().update("robin", { spawnedBy: undefined, lastReport: undefined });
      }
    });

    it("holds the seat of each sub-agent it re-tasks from its message: two messages in a row cannot both pass a cap with one seat left", async () => {
      subagentSettingsStore.setState({ maxSpawned: 2 });
      await terminal("robin", "Robin");
      scene = withWire([...scene, element("terminal", "robin", 6000)], "batman", "robin", "calm", true);
      nodesStore.getState().update("robin", { spawnedBy: "batman", ...FINISHED });
      terminalStatusStore.getState().set("robin", { state: "running" });
      markReported("robin");
      // Typing waits (a dialog is open): their reports stand, as they do until the message is typed.
      vi.mocked(notify).mockImplementation(() => undefined);
      try {
        expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK }))).toContain("Sent to Aquaman");
        const refused = await call("batman", "message_agent", { agent: "Robin", text: NEW_WORK });
        expect(refused.isError).toBe(true);
        expect(textOf(refused)).toContain("No seat is free: 2 of 2 sub-agents at work");
        expect(textOf(refused)).toContain("Aquaman");
        expect(atWork("robin")).toBe(false);
        // A second message to the one that holds the seat is no new seat.
        expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: "And the 008 bug." }))).toContain("Sent to Aquaman");
        // Typed at last (its report cleared): the seat is its own state's now, and stays held.
        nodesStore.getState().update("aquaman", { lastReport: undefined });
        expect(atWork("aquaman")).toBe(true);
        expect((await call("batman", "message_agent", { agent: "Robin", text: NEW_WORK })).isError).toBe(true);
      } finally {
        terminalStatusStore.getState().set("robin", { state: "stopped" });
        nodesStore.getState().update("robin", { spawnedBy: undefined, lastReport: undefined });
        unmarkReported("robin");
      }
    });

    it("lets go of the seat a message held when it is never typed", async () => {
      vi.mocked(notify).mockImplementation(() => undefined);
      subagentSettingsStore.setState({ maxSpawned: 2 });
      expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK }))).toContain("Sent to Aquaman");
      expect(fullCap()).toMatchObject({ held: 2 });
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now + WAKE_HOLD_MS + 1);
      try {
        expect(fullCap()).toBeNull();
        expect(atWork("aquaman")).toBe(false);
      } finally {
        clock.mockRestore();
      }
    });

    it("goes through again once a report frees a seat, and takes it", async () => {
      expect((await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK })).isError).toBe(true);
      markReported("cyborg");
      expect(textOf(await call("batman", "message_agent", { agent: "Aquaman", text: NEW_WORK }))).toContain("Sent to Aquaman");
      expect(atWork("aquaman")).toBe(true);
    });
  });

  it("changes nothing between linked peers, nor from a sub-agent to its parent", async () => {
    scene = withAgentLink(nodes, "batman", "cyborg");
    nodesStore.getState().update("cyborg", FINISHED);
    await call("batman", "message_agent", { agent: "Cyborg", text: NEW_WORK, title: "007 mint.py tests" });
    expect(payloadOf("cyborg")).toMatchObject({ title: FINISHED.title, task: FINISHED.task });
    expect(payloadOf("cyborg").staleTitle).toBeUndefined();
    expect(notify).toHaveBeenCalledWith("cyborg", expect.stringContaining(NEW_WORK));
    expect(sendCommand).not.toHaveBeenCalled();
    // The other way along a spawn wire: a parent is no sub-agent of its child.
    scene = withWire(nodes, "batman", "aquaman", "calm", true);
    nodesStore.getState().update("batman", { lastReport: FINISHED.lastReport });
    try {
      await call("aquaman", "message_agent", { agent: "Batman", text: NEW_WORK, title: "007 mint.py tests" });
      expect(payloadOf("batman")).toMatchObject({ title: "" });
      expect(payloadOf("batman").task).toBeUndefined();
    } finally {
      nodesStore.getState().update("batman", { lastReport: undefined });
    }
  });
});
