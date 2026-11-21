// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast, type ToastT } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { missionCleanLeftovers, missionLand, missionLanding, missionLeftovers, type Landing, type Leftovers } from "@/ipc/mission";
import { AppToaster } from "@/shell/AppToaster";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { showCleanup } from "./cleanup";
import { notify } from "./events";
import { answerLand, askToLand } from "./land";
import { answerLeftovers, askLeftovers, leftoversStore } from "./leftovers";
import { NEW_MISSION, type Mission } from "./mission";
import { missionOf } from "./store";

// Real Sonner on purpose: a mocked `toast.dismiss` only proves it was called, not that the toast left the screen.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/mission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/mission")>()),
  missionLanding: vi.fn(),
  missionLand: vi.fn(),
  missionLeftovers: vi.fn(),
  missionCleanLeftovers: vi.fn(),
}));
vi.mock("./events", async (importOriginal) => ({ ...(await importOriginal<typeof import("./events")>()), notify: vi.fn() }));
vi.mock("@/mission/launch", () => ({
  oneMergeAtATime: vi.fn((_worktree: string, run: () => Promise<unknown>) => run()),
  cleanMission: vi.fn(),
  cleaningNow: vi.fn(() => false),
  endMission: vi.fn(),
  mergeMission: vi.fn(),
  reassignTask: vi.fn(),
  deliveryPending: vi.fn(() => false),
  launchMission: vi.fn(),
}));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn() }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn(), remoteBusy: vi.fn(() => false) }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));

const terminal = (name: string, cwd: string) => ({ title: name, name, agent: "claude" as const, cwd, shell: "default" as const, command: "" });
const fleet = (name: string, cwd: string, mission: Partial<Mission>) => ({ name, session: { ...terminal(name, cwd), role: "orchestrator" as const }, mission: { ...NEW_MISSION, ...mission } });
const running: Partial<Mission> = { state: "en_cours", name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", worktree: "C:/w/auth", base: "main", members: [] };

const tip = "a1b2c3d4".repeat(5);
const landing: Landing = { target: "main", branch: "dummyplane/auth", tip, commits: ["a1b2c3d API", "9f8e7d6 Login"], count: 2, fastForward: true };
const found: Leftovers = {
  target: "main",
  keptFolder: "C:\\code\\proj.worktrees\\.kept",
  worktrees: [{ name: "alpha-thor", branch: "dummyplane/alpha-thor", wip: false, moves: [], moveCount: 0, gone: false }],
  branches: [{ name: "dummyplane/alpha", head: "a1" }],
  trash: [],
  strays: [],
};
const nothing: Leftovers = { ...found, worktrees: [], branches: [] };

/** The toasts on screen (sonner's own list: a dismissed one is not in it). */
const active = () => toast.getToasts() as ToastT[];
const shown = () => active().map((t) => String(t.id));
const later = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const mission = () => missionOf(nodesStore.getState().nodes.chef);

/** The Fleet "chef" on the canvas, 600 x 500 at the origin, and the view over it (1440 x 900, at 100 %). */
const FLEET = { id: "chef", x: 0, y: 0, width: 600, height: 500, isDeleted: false };
let view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1440, height: 900 };
/** Where the view is: the Fleet whole in the band between the bars, its top half only (its foot under the command bar), or far away. */
const AT = { inSight: { scrollX: 100, scrollY: 200 }, topHalf: { scrollX: 100, scrollY: 500 }, away: { scrollX: 3000, scrollY: 3000 } };
const place = (at: keyof typeof AT) => (view = { ...view, ...AT[at] });

beforeEach(async () => {
  toast.dismiss();
  // A dismissal by id waits one frame in sonner: let the last test's reach its toast before this one makes the same id again.
  await later(40);
  modelRouterStore.setState({ on: false, levels: {} });
  mockIPC(() => undefined);
  vi.clearAllMocks();
  leftoversStore.setState({ asks: {} });
  workspacesStore.setState({ activeId: "w1" });
  projectsStore.setState({ view: "project" });
  place("away");
  canvasStore.setState({ api: { getSceneElements: () => [FLEET], getSceneElementsIncludingDeleted: () => [FLEET], getAppState: () => view } as never });
  agentActivityStore.setState({ activities: {} });
  terminalStatusStore.getState().set("chef", { state: "running" });
  terminalStatusStore.getState().set("other", { state: "running" });
  nodesStore.setState({ nodes: {} });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: fleet("Chef", "C:/code/proj", running) });
  await nodesStore.getState().create("other", { workspaceId: "w1", kind: "fleet", payload: fleet("Other", "C:/code/proj", {}) });
  vi.mocked(missionLanding).mockResolvedValue(landing);
  vi.mocked(missionLeftovers).mockResolvedValue(found);
  vi.mocked(missionCleanLeftovers).mockResolvedValue({ removed: ["alpha-thor"], kept: ["alpha-storm (Storm is open there)"], saved: [] });
});

describe("the Land question's toast", () => {
  it("goes when the mission is cleaned up, with no click on it", async () => {
    await askToLand("chef", "chef");
    expect(shown()).toContain("land-chef");
    // The cleanup frees the Fleet: its mission is blank, its question with it.
    nodesStore.getState().update("chef", { mission: { ...NEW_MISSION } });
    expect(shown()).not.toContain("land-chef");
  });

  it("goes when the Fleet is deleted", async () => {
    await askToLand("chef", "chef");
    nodesStore.getState().forgetWorkspace("w1");
    expect(shown()).not.toContain("land-chef");
  });

  it("goes when the Fleet is closed from the canvas (what `disposeTerminal` does to it)", async () => {
    await askToLand("chef", "chef");
    nodesStore.getState().close("chef");
    terminalStatusStore.getState().remove("chef");
    expect(shown()).not.toContain("land-chef");
  });

  it("goes when a new ask finds nothing left to land: the question it showed is moot", async () => {
    await askToLand("chef", "chef");
    vi.mocked(missionLanding).mockResolvedValue({ ...landing, count: 0, commits: [] });
    await askToLand("chef", "chef");
    expect(mission()?.landing).toBeUndefined();
    expect(shown()).not.toContain("land-chef");
  });

  it("tells the agent that asked when another agent's read withdraws its question, and not the caller itself", async () => {
    await askToLand("chef", "other");
    vi.mocked(missionLanding).mockResolvedValue({ ...landing, count: 0, commits: [] });
    await askToLand("chef", "chef");
    expect(notify).toHaveBeenCalledWith("other", expect.stringContaining("Your earlier question to the user about landing is withdrawn"));
    vi.mocked(notify).mockClear();
    vi.mocked(missionLanding).mockResolvedValue(landing);
    await askToLand("chef", "chef");
    vi.mocked(missionLanding).mockResolvedValue({ ...landing, count: 0, commits: [] });
    await askToLand("chef", "chef");
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays when the mission ends (stopped or finished): it can still be landed", async () => {
    await askToLand("chef", "chef");
    nodesStore.getState().update("chef", { mission: { ...mission()!, state: "terminee" } });
    expect(shown()).toContain("land-chef");
  });

  it("stays while its question stands, and a second ask replaces it: one toast, the newer one", async () => {
    await askToLand("chef", "chef");
    const first = mission()?.landing?.at;
    await later();
    await askToLand("chef", "boss");
    await later(30);
    expect(mission()?.landing?.at).toBeGreaterThan(first ?? 0);
    expect(shown().filter((id) => id.startsWith("land-"))).toEqual(["land-chef"]);
  });

  it("goes with the user's answer from the panel, as before", async () => {
    await askToLand("chef", "chef");
    vi.mocked(missionLand).mockResolvedValue({ kind: "upToDate" });
    await answerLand("chef", mission()!.landing!.at, false);
    expect(shown()).not.toContain("land-chef");
  });

  it("leaves the screen, not only sonner's list", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<AppToaster />));
    await act(async () => {
      await askToLand("chef", "chef");
      await later();
    });
    const toastOf = () => host.querySelector<HTMLElement>("[data-sonner-toast]");
    expect(host.textContent).toContain("Land the mission on main?");
    expect(toastOf()?.dataset.removed).toBe("false");
    await act(async () => {
      nodesStore.getState().update("chef", { mission: { ...NEW_MISSION } });
      await later(50);
    });
    // Sonner marks the toast it takes off the screen (the exit animation); happy-dom never unmounts it after.
    expect(toastOf()?.dataset.removed).toBe("true");
    await act(async () => root.unmount());
    host.remove();
  });
});

describe("the Clean up leftovers question's toast", () => {
  it("goes when its Fleet is deleted", async () => {
    await askLeftovers("chef");
    expect(shown()).toContain("leftovers-chef");
    nodesStore.getState().forgetWorkspace("w1");
    expect(shown()).not.toContain("leftovers-chef");
  });

  it("goes, with its question, when a new read finds nothing left", async () => {
    await askLeftovers("chef");
    expect(leftoversStore.getState().asks.chef).toBeDefined();
    vi.mocked(missionLeftovers).mockResolvedValue(nothing);
    await askLeftovers("chef");
    expect(leftoversStore.getState().asks.chef).toBeUndefined();
    expect(shown()).not.toContain("leftovers-chef");
  });

  it("tells the agent that asked, when another agent's read withdraws its question; the caller hears it in its answer", async () => {
    await askLeftovers("chef", "other");
    vi.mocked(missionLeftovers).mockResolvedValue(nothing);
    await askLeftovers("chef", "chef");
    expect(notify).toHaveBeenCalledWith("other", expect.stringContaining("Your earlier question to the user about the leftovers is withdrawn"));
    vi.mocked(notify).mockClear();
    vi.mocked(missionLeftovers).mockResolvedValue(found);
    await askLeftovers("chef", "chef");
    vi.mocked(missionLeftovers).mockResolvedValue(nothing);
    await askLeftovers("chef", "chef");
    expect(notify).not.toHaveBeenCalled();
  });

  it("goes too, and its asker hears it, when a new read finds everything left kept: a Clean up would change nothing", async () => {
    await askLeftovers("chef", "other");
    expect(leftoversStore.getState().asks.chef).toBeDefined();
    const everythingKept: Leftovers = { ...found, worktrees: found.worktrees.map((w) => ({ ...w, kept: "Storm is open there" })), branches: [] };
    vi.mocked(missionLeftovers).mockResolvedValue(everythingKept);
    const answer = await askLeftovers("chef", "chef");
    expect(answer.text).toContain("Nothing to clean up");
    expect(leftoversStore.getState().asks.chef).toBeUndefined();
    expect(shown()).not.toContain("leftovers-chef");
    expect(notify).toHaveBeenCalledWith("other", expect.stringContaining("Your earlier question to the user about the leftovers is withdrawn"));
  });

  it("a second question replaces the first: one toast", async () => {
    await askLeftovers("chef");
    await later();
    await askLeftovers("chef");
    await later(30);
    expect(shown().filter((id) => id.startsWith("leftovers-"))).toEqual(["leftovers-chef"]);
    expect(leftoversStore.getState().asks.chef).toBeDefined();
  });
});

describe("one home per question: the Fleet's panel, a toast only while the Fleet is out of sight", () => {
  /** The view moves there, as Excalidraw tells the store (each time somewhere new). */
  let moves = 0;
  const look = (at: keyof typeof AT) => {
    place(at);
    canvasStore.getState().setView({ ...EMPTY_VIEW, scrollX: ++moves });
  };

  it("Land: the Fleet in sight asks in its panel alone", async () => {
    look("inSight");
    await askToLand("chef", "chef");
    expect(mission()?.landing).toBeDefined();
    expect(shown()).not.toContain("land-chef");
  });

  it("Land: the Fleet out of sight asks in a toast too, its Land first as the accent", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<AppToaster />));
    await act(async () => {
      await askToLand("chef", "chef");
      await later();
    });
    expect(shown()).toContain("land-chef");
    const buttons = [...host.querySelectorAll<HTMLElement>("[data-decision-toast] button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Land", "Not now"]);
    expect(buttons[0].dataset.variant).toBe("default");
    await act(async () => root.unmount());
    host.remove();
  });

  it("Land: the toast goes when the Fleet comes into view, and the panel still asks", async () => {
    await askToLand("chef", "chef");
    expect(shown()).toContain("land-chef");
    look("inSight");
    expect(shown()).not.toContain("land-chef");
    expect(mission()?.landing).toBeDefined();
  });

  it("Land: a Fleet whose top half shows, its foot under the command bar, is out of sight: the question is not hidden", async () => {
    look("topHalf");
    await askToLand("chef", "chef");
    expect(shown()).toContain("land-chef");
  });

  it("Land: another workspace, or Home, is out of sight whatever the view", async () => {
    place("inSight");
    workspacesStore.setState({ activeId: "w2" });
    await askToLand("chef", "chef");
    expect(shown()).toContain("land-chef");
    // Back on the Fleet's workspace, where the view shows it: the toast goes.
    workspacesStore.setState({ activeId: "w1" });
    expect(shown()).not.toContain("land-chef");
    projectsStore.setState({ view: "home" });
    vi.mocked(missionLanding).mockResolvedValue({ ...landing, tip: "f".repeat(40) });
    await askToLand("chef", "chef");
    expect(shown()).toContain("land-chef");
  });

  it("Clean up leftovers: the Fleet in sight asks in its panel alone", async () => {
    look("inSight");
    await askLeftovers("chef");
    expect(leftoversStore.getState().asks.chef).toBeDefined();
    expect(shown()).not.toContain("leftovers-chef");
  });

  it("Clean up leftovers: the Fleet out of sight asks in a toast too", async () => {
    await askLeftovers("chef", "chef");
    expect(shown()).toContain("leftovers-chef");
  });

  it("Clean up leftovers: the toast goes when the Fleet comes into view, and the panel still asks", async () => {
    await askLeftovers("chef", "chef");
    look("inSight");
    expect(shown()).not.toContain("leftovers-chef");
    expect(leftoversStore.getState().asks.chef).toBeDefined();
  });

  it("a question asked again while the Fleet is in sight takes the earlier toast away", async () => {
    await askToLand("chef", "chef");
    expect(shown()).toContain("land-chef");
    // In sight with no view change (the Fleet placed under the view): the new ask drops the old toast itself.
    place("inSight");
    await later();
    await askToLand("chef", "chef");
    expect(shown()).not.toContain("land-chef");
    expect(mission()?.landing).toBeDefined();
  });
});

describe("the outcome toasts that stay until dismissed", () => {
  const kept = { removed: ["auth"], kept: ["dummyplane/auth (2 commits not on main)"], open: [] };

  it("a mission's clean-up shown again is one toast, however often it comes", () => {
    showCleanup("Auth", kept);
    showCleanup("Auth", kept);
    showCleanup("Auth", kept);
    expect(shown().filter((id) => id.startsWith("cleaned-"))).toHaveLength(1);
  });

  it("a later result that kept nothing replaces the earlier one and no longer stays", () => {
    showCleanup("Auth", kept);
    showCleanup("Auth", { removed: ["auth"], kept: [], open: [] });
    const [only, ...rest] = active().filter((t) => String(t.id).startsWith("cleaned-"));
    expect(rest).toEqual([]);
    expect(only.duration).not.toBe(Infinity);
    expect(only.closeButton).not.toBe(true);
  });

  it("the leftovers' clean-up outcome is one toast however often it ran", async () => {
    for (let pass = 0; pass < 3; pass++) {
      await askLeftovers("chef");
      await answerLeftovers("chef", leftoversStore.getState().asks.chef!.at, true);
    }
    expect(active().filter((t) => t.title === "Leftovers cleaned up")).toHaveLength(1);
  });
});
