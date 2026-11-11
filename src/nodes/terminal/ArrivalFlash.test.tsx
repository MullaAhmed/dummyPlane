// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ARRIVAL_FLASH_MS, signalArrival } from "@/canvas/arrivalSignal";
import { readSource } from "@/theme/cssBlocks";
import { ArrivalFlash } from "./ArrivalFlash";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("flashes the border of the terminal that arrives, anew on each arrival", async () => {
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

it("plays once: the ring is gone after 300 ms, so scrolling back or returning to the tab does not replay it", async () => {
  vi.useFakeTimers();
  try {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ArrivalFlash nodeId="ada" />));
    await act(async () => signalArrival("ada"));
    expect(host.querySelector("[data-arrival]")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(299));
    expect(host.querySelector("[data-arrival]")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.querySelector("[data-arrival]")).toBeNull();
    // A new arrival in the meantime keeps its own full 300 ms.
    await act(async () => signalArrival("ada"));
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => signalArrival("ada"));
    await act(async () => vi.advanceTimersByTime(200));
    expect(host.querySelector("[data-arrival]")).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  } finally {
    vi.useRealTimers();
  }
});

it("draws the ring at once and fades only its opacity, within 300 ms, inside every terminal", () => {
  const css = readSource("index.css");
  // The ring is static: never a box-shadow keyframe, which repaints every frame.
  expect(css).toMatch(/\.dp-arrival \{\s*box-shadow: inset 0 0 0 1px var\(--dp-accent\), inset 0 0 0 3px var\(--dp-on-accent\);/);
  expect(css).toMatch(/@keyframes dp-arrival-fade \{\s*to \{\s*opacity: 0;\s*\}\s*\}/);
  expect(css).toMatch(/\.dp-arrival \{[^}]*animation: dp-arrival-fade var\(--dp-dur\) var\(--dp-ease-out\) 100ms forwards;/);
  expect(css).not.toMatch(/@keyframes dp-arrival \{/);
  // The hold and the fade fit the flash's length.
  expect(ARRIVAL_FLASH_MS).toBe(100 + 200);
  expect(readSource("nodes/terminal/TerminalNode.tsx")).toContain("<ArrivalFlash nodeId={nodeId} />");
});
