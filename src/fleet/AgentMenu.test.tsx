// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestUi } from "@/commands/uiRequests";
import { AGENT_IDS, type AgentInfo } from "@/ipc/pty";
import { uiStore } from "@/store/ui";
import { agentsStore } from "./agentsStore";
import { AgentMenu } from "./AgentMenu";
import { installAgent, pullOllamaModel } from "./installAgent";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("./quickActions", () => ({ newConsole: vi.fn(), placeOrchestrator: vi.fn() }));
vi.mock("./installAgent", () => ({ installAgent: vi.fn(() => Promise.resolve("node")), pullOllamaModel: vi.fn(() => Promise.resolve("node")) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const only = (...ids: string[]): AgentInfo[] => AGENT_IDS.map((id) => ({ id, available: id === "shell" || id === "custom" || ids.includes(id) }));

let agents: AgentInfo[];
let models: string[];
let npm: boolean;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  agents = only("claude");
  models = [];
  npm = true;
  vi.mocked(installAgent).mockClear();
  vi.mocked(pullOllamaModel).mockClear();
  agentsStore.setState({ agents: [], shells: [], loaded: false });
  uiStore.getState().setPlacing(null);
  mockIPC((cmd) => {
    if (cmd === "list_agents") return agents;
    if (cmd === "list_shells") return ["powershell"];
    if (cmd === "list_ollama_models") return models;
    if (cmd === "refresh_path") return null;
    if (cmd === "npm_available") return npm;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  clearMocks();
  document.body.replaceChildren();
});

const openMenu = async () => {
  await act(async () => root.render(<AgentMenu answersRequests trigger={() => <button type="button">open</button>} />));
  await act(async () => host.querySelector("button")!.click());
};
const button = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const installButtons = () => [...document.body.querySelectorAll<HTMLButtonElement>("[data-install]")];

it("offers to install the missing agents only (spec installation §4.1)", async () => {
  await openMenu();
  expect(installButtons().map((b) => b.dataset.install)).toEqual(["codex", "gemini", "qwen", "cursor", "opencode", "aider", "ollama"]);
  expect(installButtons()[0].getAttribute("aria-label")).toBe("Install Codex");
  expect(installButtons()[0].disabled).toBe(false);
});

it("offers nothing before the agents are known", async () => {
  mockIPC((cmd) => (cmd === "list_agents" || cmd === "list_shells" ? new Promise(() => undefined) : undefined));
  await openMenu();
  expect(installButtons()).toEqual([]);
});

it("shows the whole command before running it, then installs from the menu", async () => {
  await openMenu();
  await act(async () => installButtons()[0].click());
  const prompt = document.body.querySelector("[data-install-prompt='codex']")!;
  expect(prompt.querySelector("code")!.textContent).toBe('powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"');
  expect(prompt.textContent).toContain("(PowerShell)");
  expect(installAgent).not.toHaveBeenCalled();
  await act(async () => button("Run in a terminal")!.click());
  expect(installAgent).toHaveBeenCalledWith("codex", undefined);
  expect(document.body.querySelector("[data-install-prompt]")).toBeNull();
});

it("says that Gemini CLI needs Node.js, in cmd, and links to its page", async () => {
  await openMenu();
  await act(async () => document.body.querySelector<HTMLButtonElement>("[data-install='gemini']")!.click());
  const prompt = document.body.querySelector("[data-install-prompt='gemini']")!;
  expect(prompt.textContent).toContain("Requires Node.js");
  expect(prompt.textContent).toContain("(Command Prompt)");
  await act(async () => button("Official page")!.click());
  expect(openUrl).toHaveBeenCalledWith("https://github.com/google-gemini/gemini-cli");
});

it("says npm is missing before anything runs, and checks again once Node.js is there (spec installation §3)", async () => {
  npm = false;
  await openMenu();
  await act(async () => document.body.querySelector<HTMLButtonElement>("[data-install='gemini']")!.click());
  const prompt = document.body.querySelector("[data-install-prompt='gemini']")!;
  expect(prompt.textContent).toContain("npm was not found");
  expect(button("Run in a terminal")!.disabled).toBe(true);
  await act(async () => button("Download Node.js")!.click());
  expect(openUrl).toHaveBeenCalledWith("https://nodejs.org/en/download");
  npm = true;
  await act(async () => button("Check again")!.click());
  expect(prompt.textContent).not.toContain("npm was not found");
  expect(button("Run in a terminal")!.disabled).toBe(false);
  await act(async () => button("Run in a terminal")!.click());
  expect(installAgent).toHaveBeenCalledWith("gemini", undefined);
});

it("never looks for npm when the install does not need it", async () => {
  npm = false;
  await openMenu();
  await act(async () => document.body.querySelector<HTMLButtonElement>("[data-install='codex']")!.click());
  expect(button("Run in a terminal")!.disabled).toBe(false);
});

it("opens on the install asked by the palette", async () => {
  await openMenu();
  await act(async () => requestUi({ kind: "agentMenu", view: { install: "aider" }, at: { x: 7, y: 8 } }));
  expect(document.body.querySelector("[data-install-prompt='aider']")).not.toBeNull();
  await act(async () => button("Run in a terminal")!.click());
  expect(installAgent).toHaveBeenCalledWith("aider", { x: 7, y: 8 });
});

it("goes back to the agents without installing", async () => {
  await openMenu();
  await act(async () => installButtons()[0].click());
  await act(async () => button("Install Codex")!.click());
  expect(document.body.querySelector("[data-install-prompt]")).toBeNull();
  expect(installButtons().length).toBeGreaterThan(0);
  expect(installAgent).not.toHaveBeenCalled();
});

it("installs where the radial menu was opened", async () => {
  await openMenu();
  await act(async () => requestUi({ kind: "agentMenu", view: "agents", at: { x: 5, y: 6 } }));
  await act(async () => installButtons()[0].click());
  await act(async () => button("Run in a terminal")!.click());
  expect(installAgent).toHaveBeenCalledWith("codex", { x: 5, y: 6 });
});

it("speaks English", async () => {
  await openMenu();
  expect(installButtons()[0].textContent).toBe("Install");
  await act(async () => installButtons()[0].click());
  const prompt = document.body.querySelector("[data-install-prompt]")!;
  expect(prompt.textContent).toContain("This official command will run in a terminal on the canvas (PowerShell):");
  expect(button("Run in a terminal")).toBeTruthy();
});

/** The field a label names, through its `for`. */
const field = (label: string) => {
  const tag = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
  return tag ? (document.getElementById(tag.htmlFor) as HTMLInputElement | null) : null;
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const placing = () => uiStore.getState().placing;

it("launches the palette's custom agent on the command typed in its form", async () => {
  await openMenu();
  await act(async () => requestUi({ kind: "agentMenu", view: "options" }));
  const command = field("Command to run")!;
  expect(document.getElementById(command.getAttribute("aria-describedby")!)!.textContent).toBe("A Custom terminal runs it in its shell when it starts.");
  expect(button("Launch the custom command")!.disabled).toBe(true);
  await type(command, "npm run dev");
  await act(async () => button("Launch the custom command")!.click());
  expect(placing()).toEqual({ agent: "custom", options: expect.objectContaining({ command: "npm run dev", cwd: expect.any(String) }) });
});

it("opens the Custom row on its command, the last one filled in, before anything runs", async () => {
  await openMenu();
  await act(async () => button("Custom")!.click());
  expect(placing()).toBeNull();
  await type(field("Command to run")!, "cargo watch");
  await act(async () => button("Launch the custom command")!.click());
  expect(placing()).toMatchObject({ agent: "custom", options: { command: "cargo watch" } });
  await act(async () => uiStore.getState().setPlacing(null));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => button("Custom")!.click());
  expect(field("Command to run")!.value).toBe("cargo watch");
  expect(placing()).toBeNull();
});

it("keeps the command out of the footer's Options and out of the other agents' launches", async () => {
  await openMenu();
  await act(async () => button("Custom")!.click());
  await type(field("Command to run")!, "npm run dev");
  await act(async () => button("Custom command")!.click());
  await act(async () => button("Options")!.click());
  expect([...document.body.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["Folder", "Shell", "Title"]);
  expect(field("Command to run")).toBeNull();
  expect(button("Launch the custom command")).toBeUndefined();
  expect(document.body.textContent).toContain("The next agents you launch from this menu use these.");
  await type(field("Title")!, "API");
  await act(async () => button("Launch options")!.click());
  await act(async () => button("Claude")!.click());
  expect(placing()).toMatchObject({ agent: "claude", options: { title: "API", command: "" } });
});

it("pulls an Ollama model from its picker, the menu closing on the terminal (spec installation §5)", async () => {
  agents = only("ollama");
  models = ["llama3.2:3b"];
  await openMenu();
  await act(async () => button("Ollama")!.click());
  await act(async () => button("qwen2.5-coder:7b")!.click());
  expect(pullOllamaModel).toHaveBeenCalledWith("qwen2.5-coder:7b", undefined);
  expect(button("qwen2.5-coder:7b")).toBeUndefined();
});
