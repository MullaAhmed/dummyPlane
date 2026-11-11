import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onAction, sendNotification, type ActionPerformed } from "@tauri-apps/plugin-notification";
import { nativeNotificationsStore } from "@/app/nativeNotifications";
import { goToAgent } from "@/commands/goToRun";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import { messages } from "@/i18n";
import { shellMessages } from "./messages";
import { installWaitingAlerts } from "./waitingAlert";

const win = vi.hoisted(() => ({
  isFocused: vi.fn(() => Promise.resolve(false)),
  unminimize: vi.fn(() => Promise.resolve()),
  setFocus: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/plugin-notification", () => ({ onAction: vi.fn(), sendNotification: vi.fn() }));
vi.mock("@/commands/goToRun", () => ({ goToAgent: vi.fn() }));

const apply = (nodeId: string, activity: "waiting" | "working") => agentActivityStore.getState().apply({ nodeId, activity, since: 1 });
const settled = () => new Promise((resolve) => setTimeout(resolve));
const unregister = vi.fn();
let uninstall: () => void;

/** What the plugin reports for a click on the notification of `nodeId`: its question, or its finish. */
async function click(nodeId: unknown, actionId = "tap", finished = false) {
  const handler = vi.mocked(onAction).mock.calls[0][0];
  handler({ actionId, inputValue: null, notification: { extra: finished ? { nodeId, finished } : { nodeId } } } as unknown as ActionPerformed);
  await settled();
}

beforeEach(() => {
  vi.clearAllMocks();
  win.isFocused.mockResolvedValue(false);
  nativeNotificationsStore.setState({ enabled: true });
  vi.mocked(onAction).mockResolvedValue({ unregister } as never);
  projectsStore.setState({ view: "project" });
  workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }] });
  nodesStore.setState({
    nodes: {
      batman: { workspaceId: "w1", kind: "terminal", payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } },
    },
  });
  terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
  agentActivityStore.setState({ activities: {} });
  uninstall = installWaitingAlerts();
});

afterEach(() => {
  uninstall();
});

describe("the Windows notification (spec notification §8)", () => {
  it("tells when an agent starts waiting and the window is not focused", async () => {
    apply("batman", "waiting");
    await settled();
    expect(sendNotification).toHaveBeenCalledExactlyOnceWith({ title: "Batman · Waiting", body: "Has a question for you", extra: { nodeId: "batman" } });
  });

  it("writes the finish's format: the agent and its state in the title, one line in the body, no app name (Windows shows it)", async () => {
    apply("batman", "waiting");
    await settled();
    const { title, body } = vi.mocked(sendNotification).mock.calls[0][0] as { title: string; body: string };
    // The finish's notification (`./finishAlert`) builds its title with the same function: "Batman · Done".
    expect(title).toBe(messages(shellMessages).notification.title("Batman", messages(shellMessages).finishAlert.states.done).replace("Done", "Waiting"));
    expect(readSource("shell/finishAlert.ts")).toContain("notification.title(agent.name, t.states[state])");
    expect(title).not.toContain("dummyPlane");
    expect(body).not.toContain("Batman");
  });

  it("keeps the preview in the window: a toast can show on the lock screen (spec notification §7)", async () => {
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 1, message: "Run rm on C:/secret?" });
    await settled();
    expect(sendNotification).toHaveBeenCalledExactlyOnceWith({ title: "Batman · Waiting", body: "Has a question for you", extra: { nodeId: "batman" } });
  });

  it("stays silent when the window is focused: the notice is on screen", async () => {
    win.isFocused.mockResolvedValue(true);
    apply("batman", "waiting");
    await settled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("stays silent when the setting is off, and a click still comes back (spec notification §11)", async () => {
    nativeNotificationsStore.setState({ enabled: false });
    apply("batman", "waiting");
    await settled();
    expect(sendNotification).not.toHaveBeenCalled();
    await click("batman");
    expect(goToAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "batman" }));
  });

  it("tells once per wait, not for every change around it", async () => {
    apply("batman", "working");
    apply("batman", "waiting");
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 2 });
    await settled();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("ignores an agent that is not waiting in the open project", async () => {
    apply("closed", "waiting");
    await settled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not replay the agents already waiting when the interface reloads", async () => {
    uninstall();
    agentActivityStore.getState().load([{ nodeId: "batman", activity: "waiting", since: 1 }]);
    uninstall = installWaitingAlerts();
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 1 });
    await settled();
    expect(sendNotification).not.toHaveBeenCalled();
    const boot = readSource("app/boot.ts");
    expect(boot.indexOf("installWaitingAlerts()")).toBeGreaterThan(boot.indexOf("agentActivityStore.getState().load"));
  });

  it("never lets a failure reach the app: the notice still shows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    win.isFocused.mockRejectedValue(new Error("no window"));
    apply("batman", "waiting");
    await settled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops when uninstalled", async () => {
    uninstall();
    apply("batman", "waiting");
    await settled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
  });
});

describe("a click on the Windows notification (spec notification §8)", () => {
  it("brings the window back and goes to the agent", async () => {
    apply("batman", "waiting");
    await click("batman");
    expect(win.unminimize).toHaveBeenCalled();
    expect(win.setFocus).toHaveBeenCalled();
    expect(goToAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "batman" }));
  });

  it("only brings the window back when the agent no longer waits", async () => {
    apply("batman", "working");
    await click("batman");
    expect(win.setFocus).toHaveBeenCalled();
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("only brings the window back at home: no canvas to arrive on", async () => {
    projectsStore.setState({ view: "home" });
    apply("batman", "waiting");
    await click("batman");
    expect(win.setFocus).toHaveBeenCalled();
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("arrives on an agent that finished, though it does not wait (./finishAlert)", async () => {
    apply("batman", "working");
    await click("batman", "tap", true);
    expect(win.setFocus).toHaveBeenCalled();
    expect(goToAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "batman", kind: "terminal", workspaceId: "w1" }));
  });

  it("only brings the window back when the agent that finished is gone", async () => {
    await click("gone", "tap", true);
    expect(win.setFocus).toHaveBeenCalled();
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("copes with a click that names no agent", async () => {
    apply("batman", "waiting");
    await click(undefined);
    expect(win.setFocus).toHaveBeenCalled();
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("ignores anything but a click on the notification itself", async () => {
    apply("batman", "waiting");
    await click("batman", "dismiss");
    expect(win.setFocus).not.toHaveBeenCalled();
  });

  it("logs a window that cannot come back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    win.setFocus.mockRejectedValueOnce(new Error("no window"));
    await click("batman");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the app starting when the click cannot be listened to", async () => {
    uninstall();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(onAction).mockRejectedValue(new Error("no plugin"));
    uninstall = installWaitingAlerts();
    await settled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

it("is allowed to bring the window back", () => {
  const capabilities = readSource("../src-tauri/capabilities/default.json");
  for (const permission of ["notification:default", "core:window:allow-set-focus", "core:window:allow-unminimize"]) expect(capabilities).toContain(permission);
});
