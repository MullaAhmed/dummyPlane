// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import type { Activity } from "@/ipc/activity";
import type { AgentId } from "@/ipc/pty";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import {
  canPause,
  canResume,
  pauseAgents,
  pausedStore,
  pausedText,
  RESUME_WINDOW_MS,
  resumeAgent,
  resumeAgents,
  sendCommand,
  resumedText,
  sendToAgents,
  skippedText,
  startingText,
  unsuitedText,
  waitingText,
} from "./broadcast";

let calls: { cmd: string; nodeId: string; text?: string; images?: string[] }[];
let dead: Set<string>;

beforeEach(() => {
  calls = [];
  dead = new Set();
  mockIPC((cmd, args) => {
    if (cmd !== "pty_send_text" && cmd !== "pty_interrupt") return;
    const { nodeId, text, images } = args as { nodeId: string; text?: string; images?: string[] };
    if (dead.has(nodeId)) throw { kind: "notFound", message: "aucun terminal actif" };
    calls.push({ cmd, nodeId, text, ...(images ? { images } : {}) });
    return cmd === "pty_interrupt" ? true : undefined;
  });
});
afterEach(() => clearMocks());

async function agent(id: string, agentId: AgentId, state: "running" | "stopped" | "starting", activity?: Activity) {
  await nodesStore.getState().create(id, {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: id, name: id[0].toUpperCase() + id.slice(1), agent: agentId, cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set(id, { state });
  if (activity) agentActivityStore.getState().apply({ nodeId: id, activity, since: 0 });
}

describe("sendToAgents", () => {
  it("types the command into the running agents and names the stopped ones", async () => {
    await agent("batman", "claude", "running", "idle");
    await agent("cyborg", "claude", "stopped");
    await agent("flash", "codex", "stopped");
    expect(await sendToAgents(["batman", "cyborg", "flash"], "lance les tests")).toEqual({ sent: 1, skipped: ["Cyborg", "Flash"], waiting: [], unsuited: [], starting: [] });
    expect(calls).toEqual([{ cmd: "pty_send_text", nodeId: "batman", text: "lance les tests" }]);
  });

  it("pastes a message's images alone before its text to Claude Code and Codex, and writes them in it for the others (attachments)", async () => {
    await agent("batman", "claude", "running", "idle");
    await agent("flash", "codex", "running", "idle");
    await agent("storm", "gemini", "running", "idle");
    await agent("robin", "shell", "running");
    const images = [String.raw`C:\cache\paste-1.png`, String.raw`"C:\Users\Jane Doe\paste-2.png"`];
    expect(await sendToAgents(["batman", "flash", "storm", "robin"], "what is wrong here?", undefined, images)).toEqual({ sent: 4, skipped: [], waiting: [], unsuited: [], starting: [] });
    expect(calls).toEqual([
      { cmd: "pty_send_text", nodeId: "batman", text: "what is wrong here?", images },
      { cmd: "pty_send_text", nodeId: "flash", text: "what is wrong here?", images },
      { cmd: "pty_send_text", nodeId: "storm", text: String.raw`C:\cache\paste-1.png "C:\Users\Jane Doe\paste-2.png" what is wrong here?` },
      { cmd: "pty_send_text", nodeId: "robin", text: String.raw`C:\cache\paste-1.png "C:\Users\Jane Doe\paste-2.png" what is wrong here?` },
    ]);
  });

  it("sends a text without images as before: no images in the call (attachments)", async () => {
    await agent("batman", "claude", "running", "idle");
    await sendToAgents(["batman"], "lance les tests", undefined, []);
    expect(calls).toEqual([{ cmd: "pty_send_text", nodeId: "batman", text: "lance les tests" }]);
  });

  it("names an agent still in its staggered start apart from the stopped ones (plan B3)", async () => {
    await agent("batman", "claude", "running", "idle");
    await agent("cyborg", "claude", "starting");
    expect(await sendToAgents(["batman", "cyborg"], "go")).toEqual({ sent: 1, skipped: [], waiting: [], unsuited: [], starting: ["Cyborg"] });
    expect(startingText(["Cyborg"])).toBe("1 agent still starting ignored: Cyborg — try again in a moment");
    expect(startingText([])).toBeNull();
  });

  it("counts an agent whose process just died as ignored", async () => {
    await agent("superman", "claude", "running", "idle");
    dead.add("superman");
    expect(await sendToAgents(["superman"], "x")).toEqual({ sent: 0, skipped: ["Superman"], waiting: [], unsuited: [], starting: [] });
  });

  it("leaves an agent waiting for an answer alone: Enter would approve its dialog", async () => {
    await agent("aquaman", "claude", "running", "waiting");
    await agent("shazam2", "codex", "running", "working");
    expect(await sendToAgents(["aquaman", "shazam2"], "lance les tests")).toEqual({ sent: 1, skipped: [], waiting: ["Aquaman"], unsuited: [], starting: [] });
    expect(calls.map((c) => c.nodeId)).toEqual(["shazam2"]);
  });

  it("types a /command to the agents only: a shell would run it as a program", async () => {
    await agent("batman", "claude", "running", "idle");
    await agent("cyborg", "shell", "running");
    await agent("flash", "codex", "running", "idle");
    expect(await sendToAgents(["batman", "cyborg", "flash"], "/effort ultracode")).toEqual({ sent: 2, skipped: [], waiting: [], unsuited: ["Cyborg"], starting: [] });
    expect(calls.map((c) => c.nodeId)).toEqual(["batman", "flash"]);
    calls = [];
    expect((await sendToAgents(["cyborg"], "npm test")).sent).toBe(1);
  });
});

describe("skippedText / pausedText / resumedText", () => {
  it("says who was ignored and how many were paused or resumed", () => {
    expect(skippedText([])).toBeNull();
    expect(skippedText(["Cyborg"])).toBe("1 stopped agent ignored: Cyborg");
    expect(skippedText(["Cyborg", "Flash"])).toBe("2 stopped agents ignored: Cyborg, Flash");
    expect(unsuitedText([])).toBeNull();
    expect(unsuitedText(["Cyborg"])).toBe("1 terminal without an agent ignored: Cyborg — a / command only goes to agents");
    expect(unsuitedText(["Cyborg", "Robin"])).toBe("2 terminals without an agent ignored: Cyborg, Robin — a / command only goes to agents");
    expect(waitingText([])).toBeNull();
    expect(waitingText(["Aquaman"])).toBe("1 waiting agent ignored: Aquaman — answer it in its terminal");
    expect(waitingText(["Aquaman", "Batman"])).toBe("2 waiting agents ignored: Aquaman, Batman — answer them in their terminals");
    expect(pausedText(0)).toBe("No running agent to pause");
    expect(pausedText(1)).toBe("1 agent paused");
    expect(pausedText(5)).toBe("5 agents paused");
    expect(resumedText(0)).toBe("No paused agent to resume");
    expect(resumedText(3)).toBe("3 agents resumed");
  });
});

describe("canPause / canResume", () => {
  it("pauses a running agent at work, never a shell", () => {
    expect(canPause({ agent: "claude", running: true, activity: "working" })).toBe(true);
    expect(canPause({ agent: "claude", running: true, activity: "idle" })).toBe(false);
    expect(canPause({ agent: "claude", running: false, activity: "working" })).toBe(false);
    expect(canPause({ agent: "shell", running: true, activity: "working" })).toBe(false);
  });

  it("resumes a running agent that is idle, never a shell", () => {
    expect(canResume({ agent: "codex", running: true, activity: "idle" })).toBe(true);
    expect(canResume({ agent: "codex", running: true, activity: undefined })).toBe(true);
    expect(canResume({ agent: "codex", running: true, activity: "working" })).toBe(false);
    expect(canResume({ agent: "codex", running: true, activity: "waiting" })).toBe(false);
    expect(canResume({ agent: "shell", running: true, activity: "idle" })).toBe(false);
  });
});

describe("pauseAgents / resumeAgents", () => {
  it("forgets a pause once the agent works or waits again, or its process stops", async () => {
    await agent("wanda", "claude", "running", "idle");
    await agent("hawkgirl", "claude", "running", "idle");
    await agent("hawkeye", "claude", "running", "idle");
    await agent("groot", "claude", "running", "idle");
    pausedStore.getState().mark(["wanda", "hawkgirl", "hawkeye", "groot"], 1000);
    // Restarted by hand, or sent a command from the bar.
    agentActivityStore.getState().apply({ nodeId: "wanda", activity: "working", since: 2000 });
    agentActivityStore.getState().apply({ nodeId: "hawkeye", activity: "waiting", since: 2000 });
    terminalStatusStore.getState().set("hawkgirl", { state: "exited", code: 0 });
    const { pausedAt } = pausedStore.getState();
    expect([pausedAt.wanda, pausedAt.hawkgirl, pausedAt.hawkeye]).toEqual([undefined, undefined, undefined]);
    expect(pausedAt.groot).toBe(1000);
  });

  it("pauses the agents at work and remembers when", async () => {
    await agent("ironman", "claude", "running", "working");
    await agent("deadpool", "claude", "running", "idle");
    await agent("daredevil", "shell", "running", "working");
    expect(await pauseAgents(["ironman", "deadpool", "daredevil"], 1000)).toBe(1);
    expect(calls).toEqual([{ cmd: "pty_interrupt", nodeId: "ironman", text: undefined }]);
    expect(pausedStore.getState().pausedAt.ironman).toBe(1000);
  });

  it("resumes only the agents it paused less than a day ago, once idle", async () => {
    const now = 10 * RESUME_WINDOW_MS;
    await agent("robin", "claude", "running", "idle");
    await agent("zatanna", "claude", "running", "idle");
    await agent("shazam", "claude", "running", "idle");
    await agent("batgirl", "claude", "running", "working");
    pausedStore.getState().mark(["robin", "batgirl"], now - 3_600_000);
    pausedStore.getState().mark(["shazam"], now - RESUME_WINDOW_MS - 1);
    expect(await resumeAgents(["robin", "zatanna", "shazam", "batgirl"], now)).toBe(1);
    // On its own line: Claude Code puts a prompt interrupted before any answer back in its input.
    expect(calls).toEqual([{ cmd: "pty_send_text", nodeId: "robin", text: "\ncontinue" }]);
    expect(pausedStore.getState().pausedAt.robin).toBeUndefined();
    expect(pausedStore.getState().pausedAt.batgirl).toBeDefined();
  });
});

describe("resumeAgent when the process just died (plan B3)", () => {
  it("says so instead of leaving the rejection unhandled, and stays paused", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    await agent("flash2", "claude", "running", "idle");
    pausedStore.getState().mark(["flash2"], 1);
    dead.add("flash2");
    await expect(resumeAgent("flash2")).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith("Flash2 could not resume: its process just stopped");
    expect(pausedStore.getState().pausedAt.flash2).toBe(1);
    warning.mockRestore();
  });
});

describe("sendCommand and agents still starting (plan B3)", () => {
  it("warns about them apart from the stopped ones", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    await agent("batman", "claude", "running", "idle");
    await agent("cyborg", "claude", "starting");
    await agent("flash", "claude", "stopped");
    await sendCommand(["batman", "cyborg", "flash"], "go");
    expect(warning.mock.calls.map(([text]) => text)).toEqual([
      "1 stopped agent ignored: Flash",
      "1 agent still starting ignored: Cyborg — try again in a moment",
    ]);
    warning.mockRestore();
  });

  it("lights the wires of the agents the command was typed into, and only those", async () => {
    clearWirePulses();
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    await agent("batman", "claude", "running", "idle");
    await agent("flash", "claude", "stopped");
    await sendCommand(["batman", "flash"], "go");
    expect(wireActivityStore.getState().pulses).toEqual({ batman: { direction: "toAgent", at: expect.any(Number) } });
    warning.mockRestore();
    clearWirePulses();
  });
});
