// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { labelOf, sectionOf, type CommandContext } from "@/commands/command";
import { COMMANDS } from "@/commands/registry";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { chooseSlot } from "@/radial/choose";
import { ringAt } from "@/radial/install";
import { openRadial } from "@/radial/radialState";
import { lineOf, RINGS } from "@/radial/rings";
import { nodesStore } from "@/store/nodes";
import { quickNote } from "./quickNote";

/** "Quick note" from the keyboard and the right click: the palette's line, the terminal's and the Fleet's rings. */

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./quickNote", () => ({ quickNote: vi.fn(async () => "n1") }));

const command = (id: string) => COMMANDS.find((c) => c.id === id)!;
const palette: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman" };
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet" } });
});

afterEach(() => vi.clearAllMocks());
afterAll(() => nodesStore.setState({ nodes: {} }));

describe("the palette", () => {
  it("offers « Quick note on this terminal » for the terminal of the moment, and writes it there", async () => {
    const note = command("terminal.note");
    expect([labelOf(note, palette), sectionOf(note, palette), note.available(palette)]).toEqual(["Quick note on this terminal", "Terminal · Batman", true]);
    expect(note.keywords).toEqual(expect.arrayContaining(["note", "sticky"]));
    await note.run(palette);
    expect(quickNote).toHaveBeenCalledWith("batman");
  });

  it("offers nothing without a terminal, and never points at a Fleet", () => {
    expect(command("terminal.note").available({ ...palette, terminalId: null })).toBe(false);
    expect(command("fleet.note").available(palette)).toBe(false);
  });
});

describe("the right click", () => {
  it("has « Note » in a terminal's ring, wherever the terminal was pressed, and writes it beside that terminal", async () => {
    const context: CommandContext = { ...palette, terminalId: "batman", at: { x: 0, y: 0 } };
    const slot = RINGS.terminal.findIndex((s) => s.command === "terminal.note");
    const line = lineOf(RINGS.terminal[slot]!, context)!;
    expect([line.short, line.label, line.enabled]).toEqual(["Note", "Quick note on this terminal", true]);
    openRadial({ kind: "terminal", context, client: { x: 0, y: 0 }, center: { x: 0, y: 0 }, pressed: false, sliding: false, hovered: null });
    chooseSlot(slot);
    await frame();
    expect(quickNote).toHaveBeenCalledWith("batman");
  });

  it("has « Note » in a Fleet's ring too, writing beside the Fleet, not the terminal of the moment", async () => {
    const context: CommandContext = { ...palette, fleetId: "chef", at: { x: 0, y: 0 } };
    const slot = RINGS.fleet.findIndex((s) => s.command === "fleet.note");
    expect(lineOf(RINGS.fleet[slot]!, context)).toMatchObject({ short: "Note", label: "Quick note on this Fleet", enabled: true });
    openRadial({ kind: "fleet", context, client: { x: 0, y: 0 }, center: { x: 0, y: 0 }, pressed: false, sliding: false, hovered: null });
    chooseSlot(slot);
    await frame();
    expect(quickNote).toHaveBeenCalledWith("chef");
  });

  it("opens the terminal's ring from its header, its frame and its xterm body; a note's text keeps its own menu", () => {
    const api = { getAppState: () => ({ selectedElementIds: {} }), getSceneElements: () => [], updateScene: vi.fn() };
    canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI, view: EMPTY_VIEW, frames: [] });
    document.body.innerHTML = `
      <div class="excalidraw__embeddable-container"><div data-terminal="batman">
        <header><span data-name>Batman</span></header>
        <div class="xterm"><textarea class="xterm-helper-textarea"></textarea><div class="xterm-screen"></div></div>
      </div></div>
      <div class="excalidraw__embeddable-container"><div data-note="n1"><header></header><textarea></textarea></div></div>`;
    const kindAt = (selector: string) => ringAt(document.querySelector(selector)!, { x: 10, y: 10 })?.kind ?? null;
    expect([kindAt("[data-name]"), kindAt("[data-terminal]"), kindAt(".xterm-screen"), kindAt(".xterm-helper-textarea")]).toEqual(["terminal", "terminal", "terminal", "terminal"]);
    expect(ringAt(document.querySelector("[data-name]")!, { x: 10, y: 10 })?.context.terminalId).toBe("batman");
    expect(kindAt("[data-note] textarea")).toBeNull();
    canvasStore.setState({ api: null });
    document.body.innerHTML = "";
  });

  it("keeps Duplicate in the palette: the ring gave its place to the note", () => {
    expect(RINGS.terminal.some((s) => s.command === "terminal.duplicate")).toBe(false);
    expect(command("terminal.duplicate").available(palette)).toBe(true);
  });
});
