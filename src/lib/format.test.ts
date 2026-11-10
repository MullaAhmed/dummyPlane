import { describe, expect, it } from "vitest";
import { AppError } from "@/ipc/invoke";
import { errorText, formatAgo, formatDuration, plural } from "./format";

it("tells an error by its message alone, as a toast reads it", () => {
  expect(errorText(new AppError("db", "the workspace is gone"))).toBe("the workspace is gone");
  expect(errorText(new Error("disk full"))).toBe("disk full");
  expect(errorText("refused")).toBe("refused");
});

describe("formatAgo", () => {
  const now = 1_000_000_000;
  it("says how long ago, in English", () => {
    expect(formatAgo(now - 20_000, now)).toBe("just now");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe("3 d ago");
    expect(formatAgo(now + 5_000, now)).toBe("just now");
  });
});

describe("plural", () => {
  it("uses the singular for 1 only", () => {
    expect(plural(0, "workspace", "workspaces")).toBe("0 workspaces");
    expect(plural(1, "agent", "agents")).toBe("1 agent");
    expect(plural(3, "agent", "agents")).toBe("3 agents");
  });
});

describe("formatDuration", () => {
  it("reads like the agents panel (spec habillage §10.4)", () => {
    expect(formatDuration(45_400)).toBe("45 s");
    expect(formatDuration(12 * 60_000 + 5_000)).toBe("12 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05");
    expect(formatDuration(-3)).toBe("0 s");
  });
});
