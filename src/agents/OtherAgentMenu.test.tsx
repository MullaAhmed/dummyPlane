// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { pendingUiRequest, requestUi } from "@/commands/uiRequests";
import { AGENT_IDS, type AgentInfo } from "@/ipc/pty";
import { uiStore } from "@/store/ui";
import { agentsStore } from "./agentsStore";
import { OtherAgentMenu } from "./OtherAgentMenu";
import { POINT_MENU_ROW } from "./PointMenu";
import { launchAt } from "./quickActions";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./quickActions", () => ({ launchAt: vi.fn() }));

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
  uiStore.getState().setPlacing(null);
  mockIPC((cmd) => {
    if (cmd === "list_agents") return detected;
    if (cmd === "list_shells") return ["powershell"];
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<OtherAgentMenu />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
  document.body.replaceChildren();
});

const at = { x: 120, y: 80 };
const place = { x: 300, y: 200 };
const ask = (extra: { at?: { x: number; y: number }; place?: { x: number; y: number } | undefined } = {}) =>
  act(async () => requestUi({ kind: "otherAgentMenu", at, place, ...extra }));
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

describe("the list of Other agent…", () => {
  it("opens where it is asked, with the agents this machine has in the menu's order, and neither the Shell nor a missing agent", async () => {
    expect(menu()).toBeNull();
    await ask();
    expect(names()).toEqual(["Claude", "Codex", "Custom"]);
    const anchor = document.querySelector<HTMLElement>("[data-other-agent-anchor]")!;
    expect([anchor.style.left, anchor.style.top]).toEqual(["120px", "80px"]);
    expect(menu()!.getAttribute("aria-label")).toBe("Launch an agent");
  });

  it("hides what is missing, not greys it: no row for it, no Install, no disabled row, no hint of its own", async () => {
    detected = found("claude", "ollama", "aider");
    agentsStore.setState({ agents: detected });
    await ask();
    expect(names()).toEqual(["Claude", "Aider", "Ollama", "Custom"]);
    for (const missing of ["Codex", "Gemini", "Qwen", "Cursor", "OpenCode"]) expect(menu()!.textContent, missing).not.toContain(missing);
    expect(menu()!.textContent).not.toContain("Install");
    expect(menu()!.querySelector("button, [data-disabled], [aria-disabled='true'], [title]")).toBeNull();
    expect(items().every((i) => i.getAttribute("role") === "menuitemradio")).toBe(true);
  });

  it("follows the agents the store has: one found since is listed, one gone is not", async () => {
    await ask();
    expect(names()).toEqual(["Claude", "Codex", "Custom"]);
    await act(async () => agentsStore.setState({ agents: found("codex", "gemini") }));
    expect(names()).toEqual(["Codex", "Gemini", "Custom"]);
  });

  it("is the Arrange list's menu: the shared surface, rows and motion, a row of the UI step with the ticked one in the same place", async () => {
    await ask();
    const content = menu()!;
    expect(content.getAttribute("data-slot")).toBe("dropdown-menu-content");
    // A request opened it: no animation (docs/design-system.md, Motion).
    expect(content.hasAttribute("data-instant")).toBe(true);
    // Its surface, hairline and radius are the shared menu's (set once by the data-slot rules): it adds only its width and padding,
    // and no pixel size, hex colour or one-off shadow of its own.
    expect(content.className.endsWith(" w-60 p-1")).toBe(true);
    expect(content.className).not.toMatch(/\[\d+px\]|#[0-9a-f]{3,6}|box-shadow|transition/);
    for (const row of items()) {
      expect(row.getAttribute("data-slot")).toBe("dropdown-menu-radio-item");
      for (const token of POINT_MENU_ROW.split(" ")) expect(row.className, token).toContain(token);
      // The keyboard ring and the hover fill of every menu row, with no transition on them.
      expect(row.className).toContain("focus:bg-dp-hover");
      expect(row.className).toContain("focus-visible:ring-1");
      expect(row.className).not.toMatch(/transition/);
    }
    expect(content.className).toContain("p-1");
    expect(document.querySelector('[role="menu"] [data-slot="dropdown-menu-radio-item-indicator"]')).not.toBeNull();
  });

  it("ticks the default agent, the one of New console, and puts the keyboard on it first", async () => {
    detected = found("codex", "gemini");
    agentsStore.setState({ agents: detected });
    await ask();
    expect(names()).toEqual(["Codex", "Gemini", "Custom"]);
    expect(items().map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("puts the keyboard on the first agent when the default is the Shell, and ticks none", async () => {
    detected = found("gemini");
    agentsStore.setState({ agents: detected });
    await ask();
    expect(names()).toEqual(["Gemini", "Custom"]);
    expect(items().map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("moves with Up and Down, wrapping, and launches on Enter at the scene point of the press, once, and closes", async () => {
    await ask();
    expect(document.activeElement).toBe(items()[0]);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await key(document.activeElement!, "ArrowUp");
    await key(document.activeElement!, "ArrowUp");
    // Wraps to the last row (Custom) and back round.
    expect(document.activeElement).toBe(items()[2]);
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "Enter");
    expect(launchAt).toHaveBeenCalledTimes(1);
    expect(launchAt).toHaveBeenCalledWith("codex", place);
    expect(menu()).toBeNull();
  });

  it("launches a click's agent where the ring was pressed, the window point being only where the list hangs", async () => {
    await ask();
    await act(async () => void items()[0].click());
    expect(launchAt).toHaveBeenCalledWith("claude", place);
    expect(menu()).toBeNull();
    expect(uiStore.getState().placing).toBeNull();
  });

  it("from the palette, with no place, lets the agent follow the pointer until the canvas is clicked", async () => {
    await ask({ place: undefined });
    await act(async () => void items()[1].click());
    expect(launchAt).not.toHaveBeenCalled();
    expect(uiStore.getState().placing).toEqual({ agent: "codex", options: expect.objectContaining({ cwd: expect.any(String), command: "" }) });
  });

  it("hands a Custom command and Ollama to the ＋ menu's own view for them, at the same place", async () => {
    detected = found("claude", "ollama");
    agentsStore.setState({ agents: detected });
    await ask();
    await act(async () => void items().find((i) => i.dataset.agentPick === "custom")!.click());
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "options", at: place });
    expect(launchAt).not.toHaveBeenCalled();
    await ask({ place: undefined });
    await act(async () => void items().find((i) => i.dataset.agentPick === "ollama")!.click());
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "ollama", at: undefined });
    expect(uiStore.getState().placing).toBeNull();
  });

  it("closes on Escape and starts nothing", async () => {
    await ask();
    await key(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
    expect(launchAt).not.toHaveBeenCalled();
    expect(uiStore.getState().placing).toBeNull();
    expect(pendingUiRequest()).toBeNull();
  });

  it("says, under Gemini, that its recursive deletes outside the worktree are not blocked, and under no agent dummyPlane guards", async () => {
    detected = found("claude", "gemini");
    agentsStore.setState({ agents: detected });
    await ask();
    const line = (id: string) => menu()!.querySelector(`[data-deletes-not-blocked="${id}"]`);
    expect(line("gemini")?.textContent).toBe("Not guarded: recursive deletes outside the worktree are not blocked");
    expect(menu()!.querySelector('[data-agent-pick="gemini"]')?.contains(line("gemini"))).toBe(true);
    expect(menu()!.querySelectorAll("[data-deletes-not-blocked]")).toHaveLength(1);
  });
});

describe("the list before and without a look at the machine", () => {
  it("waits for the first look, then lists what it found: nothing is known to be missing before", async () => {
    agentsStore.setState({ agents: [], shells: [], loaded: false });
    detected = found("codex");
    await ask();
    expect(names()).toEqual(["Codex", "Custom"]);
    expect(menu()).not.toBeNull();
  });

  it("opens at once on what the store knows and looks again, so a CLI installed since shows up", async () => {
    // Installed after the store's last look.
    detected = found("claude", "codex", "aider");
    await ask();
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(names()).toEqual(["Claude", "Codex", "Aider", "Custom"]);
  });

  it("says no agent was found, above the Custom command, on a machine with no agent's program: the Shell and Custom are always there", async () => {
    detected = found();
    agentsStore.setState({ agents: detected });
    await ask();
    expect(menu()!.querySelector("[data-other-agent-empty]")!.textContent).toBe("No agent foundInstall one from Add to canvas");
    expect(names()).toEqual(["Custom"]);
    expect(menu()!.querySelector('[data-slot="dropdown-menu-separator"]')).not.toBeNull();
    // The keyboard goes to the one row there is, not to the notice.
    expect(document.activeElement).toBe(items()[0]);
    await act(async () => void items()[0].click());
    expect(pendingUiRequest()).toEqual({ kind: "agentMenu", view: "options", at: place });
  });

  it("has no notice once an agent's program is found", async () => {
    await ask();
    expect(menu()!.querySelector("[data-other-agent-empty]")).toBeNull();
    expect(menu()!.querySelector('[data-slot="dropdown-menu-separator"]')).toBeNull();
  });

  it("shows the notice alone, in the same menu, when the look found no agent at all, and Escape still closes it", async () => {
    detected = [];
    agentsStore.setState({ agents: [], loaded: true });
    await ask();
    const empty = menu()!.querySelector("[data-other-agent-empty]")!;
    expect(empty.textContent).toBe("No agent foundInstall one from Add to canvas");
    expect(items()).toEqual([]);
    expect(menu()!.querySelector('[data-slot="dropdown-menu-separator"]')).toBeNull();
    expect(menu()!.getAttribute("data-slot")).toBe("dropdown-menu-content");
    await key(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
  });

  it("shows the empty state when the first look fails, instead of staying shut", async () => {
    agentsStore.setState({ agents: [], shells: [], loaded: false });
    mockIPC((cmd) => {
      if (cmd === "list_agents" || cmd === "list_shells") throw new Error("no PATH");
    });
    await ask();
    expect(menu()!.querySelector("[data-other-agent-empty]")).not.toBeNull();
  });
});
