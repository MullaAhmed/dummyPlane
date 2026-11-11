import { describe, expect, it } from "vitest";
import { DOT_OF_TONE } from "./StatusDot";
import { isTypingKey, pillActivity, pillOf, resumeOfferOf, startsNewConversation, startsOnKeystroke } from "./pill";

describe("pillOf", () => {
  it("labels each process state", () => {
    expect(pillOf({ state: "running" })).toEqual({ label: "Active", tone: "live" });
    expect(pillOf({ state: "stopped" })).toEqual({ label: "Stopped", tone: "stopped" });
    expect(pillOf({ state: "exited", code: 0 })).toEqual({ label: "Exited · 0", tone: "done" });
    expect(pillOf({ state: "exited", code: 2 })).toEqual({ label: "Exited · 2", tone: "failed" });
    expect(pillOf({ state: "exited", code: null })).toEqual({ label: "Exited", tone: "done" });
    expect(pillOf({ state: "error", message: "x" })).toEqual({ label: "Error", tone: "failed" });
  });
});

describe("resumeOfferOf", () => {
  it("offers to resume a conversation, to relaunch anything else, never while running", () => {
    expect(resumeOfferOf({ state: "stopped" }, true)).toBe("resume");
    expect(resumeOfferOf({ state: "stopped" }, false)).toBe("relaunch");
    expect(resumeOfferOf({ state: "exited", code: 0 }, false)).toBe("relaunch");
    expect(resumeOfferOf({ state: "running" }, true)).toBeNull();
  });
});

describe("startsOnKeystroke", () => {
  it("leaves a one-shot command to the Relancer button: a stray key must not run an installer again", () => {
    expect(startsOnKeystroke({ state: "stopped" }, true)).toBe(false);
    expect(startsOnKeystroke({ state: "exited", code: 0 }, true)).toBe(false);
  });

  it("starts a terminal from the keyboard only when nothing runs in it", () => {
    expect(startsOnKeystroke({ state: "stopped" })).toBe(true);
    expect(startsOnKeystroke({ state: "exited", code: 1 })).toBe(true);
    expect(startsOnKeystroke({ state: "error", message: "x" })).toBe(true);
    expect(startsOnKeystroke({ state: "running" })).toBe(false);
  });
});

describe("isTypingKey", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "altKey" | "metaKey", boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });

  it("counts characters and Enter as typing", () => {
    expect(isTypingKey(key("a"))).toBe(true);
    expect(isTypingKey(key("É"))).toBe(true);
    expect(isTypingKey(key("Enter"))).toBe(true);
    expect(isTypingKey(key("@", { ctrlKey: true, altKey: true }))).toBe(true); // AltGr on AZERTY
  });

  it("ignores navigation, function keys and shortcuts", () => {
    for (const k of ["Escape", "ArrowUp", "Tab", "F5", "Shift", "Backspace"]) expect(isTypingKey(key(k))).toBe(false);
    expect(isTypingKey(key("c", { ctrlKey: true }))).toBe(false);
    expect(isTypingKey(key("z", { ctrlKey: true }))).toBe(false);
    expect(isTypingKey(key("x", { altKey: true }))).toBe(false);
    expect(isTypingKey(key("v", { metaKey: true }))).toBe(false);
  });
});

describe("startsNewConversation", () => {
  it("keeps the conversation id when the previous launch failed", () => {
    expect(startsNewConversation({ state: "stopped" })).toBe(true);
    expect(startsNewConversation({ state: "exited", code: 0 })).toBe(true);
    expect(startsNewConversation({ state: "error", message: "folder not found" })).toBe(false);
  });
});

describe("a terminal waiting for its staggered start", () => {
  const starting = { state: "starting" } as const;

  it("reads Starting, not Stopped", () => {
    expect(pillOf(starting)).toEqual({ label: "Starting", tone: "stopped" });
  });

  it("offers neither to resume nor to relaunch", () => {
    expect(resumeOfferOf(starting, true)).toBeNull();
  });

  it("is not started a second time by a keystroke", () => {
    expect(startsOnKeystroke(starting)).toBe(false);
  });
});

describe("a running agent's activity", () => {
  const running = { state: "running" } as const;

  it("reads Ready, Working or Waiting", () => {
    expect(pillOf(running, "idle")).toEqual({ label: "Ready", tone: "ready" });
    expect(pillOf(running, "working")).toEqual({ label: "Working", tone: "working" });
    expect(pillOf(running, "waiting")).toEqual({ label: "Waiting", tone: "waiting" });
  });

  it("works in indigo for the indigo agents", () => {
    expect(pillOf(running, "working", true)).toEqual({ label: "Working", tone: "workingIndigo" });
  });

  it("reads Active while its activity is unknown, and ignores the activity of a stopped process", () => {
    expect(pillOf(running)).toEqual({ label: "Active", tone: "live" });
    expect(pillOf({ state: "stopped" }, "working")).toEqual({ label: "Stopped", tone: "stopped" });
  });
});

describe("a shell whose Claude exited", () => {
  const running = { state: "running" } as const;
  const left = (activity: "idle" | "working") => ({ activity, since: 1, left: true });

  it("says the agent exited rather than Ready, whatever the shell does, and before a standing report", () => {
    expect(pillOf(running, pillActivity(running, left("idle")))).toEqual({ label: "Agent exited", tone: "stopped" });
    expect(pillOf(running, pillActivity(running, left("working")), true, "done")).toEqual({ label: "Agent exited", tone: "stopped" });
    // Back to its activity as soon as a Claude reports again in that shell.
    expect(pillOf(running, pillActivity(running, { activity: "idle", since: 2 }))).toEqual({ label: "Ready", tone: "ready" });
  });

  it("reads nothing of the activity once the process stopped", () => {
    expect(pillActivity({ state: "exited", code: 0 }, left("idle"))).toBeUndefined();
    expect(pillActivity(running, undefined)).toBeUndefined();
  });

  it("never says a plain console works, waits or is active (the counts' words): its output reads Running, its quiet Ready", () => {
    const busy = { activity: "working" as const, since: 1 };
    expect(pillOf(running, pillActivity(running, busy, true))).toEqual({ label: "Running", tone: "live" });
    expect(pillOf(running, pillActivity(running, undefined, true))).toEqual({ label: "Running", tone: "live" });
    expect(pillOf(running, pillActivity(running, { activity: "idle", since: 1 }, true))).toEqual({ label: "Ready", tone: "ready" });
    expect(pillActivity({ state: "stopped" }, busy, true)).toBeUndefined();
    // An agent's terminal still reads its work.
    expect(pillOf(running, pillActivity(running, busy))).toEqual({ label: "Working", tone: "working" });
  });

  it("offers the agent back while the shell runs on", () => {
    expect(resumeOfferOf(running, true, true)).toBe("resume");
    expect(resumeOfferOf(running, false, true)).toBe("relaunch");
    expect(resumeOfferOf(running, true, false)).toBeNull();
    expect(resumeOfferOf({ state: "starting" }, true, true)).toBeNull();
    // Typing goes to the shell, where `claude` brings the agent back by hand: no fresh start on a key.
    expect(startsOnKeystroke(running)).toBe(false);
  });
});

describe("a running agent that reported", () => {
  const running = { state: "running" } as const;

  it("reads Done instead of Ready once its last report is done and it rests, then Working as soon as it works again", () => {
    expect(pillOf(running, "idle")).toEqual({ label: "Ready", tone: "ready" });
    expect(pillOf(running, "idle", false, "done")).toEqual({ label: "Done", tone: "done", report: "done" });
    expect(pillOf(running, "working", false, "done")).toEqual({ label: "Working", tone: "working" });
    expect(pillOf(running, "working", true, "done")).toEqual({ label: "Working", tone: "workingIndigo" });
  });

  it("reads Blocked or Failed likewise, in their tones", () => {
    expect(pillOf(running, "idle", false, "blocked")).toEqual({ label: "Blocked", tone: "waiting", report: "blocked" });
    expect(pillOf(running, "idle", false, "failed")).toEqual({ label: "Failed", tone: "failed", report: "failed" });
  });

  it("reads its report while its activity is unknown, but leaves a question it asks as Waiting", () => {
    expect(pillOf(running, undefined, false, "done")).toEqual({ label: "Done", tone: "done", report: "done" });
    expect(pillOf(running, "waiting", false, "done")).toEqual({ label: "Waiting", tone: "waiting" });
  });

  it("says the process state of one that does not run, whatever its report", () => {
    expect(pillOf({ state: "stopped" }, "idle", false, "done")).toEqual({ label: "Stopped", tone: "stopped" });
    expect(pillOf({ state: "starting" }, undefined, false, "done")).toEqual({ label: "Starting", tone: "stopped" });
  });

  it("takes the dot that its Done tone says: a ring in the ok colour", () => {
    expect(DOT_OF_TONE[pillOf(running, "idle", false, "done").tone]).toBe("done");
  });
});

it("offers no resume to a fleet refused for lack of dummyPlane's tools: its node says why", () => {
  expect(resumeOfferOf({ state: "error", message: "m", kind: "toolsUnavailable" }, true)).toBeNull();
  expect(resumeOfferOf({ state: "error", message: "m" }, true)).toBe("resume");
});
