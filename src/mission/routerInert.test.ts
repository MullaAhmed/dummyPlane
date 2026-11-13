import { expect, it, vi } from "vitest";
import { AGENT_IDS, MANAGER_ROLE, STORED_FLEET_ROLE } from "@/ipc/pty";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { routerInertText } from "./RouterToggle";
import { routerInert } from "./routerState";

// The router's state reads the mission store, which reaches the canvas.
vi.mock("@excalidraw/excalidraw", () => ({}));

/** Every terminal shows the router's switch; this tells whether it acts there, and if not, why, in words. */
it("acts on Claude and Codex, which hold dummyPlane's tools, and is inert on every other CLI", () => {
  for (const agent of AGENT_IDS) {
    expect(routerInert({ agent }), agent).toBe(FLEET_CAPABLE.includes(agent) ? null : "agent");
    expect(routerInertText({ agent }) === undefined, agent).toBe(FLEET_CAPABLE.includes(agent));
  }
  expect(FLEET_CAPABLE).toEqual(["claude", "codex"]);
});

it("is inert on a Manager, on any CLI: it opens no sub-agents, and its Fleet's switch routes the mission", () => {
  for (const agent of AGENT_IDS) expect(routerInert({ agent, role: MANAGER_ROLE }), agent).toBe("manager");
  expect(routerInertText({ agent: "claude", role: MANAGER_ROLE })).toBe("A Manager opens no sub-agents; its Fleet's switch routes the mission");
});

it("acts on a Fleet's session, whose role is the Fleet's own, and on a plain agent's", () => {
  expect(routerInert({ agent: "claude", role: STORED_FLEET_ROLE })).toBeNull();
  expect(routerInert({ agent: "codex", role: "agent" })).toBeNull();
});

it("says why in plain words, naming the CLI, a shell and a custom command by what they are", () => {
  expect(routerInertText({ agent: "gemini" })).toBe("Gemini can't open sub-agents, so the router has nothing to route here");
  expect(routerInertText({ agent: "qwen" })).toBe("Qwen Code can't open sub-agents, so the router has nothing to route here");
  expect(routerInertText({ agent: "shell" })).toBe("A shell can't open sub-agents, so the router has nothing to route here");
  expect(routerInertText({ agent: "custom" })).toBe("A custom command can't open sub-agents, so the router has nothing to route here");
});
