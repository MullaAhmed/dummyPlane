// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { HomeScreen } from "@/home/HomeScreen";
import { ProjectCard } from "@/home/ProjectCard";
import { homeMessages } from "@/home/messages";
import { messages } from "@/i18n";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { uiStore } from "@/store/ui";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { ProjectPicker } from "./ProjectPicker";
import { ToolRail } from "./ToolRail";
import { shellMessages } from "./messages";

// Excalidraw does not load under Vitest (roughjs).
vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockWindows("main");
  mockIPC((cmd) => (cmd.startsWith("list_") ? [] : cmd === "plugin:window|is_maximized" ? false : undefined), { shouldMockEvents: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
  vi.clearAllMocks();
});

const open = (trigger: Element) => act(async () => void trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')];

it("the tool rail speaks English", async () => {
  canvasStore.setState({ api: null });
  await act(async () => root.render(<ToolRail />));
  const labels = [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Select (V)", "Hand (H)", "Shapes", "Text (T)", "Pen (P)", "Eraser (E)", "Image", "Launch an agent", "Fit the view"]);
});

it("the project picker menu speaks English", async () => {
  projectsStore.setState({ projects: [], activeId: null } as never);
  await act(async () => root.render(<ProjectPicker />));
  expect(host.querySelector("button")!.textContent).toBe("Project");
  await open(host.querySelector("button")!);
  expect(menuItems().map((i) => i.textContent)).toEqual(["All projects…", "Close the project"]);
});

it("the home screen speaks English", async () => {
  await act(async () => root.render(<HomeScreen />));
  expect(host.querySelector("h1")!.textContent).toBe("Projects");
  expect(host.textContent).toContain("Add a project");
  // With no agent and no project, Getting started speaks for the empty list (it no longer says "No projects" under it).
  expect(host.textContent).toContain("Getting started");
  expect(host.textContent).toContain("No coding agent found");
  expect(host.textContent).toContain("Search for a project");
});

it("a project card counts in English", async () => {
  const project = { id: "p1", name: "mk", path: "C:/mk", position: 0, lastOpenedAt: Date.now(), workspaceCount: 1, missing: false, liveAgents: 2 };
  await act(async () => root.render(<ProjectCard project={project} />));
  expect(host.textContent).toContain("1 workspace");
  expect(host.textContent).toContain("2 active agents");
  expect(host.textContent).toContain("just now");
});

it("the close agent dialog speaks English", async () => {
  await nodesStore.getState().create("t1", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  uiStore.getState().setClosing({ agents: ["t1"], remove: ["t1"] } as never);
  await act(async () => root.render(<CloseAgentDialog />));
  expect(document.body.textContent).toContain("Close Batman?");
  expect(document.body.textContent).toContain("Batman is still running. Closing it ends its session.");
  expect(document.body.textContent).toContain("Cancel");
  expect(document.body.textContent).toContain("Close the agent");
  uiStore.getState().setClosing(null);
});

it("sentences with a count follow English grammar", () => {
  const t = messages(shellMessages);
  expect(t.removeWorkspace.title("API")).toBe("Delete “API”?");
  expect(t.removeWorkspace.description(1)).toBe("1 agent will be stopped and the workspace's canvas erased.");
  expect(t.removeWorkspace.description(3)).toBe("3 agents will be stopped and the workspace's canvas erased.");
  expect(t.removeWorkspace.description(0)).toBe("The workspace's canvas will be erased.");
  expect(t.agentCounts.activeCount(3)).toBe("3 active");
  expect(t.percent(56)).toBe("56%");
  expect(messages(homeMessages).card.workspaces(0)).toBe("0 workspaces");
});
