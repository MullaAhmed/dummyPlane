// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ClipboardPaste, Group } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import type { CommandContext } from "@/commands/command";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/agents/agentsStore";
import { AGENTS } from "@/agents/catalog";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { lineOf, RINGS } from "./rings";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman", at: { x: 0, y: 0 }, groupId: "g1", fleetId: "chef" };
const labels = (kind: keyof typeof RINGS) => RINGS[kind].map((slot) => lineOf(slot, ctx)!.label);

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "chef" } });
  canvasStore.setState({ frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["batman"] }] });
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
    expect(labels("canvas")).toEqual(["Launch Claude", "Launch Shell", "New terminal in folder…", "Fleet", "Paste", "Text", "Other agent…", "Overview"]);
    expect(labels("terminal")).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Duplicate", "Pause", "Stop the process"]);
    expect(labels("group")).toEqual(["Add an agent…", "Rename the group", "Link a fleet", "Pause group", "Close the group", "Ungroup", "Resume group", "Zoom to group"]);
    expect(labels("fleet")).toEqual(["Write an instruction", "Rename", "Delete", "Link", "Paste"]);
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
    expect(shorts("canvas")).toEqual(["Claude", "Shell", "In folder", "Fleet", "Paste", "Text", "Other agent", "Overview"]);
    expect(shorts("terminal")).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Duplicate", "Pause", "Stop"]);
    expect(shorts("group")).toEqual(["Add agent", "Rename", "Link fleet", "Pause", "Close", "Ungroup", "Resume", "Zoom"]);
    expect(shorts("fleet")).toEqual(["Write", "Rename", "Delete", "Link", "Paste"]);
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
    terminalStatusStore.getState().set("batman", { state: "running" });
    expect(lineOf(RINGS.terminal[6]!, ctx)!.short).toBe("Resume");
    agentActivityStore.setState({ activities: { batman: { activity: "working" } } } as never);
    expect(lineOf(RINGS.terminal[6]!, ctx)!.short).toBe("Pause");
    agentActivityStore.setState({ activities: {} } as never);
    terminalStatusStore.getState().set("batman", { state: "stopped" });
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

describe("the selection ring with terminals selected", () => {
  const node = (id: string, fields: Record<string, unknown> = {}) => ({ id, type: "embeddable", isDeleted: false, frameId: null, y: 0, width: 720, height: 440, customData: { kind: "terminal" }, ...fields });
  const scene = [node("a", { x: 0 }), node("b", { x: 800 }), node("c", { x: 5000, frameId: "g1" }), { id: "r1", type: "rectangle", isDeleted: false, frameId: null }];
  const selecting = (selected: Record<string, boolean>) =>
    canvasStore.setState({ api: { getSceneElements: () => scene, getAppState: () => ({ selectedElementIds: selected }) } as unknown as ExcalidrawImperativeAPI });
  const second = (context: CommandContext = ctx) => lineOf(RINGS.selection[1]!, context)!;
  afterAll(() => canvasStore.setState({ api: null }));

  it("offers Group in Paste's place, still 8 buttons", () => {
    selecting({ a: true, b: true });
    expect(RINGS.selection).toHaveLength(8);
    expect([second().label, second().short, second().Icon, second().enabled]).toEqual(["Group selection", "Group", Group, true]);
    expect(labels("selection")).toEqual(["Copy", "Group selection", "Duplicate", "Bring to front", "Delete", "Send to back", "Lock", "More…"]);
  });

  it("keeps Paste with a drawing, or a single terminal, selected", () => {
    selecting({ r1: true });
    expect([second().label, second().Icon]).toEqual(["Paste", ClipboardPaste]);
    selecting({ a: true });
    expect(second().label).toBe("Paste");
    selecting({ a: true, r1: true });
    expect(second().label).toBe("Paste");
  });

  it("greys Group, and says why, when a terminal is already in a group", () => {
    selecting({ a: true, c: true });
    expect([second().label, second().enabled, second().reason]).toEqual(["Group selection", false, "a terminal is already in a group"]);
  });

  it("follows the ring's own selection, not Excalidraw's (the press has not been committed)", () => {
    selecting({ r1: true });
    expect(second({ ...ctx, selectionIds: ["a", "b"] }).label).toBe("Group selection");
    expect(second({ ...ctx, selectionIds: ["r1"] }).label).toBe("Paste");
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

describe("the canvas ring's « In folder » (plan folders)", () => {
  it("starts a terminal in a folder to pick, after the two agents and within the 8 places", () => {
    const place = RINGS.canvas.findIndex((slot) => slot.command === "agent.inFolder");
    expect(place).toBe(2);
    const line = lineOf(RINGS.canvas[place]!, ctx)!;
    expect([line.label, line.short, line.enabled]).toEqual(["New terminal in folder…", "In folder", true]);
    expect(RINGS.canvas.length).toBeLessThanOrEqual(8);
  });
});
