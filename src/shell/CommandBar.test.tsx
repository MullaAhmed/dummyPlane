// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import type { SceneFrame } from "@/canvas/groups";
import { sendCommand } from "@/fleet/broadcast";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { CommandBar } from "./CommandBar";

vi.mock("@/fleet/broadcast", () => ({ sendCommand: vi.fn(() => Promise.resolve()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = (name: string): NodeRecord => ({
  workspaceId: "w1",
  kind: "terminal",
  payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
});

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.mocked(sendCommand).mockClear();
  nodesStore.setState({ nodes: { t1: terminal("Thoth"), t2: terminal("Zeus") } });
  canvasStore.setState({ nodeIds: ["t1", "t2"], frames: [], view: EMPTY_VIEW });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<CommandBar />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
  canvasStore.setState({ nodeIds: [], frames: [], view: EMPTY_VIEW });
  nodesStore.setState({ nodes: {} });
});

const field = () => host.querySelector("textarea")!;
const sendButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
const select = (ids: string[]) => act(async () => canvasStore.setState({ view: { ...EMPTY_VIEW, selectedIds: ids } }));

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(field(), value);
    field().setSelectionRange(value.length, value.length);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("enables Send for a selected terminal once an instruction is typed, and sends to it", async () => {
  await select(["t1"]);
  expect(sendButton().disabled).toBe(true);
  await type("run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
});

it("keeps Send grey with nothing selected and no @, saying how to target", async () => {
  await type("run tests");
  expect(sendButton().disabled).toBe(true);
  expect(sendButton().title).toBe("Select agents or type @");
  expect(host.textContent).toContain("Select agents or type @");
});

it("enables Send with nothing selected for @thoth", async () => {
  await type("@thoth run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
});

it("names an unnamed terminal after its agent: @claude targets it", async () => {
  await act(async () => nodesStore.setState({ nodes: { t1: terminal(""), t2: terminal("Zeus") } }));
  await type("@claude run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
});

it("sends to the members of a selected group frame", async () => {
  const group: SceneFrame = {
    id: "g1",
    name: "Back",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    group: { role: "general", pantheon: "egypt" },
    memberIds: ["t1", "t2"],
  } as SceneFrame;
  await act(async () => canvasStore.setState({ frames: [group] }));
  await select(["g1"]);
  await type("run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["t1", "t2"], "run tests");
});

it("does not count a selected node that is not a loaded terminal", async () => {
  await select(["orphan"]);
  await type("run tests");
  expect(sendButton().disabled).toBe(true);
});
