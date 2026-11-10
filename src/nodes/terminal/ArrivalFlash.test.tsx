// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { signalArrival } from "@/canvas/arrivalSignal";
import { readSource } from "@/theme/cssBlocks";
import { ArrivalFlash } from "./ArrivalFlash";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("flashes the border of the terminal that arrives, anew on each arrival (spec fenêtre §6.4)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <div data-node="batman">
          <ArrivalFlash nodeId="batman" />
        </div>
        <div data-node="cyborg">
          <ArrivalFlash nodeId="cyborg" />
        </div>
      </>,
    ),
  );
  expect(host.querySelector("[data-arrival]")).toBeNull();
  await act(async () => signalArrival("batman"));
  const first = host.querySelector('[data-node="batman"] [data-arrival]')!;
  expect(first.className).toContain("dp-arrival");
  expect(host.querySelector('[data-node="cyborg"] [data-arrival]')).toBeNull();
  await act(async () => signalArrival("batman"));
  // A new element restarts the animation.
  expect(host.querySelector('[data-node="batman"] [data-arrival]')).not.toBe(first);
  await act(async () => signalArrival("cyborg"));
  expect(host.querySelector('[data-node="batman"] [data-arrival]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("plays once: the ring is gone after 600 ms, so scrolling back or returning to the tab does not replay it", async () => {
  vi.useFakeTimers();
  try {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ArrivalFlash nodeId="ada" />));
    await act(async () => signalArrival("ada"));
    expect(host.querySelector("[data-arrival]")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(599));
    expect(host.querySelector("[data-arrival]")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.querySelector("[data-arrival]")).toBeNull();
    // A new arrival in the meantime keeps its own full 600 ms.
    await act(async () => signalArrival("ada"));
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => signalArrival("ada"));
    await act(async () => vi.advanceTimersByTime(400));
    expect(host.querySelector("[data-arrival]")).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  } finally {
    vi.useRealTimers();
  }
});

it("fades the accent back in 600 ms, inside every terminal", () => {
  expect(readSource("index.css")).toMatch(/@keyframes dp-arrival \{[^}]*var\(--dp-accent\)/);
  expect(readSource("index.css")).toMatch(/\.dp-arrival \{[^}]*dp-arrival 600ms/);
  expect(readSource("nodes/terminal/TerminalNode.tsx")).toContain("<ArrivalFlash nodeId={nodeId} />");
});
