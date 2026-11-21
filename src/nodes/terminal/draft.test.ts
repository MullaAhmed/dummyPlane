import { beforeEach, describe, expect, it } from "vitest";
import { agentActivityStore } from "@/store/agentActivity";
import { clearDraft, DRAFT_IDLE_MS, hasUnsentInput, trackInput } from "./draft";
import { NEWLINE_SEQUENCE } from "./keys";

const ESC = "\x1b";

beforeEach(() => {
  clearDraft("t");
  agentActivityStore.setState({ activities: {} });
});

describe("the text written in a terminal and not sent", () => {
  it("is there from the first character, as typed key by key or in one chunk (a composed word, a fast burst)", () => {
    expect(hasUnsentInput("t")).toBe(false);
    trackInput("t", "h");
    expect(hasUnsentInput("t")).toBe(true);
    clearDraft("t");
    trackInput("t", "hello world");
    expect(hasUnsentInput("t")).toBe(true);
  });

  it("goes with Enter, Ctrl+C and Ctrl+U, and with a second Escape right after the first", () => {
    for (const clear of ["\r", "\x03", "\x15"]) {
      trackInput("t", "some text");
      trackInput("t", clear);
      expect(hasUnsentInput("t")).toBe(false);
    }
    trackInput("t", "some text");
    trackInput("t", ESC, 1000);
    expect(hasUnsentInput("t")).toBe(true);
    trackInput("t", ESC, 1200);
    expect(hasUnsentInput("t")).toBe(false);
    // Two Escapes far apart are two interruptions, not a clear.
    trackInput("t", "again");
    trackInput("t", ESC, 5000);
    trackInput("t", ESC, 9000);
    expect(hasUnsentInput("t")).toBe(true);
  });

  it("goes when Backspace has taken every character off, and not before", () => {
    trackInput("t", "ab");
    trackInput("t", "\x7f");
    expect(hasUnsentInput("t")).toBe(true);
    trackInput("t", "\x7f");
    expect(hasUnsentInput("t")).toBe(false);
    trackInput("t", "\x7f");
    expect(hasUnsentInput("t")).toBe(false);
  });

  it("counts a paste as text, its newlines too: only the Enter pressed afterwards sends it", () => {
    trackInput("t", `${ESC}[200~first line\rsecond line${ESC}[201~`);
    expect(hasUnsentInput("t")).toBe(true);
    trackInput("t", "\r");
    expect(hasUnsentInput("t")).toBe(false);
    // An empty paste writes nothing.
    trackInput("t", `${ESC}[200~${ESC}[201~`);
    expect(hasUnsentInput("t")).toBe(false);
  });

  it("keeps what follows a newline of an unbracketed paste, which sent the lines before it", () => {
    trackInput("t", "one\rtwo");
    expect(hasUnsentInput("t")).toBe(true);
  });

  it("is made by no key that writes no text, and none of what xterm answers on its own", () => {
    for (const data of [`${ESC}[I`, `${ESC}[O`, `${ESC}[12;40R`, `${ESC}[?1;2c`, `${ESC}[A`, `${ESC}[B`, "\t", "\x0c", "\x01"]) trackInput("t", data);
    expect(hasUnsentInput("t")).toBe(false);
  });

  it("is let go once the user has left it for good, so a forgotten draft holds nothing back for ever", () => {
    trackInput("t", "forgotten", 0);
    expect(hasUnsentInput("t", DRAFT_IDLE_MS - 1)).toBe(true);
    expect(hasUnsentInput("t", DRAFT_IDLE_MS)).toBe(false);
  });

  // "2" answers a permission dialog with no Enter: it must not leave a draft that holds every notice back for ten minutes.
  it("is made by no key while a dialog waits for the user: the keys answer it", () => {
    agentActivityStore.getState().apply({ nodeId: "t", activity: "waiting", since: 1 });
    trackInput("t", "2");
    trackInput("t", "y");
    expect(hasUnsentInput("t")).toBe(false);
    agentActivityStore.getState().apply({ nodeId: "t", activity: "idle", since: 2 });
    trackInput("t", "2");
    expect(hasUnsentInput("t")).toBe(true);
  });

  it("is neither made nor cleared by Shift+Enter, which writes a newline into the prompt (Escape, then Enter)", () => {
    trackInput("t", NEWLINE_SEQUENCE);
    expect(hasUnsentInput("t")).toBe(false);
    trackInput("t", "first line");
    trackInput("t", NEWLINE_SEQUENCE);
    expect(hasUnsentInput("t")).toBe(true);
  });

  it("is each terminal's own, and goes with its session", () => {
    trackInput("t", "mine");
    expect(hasUnsentInput("other")).toBe(false);
    clearDraft("t");
    expect(hasUnsentInput("t")).toBe(false);
  });
});
