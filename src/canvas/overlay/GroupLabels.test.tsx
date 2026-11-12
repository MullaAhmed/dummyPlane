// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { screenRectOf } from "@/agents/placement";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { canvasStore, EMPTY_VIEW } from "../canvasStore";
import { GroupBackdrops } from "./GroupBackdrops";
import { GroupLabels } from "./GroupLabels";

// Each outline and each label works out its place once per render: the count of their renders.
vi.mock("@/agents/placement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/placement")>();
  return { ...actual, screenRectOf: vi.fn(actual.screenRectOf) };
});

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frame = (folded: boolean) => ({
  id: "g",
  name: "API",
  x: 0,
  y: 100,
  width: 800,
  height: 500,
  group: { role: "general", pantheon: "greek", ...(folded ? { folded } : {}) },
  memberIds: ["a", "b"],
});

it("folds on the label's chevron, keeps the counters, and unfolds with a click", async () => {
  mockIPC(() => undefined);
  let scene: Record<string, unknown>[] = [{ id: "g", type: "frame", customData: { dummyplane: { kind: "group", role: "general", pantheon: "greek" } } }];
  const updateScene = vi.fn(({ elements }: { elements?: typeof scene }) => {
    if (elements) scene = elements;
  });
  canvasStore.setState({
    view: { ...EMPTY_VIEW, width: 1000, height: 800 },
    frames: [frame(false)] as never,
    api: { getSceneElementsIncludingDeleted: () => scene, updateScene } as unknown as ExcalidrawImperativeAPI,
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <GroupBackdrops />
        <GroupLabels />
      </>,
    ),
  );
  expect(host.querySelectorAll("[data-backdrop]").length).toBe(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Fold the group"]')!.click());
  expect((scene[0].customData as { dummyplane: { folded?: boolean } }).dummyplane.folded).toBe(true);
  // Folded: the frame is redrawn from the scene; the label stays, with its counters and the way back.
  await act(async () => canvasStore.setState({ frames: [frame(true)] as never }));
  expect(host.textContent).toContain("API");
  expect(host.textContent).toContain("2 · idle");
  expect(host.querySelector('[aria-label="Unfold the group"]')).not.toBeNull();
  expect(host.querySelectorAll("[data-backdrop]").length).toBe(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Unfold the group"]')!.click());
  expect((scene[0].customData as { dummyplane: { folded?: boolean } }).dummyplane.folded).toBeUndefined();
  await act(async () => root.unmount());
});

it("a pan moves the outlines' and the labels' layers and draws none of them again; a zoom, or what a label shows, does", async () => {
  mockIPC(() => undefined);
  canvasStore.setState({ view: { ...EMPTY_VIEW, width: 1000, height: 800, zoom: 0.5, scrollX: 100 }, frames: [frame(false)] as never });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <GroupBackdrops />
        <GroupLabels />
      </>,
    ),
  );
  const drawn = () => vi.mocked(screenRectOf).mock.calls.length;
  const once = drawn();
  expect(once).toBe(2);
  for (let frame = 1; frame <= 30; frame++) {
    await act(async () => canvasStore.setState((s) => ({ view: { ...s.view, scrollX: 100 - frame * 10, scrollY: frame * 4 } })));
  }
  // A status of a terminal in no group: the labels' counts as they were.
  await act(async () => terminalStatusStore.setState((s) => ({ statuses: { ...s.statuses, elsewhere: { state: "running" } } } as never)));
  expect(drawn()).toBe(once);
  // Each still where it was drawn before: the layer's scroll, then its place at the zoom. (0 + -200) * 0.5; (100 + 120) * 0.5.
  const backdrop = host.querySelector<HTMLElement>("[data-backdrop]")!;
  const scrolled = (el: HTMLElement) => {
    const [, x, y] = el.parentElement!.style.transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\)$/)!.map(Number);
    return { left: x + parseFloat(el.style.left), top: y + parseFloat(el.style.top) };
  };
  expect(scrolled(backdrop)).toEqual({ left: -100, top: 110 });
  const label = host.querySelector<HTMLElement>('[aria-label="Fold the group"]')!.parentElement!;
  // 16 px in from the frame's corner (one pixel back for the border), 24 px tall above its top edge, at any zoom.
  expect(scrolled(label)).toEqual({ left: -100 + 15, top: 110 - 24 });
  // A zoom resizes them: both drawn again.
  await act(async () => canvasStore.setState((s) => ({ view: { ...s.view, zoom: 0.8 } })));
  expect(drawn()).toBe(once + 2);
  // What a label shows: renamed in place, that label alone is drawn again.
  await act(async () => uiStore.getState().setRenamingGroup("g"));
  expect(drawn()).toBe(once + 3);
  expect(host.querySelector('input[aria-label]')).not.toBeNull();
  await act(async () => uiStore.getState().setRenamingGroup(null));
  await act(async () => root.unmount());
});
