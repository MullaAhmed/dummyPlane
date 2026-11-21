// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { GroupMenu } from "./GroupMenu";
import { workspacesStore } from "@/store/workspaces";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { setSetting } from "@/ipc/db";
import { arrangeWorkspace } from "./arrangeCanvas";
import { AGENT_IDS, type AgentInfo } from "@/ipc/pty";
import { agentsStore } from "./agentsStore";
import { addAgentToGroup, setGroupFolded } from "./groups";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./groups", async (importOriginal) => ({ ...(await importOriginal<typeof import("./groups")>()), setGroupFolded: vi.fn(), addAgentToGroup: vi.fn(() => Promise.resolve()) }));
vi.mock("./arrangeCanvas", () => ({ arrangeWorkspace: vi.fn(() => true) }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frame = (folded: boolean) => ({ id: "g", name: "G", x: 0, y: 0, width: 1, height: 1, group: { role: "general", pantheon: "greek", ...(folded ? { folded } : {}) }, memberIds: [] });

it("offers to fold an unfolded group and to unfold a folded one", async () => {
  mockIPC(() => []);
  canvasStore.setState({ frames: [frame(false)] as never });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GroupMenu groupId="g" />));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const item = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === text);
  await act(async () => item("Fold the group")!.click());
  expect(setGroupFolded).toHaveBeenLastCalledWith("g", true);
  await act(async () => canvasStore.setState({ frames: [frame(true)] as never }));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => item("Unfold the group")!.click());
  expect(setGroupFolded).toHaveBeenLastCalledWith("g", false);
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 20)));

it("gives focus back to the panel's ⋯ when it closes, but not to the canvas label's ⌄ nor after Rename", async () => {
  mockIPC(() => []);
  canvasStore.setState({ frames: [frame(false)] as never });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const openWith = async (button: HTMLButtonElement) => {
    button.focus();
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  };
  const escape = async () => {
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  };

  // The agents panel's ⋯: the keyboard keeps its place after a pick or Escape.
  await act(async () => root.render(<GroupMenu groupId="g" trigger={<button type="button">⋯</button>} />));
  const dots = host.querySelector("button")!;
  await openWith(dots);
  await escape();
  expect(document.activeElement).toBe(dots);

  // Rename hands the keyboard to the label's field: focus stays away from the ⋯.
  await openWith(dots);
  const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === "Rename")!;
  await act(async () => rename.click());
  await settle();
  expect(document.activeElement).not.toBe(dots);

  // The canvas label's ⌄: focus never comes back, it would close Excalidraw's name editor.
  await act(async () => root.render(<GroupMenu groupId="g" />));
  const chevron = host.querySelector("button")!;
  await openWith(chevron);
  await escape();
  expect(document.activeElement).not.toBe(chevron);

  await act(async () => root.unmount());
  document.body.replaceChildren();
});

it("lists the seven layouts under Arrange, and arranges the group once in the one picked, inside its frame in the shown workspace, the setting untouched", async () => {
  mockIPC(() => []);
  vi.clearAllMocks();
  canvasStore.setState({ frames: [frame(false)] as never });
  workspacesStore.setState({ activeId: "w1" });
  arrangeLayoutStore.setState({ layout: "column" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GroupMenu groupId="g" />));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  // The old one-shot item is a submenu now.
  expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some((i) => i.textContent === "Arrange as a tree")).toBe(false);
  const trigger = [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')].find((i) => i.textContent === "Arrange")!;
  expect(trigger).toBeDefined();
  await act(async () => void trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  const layouts = () => [...document.querySelectorAll<HTMLElement>('[data-arrange-layouts] [role="menuitem"]')];
  expect(layouts().map((i) => i.textContent)).toEqual(["Grid", "One row", "One column", "2 columns", "3 columns", "4 columns", "Tree"]);
  await act(async () => layouts()[6].click());
  expect(arrangeWorkspace).toHaveBeenLastCalledWith("w1", { only: ["g"], layout: "tree", undoable: true });
  // For this group, this once: not the setting the Settings row and Auto-arrange read.
  expect(arrangeLayoutStore.getState().layout).toBe("column");
  expect(setSetting).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

it("lists under Add an agent the agents this machine has and no more, none greyed, and adds the one picked to the group", async () => {
  mockIPC(() => []);
  vi.clearAllMocks();
  const found = (...ids: string[]): AgentInfo[] => AGENT_IDS.map((id) => ({ id, available: id === "shell" || id === "custom" || ids.includes(id) }));
  agentsStore.setState({ agents: found("claude", "aider"), loaded: true });
  canvasStore.setState({ frames: [frame(false)] as never });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GroupMenu groupId="g" />));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const trigger = [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')].find((i) => i.textContent === "Add an agent")!;
  await act(async () => void trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  const rows = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-content"] [role="menuitem"]')];
  expect(rows().map((i) => i.textContent?.trim())).toEqual(["Claude", "Aider", "Shell"]);
  expect(rows().some((i) => i.hasAttribute("data-disabled"))).toBe(false);
  await act(async () => rows()[1].click());
  expect(addAgentToGroup).toHaveBeenCalledWith("g", "aider");
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
