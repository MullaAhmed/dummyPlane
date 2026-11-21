// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame } from "@/canvas/groups";
import { createNodeElement, nodeKindOf } from "@/canvas/nodeElement";
import { frameAround, NODE_GAP, overlap } from "@/agents/groupLayout";
import { terminalText } from "@/nodes/terminal/registry";
import { subagentNodesStore } from "@/nodes/subagent/store";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { notify } from "@/mission/events";
import type { Member } from "@/mission/mission";
import { answer } from "./router";
import { fleetTargets, orphanWires, withAgentLink, withWire } from "@/agents/wires";
import { forgetScene, rememberScene } from "@/canvas/sceneCache";
import { onFinish, type FinishSignal } from "@/agents/finishes";
import { summaryLine } from "@/shell/finishAlert";

vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "$ npm test\n3 failed") }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));

/** The workspace's scene, as `sceneAccess` reads and writes it. */
let scene: ExcalidrawElement[] = [];

// OpenUI loads on demand; its first load (zod, the parser) is slow under the full suite's load: warmed here, not in a test.
beforeAll(async () => {
  await Promise.all([import("@/openui/plainText"), import("@/openui/OpenUIView")]);
}, 60_000);
const write = vi.fn((elements: readonly ExcalidrawElement[]) => (scene = [...elements]));
vi.mock("@/agents/sceneAccess", () => ({ sceneAccess: vi.fn(() => ({ shown: true, elements: () => scene, write })) }));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "", ...extra });

async function addTerminal(id: string, name: string, at = { x: 0, y: 0 }, extra: Partial<TerminalPayload> = {}) {
  await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: terminal(name, extra) });
  scene.push({ ...createNodeElement("terminal", at), id } as unknown as ExcalidrawElement);
}

const call = (nodeId: string, name: string, args: Record<string, unknown>) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } }) as Promise<{ content: { text: string }[]; isError?: boolean }>;
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

const UI = 'root = Stack([h, t])\nh = Heading("Tests")\nt = Table(["Test", "Result"], [["saves", "ok"], ["reads", "failed"]])';

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  scene = [];
  nodesStore.setState({ nodes: {} });
  subagentNodesStore.setState({ agents: {}, dismissed: {} });
  await addTerminal("batman", "Batman");
  await addTerminal("robin", "Robin", { x: 2000, y: 0 });
});

describe("show_output", () => {
  it("answers what to fix in plain words, and shows nothing", async () => {
    const result = await call("batman", "show_output", { title: "T", ui: 'root = Stack([Foo("x"), a])' });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("Not shown: fix 2 problems");
    expect(text).toContain('Unknown component "Foo"');
    expect(text).toContain("Used but never defined: a.");
    expect(text).toContain("Call output_guide");
    expect(write).not.toHaveBeenCalled();
    expect(Object.values(nodesStore.getState().nodes).some((n) => n.kind === "output")).toBe(false);
    expect(textOf(await call("batman", "show_output", { title: "T", ui: "Just some text" }))).toContain("The first line must be the root statement");
  });

  it("shows a new output beside its agent, clear of its neighbours, wired to it, saved with its payload", async () => {
    const result = await call("batman", "show_output", { title: "Test\nrun", ui: UI });
    expect(result.isError).toBeUndefined();
    const id = /output ([\w-]+) \(/.exec(textOf(result))![1];
    expect(textOf(result)).toContain(`dummyplane://output/${id}`);
    const record = nodesStore.getState().nodes[id];
    expect(record).toMatchObject({ workspaceId: "w1", kind: "output", payload: { title: "Test run", source: "batman", ui: UI } });
    const element = scene.find((e) => e.id === id)!;
    expect(nodeKindOf(element)).toBe("output");
    expect(element.link).toBe(`dummyplane://output/${id}`);
    const source = scene.find((e) => e.id === "batman")!;
    // Right of its agent, not on top of it.
    expect(element.x).toBeGreaterThan(source.x + source.width);
    const wire = scene.find((e) => e.type === "arrow") as ExcalidrawArrowElement;
    expect([wire.startBinding?.elementId, wire.endBinding?.elementId]).toEqual(["batman", id]);
    // The wire upkeep keeps a wire to an output: it is no orphan.
    expect(orphanWires(scene)).toEqual([]);
  });

  it("updates its own output by id or link, refuses another agent's and one that is gone", async () => {
    const id = /output ([\w-]+) \(/.exec(textOf(await call("batman", "show_output", { title: "v1", ui: UI })))![1];
    const outputs = () => scene.filter((e) => nodeKindOf(e) === "output");
    const v2 = UI.replace("Tests", "Tests, again");
    const updated = await call("batman", "show_output", { title: "v2", ui: v2, output: `dummyplane://output/${id}` });
    expect(textOf(updated)).toBe(`Output ${id} updated (dummyplane://output/${id}).`);
    expect(outputs()).toHaveLength(1);
    expect(nodesStore.getState().nodes[id]).toMatchObject({ payload: { title: "v2", ui: v2 } });
    const robin = await call("robin", "show_output", { title: "mine", ui: UI, output: id });
    expect(robin.isError).toBe(true);
    expect(textOf(robin)).toContain("shown by another agent");
    scene = scene.map((e) => (e.id === id ? { ...e, isDeleted: true } : e));
    expect(textOf(await call("batman", "show_output", { title: "v3", ui: UI, output: id }))).toContain(`No output "${id}" on the canvas`);
    expect(textOf(await call("batman", "show_output", { title: "v3", ui: UI, output: "batman" }))).toContain('No output "batman"');
  });

  describe("without an output id", () => {
    const outputs = () => scene.filter((e) => nodeKindOf(e) === "output" && !e.isDeleted);
    const shownId = (result: { content: { text: string }[] }) => /new output ([\w-]+) \(/.exec(textOf(result))![1];

    it("updates its latest output in place, and makes no second node", async () => {
      const id = shownId(await call("batman", "show_output", { title: "v1", ui: UI }));
      const writes = write.mock.calls.length;
      const v2 = UI.replace("Tests", "Tests, again");
      const again = await call("batman", "show_output", { title: "v2", ui: v2 });
      expect(again.isError).toBeUndefined();
      expect(textOf(again)).toBe(
        `Your latest output ${id} updated in place (dummyplane://output/${id}), no new node made. To show another one beside it instead, call show_output with new: true.`,
      );
      expect(outputs().map((e) => e.id)).toEqual([id]);
      expect(Object.values(nodesStore.getState().nodes).filter((n) => n.kind === "output")).toHaveLength(1);
      expect(nodesStore.getState().nodes[id]).toMatchObject({ payload: { title: "v2", ui: v2, source: "batman" } });
      // In place: the scene is left as it is, no wire added.
      expect(write.mock.calls.length).toBe(writes);
    });

    it("shows another one beside it with new: true", async () => {
      const first = shownId(await call("batman", "show_output", { title: "one", ui: UI }));
      const second = await call("batman", "show_output", { title: "two", ui: UI, new: true });
      expect(textOf(second)).toContain("Shown beside your terminal as a new output");
      const id = shownId(second);
      expect(id).not.toBe(first);
      expect(outputs().map((e) => e.id).sort()).toEqual([first, id].sort());
      expect(nodesStore.getState().nodes[first]).toMatchObject({ payload: { title: "one" } });
      // Each is wired to its agent.
      const ends = scene.filter((e) => e.type === "arrow").map((e) => (e as ExcalidrawArrowElement).endBinding?.elementId);
      expect(ends.sort()).toEqual([first, id].sort());
    });

    it("updates the output shown or updated last, not the one made last", async () => {
      const now = vi.spyOn(Date, "now");
      try {
        now.mockReturnValue(1_000);
        const a = shownId(await call("batman", "show_output", { title: "a", ui: UI }));
        now.mockReturnValue(2_000);
        const b = shownId(await call("batman", "show_output", { title: "b", ui: UI, new: true }));
        now.mockReturnValue(3_000);
        await call("batman", "show_output", { title: "a2", ui: UI, output: a });
        now.mockReturnValue(4_000);
        expect(textOf(await call("batman", "show_output", { title: "a3", ui: UI }))).toContain(`Your latest output ${a} updated in place`);
        expect(nodesStore.getState().nodes[a]).toMatchObject({ payload: { title: "a3", updatedAt: 4_000 } });
        expect(nodesStore.getState().nodes[b]).toMatchObject({ payload: { title: "b", updatedAt: 2_000 } });
        expect(outputs()).toHaveLength(2);
      } finally {
        now.mockRestore();
      }
    });

    it("goes on updating the output it showed, not a copy the user made of it", async () => {
      const id = shownId(await call("batman", "show_output", { title: "v1", ui: UI }));
      // A copy (src/agents/terminals.ts) keeps the payload, its source and updatedAt included, and is drawn after it.
      const original = nodesStore.getState().nodes[id];
      if (original?.kind !== "output") throw new Error("no output");
      await nodesStore.getState().create("copy", { workspaceId: "w1", kind: "output", payload: { ...original.payload } });
      scene.push({ ...scene.find((e) => e.id === id)!, id: "copy", x: 3000 });
      expect(textOf(await call("batman", "show_output", { title: "v2", ui: UI }))).toContain(`Your latest output ${id} updated in place`);
      expect(nodesStore.getState().nodes[id]).toMatchObject({ payload: { title: "v2" } });
      expect(nodesStore.getState().nodes.copy).toMatchObject({ payload: { title: "v1" } });
    });

    it("makes a new node when its latest output was closed, or is no longer on the canvas", async () => {
      const closed = shownId(await call("batman", "show_output", { title: "v1", ui: UI }));
      scene = scene.map((e) => (e.id === closed ? { ...e, isDeleted: true } : e));
      const second = await call("batman", "show_output", { title: "v2", ui: UI });
      const id = shownId(second);
      expect(id).not.toBe(closed);
      expect(nodesStore.getState().nodes[closed]).toMatchObject({ payload: { title: "v1" } });
      // Its element gone from the scene, its row still in the store: not reused either.
      scene = scene.filter((e) => e.id !== id);
      expect(nodesStore.getState().nodes[id]).toBeDefined();
      const third = shownId(await call("batman", "show_output", { title: "v3", ui: UI }));
      expect([closed, id]).not.toContain(third);
      expect(outputs().map((e) => e.id)).toEqual([third]);
    });

    it("never updates another terminal's output", async () => {
      const robins = shownId(await call("robin", "show_output", { title: "Robin's", ui: UI }));
      const batmans = await call("batman", "show_output", { title: "Batman's", ui: UI });
      expect(textOf(batmans)).toContain("Shown beside your terminal as a new output");
      expect(shownId(batmans)).not.toBe(robins);
      expect(nodesStore.getState().nodes[robins]).toMatchObject({ payload: { title: "Robin's", source: "robin" } });
      // Robin's next call updates Robin's own, not Batman's newer one.
      expect(textOf(await call("robin", "show_output", { title: "Robin's, again", ui: UI }))).toContain(`Your latest output ${robins} updated in place`);
      expect(nodesStore.getState().nodes[shownId(batmans)]).toMatchObject({ payload: { title: "Batman's" } });
    });
  });

  describe("for an agent in a group", () => {
    const shownId = (result: { content: { text: string }[] }) => /new output ([\w-]+) \(/.exec(textOf(result))![1];
    const rect = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) => ({ x, y, width, height });
    const holds = (frame: ExcalidrawElement, e: ExcalidrawElement) =>
      e.x >= frame.x && e.y >= frame.y && e.x + e.width <= frame.x + frame.width && e.y + e.height <= frame.y + frame.height;
    const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted)!;

    /** `ids` in a group whose frame fits them, as Group makes it: their frameId set, the frame after them. */
    function group(...ids: string[]): string {
      const members = scene.filter((e) => ids.includes(e.id));
      const frame = createGroupFrame(frameAround(members.map(rect)), "Justice League", { role: "general", pantheon: "dc" });
      scene = [...scene.map((e) => (ids.includes(e.id) ? ({ ...e, frameId: frame.id } as ExcalidrawElement) : e)), frame];
      return frame.id;
    }

    it("shows the output inside the group, beside its agent: a member of the frame, which grows to hold it", async () => {
      const frameId = group("batman");
      const before = rect(live(frameId));
      const id = shownId(await call("batman", "show_output", { title: "Plan", ui: UI }));
      const output = live(id);
      const frame = live(frameId);
      const source = live("batman");
      expect(output.frameId).toBe(frameId);
      expect(holds(frame, output)).toBe(true);
      // Grown, never shrunk: its top-left corner stays, the agent still in it.
      expect(frame.x).toBe(before.x);
      expect(frame.y).toBe(before.y);
      expect(frame.width).toBeGreaterThan(before.width);
      expect(holds(frame, source)).toBe(true);
      // Right of its agent, its top level with the terminal's, as outside a group.
      expect(output.x).toBe(source.x + source.width + NODE_GAP);
      expect(output.y).toBe(source.y);
      // Excalidraw keeps a frame above its children: the output comes before it in the scene.
      expect(scene.findIndex((e) => e.id === id)).toBeLessThan(scene.findIndex((e) => e.id === frameId));
      const wire = scene.find((e) => e.type === "arrow" && !e.isDeleted) as ExcalidrawArrowElement;
      expect([wire.startBinding?.elementId, wire.endBinding?.elementId]).toEqual(["batman", id]);
      expect(orphanWires(scene)).toEqual([]);
    });

    it("keeps clear of the group's other members, and so does a second output", async () => {
      // Robin stands right of Batman, a column of the grid: the spot beside Batman is his.
      const batman = live("batman");
      scene = scene.map((e) => (e.id === "robin" ? ({ ...e, x: batman.x + batman.width + 32, y: batman.y } as ExcalidrawElement) : e));
      const frameId = group("batman", "robin");
      const first = shownId(await call("batman", "show_output", { title: "one", ui: UI }));
      const second = shownId(await call("batman", "show_output", { title: "two", ui: UI, new: true }));
      const frame = live(frameId);
      const nodes = ["batman", "robin", first, second].map(live);
      for (const id of [first, second]) {
        expect(live(id).frameId).toBe(frameId);
        expect(holds(frame, live(id))).toBe(true);
      }
      for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) expect(overlap(rect(a), rect(b))).toBe(0);
    });

    it("leaves an agent in no group as it was: its output in no frame, clear of every group", async () => {
      const frameId = group("batman");
      const id = shownId(await call("robin", "show_output", { title: "Robin's", ui: UI }));
      const output = live(id);
      expect(output.frameId).toBeNull();
      expect(overlap(rect(output), rect(live(frameId)))).toBe(0);
      expect(output.x).toBeGreaterThan(live("robin").x + live("robin").width);
    });

    it("keeps a frame drawn by hand out: an output never joins a plain frame", async () => {
      const frame = { ...createGroupFrame(frameAround([rect(live("batman"))]), "Sketch", { role: "general", pantheon: "dc" }), customData: undefined } as ExcalidrawElement;
      scene = [...scene.map((e) => (e.id === "batman" ? ({ ...e, frameId: frame.id } as ExcalidrawElement) : e)), frame];
      const id = shownId(await call("batman", "show_output", { title: "Plan", ui: UI }));
      expect(live(id).frameId).toBeNull();
      expect(overlap(rect(live(id)), rect(live(frame.id)))).toBe(0);
    });
  });

  it("output_guide gives the whole language", async () => {
    const guide = textOf(await call("batman", "output_guide", {}));
    expect(guide).toContain("root = Stack(");
    expect(guide).toContain("BarChart(");
  });

  describe("for a Fleet", () => {
    /** A Fleet on the canvas, as a team agent stands on it: the output goes beside its own node. */
    async function addFleet(at = { x: 5000, y: 0 }) {
      await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet" } });
      scene.push({ ...createNodeElement("fleet", at), id: "chef" } as unknown as ExcalidrawElement);
    }
    const names = async (nodeId: string) => ((await answer({ callId: 1, nodeId, method: "tools/list", params: {} })) as { tools: { name: string }[] }).tools.map((t) => t.name);
    const shownId = (result: { content: { text: string }[] }) => /new output ([\w-]+) \(/.exec(textOf(result))![1];

    it("lists show_output and output_guide, which no agent had to draw for it", async () => {
      await addFleet();
      expect(await names("chef")).toEqual(expect.arrayContaining(["show_output", "output_guide"]));
      // The Manager keeps the guide alone: its summary is finish's.
      await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "manager", fleet: "chef" } });
      const manager = await names("boss");
      expect(manager).toContain("output_guide");
      expect(manager).not.toContain("show_output");
      expect((await call("boss", "show_output", { title: "T", ui: UI })).isError).toBe(true);
    });

    it("shows an output beside its own node, wired to it, and updates it in place", async () => {
      await addFleet();
      const result = await call("chef", "show_output", { title: "Plan", ui: UI });
      expect(result.isError).toBeUndefined();
      const id = shownId(result);
      const fleet = scene.find((e) => e.id === "chef")!;
      const output = scene.find((e) => e.id === id)!;
      expect(nodeKindOf(output)).toBe("output");
      // Right of the Fleet, no node under it.
      expect(output.x).toBeGreaterThanOrEqual(fleet.x + fleet.width);
      expect(nodesStore.getState().nodes[id]).toMatchObject({ kind: "output", payload: { title: "Plan", source: "chef" } });
      // A wire joins them, and it is no team link: an output is not an agent of the Fleet.
      expect(scene.some((e) => e.type === "arrow" && !e.isDeleted && [(e as ExcalidrawArrowElement).startBinding?.elementId, (e as ExcalidrawArrowElement).endBinding?.elementId].sort().join() === ["chef", id].sort().join())).toBe(true);
      expect(fleetTargets(scene, "chef")).toEqual({ groupIds: [], nodeIds: [] });
      // A second call without output updates it: no second node.
      const again = await call("chef", "show_output", { title: "Plan", ui: UI });
      expect(textOf(again)).toContain(`Your latest output ${id} updated in place`);
      expect(scene.filter((e) => nodeKindOf(e) === "output")).toHaveLength(1);
      // An agent cannot update the Fleet's output, nor read it as its own.
      expect(textOf(await call("robin", "show_output", { title: "x", ui: UI, output: id }))).toContain("was shown by another agent");
    });

    it("answers what to fix in plain words, as for an agent", async () => {
      await addFleet();
      expect(textOf(await call("chef", "show_output", { title: "T", ui: "Just some text" }))).toContain("The first line must be the root statement");
    });
  });

  it("keeps its description short and names every component", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string; description: string }[] };
    const show = list.tools.find((t) => t.name === "show_output")!;
    for (const name of ["Stack", "Table", "Callout", "BarChart", "Button"]) expect(show.description).toContain(name);
    // What a call does, said plainly: an agent that lost an output's id updates it rather than piling up new ones.
    for (const said of ["A call without output updates your latest output in place", "output: <id> updates that one", "new: true shows another one beside it"]) {
      expect(show.description).toContain(said);
    }
    const schema = (show as unknown as { inputSchema: { properties: Record<string, { type: string }>; required: string[] } }).inputSchema;
    expect(schema.properties.new.type).toBe("boolean");
    expect(schema.required).toEqual(["title", "ui"]);
    // Every session pays for it: a few lines, the full guide behind output_guide.
    expect(show.description.length).toBeLessThan(700);
    expect(list.tools.find((t) => t.name === "read_node")!.description).toContain("link the user pasted");
  });
});

describe("read_node", () => {
  it("reads a terminal from its link, without a wire: its name, state, task and screen", async () => {
    nodesStore.getState().update("robin", { task: "Run the tests", lastReport: { status: "failed", summary: "3 failed" } });
    const text = textOf(await call("batman", "read_node", { link: "dummyplane://terminal/robin", lines: 20 }));
    expect(text).toContain("Terminal Robin (Claude), stopped.");
    expect(text).toContain("Its task: Run the tests");
    expect(text).toContain("Its last report (failed): 3 failed");
    expect(text).toContain("$ npm test\n3 failed");
    expect(terminalText).toHaveBeenCalledWith("robin", 20);
  });

  it("reads a subagent's type, prompt and result, the link the user pasted in their example", async () => {
    subagentNodesStore.getState().upsert({ nodeId: "robin", agentId: "a1", agentType: "general-purpose", description: "Check the PR", state: "done" });
    subagentNodesStore.getState().setElement("a1", "0b6281ac-efce-4308-9d6f-353a222289c0");
    subagentNodesStore.getState().append("a1", [
      { kind: "prompt", text: "Check PR #12 with gh" },
      { kind: "tool", text: "Bash(gh pr view 12)" },
      { kind: "report", text: "The PR is fine." },
    ]);
    const result = await call("batman", "read_node", { link: "dummyplane://subagent/0b6281ac-efce-4308-9d6f-353a222289c0" });
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain("Subagent general-purpose (done), run by Robin.");
    expect(text).toContain("Asked: Check the PR");
    expect(text).toContain("Its prompt:\nCheck PR #12 with gh");
    expect(text).toContain("Its result:\nThe PR is fine.");
    expect(text).toContain("[tool] Bash(gh pr view 12)");
  });

  it("gives a subagent's last words as its result once done, never a tool's output, and says when dummyPlane cut it", async () => {
    subagentNodesStore.getState().upsert({ nodeId: "robin", agentId: "a2", agentType: "Explore", state: "running" });
    subagentNodesStore.getState().setElement("a2", "el-2");
    subagentNodesStore.getState().append("a2", [
      { kind: "prompt", text: "Find the hooks" },
      { kind: "text", text: "Looking." },
      { kind: "tool", text: "Grep(hook)" },
      { kind: "result", text: "claude_settings.rs:31" },
    ]);
    const running = textOf(await call("batman", "read_node", { link: "dummyplane://subagent/el-2" }));
    expect(running).toContain("Still running: no result yet.");
    expect(running).not.toContain("Its result:\nclaude_settings.rs:31");
    subagentNodesStore.getState().append("a2", [{ kind: "text", text: `${"x".repeat(3999)}…` }]);
    subagentNodesStore.getState().upsert({ nodeId: "robin", agentId: "a2", agentType: "Explore", state: "done" });
    const done = textOf(await call("batman", "read_node", { link: "dummyplane://subagent/el-2" }));
    expect(done).toContain(`Its result:\n${"x".repeat(3999)}…\n(dummyPlane keeps the first 4,000 characters`);
  });

  it("reads an output's title and its content as text", async () => {
    const id = /output ([\w-]+) \(/.exec(textOf(await call("robin", "show_output", { title: "Tests", ui: UI })))![1];
    const text = textOf(await call("batman", "read_node", { link: `dummyplane://output/${id}` }));
    expect(text).toContain('Output "Tests", shown by Robin');
    expect(text).toContain("# Tests");
    expect(text).toContain("| reads | failed |");
  });

  it("says why when a link reads nothing", async () => {
    expect(textOf(await call("batman", "read_node", {}))).toContain("Give the node's link");
    expect(textOf(await call("batman", "read_node", { link: "https://example.com" }))).toContain("is not a dummyPlane link");
    expect(textOf(await call("batman", "read_node", { link: "dummyplane://teapot/x1" }))).toContain("is not a dummyPlane link");
    expect(textOf(await call("batman", "read_node", { link: "dummyplane://terminal/nobody" }))).toContain("Nothing in dummyPlane answers to dummyplane://terminal/nobody");
    expect(textOf(await call("batman", "read_node", { link: "dummyplane://subagent/gone" }))).toContain("lasts only as long as the Claude session");
  });

  describe("by the name a mission lists", () => {
    const listed = (nodeId: string, name: string): Member => ({ nodeId, name, task: "Login form", budgetMin: 20, linked: false, branch: "dummyplane/login-superman", worktree: "w", sentAt: 1 });
    const mission = (...members: Member[]) =>
      nodesStore.getState().update("chef", { mission: { state: "en_cours", maxAgents: 4, members, startedAt: Date.now() } });
    beforeEach(async () => {
      await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
    });

    it("reads a member the Fleet's team lists, by its name or the start of its id, as it reads a link", async () => {
      await addTerminal("85a6b1c0-1111", "Superman");
      mission(listed("85a6b1c0-1111", "Superman"));
      expect(textOf(await call("chef", "read_node", { link: "superman" }))).toContain("Terminal Superman");
      expect(textOf(await call("chef", "read_node", { link: "85a6b1" }))).toContain("Terminal Superman");
    });

    // A stopped agent of the mission read "Nothing answers to Superman now", while `team` still listed it (13 Nov, 4 times).
    it("says a member whose terminal is gone is stopped, with what the mission kept of it, not that nothing answers", async () => {
      mission({ ...listed("ff8dcb00-2222", "Celaena"), report: { summary: "Form done, tests green", status: "termine", at: 5 } });
      for (const link of ["Celaena", "ff8dcb", "dummyplane://terminal/ff8dcb00-2222"]) {
        const result = await call("chef", "read_node", { link });
        expect(result.isError).toBeUndefined();
        const text = textOf(result);
        expect(text).toContain("Celaena is stopped, and its terminal is gone");
        expect(text).toContain("Its task: Login form");
        expect(text).toContain("Form done, tests green");
        expect(text).not.toContain("Nothing in dummyPlane answers");
      }
    });

    it("reads only the missions the caller runs or works for", async () => {
      mission(listed("ff8dcb00-2222", "Celaena"));
      expect(textOf(await call("batman", "read_node", { link: "Celaena" }))).toContain("Nothing in dummyPlane answers to Celaena");
      // Its Manager, and a teammate, are of that mission.
      await nodesStore.getState().update("chef", { mission: { state: "en_cours", maxAgents: 4, manager: "robin", members: [listed("ff8dcb00-2222", "Celaena"), listed("batman", "Batman")], startedAt: 1 } });
      expect(textOf(await call("robin", "read_node", { link: "Celaena" }))).toContain("Celaena is stopped");
      expect(textOf(await call("batman", "read_node", { link: "Celaena" }))).toContain("Celaena is stopped");
    });

    // `mission` lists "Superman" as a linked agent, one the Fleet is wired to and the team has not taken yet: read_node("Superman") failed.
    it("reads an agent wired to the Fleet by the name mission lists it under, and the Manager by its name", async () => {
      await addTerminal("boss", "Manager", { x: 4000, y: 0 }, { role: "manager", fleet: "chef" });
      const chef = { ...createNodeElement("fleet", { x: 6000, y: 0 }), id: "chef" } as unknown as ExcalidrawElement;
      rememberScene("w1", withWire([...scene, chef], "chef", "robin") as never, {} as never, {}, []);
      try {
        expect(textOf(await call("chef", "read_node", { link: "Robin" }))).toContain("Terminal Robin");
        mission();
        nodesStore.getState().update("chef", { mission: { state: "en_cours", maxAgents: 4, manager: "boss", members: [], startedAt: 1 } });
        expect(textOf(await call("chef", "read_node", { link: "Manager" }))).toContain("Terminal Manager");
        // An agent nothing wires to it is none of its business.
        expect(textOf(await call("chef", "read_node", { link: "Batman" }))).toContain("Nothing in dummyPlane answers to Batman");
      } finally {
        forgetScene("w1");
      }
    });

    it("reads an agent linked to the caller by its name", async () => {
      scene = withAgentLink(scene, "batman", "robin");
      expect(textOf(await call("batman", "read_node", { link: "Robin" }))).toContain("Terminal Robin");
    });
  });

  it("is everyone's: a fleet reads a pasted link too", async () => {
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet" } });
    const result = await call("chef", "read_node", { link: "dummyplane://terminal/robin" });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Terminal Robin");
  });
});

describe("a report written in OpenUI Lang", () => {
  it("is kept to be drawn, while its parent hears it as text on one line", async () => {
    nodesStore.getState().update("robin", { spawnedBy: "batman" });
    terminalStatusStore.getState().set("batman", { state: "running" });
    const result = await call("robin", "report", { summary: UI, status: "done" });
    expect(result.isError).toBeUndefined();
    const report = terminalOf(nodesStore.getState().nodes.robin)?.lastReport;
    expect(report?.ui).toBe(UI);
    expect(report?.summary).toBe("# Tests\n\n| Test | Result |\n| --- | --- |\n| saves | ok |\n| reads | failed |");
    const line = vi.mocked(notify).mock.calls.find(([to]) => to === "batman")![1];
    expect(line).toContain("Robin reported (done): # Tests | Test | Result |");
    expect(line).not.toContain("root =");
    terminalStatusStore.getState().remove("batman");
  });

  it("alerts a main agent's finish with its text's first line, never its program", async () => {
    const heard: FinishSignal[] = [];
    const unlisten = onFinish((signal) => heard.push(signal));
    await call("batman", "report", { summary: UI, status: "done" });
    unlisten();
    expect(heard).toEqual([{ nodeId: "batman", state: "done", summary: "# Tests\n\n| Test | Result |\n| --- | --- |\n| saves | ok |\n| reads | failed |" }]);
    expect(summaryLine(heard[0].summary)).toBe("Tests");
  });

  it("refuses a summary that starts like OpenUI Lang but cannot be drawn, before anything is recorded", async () => {
    nodesStore.getState().update("robin", { spawnedBy: "batman" });
    const result = await call("robin", "report", { summary: 'root = Stack([Text("kept"), Foo("lost")])', status: "done" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Not taken: your summary starts like OpenUI Lang");
    expect(textOf(result)).toContain('Unknown component "Foo"');
    expect(terminalOf(nodesStore.getState().nodes.robin)?.lastReport).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("leaves a Markdown summary as it is, with no program", async () => {
    nodesStore.getState().update("robin", { spawnedBy: "batman" });
    await call("robin", "report", { summary: "All **green**", status: "done" });
    expect(terminalOf(nodesStore.getState().nodes.robin)?.lastReport).toEqual({ status: "done", summary: "All **green**" });
  });

  it("tells agents and fleets that OpenUI Lang is welcome where they write long text", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string; inputSchema: { properties: Record<string, { description?: string }> } }[] };
    expect(list.tools.find((t) => t.name === "report")!.inputSchema.properties.summary.description).toContain("OpenUI Lang");
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet" } });
    const fleet = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as typeof list;
    expect(fleet.tools.some((t) => t.name === "output_guide")).toBe(true);
    // The Manager writes the mission's summary (finish): in OpenUI Lang too.
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "manager", fleet: "chef" } });
    const manager = (await answer({ callId: 1, nodeId: "boss", method: "tools/list", params: {} })) as typeof list;
    expect(manager.tools.find((t) => t.name === "finish")!.inputSchema.properties.summary.description).toContain("OpenUI Lang");
    expect(manager.tools.some((t) => t.name === "output_guide")).toBe(true);
    expect(textOf(await call("chef", "output_guide", {}))).toContain("root = Stack(");
  });
});
