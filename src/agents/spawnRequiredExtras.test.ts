// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { createNodeElement } from "@/canvas/nodeElement";
import { answer } from "@/mcp/router";
import { NEW_MISSION } from "@/mission/mission";
import { fleetSession } from "@/nodes/terminal/launch";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { addTerminal } from "./terminals";

/**
 * spawn_agent's skills, mcp_servers and plugins are required of the MCP tool call (`REQUIRED_EXTRA_KINDS`), an agent's
 * and a Fleet's alike: a kind left out would be its CLI's defaults, i.e. everything it loads. `[]` is a pick of none.
 */

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 0) }));
vi.mock("@/mission/ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/mission/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mission/store")>()),
  workspaceCanvas: vi.fn(() => ({ frames: [], links: {} })),
}));
vi.mock("@/mission/folder", () => ({ missionFolder: vi.fn(() => "C:/code/project") }));
vi.mock("./naming", () => ({ nameForNewAgent: vi.fn(() => Promise.resolve("Robin")), pantheonForNewGroup: vi.fn(() => "norse") }));
vi.mock("./terminals", () => ({ addTerminal: vi.fn() }));
vi.mock("./spawnTree", async (importOriginal) => ({ ...(await importOriginal<typeof import("./spawnTree")>()), reflowSpawnTree: vi.fn(() => true) }));

let scene: ExcalidrawElement[] = [];
vi.mock("./sceneAccess", () => ({ sceneAccess: vi.fn(() => ({ shown: true, elements: () => scene, write: (next: readonly ExcalidrawElement[]) => (scene = [...next]) })) }));

const running = (id: string) => terminalStatusStore.getState().set(id, { state: "running" });

async function addFleet() {
  const session = fleetSession("Fleet", { cwd: "C:/code/elsewhere", shell: "pwsh" }, "claude");
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, mission: { ...NEW_MISSION } } });
  scene.push({ ...createNodeElement("fleet", { x: 0, y: 0 }), id: "fleet" } as unknown as ExcalidrawElement);
  running("fleet");
}

async function addAgent() {
  const payload: TerminalPayload = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code/wt", shell: "pwsh", command: "", claudeSessionId: "s" };
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload });
  scene.push({ ...createNodeElement("terminal", { x: 0, y: 0 }), id: "batman" } as unknown as ExcalidrawElement);
  running("batman");
}

/** An MCP tools/call, as the router receives it from a session. */
const call = (nodeId: string, name: string, args: Record<string, unknown>) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } }) as Promise<{ content: { text: string }[]; isError?: boolean }>;
const spawn = (nodeId: string, args: Record<string, unknown>) => call(nodeId, "spawn_agent", { task: "Ship it", ...args });

/** The three required kinds, as the tool names them. */
const KINDS = ["skills", "mcp_servers", "plugins"] as const;
const NONE = { skills: [], mcp_servers: [], plugins: [] };

/** What Rust is asked to check (`check_subagent_extras`); it answers with the pick it was given. */
let checks: Record<string, string[]>[] = [];
let created = 0;

beforeEach(async () => {
  modelRouterStore.setState({ on: false, levels: {} });
  checks = [];
  mockIPC((cmd, args) => {
    if (cmd !== "check_subagent_extras") return undefined;
    const { pick } = args as { pick: Record<string, string[]> };
    checks.push(pick);
    return pick;
  });
  vi.clearAllMocks();
  scene = [];
  created = 0;
  subagentSettingsStore.setState({ terminals: true, maxSpawned: 50 });
  nodesStore.setState({ nodes: {} });
  for (const id of Object.keys(terminalStatusStore.getState().statuses)) terminalStatusStore.getState().remove(id);
  vi.mocked(addTerminal).mockImplementation(async (_workspaceId, payload, center) => {
    const id = `child${++created}`;
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
    scene.push({ ...createNodeElement("terminal", center), id } as unknown as ExcalidrawElement);
    return id;
  });
  await addAgent();
  await addFleet();
});

describe("spawn_agent requires skills, mcp_servers and plugins", () => {
  it("lists all three as required to an agent and to a Fleet, beside the task", async () => {
    for (const nodeId of ["batman", "fleet"]) {
      const list = (await answer({ callId: 1, nodeId, method: "tools/list", params: {} })) as { tools: { name: string; inputSchema: { required: string[] } }[] };
      expect(list.tools.find((tool) => tool.name === "spawn_agent")!.inputSchema.required).toEqual(["task", ...KINDS]);
    }
  });

  for (const nodeId of ["batman", "fleet"]) {
    describe(nodeId === "fleet" ? "a Fleet's call" : "an agent's call", () => {
      for (const kind of KINDS) {
        for (const [how, gap] of [
          ["missing", undefined],
          ["null", null],
        ] as const) {
          it(`refuses a call with ${kind} ${how}, naming it, and opens nothing`, async () => {
            const result = await spawn(nodeId, { ...NONE, [kind]: gap });
            expect(result.isError).toBe(true);
            const text = result.content[0].text;
            expect(text).toContain(`Not opened: ${kind} is required.`);
            // What it names is only what is missing: the other two were given.
            for (const other of KINDS.filter((k) => k !== kind)) expect(text).not.toContain(`${other} is required`);
            // Actionable: where the names are, and that [] is none.
            expect(text).toContain("Call installed_extras");
            expect(text).toContain("or [] for none");
            expect(text).toContain("Nothing was started.");
            expect(addTerminal).not.toHaveBeenCalled();
            expect(checks).toEqual([]);
          });
        }
      }

      it("names every kind a call leaves out, a call with none of them included", async () => {
        const both = await spawn(nodeId, { skills: [] });
        expect(both.isError).toBe(true);
        expect(both.content[0].text).toContain("mcp_servers and plugins are required.");
        const all = await spawn(nodeId, {});
        expect(all.content[0].text).toContain("skills, mcp_servers and plugins are required.");
        expect(addTerminal).not.toHaveBeenCalled();
        expect(checks).toEqual([]);
      });

      it("opens a sub-agent with no skills, no plugins and only dummyplane's server when all three are []", async () => {
        const result = await spawn(nodeId, NONE);
        expect(result.isError).toBeUndefined();
        expect(checks).toEqual([{ skills: [], mcpServers: [], plugins: [] }]);
        expect(vi.mocked(addTerminal).mock.calls[0][1].extras).toEqual({ skills: [], mcpServers: [], plugins: [] });
        expect(result.content[0].text).toContain("It gets no skills; no MCP server but dummyplane; no plugins.");
      });

      it("opens a sub-agent with the names it was given, as before", async () => {
        const result = await spawn(nodeId, { skills: ["deploy"], mcp_servers: ["github"], plugins: ["stripe@market"] });
        expect(result.isError).toBeUndefined();
        expect(checks).toEqual([{ skills: ["deploy"], mcpServers: ["github"], plugins: ["stripe@market"] }]);
        expect(vi.mocked(addTerminal).mock.calls[0][1].extras).toEqual({ skills: ["deploy"], mcpServers: ["github"], plugins: ["stripe@market"] });
        expect(result.content[0].text).toContain("It gets skills deploy; MCP servers github; plugins stripe@market.");
      });

      it("still refuses a kind that is no list of names, saying [] is none and not offering to leave it out", async () => {
        const result = await spawn(nodeId, { ...NONE, skills: "deploy" });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe("Not opened: skills must be a list of names, as installed_extras gives them: [] for none.");
        expect(addTerminal).not.toHaveBeenCalled();
      });
    });
  }
});
