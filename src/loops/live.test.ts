// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { loopsStore } from "./live";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/broadcast", () => ({ sendToAgents: vi.fn(async () => ({ sent: 0, skipped: [], waiting: [], unsuited: [], starting: [] })) }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => "") }));

beforeEach(async () => {
  mockIPC(() => null);
  loopsStore.getState().stopAll();
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
});

it("stops a loop whose every target was closed on the canvas, its record kept only for an undo, and says so", async () => {
  loopsStore.setState({
    loops: [{ id: "l1", projectId: "p1", name: "Point", instruction: "go", targets: ["batman"], trigger: { kind: "interval", minutes: 30 }, maxRuns: 3 }],
    loaded: true,
    runtime: {},
  });
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
