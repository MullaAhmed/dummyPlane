// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { editPanelStore, foldEditPanel, openEditPanel } from "@/canvas/editPanel";
import { gitWindowStore } from "@/git/gitWindowStore";
import { reviewStore } from "@/review/reviewStore";
import { workspacesStore } from "@/store/workspaces";
import { agentsPanelStore, setAgentsPanel } from "./agentsPanelState";
import { installPanelFold, openWorkWindows } from "./panelFold";

const WORKSPACES = [
  { id: "canvas", projectId: "p1", name: "Canvas", position: 0, kind: "canvas" },
  { id: "code", projectId: "p1", name: "Code", position: 1, kind: "code" },
  { id: "notes", projectId: "p1", name: "Notes", position: 2, kind: "notes" },
];

const panel = () => agentsPanelStore.getState().open;
const workWindowOpen = () => Object.values(openWorkWindows()).some(Boolean);
const goTo = (activeId: string | null) => workspacesStore.setState({ activeId });

let saved: unknown[];
let stop: () => void;

function start(open: boolean) {
  agentsPanelStore.setState({ open, filter: "all", held: false });
  stop = installPanelFold();
}

beforeEach(() => {
  saved = [];
  mockIPC((cmd, args) => {
    if (cmd === "set_setting") saved.push(args);
  });
  reviewStore.setState({ nodeId: null });
  gitWindowStore.setState({ path: null });
  editPanelStore.setState({ openFor: null });
  workspacesStore.setState({ projectId: "p1", workspaces: WORKSPACES as never, activeId: "canvas", status: "ready" });
});
afterEach(() => {
  stop?.();
  clearMocks();
});

describe("the Agents panel while a work window is open", () => {
  it("counts the review panel, the git window, Code Studio and Notes, and nothing else", () => {
    expect(workWindowOpen()).toBe(false);
    reviewStore.getState().open("t1");
    expect(workWindowOpen()).toBe(true);
    reviewStore.getState().close();
    gitWindowStore.getState().open("D:/code/api");
    expect(workWindowOpen()).toBe(true);
    gitWindowStore.getState().close();
    goTo("code");
    expect(workWindowOpen()).toBe(true);
    goTo("notes");
    expect(workWindowOpen()).toBe(true);
    goTo("canvas");
    expect(workWindowOpen()).toBe(false);
    goTo(null);
    expect(workWindowOpen()).toBe(false);
  });

  it.each([
    ["the review panel", () => reviewStore.getState().open("t1"), () => reviewStore.getState().close()],
    ["the git window", () => gitWindowStore.getState().open("D:/code/api"), () => gitWindowStore.getState().close()],
    ["Code Studio", () => goTo("code"), () => goTo("canvas")],
    ["Notes", () => goTo("notes"), () => goTo("canvas")],
  ])("folds for %s and comes back when it closes", (_name, open, close) => {
    start(true);
    open();
    expect(panel()).toBe(false);
    close();
    expect(panel()).toBe(true);
    expect(saved).toEqual([]);
  });

  it("leaves a panel that was closed closed", () => {
    start(false);
    reviewStore.getState().open("t1");
    expect(panel()).toBe(false);
    reviewStore.getState().close();
    expect(panel()).toBe(false);
  });

  it("folds at once when the app starts on a work window", () => {
    goTo("code");
    start(true);
    expect(panel()).toBe(false);
    goTo("canvas");
    expect(panel()).toBe(true);
  });

  it("lets a reopened panel win until the window closes, and keeps it open after", () => {
    start(true);
    goTo("notes");
    expect(panel()).toBe(false);
    setAgentsPanel(true);
    expect(panel()).toBe(true);
    goTo("canvas");
    expect(panel()).toBe(true);
  });

  it("keeps a panel the person closed by hand over the window closed after it", () => {
    start(true);
    goTo("notes");
    setAgentsPanel(true);
    setAgentsPanel(false);
    goTo("canvas");
    expect(panel()).toBe(false);
  });

  it("folds again for the next window after the person's choice", () => {
    start(true);
    reviewStore.getState().open("t1");
    setAgentsPanel(true);
    reviewStore.getState().close();
    expect(panel()).toBe(true);
    goTo("code");
    expect(panel()).toBe(false);
    goTo("canvas");
    expect(panel()).toBe(true);
  });

  it("stays folded when one window takes the place of another, and returns with the last", () => {
    start(true);
    reviewStore.getState().open("t1");
    // The git window takes the review panel's place, in one change as far as the panel can see.
    const seen: boolean[] = [];
    const off = agentsPanelStore.subscribe((s) => seen.push(s.open));
    gitWindowStore.getState().open("D:/code/api");
    expect(seen).toEqual([]);
    expect(panel()).toBe(false);
    expect(reviewStore.getState().nodeId).toBeNull();
    goTo("notes");
    expect(panel()).toBe(false);
    gitWindowStore.getState().close();
    expect(panel()).toBe(false);
    goTo("code");
    goTo("canvas");
    expect(panel()).toBe(true);
    off();
  });

  it("folds a panel reopened over one window when another opens, and restores it when the last closes", () => {
    start(true);
    reviewStore.getState().open("t1");
    setAgentsPanel(true);
    expect(panel()).toBe(true);
    // The chip opens the git window over the review panel.
    gitWindowStore.getState().open("D:/code/api");
    expect(panel()).toBe(false);
    gitWindowStore.getState().close();
    expect(panel()).toBe(true);
  });

  it("folds a panel reopened over Code Studio when Notes comes up", () => {
    start(true);
    goTo("code");
    setAgentsPanel(true);
    expect(panel()).toBe(true);
    goTo("notes");
    expect(panel()).toBe(false);
    goTo("canvas");
    expect(panel()).toBe(true);
  });

  it("folds a panel reopened over a window when a review opens over it", () => {
    start(true);
    gitWindowStore.getState().open("D:/code/api");
    setAgentsPanel(true);
    reviewStore.getState().open("t1");
    expect(panel()).toBe(false);
    reviewStore.getState().close();
    expect(panel()).toBe(false);
    gitWindowStore.getState().close();
    expect(panel()).toBe(true);
  });

  it("does not fold a panel again for a window that is already open", () => {
    start(true);
    reviewStore.getState().open("t1");
    setAgentsPanel(true);
    // Another agent's review takes the panel's place: the same window, nothing opens.
    reviewStore.getState().open("t2");
    workspacesStore.setState({ status: "ready" });
    expect(panel()).toBe(true);
  });

  it("keeps the panel's filter through the fold", () => {
    start(true);
    agentsPanelStore.setState({ filter: "waiting" });
    goTo("code");
    goTo("canvas");
    expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "waiting" });
  });

  it("stops watching when it is stopped", () => {
    start(true);
    stop();
    goTo("code");
    expect(panel()).toBe(true);
  });
});

describe("a terminal's Edit panel, which stands beside its node, not in the lane", () => {
  const edit = () => editPanelStore.getState().openFor;

  it("leaves the Agents panel open when the Edit panel opens and folds", () => {
    start(true);
    openEditPanel("t1");
    expect([panel(), edit()]).toEqual([true, "t1"]);
    foldEditPanel();
    expect([panel(), edit()]).toEqual([true, null]);
    expect(saved).toEqual([]);
  });

  it("leaves the Edit panel open when the person opens the Agents panel", () => {
    start(false);
    openEditPanel("t1");
    setAgentsPanel(true);
    expect([panel(), edit()]).toEqual([true, "t1"]);
  });

  it.each([
    ["the review panel", () => reviewStore.getState().open("t1"), () => reviewStore.getState().close()],
    ["the git window", () => gitWindowStore.getState().open("D:/code/api"), () => gitWindowStore.getState().close()],
    ["Code Studio", () => goTo("code"), () => goTo("canvas")],
    ["Notes", () => goTo("notes"), () => goTo("canvas")],
  ])("folds the Edit panel when %s opens, which would hide it, and leaves it folded when it closes", (_name, open, close) => {
    start(true);
    openEditPanel("t1");
    open();
    expect([panel(), edit()]).toEqual([false, null]);
    close();
    // The Agents panel comes back with the window; the Edit panel waits for its node's pencil.
    expect([panel(), edit()]).toEqual([true, null]);
  });

  it("leaves an Edit panel opened over a work window open, and the Agents panel folded until the window closes", () => {
    start(true);
    gitWindowStore.getState().open("D:/code/api");
    openEditPanel("t1");
    expect([panel(), edit()]).toEqual([false, "t1"]);
    foldEditPanel();
    expect(panel()).toBe(false);
    gitWindowStore.getState().close();
    expect(panel()).toBe(true);
  });
});
