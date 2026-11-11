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
  for (const [id, name] of [["batman", "Batman"], ["cyborg", "Cyborg"]]) {
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

it("names the agent it would end, and closes it once confirmed", async () => {
  await act(async () => uiStore.getState().setClosing({ agents: ["batman"], remove: ["batman"] }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Close Batman?");
  await act(async () => button("Close the agent").click());
  expect(removeNodes).toHaveBeenLastCalledWith(["batman"]);
  expect(uiStore.getState().closing).toBeNull();
});

it("lists the agents an undo or Delete would end together, and removes all that left with them", async () => {
  await act(async () => uiStore.getState().setClosing({ agents: ["batman", "cyborg"], remove: ["batman", "cyborg", "g"] }));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Close 2 agents?");
  expect(dialog.textContent).toContain("Batman, Cyborg");
  await act(async () => button("Close the agents").click());
  expect(removeNodes).toHaveBeenLastCalledWith(["batman", "cyborg", "g"]);
});

it("keeps them when cancelled", async () => {
  vi.mocked(removeNodes).mockClear();
  await act(async () => uiStore.getState().setClosing({ agents: ["batman"], remove: ["batman"] }));
  await act(async () => button("Cancel").click());
  expect(removeNodes).not.toHaveBeenCalled();
  expect(uiStore.getState().closing).toBeNull();
});

it("tells what closing a fleet in mission leaves behind", async () => {
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

it("says whether the agent is at work or ready", async () => {
  terminalStatusStore.getState().set("batman", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 1 });
  await act(async () => uiStore.getState().setClosing({ agents: ["batman"], remove: ["batman"] }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Batman is working.");
  await act(async () => agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 2 }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Batman is ready.");
  // Its Claude exited and its shell is busy: its pill says Agent exited, so the dialog never says it works.
  await act(async () => agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 3, left: true }));
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Batman is working.");
  terminalStatusStore.getState().remove("batman");
  agentActivityStore.getState().remove("batman");
});

it("never says a plain console is working: it runs no agent", async () => {
  await nodesStore.getState().create("console", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Console", name: "Console", agent: "shell", cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set("console", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "console", activity: "working", since: 1 });
  await act(async () => uiStore.getState().setClosing({ agents: ["console"], remove: ["console"] }));
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Console is working.");
  terminalStatusStore.getState().remove("console");
  agentActivityStore.getState().remove("console");
});

describe("an agent that opened sub-agents (spawn_agent)", () => {
  beforeAll(async () => {
    const terminal = (name: string, spawnedBy?: string) => ({
      workspaceId: "w1",
      kind: "terminal" as const,
      payload: { title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", ...(spawnedBy ? { spawnedBy } : {}) },
    });
    await nodesStore.getState().create("superman", terminal("Superman"));
    await nodesStore.getState().create("aquaman", terminal("Aquaman", "superman"));
    await nodesStore.getState().create("shazam", terminal("Shazam", "aquaman"));
  });
  beforeEach(() => vi.mocked(removeNodes).mockClear());
  afterEach(() => terminalStatusStore.getState().remove("superman"));

  const asked = { agents: ["superman"], remove: ["superman"], children: ["aquaman", "shazam"] };
  // The shadcn checkbox: a button that carries its state in aria-checked, named by its label.
  const checkbox = () => {
    const box = document.querySelector<HTMLButtonElement>('[role="dialog"] [role="checkbox"]');
    return box && { checked: box.getAttribute("aria-checked") === "true", click: () => box.click(), label: document.querySelector(`label[for="${box.id}"]`)?.textContent };
  };

  it("offers to close them too, ticked, and closes them with it once confirmed", async () => {
    await act(async () => uiStore.getState().setClosing(asked));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Close Superman?");
    expect(dialog.textContent).toContain("Also close the sub-agents it opened: Aquaman, Shazam");
    expect(checkbox()!.checked).toBe(true);
    expect(checkbox()!.label).toBe("Also close the sub-agents it opened: Aquaman, Shazam");
    await act(async () => button("Close the agent").click());
    expect(removeNodes).toHaveBeenLastCalledWith(["superman", "aquaman", "shazam"]);
    expect(uiStore.getState().closing).toBeNull();
  });

  it("closes the agent alone once unticked", async () => {
    await act(async () => uiStore.getState().setClosing(asked));
    await act(async () => checkbox()!.click());
    expect(checkbox()!.checked).toBe(false);
    await act(async () => button("Close the agent").click());
    expect(removeNodes).toHaveBeenLastCalledWith(["superman"]);
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
    expect(dialog.textContent).toContain("Superman is stopped.");
    expect(dialog.textContent).not.toContain("still running");
    await act(async () => button("Cancel").click());
  });

  it("says a running one is running", async () => {
    terminalStatusStore.getState().set("superman", { state: "running" });
    await act(async () => uiStore.getState().setClosing(asked));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Superman is still running. Closing it ends its session.");
    expect(dialog.textContent).not.toContain("is stopped");
    await act(async () => button("Cancel").click());
  });

  it("shows no checkbox for an agent without sub-agents to close", async () => {
    await act(async () => uiStore.getState().setClosing({ agents: ["superman"], remove: ["superman"], children: [] }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(checkbox()).toBeNull();
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Also close");
    await act(async () => button("Close the agent").click());
    expect(removeNodes).toHaveBeenLastCalledWith(["superman"]);
  });
});
