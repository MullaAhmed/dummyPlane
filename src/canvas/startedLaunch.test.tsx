// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { TerminalPayload } from "@/nodes/types";
import { terminalStatusStore } from "@/store/terminalStatus";
import { forgetStartedLaunch, launchSettingsOf, noteLaunchChange, useLaunchRestartPending } from "./startedLaunch";

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

let seen: boolean | undefined;
function Probe({ current }: { current: TerminalPayload }) {
  seen = useLaunchRestartPending("t1", current);
  return null;
}

const host = document.createElement("div");
const root = createRoot(host);
const show = (current: TerminalPayload) => act(async () => root.render(<Probe current={current} />));

afterEach(async () => {
  forgetStartedLaunch("t1");
  terminalStatusStore.setState({ statuses: {} });
  seen = undefined;
  await act(async () => root.render(null));
});

it("reads the command only for a Custom terminal, which is the only one that runs it", () => {
  expect(launchSettingsOf(terminal())).toEqual({ cwd: "D:/work/api", shell: "default", title: "Batman", command: "" });
  expect(launchSettingsOf(terminal({ agent: "custom" })).command).toBe("npm run dev");
});

it("has nothing to restart while a terminal is stopped, whatever changes", async () => {
  noteLaunchChange("t1", terminal());
  await show(terminal({ cwd: "D:/work/web" }));
  expect(seen).toBe(false);
});

it("notes what a running terminal started with, and compares each launch setting with it", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  noteLaunchChange("t1", terminal());
  await show(terminal());
  expect(seen).toBe(false);
  for (const changed of [{ cwd: "D:/work/web" }, { shell: "pwsh" as const }, { title: "Review" }]) {
    await show(terminal(changed));
    expect(seen).toBe(true);
  }
  // Back to what it started with: nothing to restart.
  await show(terminal());
  expect(seen).toBe(false);
});

it("keeps the first note of a session: a second change does not become what it started with", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  noteLaunchChange("t1", terminal());
  noteLaunchChange("t1", terminal({ cwd: "D:/work/web" }));
  await show(terminal({ cwd: "D:/work/web" }));
  expect(seen).toBe(true);
});

it("forgets the note when the terminal restarts, or stops", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  noteLaunchChange("t1", terminal());
  await show(terminal({ cwd: "D:/work/web" }));
  expect(seen).toBe(true);
  await act(async () => forgetStartedLaunch("t1"));
  expect(seen).toBe(false);

  noteLaunchChange("t1", terminal());
  await show(terminal({ title: "Review" }));
  expect(seen).toBe(true);
  await act(async () => terminalStatusStore.getState().set("t1", { state: "stopped" }));
  expect(seen).toBe(false);
});
