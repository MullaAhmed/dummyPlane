// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { agentsPanelStore } from "@/agents/agentsPanelState";
import { getByRole } from "@/lib/a11y";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { openCodeWorkspace } from "@/studio/navigate";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { ActivityRail } from "./ActivityRail";

// Excalidraw does not load under Vitest (roughjs); the rail only reaches it through the settings menu's actions.
vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/studio/navigate", () => ({ openCodeWorkspace: vi.fn(async () => undefined) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => mockIPC(() => undefined));
afterEach(() => clearMocks());

it("toggles the agents panel and shows how many agents wait", async () => {
  await nodesStore.getState().create("alan", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Alan", name: "Alan", agent: "codex", cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set("alan", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "alan", activity: "waiting", since: 0 });
  canvasStore.getState().setNodeIds(["alan"]);
  agentsPanelStore.setState({ open: false, filter: "all" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ActivityRail />));
  // The name carries the pip's number (WCAG 2.5.3 label in name).
  const agents = getByRole(host, "button", "Agents, 1 waiting");
  expect(agents.querySelector("[data-pip]")?.textContent).toBe("1");
  await act(async () => agents.click());
  expect(agentsPanelStore.getState().open).toBe(true);
  expect(host.querySelector('[aria-label="Settings"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("opens the notes in their workspace tab, and shows when they are on screen", async () => {
  projectsStore.setState({ activeId: "p1" });
  const openNotes = vi.fn(async () => "n1");
  workspacesStore.setState({ openNotes, activeId: "w1", workspaces: [{ id: "n1", projectId: "p1", name: "Notes", position: 1, pantheon: null, kind: "notes", folder: null }] } as never);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ActivityRail />));
  const notes = host.querySelector<HTMLButtonElement>('[aria-label="Notes"]')!;
  // A workspace it goes to, not a toggle: it says where the user is (aria-current), never "not pressed" (P2-7).
  expect(notes.hasAttribute("aria-pressed")).toBe(false);
  expect(notes.hasAttribute("aria-current")).toBe(false);
  await act(async () => notes.click());
  expect(openNotes).toHaveBeenCalled();
  await act(async () => workspacesStore.setState({ activeId: "n1" }));
  expect(notes.getAttribute("aria-current")).toBe("page");
  expect(notes.hasAttribute("aria-pressed")).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});

it("opens the code studio", async () => {
  projectsStore.setState({ activeId: "p1" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ActivityRail />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Code Studio"]')!.click());
  expect(openCodeWorkspace).toHaveBeenCalled();
  projectsStore.setState({ activeId: null });
  await act(async () => root.unmount());
  host.remove();
});
