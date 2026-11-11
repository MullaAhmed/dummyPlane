// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { agentsStore } from "@/agents/agentsStore";
import { projectsStore } from "@/store/projects";
import { labelOf, runCommand, sectionOf, type CommandContext } from "./command";
import { functionSections } from "./functions";
import { goToItems, goToSections } from "./goTo";
import { openPalette, paletteStore, setPaletteQuery } from "./paletteState";
import { Palette } from "./Palette";
import { recentStore } from "./recent";
import { COMMANDS } from "./registry";
import { errorToasts } from "@/lib/errorToast.testkit";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn(), terminalSelection: vi.fn(() => "") }));
vi.mock("./goToRun", () => ({ goTo: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const home: CommandContext = { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
const busy: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: "batman" };
const find = (id: string) => COMMANDS.find((c) => c.id === id)!;
const lines = (query: string, ctx = busy) => functionSections(COMMANDS, ctx, query).flatMap((s) => s.items.map((l) => l.command.id));

beforeEach(() => {
  recentStore.setState({ ids: [] });
  agentsStore.setState({ agents: [{ id: "claude", available: true }], loaded: true, load: () => Promise.resolve() } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the palette's catalogs in English", () => {
  it("reads labels and sections in English", () => {
    expect(labelOf(find("terminal.next"), busy)).toBe("Next terminal");
    expect(labelOf(find("agent.nextWaiting"), busy)).toBe("Go to the next waiting agent");
    expect(labelOf(find("agent.launch.claude"), busy)).toBe("Launch Claude");
    expect(labelOf(find("agent.launch.ollama"), busy)).toBe("Install Ollama…");
    expect(labelOf(find("tool.rectangle"), busy)).toBe("Rectangle");
    expect(labelOf(find("tool.freedraw"), busy)).toBe("Pen");
    expect(sectionOf(find("app.logs"), busy)).toBe("Help");
    expect(sectionOf(find("edit.undo"), busy)).toBe("Drawing");
    expect(sectionOf(find("terminal.rename"), busy)).toMatch(/^Terminal · /);
  });

  it("groups each section once, under its English name", () => {
    const sections = functionSections(COMMANDS, busy, "").map((s) => s.label);
    expect(sections).toContain("Drawing");
    expect(new Set(sections).size).toBe(sections.length);
  });

  it("searches with the English words", () => {
    expect(lines("undo")).toContain("edit.undo");
    expect(lines("minimize")[0]).toBe("window.minimize");
    expect(lines("clipboard")).toContain("drawing.paste");
  });

  it("greys what cannot be installed, in English", () => {
    const shell = functionSections(COMMANDS, busy, "launch shell").flatMap((s) => s.items).find((l) => l.command.id === "agent.launch.shell");
    expect(shell?.disabled).toMatch(/not found in PATH$/);
  });

  it("shows the shortcuts with English key names", () => {
    const overview = functionSections(COMMANDS, busy, "overview").flatMap((s) => s.items)[0];
    expect(overview.hint).toBe("Ctrl+Shift+A");
  });

  it("reports a failed command in English", async () => {
    const error = vi.spyOn(toast, "error").mockReturnValue("");
    const failing = { ...find("project.close"), run: () => Promise.reject(new Error("boom")) };
    runCommand(failing, busy);
    await vi.waitFor(() => expect(errorToasts(error)).toEqual([{ title: "Close the project failed", description: "boom" }]));
  });

  it("groups the go-to items under their English section names", () => {
    const items = goToItems({
      home: true,
      projects: [{ id: "p1", name: "api", path: "C:/api", lastOpenedAt: 1, missing: false }],
      activeProjectId: null,
      workspaces: [],
      activeWorkspaceId: null,
      scenes: {},
      nodes: {},
      live: {},
    } as never);
    expect(goToSections(items, "").map((s) => s.label)).toEqual(["Projects"]);
  });
});

describe("the palette component in English", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    mockIPC(() => undefined);
    projectsStore.setState({ view: "home", projects: [], activeId: null } as never);
    paletteStore.setState({ open: false, query: "", context: null, returnFocus: null });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Palette />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    clearMocks();
  });

  it("writes its placeholder, footer and empty state in English", async () => {
    await act(async () => openPalette("goTo", home));
    const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
    expect(input.placeholder).toBe("Go to a terminal, a workspace, a file (file:line)… (> for functions)");
    expect(document.body.textContent).toContain("↑↓ navigate · Enter open · Esc close");
    await act(async () => setPaletteQuery("zzzzzz"));
    expect(document.body.textContent).toContain("No results");
  });

  it("lists the functions in English, under their English sections", async () => {
    await act(async () => openPalette("functions", home));
    await act(async () => setPaletteQuery("> about"));
    const items = [...document.querySelectorAll("[cmdk-item]")].map((i) => i.textContent);
    expect(items).toContain("About dummyPlane");
    expect(document.body.textContent).toContain("Help");
  });
});

describe("the go-to rows in English", () => {
  it("writes counts and states in English", async () => {
    const { GoToRow } = await import("./GoToRow");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const row = async (item: Parameters<typeof GoToRow>[0]["item"]) => {
      await act(async () => root.render(<GoToRow item={item} />));
      return host.textContent;
    };
    expect(await row({ key: "g", kind: "group", label: "Servers", keywords: [], members: 3, group: { name: "Servers", color: "#fff" } })).toContain("3 agents");
    expect(await row({ key: "o", kind: "fleet", label: "Chief", keywords: [], links: 2 })).toContain("linked to 2");
    expect(await row({ key: "w", kind: "workspace", label: "Main", keywords: [], live: 1, current: true })).toBe("Main1 activeshown");
    await act(async () => root.unmount());
    host.remove();
  });
});
