// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { installUpdate, updatesStore } from "@/app/updates";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { UpdateDialog } from "./UpdateDialog";

vi.mock("@/app/updates", async (original) => ({ ...(await original<typeof import("@/app/updates")>()), installUpdate: vi.fn(() => Promise.resolve()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("names the agents an update will stop, and installs on demand", async () => {
  mockIPC(() => undefined);
  for (const [id, name] of [["batman", "Batman"], ["cyborg", "Cyborg"]]) {
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  }
  terminalStatusStore.getState().set("batman", { state: "running" });
  terminalStatusStore.getState().set("cyborg", { state: "stopped" });
  updatesStore.setState({ available: { version: "1.0.0-beta.2", notes: "### Fixed\n- Things." }, dialogOpen: true, progress: null, step: null });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<UpdateDialog />));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("dummyPlane 1.0.0-beta.2");
  expect(dialog.textContent).toContain("Batman");
  expect(dialog.textContent).not.toContain("Cyborg");
  expect(dialog.textContent).toContain("Things.");
  const install = [...document.querySelectorAll("button")].find((b) => b.textContent === "Install and restart")!;
  await act(async () => install.click());
  expect(installUpdate).toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("labels the download without a figure when its size is unknown, then says it installs; a status line names the stage", async () => {
  mockIPC(() => undefined);
  updatesStore.setState({ available: { version: "1.0.0-beta.2", notes: "" }, dialogOpen: true, progress: null, step: null });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<UpdateDialog />));
  const status = () => document.querySelector('[role="status"][data-update-status]')!;
  const primary = () => document.querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-footer"] button:last-child')!;
  // Mounted before anything happens, so its first words are read out.
  expect(status().textContent).toBe("");
  await act(async () => updatesStore.setState({ progress: 0, step: { kind: "downloading", share: null } }));
  expect(primary().textContent).toBe("Downloading…");
  expect(status().textContent).toBe("Downloading the update");
  await act(async () => updatesStore.setState({ progress: 0.42, step: { kind: "downloading", share: 0.42 } }));
  expect(primary().textContent).toBe("Downloading… 42%");
  // The figure stays on the button: the status line does not read every percent.
  expect(status().textContent).toBe("Downloading the update");
  await act(async () => updatesStore.setState({ progress: 1, step: { kind: "installing" } }));
  expect(primary().textContent).toBe("Installing…");
  expect(status().textContent).toBe("Installing the update: dummyPlane will restart");
  await act(async () => updatesStore.setState({ progress: null, step: null, dialogOpen: false }));
  await act(async () => root.unmount());
});
