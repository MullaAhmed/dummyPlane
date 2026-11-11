// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { removeNode } from "@/agents/terminals";
import { nodesStore } from "@/store/nodes";
import { subagentNodesStore } from "./store";
import { SubagentNode } from "./SubagentNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/terminals", () => ({ removeNode: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  nodesStore.setState({
    nodes: { n1: { workspaceId: "w1", kind: "terminal", payload: { title: "T", name: "Aquaman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } } },
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

it("shows its terminal, its type over what it was asked and its transcript as terminal lines; done, its text steps back without fading", async () => {
  const { host, root } = await render("el-1");
  const node = host.querySelector<HTMLElement>("[data-subagent='a1']")!;
  expect(node.dataset.state).toBe("running");
  const header = node.querySelector("header")!;
  expect(header.textContent).toContain("↳ Aquaman ›");
  expect(header.querySelector("[data-node-title]")?.textContent).toContain("Explore");
  // Under its type, legible: the secondary text role at 12px, reachable by the keyboard for its tooltip.
  const line = header.querySelector<HTMLButtonElement>("[data-task-line]")!;
  expect(line.tagName).toBe("BUTTON");
  expect(line.textContent).toBe("Find the hooks");
  expect(line.className).toContain("text-dp-text-2");
  expect(line.className).toContain("text-xs");
  // Its tooltip says it: no native title beside it.
  expect(header.hasAttribute("title")).toBe(false);
  expect(node.textContent).toContain("Grep(SubagentStart)");
  expect(node.textContent).toContain("claude_settings.rs:31");
  const ink = node.style.getPropertyValue("--sa-fg");
  await act(async () => subagentNodesStore.getState().upsert({ nodeId: "n1", agentId: "a1", agentType: "Explore", description: "Find the hooks", state: "done" }));
  expect(node.dataset.state).toBe("done");
  // An opacity let the canvas through and a grayscale took the text under 3:1: the text steps to the dim ink instead.
  expect(node.style.opacity).toBe("");
  expect(node.style.filter).toBe("");
  expect(node.style.getPropertyValue("--sa-fg")).toBe(node.style.getPropertyValue("--sa-dim"));
  expect(node.style.getPropertyValue("--sa-fg")).not.toBe(ink);
  await act(async () => root.unmount());
});

it("keeps one line for a subagent asked nothing it could say", async () => {
  const { host, root } = await render("el-2");
  const header = host.querySelector("[data-subagent='a2'] header")!;
  expect(header.querySelector("[data-task-line]")).toBeNull();
  expect(header.textContent).toContain("Plan");
  expect(header.getAttribute("title")).toBe("Plan");
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
