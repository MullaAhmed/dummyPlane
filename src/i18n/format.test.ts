import { expect, it } from "vitest";
import { formatClock, formatDecimal, keyLabel } from "./format";

it("writes decimals with a point", () => {
  expect(formatDecimal(67.84, 1)).toBe("67.8");
});

it("names the keys as the English keyboard prints them", () => {
  expect(keyLabel("Ctrl+Shift+P")).toBe("Ctrl+Shift+P");
});

it("dates a usage reset: the time today, the weekday and time another day", () => {
  const now = new Date(2026, 9, 27, 14, 0).getTime();
  const tuesday = new Date(2026, 9, 28, 9, 0).getTime();
  const nextTuesday = new Date(2026, 10, 3, 9, 0).getTime();
  expect(formatClock(new Date(2026, 9, 27, 18, 5).getTime(), now)).toBe("18:05");
  expect(formatClock(tuesday, now)).toBe("Wed 09:00");
  // Beyond six days the weekday alone could be read as the nearest one: the date is added.
  expect(formatClock(nextTuesday, now)).toBe("3 Nov 09:00");
});
