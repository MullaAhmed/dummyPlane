// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement, nodeKindOf } from "@/canvas/nodeElement";
import { terminalText } from "@/nodes/terminal/registry";
import { subagentNodesStore } from "@/nodes/subagent/store";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { notify } from "@/mission/events";
import { answer } from "./router";
import { orphanWires } from "@/agents/wires";
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

  it("is an agent's tool: a fleet is refused it, and output_guide gives the whole language", async () => {
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet" } });
    expect(textOf(await call("chef", "show_output", { title: "T", ui: UI }))).toBe("This tool is for agents.");
    const guide = textOf(await call("batman", "output_guide", {}));
    expect(guide).toContain("root = Stack(");
    expect(guide).toContain("BarChart(");
  });

  it("keeps its description short and names every component", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string; description: string }[] };
    const show = list.tools.find((t) => t.name === "show_output")!;
    for (const name of ["Stack", "Table", "Callout", "BarChart", "Button"]) expect(show.description).toContain(name);
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
    expect(fleet.tools.find((t) => t.name === "finish")!.inputSchema.properties.summary.description).toContain("OpenUI Lang");
    expect(fleet.tools.some((t) => t.name === "output_guide")).toBe(true);
    expect(textOf(await call("chef", "output_guide", {}))).toContain("root = Stack(");
  });
});
