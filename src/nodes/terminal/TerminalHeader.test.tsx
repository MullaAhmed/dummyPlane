// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { requestUi } from "@/commands/uiRequests";
import { remoteStore } from "@/fleet/remoteControl";
import { TerminalHeader } from "./TerminalHeader";

vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), terminalText: vi.fn(() => "") }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens its name editor on request, with the keyboard (« Rename » of the palette)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const payload = { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={payload} status={{ state: "stopped" }} />));
  expect(host.querySelector("input")).toBeNull();
  await act(async () => requestUi({ kind: "renameTerminal", id: "thot" }));
  expect(host.querySelector("input")).toBeNull();
  await act(async () => requestUi({ kind: "renameTerminal", id: "isis" }));
  const field = host.querySelector("input")!;
  expect(field.value).toBe("Isis");
  expect(document.activeElement).toBe(field);
  await act(async () => root.unmount());
  host.remove();
});

it("shows Remote Control on a Claude session only, as dummyPlane knows it (spec maj §2)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const claude = { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;
  const phone = () => host.querySelector("[data-remote]");
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={{ ...claude, agent: "shell" }} status={{ state: "running" }} />));
  expect(phone()).toBeNull();
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={claude} status={{ state: "running" }} />));
  expect(phone()?.getAttribute("data-remote")).toBe("off");
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={{ ...claude, remoteControl: true }} status={{ state: "stopped" }} />));
  expect(phone()?.getAttribute("aria-label")).toBe("Remote Control at next start");
  await act(async () => remoteStore.getState().set("isis", { state: "on", url: "https://claude.ai/code/session_1" }));
  expect(phone()?.getAttribute("aria-label")).toBe("Remote Control on");
  await act(async () => root.unmount());
  host.remove();
});

it("shows the model a mission's router gave the agent, which outlives the mission otherwise unseen (final review maj §3)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const claude = { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={claude} status={{ state: "running" }} />));
  expect(host.querySelector("[data-model]")).toBeNull();
  await act(async () => root.render(<TerminalHeader nodeId="isis" payload={{ ...claude, model: "claude-haiku-5-5" }} status={{ state: "running" }} />));
  expect(host.querySelector("[data-model]")?.textContent).toBe("Haiku 5.5");
  await act(async () => root.unmount());
  host.remove();
});

