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

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./launch", () => ({
  launchMission: vi.fn(() => Promise.resolve()),
  cleanMission: vi.fn(() => Promise.resolve({ removed: ["auth-isis", "auth"], kept: [] })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeAll(() => mockIPC(() => undefined));
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function show(mission?: Partial<Mission>) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "orchestrator",
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
/** The settings fold into one line of their values; a click unfolds them. */
const settingsToggle = () => host.querySelector<HTMLButtonElement>("[data-mission-body] button[aria-expanded]")!;
async function openSettings() {
  await act(async () => settingsToggle().click());
}

it("sets the mission's global budget and team size before the plan (spec §7.1)", async () => {
  await show();
  await openSettings();
  await act(async () => type(host.querySelector('[aria-label="Global budget (minutes)"]')!, "90"));
  await act(async () => type(host.querySelector(`[aria-label="Maximum number of agents working at once"]`)!, "12"));
  expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ state: "redaction", budgetMin: 90, maxAgents: 8 });
});

it("turns the model router on, and shows each sub-task's level and model (spec maj §3)", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Login", brief: "Fais le login", agent: "Isis", budgetMin: 20, level: "faible" }] });
  expect(host.textContent).toContain("low");
  expect(host.textContent).not.toContain("Haiku 5.5");
  await openSettings();
  await act(async () => (host.querySelector('[aria-label="Model router"]') as HTMLInputElement).click());
  expect(missionOf(nodesStore.getState().nodes.chef)?.router).toBe(true);
  expect(host.textContent).toContain("low · Haiku 5.5");
});

it("shows the plan and gives the go-ahead (spec §7.3)", async () => {
  await show({ state: "plan", name: "Auth", task: "Ajoute l'authentification", budgetMin: 60, plan: [{ title: "Login", brief: "Fais le login", agent: "Isis", budgetMin: 20 }] });
  expect(host.textContent).toContain("Fais le login");
  expect(host.textContent).toContain("20 agent minutes · 60 min of real time");
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

it("shows the morning report of a night, what to check first (spec mission de nuit §6.2)", async () => {
  await show({
    state: "terminee", overnight: true, budgetMin: 480, startedAt: 0, endedAt: 60 * 60_000, summary: "Bilan", handChecks: ["Relire la migration"],
    queue: [{ title: "Docs", brief: "b", budgetMin: 10 }],
    members: [
      { nodeId: "a", name: "Isis", task: "Login", budgetMin: 20, linked: false, branch: "dummyplane/nuit-isis", worktree: "w", sentAt: 0, merged: true, report: { summary: "Login fait", status: "termine", at: 10 * 60_000 } },
      { nodeId: "b", name: "Horus", task: "API", budgetMin: 20, linked: false, branch: "dummyplane/nuit-horus", worktree: "w", sentAt: 0, report: { summary: "Coincé", status: "bloque", at: 5 * 60_000 } },
      { nodeId: "c", name: "Thoth", task: "Tests", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 0 },
    ],
  });
  const report = host.querySelector("[data-morning]")!.textContent;
  expect(report).toContain("Morning report");
  expect(report).toContain("60 / 480 min");
  expect(report).toContain("To check by hand (1)");
  expect(report).toContain("Relire la migration");
  expect(report).toContain("Done (1)");
  expect(report).toContain("dummyplane/nuit-isis");
  expect(report).toContain("Morning report60 / 480 minTo check by hand (1)Relire la migrationDone (1)Login · mergedIsis · 10 / 20 minLogin faitdummyplane/nuit-isisFailed or blocked (1)APIblockedHorus · 5 / 20 minCoincédummyplane/nuit-horusNot finished (1)TestsThoth · 60 / 20 minbLeft in the queue: Docs");
  expect(report).toContain("blocked");
  expect(report).toContain("Not finished (1)");
  expect(report).toContain("Left in the queue: Docs");
});

it("shows it in English", async () => {
  await show({ state: "terminee", overnight: true, budgetMin: 60, startedAt: 0, endedAt: 60_000, summary: "x", members: [{ nodeId: "a", name: "Isis", task: "Login", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 0, report: { summary: "ok", status: "echec", at: 1 } }] });
  const report = host.querySelector("[data-morning]")!.textContent;
  expect(report).toContain("Morning report");
  expect(report).toContain("Failed or blocked (1)");
});

it("shows no morning report outside a night", async () => {
  await show({ state: "terminee", summary: "x", members: [] });
  expect(host.querySelector("[data-morning]")).toBeNull();
});

it("shows the tasks waiting in the queue (spec mission de nuit §4)", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Login", brief: "Fais le login", agent: "Isis", budgetMin: 20 }], queue: [{ title: "API", brief: "b", budgetMin: 30 }, { title: "Docs", brief: "b", budgetMin: 10 }] });
  expect(host.querySelector("[data-queue]")?.textContent).toContain("Waiting (2)");
  expect(host.querySelector("[data-queue]")?.textContent).toContain("API");
  expect(host.querySelector("[data-queue]")?.textContent).toContain("Docs");
});

it("shows no runaway time for a mission ended before end times were kept", async () => {
  await show({
    state: "terminee",
    name: "Auth",
    members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0 }],
  });
  expect(host.querySelector('[data-member="Isis"]')?.textContent).not.toContain("/ 20 min");
});

it("shows the team's reports and the summary, and cleans the mission (spec §7.7)", async () => {
  await show({
    state: "terminee",
    name: "Auth",
    branch: "dummyplane/auth",
    summary: "Tout est fait.",
    members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 20, linked: true, branch: "dummyplane/auth-isis", worktree: "C:/w", sentAt: 0, report: { summary: "ok", status: "termine", at: 6 * 60_000 }, merged: true }],
  });
  expect(host.querySelector('[data-member="Isis"]')?.textContent).toContain("done · merged");
  expect(host.querySelector('[data-member="Isis"]')?.textContent).toContain("6 / 20 min");
  expect(host.textContent).toContain("Tout est fait.");
  await act(async () => button("Clean up the mission").click());
  expect(cleanMission).toHaveBeenCalledWith("chef");
  expect(toast.success).toHaveBeenCalledWith("Worktrees removed: auth-isis, auth");
});

it("shows the sub-tasks an agent finished before taking another (backlog H3)", async () => {
  await show({
    state: "en_cours",
    name: "Auth",
    members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0, done: ["API", "Docs"] }],
  });
  const finished = host.querySelector('[data-member="Isis"] [data-finished]');
  expect(finished?.textContent).toContain("2");
  expect(finished?.getAttribute("title")).toBe("Already finished: API, Docs");
});

it("shows the mission panel in English", async () => {
  await show({ state: "plan", name: "Auth", router: true, budgetMin: 60, plan: [{ title: "Login", brief: "Do the login", agent: "Isis", budgetMin: 20, level: "faible" }] });
  // The panel is named for screen readers; its status line says where the mission stands, then its name.
  expect(host.querySelector("[data-mission]")!.getAttribute("aria-label")).toBe("Mission · Auth");
  expect(host.querySelector("header")!.textContent).toContain("Plan proposed · waiting for the go-ahead · Auth");
  expect(settingsToggle().textContent).toBe("Settings60 min budget · up to 4 agents · model router");
  await openSettings();
  expect(host.textContent).toContain("Global budget");
  expect(host.textContent).toContain("low · Haiku 5.5");
  expect(host.textContent).toContain("0 Claude agents linked");
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
  await show({ state: "plan", plan: [{ title: "Login", brief: "b", agent: "Isis", budgetMin: 20 }] });
  // The plan waits for the user's go-ahead: the one state that asks for them.
  expect(host.querySelector("header [data-status]")!.getAttribute("data-status")).toBe("waiting");
  await act(async () => root.unmount());
  host.remove();
  await show({ state: "en_cours", error: "git failed", members: [] });
  expect(host.querySelector("header [data-status]")!.getAttribute("data-status")).toBe("error");
  expect(host.querySelector("header")!.textContent).not.toContain("Overnight run…");
});

it("folds its settings into one line of their values, so the terminal keeps its height", async () => {
  await show();
  expect(settingsToggle().getAttribute("aria-expanded")).toBe("false");
  expect(settingsToggle().textContent).toBe("Settingsno budget · up to 4 agents");
  expect(host.querySelector('[aria-label="Global budget (minutes)"]')).toBeNull();
  await openSettings();
  expect(settingsToggle().getAttribute("aria-expanded")).toBe("true");
  const grid = document.getElementById(settingsToggle().getAttribute("aria-controls")!)!;
  expect(grid.querySelector('[aria-label="Global budget (minutes)"]')).not.toBeNull();
  expect(grid.querySelector('[aria-label="Maximum number of agents working at once"]')).not.toBeNull();
  await act(async () => type(grid.querySelector('[aria-label="Global budget (minutes)"]')!, "90"));
  expect(settingsToggle().textContent).toBe("Settings90 min budget · up to 4 agents");
});

it("keeps the keys typed in the mission from the canvas: Backspace there would delete the node", async () => {
  await show();
  await openSettings();
  const seen = vi.fn();
  host.addEventListener("keydown", seen);
  const targets = [host.querySelector<HTMLElement>('[aria-label="Global budget (minutes)"]')!, settingsToggle(), host.querySelector<HTMLElement>("[data-link-toggle]")!];
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
    members: [{ nodeId: "isis", name: "Isis", task: "Login", budgetMin: 20, linked: true, branch: "b", worktree: "C:/w", sentAt: 0, report: { summary: "ok", status: "termine", at: 6 * 60_000 }, merged: true }],
  });
  expect(host.querySelector('[data-member="Isis"]')?.textContent).toContain("done · merged");
  expect(host.querySelector('[data-member="Isis"]')?.textContent).toContain("6 / 20 min");
  await act(async () => button("Clean up the mission").click());
  expect(toast.success).toHaveBeenCalledWith("Worktrees removed: auth-isis, auth");
});

it("keeps the go-ahead and cleanup buttons outside the scrolling body", async () => {
  await show({ state: "plan", name: "Auth", plan: [{ title: "Login", brief: "Fais le login", agent: "Isis", budgetMin: 20 }] });
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
