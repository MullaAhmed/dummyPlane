// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { usageStore } from "@/usage/usageStore";
import { notify } from "./events";
import { NEW_MISSION, type Mission } from "./mission";
import { OvernightDialog } from "./OvernightDialog";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./events", () => ({ notify: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "", role: "orchestrator" as const };

async function show(mission: Partial<Mission> = {}, withSession?: typeof session) {
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", ...(withSession ? { session: withSession } : {}), mission: { ...NEW_MISSION, ...mission } } });
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
/** A Radix checkbox or option is a button: its state is in `aria-checked`. */
const isChecked = (label: string) => field(label).getAttribute("aria-checked") === "true";
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
const missionNow = () => missionOf(nodesStore.getState().nodes.chef)!;

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("asks for the time away, the agents and the source; Kanban is not offered, it does not exist here", async () => {
  await show({ maxAgents: 3 });
  expect(field("Time away (hours)").value).toBe("8");
  expect(field("Number of agents").value).toBe("3");
  expect(document.body.textContent).toContain("GitHub issues");
  expect(document.body.textContent).toContain("BACKLOG.md");
  expect(document.body.textContent).not.toContain("Kanban");
});

it("sets up the mission and gives the fleet its orders", async () => {
  await show();
  await act(async () => type(field("Time away (hours)"), "6.5"));
  await act(async () => type(field("Number of agents"), "5"));
  await act(async () => button("Prepare the night").click());
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
  await act(async () => button("Prepare the night").click());
  expect(missionNow().tickets).toEqual({ kind: "backlog" });
});

it("waits for the user's go-ahead by default; starting alone is their explicit choice (review)", async () => {
  await show();
  expect(isChecked("Start without waiting for my go-ahead")).toBe(false);
  await act(async () => button("Prepare the night").click());
  expect(missionNow().autoLaunch).toBeUndefined();
  expect(vi.mocked(notify).mock.calls[0][1]).toContain("the plan waits for their go-ahead");
});

it("starts alone when the user ticks it", async () => {
  await show();
  await act(async () => field("Start without waiting for my go-ahead").click());
  await act(async () => button("Prepare the night").click());
  expect(missionNow().autoLaunch).toBe(true);
  expect(vi.mocked(notify).mock.calls[0][1]).toContain("the plan starts without waiting for a go-ahead");
});

it("will not start without a time, too many agents, or a label: a repository's issues need one", async () => {
  await show();
  await act(async () => type(field("Time away (hours)"), "0"));
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => type(field("Time away (hours)"), "8"));
  await act(async () => type(field("Number of agents"), "9"));
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => type(field("Number of agents"), "4"));
  await act(async () => type(field("Issue label"), "  "));
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => type(field("Issue label"), "nuit"));
  expect(button("Prepare the night").disabled).toBe(false);
});

it("defaults to files: commands stay an explicit choice (review)", async () => {
  await show();
  expect(isChecked("Files")).toBe(true);
  expect(isChecked("Files and commands")).toBe(false);
  await act(async () => button("Prepare the night").click());
  expect(missionNow().permission).toBe("edits");
});

it("says plainly what files and commands opens to the agents", async () => {
  await show();
  expect(document.body.textContent).toContain("Agents run any command unasked: the network and the accounts logged in on this PC are open to them");
  expect(document.body.textContent).not.toContain("le reste est refusé");
  await act(async () => field("Files and commands").click());
  await act(async () => button("Prepare the night").click());
  expect(missionNow().permission).toBe("work");
});

it("says the push block is no security boundary, with how it was passed (review)", async () => {
  await show();
  const text = document.body.textContent;
  expect(text).toContain("This block is not a security boundary");
  expect(text).toContain("-c remote.origin.pushurl");
  expect(text).toContain("GIT_CONFIG_COUNT=0");
  expect(text).not.toContain("git push reste interdit dans tous les cas");
  expect(text).toContain("Your settings are not changed.");
});

it("says what files costs a night: an agent stops at its first command", async () => {
  await show();
  expect(document.body.textContent).toContain("an agent stops at its first command, until you are back");
});

it("will not start outside a repository, and needs gh only for GitHub", async () => {
  mockIPC((cmd) => (cmd === "mission_checks" ? { git: true, gh: false } : undefined));
  await show({}, session);
  await vi.waitFor(() => expect(document.querySelector("[data-checks]")?.textContent).toContain("gh does not answer"));
  expect(button("Prepare the night").disabled).toBe(true);
  await act(async () => field("BACKLOG.md").click());
  expect(document.querySelector("[data-checks]")?.textContent).not.toContain("gh does not answer");
  expect(button("Prepare the night").disabled).toBe(false);
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

it("has one way out, the footer's Cancel: no corner ✕, a quiet dismiss beside the accent's primary", async () => {
  await show();
  expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
  expect(button("Cancel").getAttribute("data-variant")).toBe("ghost");
  expect(button("Cancel").className).toMatch(/\bh-9\b/);
  expect(button("Prepare the night").className).toMatch(/\bh-9\b/);
});

it("speaks English", async () => {
  await show();
  expect(document.body.textContent).toContain("Overnight run");
  expect(document.body.textContent).toContain("Agents run any command unasked: the network and the accounts logged in on this PC are open to them");
  expect(document.body.textContent).toContain("an agent stops at its first command, until you are back");
  expect(document.body.textContent).toContain("This block is not a security boundary");
  expect(document.body.textContent).not.toContain("stays forbidden in every case");
  await act(async () => button("Prepare the night").click());
  expect(vi.mocked(notify).mock.calls[0][1]).toBe(
    "Overnight run: the user is away for 480 min. Call tickets, keep what fits in that time with 4 agents, put the rest in the queue with add_tasks, then call propose_plan: the plan waits for their go-ahead.",
  );
});
