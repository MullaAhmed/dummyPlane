import { expect, it, vi } from "vitest";
import { installLogging } from "./log";

function recorder() {
  const sent: [string, string][] = [];
  return {
    sent,
    target: {
      warn: (message: string) => (sent.push(["warn", message]), Promise.resolve()),
      error: (message: string) => (sent.push(["error", message]), Promise.resolve()),
    },
  };
}

it("sends console warnings and errors to the log file, and keeps them in the console", () => {
  const { sent, target } = recorder();
  const original = vi.fn();
  const fakeConsole = { warn: original, error: original } as unknown as Console;
  installLogging(target, fakeConsole, new EventTarget() as unknown as Window);
  fakeConsole.warn("projects not refreshed", new Error("offline"));
  fakeConsole.error("boom");
  expect(sent).toEqual([
    ["warn", "projects not refreshed Error: offline"],
    ["error", "boom"],
  ]);
  expect(original).toHaveBeenCalledTimes(2);
});

it("logs uncaught errors and unhandled rejections", () => {
  const { sent, target } = recorder();
  const win = new EventTarget() as unknown as Window;
  installLogging(target, { warn: vi.fn(), error: vi.fn() } as unknown as Console, win);
  win.dispatchEvent(Object.assign(new Event("error"), { error: new Error("render") }));
  win.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));
  expect(sent).toEqual([
    ["error", "uncaught: Error: render"],
    ["error", "unhandled rejection: nope"],
  ]);
});

it("keeps working when the log file cannot be written", async () => {
  const fakeConsole = { warn: vi.fn(), error: vi.fn() } as unknown as Console;
  installLogging({ warn: () => Promise.reject(new Error("no ipc")), error: () => Promise.reject(new Error("no ipc")) }, fakeConsole, new EventTarget() as unknown as Window);
  expect(() => fakeConsole.error("still shown")).not.toThrow();
  await Promise.resolve();
});

it("survives a value whose text cannot be made", () => {
  const { sent, target } = recorder();
  const fakeConsole = { warn: vi.fn(), error: vi.fn() } as unknown as Console;
  installLogging(target, fakeConsole, new EventTarget() as unknown as Window);
  const hostile = Object.create(null) as object;
  expect(() => fakeConsole.error("failed:", hostile)).not.toThrow();
  expect(sent[0][1]).toContain("failed:");
});

it("fills every directive with its value, as the console does, not only those at the start", () => {
  const { sent, target } = recorder();
  const fakeConsole = { warn: vi.fn(), error: vi.fn() } as unknown as Console;
  installLogging(target, fakeConsole, new EventTarget() as unknown as Window);
  fakeConsole.error("%s failed: %o", "save", new Error("disk full"));
  // %c's value is a style, never text; a directive with no value left stays as written; %% is a percent sign.
  fakeConsole.warn("%cstyled%c %d%% done, then %s", "color: red", "", 50, "more", "extra");
  fakeConsole.warn("left %s");
  expect(sent).toEqual([
    ["error", "save failed: Error: disk full"],
    ["warn", "styled 50% done, then more extra"],
    ["warn", "left %s"],
  ]);
});

it("drops the literal %o React leaves at the start of its errors", () => {
  const { sent, target } = recorder();
  const fakeConsole = { warn: vi.fn(), error: vi.fn() } as unknown as Console;
  installLogging(target, fakeConsole, new EventTarget() as unknown as Window);
  fakeConsole.error("%o\n\n%s\n\n%s\n", new Error("render"), "tree", "advice");
  expect(sent[0][1].startsWith("%o")).toBe(false);
  expect(sent[0][1]).toContain("Error: render");
});
