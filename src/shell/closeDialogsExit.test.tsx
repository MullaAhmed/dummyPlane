// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { CloseGroupDialog } from "./CloseGroupDialog";

/**
 * A dialog that stays mounted once closed, as Radix keeps one through its exit animation
 * (happy-dom runs no animation, so Radix would unmount it at once): what it shows while it
 * leaves is then on screen to be read.
 */
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (
      <div role="dialog" data-state={open ? "open" : "closed"}>
        {children}
      </div>
    ),
    DialogContent: Part,
    DialogHeader: Part,
    DialogFooter: Part,
    DialogTitle: Part,
    DialogDescription: Part,
  };
});
vi.mock("@/agents/terminals", () => ({ removeNodes: vi.fn() }));
vi.mock("@/agents/groups", () => ({ closeGroup: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("cyborg", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Cyborg", name: "Cyborg", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;

it("keeps the agent's name while its dialog leaves, the agent already gone, and does not remount to leave", async () => {
  await act(async () => root.render(<CloseAgentDialog />));
  await act(async () => uiStore.getState().setClosing({ agents: ["cyborg"], remove: ["cyborg"] }));
  const open = dialog();
  expect(open.textContent).toContain("Close Cyborg?");
  const nodes = nodesStore.getState().nodes;
  await act(async () => {
    nodesStore.setState({ nodes: Object.fromEntries(Object.entries(nodes).filter(([id]) => id !== "cyborg")) } as never);
    uiStore.getState().setClosing(null);
  });
  expect(dialog(), "the same dialog: a remount would cut its exit").toBe(open);
  expect(dialog().getAttribute("data-state")).toBe("closed");
  expect(dialog().textContent).toContain("Close Cyborg?");
  // Its confirm does nothing once closed.
  const { removeNodes } = await import("@/agents/terminals");
  vi.mocked(removeNodes).mockClear();
  await act(async () => button("Close the agent").click());
  expect(removeNodes).not.toHaveBeenCalled();
  nodesStore.setState({ nodes } as never);
});

it("keeps the group's question while its dialog leaves, the group already closed", async () => {
  const frame = { id: "g1", name: "Backend", memberIds: [], group: {} };
  canvasStore.setState({ frames: [frame] } as never);
  await act(async () => root.render(<CloseGroupDialog />));
  await act(async () => uiStore.getState().setClosingGroup("g1"));
  expect(dialog().textContent).toContain("Close the group Backend?");
  await act(async () => {
    canvasStore.setState({ frames: [] } as never);
    uiStore.getState().setClosingGroup(null);
  });
  expect(dialog().getAttribute("data-state")).toBe("closed");
  expect(dialog().textContent).toContain("Close the group Backend?");
  expect(dialog().textContent).not.toContain("undefined");
});

it("asks about a group with no name as \"this group\"", async () => {
  canvasStore.setState({ frames: [{ id: "g2", name: "", memberIds: [], group: {} }] } as never);
  await act(async () => root.render(<CloseGroupDialog />));
  await act(async () => uiStore.getState().setClosingGroup("g2"));
  expect(dialog().textContent).toContain("Close this group?");
  await act(async () => uiStore.getState().setClosingGroup(null));
});
