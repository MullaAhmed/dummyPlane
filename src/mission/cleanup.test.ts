// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { agentActivityStore } from "@/store/agentActivity";
import { terminalStatusStore } from "@/store/terminalStatus";
import { nodesStore } from "@/store/nodes";
import { cleanUpFinished, showCleanup } from "./cleanup";
import { cleanMission } from "./launch";
import { NEW_MISSION, type Mission } from "./mission";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("./launch", async () => {
  const { NEW_MISSION: blank } = await import("./mission");
  const { nodesStore: store } = await import("@/store/nodes");
  return {
    cleaningNow: vi.fn(() => false),
    // The panel's cleanup, as far as these tests look: the Fleet is freed with a blank mission.
    cleanMission: vi.fn(async (fleetId: string) => {
      store.getState().update(fleetId, { mission: { ...blank } });
      return { removed: [] as string[], kept: [] as string[], open: [] };
    }),
  };
});

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code/proj", shell: "default" as const, command: "", role: "orchestrator" as const };

async function setup(mission: Partial<Mission>) {
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { ...NEW_MISSION, ...mission } } });
}

beforeEach(() => {
  mockIPC(() => undefined);
  agentActivityStore.setState({ activities: {} });
  vi.mocked(toast.success).mockClear();
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

  it("does not count a waiting task whose card is Done as an open task: it was done outside the queue", async () => {
    await nodesStore.getState().create("k1", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "todo", title: "To do", cardIds: [] },
          { id: "done", title: "Done", cardIds: ["c1"] },
        ],
        cards: { c1: { id: "c1", title: "003", notes: "", priority: "none" } },
        orchestrator: { nodeId: "chef", columnId: "todo" },
      },
    });
    await setup({ state: "terminee", name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", members: [], queue: [{ title: "003", brief: "b", budgetMin: 5, card: "c1" }] });
    expect((await cleanUpFinished("chef")).cleaned).toBe(true);
  });

  it("cleans up whatever is uncommitted or not merged: the cleanup saves the one and keeps the other, and the user and the Fleet are told what stayed and why (#13)", async () => {
    await setup({ state: "terminee", name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", members: [], strays: ["Superman"] });
    vi.mocked(cleanMission).mockImplementationOnce(async (fleetId: string) => {
      nodesStore.getState().update(fleetId, { mission: { ...NEW_MISSION } });
      return {
        removed: ["auth-superman", "auth"],
        saved: ["dummyplane/auth-superman (abc1234)"],
        kept: ["dummyplane/auth-superman (WIP saved at clean-up)", "dummyplane/auth (2 commits not on main)"],
        open: [{ name: "Loki", why: "atWork" as const }],
      };
    });
    const result = await cleanUpFinished("chef");
    expect(result.cleaned).toBe(true);
    const text = result.cleaned ? result.text : "";
    expect(text).toContain("WIP saved: dummyplane/auth-superman (abc1234).");
    expect(text).toContain("Kept, and shown to the user with why: dummyplane/auth-superman (WIP saved at clean-up); dummyplane/auth (2 commits not on main).");
    expect(text).toContain("Left open: Loki (at work).");
    // The user sees it too, until they dismiss it: the branches left in their folder, and why.
    expect(toast.success).toHaveBeenCalledWith("Mission Auth cleaned up", {
      id: "cleaned-Auth",
      description:
        'Removed: auth-superman, auth. Uncommitted work saved as a "WIP saved at clean-up" commit on its own branch: dummyplane/auth-superman (abc1234). Kept: dummyplane/auth-superman (WIP saved at clean-up); dummyplane/auth (2 commits not on main). Left open: Loki (at work).',
      duration: Infinity,
      closeButton: true,
    });
  });

  it("shows a cleanup that kept nothing as a passing notice", () => {
    showCleanup("Auth", { removed: ["auth", "dummyplane/auth"], kept: [], open: [] });
    expect(toast.success).toHaveBeenCalledWith("Mission Auth cleaned up", { id: "cleaned-Auth", description: "Removed: auth, dummyplane/auth." });
  });

  it("refuses while an agent made for the mission is held by a dialog: the Manager's close would cut it", async () => {
    await nodesStore.getState().create("a1", { workspaceId: "w1", kind: "terminal", payload: { ...session, title: "Batman", name: "Batman", role: undefined } });
    await setup({ state: "terminee", name: "Auth", project: "C:/code/proj", slug: "auth", members: [{ nodeId: "a1", name: "Batman", task: "T", budgetMin: 5, linked: false, branch: "b", worktree: "w" }] });
    terminalStatusStore.getState().set("a1", { state: "running" });
    agentActivityStore.getState().hold("a1", { activity: "waiting", since: 0, message: "Allow?" });
    const result = await cleanUpFinished("chef");
    expect(result).toEqual({ cleaned: false, reason: "Not cleaned up: still at work: Batman. Try again in a moment." });
    agentActivityStore.setState({ under: {} });
  });
});
