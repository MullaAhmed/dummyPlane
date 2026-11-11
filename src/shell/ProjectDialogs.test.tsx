// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { uiStore } from "@/store/ui";
import { ProjectDialogs } from "./ProjectDialogs";

const agentDialog = vi.hoisted(() => ({ fails: true }));

vi.mock("./CloseAgentDialog", () => ({
  CloseAgentDialog: () => {
    if (agentDialog.fails) throw new Error("dialog failed");
    return <p>agent dialog</p>;
  },
}));
vi.mock("./CloseGroupDialog", () => ({ CloseGroupDialog: () => <p>group dialog</p> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a failing dialog to itself: the project stays on screen (spec première version §3.4)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  agentDialog.fails = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <ProjectDialogs />
        <p>project</p>
      </>,
    ),
  );
  expect(host.textContent).toBe("group dialogproject");
  await act(async () => root.unmount());
  host.remove();
});

it("tries a failed dialog again on the next closing request, instead of staying down for the session", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  agentDialog.fails = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectDialogs />));
  expect(host.textContent).toBe("group dialog");
  // Whatever broke it is gone; the next "Close Batman?" asks the dialog again.
  agentDialog.fails = false;
  await act(async () => uiStore.getState().setClosing({ agents: ["a"], remove: ["a"] }));
  expect(host.textContent).toBe("agent dialoggroup dialog");
  await act(async () => uiStore.getState().setClosing(null));
  await act(async () => root.unmount());
  host.remove();
});

it("drops a closing request its failed dialog can no longer answer, so the same agents asked again open it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  agentDialog.fails = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectDialogs />));
  await act(async () => uiStore.getState().setClosing({ agents: ["a"], remove: ["a"] }));
  // Failed while asked: the request is dropped rather than left pending forever.
  expect(uiStore.getState().closing).toBeNull();
  agentDialog.fails = false;
  await act(async () => uiStore.getState().setClosing({ agents: ["a"], remove: ["a"] }));
  expect(host.textContent).toContain("agent dialog");
  await act(async () => uiStore.getState().setClosing(null));
  await act(async () => root.unmount());
  host.remove();
});
