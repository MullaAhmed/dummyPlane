// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { confirmAction } from "@/components/confirm";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore, type Workspace } from "@/store/workspaces";
import { removeWorkspace } from "./workspaceActions";

vi.mock("@/components/confirm", () => ({ confirmAction: vi.fn(() => Promise.resolve(false)) }));

const workspace: Workspace = { id: "w1", projectId: "p", name: "API", position: 0, pantheon: null } as Workspace;
const terminal = (name: string) => ({ title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "" });

beforeEach(async () => {
  vi.mocked(confirmAction).mockClear();
  mockIPC(() => undefined);
  for (const name of ["Isis", "Thoth"]) await nodesStore.getState().create(name, { workspaceId: "w1", kind: "terminal", payload: terminal(name) });
  await nodesStore.getState().create("Ra", { workspaceId: "w1", kind: "terminal", payload: terminal("Ra") });
  await nodesStore.getState().create("Autre", { workspaceId: "w2", kind: "terminal", payload: terminal("Autre") });
  for (const id of ["Isis", "Thoth", "Autre"]) terminalStatusStore.getState().set(id, { state: "running" });
});

it("asks in the app's own dialog, naming the agents that deleting the workspace would stop", async () => {
  await removeWorkspace(workspace, 2);
  const asked = vi.mocked(confirmAction).mock.calls[0][0];
  expect(asked.title).toContain("API");
  expect(asked.description).toContain("Isis");
  expect(asked.description).toContain("Thoth");
  expect(asked.description).not.toContain("Ra,");
  expect(asked.description).not.toContain("Autre");
  expect(asked.destructive).toBe(true);
});

it("deletes nothing when the user cancels", async () => {
  const remove = vi.spyOn(workspacesStore.getState(), "remove");
  await removeWorkspace(workspace, 2);
  expect(remove).not.toHaveBeenCalled();
  remove.mockRestore();
});

it("deletes the workspace once confirmed", async () => {
  vi.mocked(confirmAction).mockResolvedValueOnce(true);
  const remove = vi.spyOn(workspacesStore.getState(), "remove").mockResolvedValue();
  await removeWorkspace(workspace, 0);
  expect(remove).toHaveBeenCalledWith("w1");
  remove.mockRestore();
});
