// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { openLogDir } from "@/app/logs";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { ToolsUnavailable } from "./ToolsUnavailable";

vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(() => Promise.resolve()) }));
vi.mock("@/app/logs", () => ({ openLogDir: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("says why the orchestrator did not start, and retries it (spec première version §4.1)", async () => {
  mockIPC(() => undefined);
  const session = { title: "Orchestrateur", name: "Orchestrateur", agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", role: "orchestrator" as const, claudeSessionId: "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10" };
  await nodesStore.getState().create("o", { workspaceId: "w", kind: "orchestrator", payload: { name: "Orchestrateur", session } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const message = "OpenVibe tools unavailable: the local OpenVibe server did not start.";
  await act(async () => root.render(<ToolsUnavailable nodeId="o" message={message} />));
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("OpenVibe tools unavailable");
  expect(alert.textContent).toContain("the local OpenVibe server did not start");
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => button("Try again").click());
  expect(relaunchTerminal).toHaveBeenCalledWith("o", session, "resume");
  await act(async () => button("Open the logs folder").click());
  expect(openLogDir).toHaveBeenCalled();
  await act(async () => root.unmount());
});
