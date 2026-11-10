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

it("names the agents an update will stop, and installs on demand (spec première version §6.4)", async () => {
  mockIPC(() => undefined);
  for (const [id, name] of [["batman", "Batman"], ["cyborg", "Cyborg"]]) {
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  }
  terminalStatusStore.getState().set("batman", { state: "running" });
  terminalStatusStore.getState().set("cyborg", { state: "stopped" });
  updatesStore.setState({ available: { version: "1.0.0-beta.2", notes: "### Fixed\n- Things." }, dialogOpen: true, progress: null });
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
