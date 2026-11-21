import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onAction, sendNotification, type ActionPerformed } from "@tauri-apps/plugin-notification";
import { nativeNotificationsStore } from "@/app/nativeNotifications";
import { goToAgent } from "@/commands/goToRun";
import { agentActivityStore } from "@/store/agentActivity";
import { fleetDecisionsStore, type FleetDecision } from "@/store/fleetDecisions";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import { messages } from "@/i18n";
import { onRecord } from "@/notifications/capture";
import { notificationsStore, type NotificationEntry } from "@/notifications/store";
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
// The notification panel, as boot connects it: a question is kept there, and read once its agent no longer waits.
let stopRecording: () => void = () => undefined;
const questions = () => notificationsStore.getState().entries.map(({ type, kind, title, description, read, plane }) => ({ type, kind, title, description, read, nodeId: plane.nodeId }));

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
  notificationsStore.setState({ entries: [] });
  stopRecording = onRecord((n) => notificationsStore.getState().add(n));
  uninstall = installWaitingAlerts();
});

afterEach(() => {
  uninstall();
  stopRecording();
});

describe("the notification panel", () => {
  const asked = { type: "question", kind: "info", title: "Batman · Waiting", description: "Has a question for you", nodeId: "batman" };

  it("keeps a question as it is asked, unread, with the Windows notification's words and the agent as its plane", async () => {
    apply("batman", "waiting");
    await settled();
    expect(questions()).toEqual([{ ...asked, read: false }]);
  });

  it("keeps it whatever the window and the Windows notifications setting: focused, with the setting off", async () => {
    win.isFocused.mockResolvedValue(true);
    nativeNotificationsStore.setState({ enabled: false });
    apply("batman", "waiting");
    await settled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(questions()).toEqual([{ ...asked, read: false }]);
  });

  it("keeps one per wait, and reads it once the agent no longer waits", async () => {
    apply("batman", "waiting");
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 2 });
    expect(questions()).toHaveLength(1);
    apply("batman", "working");
    expect(questions()).toEqual([{ ...asked, read: true }]);
    // Asked again: news again.
    apply("batman", "waiting");
    expect(questions().map((q) => q.read)).toEqual([false, true]);
  });

  it("reads it when the agent's process ends while it waits: it leaves the list", async () => {
    apply("batman", "waiting");
    agentActivityStore.getState().remove("batman");
    expect(questions()).toEqual([{ ...asked, read: true }]);
  });

  it("keeps nothing for an agent not waiting in the open project", async () => {
    apply("closed", "waiting");
    await settled();
    expect(questions()).toEqual([]);
  });

  it("reads a question kept from before whose agent no longer waits, and leaves one whose agent still does", async () => {
    uninstall();
    const kept = (id: string, nodeId: string): NotificationEntry => ({
      id,
      at: 1,
      type: "question",
      kind: "info",
      title: `${nodeId} · Waiting`,
      read: false,
      plane: { projectId: "p1", workspaceId: "w1", nodeId, projectName: null, workspaceName: null },
    });
    notificationsStore.setState({ entries: [kept("a", "batman"), kept("b", "robin")] });
    agentActivityStore.getState().load([{ nodeId: "batman", activity: "waiting", since: 1 }]);
    uninstall = installWaitingAlerts();
    expect(notificationsStore.getState().entries.map((e) => [e.plane.nodeId, e.read])).toEqual([
      ["batman", false],
      ["robin", true],
    ]);
  });
});

describe("the Windows notification", () => {
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

  it("keeps the preview in the window: a toast can show on the lock screen", async () => {
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

  it("stays silent when the setting is off, and a click still comes back", async () => {
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

describe("a click on the Windows notification", () => {
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

describe("a Fleet that waits on the user's decision", () => {
  const plan: FleetDecision = { kind: "plan", since: 5, message: "Checkout coupons · 4 sub-tasks" };
  const decide = (decision?: FleetDecision) => fleetDecisionsStore.setState({ decisions: decision ? { atlas: decision } : {} });

  beforeEach(() => {
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, atlas: { workspaceId: "w1", kind: "fleet", payload: { name: "Atlas" } } } }));
    terminalStatusStore.setState((s) => ({ statuses: { ...s.statuses, atlas: { state: "running" } } }));
    // Its terminal rests at its prompt: its agent waits on nothing.
    agentActivityStore.getState().apply({ nodeId: "atlas", activity: "idle", since: 1 });
  });

  afterEach(() => decide());

  it("is a question in the panel and a Windows notification, in fixed words, read once the decision is taken", async () => {
    decide(plan);
    await settled();
    expect(questions()).toEqual([{ type: "question", kind: "info", title: "Atlas · Waiting", description: "Has a plan for your go-ahead", read: false, nodeId: "atlas" }]);
    expect(sendNotification).toHaveBeenCalledExactlyOnceWith({ title: "Atlas · Waiting", body: "Has a plan for your go-ahead", extra: { nodeId: "atlas" } });
    // Its terminal goes on meanwhile: no news, the same wait.
    agentActivityStore.getState().apply({ nodeId: "atlas", activity: "working", since: 6 });
    expect(questions()).toHaveLength(1);
    decide();
    expect(questions().map((q) => q.read)).toEqual([true]);
  });

  it("says what Land and Clean up ask, never the branch nor the folder: a notification can show on the lock screen", async () => {
    decide({ kind: "land", since: 7, message: "Land the mission on main?" });
    decide({ kind: "leftovers", since: 8, message: "Clean up the leftovers of past missions?" });
    await settled();
    expect(vi.mocked(sendNotification).mock.calls.map(([n]) => (n as { body: string }).body)).toEqual(["Asks to land its mission"]);
    decide();
    decide({ kind: "leftovers", since: 9 });
    await settled();
    expect(vi.mocked(sendNotification).mock.calls.map(([n]) => (n as { body: string }).body)).toEqual(["Asks to land its mission", "Asks to clean up leftovers"]);
  });

  it("is not told again when it was found standing, as its Fleet was first read: the notice and the counts still show it", async () => {
    decide({ ...plan, standing: true });
    await settled();
    expect(questions()).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
