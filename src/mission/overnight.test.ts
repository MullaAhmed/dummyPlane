// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fleetSession } from "@/nodes/terminal/launch";
import { nodesStore } from "@/store/nodes";
import { NEW_MISSION } from "./mission";
import { cancelOvernight, startOvernight } from "./overnight";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(() => Promise.resolve()) }));
vi.mock("./events", () => ({ notify: vi.fn() }));

const source = { kind: "github" as const, label: "overnight" };
const permission = (id: string) => (nodesStore.getState().nodes[id]?.payload as { permission?: string }).permission;

beforeEach(async () => {
  mockIPC(() => undefined);
  nodesStore.setState({ nodes: {} });
  const mission = { ...NEW_MISSION, state: "plan" as const, overnight: true, budgetMin: 480, tickets: source, permission: "work" as const };
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session: fleetSession("Fleet", { cwd: "C:/p", shell: "default" }), mission } });
  // Cyborg was opened by the Fleet with spawn_agent during the night's planning, and got its permission.
  const terminal = { title: "Cyborg", name: "Cyborg", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "", spawnedBy: "fleet", permission: "work" as const };
  await nodesStore.getState().create("cyborg", { workspaceId: "w1", kind: "terminal", payload: terminal });
});

it("takes the night's permission back from the Fleet's sub-agents when the night is called off", async () => {
  await cancelOvernight("fleet");
  expect(permission("cyborg")).toBeUndefined();
});

it("takes it back when the night is changed to let them do less, and keeps it when it stays the same", async () => {
  const choice = { awayMin: 480, agents: 4, source, autoLaunch: false };
  await startOvernight("fleet", { ...choice, permission: "work" });
  expect(permission("cyborg")).toBe("work");
  await startOvernight("fleet", { ...choice, permission: "ask" });
  expect(permission("cyborg")).toBeUndefined();
});
