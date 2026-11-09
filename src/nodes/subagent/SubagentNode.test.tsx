// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { removeNode } from "@/fleet/terminals";
import { nodesStore } from "@/store/nodes";
import { subagentNodesStore } from "./store";
import { SubagentNode } from "./SubagentNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/fleet/terminals", () => ({ removeNode: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  nodesStore.setState({
    nodes: { n1: { workspaceId: "w1", kind: "terminal", payload: { title: "T", name: "Horus", agent: "claude", cwd: "C:/code", shell: "default", command: "" } } },
  });
  subagentNodesStore.setState({ agents: {}, dismissed: {} });
  subagentNodesStore.getState().upsert({ nodeId: "n1", agentId: "a1", agentType: "Explore", description: "Find the hooks", state: "running" });
  subagentNodesStore.getState().upsert({ nodeId: "n1", agentId: "a2", agentType: "Plan", parentAgentId: "a1", state: "running" });
  subagentNodesStore.getState().setElement("a1", "el-1");
  subagentNodesStore.getState().setElement("a2", "el-2");
  subagentNodesStore.getState().append("a1", [
    { kind: "prompt", text: "Find where hooks are registered" },
    { kind: "tool", text: "Grep(SubagentStart)" },
    { kind: "result", text: "claude_settings.rs:31" },
  ]);
});

async function render(nodeId: string) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<SubagentNode nodeId={nodeId} />));
  return { host, root };
}

it("shows its terminal, its title and its transcript as terminal lines, and turns grey when done", async () => {
  const { host, root } = await render("el-1");
  const node = host.querySelector<HTMLElement>("[data-subagent='a1']")!;
  expect(node.dataset.state).toBe("running");
  expect(node.querySelector("header")?.textContent).toContain("↳ Horus ›");
  expect(node.querySelector("header")?.textContent).toContain("Explore · Find the hooks");
  expect(node.textContent).toContain("Grep(SubagentStart)");
  expect(node.textContent).toContain("claude_settings.rs:31");
  expect(node.style.filter).toBe("");
  await act(async () => subagentNodesStore.getState().upsert({ nodeId: "n1", agentId: "a1", agentType: "Explore", state: "done" }));
  expect(node.dataset.state).toBe("done");
  expect(node.style.filter).toBe("grayscale(1)");
  await act(async () => root.unmount());
});

it("names the subagent that spawned a nested one", async () => {
  const { host, root } = await render("el-2");
  expect(host.querySelector("header")?.textContent).toContain("↳ Explore ›");
  await act(async () => root.unmount());
});

it("closing it removes its node and keeps it from coming back", async () => {
  const { host, root } = await render("el-1");
  await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='Close']")!.click());
  expect(removeNode).toHaveBeenCalledWith("el-1");
  expect(subagentNodesStore.getState().dismissed.a1).toBe(true);
  await act(async () => root.unmount());
});
