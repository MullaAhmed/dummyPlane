// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { showNode } from "@/canvas/arrive";
import { focusGroup } from "@/canvas/canvasFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { pauseAgents, pauseAll, resumeAgent } from "@/agents/broadcast";
import { requestCloseGroup, setGroupFolded, ungroup } from "@/agents/groups";
import { addFleetToGroup } from "@/fleet/fleets";
import { duplicateTerminal, requestClose } from "@/agents/terminals";
import { expandTerminal, minimizeTerminal } from "@/nodes/terminal/minimize";
import { pasteImageIntoTerminal, pasteIntoTerminal, relaunchTerminal, stopTerminal, terminalSelection } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { labelOf, sectionOf, type CommandContext } from "../command";
import { pendingUiRequest } from "../uiRequests";
import { reviewStore } from "@/review/reviewStore";
import { CURRENT } from "./current";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/arrive", () => ({ showNode: vi.fn(() => true), arrive: vi.fn(), arrivingNode: vi.fn(() => null) }));
vi.mock("@/canvas/canvasFocus", () => ({ focusGroup: vi.fn(() => true), releaseToCanvas: vi.fn() }));
vi.mock("@/agents/broadcast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/broadcast")>()),
  pauseAgents: vi.fn(() => Promise.resolve(1)),
  resumeAgent: vi.fn(() => Promise.resolve(true)),
  pauseAll: vi.fn(() => Promise.resolve()),
  resumeAll: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/agents/groups", () => ({ requestCloseGroup: vi.fn(), ungroup: vi.fn(), setGroupFolded: vi.fn(), groupMembers: vi.fn(() => ["batman"]) }));
vi.mock("@/fleet/fleets", () => ({ addFleetToGroup: vi.fn(() => Promise.resolve()) }));
vi.mock("@/agents/terminals", () => ({ duplicateTerminal: vi.fn(() => Promise.resolve()), requestClose: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({
  relaunchTerminal: vi.fn(),
  stopTerminal: vi.fn(),
  terminalSelection: vi.fn(() => ""),
  pasteIntoTerminal: vi.fn(),
  // An image goes in as a saved file's path: true when the clipboard holds one and no text.
  pasteImageIntoTerminal: vi.fn((_id: string, data: DataTransfer) => data.getData("text/plain") === "" && data.types.includes("Files")),
}));
vi.mock("@/nodes/terminal/minimize", () => ({ minimizeTerminal: vi.fn(() => true), expandTerminal: vi.fn(() => true) }));
/** What the clipboard holds in a test: "echo hi" unless a test puts an image there. */
let clipboard: { text: string; image: boolean } = { text: "echo hi", image: false };
vi.mock("@/radial/bridges", () => ({
  readClipboard: vi.fn(() =>
    Promise.resolve({ getData: () => clipboard.text, types: clipboard.image ? ["Files"] : ["text/plain"] } as unknown as DataTransfer),
  ),
  clipboardTextOf: vi.fn((data: DataTransfer) => data.getData("text/plain") || null),
}));

const ctx = (terminalId: string | null): CommandContext => ({ project: true, workspaceId: "w1", terminalCount: 2, terminalId });
const find = (id: string) => CURRENT.find((c) => c.id === id)!;
const ids = (c: CommandContext) => CURRENT.filter((command) => command.available(c)).map((command) => command.id);

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s1" },
  });
  await nodesStore.getState().create("cyborg", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Cyborg", name: "Cyborg", agent: "codex", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(() => {
  canvasStore.setState({
    frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["batman"] }],
  });
  terminalStatusStore.getState().set("batman", { state: "running" });
  terminalStatusStore.getState().set("cyborg", { state: "stopped" });
  agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 0 });
});
afterAll(() => clearMocks());

describe("Terminal · <prénom> and Groupe · <nom> (spec fenêtre §7.3)", () => {
  it("names its sections after the terminal of the moment and its group", () => {
    expect(sectionOf(find("terminal.rename"), ctx("batman"))).toBe("Terminal · Batman");
    expect(sectionOf(find("group.rename"), ctx("batman"))).toBe("Group · Serveurs");
    expect(CURRENT.map((c) => labelOf(c, ctx("batman")))).toEqual([
      "Rename",
      "Duplicate",
      "Review changes",
      "Restart",
      "Stop the process",
      "Pause",
      "Resume",
      "Minimize terminal",
      "Expand terminal",
      "Close",
      "Copy",
      "Paste",
      "Rename the group",
      "Add an agent…",
      "Link a fleet",
      "Fold or unfold the group",
      "Ungroup",
      "Close the group",
      "Pause group",
      "Resume group",
      "Zoom to group",
    ]);
  });

  it("offers each function under the rules of its button", () => {
    expect(ids(ctx(null))).toEqual([]);
    // Batman runs and works: no Resume; in a group.
    expect(ids(ctx("batman"))).toEqual([
      "terminal.rename",
      "terminal.duplicate",
      "terminal.review",
      "terminal.relaunch",
      "terminal.stop",
      "terminal.pause",
      "terminal.minimize",
      "terminal.close",
      "terminal.copy",
      "terminal.paste",
      "group.rename",
      "group.addAgent",
      "group.linkFleet",
      "group.fold",
      "group.ungroup",
      "group.close",
      "group.pause",
      "group.resume",
      "group.frame",
    ]);
    // Cyborg is stopped and outside any group.
    expect(ids(ctx("cyborg"))).toEqual(["terminal.rename", "terminal.duplicate", "terminal.review", "terminal.relaunch", "terminal.minimize", "terminal.close", "terminal.copy", "terminal.paste"]);
  });

  it("acts on the terminal of the moment, as its header and the panel's row do", async () => {
    await find("terminal.duplicate").run(ctx("batman"));
    expect(duplicateTerminal).toHaveBeenCalledWith("w1", "batman");
    await find("terminal.relaunch").run(ctx("batman"));
    expect(vi.mocked(relaunchTerminal).mock.calls[0][0]).toBe("batman");
    expect(vi.mocked(relaunchTerminal).mock.calls[0][2]).toBe("resume");
    await find("terminal.relaunch").run(ctx("cyborg"));
    expect(vi.mocked(relaunchTerminal).mock.calls[1][2]).toBe("new");
    await find("terminal.stop").run(ctx("batman"));
    expect(stopTerminal).toHaveBeenCalledWith("batman");
    await find("terminal.pause").run(ctx("batman"));
    expect(pauseAgents).toHaveBeenCalledWith(["batman"]);
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 0 });
    await find("terminal.resume").run(ctx("batman"));
    expect(resumeAgent).toHaveBeenCalledWith("batman");
    await find("terminal.close").run(ctx("cyborg"));
    expect(requestClose).toHaveBeenCalledWith("cyborg");
  });

  it("shows the terminal without taking the keyboard, then opens its name editor", async () => {
    await find("terminal.rename").run(ctx("cyborg"));
    expect(showNode).toHaveBeenCalledWith("cyborg");
    expect(pendingUiRequest()).toEqual({ kind: "renameTerminal", id: "cyborg" });
  });

  it("acts on the group of the moment, as its menu does", async () => {
    await find("group.linkFleet").run(ctx("batman"));
    expect(addFleetToGroup).toHaveBeenCalledWith("g1");
    await find("group.fold").run(ctx("batman"));
    expect(setGroupFolded).toHaveBeenLastCalledWith("g1", true);
    canvasStore.setState({ frames: [{ ...canvasStore.getState().frames[0], group: { role: "backend", pantheon: "egypt", folded: true } }] as never });
    await find("group.fold").run(ctx("batman"));
    expect(setGroupFolded).toHaveBeenLastCalledWith("g1", false);
    canvasStore.setState({ frames: [{ ...canvasStore.getState().frames[0], group: { role: "backend", pantheon: "egypt" } }] as never });
    await find("group.ungroup").run(ctx("batman"));
    expect(ungroup).toHaveBeenCalledWith("g1");
    await find("group.close").run(ctx("batman"));
    expect(requestCloseGroup).toHaveBeenCalledWith("g1");
    agentsPanelStore.setState({ open: false, filter: "waiting" });
    await find("group.addAgent").run(ctx("batman"));
    expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "all" });
    expect(pendingUiRequest()).toEqual({ kind: "groupMenu", id: "g1" });
    await find("group.rename").run(ctx("batman"));
    expect(focusGroup).toHaveBeenCalledWith("g1");
  });

  it("copies the terminal's selection, greyed without one, and pastes the clipboard into it", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    expect(find("terminal.copy").disabled!(ctx("batman"))).toBe("nothing selected");
    vi.mocked(terminalSelection).mockReturnValue("ls -la");
    expect(find("terminal.copy").disabled!(ctx("batman"))).toBeNull();
    await find("terminal.copy").run(ctx("batman"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ls -la");
    await find("terminal.paste").run(ctx("batman"));
    expect(pasteIntoTerminal).toHaveBeenCalledWith("batman", "echo hi");
  });

  it("pastes a clipboard image into the terminal as Ctrl+V does, not as text", async () => {
    clipboard = { text: "", image: true };
    try {
      vi.mocked(pasteIntoTerminal).mockClear();
      await find("terminal.paste").run(ctx("batman"));
      expect(pasteImageIntoTerminal).toHaveBeenCalledWith("batman", expect.anything());
      expect(pasteIntoTerminal).not.toHaveBeenCalled();
    } finally {
      clipboard = { text: "echo hi", image: false };
    }
  });

  it("acts on the group the radial menu points at, not the terminal's", async () => {
    const pointed = { ...ctx("cyborg"), groupId: "g1" };
    expect(sectionOf(find("group.rename"), pointed)).toBe("Group · Serveurs");
    await find("group.pause").run(pointed);
    expect(pauseAll).toHaveBeenCalledWith(["batman"]);
    await find("group.frame").run(pointed);
    expect(focusGroup).toHaveBeenLastCalledWith("g1");
    expect(find("group.pause").available({ ...ctx("cyborg"), groupId: "gone" })).toBe(false);
  });
});

it("opens the review of the terminal of the moment (spec maj §5)", async () => {
  await find("terminal.review").run(ctx("cyborg"));
  expect(reviewStore.getState().nodeId).toBe("cyborg");
});


describe("a target that went between the palette and Entrée (plan F2)", () => {
  it("does nothing, without a TypeError: the group is gone", async () => {
    canvasStore.setState({ frames: [] });
    for (const id of ["group.rename", "group.addAgent", "group.linkFleet", "group.fold", "group.ungroup", "group.close", "group.pause", "group.resume", "group.frame"]) {
      await expect(Promise.resolve(find(id).run(ctx("batman")))).resolves.toBeUndefined();
    }
    expect(ungroup).not.toHaveBeenCalled();
    expect(requestCloseGroup).not.toHaveBeenCalled();
  });

  it("does nothing for Restart when the terminal is gone", async () => {
    vi.mocked(relaunchTerminal).mockClear();
    await expect(Promise.resolve(find("terminal.relaunch").run(ctx("closed")))).resolves.toBeUndefined();
    expect(relaunchTerminal).not.toHaveBeenCalled();
  });
});

describe("Minimize terminal / Expand terminal", () => {
  it("offers Minimize on an open terminal and Expand on a minimized one, never both", () => {
    expect(ids(ctx("cyborg"))).toContain("terminal.minimize");
    expect(ids(ctx("cyborg"))).not.toContain("terminal.expand");
    nodesStore.getState().update("cyborg", { minimized: true });
    expect(ids(ctx("cyborg"))).toContain("terminal.expand");
    expect(ids(ctx("cyborg"))).not.toContain("terminal.minimize");
    nodesStore.getState().update("cyborg", { minimized: undefined });
  });

  it("minimizes the terminal of the moment, and expands it where it is, the view following", async () => {
    await find("terminal.minimize").run(ctx("cyborg"));
    expect(minimizeTerminal).toHaveBeenCalledWith("cyborg");
    vi.mocked(showNode).mockClear();
    await find("terminal.expand").run(ctx("cyborg"));
    expect(expandTerminal).toHaveBeenCalledWith("cyborg");
    expect(showNode).toHaveBeenCalledWith("cyborg");
  });
});
