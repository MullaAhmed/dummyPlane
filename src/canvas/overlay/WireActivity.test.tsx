// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import type { SceneFrame } from "../groups";
import { clearWirePulses, signalWire, WIRE_PULSE_MS } from "../wireActivity";
import { WireActivity } from "./WireActivity";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers();
  clearWirePulses();
  canvasStore.setState({
    view: { ...EMPTY_VIEW, zoom: 0.5, scrollX: 100, scrollY: -20 },
    frames: [{ id: "backend", group: { role: "backend" }, memberIds: ["isis"] }] as unknown as SceneFrame[],
    wires: [
      { id: "w1", orchestratorId: "chef", targetId: "backend", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 80 }] },
      { id: "w2", orchestratorId: "chef", targetId: "seth", points: [{ x: 0, y: 0 }, { x: 0, y: 300 }] },
    ],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WireActivity />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearWirePulses();
  vi.useRealTimers();
});

it("mounts nothing while the wires are quiet", () => {
  expect(host.innerHTML).toBe("");
});

it("runs a light along the wire of a message, the way it goes, at the view's scale, then takes it away", async () => {
  await act(async () => signalWire("isis", "toOrchestrator", "chef"));
  const svg = host.querySelector<SVGSVGElement>("[data-wire-activity]")!;
  expect(svg.getAttribute("class")).toContain("pointer-events-none");
  expect(svg.querySelector("g")!.getAttribute("transform")).toBe("scale(0.5) translate(100 -20)");
  const pulse = svg.querySelector<SVGGElement>("[data-wire]")!;
  expect([pulse.dataset.wire, pulse.dataset.direction]).toEqual(["w1", "toOrchestrator"]);
  // From the group back to the orchestrator.
  expect([...pulse.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual(Array(3).fill("M50 80 L50 0 L0 0"));
  expect(pulse.querySelector(".dp-wire-glow")).not.toBeNull();
  expect(pulse.querySelector(".dp-wire-packet")!.getAttribute("pathLength")).toBe("1");

  await act(async () => vi.advanceTimersByTime(WIRE_PULSE_MS));
  expect(host.innerHTML).toBe("");
});

it("lights only the wires that carry a message", async () => {
  await act(async () => signalWire("seth", "toAgent"));
  expect([...host.querySelectorAll<SVGGElement>("[data-wire]")].map((g) => [g.dataset.wire, g.dataset.direction])).toEqual([["w2", "toAgent"]]);
  expect(host.querySelector("[data-wire] path")!.getAttribute("d")).toBe("M0 0 L0 300");
});

it("shows nothing for a message between agents and orchestrators no wire joins", async () => {
  await act(async () => signalWire("isis", "toAgent", "boss"));
  expect(host.innerHTML).toBe("");
});
