// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import type { GoToItem } from "./goTo";
import { GoToRow } from "./GoToRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item: GoToItem = { key: "t:a", kind: "terminal", label: "Thoth", keywords: [], targetId: "a", agent: "claude" };
const terminal = (lastReport?: { status: "done" | "blocked" | "failed"; summary: string }) => ({
  workspaceId: "w1",
  kind: "terminal",
  payload: { title: "Thoth", name: "Thoth", agent: "claude", cwd: "C:/code", shell: "default", command: "", lastReport },
});

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  terminalStatusStore.setState({ statuses: { a: { state: "running" } } });
  agentActivityStore.setState({ activities: { a: { activity: "idle", since: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {} });
  agentActivityStore.setState({ activities: {} });
});

async function status(record: ReturnType<typeof terminal>) {
  nodesStore.setState({ nodes: { a: record } } as never);
  await act(async () => root.render(<GoToRow item={item} />));
  return host.textContent;
}

it("says Ready for an agent at rest that has not reported", async () => {
  expect(await status(terminal())).toContain("Ready");
});

it("says what its last report said, not Ready, once an agent reported and rests", async () => {
  expect(await status(terminal({ status: "done", summary: "All green" }))).toContain("Done");
  expect(await status(terminal({ status: "blocked", summary: "Needs a key" }))).toContain("Blocked");
  expect(await status(terminal({ status: "failed", summary: "Tests fail" }))).toContain("Failed");
});

it("says Working as soon as the agent works again, whatever it reported", async () => {
  agentActivityStore.setState({ activities: { a: { activity: "working", since: 1 } } });
  expect(await status(terminal({ status: "done", summary: "All green" }))).toContain("Working");
});
