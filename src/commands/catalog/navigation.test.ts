// @vitest-environment happy-dom
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { showAbout } from "@/app/about";
import { arrive } from "@/canvas/arrive";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { fitScene, zoomTo } from "@/canvas/viewActions";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { currentWaitingAgents } from "@/agents/waitingAgents";
import { addProject } from "@/home/addProject";
import { focusCommandBar } from "@/shell/commandBarFocus";
import { closeWindow, minimizeWindow, toggleMaximizeWindow, windowStore } from "@/shell/windowState";
import { removeWorkspace } from "@/shell/workspaceActions";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { labelOf, type Command, type CommandContext } from "../command";
import { goToNextWaiting } from "../goToRun";
import { pendingUiRequest } from "../uiRequests";
import { APP } from "./app";
import { NAVIGATION } from "./navigation";
import { WORKSPACES } from "./workspaces";
import { gitWindowStore } from "@/git/gitWindowStore";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(), showNode: vi.fn(), arrivingNode: vi.fn(() => null) }));
vi.mock("@/canvas/viewActions", () => ({ fitScene: vi.fn(), zoomTo: vi.fn() }));
vi.mock("@/agents/waitingAgents", () => ({ currentWaitingAgents: vi.fn(() => []) }));
vi.mock("../goToRun", () => ({ goToNextWaiting: vi.fn() }));
vi.mock("@/shell/commandBarFocus", () => ({ focusCommandBar: vi.fn() }));
vi.mock("@/shell/workspaceActions", () => ({ removeWorkspace: vi.fn(() => Promise.resolve()) }));
vi.mock("@/app/about", () => ({ showAbout: vi.fn(() => Promise.resolve()) }));
vi.mock("@/home/addProject", () => ({ addProject: vi.fn(() => Promise.resolve()) }));
vi.mock("@/shell/windowState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shell/windowState")>()),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
}));

const home: CommandContext = { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 2, terminalId: "batman" };
const find = (list: readonly Command[], id: string) => list.find((c) => c.id === id)!;
const goHome = vi.fn();
const close = vi.fn(() => Promise.resolve());

beforeEach(() => {
  mockIPC(() => undefined);
  projectsStore.setState({ view: "project", goHome, close } as never);
  workspacesStore.setState({
    workspaces: [
      { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null },
      { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null },
    ],
    activeId: "w1",
  } as never);
});
afterAll(() => clearMocks());

describe("Ctrl+Tab", () => {
  /** A group folded onto its label holding h1 and h2 (hidden), and two terminals standing loose, below. */
  const terminal = (id: string, x: number, y: number, frameId: string | null = null) => ({ ...createNodeElement("terminal", { x, y }), id, frameId }) as ExcalidrawElement;
  const group = (folded: boolean) =>
    ({
      id: "g",
      type: "frame",
      x: 0,
      y: 0,
      width: 2000,
      height: 600,
      isDeleted: false,
      frameId: null,
      groupIds: [],
      name: "Group",
      customData: { dummyplane: { kind: "group", role: "general", pantheon: "greek", ...(folded ? { folded: true } : {}) } },
    }) as unknown as ExcalidrawElement;
  const scene = (folded: boolean, loose = ["l1", "l2"]) => [
    terminal("h1", 400, 300, "g"),
    terminal("h2", 1200, 300, "g"),
    group(folded),
    ...loose.map((id, i) => terminal(id, 400 + 800 * i, 1400)),
  ];
  const press = (id: "terminal.next" | "terminal.previous", from: string | null) => find(NAVIGATION, id).run({ ...busy, terminalId: from });
  const withScene = (elements: ExcalidrawElement[]) => canvasStore.setState({ api: { getSceneElements: () => elements } as never });

  beforeEach(() => vi.mocked(arrive).mockClear());

  it("goes round the terminals on the screen, skipping those a folded group keeps off it", async () => {
    withScene(scene(true));
    await press("terminal.next", "l1");
    await press("terminal.next", "l2");
    await press("terminal.previous", "l1");
    expect(vi.mocked(arrive).mock.calls.map(([id]) => id)).toEqual(["l2", "l1", "l2"]);
  });

  it("starts from the first or the last when the terminal it leaves is hidden, and does nothing when all of them are", async () => {
    withScene(scene(true));
    await press("terminal.next", "h1");
    await press("terminal.previous", "h2");
    expect(vi.mocked(arrive).mock.calls.map(([id]) => id)).toEqual(["l1", "l2"]);
    vi.mocked(arrive).mockClear();
    withScene(scene(true, []));
    await press("terminal.next", "h1");
    await press("terminal.previous", null);
    expect(arrive).not.toHaveBeenCalled();
  });

  it("goes through an open group's terminals too", async () => {
    withScene(scene(false));
    await press("terminal.next", "h2");
    await press("terminal.next", "l2");
    expect(vi.mocked(arrive).mock.calls.map(([id]) => id)).toEqual(["l1", "h1"]);
  });
});

describe("Navigation", () => {
  it("lists the functions, in their fixed order", () => {
    agentsPanelStore.setState({ open: true });
    expect(NAVIGATION.filter((c) => c.id !== "palette.functions").map((c) => labelOf(c, busy))).toEqual([
      "Next terminal",
      "Previous terminal",
      "Go to the next waiting agent",
      "Go to…",
      "Overview",
      "Give control back to the canvas",
      "Fit to scene",
      "Zoom 100%",
      "Write an instruction",
      "Hide the Agents panel",
      "Notes",
      "Git window",
      "Home",
      "Close the project",
      "Go to line…",
    ]);
  });

  it("does what the buttons do", async () => {
    // From the palette, the keyboard: the fit lands at once.
    await find(NAVIGATION, "canvas.fit").run(busy);
    expect(fitScene).toHaveBeenCalledWith("keyboard");
    await find(NAVIGATION, "canvas.zoom100").run(busy);
    expect(zoomTo).toHaveBeenCalledWith(1);
    await find(NAVIGATION, "commandBar.focus").run(busy);
    expect(focusCommandBar).toHaveBeenCalled();
    await find(NAVIGATION, "project.home").run(busy);
    expect(goHome).toHaveBeenCalled();
    await find(NAVIGATION, "project.close").run(busy);
    expect(close).toHaveBeenCalled();
  });

  it("shows or hides the agents panel, named after its state", async () => {
    agentsPanelStore.setState({ open: false });
    const toggle = find(NAVIGATION, "agentsPanel.toggle");
    expect(labelOf(toggle, busy)).toBe("Show the Agents panel");
    await toggle.run(busy);
    expect(agentsPanelStore.getState().open).toBe(true);
    expect(labelOf(toggle, busy)).toBe("Hide the Agents panel");
  });

  it("offers the next waiting agent only while one waits, and starts from the current terminal", async () => {
    const next = find(NAVIGATION, "agent.nextWaiting");
    vi.mocked(currentWaitingAgents).mockReturnValue([]);
    expect(next.available(busy)).toBe(false);
    vi.mocked(currentWaitingAgents).mockReturnValue([{ id: "cyborg", kind: "terminal", name: "Cyborg", workspaceId: "w2", since: 0 }]);
    expect(next.available(busy)).toBe(true);
    await next.run(busy);
    expect(goToNextWaiting).toHaveBeenCalledWith("batman");
  });

  it("offers nothing but « Go to… » outside a project", () => {
    expect(NAVIGATION.filter((c) => c.available(home)).map((c) => c.id)).toEqual(["palette.goTo", "palette.functions"]);
  });
});

describe("Notes", () => {
  it("opens from the palette, in a project only", () => {
    const notes = find(NAVIGATION, "notes.open");
    expect(labelOf(notes, busy)).toBe("Notes");
    expect(notes.keywords).toContain("memory");
    expect(notes.available(home)).toBe(false);
    expect(notes.available(busy)).toBe(true);
    // In a workspace tab of their own, as the code is.
    const openNotes = vi.fn(async () => "n1");
    workspacesStore.setState({ openNotes } as never);
    void notes.run(busy);
    expect(openNotes).toHaveBeenCalled();
  });
});

describe("Git window", () => {
  const git = () => find(NAVIGATION, "git.window");

  it("is offered with Ctrl+Shift+B where the branch chip found a repository, and opens the window on it", async () => {
    gitWindowStore.setState({ repo: null, path: null });
    expect(labelOf(git(), busy)).toBe("Git window");
    expect(git().shortcut).toBe("Ctrl+Shift+B");
    expect(git().keywords).toContain("commit");
    expect(git().available(busy)).toBe(false);
    gitWindowStore.setState({ repo: "C:/code/api" });
    expect(git().available(home)).toBe(false);
    expect(git().available(busy)).toBe(true);
    await git().run(busy);
    expect(gitWindowStore.getState().path).toBe("C:/code/api");
    gitWindowStore.setState({ repo: null, path: null });
  });

  it("gives an open window the keyboard again, on its first changed file, rather than opening it twice", async () => {
    document.body.innerHTML = '<aside data-git-window><div role="tab" data-state="active" tabindex="0">Changes</div><button data-git-row tabindex="0">a.ts</button></aside><textarea></textarea>';
    document.querySelector("textarea")!.focus();
    gitWindowStore.setState({ repo: "C:/code/api", path: "C:/code/api" });
    await git().run(busy);
    expect(document.activeElement?.textContent).toBe("a.ts");
    gitWindowStore.setState({ repo: null, path: null });
    document.body.replaceChildren();
  });
});

describe("Workspaces", () => {
  it("creates, renames in the tab, deletes after the existing confirmation", async () => {
    const create = vi.fn(() => Promise.resolve());
    workspacesStore.setState({ create } as never);
    await find(WORKSPACES, "workspace.new").run(busy);
    expect(create).toHaveBeenCalled();
    await find(WORKSPACES, "workspace.rename").run(busy);
    expect(pendingUiRequest()).toEqual({ kind: "renameWorkspace", id: "w1" });
    await find(WORKSPACES, "workspace.delete").run(busy);
    expect(removeWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }), 0);
  });

  it("never deletes the last workspace", () => {
    expect(find(WORKSPACES, "workspace.delete").available(busy)).toBe(true);
    workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null }] } as never);
    expect(find(WORKSPACES, "workspace.delete").available(busy)).toBe(false);
  });
});

describe("Projets, Fenêtre, Aide", () => {
  it("adds a project at home only", async () => {
    const add = find(APP, "project.add");
    expect(add.available(busy)).toBe(false);
    projectsStore.setState({ view: "home" } as never);
    expect(add.available(home)).toBe(true);
    await add.run(home);
    expect(addProject).toHaveBeenCalled();
  });

  it("drives the window and tells the version, everywhere", async () => {
    for (const id of ["window.minimize", "window.maximize", "window.close", "app.about"]) expect(find(APP, id).available(home)).toBe(true);
    await find(APP, "window.minimize").run(home);
    await find(APP, "window.maximize").run(home);
    await find(APP, "window.close").run(home);
    await find(APP, "app.about").run(home);
    expect([minimizeWindow, toggleMaximizeWindow, closeWindow, showAbout].every((f) => vi.mocked(f).mock.calls.length === 1)).toBe(true);
  });

  it("names the maximize command after the window's state", () => {
    windowStore.setState({ maximized: false });
    expect(labelOf(find(APP, "window.maximize"), home)).toBe("Maximize");
    windowStore.setState({ maximized: true });
    expect(labelOf(find(APP, "window.maximize"), home)).toBe("Restore");
  });
});
