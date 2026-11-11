// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ClipboardPaste, Group, Ungroup as UngroupIcon } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { toStoredKind } from "@/canvas/nodeElement";
import type { CommandContext } from "@/commands/command";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/agents/agentsStore";
import { AGENTS } from "@/agents/catalog";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { ARCS, arcLines, lineOf, moreSlotOf, ringLines, RINGS, wedgeCountOf, type RingKind, type RingSlot } from "./rings";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  terminalSelection: vi.fn(() => ""),
}));

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman", at: { x: 0, y: 0 }, groupId: "g1", fleetId: "chef" };
const KINDS = Object.keys(RINGS) as RingKind[];
/** The ring's wedges as they show, More last. */
const labels = (kind: RingKind) => ringLines(kind, ctx).map((line) => line!.label);
const arcLabels = (kind: RingKind, context: CommandContext = ctx) => arcLines(kind, context).map((line) => line!.label);
const idOf = (slot: RingSlot, context: CommandContext = ctx) => (typeof slot.command === "function" ? slot.command(context) : slot.command);

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

describe("the rings", () => {
  it("gives each ring at most 8 wedges, More last included, no empty place, each a function of the registry, never twice with its arc", () => {
    for (const kind of KINDS) {
      expect(wedgeCountOf(kind), kind).toBeLessThanOrEqual(8);
      expect(moreSlotOf(kind), kind).toBe(wedgeCountOf(kind) - 1);
      expect(ringLines(kind, ctx).every(Boolean), kind).toBe(true);
      expect(ringLines(kind, ctx)[moreSlotOf(kind)]).toMatchObject({ more: true, command: null, label: "More", short: "More", enabled: true });
      const ids = [...RINGS[kind], ...ARCS[kind]].map((slot) => idOf(slot));
      expect(new Set(ids).size, kind).toBe(ids.length);
      for (const id of ids) expect(COMMANDS.some((c) => c.id === id), id).toBe(true);
    }
  });

  it("names each ring's positions clockwise from the top, More last", () => {
    expect(labels("canvas")).toEqual(["Launch Claude", "Launch Shell", "New terminal in folder…", "Fleet", "Paste", "Arrange", "Other agent…", "More"]);
    expect(labels("terminal")).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Quick note on this terminal", "Pause", "More"]);
    expect(labels("group")).toEqual(["Add an agent…", "Rename the group", "Link a fleet", "Pause group", "Close the group", "Arrange the group", "Resume group", "More"]);
    expect(labels("fleet")).toEqual(["Write an instruction", "Rename", "Delete", "Link", "Paste", "Quick note on this Fleet", "More"]);
    expect(labels("selection")).toEqual(["Copy", "Paste", "Duplicate", "Bring to front", "Delete", "Send to back", "Arrange", "More"]);
  });

  it("puts what the ring has no room for in its More arc, clockwise", () => {
    expect(arcLabels("canvas")).toEqual(["Overview", "Export scene…", "Import scene…", "Export as PNG…"]);
    expect(arcLabels("terminal")).toEqual(["Stop the process", "Duplicate", "Review changes", "Remove from group", "Arrange the group"]);
    expect(arcLabels("group")).toEqual(["Ungroup", "Fold the group", "Zoom to group"]);
    expect(arcLabels("fleet")).toEqual(["Arrange", "Remove from group"]);
    // Excalidraw's own full menu last: nothing of it is lost.
    expect(arcLabels("selection")).toEqual(["Lock", "More drawing options…"]);
  });

  it("keeps every function the rings had before their arcs, on the ring or in its arc", () => {
    const before: Record<RingKind, string[]> = {
      canvas: ["agent.launch.claude", "agent.launch.shell", "agent.inFolder", "agent.fleet", "drawing.paste", "scene.arrange", "agent.other", "canvas.overview"],
      terminal: ["terminal.copy", "terminal.paste", "terminal.rename", "terminal.relaunch", "terminal.close", "terminal.note", "terminal.pause", "terminal.stop"],
      group: ["group.addAgent", "group.rename", "group.linkFleet", "group.pause", "group.close", "group.ungroup", "group.resume", "group.frame"],
      fleet: ["fleet.write", "fleet.rename", "fleet.remove", "fleet.link", "fleet.paste", "fleet.note"],
      selection: ["drawing.copy", "drawing.paste", "drawing.duplicate", "drawing.front", "drawing.delete", "drawing.back", "drawing.lock", "drawing.more"],
    };
    for (const kind of KINDS) {
      const reach = [...RINGS[kind], ...ARCS[kind]].map((slot) => idOf(slot));
      for (const id of before[kind]) expect(reach, `${kind}: ${id}`).toContain(id);
    }
  });

  it("arranges a node's group from its More, or else the whole canvas, never Excalidraw's selection elsewhere", () => {
    const arrange = (kind: RingKind, context: CommandContext) => lineOf(ARCS[kind].find((slot) => slot.short === "arrange")!, context)!;
    // Batman stands in g1: its group, inside the frame.
    expect([arrange("terminal", ctx).command!.id, arrange("terminal", ctx).context.groupId]).toEqual(["group.arrange", "g1"]);
    // A terminal in no group, the Fleet in none: the canvas, whole.
    const loose = { ...ctx, terminalId: "nobody", groupId: undefined };
    expect([arrange("terminal", loose).command!.id, arrange("terminal", loose).context.selectionIds]).toEqual(["scene.arrange", []]);
    expect([arrange("fleet", ctx).command!.id, arrange("fleet", ctx).context.selectionIds]).toEqual(["scene.arrange", []]);
    // The ring's own context is left as it was.
    expect(ctx.selectionIds).toBeUndefined();
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
    const stop = lineOf(ARCS.terminal[0]!, ctx)!;
    expect([stop.label, stop.enabled, stop.reason]).toEqual(["Stop the process", false, null]);
    expect(lineOf(RINGS.terminal[4]!, ctx)!.danger).toBe(true);
  });
});

describe("the wedges' short names", () => {
  const shorts = (kind: RingKind) => ringLines(kind, ctx).map((line) => line!.short);
  const arcShorts = (kind: RingKind) => arcLines(kind, ctx).map((line) => line!.short);

  it("names each wedge in a word or two, clockwise from the top", () => {
    expect(shorts("canvas")).toEqual(["Claude", "Shell", "In folder", "Fleet", "Paste", "Arrange", "Other agent", "More"]);
    expect(shorts("terminal")).toEqual(["Copy", "Paste", "Rename", "Restart", "Close", "Note", "Pause", "More"]);
    expect(shorts("group")).toEqual(["Add agent", "Rename", "Link fleet", "Pause", "Close", "Arrange", "Resume", "More"]);
    expect(shorts("fleet")).toEqual(["Write", "Rename", "Delete", "Link", "Paste", "Note", "More"]);
    expect(shorts("selection")).toEqual(["Copy", "Paste", "Duplicate", "To front", "Delete", "To back", "Arrange", "More"]);
  });

  it("names each wedge of the arcs the same way", () => {
    expect(arcShorts("canvas")).toEqual(["Overview", "Export", "Import", "PNG"]);
    expect(arcShorts("terminal")).toEqual(["Stop", "Duplicate", "Review", "Leave group", "Arrange"]);
    expect(arcShorts("group")).toEqual(["Ungroup", "Fold", "Zoom"]);
    expect(arcShorts("fleet")).toEqual(["Arrange", "Leave group"]);
    expect(arcShorts("selection")).toEqual(["Lock", "Options"]);
  });

  it("keeps every name short enough for its wedge: at most 11 letters, no ellipsis", () => {
    for (const kind of KINDS) {
      for (const name of [...shorts(kind), ...arcShorts(kind)]) {
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

  it("follows the moment: Fold or Unfold", () => {
    const fold = () => lineOf(ARCS.group[1]!, ctx)!;
    expect([fold().label, fold().short]).toEqual(["Fold the group", "Fold"]);
    const frames = canvasStore.getState().frames;
    canvasStore.setState({ frames: [{ ...frames[0], group: { role: "backend", pantheon: "egypt", folded: true } }] });
    expect([fold().label, fold().short]).toEqual(["Unfold the group", "Unfold"]);
    canvasStore.setState({ frames });
  });

  it("follows the moment: Pause or Resume, Lock or Unlock", () => {
    terminalStatusStore.getState().set("batman", { state: "running" });
    expect(lineOf(RINGS.terminal[6]!, ctx)!.short).toBe("Resume");
    agentActivityStore.setState({ activities: { batman: { activity: "working" } } } as never);
    expect(lineOf(RINGS.terminal[6]!, ctx)!.short).toBe("Pause");
    agentActivityStore.setState({ activities: {} } as never);
    terminalStatusStore.getState().set("batman", { state: "stopped" });
    const lock = () => lineOf(ARCS.selection[0]!, ctx)!;
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

  it("offers Group in Paste's place, still 8 wedges", () => {
    selecting({ a: true, b: true });
    expect(wedgeCountOf("selection")).toBe(8);
    expect([second().label, second().short, second().Icon, second().enabled]).toEqual(["Group selection", "Group", Group, true]);
    expect(labels("selection")).toEqual(["Copy", "Group selection", "Duplicate", "Bring to front", "Delete", "Send to back", "Arrange", "More"]);
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

describe("the selection ring's Ungroup", () => {
  const info = { kind: "group", role: "general", pantheon: "egyptian" };
  const node = (id: string, frameId: string | null, kind = "terminal") => ({ id, type: "embeddable", isDeleted: false, frameId, groupIds: [], x: 0, y: 0, width: 720, height: 440, customData: { kind } });
  const frame = (id: string) => ({ id, type: "frame", isDeleted: false, frameId: null, groupIds: [], x: 0, y: 0, width: 2000, height: 900, customData: { dummyplane: info } });
  const shape = (id: string, groupIds: string[]) => ({ id, type: "rectangle", isDeleted: false, frameId: null, groupIds, x: 0, y: 0, width: 10, height: 10 });
  const scene = [frame("g1"), node("a", "g1"), node("b", "g1"), frame("g2"), node("c", "g2"), { ...node("loose", null), x: 10000 }, { ...node("free", null), x: 11000 }, shape("r1", ["s1"]), shape("r2", ["s1"]), shape("r3", []), node("note", "g1", "note"), node("chef", "g1", toStoredKind("fleet"))];
  const selecting = (...ids: string[]) =>
    canvasStore.setState({
      api: { getSceneElements: () => scene, getAppState: () => ({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) }) } as unknown as ExcalidrawImperativeAPI,
    });
  const second = () => lineOf(RINGS.selection[1]!, ctx)!;
  const seen = () => [second().label, second().short, second().Icon, second().enabled, second().reason];
  afterAll(() => canvasStore.setState({ api: null }));

  it("offers Ungroup, with its own name and icon, for a group's frame or its members", () => {
    for (const ids of [["a", "b"], ["g1"], ["g1", "a", "b"]]) {
      selecting(...ids);
      expect(seen(), ids.join()).toEqual(["Ungroup selection", "Ungroup", UngroupIcon, true, null]);
    }
  });

  it("offers Ungroup for Excalidraw's groups of drawings, with no terminal selected", () => {
    selecting("r1", "r2");
    expect(seen()).toEqual(["Ungroup selection", "Ungroup", UngroupIcon, true, null]);
  });

  it("counts a group's terminals and a Fleet in its frame as members, never a quick note that sits there", () => {
    // A note has no ring of its own: a right-click on it opens the selection's, which must not dissolve its group.
    selecting("note");
    expect([second().label, second().Icon]).toEqual(["Paste", ClipboardPaste]);
    selecting("chef");
    expect(seen()).toEqual(["Ungroup selection", "Ungroup", UngroupIcon, true, null]);
    // With members, it is not outside the group either.
    selecting("a", "note");
    expect(seen()).toEqual(["Ungroup selection", "Ungroup", UngroupIcon, true, null]);
  });

  it("greys the selection's Arrange for drawings alone, which Arrange leaves where they are, and offers it with a node", () => {
    const arrange = (...ids: string[]) => lineOf(RINGS.selection[6]!, { ...ctx, selectionIds: ids })!;
    selecting();
    expect([arrange("r1", "r2").label, arrange("r1", "r2").enabled, arrange("r1", "r2").reason]).toEqual(["Arrange", false, "drawings stay where they are"]);
    expect([arrange("loose", "free").enabled, arrange("loose", "free").reason]).toEqual([true, null]);
    expect(arrange("note", "a").enabled).toBe(true);
  });

  it("greys Ungroup, and says why, for a selection across two groups or past the group's frame", () => {
    selecting("a", "c");
    expect(seen()).toEqual(["Ungroup selection", "Ungroup", UngroupIcon, false, "the selection spans several groups"]);
    selecting("a", "loose");
    expect(seen()).toEqual(["Ungroup selection", "Ungroup", UngroupIcon, false, "something outside the group is selected"]);
    selecting("g1", "r1", "r2");
    expect(second().reason).toBe("something outside the group is selected");
  });

  it("keeps Group for loose terminals, drawings or not, and Paste for a drawing in no group or a lone terminal with drawings", () => {
    selecting("loose", "free");
    expect(seen()).toEqual(["Group selection", "Group", Group, true, null]);
    selecting("loose", "free", "r1", "r2");
    expect(second().label).toBe("Group selection");
    selecting("r3");
    expect([second().label, second().Icon]).toEqual(["Paste", ClipboardPaste]);
    selecting("loose", "r1", "r2");
    expect(second().label).toBe("Paste");
  });

  it("moves nothing else in the rings: only the second place of the selection ring changes", () => {
    const around = () => RINGS.selection.map((slot) => lineOf(slot, ctx)!.label).filter((_, i) => i !== 1);
    const others = () => (["canvas", "terminal", "group", "fleet"] as const).map((kind) => labels(kind));
    selecting("r3");
    const [before, othersBefore] = [around(), others()];
    for (const ids of [["a", "b"], ["r1", "r2"], ["a", "c"], ["loose", "free"]]) {
      selecting(...ids);
      expect(around(), ids.join()).toEqual(before);
      expect(others(), ids.join()).toEqual(othersBefore);
    }
  });
});

describe("the canvas ring when the default agent is the Shell", () => {
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
