// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState, GRACE_MS } from "./EmptyState";

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

describe("what a pane or a list says when it has nothing to show", () => {
  it("centres a pane's line in what is left, and sets a list's line among the rows", async () => {
    await act(async () => root.render(<EmptyState>Nothing picked</EmptyState>));
    expect(host.querySelector("p")!.className).toBe("grid flex-1 place-items-center p-6 text-center text-xs text-dp-text-2");
    await act(async () => root.render(<EmptyState place="list">No notes</EmptyState>));
    expect(host.querySelector("p")!.className).toBe("px-3 py-4 text-center text-xs text-dp-text-2");
    expect(host.textContent).toBe("No notes");
  });

  it("speaks at once, unless it is a loading line that asks for its grace", async () => {
    await act(async () => root.render(<EmptyState>Nothing picked</EmptyState>));
    expect(host.textContent).toBe("Nothing picked");
  });

  it("keeps a loading line back for the grace, in its place, so a quick answer shows no flash", async () => {
    await act(async () => root.render(<EmptyState grace>Reading the files…</EmptyState>));
    expect(host.querySelector("p")).not.toBeNull();
    expect(host.textContent).toBe("");
    await act(async () => void vi.advanceTimersByTime(GRACE_MS - 1));
    expect(host.textContent).toBe("");
    await act(async () => void vi.advanceTimersByTime(1));
    expect(host.textContent).toBe("Reading the files…");
  });

  it("speaks at once when a loading line turns into an empty state: the answer is in, there is nothing to wait for", async () => {
    await act(async () => root.render(<EmptyState place="list" grace>Reading the notes…</EmptyState>));
    expect(host.textContent).toBe("");
    await act(async () => root.render(<EmptyState place="list">No notes</EmptyState>));
    expect(host.textContent).toBe("No notes");
  });

  it("leaves no timer behind when what it waited for arrived first", async () => {
    await act(async () => root.render(<EmptyState grace>Reading the files…</EmptyState>));
    await act(async () => root.render(<div>the files</div>));
    expect(vi.getTimerCount()).toBe(0);
  });
});
