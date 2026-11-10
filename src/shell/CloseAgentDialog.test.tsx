// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { removeNodes } from "@/agents/terminals";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { CloseAgentDialog } from "./CloseAgentDialog";

vi.mock("@/agents/terminals", () => ({ removeNodes: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  mockIPC(() => undefined);
  for (const [id, name] of [["isis", "Isis"], ["thot", "Thoth"]]) {
    await nodesStore.getState().create(id, {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
  }
});
beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<CloseAgentDialog />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

it("names the agent it would end, and closes it once confirmed (spec habillage §7.5)", async () => {
  await act(async () => uiStore.getState().setClosing({ agents: ["isis"], remove: ["isis"] }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Close Isis?");
  await act(async () => button("Close the agent").click());
  expect(removeNodes).toHaveBeenLastCalledWith(["isis"]);
  expect(uiStore.getState().closing).toBeNull();
});

it("lists the agents an undo or Delete would end together, and removes all that left with them", async () => {
  await act(async () => uiStore.getState().setClosing({ agents: ["isis", "thot"], remove: ["isis", "thot", "g"] }));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Close 2 agents?");
  expect(dialog.textContent).toContain("Isis, Thoth");
  await act(async () => button("Close the agents").click());
  expect(removeNodes).toHaveBeenLastCalledWith(["isis", "thot", "g"]);
});

it("keeps them when cancelled", async () => {
  vi.mocked(removeNodes).mockClear();
  await act(async () => uiStore.getState().setClosing({ agents: ["isis"], remove: ["isis"] }));
  await act(async () => button("Cancel").click());
  expect(removeNodes).not.toHaveBeenCalled();
  expect(uiStore.getState().closing).toBeNull();
});

it("tells what closing a fleet in mission leaves behind (spec première version §5.4)", async () => {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, members: [] } },
  });
  await act(async () => uiStore.getState().setClosing({ agents: ["chef"], remove: ["chef", "fil"] }));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Chef is leading a mission in progress. Closing it stops its session; its agents keep going, but nobody will read their reports. The mission's worktrees and branches stay on disk.");
  await act(async () => button("Close the fleet").click());
  expect(removeNodes).toHaveBeenLastCalledWith(["chef", "fil"]);
});

it("says whether the agent is at work or ready, as the spec asks (§7.5)", async () => {
  agentActivityStore.getState().apply({ nodeId: "isis", activity: "working", since: 1 });
  await act(async () => uiStore.getState().setClosing({ agents: ["isis"], remove: ["isis"] }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Isis is working.");
  await act(async () => agentActivityStore.getState().apply({ nodeId: "isis", activity: "idle", since: 2 }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Isis is ready.");
});

describe("an agent that opened sub-agents (spawn_agent)", () => {
  beforeAll(async () => {
    const terminal = (name: string, spawnedBy?: string) => ({
      workspaceId: "w1",
      kind: "terminal" as const,
      payload: { title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", ...(spawnedBy ? { spawnedBy } : {}) },
    });
    await nodesStore.getState().create("osiris", terminal("Osiris"));
    await nodesStore.getState().create("horus", terminal("Horus", "osiris"));
    await nodesStore.getState().create("seth", terminal("Seth", "horus"));
  });
  beforeEach(() => vi.mocked(removeNodes).mockClear());
  afterEach(() => terminalStatusStore.getState().remove("osiris"));

  const asked = { agents: ["osiris"], remove: ["osiris"], children: ["horus", "seth"] };
  // The shadcn checkbox: a button that carries its state in aria-checked, named by its label.
  const checkbox = () => {
    const box = document.querySelector<HTMLButtonElement>('[role="dialog"] [role="checkbox"]');
    return box && { checked: box.getAttribute("aria-checked") === "true", click: () => box.click(), label: document.querySelector(`label[for="${box.id}"]`)?.textContent };
  };

  it("offers to close them too, ticked, and closes them with it once confirmed", async () => {
    await act(async () => uiStore.getState().setClosing(asked));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Close Osiris?");
    expect(dialog.textContent).toContain("Also close the sub-agents it opened: Horus, Seth");
    expect(checkbox()!.checked).toBe(true);
    expect(checkbox()!.label).toBe("Also close the sub-agents it opened: Horus, Seth");
    await act(async () => button("Close the agent").click());
    expect(removeNodes).toHaveBeenLastCalledWith(["osiris", "horus", "seth"]);
    expect(uiStore.getState().closing).toBeNull();
  });

  it("closes the agent alone once unticked", async () => {
    await act(async () => uiStore.getState().setClosing(asked));
    await act(async () => checkbox()!.click());
    expect(checkbox()!.checked).toBe(false);
    await act(async () => button("Close the agent").click());
    expect(removeNodes).toHaveBeenLastCalledWith(["osiris"]);
    expect(uiStore.getState().closing).toBeNull();
  });

  it("starts ticked again at the next closing", async () => {
    await act(async () => uiStore.getState().setClosing(asked));
    await act(async () => checkbox()!.click());
    await act(async () => button("Cancel").click());
    expect(removeNodes).not.toHaveBeenCalled();
    await act(async () => uiStore.getState().setClosing(asked));
    expect(checkbox()!.checked).toBe(true);
    await act(async () => button("Cancel").click());
  });

  it("says a stopped agent is stopped: only its sub-agents made it ask", async () => {
    await act(async () => uiStore.getState().setClosing(asked));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Osiris is stopped.");
    expect(dialog.textContent).not.toContain("still running");
    await act(async () => button("Cancel").click());
  });

  it("says a running one is running", async () => {
    terminalStatusStore.getState().set("osiris", { state: "running" });
    await act(async () => uiStore.getState().setClosing(asked));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Osiris is still running. Closing it ends its session.");
    expect(dialog.textContent).not.toContain("is stopped");
    await act(async () => button("Cancel").click());
  });

  it("shows no checkbox for an agent without sub-agents to close", async () => {
    await act(async () => uiStore.getState().setClosing({ agents: ["osiris"], remove: ["osiris"], children: [] }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(checkbox()).toBeNull();
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Also close");
    await act(async () => button("Close the agent").click());
    expect(removeNodes).toHaveBeenLastCalledWith(["osiris"]);
  });
});
