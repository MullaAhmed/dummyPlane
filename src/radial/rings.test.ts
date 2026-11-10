// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import type { CommandContext } from "@/commands/command";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/fleet/agentsStore";
import { AGENTS } from "@/fleet/catalog";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { lineOf, RINGS } from "./rings";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "isis", at: { x: 0, y: 0 }, groupId: "g1", orchestratorId: "chef" };
const labels = (kind: keyof typeof RINGS) => RINGS[kind].map((slot) => lineOf(slot, ctx)!.label);

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef" } });
  canvasStore.setState({ frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["isis"] }] });
  agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never);
});

describe("the rings (spec menu radial §4)", () => {
  it("gives each ring at most 8 buttons, no empty place, each a function of the registry, never twice", () => {
    for (const [kind, slots] of Object.entries(RINGS)) {
      expect(slots.length, kind).toBeLessThanOrEqual(8);
      expect(slots.every(Boolean), kind).toBe(true);
      const ids = slots.map((slot) => (typeof slot.command === "function" ? slot.command(ctx) : slot.command));
      expect(new Set(ids).size, kind).toBe(ids.length);
      for (const id of ids) expect(COMMANDS.some((c) => c.id === id), id).toBe(true);
    }
  });

  it("names each ring's positions as the spec does, clockwise from the top", () => {
    expect(labels("canvas")).toEqual(["Launch Claude", "Launch Shell", "Fleet", "Paste", "Text", "Other agent…", "Overview"]);
    expect(labels("terminal")).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Duplicate", "Pause", "Stop the process"]);
    expect(labels("group")).toEqual(["Add an agent…", "Rename the group", "Link a fleet", "Pause group", "Close the group", "Ungroup", "Resume group", "Zoom to group"]);
    expect(labels("orchestrator")).toEqual(["Write an instruction", "Rename", "Delete", "Link", "Paste"]);
    expect(labels("selection")).toEqual(["Copy", "Paste", "Duplicate", "Bring to front", "Delete", "Send to back", "Lock", "More…"]);
  });

  it("puts the default agent at the top of the canvas ring, with its icon", () => {
    agentsStore.setState({ agents: [{ id: "codex", available: true }] } as never);
    const top = lineOf(RINGS.canvas[0]!, ctx)!;
    expect([top.label, top.Icon]).toEqual(["Launch Codex", AGENTS.codex.Icon]);
    agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never);
  });

  it("greys what cannot run, with its reason, and marks what ends something", () => {
    const copy = lineOf(RINGS.terminal[0]!, ctx)!;
    expect([copy.enabled, copy.reason]).toEqual([false, "nothing selected"]);
    const stop = lineOf(RINGS.terminal[7]!, ctx)!;
    expect([stop.enabled, stop.reason]).toEqual([false, null]);
    expect(lineOf(RINGS.terminal[4]!, ctx)!.danger).toBe(true);
  });
});

describe("the wedges' short names", () => {
  const shorts = (kind: keyof typeof RINGS) => RINGS[kind].map((slot) => lineOf(slot, ctx)!.short);

  it("names each wedge in a word or two, clockwise from the top", () => {
    expect(shorts("canvas")).toEqual(["Claude", "Shell", "Fleet", "Paste", "Text", "Other agent", "Overview"]);
    expect(shorts("terminal")).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Duplicate", "Pause", "Stop"]);
    expect(shorts("group")).toEqual(["Add agent", "Rename", "Link fleet", "Pause", "Close", "Ungroup", "Resume", "Zoom"]);
    expect(shorts("orchestrator")).toEqual(["Write", "Rename", "Delete", "Link", "Paste"]);
    expect(shorts("selection")).toEqual(["Copy", "Paste", "Duplicate", "To front", "Delete", "To back", "Lock", "More"]);
  });

  it("keeps every name short enough for its wedge: at most 11 letters, no ellipsis", () => {
    for (const kind of Object.keys(RINGS) as (keyof typeof RINGS)[]) {
      for (const name of shorts(kind)) {
        expect(name.length, name).toBeLessThanOrEqual(11);
        expect(name, name).not.toMatch(/…|\.\.\./);
      }
    }
  });

  it("follows the moment: the launches name their agent, the first word of it", () => {
    const launches = () => shorts("canvas").slice(0, 2);
    agentsStore.setState({ agents: [{ id: "codex", available: true }] } as never);
    expect(launches()).toEqual(["Codex", "Shell"]);
    agentsStore.setState({ agents: [{ id: "shell", available: true }, { id: "qwen", available: true }] } as never);
    expect([launches(), lineOf(RINGS.canvas[1]!, ctx)!.label]).toEqual([["Shell", "Qwen"], "Launch Qwen Code"]);
    agentsStore.setState({ agents: [{ id: "shell", available: true }] } as never);
    expect([launches(), lineOf(RINGS.canvas[1]!, ctx)!.label]).toEqual([["Shell", "Custom"], "Launch a custom agent…"]);
    agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never);
  });

  it("follows the moment: Pause or Resume, Lock or Unlock", () => {
    terminalStatusStore.getState().set("isis", { state: "running" });
    expect(lineOf(RINGS.terminal[6]!, ctx)!.short).toBe("Resume");
    agentActivityStore.setState({ activities: { isis: { activity: "working" } } } as never);
    expect(lineOf(RINGS.terminal[6]!, ctx)!.short).toBe("Pause");
    agentActivityStore.setState({ activities: {} } as never);
    terminalStatusStore.getState().set("isis", { state: "stopped" });
    const lock = () => lineOf(RINGS.selection[6]!, ctx)!;
    const api = (locked: boolean) =>
      ({ getSceneElements: () => [{ id: "r1", locked }], getAppState: () => ({ selectedElementIds: { r1: true } }) }) as unknown as ExcalidrawImperativeAPI;
    canvasStore.setState({ api: api(false) });
    expect([lock().label, lock().short]).toEqual(["Lock", "Lock"]);
    canvasStore.setState({ api: api(true) });
    expect([lock().label, lock().short]).toEqual(["Unlock", "Unlock"]);
    canvasStore.setState({ api: null });
  });
});

describe("the canvas ring when the default agent is the Shell (plan G1)", () => {
  it("does not offer « Launch Shell » twice: its second place goes to another agent, else to the custom one", () => {
    const canvas = () => RINGS.canvas.map((slot) => lineOf(slot, ctx)!.label);
    agentsStore.setState({ agents: [{ id: "shell", available: true }, { id: "gemini", available: true }] } as never);
    expect(canvas().filter((label) => label === "Launch Shell")).toHaveLength(1);
    expect(canvas()[1]).toBe("Launch Gemini");
    agentsStore.setState({ agents: [{ id: "shell", available: true }] } as never);
    expect(canvas().filter((label) => label === "Launch Shell")).toHaveLength(1);
    expect(canvas()[1]).not.toBe("Launch Shell");
    agentsStore.setState({ agents: [{ id: "claude", available: true }] } as never);
    expect(canvas()[1]).toBe("Launch Shell");
  });
});
