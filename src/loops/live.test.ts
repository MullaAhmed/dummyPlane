// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { sendToAgents } from "@/agents/broadcast";
import { isLiveInRust } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore, type TerminalStatus } from "@/store/terminalStatus";
import { loopsStore } from "./live";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/broadcast", () => ({ sendToAgents: vi.fn(async () => ({ sent: 0, skipped: [], waiting: [], unsuited: [], starting: [] })) }));
// Every screen still shows Claude's prompt, as a stopped agent's last screen does: only its process tells it apart.
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => "──────────\n❯ \n──────────"), isLiveInRust: vi.fn(() => false) }));

const MIN = 60_000;
const terminal = (name: string) => ({
  workspaceId: "w1",
  kind: "terminal" as const,
  payload: { title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "" },
});
const loop = (targets: string[]) => ({ id: "l1", projectId: "p1", name: "Point", instruction: "go", targets, trigger: { kind: "interval" as const, minutes: 1 }, maxRuns: 9 });
const status = (id: string, value: TerminalStatus) => terminalStatusStore.getState().set(id, value);
const sentTo = () => vi.mocked(sendToAgents).mock.calls.map(([ids]) => ids);
/** One interval later, and the engine's look at its targets. */
const nextRun = async () => {
  vi.setSystemTime(Date.now() + MIN);
  await loopsStore.tick();
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  mockIPC(() => null);
  vi.mocked(sendToAgents).mockClear();
  vi.mocked(isLiveInRust).mockReturnValue(false);
  loopsStore.getState().stopAll();
  for (const name of ["batman", "robin"]) {
    await nodesStore.getState().create(name, terminal(name));
    status(name, { state: "running" });
  }
});
afterEach(() => vi.useRealTimers());

it("stops a loop whose every target was closed on the canvas, its record kept only for an undo, and says so", async () => {
  loopsStore.setState({ loops: [loop(["batman"])], loaded: true, runtime: {} });
  loopsStore.getState().start("l1");
  // Closed: the store keeps the record for an undo (`close`), its terminal is gone from the canvas.
  nodesStore.getState().close("batman");
  await loopsStore.tick();
  expect(loopsStore.getState().runtime.l1).toMatchObject({ running: false, stoppedBecause: "noTargets" });
  // Brought back by an undo, it is a target again.
  await nodesStore.getState().persist("batman");
  loopsStore.getState().start("l1");
  await loopsStore.tick();
  expect(loopsStore.getState().runtime.l1.running).toBe(true);
});

it("skips a stopped or exited agent, though its last screen shows its prompt, and stops with no agent left once none runs", async () => {
  loopsStore.setState({ loops: [loop(["batman", "robin"])], loaded: true, runtime: {} });
  loopsStore.getState().start("l1");
  status("robin", { state: "exited", code: 0 });
  await nextRun();
  expect(sentTo()).toEqual([["batman"]]);
  // A finished agent dummyPlane stopped to free its memory is stopped too.
  status("batman", { state: "stopped" });
  await loopsStore.tick();
  expect(loopsStore.getState().runtime.l1).toMatchObject({ running: false, stoppedBecause: "noTargets" });
});

it("takes a finished agent woken again as a target again", async () => {
  loopsStore.setState({ loops: [loop(["batman", "robin"])], loaded: true, runtime: {} });
  status("robin", { state: "stopped" });
  loopsStore.getState().start("l1");
  await nextRun();
  status("robin", { state: "running" });
  await nextRun();
  expect(sentTo()).toEqual([["batman"], ["batman", "robin"]]);
});

it("keeps an agent about to run as a target: its staggered start, a restart under way, a process alive in Rust since a reload", async () => {
  loopsStore.setState({ loops: [loop(["batman"])], loaded: true, runtime: {} });
  loopsStore.getState().start("l1");
  status("batman", { state: "starting" });
  await loopsStore.tick();
  expect(loopsStore.getState().runtime.l1.running).toBe(true);
  status("batman", { state: "stopped" });
  terminalStatusStore.getState().restart("batman", 1);
  await loopsStore.tick();
  expect(loopsStore.getState().runtime.l1.running).toBe(true);
  terminalStatusStore.getState().restart("batman", -1);
  vi.mocked(isLiveInRust).mockReturnValue(true);
  await loopsStore.tick();
  expect(loopsStore.getState().runtime.l1.running).toBe(true);
});
