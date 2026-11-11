// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { goToAgent } from "@/commands/goToRun";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import { WaitingNotice } from "./WaitingNotice";

vi.mock("@/commands/goToRun", () => ({ goToAgent: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDS = ["batman", "cyborg", "robin", "starfire", "shazam"];
const terminal = (workspaceId: string, name: string): NodeRecord => ({
  workspaceId,
  kind: "terminal",
  payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
});

let host: HTMLDivElement;
let root: Root;

const wait = (nodeId: string, since = 0) => act(async () => agentActivityStore.getState().apply({ nodeId, activity: "waiting", since }));
const rows = () => [...host.querySelectorAll("button")].map((b) => b.textContent);
const last = <T,>(list: readonly T[]) => list[list.length - 1];

beforeEach(async () => {
  workspacesStore.setState({
    activeId: "w1",
    workspaces: [
      { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null },
      { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null, kind: "canvas", folder: null },
    ],
  });
  nodesStore.setState({
    nodes: { batman: terminal("w1", "Batman"), cyborg: terminal("w2", "Cyborg"), robin: terminal("w1", "Robin"), starfire: terminal("w1", "Starfire"), shazam: terminal("w1", "Shazam") },
  });
  terminalStatusStore.setState({ statuses: Object.fromEntries(IDS.map((id) => [id, { state: "running" }])) });
  agentActivityStore.setState({ activities: {} });
  vi.mocked(goToAgent).mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WaitingNotice />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("WaitingNotice", () => {
  it("shows nothing while nobody waits, its live region already mounted so the first question is announced", () => {
    expect(host.querySelector("section")).toBeNull();
    expect(host.querySelector("[aria-live]")).not.toBeNull();
  });

  it("appears when an agent starts waiting and disappears when it stops", async () => {
    await wait("batman");
    expect(rows()).toEqual(["Batman has a question"]);
    await act(async () => agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 1 }));
    expect(host.querySelector("section")).toBeNull();
  });

  it("disappears when the agent's process ends", async () => {
    await wait("batman");
    await act(async () => agentActivityStore.getState().remove("batman"));
    expect(host.querySelector("section")).toBeNull();
  });

  it("clears the tool rail, at any window height", async () => {
    await wait("batman");
    expect(host.querySelector("section")?.className).toContain("left-[70px]");
  });

  it("names the workspace of an agent that is not on screen", async () => {
    await wait("cyborg");
    expect(rows()).toEqual(["Cyborg has a questionBackend"]);
  });

  describe("the preview of the question", () => {
    const ask = (message?: string) => act(async () => agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 0, message }));

    it("shows what the agent says it waits for, on two lines at most, never in a native title", async () => {
      await ask("Claude needs your permission to use Bash");
      expect(rows()).toEqual(["Batman has a questionClaude needs your permission to use Bash"]);
      const preview = host.querySelector("[data-waiting-notice] .line-clamp-2");
      expect(preview?.textContent).toBe("Claude needs your permission to use Bash");
      expect(host.querySelector("[title]")).toBeNull();
    });

    it("falls back to no preview", async () => {
      await ask(undefined);
      expect(rows()).toEqual(["Batman has a question"]);
      expect(host.querySelector("[data-waiting-notice] .line-clamp-2")).toBeNull();
    });

    it("follows the agent: a new question replaces it, the end of the wait removes it", async () => {
      await ask("First?");
      await ask("Second?");
      expect(rows()).toEqual(["Batman has a questionSecond?"]);
      await ask(undefined);
      expect(rows()).toEqual(["Batman has a question"]);
    });

    it("shows a message as plain text, never as markup", async () => {
      const hostile = '<img src=x onerror="alert(1)"><a href="http://x">**click**</a>';
      await ask(hostile);
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("a")).toBeNull();
      expect(host.querySelector("[data-waiting-notice] .line-clamp-2")?.textContent).toBe(hostile);
    });

    it("never turns a message into markup in the source either", () => {
      expect(readSource("shell/WaitingNotice.tsx")).not.toContain("dangerouslySetInnerHTML");
    });
  });

  it("takes the keyboard to the agent on a click", async () => {
    await wait("cyborg");
    await act(async () => host.querySelector("button")!.click());
    expect(goToAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "cyborg", workspaceId: "w2" }));
  });

  it("stacks three agents, the one waiting longest first", async () => {
    await wait("robin", 3);
    await wait("batman", 1);
    await wait("starfire", 2);
    expect(rows()).toEqual(["Batman has a question", "Starfire has a question", "Robin has a question"]);
  });

  it("counts the others past three, and its line goes to the first of them", async () => {
    await wait("batman", 1);
    await wait("starfire", 2);
    await wait("robin", 3);
    await wait("shazam", 4);
    expect(last(rows())).toBe("+ 1 more");
    await wait("cyborg", 5);
    expect(last(rows())).toBe("+ 2 more");
    await act(async () => last([...host.querySelectorAll("button")]).click());
    expect(goToAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "shazam" }));
  });

  it("speaks English", async () => {
    await wait("batman", 1);
    expect(rows()).toEqual(["Batman has a question"]);
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("Agents waiting for your answer");
    for (const [id, since] of [["starfire", 2], ["robin", 3], ["shazam", 4]] as const) await wait(id, since);
    expect(last(rows())).toBe("+ 1 more");
  });
});

it("rises above the command band where the bar reaches its column, and moves only its bottom", () => {
  const source = readSource("shell/WaitingNotice.tsx");
  expect(source).toContain("max-[1340px]:bottom-[calc(var(--dp-bottom-band,2.25rem)+1.25rem)]");
  expect(readSource("shell/ProjectView.tsx")).toContain('setProperty("--dp-bottom-band"');
});
