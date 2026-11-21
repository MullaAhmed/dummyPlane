// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GRACE_MS } from "@/components/EmptyState";
import { PanelSkeleton } from "./PanelSkeleton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("stands where a lazy workspace will be: named for a screen reader at once, drawn after the grace, and still", async () => {
  await act(async () => root.render(<PanelSkeleton label="Loading…" />));
  const skeleton = host.querySelector<HTMLElement>("[role='status']")!;
  expect(skeleton.getAttribute("aria-label")).toBe("Loading…");
  expect(skeleton.getAttribute("aria-busy")).toBe("true");
  // A module already loaded shows nothing: the frame holds its place and stays empty.
  expect(skeleton.children).toHaveLength(0);
  await act(async () => void vi.advanceTimersByTime(GRACE_MS));
  // A list and a page, in the workspaces' own glass, with quiet bars for rows.
  expect(skeleton.children).toHaveLength(2);
  expect(skeleton.querySelectorAll("span.bg-dp-hover").length).toBeGreaterThan(6);
  // Nothing moves: the one animated thing in the app is the waiting dot.
  expect(skeleton.outerHTML).not.toMatch(/animate-|transition/);
});
