// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { pendingUiRequest, requestUi } from "@/commands/uiRequests";
import { toastError } from "@/lib/errorToast";
import { AGENT_IDS, type AgentInfo } from "@/ipc/pty";
import { agentsStore } from "./agentsStore";
import { GroupAgentMenu } from "./GroupAgentMenu";
import { addAgentToGroup } from "./groups";
import { POINT_MENU_ROW } from "./PointMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./groups", () => ({ addAgentToGroup: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/errorToast", () => ({ toastError: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What `list_agents` finds: the Shell and a Custom command always, and the CLIs named. */
const found = (...ids: string[]): AgentInfo[] => AGENT_IDS.map((id) => ({ id, available: id === "shell" || id === "custom" || ids.includes(id) }));

let detected: AgentInfo[];
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  detected = found("claude", "codex");
  agentsStore.setState({ agents: detected, shells: ["powershell"], loaded: true });
  mockIPC((cmd) => {
    if (cmd === "list_agents") return detected;
    if (cmd === "list_shells") return ["powershell"];
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // The only thing mounted: the list answers by itself, whatever the Agents panel shows or hides.
  await act(async () => root.render(<GroupAgentMenu />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
  document.body.replaceChildren();
});

const at = { x: 120, y: 80 };
const ask = (id = "g1") => act(async () => requestUi({ kind: "groupAgentMenu", id, at }));
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')];
/** A row's name: the first line of its text, not the note under Gemini's. */
const names = () => items().map((i) => i.querySelector("span.min-w-0 > span")!.textContent);
/** A key, and the tick Radix takes to move the focus a roving key asks for. */
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("the list of Add agent of a group", () => {
  it("opens where it is asked on its own, with the agents this machine has, the Shell included, and neither a missing agent nor a Custom command nor Ollama", async () => {
    detected = found("claude", "ollama", "aider");
    agentsStore.setState({ agents: detected });
    expect(menu()).toBeNull();
    await ask();
    expect(names()).toEqual(["Claude", "Aider", "Shell"]);
    const anchor = document.querySelector<HTMLElement>("[data-group-agent-anchor]")!;
    expect([anchor.style.left, anchor.style.top]).toEqual(["120px", "80px"]);
    expect(menu()!.getAttribute("aria-label")).toBe("Add an agent to the group");
    for (const left of ["Codex", "Gemini", "Custom", "Ollama", "Install"]) expect(menu()!.textContent, left).not.toContain(left);
    expect(menu()!.querySelector("[data-disabled], [aria-disabled='true']")).toBeNull();
  });

  it("is the Other agent list's menu: the shared surface, rows of the UI step, no animation as a request opened it", async () => {
    await ask();
    const content = menu()!;
    expect(content.getAttribute("data-slot")).toBe("dropdown-menu-content");
    expect(content.hasAttribute("data-instant")).toBe(true);
    expect(content.className.endsWith(" w-60 p-1")).toBe(true);
    for (const row of items()) {
      expect(row.getAttribute("data-slot")).toBe("dropdown-menu-radio-item");
      for (const token of POINT_MENU_ROW.split(" ")) expect(row.className, token).toContain(token);
    }
  });

  it("ticks the default agent, the one of New console, and puts the keyboard on it first", async () => {
    detected = found("codex", "gemini");
    agentsStore.setState({ agents: detected });
    await ask();
    expect(names()).toEqual(["Codex", "Gemini", "Shell"]);
    expect(items().map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("moves with Up and Down, wrapping, and launches the agent into that group on Enter, once, and closes", async () => {
    await ask();
    expect(document.activeElement).toBe(items()[0]);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await key(document.activeElement!, "ArrowUp");
    await key(document.activeElement!, "ArrowUp");
    // Wraps to the last row (Shell) and back round to Codex.
    expect(document.activeElement).toBe(items()[2]);
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "Enter");
    expect(addAgentToGroup).toHaveBeenCalledTimes(1);
    expect(addAgentToGroup).toHaveBeenCalledWith("g1", "codex");
    expect(menu()).toBeNull();
  });

  it("launches a click's agent into the group the request named, not one of the last request", async () => {
    await ask("g1");
    await key(document.activeElement!, "Escape");
    await ask("g2");
    await act(async () => void items()[2].click());
    expect(addAgentToGroup).toHaveBeenCalledWith("g2", "shell");
    expect(menu()).toBeNull();
  });

  it("closes on Escape and starts nothing", async () => {
    await ask();
    await key(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
    expect(addAgentToGroup).not.toHaveBeenCalled();
    expect(pendingUiRequest()).toBeNull();
  });

  it("says so, and keeps the list closed, when the launch fails", async () => {
    vi.mocked(addAgentToGroup).mockRejectedValueOnce(new Error("no folder"));
    await ask();
    await act(async () => void items()[0].click());
    expect(toastError).toHaveBeenCalledWith("Could not launch the agent", expect.objectContaining({ error: expect.any(Error) }));
    expect(menu()).toBeNull();
  });

  it("waits for the first look, then lists what it found: nothing is known to be missing before", async () => {
    agentsStore.setState({ agents: [], shells: [], loaded: false });
    detected = found("codex");
    await ask();
    expect(names()).toEqual(["Codex", "Shell"]);
  });

  it("says no agent was found, above the Shell, on a machine with no agent's program: the Shell is all there is to add", async () => {
    detected = found();
    agentsStore.setState({ agents: detected });
    await ask();
    expect(menu()!.querySelector("[data-group-agent-empty]")!.textContent).toBe("No agent foundInstall one from Add to canvas");
    expect(names()).toEqual(["Shell"]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("has no notice once an agent's program is found", async () => {
    await ask();
    expect(menu()!.querySelector("[data-group-agent-empty]")).toBeNull();
  });

  it("shows the notice alone, in the same menu, when the look found no agent at all, and Escape still closes it", async () => {
    detected = [];
    agentsStore.setState({ agents: [], loaded: true });
    await ask();
    expect(menu()!.querySelector("[data-group-agent-empty]")!.textContent).toBe("No agent foundInstall one from Add to canvas");
    expect(items()).toEqual([]);
    await key(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
  });
});
