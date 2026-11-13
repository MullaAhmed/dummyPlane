// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { cleanUpFinished } from "./cleanup";
import { NEW_MISSION, type Mission } from "./mission";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("./launch", async () => {
  const { NEW_MISSION: blank } = await import("./mission");
  const { nodesStore: store } = await import("@/store/nodes");
  return {
    // The panel's cleanup, as far as these tests look: the Fleet is freed with a blank mission.
    cleanMission: vi.fn(async (fleetId: string) => {
      store.getState().update(fleetId, { mission: { ...blank } });
      return { removed: [], kept: [] as string[] };
    }),
  };
});

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code/proj", shell: "default" as const, command: "", role: "orchestrator" as const };

async function setup(mission: Partial<Mission>) {
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { ...NEW_MISSION, ...mission } } });
}

beforeEach(() => {
  mockIPC((command) => (command === "mission_cleanup_unsaved" ? [] : undefined));
  agentActivityStore.setState({ activities: {} });
});

describe("cleanUpFinished", () => {
  it("never cuts the summary it hands back to the Fleet inside an emoji: the answer goes to Rust as JSON, which refuses half of one", async () => {
    // 🎉 straddles the cut at 1500 units: its first half would be the last unit kept.
    await setup({ state: "terminee", name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", summary: `${"x".repeat(1499)}🎉 shipped`, members: [] });
    const result = await cleanUpFinished("chef");
    expect(result.cleaned).toBe(true);
    const text = result.cleaned ? result.text : "";
    expect(text).toContain(`${"x".repeat(1499)}…`);
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("checks the worktree of an agent a stop left behind too, as the cleanup will remove it", async () => {
    const asked: unknown[] = [];
    mockIPC((command, args) => {
      if (command === "mission_cleanup_unsaved") asked.push(args);
      return command === "mission_cleanup_unsaved" ? [] : undefined;
    });
    await setup({ state: "terminee", name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", members: [], strays: ["Superman"] });
    await cleanUpFinished("chef");
    expect(asked).toEqual([{ project: "C:/code/proj", mission: "auth", agents: [{ name: "Superman" }] }]);
  });
});
