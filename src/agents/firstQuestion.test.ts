import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ptyWrite } from "@/ipc/pty";
import { freshText, quietFor } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import { CLAUDE, MCP_ONE, PERMISSION, TRUST, WORKING } from "./dialogFixtures";
import { watchLaunched } from "./firstQuestion";
import { launchAgent, defaultLaunchOptions } from "./launchAgent";
import { addTerminal } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./terminals", () => ({ addTerminal: vi.fn(async () => "batman") }));
vi.mock("./naming", () => ({ nameForNewAgent: vi.fn(async () => "Batman") }));
vi.mock("@/canvas/groups", () => ({ groupAt: vi.fn(() => undefined) }));
vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptyWrite: vi.fn(async () => undefined) }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 10_000), markForAutostart: vi.fn(), startUnseen: vi.fn() }));

/** What the terminal shows from now on. */
const shows = (screen: string) => vi.mocked(freshText).mockReturnValue(screen);
const activity = () => agentActivityStore.getState().activities.batman;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(addTerminal).mockResolvedValue("batman");
  vi.mocked(quietFor).mockReturnValue(10_000);
  shows("");
  workspacesStore.setState({ activeId: "w1" });
  terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
  agentActivityStore.setState({ activities: {}, under: {} });
});

afterEach(() => {
  // The probe ends with its process: nothing is left reading a screen after a test.
  terminalStatusStore.setState({ statuses: {} });
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("a launch the user made", () => {
  it("waits for the user while Claude asks whether to trust the folder, and answers nothing itself", async () => {
    shows(TRUST);
    await launchAgent("claude", defaultLaunchOptions("w1"), { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(activity()).toMatchObject({ activity: "waiting", dialog: { kind: "trust" } });
    expect(ptyWrite).not.toHaveBeenCalled();
    // The user answers; a project's new MCP server asks next: still the user's.
    shows(MCP_ONE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(activity()).toMatchObject({ activity: "waiting", dialog: { kind: "mcp" } });
    // Its session opens: Rust's activity again, which says nothing yet.
    shows(CLAUDE);
    await vi.advanceTimersByTimeAsync(3000);
    expect(activity()).toBeUndefined();
    expect(Object.keys(agentActivityStore.getState().under)).toEqual([]);
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("waits for a question that stands past the minute, as long as the user takes", async () => {
    shows(TRUST);
    await launchAgent("claude", defaultLaunchOptions("w1"), { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(activity()).toMatchObject({ activity: "waiting", dialog: { kind: "trust" } });
  });

  it("lets go when the user says No and the shell comes back, and stops reading the screen past the minute", async () => {
    shows(TRUST);
    await launchAgent("claude", defaultLaunchOptions("w1"), { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    shows("PS C:\\code>");
    await vi.advanceTimersByTimeAsync(1000);
    expect(activity()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    const reads = vi.mocked(freshText).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(freshText).mock.calls.length).toBe(reads);
  });

  it("ends as the session opens, even when the user types at once: a later permission request is the hooks' to tell", async () => {
    // Its prompt is up but never still: the user types into it right away, then sends.
    vi.mocked(quietFor).mockReturnValue(0);
    shows(CLAUDE);
    await launchAgent("claude", defaultLaunchOptions("w1"), { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    // The turn asks a permission, which stays on screen a while; once answered, the agent works.
    vi.mocked(quietFor).mockReturnValue(10_000);
    shows(PERMISSION);
    await vi.advanceTimersByTimeAsync(1000);
    expect(Object.keys(agentActivityStore.getState().under)).toEqual([]);
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: Date.now() });
    vi.mocked(quietFor).mockReturnValue(0);
    shows(WORKING);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(activity()).toMatchObject({ activity: "working" });
  });

  it("reads no screen of a CLI dummyPlane cannot read, nor of a shell", async () => {
    shows(TRUST);
    await launchAgent("gemini", defaultLaunchOptions("w1"), { x: 0, y: 0 });
    await launchAgent("shell", defaultLaunchOptions("w1"), { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(freshText).not.toHaveBeenCalled();
    expect(activity()).toBeUndefined();
  });
});

describe("the other launches the user makes", () => {
  it("read each new terminal's agent from its payload: a Claude's question waits, a node that is gone or no terminal reads nothing", async () => {
    nodesStore.setState({
      nodes: {
        batman: { workspaceId: "w1", kind: "terminal", payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } },
        chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } },
      },
    });
    shows(TRUST);
    watchLaunched(["batman", "chef", "gone", null]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(activity()).toMatchObject({ activity: "waiting", dialog: { kind: "trust" } });
    expect(Object.keys(agentActivityStore.getState().activities)).toEqual(["batman"]);
  });

  it("run it at their own call: Add an agent to a group, Duplicate, Compose a group, a team preset; never a route that reads its agents' screens itself", () => {
    for (const path of ["agents/groups.ts", "agents/terminals.ts", "agents/ComposeGroup.tsx", "presets/live.ts"]) expect(readSource(path), path).toContain("watchLaunched(");
    // spawn_agent, a mission's team and a wake type a task once the prompt is up (`whenReady`): a second probe on the same
    // node would let go of the other's hold. `launchGroup` and `addTerminal` form a mission's team too: never inside them.
    for (const path of ["agents/spawn.ts", "mission/launch.ts", "mission/manager.ts", "agents/finishedStop.ts", "mission/events.ts"]) {
      expect(readSource(path), path).not.toMatch(/watchFirstQuestion|watchLaunched/);
    }
    const groups = readSource("agents/groups.ts");
    const launchGroupBody = groups.slice(groups.indexOf("export async function launchGroup"), groups.indexOf("export async function addAgentToGroup"));
    expect(launchGroupBody).not.toContain("watchLaunched(");
    const terminals = readSource("agents/terminals.ts");
    expect(terminals.slice(terminals.indexOf("export async function addTerminal"), terminals.indexOf("function placeFree"))).not.toContain("watchLaunched(");
  });
});
