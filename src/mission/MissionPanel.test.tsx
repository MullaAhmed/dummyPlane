// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { cleanMission, launchMission } from "./launch";
import { NEW_MISSION, type Mission } from "./mission";
import { MissionPanel } from "./MissionPanel";
import { missionOf } from "./store";
import { focusNode } from "@/canvas/focusNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./launch", () => ({
  launchMission: vi.fn(() => Promise.resolve()),
  cleanMission: vi.fn(() => Promise.resolve({ removed: ["auth-batman", "auth"], kept: [] })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/canvas/focusNode", () => ({ focusNode: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeAll(() => mockIPC(() => undefined));
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});


// OpenUI loads on demand; its first load (zod, the parser) is slow under the full suite's load: warmed here, not in a test.
beforeAll(async () => {
  await Promise.all([import("@/openui/plainText"), import("@/openui/OpenUIView")]);
}, 60_000);
async function show(mission?: Partial<Mission>) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: mission ? { name: "Chef", mission: { ...NEW_MISSION, ...mission } } : { name: "Chef" },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MissionPanel nodeId="chef" />));
}

/** Types in a React-controlled field as a person would. */
function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
/** "Max active agents": the field its visible label names (no aria-label overrides it). */
function maxAgents(scope: ParentNode = host): HTMLInputElement | null {
  const label = [...scope.querySelectorAll("label")].find((l) => l.textContent === "Max active agents");
  return label ? document.getElementById(label.htmlFor) as HTMLInputElement | null : null;
}
/** The settings fold into one line of their values; a click unfolds them. */
const settingsToggle = () => host.querySelector<HTMLButtonElement>("[data-mission-body] button[aria-expanded]")!;
async function openSettings() {
  await act(async () => settingsToggle().click());
}

it("sets the mission's team size before the plan, and no global budget any more (spec §7.1)", async () => {
  await show();
  await openSettings();
  expect(host.querySelector('[aria-label="Global budget (minutes)"]')).toBeNull();
  expect(host.textContent).not.toContain("budget");
  await act(async () => type(maxAgents()!, "12"));
  expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ state: "redaction", maxAgents: 8 });
});

it("turns the model router on, and shows each sub-task's level and model (spec maj §3)", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20, level: "faible" }] });
  expect(host.textContent).toContain("low");
  expect(host.textContent).not.toContain("Haiku 5.5");
  await openSettings();
  await act(async () => (host.querySelector('[aria-label="Model router"]') as HTMLInputElement).click());
  expect(missionOf(nodesStore.getState().nodes.chef)?.router).toBe(true);
  expect(host.textContent).toContain("low · Haiku 5.5");
});

it("shows the plan and gives the go-ahead (spec §7.3)", async () => {
  await show({ state: "plan", name: "Auth", task: "Ajoute l'authentification", plan: [{ title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20 }] });
  expect(host.textContent).toContain("Fais le login");
  expect(host.textContent).toContain("20 agent minutes");
  expect(host.textContent).not.toContain("real time");
  await act(async () => button("Launch the mission").click());
  expect(launchMission).toHaveBeenCalledWith("chef");
});

it("shows the group a new agent will join (spec groupes spécialisés §3)", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Style", brief: "Fais le style", agent: "nouveau", budgetMin: 20, group: { id: "g1", name: "Interface" } }] });
  expect(host.textContent).toContain("nouveau → Interface · 20 min");
});

it("opens Night mission from its settings, and marks a night (spec mission de nuit §5.1)", async () => {
  await show();
  expect(host.textContent).toContain("Overnight run…");
  await act(async () => button("Overnight run…").click());
  expect(document.body.textContent).toContain("Prepare the night");
  await act(async () => root.unmount());
  host.remove();
  await show({ overnight: true });
  expect(host.querySelector("header")?.textContent).toContain("overnight");
});

it("keeps the night's choices in view, to change or call off until its team is formed (spec mission de nuit §5.1)", async () => {
  await show({ overnight: true, budgetMin: 480, maxAgents: 3, tickets: { kind: "linear", team: "ENG", label: "overnight" }, permission: "edits", autoLaunch: true });
  const night = host.querySelector("[data-night]")!;
  expect(night.textContent).toContain("Away8 h");
  expect(night.textContent).toContain("Agents3 at once");
  expect(night.textContent).toContain("TicketsLinear · team ENG · label overnight");
  expect(night.textContent).toContain("UnaskedEdit files");
  expect(night.textContent).toContain("StartAs soon as the plan is ready");
  // A night sets its own team size: the settings keep the router.
  expect(settingsToggle().textContent).toBe("Settingsno model router");
  await act(async () => button("Edit…").click());
  expect(document.body.textContent).toContain("Change the night");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Time away (hours)"]')!.value).toBe("8");
  await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click());
  await act(async () => button("Cancel the night").click());
  expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ overnight: undefined, budgetMin: undefined, tickets: undefined, permission: undefined });
  expect(host.querySelector("[data-night]")).toBeNull();
  expect(button("Overnight run…")).toBeDefined();
});

it("shows a running night read-only, with the time it still has", async () => {
  await show({ state: "en_cours", overnight: true, budgetMin: 480, startedAt: Date.now() - 60 * 60_000, tickets: { kind: "backlog" }, permission: "work", members: [] });
  const night = host.querySelector("[data-night]")!;
  expect(night.textContent).toContain("Away8 h · 420 min left");
  expect(night.textContent).toContain("UnaskedEdit files and run commands");
  expect(night.querySelector("button")).toBeNull();
  expect(host.querySelector("header")!.textContent).toContain("overnight · 420 min left");
});

it("shows the morning report of a night, what to check first (spec mission de nuit §6.2)", async () => {
  await show({
    state: "terminee", overnight: true, budgetMin: 480, startedAt: 0, endedAt: 60 * 60_000, summary: "Bilan", handChecks: ["Relire la migration"],
    queue: [{ title: "Docs", brief: "b", budgetMin: 10 }],
    members: [
      { nodeId: "a", name: "Batman", task: "Login", budgetMin: 20, linked: false, branch: "dummyplane/nuit-batman", worktree: "w", sentAt: 0, merged: true, report: { summary: "Login fait", status: "termine", at: 10 * 60_000 } },
      { nodeId: "b", name: "Aquaman", task: "API", budgetMin: 20, linked: false, branch: "dummyplane/nuit-aquaman", worktree: "w", sentAt: 0, report: { summary: "Coincé", status: "bloque", at: 5 * 60_000 } },
      { nodeId: "c", name: "Cyborg", task: "Tests", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 0 },
    ],
  });
  const report = host.querySelector("[data-morning]")!.textContent;
  expect(report).toContain("Morning report");
  expect(report).toContain("60 / 480 min");
  expect(report).toContain("To check by hand (1)");
  expect(report).toContain("Relire la migration");
  expect(report).toContain("Done (1)");
  expect(report).toContain("dummyplane/nuit-batman");
  expect(report).toContain("Morning report60 / 480 minTo check by hand (1)Relire la migrationDone (1)Login · mergedBatman · 10 / 20 minLogin faitdummyplane/nuit-batmanFailed or blocked (1)APIblockedAquaman · 5 / 20 minCoincédummyplane/nuit-aquamanNot finished (1)TestsCyborg · 60 / 20 minbLeft in the queue: Docs");
  expect(report).toContain("blocked");
  expect(report).toContain("Not finished (1)");
  expect(report).toContain("Left in the queue: Docs");
});

it("shows it in English", async () => {
  await show({ state: "terminee", overnight: true, budgetMin: 60, startedAt: 0, endedAt: 60_000, summary: "x", members: [{ nodeId: "a", name: "Batman", task: "Login", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 0, report: { summary: "ok", status: "echec", at: 1 } }] });
  const report = host.querySelector("[data-morning]")!.textContent;
  expect(report).toContain("Morning report");
  expect(report).toContain("Failed or blocked (1)");
});

it("shows no morning report outside a night", async () => {
  await show({ state: "terminee", summary: "x", members: [] });
  expect(host.querySelector("[data-morning]")).toBeNull();
});

it("shows the tasks waiting in the queue (spec mission de nuit §4)", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20 }], queue: [{ title: "API", brief: "b", budgetMin: 30 }, { title: "Docs", brief: "b", budgetMin: 10 }] });
  expect(host.querySelector("[data-queue]")?.textContent).toContain("Waiting (2)");
  expect(host.querySelector("[data-queue]")?.textContent).toContain("API");
  expect(host.querySelector("[data-queue]")?.textContent).toContain("Docs");
});

it("shows no runaway time for a mission ended before end times were kept", async () => {
  await show({
    state: "terminee",
    name: "Auth",
    members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0 }],
  });
  expect(host.querySelector('[data-member="Batman"]')?.textContent).not.toContain("/ 20 min");
});

it("shows the team's reports and the summary, and cleans the mission (spec §7.7)", async () => {
  await show({
    state: "terminee",
    name: "Auth",
    branch: "dummyplane/auth",
    summary: "Tout est fait.",
    members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 20, linked: true, branch: "dummyplane/auth-batman", worktree: "C:/w", sentAt: 0, report: { summary: "ok", status: "termine", at: 6 * 60_000 }, merged: true }],
  });
  expect(host.querySelector('[data-member="Batman"]')?.textContent).toContain("done · merged");
  expect(host.querySelector('[data-member="Batman"]')?.textContent).toContain("6 / 20 min");
  expect(host.textContent).toContain("Tout est fait.");
  await act(async () => button("Clean up the mission").click());
  expect(cleanMission).toHaveBeenCalledWith("chef");
  expect(toast.success).toHaveBeenCalledWith("Worktrees removed: auth-batman, auth");
});

it("shows the sub-tasks an agent finished before taking another (backlog H3)", async () => {
  await show({
    state: "en_cours",
    name: "Auth",
    members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0, done: ["API", "Docs"] }],
  });
  const finished = host.querySelector<HTMLElement>('[data-member="Batman"] [data-finished]')!;
  expect(finished.textContent).toContain("2");
  // In the app's hint, reached by the keyboard too: never a native title beside the "diff" button's hint.
  expect(finished.hasAttribute("title")).toBe(false);
  await act(async () => finished.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Already finished: API, Docs");
});

it("shows the mission panel in English", async () => {
  await show({ state: "plan", name: "Auth", router: true, plan: [{ title: "Login", brief: "Do the login", agent: "Batman", budgetMin: 20, level: "faible" }] });
  // The panel is named for screen readers; its status line says where the mission stands, then its name.
  expect(host.querySelector("[data-mission]")!.getAttribute("aria-label")).toBe("Mission · Auth");
  expect(host.querySelector("header")!.textContent).toContain("Plan proposed · waiting for the go-ahead · Auth");
  expect(settingsToggle().textContent).toBe("Settingsup to 4 agents at once · model router");
  await openSettings();
  expect(host.textContent).toContain("Max active agents");
  expect(host.textContent).toContain("low · Haiku 5.5");
  expect(host.textContent).toContain("0 agents linked");
  expect(button("Launch the mission")).toBeDefined();
});

it("leads with the mission's status line: its dot, its state, and how to start it", async () => {
  await show();
  const header = host.querySelector("header")!;
  expect(header.textContent).toContain("Waiting for a task · write it in the terminal above");
  expect(header.querySelector("[data-status]")!.getAttribute("data-status")).toBe("idle");
  // The other way to start, at the end of the line, until a night is set.
  expect(header.contains(button("Overnight run…"))).toBe(true);
  await act(async () => root.unmount());
  host.remove();
  await show({ state: "plan", plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 20 }] });
  // The plan waits for the user's go-ahead: the one state that asks for them.
  expect(host.querySelector("header [data-status]")!.getAttribute("data-status")).toBe("waiting");
  await act(async () => root.unmount());
  host.remove();
  await show({ state: "en_cours", error: "git failed", members: [] });
  expect(host.querySelector("header [data-status]")!.getAttribute("data-status")).toBe("error");
  // Its words agree with the red dot: not "In progress" beside it (audit P2 #50).
  expect(host.querySelector("header")!.textContent).toContain("Stopped on an error");
  expect(host.querySelector("header")!.textContent).not.toContain("In progress");
  expect(host.querySelector("header")!.textContent).not.toContain("Overnight run…");
});

it("folds its settings into one line of their values, so the terminal keeps its height", async () => {
  await show();
  expect(settingsToggle().getAttribute("aria-expanded")).toBe("false");
  expect(settingsToggle().textContent).toBe("Settingsup to 4 agents at once");
  expect(maxAgents()).toBeNull();
  await openSettings();
  expect(settingsToggle().getAttribute("aria-expanded")).toBe("true");
  const grid = document.getElementById(settingsToggle().getAttribute("aria-controls")!)!;
  expect(maxAgents(grid)).not.toBeNull();
  await act(async () => type(maxAgents(grid)!, "6"));
  expect(settingsToggle().textContent).toBe("Settingsup to 6 agents at once");
});

it("keeps the keys typed in the mission from the canvas: Backspace there would delete the node", async () => {
  await show();
  await openSettings();
  const seen = vi.fn();
  host.addEventListener("keydown", seen);
  const targets = [maxAgents()!, settingsToggle(), host.querySelector<HTMLElement>("[data-link-toggle]")!];
  for (const target of targets) {
    await act(async () => void target.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })));
  }
  expect(seen).not.toHaveBeenCalled();
});

it("shows the team and the cleanup in English", async () => {
  await show({
    state: "terminee",
    name: "Auth",
    summary: "All done.",
    members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0, report: { summary: "ok", status: "termine", at: 6 * 60_000 }, merged: true }],
  });
  expect(host.querySelector('[data-member="Batman"]')?.textContent).toContain("done · merged");
  expect(host.querySelector('[data-member="Batman"]')?.textContent).toContain("6 / 20 min");
  await act(async () => button("Clean up the mission").click());
  expect(toast.success).toHaveBeenCalledWith("Worktrees removed: auth-batman, auth");
});

it("keeps the go-ahead and cleanup buttons outside the scrolling body", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20 }] });
  const body = host.querySelector("[data-mission-body]")!;
  expect(body.className).toContain("overflow-y-auto");
  expect(body.className).toContain("min-h-0");
  const launch = button("Launch the mission");
  expect(body.contains(launch)).toBe(false);
  expect(launch.closest("[data-mission-actions]")?.className).toContain("shrink-0");
  expect(host.querySelector("[data-mission]")?.className).not.toContain("overflow-y-auto");
});

it("keeps the cleanup button outside the scrolling body once the mission is over", async () => {
  await show({ state: "terminee", name: "Auth", summary: "Fini.", members: [] });
  const body = host.querySelector("[data-mission-body]")!;
  expect(body.textContent).toContain("Fini.");
  expect(body.contains(button("Clean up the mission"))).toBe(false);
});

it("names the team size by its visible label, the long phrasing in its hint (WCAG 2.5.3, audit P2 #18)", async () => {
  await show();
  await openSettings();
  const field = maxAgents()!;
  expect(field.hasAttribute("aria-label")).toBe(false);
  expect(field.labels?.[0]?.textContent).toBe("Max active agents");
});

it("gives an agent's report summary in the app's hint, reached by the keyboard too (audit P2 #17)", async () => {
  await show({
    state: "en_cours",
    name: "Auth",
    members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0, report: { summary: "Blocked on the API key", status: "bloque", at: 0 } }],
  });
  const word = host.querySelector<HTMLElement>('[data-member="Batman"] [data-report]')!;
  expect(word.textContent).toBe("blocked");
  expect(word.hasAttribute("title")).toBe(false);
  expect(word.tabIndex).toBe(0);
  await act(async () => word.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Blocked on the API key");
});

it("draws the fleet's summary: Markdown as Markdown, OpenUI Lang through the library", async () => {
  await show({ state: "terminee", summary: "All **done**.", members: [] });
  expect(host.querySelector("strong")?.textContent).toBe("done");
  act(() => root.unmount());
  host.remove();
  nodesStore.setState({ nodes: {} });
  const ui = 'root = Stack([Table(["Task", "State"], [["Login", "done"]])])';
  await show({ state: "terminee", summary: "| Task | State |", summaryUi: ui, members: [] });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect([...host.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Login", "done"]);
  expect(host.textContent).not.toContain("root =");
});

it("draws each agent's summary in the morning report, whole, in a bounded scroller", async () => {
  await show({
    state: "terminee", overnight: true, budgetMin: 480, startedAt: 0, endedAt: 60 * 60_000, summary: "Night done",
    members: [{ nodeId: "a", name: "Batman", task: "Login", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 0, merged: true, report: { summary: "Login **done**\n- tests green\n- docs", status: "termine", at: 10 * 60_000 } }],
  });
  const summary = host.querySelector<HTMLElement>("[data-morning-summary]")!;
  expect(summary.className).toContain("overflow-y-auto");
  expect(summary.querySelector("strong")?.textContent).toBe("done");
  expect(summary.querySelectorAll("li")).toHaveLength(2);
});

it("says who runs a mission its Manager runs, the Manager and the board a click away (spec babysitter Fleet)", async () => {
  await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "manager", fleet: "chef" } });
  await nodesStore.getState().create("board", { workspaceId: "w1", kind: "kanban", payload: { columns: [], cards: {} } });
  await show({ state: "en_cours", manager: "boss", board: "board", members: [{ nodeId: "robin", name: "Robin", task: "Login", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 1 }] });
  const line = host.querySelector("[data-run-by]")!;
  expect(line.textContent).toContain("Run by Manager, on its board");
  // Who does what: each agent's row names its task.
  expect(host.querySelector('[data-member="Robin"]')?.textContent).toContain("Login");
  await act(async () => button("Manager").click());
  expect(focusNode).toHaveBeenCalledWith("boss");
  await act(async () => button("Board").click());
  expect(focusNode).toHaveBeenLastCalledWith("board");
});

it("says nothing of a Manager for a mission run the old way", async () => {
  await show({ state: "en_cours", frameId: "f1", members: [] });
  expect(host.querySelector("[data-run-by]")).toBeNull();
});
