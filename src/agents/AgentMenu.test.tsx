// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestUi } from "@/commands/uiRequests";
import { AGENT_IDS, type AgentInfo } from "@/ipc/pty";
import { projectsStore, type Project } from "@/store/projects";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { agentsStore } from "./agentsStore";
import { AgentMenu } from "./AgentMenu";
import { launchFolderKey, launchFolderStore } from "./launchFolder";
import { installAgent, pullOllamaModel } from "./installAgent";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(() => Promise.resolve(null)) }));
vi.mock("./quickActions", () => ({ newConsole: vi.fn(), placeFleet: vi.fn() }));
vi.mock("./installAgent", () => ({ installAgent: vi.fn(() => Promise.resolve("node")), pullOllamaModel: vi.fn(() => Promise.resolve("node")) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const only = (...ids: string[]): AgentInfo[] => AGENT_IDS.map((id) => ({ id, available: id === "shell" || id === "custom" || ids.includes(id) }));

let agents: AgentInfo[];
let models: string[];
let npm: boolean;
let writes: { key: string; value: unknown }[];
/** What the backend was told about the folders of workspaces. */
let folderWrites: { id: string; folder: string | null }[];
let savedFolder: unknown;
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
  projectsStore.setState({ projects: [], activeId: null });
  workspacesStore.setState({ projectId: null, workspaces: [], activeId: null, status: "loading" });
  launchFolderStore.setState({ projectId: null, recent: [], loaded: false });
  vi.mocked(pickDirectory).mockReset();
  writes = [];
  folderWrites = [];
  savedFolder = null;
  mockIPC((cmd, args) => {
    if (cmd === "get_setting") return (args as { key: string }).key === launchFolderKey("p1") ? savedFolder : null;
    if (cmd === "set_setting") writes.push(args as { key: string; value: unknown });
    if (cmd === "set_workspace_folder") folderWrites.push(args as { id: string; folder: string | null });
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

/** The project p1 is open on its workspace w1, its recent folders read; `folder` is the one w1 picked, if any. */
const inProject = async (path = "D:\\code\\api", folder: string | null = null) => {
  workspacesStore.setState({
    projectId: "p1",
    workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder }],
    activeId: "w1",
    status: "ready",
  });
  projectsStore.setState({ projects: [{ id: "p1", name: "api", path, lastOpenedAt: 0, missing: false } as Project], activeId: "p1" });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
const folderBar = () => document.body.querySelector<HTMLElement>("[data-launch-folder]")!;
const folderShown = () => folderBar().querySelector("[data-launch-folder-name]")!.textContent;
const pickNext = (path: string | null) => vi.mocked(pickDirectory).mockResolvedValueOnce(path);
const recentShown = () => [...document.body.querySelectorAll<HTMLElement>("[data-recent-folder]")].map((b) => b.textContent);

it("shows the folder the next terminals start in at the top of the menu, its full path on hover", async () => {
  await inProject();
  await openMenu();
  const popover = document.body.querySelector("[data-slot='popover-content']")!;
  expect(popover.firstElementChild).toBe(folderBar());
  expect(folderShown()).toBe("api");
  expect([...folderBar().querySelectorAll<HTMLElement>("[title]")].map((e) => e.title)).toContain("D:\\code\\api");
  expect(button("Change…")).toBeTruthy();
  expect(button("Project folder")).toBeUndefined();
});

it("starts the agents it launches in the folder picked with Change…, and keeps it for the next ones", async () => {
  await inProject();
  await openMenu();
  expect(placing()).toBeNull();
  pickNext("D:\\work\\lib");
  await act(async () => button("Change…")!.click());
  expect(pickDirectory).toHaveBeenCalledWith(expect.objectContaining({ directory: true, defaultPath: "D:\\code\\api" }));
  expect(folderShown()).toBe("lib");
  await act(async () => button("Claude")!.click());
  expect(placing()).toMatchObject({ agent: "claude", options: { cwd: "D:\\work\\lib" } });
  // Opened again, the choice is still there.
  await act(async () => uiStore.getState().setPlacing(null));
  await act(async () => host.querySelector("button")!.click());
  expect(folderShown()).toBe("lib");
});

it("changes nothing when the picker is cancelled", async () => {
  await inProject();
  await openMenu();
  pickNext(null);
  await act(async () => button("Change…")!.click());
  expect(folderShown()).toBe("api");
  expect(writes).toEqual([]);
});

it("goes back to the project folder with « Project folder »", async () => {
  await inProject();
  await openMenu();
  pickNext("D:\\work\\lib");
  await act(async () => button("Change…")!.click());
  expect(button("Project folder")!.title).toContain("D:\\code\\api");
  await act(async () => button("Project folder")!.click());
  expect(folderShown()).toBe("api");
  expect(button("Project folder")).toBeUndefined();
  await act(async () => button("Claude")!.click());
  expect(placing()).toMatchObject({ options: { cwd: "D:\\code\\api" } });
});

it("lists the recent folders, and a click on one chooses it", async () => {
  await inProject();
  await openMenu();
  for (const path of ["D:\\work\\one", "D:\\work\\two"]) {
    pickNext(path);
    await act(async () => button("Change…")!.click());
  }
  // The folder in force is not listed again.
  expect(recentShown()).toEqual(["one"]);
  await act(async () => document.body.querySelector<HTMLElement>("[data-recent-folder]")!.click());
  expect(folderShown()).toBe("one");
  expect(recentShown()).toEqual(["two"]);
  expect(document.body.querySelector<HTMLElement>("[data-recent-folder]")!.title).toBe("D:\\work\\two");
});

it("saves the folder on the workspace, and the recent folders for the project", async () => {
  await inProject();
  await openMenu();
  pickNext("D:\\work\\lib");
  await act(async () => button("Change…")!.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(folderWrites).toEqual([{ id: "w1", folder: "D:\\work\\lib" }]);
  expect(writes).toEqual([{ key: "launch.folder.p1", value: { recent: ["D:\\work\\lib"] } }]);
});

it("shows the folder of the workspace, and the recent folders saved by an earlier session", async () => {
  savedFolder = { recent: ["D:\\work\\saved", "D:\\work\\older"] };
  await inProject("D:\\code\\api", "D:\\work\\saved");
  await openMenu();
  expect(folderShown()).toBe("saved");
  expect(recentShown()).toEqual(["older"]);
});

it("keeps a folder typed in the Options for the next launches, once the form is left", async () => {
  await inProject();
  await openMenu();
  await act(async () => button("Options")!.click());
  await type(field("Folder")!, "D:\\typed\\here");
  await act(async () => button("Launch options")!.click());
  expect(folderShown()).toBe("here");
  await act(async () => button("Claude")!.click());
  expect(placing()).toMatchObject({ options: { cwd: "D:\\typed\\here" } });
});

it("does not keep a folder cleared in the Options: the next launches stay where they were", async () => {
  await inProject();
  await openMenu();
  await act(async () => button("Options")!.click());
  await type(field("Folder")!, "");
  await act(async () => button("Launch options")!.click());
  expect(folderShown()).toBe("api");
  await act(async () => button("Claude")!.click());
  expect(placing()).toMatchObject({ options: { cwd: "D:\\code\\api" } });
});

it("follows a folder changed at the top of the menu after the Options were touched", async () => {
  await inProject();
  await openMenu();
  await act(async () => button("Options")!.click());
  await type(field("Title")!, "API");
  await act(async () => button("Launch options")!.click());
  pickNext("D:\\work\\lib");
  await act(async () => button("Change…")!.click());
  await act(async () => button("Claude")!.click());
  expect(placing()).toMatchObject({ options: { title: "API", cwd: "D:\\work\\lib" } });
});

it("opens on the first agent, not on Change…: Enter launches it rather than opening the picker", async () => {
  await inProject();
  // The agents are known, as they are once the app has started.
  agentsStore.setState({ agents, shells: ["powershell"], loaded: true });
  await openMenu();
  expect(document.activeElement?.textContent).toContain("Claude");
  expect(pickDirectory).not.toHaveBeenCalled();
});
