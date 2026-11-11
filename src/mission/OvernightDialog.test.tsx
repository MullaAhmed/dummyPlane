// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore, sessionOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { usageStore } from "@/usage/usageStore";
import { notify } from "./events";
import { NEW_MISSION, type Mission } from "./mission";
import { OvernightDialog } from "./OvernightDialog";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(() => Promise.resolve()), focusTerminal: vi.fn() }));
vi.mock("@/canvas/arrive", () => ({ showNode: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "", role: "orchestrator" as const, claudeSessionId: "s1" };

async function show(mission: Partial<Mission> = {}, withSession?: Partial<typeof session> & { linear?: true }) {
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", ...(withSession ? { session: { ...session, ...withSession } } : {}), mission: { ...NEW_MISSION, ...mission } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<OvernightDialog nodeId="chef" open onOpenChange={() => undefined} />));
}

function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const field = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
/** A Radix option is a button: its state is in `aria-checked`. */
const isChecked = (label: string) => field(label).getAttribute("aria-checked") === "true";
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
const missionNow = () => missionOf(nodesStore.getState().nodes.chef)!;
const text = () => document.body.textContent ?? "";
const prepare = () => act(async () => button("Prepare the night").click());

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  terminalStatusStore.getState().set("chef", { state: "stopped" } as never);
});

it("asks for the time away, the agents and the source, and tells when the night ends; Kanban is not offered", async () => {
  await show({ maxAgents: 3 });
  expect(field("Time away (hours)").value).toBe("8");
  expect(field("Number of agents working at once").value).toBe("3");
  for (const source of ["GitHub issues", "BACKLOG.md", "Linear"]) expect(text()).toContain(source);
  expect(text()).not.toContain("Kanban");
  expect(document.querySelector("[data-ends]")?.textContent).toMatch(/^Ends around .+ · the last 48 min are kept to merge and wrap up$/);
});

it("sets up the mission and gives the fleet its orders", async () => {
  await show();
  await act(async () => type(field("Time away (hours)"), "6.5"));
  await act(async () => type(field("Number of agents working at once"), "5"));
  await prepare();
  expect(missionNow()).toMatchObject({ overnight: true, budgetMin: 390, maxAgents: 5, tickets: { kind: "github", label: "overnight" } });
  expect(vi.mocked(notify).mock.calls[0][1]).toBe(
    "Overnight run: the user is away for 390 min. Call tickets, keep what fits in that time with 5 agents, put the rest in the queue with add_tasks, then call propose_plan: the plan waits for their go-ahead.",
  );
});

it("reads BACKLOG.md when chosen, without asking for a label", async () => {
  await show();
  expect(field("Issue label")).not.toBeNull();
  await act(async () => field("BACKLOG.md").click());
  expect(field("Issue label")).toBeNull();
  await prepare();
  expect(missionNow().tickets).toEqual({ kind: "backlog" });
});

it("waits for the user's go-ahead by default; starting alone is their explicit choice (review)", async () => {
  await show();
  expect(isChecked("When I approve the plan")).toBe(true);
  expect(isChecked("As soon as the plan is ready")).toBe(false);
  await prepare();
  expect(missionNow().autoLaunch).toBeUndefined();
  expect(vi.mocked(notify).mock.calls[0][1]).toContain("the plan waits for their go-ahead");
});

it("starts alone when the user picks it", async () => {
  await show();
  await act(async () => field("As soon as the plan is ready").click());
  await prepare();
  expect(missionNow().autoLaunch).toBe(true);
  expect(vi.mocked(notify).mock.calls[0][1]).toContain("the plan starts without waiting for a go-ahead");
});

it("will not start without a time, too many agents, or a label: a repository's issues need one", async () => {
  await show();
  await act(async () => type(field("Time away (hours)"), "0"));
  expect(button("Prepare the night").disabled).toBe(true);
  expect(field("Time away (hours)").getAttribute("aria-invalid")).toBe("true");
  await act(async () => type(field("Time away (hours)"), "8"));
  await act(async () => type(field("Number of agents working at once"), "9"));
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => type(field("Number of agents working at once"), "4"));
  await act(async () => type(field("Issue label"), "  "));
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => type(field("Issue label"), "nuit"));
  expect(button("Prepare the night").disabled).toBe(false);
});

it("defaults to files: commands stay an explicit choice (review)", async () => {
  await show();
  expect(isChecked("Edit files")).toBe(true);
  expect(isChecked("Edit files and run commands")).toBe(false);
  await prepare();
  expect(missionNow().permission).toBe("edits");
});

it("says plainly what each permission costs a night, as Claude Code applies it", async () => {
  await show();
  // acceptEdits: edits and simple file commands; anything else asks.
  expect(text()).toContain("Edits and simple file commands (mkdir, mv, cp) run unasked; an agent stops at the first other command");
  // dontAsk: what is not allowed is refused, not asked.
  expect(text()).toContain("what would still ask is refused. The network and the accounts signed in on this PC are open to agents");
  await act(async () => field("Edit files and run commands").click());
  await prepare();
  expect(missionNow().permission).toBe("work");
});

it("says the push block is no security boundary, with how it was passed (review)", async () => {
  await show();
  const block = document.querySelector("[data-no-push]")!.textContent;
  expect(block).toContain("It is a guard, not a security boundary");
  expect(block).toContain("-c remote.origin.pushurl");
  expect(block).toContain("GIT_CONFIG_COUNT=0");
  expect(block).toContain("Your own settings are not changed.");
});

it("gives the Fleet its own night: it never waits for a yes, and restarts on the same conversation to get it", async () => {
  await show({}, {});
  terminalStatusStore.getState().set("chef", { state: "running" } as never);
  expect(text()).toContain("The Fleet itself never waits for a yes at night");
  await prepare();
  expect(sessionOf(nodesStore.getState().nodes.chef)?.permission).toBe("edits");
  expect(relaunchTerminal).toHaveBeenCalledWith("chef", expect.objectContaining({ permission: "edits" }), "resume");
  // Its orders come once it has restarted: typed before, they would reach the session that ends.
  expect(notify).toHaveBeenCalledTimes(1);
  expect(vi.mocked(relaunchTerminal).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notify).mock.invocationCallOrder[0]);
});

it("waits for its checks before it can start, and says it is checking (audit P2 #46)", async () => {
  mockIPC((cmd) => (cmd === "mission_checks" ? new Promise(() => undefined) : undefined));
  await show({}, {});
  expect(document.querySelector("[data-checks]")?.textContent).toContain("Checking the project…");
  expect(button("Prepare the night").disabled).toBe(true);
});

it("blocks on checks that failed, with a retry, instead of reading them as passed (audit P2 #46)", async () => {
  let fail = true;
  mockIPC((cmd) => {
    if (cmd !== "mission_checks") return undefined;
    if (fail) return Promise.reject("gh timed out");
    return { git: true, gh: true };
  });
  await show({}, {});
  await vi.waitFor(() => expect(document.querySelector("[data-checks]")?.textContent).toContain("The project could not be checked: gh timed out"));
  expect(document.querySelector('[data-check="blocked"]')?.getAttribute("role")).toBe("alert");
  expect(button("Prepare the night").disabled).toBe(true);
  fail = false;
  await act(async () => button("Try again").click());
  await vi.waitFor(() => expect(document.querySelector("[data-checks]")?.textContent).toContain("GitHub CLI answers"));
  expect(document.querySelector("[data-checks]")?.textContent).not.toContain("could not be checked");
  expect(button("Prepare the night").disabled).toBe(false);
});

it("marks an out-of-range field and says why under it (audit P2 #46)", async () => {
  await show();
  await act(async () => type(field("Number of agents working at once"), "9"));
  const agents = field("Number of agents working at once");
  expect(agents.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(agents.getAttribute("aria-describedby")!)?.textContent).toBe("A whole number from 1 to 8");
  await act(async () => type(field("Time away (hours)"), "0"));
  const away = field("Time away (hours)");
  expect(document.getElementById(away.getAttribute("aria-describedby")!)?.textContent).toBe("More than 0 and up to 72 hours");
  await act(async () => type(field("Number of agents working at once"), "4"));
  expect(field("Number of agents working at once").hasAttribute("aria-invalid")).toBe(false);
  expect(field("Number of agents working at once").hasAttribute("aria-describedby")).toBe(false);
});

it("will not start outside a repository, and needs gh only for GitHub", async () => {
  mockIPC((cmd) => (cmd === "mission_checks" ? { git: true, gh: false } : undefined));
  await show({}, {});
  await vi.waitFor(() => expect(document.querySelector("[data-checks]")?.textContent).toContain("gh does not answer"));
  expect(document.querySelector('[data-check="blocked"]')?.getAttribute("role")).toBe("alert");
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => field("BACKLOG.md").click());
  expect(document.querySelector("[data-checks]")?.textContent).not.toContain("gh does not answer");
  expect(button("Prepare the night").disabled).toBe(false);
});

it("reads Linear in one team and with a label, once Linear is connected to the Fleet", async () => {
  mockIPC((cmd) => (cmd === "mission_checks" ? { git: true, gh: false } : undefined));
  await show({}, {});
  await act(async () => field("Linear").click());
  await vi.waitFor(() => expect(document.querySelector("[data-checks]")?.textContent).toContain("Linear is not connected to the Fleet yet"));
  await act(async () => type(field("Linear team key or name"), "ENG"));
  expect(button("Prepare the night").disabled).toBe(true);
  // Connecting gives the Fleet Linear's server; signing in is the user's, in its terminal.
  await act(async () => button("Connect…").click());
  expect(sessionOf(nodesStore.getState().nodes.chef)?.linear).toBe(true);
  expect(vi.mocked(toast.info).mock.calls[0][0]).toContain("type /mcp, pick linear, then Authenticate");
  await act(async () => root.unmount());
  host.remove();
  await show({}, { linear: true });
  await act(async () => field("Linear").click());
  await act(async () => type(field("Linear team key or name"), " ENG "));
  await vi.waitFor(() => expect(document.querySelector("[data-checks]")?.textContent).toContain("Linear is connected to the Fleet"));
  await prepare();
  expect(missionNow().tickets).toEqual({ kind: "linear", team: "ENG", label: "overnight" });
  expect(sessionOf(nodesStore.getState().nodes.chef)?.linear).toBe(true);
});

it("opens again on a night already set, to change it", async () => {
  await show({ overnight: true, budgetMin: 300, maxAgents: 2, tickets: { kind: "backlog" }, permission: "work", autoLaunch: true });
  expect(text()).toContain("Change the night");
  expect(field("Time away (hours)").value).toBe("5");
  expect(field("Number of agents working at once").value).toBe("2");
  expect(isChecked("BACKLOG.md")).toBe(true);
  expect(isChecked("Edit files and run commands")).toBe(true);
  expect(isChecked("As soon as the plan is ready")).toBe(true);
  await act(async () => type(field("Time away (hours)"), "6"));
  await act(async () => button("Update the night").click());
  expect(missionNow().budgetMin).toBe(360);
  expect(vi.mocked(notify).mock.calls[0][1]).toBe(
    "The overnight run changed: the user is away for 360 min, with 2 agents at once, and the plan starts without waiting for a go-ahead. Call mission and tickets again before you plan.",
  );
});

it("warns on the plan's usage without blocking, and says what can still put the PC to sleep", async () => {
  usageStore.setState({ limits: { fiveHour: { usedPercent: 85 }, models: [] } as never });
  await show();
  const checks = document.querySelector("[data-checks]")?.textContent;
  expect(checks).toContain("Plan usage at 85 %");
  expect(checks).toContain("Closing the lid");
  expect(button("Prepare the night").disabled).toBe(false);
  usageStore.setState({ limits: null });
});

it("scrolls its sections between a header and a footer that stay in view", async () => {
  await show();
  const body = document.querySelector("[data-night-body]")!;
  expect(body.className).toContain("overflow-y-auto");
  expect(body.className).toContain("min-h-0");
  expect(body.contains(button("Prepare the night"))).toBe(false);
  expect(document.querySelector('[role="dialog"]')!.className).toContain("flex-col");
});

it("has one way out, the footer's Cancel: no corner ✕, a quiet dismiss beside the accent's primary", async () => {
  await show();
  expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
  expect(button("Cancel").getAttribute("data-variant")).toBe("ghost");
  expect(button("Cancel").className).toMatch(/\bh-9\b/);
  expect(button("Prepare the night").className).toMatch(/\bh-9\b/);
});
