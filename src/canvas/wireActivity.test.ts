import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearWirePulses, expireWirePulses, signalWire, WIRE_PULSE_MS, wireActivityStore } from "./wireActivity";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  clearWirePulses();
});
afterEach(() => {
  clearWirePulses();
  vi.useRealTimers();
});

const pulses = () => wireActivityStore.getState().pulses;

it("records each agent's latest message, its direction and, when known, its fleet", () => {
  signalWire("isis", "toAgent", "chef");
  signalWire("thoth", "toFleet");
  expect(pulses()).toEqual({
    isis: { direction: "toAgent", at: 10_000, fleetId: "chef" },
    thoth: { direction: "toFleet", at: 10_000 },
  });
  vi.setSystemTime(10_400);
  // A newer message replaces the older one: its direction wins and its animation starts again.
  signalWire("isis", "toFleet", "chef");
  expect(pulses().isis).toEqual({ direction: "toFleet", at: 10_400, fleetId: "chef" });
});

it("drops a pulse once it has faded, with one timer and none while the wires are quiet", () => {
  expect(vi.getTimerCount()).toBe(0);
  signalWire("isis", "toAgent");
  vi.setSystemTime(10_500);
  signalWire("thoth", "toAgent");
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(WIRE_PULSE_MS - 500);
  expect(Object.keys(pulses())).toEqual(["thoth"]);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(500);
  expect(pulses()).toEqual({});
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps what is still fading when asked to expire early", () => {
  signalWire("isis", "toAgent", undefined, 9_000);
  signalWire("thoth", "toAgent", undefined, 10_000);
  expireWirePulses(10_600);
  expect(Object.keys(pulses())).toEqual(["thoth"]);
  expireWirePulses(10_000 + WIRE_PULSE_MS);
  expect(pulses()).toEqual({});
});
