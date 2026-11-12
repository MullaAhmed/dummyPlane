// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { launchSettingsOf } from "@/nodes/terminal/launch";
import { readTerminalPayload, type TerminalPayload } from "@/nodes/types";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useFolderMove, useLaunchRestartPending, useStartedLaunch, type FolderMove } from "./startedLaunch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = (patch: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Batman",
  name: "Batman",
  agent: "claude",
  cwd: "D:/work/api",
  shell: "default",
  command: "npm run dev",
  ...patch,
});
/** A terminal whose process started as `terminal()` and was edited since by `patch`. */
const editedSince = (patch: Partial<TerminalPayload>) => terminal({ ...patch, launched: launchSettingsOf(terminal()) });

let seen: { pending: boolean; move: FolderMove | null; model: string | undefined } | undefined;
function Probe({ current }: { current: TerminalPayload }) {
  seen = { pending: useLaunchRestartPending("t1", current), move: useFolderMove("t1", current), model: useStartedLaunch("t1", current)?.model };
  return null;
}

const host = document.createElement("div");
const root = createRoot(host);
const show = (current: TerminalPayload) => act(async () => root.render(<Probe current={current} />));
const run = () => act(async () => terminalStatusStore.getState().set("t1", { state: "running" }));

afterEach(async () => {
  terminalStatusStore.setState({ statuses: {} });
  seen = undefined;
  await act(async () => root.render(null));
});

it("reads the command only for a Custom terminal, which is the only one that runs it", () => {
  expect(launchSettingsOf(terminal())).toEqual({ cwd: "D:/work/api", shell: "default", command: "", model: "", effort: "", permission: "", accountId: "" });
  expect(launchSettingsOf(terminal({ agent: "custom" })).command).toBe("npm run dev");
});

it("reads the model, the effort, the permission and the account only for Claude, the only one that gets them", () => {
  const chosen = { model: "claude-opus-5-5", effort: "max" as const, permission: "work" as const, accountId: "work" };
  expect(launchSettingsOf(terminal(chosen))).toMatchObject(chosen);
  expect(launchSettingsOf(terminal({ ...chosen, agent: "codex" }))).toMatchObject({ model: "", effort: "", permission: "", accountId: "" });
});

it("has nothing to restart while a terminal is stopped, whatever its last process started with", async () => {
  await show(editedSince({ cwd: "D:/work/web", model: "claude-haiku-5-5" }));
  expect(seen).toEqual({ pending: false, move: null, model: "claude-haiku-5-5" });
});

it("compares each launch setting with what the running process started with", async () => {
  await run();
  await show(editedSince({}));
  expect(seen?.pending).toBe(false);
  // "ask" given is a change too: any permission given also blocks git push in the session's settings.
  const changes: Partial<TerminalPayload>[] = [{ cwd: "D:/work/web" }, { shell: "pwsh" }, { model: "claude-haiku-5-5" }, { permission: "edits" }, { permission: "ask" }, { accountId: "work" }];
  for (const changed of changes) {
    await show(editedSince(changed));
    expect(seen?.pending).toBe(true);
  }
  // Back to what it started with: nothing to restart.
  await show(editedSince({}));
  expect(seen?.pending).toBe(false);
  // While it runs, the model is the one it started with, not the one picked since.
  await show(editedSince({ model: "claude-haiku-5-5" }));
  expect(seen?.model).toBe("");
});

it("has nothing to restart for a title: Claude gets it only when a new conversation starts, and a restart resumes", async () => {
  await run();
  await show(editedSince({ title: "Review" }));
  expect(seen?.pending).toBe(false);
});

it("has nothing to restart for a process that kept no record of its start", async () => {
  await run();
  await show(terminal({ cwd: "D:/work/web" }));
  expect(seen).toMatchObject({ pending: false, move: null });
});

it("names the folder a running terminal was moved from and the one its restart takes it to", async () => {
  await run();
  await show(editedSince({ cwd: "D:/work/web" }));
  expect(seen?.move).toEqual({ from: "D:/work/api", to: "D:/work/web" });
  // The same folder, spelled otherwise: no move.
  await show(editedSince({ cwd: "d:\\WORK\\api\\" }));
  expect(seen?.move).toBeNull();
  // Another setting changed: a restart is pending, but no move.
  await show(editedSince({ model: "claude-haiku-5-5" }));
  expect(seen).toMatchObject({ pending: true, move: null });
  await show(editedSince({ cwd: "D:/work/web" }));
  await act(async () => terminalStatusStore.getState().set("t1", { state: "exited", code: 0 }));
  expect(seen).toMatchObject({ pending: false, move: null });
});

it("keeps the record of a start through a save, and drops one it cannot read", () => {
  const saved = JSON.parse(JSON.stringify(editedSince({ cwd: "D:/work/web" })));
  expect(readTerminalPayload(saved)?.launched).toEqual(launchSettingsOf(terminal()));
  expect(readTerminalPayload({ ...saved, launched: { cwd: "D:/work/api" } })?.launched).toBeUndefined();
  expect(readTerminalPayload({ ...saved, launched: "D:/work/api" })?.launched).toBeUndefined();
});
