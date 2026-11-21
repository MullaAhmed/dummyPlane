// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { resumeTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { offerResumeAll, RESUME_OFFER_LINE, RESUME_OFFER_ROOM, resumeOfferRoom, resumeOfferStore } from "./ResumeAllToast";

vi.mock("sonner", () => ({ toast: { custom: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/nodes/terminal/registry", () => ({ isLiveInRust: () => false, resumeTerminal: vi.fn() }));
// Every element of the fake scene is a node on the canvas.
vi.mock("@/canvas/sceneSync", () => ({ liveNodeIds: (elements: readonly { id: string }[]) => elements.map((e) => e.id) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = (workspaceId: string, payload: Partial<TerminalPayload>): NodeRecord =>
  ({ workspaceId, kind: "terminal", payload: { title: "T", agent: "claude", cwd: "C:/code", shell: "default", command: "", name: "", ...payload } }) as NodeRecord;
const report = { status: "done", summary: "Fixed." } as const;

let host: HTMLDivElement;
let root: Root;
let workspace = 0;

/** A workspace restored after a restart: a top agent, a sub-agent still at work and one that reported, all stopped. */
function restored(withWorking = true): string {
  const id = `w${++workspace}`;
  const nodes: Record<string, NodeRecord> = {
    [`${id}-top`]: terminal(id, { name: "Batman" }),
    [`${id}-done`]: terminal(id, { name: "Cyborg", spawnedBy: `${id}-top`, lastReport: report }),
  };
  if (withWorking) nodes[`${id}-working`] = terminal(id, { name: "Flash", spawnedBy: `${id}-top` });
  nodesStore.setState({ nodes });
  terminalStatusStore.setState({ statuses: {} });
  const elements = Object.keys(nodes).map((nodeId) => ({ id: nodeId }));
  canvasStore.setState({ api: { getSceneElements: () => elements } as never });
  return id;
}

/** Shows the toast `offerResumeAll` handed to sonner. */
async function showOffer() {
  const render = vi.mocked(toast.custom).mock.lastCall![0] as (id: string | number) => ReactNode;
  await act(async () => root.render(render("offer")));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resumeOfferStore.setState({ open: false, leftOut: undefined });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  canvasStore.setState({ api: null });
});

it("resumes the top agent and the working sub-agent, and leaves the finished sub-agent stopped", async () => {
  const id = restored();
  offerResumeAll(id);
  expect(toast.custom).toHaveBeenCalledTimes(1);
  await showOffer();
  expect(host.textContent).toContain("2 consoles can resume their last conversation");
  const yes = [...host.querySelectorAll("button")].find((button) => button.textContent === "Yes")!;
  await act(async () => yes.click());
  await act(async () => vi.runAllTimers());
  expect(vi.mocked(resumeTerminal).mock.calls.map(([nodeId]) => nodeId).sort()).toEqual([`${id}-top`, `${id}-working`]);
});

it("does not start a second time a terminal restarted before its turn came (review 12 Nov)", async () => {
  const id = restored();
  offerResumeAll(id);
  await showOffer();
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Yes")!.click());
  // Its menu restarted Flash while it waited for its turn in the stagger.
  terminalStatusStore.getState().restart(`${id}-working`, 1);
  try {
    await act(async () => vi.runAllTimers());
    expect(vi.mocked(resumeTerminal).mock.calls.map(([nodeId]) => nodeId)).toEqual([`${id}-top`]);
  } finally {
    terminalStatusStore.setState({ restarts: {} });
  }
});

it("does not start again a terminal running before its turn came: its mission's restore resumed it", async () => {
  const id = restored();
  offerResumeAll(id);
  await showOffer();
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Yes")!.click());
  // The Fleet's resume restored its mission: Flash runs again while it waited for its turn in the stagger.
  terminalStatusStore.getState().set(`${id}-working`, { state: "running" });
  await act(async () => vi.runAllTimers());
  expect(vi.mocked(resumeTerminal).mock.calls.map(([nodeId]) => nodeId)).toEqual([`${id}-top`]);
});

it("says what it leaves out, and the agents panel keeps a line more for it", async () => {
  const id = restored();
  offerResumeAll(id);
  await showOffer();
  expect(host.textContent).toContain("1 finished sub-agent stays stopped");
  expect(resumeOfferStore.getState()).toEqual({ open: true, leftOut: true });
  expect(resumeOfferRoom(resumeOfferStore.getState())).toBe(RESUME_OFFER_ROOM + RESUME_OFFER_LINE);
});

it("offers nothing when the only stopped terminals left are finished sub-agents", () => {
  const id = restored(false);
  // The top agent runs again: only the finished sub-agent is stopped.
  terminalStatusStore.getState().set(`${id}-top`, { state: "running" });
  offerResumeAll(id);
  expect(toast.custom).not.toHaveBeenCalled();
  expect(resumeOfferStore.getState().open).toBe(false);
});

it("keeps its usual room and words when no finished sub-agent is stopped", async () => {
  const id = restored();
  // New work typed into it cleared its report: it is at work again.
  const { nodes } = nodesStore.getState();
  nodesStore.setState({ nodes: { ...nodes, [`${id}-done`]: terminal(id, { name: "Cyborg", spawnedBy: `${id}-top` }) } });
  offerResumeAll(id);
  await showOffer();
  expect(host.textContent).toContain("3 consoles can resume their last conversation");
  expect(host.textContent).not.toContain("stopped");
  expect(resumeOfferRoom(resumeOfferStore.getState())).toBe(RESUME_OFFER_ROOM);
});
