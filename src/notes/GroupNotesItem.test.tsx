// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { GroupMenu } from "@/agents/GroupMenu";
import { closeGroupNotes, notesStore } from "./notesStore";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The menu looks for the agents when it opens (its Add an agent): the lists of the machine are empty here.
beforeEach(() => void mockIPC((cmd) => (cmd.startsWith("list_") ? [] : undefined)));
afterEach(() => {
  clearMocks();
  closeGroupNotes();
});

it("chooses a group's notes from its menu", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GroupMenu groupId="g1" />));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === "Notes of the group…");
  await act(async () => item!.click());
  expect(notesStore.getState().attaching).toBe("g1");
  await act(async () => root.unmount());
  host.remove();
});
