import { expect, it } from "vitest";
import type { Mission } from "@/mission/mission";
import type { TerminalPayload } from "@/nodes/types";
import type { NodeRecord } from "@/store/nodes";
import { folderChange, folderLockOf, sameFolder } from "./folder";

const terminal = (patch: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Batman",
  name: "Batman",
  agent: "claude",
  cwd: "D:/work/api",
  shell: "default",
  command: "",
  claudeSessionId: "old",
  ...patch,
});

it("takes two paths for the same folder whatever the slashes, a trailing one or the case", () => {
  expect(sameFolder("D:/work/api", "d:\\WORK\\api\\")).toBe(true);
  expect(sameFolder("/home/ada/api/", "/home/ada/api")).toBe(true);
  expect(sameFolder(" D:/work/api ", "D:/work/api")).toBe(true);
  expect(sameFolder("D:/work/api", "D:/work/web")).toBe(false);
  expect(sameFolder("D:/work/api", "D:/work/api/src")).toBe(false);
  // A root stays a root.
  expect(sameFolder("/", "/")).toBe(true);
  expect(sameFolder("C:\\", "c:/")).toBe(true);
});

it("moves a Claude terminal with a conversation of its own, and nothing else", () => {
  const change = folderChange(terminal({ steps: [{ title: "Plan", state: "fait" }] }), " D:\\work\\web ");
  expect(change).toMatchObject({ cwd: "D:\\work\\web", steps: undefined });
  expect(change?.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(change?.claudeSessionId).not.toBe("old");
  // The model, the permission and the profile are not in the change: they stay.
  expect(Object.keys(change ?? {}).sort()).toEqual(["claudeSessionId", "codexSessionId", "cwd", "lastReport", "steps"]);
});

it("keeps the conversation a running Claude runs when it is moved away and back to the folder its process runs in", () => {
  const launched = { cwd: "D:/work/api", shell: "default", command: "", model: "", effort: "", permission: "", accountId: "" };
  const running = terminal({ claudeSessionId: "runs", launched });
  const away = { ...running, ...folderChange(running, "D:/work/web", true) };
  expect(away.cwd).toBe("D:/work/web");
  expect(away.claudeSessionId).not.toBe("runs");
  // Back where its process runs: the next launch resumes the conversation that runs, nothing is lost.
  const back = { ...away, ...folderChange(away, "d:\\work\\api", true) };
  expect(back.cwd).toBe("d:\\work\\api");
  expect(back.claudeSessionId).toBe("runs");
  // Through another folder on the way, the same.
  const further = { ...away, ...folderChange(away, "D:/work/docs", true) };
  expect({ ...further, ...folderChange(further, "D:/work/api", true) }.claudeSessionId).toBe("runs");
  // Stopped, there is no conversation running to keep: a move back starts one, as any move does.
  const stopped = { ...running, ...folderChange(running, "D:/work/web", false) };
  expect({ ...stopped, ...folderChange(stopped, "D:/work/api", false) }.claudeSessionId).not.toBe("runs");
});

it("moves any other agent by its folder alone", () => {
  expect(folderChange(terminal({ agent: "codex" }), "D:/work/web")).toEqual({ cwd: "D:/work/web" });
});

it("changes nothing for the folder it is in, or for an empty one", () => {
  expect(folderChange(terminal(), "d:\\work\\api\\")).toBeNull();
  expect(folderChange(terminal(), "   ")).toBeNull();
  expect(folderChange(terminal(), "")).toBeNull();
});

const mission = (state: Mission["state"], nodeIds: string[]): Mission => ({
  state,
  maxAgents: 3,
  members: nodeIds.map((nodeId) => ({ nodeId, name: nodeId, task: "", budgetMin: 10, linked: false, branch: `m/${nodeId}`, worktree: `D:/wt/${nodeId}` })),
});
const nodes = (state: Mission["state"]): Record<string, NodeRecord> => ({
  fleet: { workspaceId: "w", kind: "fleet", payload: { name: "Fleet", mission: mission(state, ["batman"]) } },
  batman: { workspaceId: "w", kind: "terminal", payload: terminal() },
  cyborg: { workspaceId: "w", kind: "terminal", payload: terminal({ name: "Cyborg" }) },
  board: { workspaceId: "w", kind: "kanban", payload: { columns: [], cards: {} } },
});

it("keeps a Fleet where it is, in the project", () => {
  expect(folderLockOf("fleet", nodes("redaction"))).toBe("fleet");
});

it("keeps the agent of a running mission in its worktree, and only that one", () => {
  expect(folderLockOf("batman", nodes("en_cours"))).toBe("mission");
  expect(folderLockOf("cyborg", nodes("en_cours"))).toBeNull();
});

it("frees the agents once the mission has ended, and before it has a team", () => {
  expect(folderLockOf("batman", nodes("terminee"))).toBeNull();
  expect(folderLockOf("batman", nodes("plan"))).toBeNull();
  expect(folderLockOf("batman", nodes("lancement"))).toBeNull();
});

it("has no lock for a node that is none of those, or is gone", () => {
  expect(folderLockOf("board", nodes("en_cours"))).toBeNull();
  expect(folderLockOf("missing", nodes("en_cours"))).toBeNull();
});
