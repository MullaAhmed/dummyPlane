import { describe, expect, it } from "vitest";
import { claudeUp, codexUp, promptUp, TRUST_QUIET_MS, trustKey, whenReady, type ReadyProbe } from "./ready";

const TRUST = "Accessing workspace:\n\nQuick safety check: Is this a project you created or one you trust?\n\n❯ No, exit\n  Yes, I trust this folder\n\nEnter to confirm · Esc to cancel";
const TRUST_YES = TRUST.replace("❯ No, exit\n  Yes", "  No, exit\n❯ Yes");
/** The question is drawn, its options not yet. */
const TRUST_QUESTION = "Accessing workspace:\n\nQuick safety check: Is this a project you created or one you trust? If not, take a\nmoment to review what's in this folder first.";
/** Claude's screen as seen in the app: its banner, then its input box between two rules. */
const CLAUDE = " ▐▛███▜▌   Claude Code v2.1.304\n▝▜█████▛▘  Opus 5.5\n\n──────────────────────── Claude · demo ─\n❯ \n────────────────────────────────────────\n  ⏵⏵ auto mode on (shift+tab to cycle)";
/** A resumed conversation: its history has pushed the banner off the screen. */
const RESUMED = "● J'ai clôturé la mission « linked ».\n\n──────────────────────────── Fleet ─\n❯ \n────────────────────────────────────────\n  ⏵⏵ auto mode on (shift+tab to cycle)";

/** Claude Code v2.1.322 in a project whose .mcp.json names a server it has not seen: its question comes before its prompt (captured 12 Nov). */
const MCP =
  "────────────────────────────────────────────────────────────────────────────────\n  New MCP server found in this project: supabase\n\n  MCP servers may execute code or access system resources. All tool calls\n  require approval. Learn more in the MCP documentation.\n\n    Use this MCP server\n    Use this and all future MCP servers in this project\n  ❯ Continue without using this MCP server\n\n  Enter to confirm · Esc to cancel";
/** The same terminal once the user answered it: its prompt shows a suggestion. */
const MCP_ANSWERED =
  " ▐▛███▛█   Claude Code v2.1.322\n▝▜██████▀  Opus 5.5 with xhigh effort · Claude Ultra\n ▝▝   ▝▝   D:\\Projects\\opensession\\wt\\be-upload-land.worktrees\\upload-throughput-plans-…\n\n⚠ 1 MCP server needs authentication · run /mcp\n\n\n──────────────────────────────────────────────────── Claude · upload-throughput-plans-thor ─\n❯ Try \"write a test for <filepath>\"\n────────────────────────────────────────────────────────────────────────────────────────────\n\n  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent";

/** Codex 0.167's screens, as a terminal shows them (captured under a ConPTY, rendered at 120 columns). */
const CODEX = "  >_ OpenAI Codex (v0.167.0)\n     D:\\temp\\spike\\repo\n\n\n› Ask Codex to do anything\n\n  gpt-5.6-luna medium · D:\\temp\\spike\\repo\n  ← for agents · ? for shortcuts                                                              ⚠ 2 warnings · f2 to view";
/** Mid-turn: the prompt stays drawn under its Working line. */
const CODEX_WORKING = "› [dummyPlane] Spike test.\n\n• Working (2s • esc to interrupt)\n\n› Ask Codex to do anything\n\n  gpt-5.6-luna medium · D:\\temp\\spike\\repo\n  ← for agents · ? for shortcuts";
/** Text sits in its prompt: the hint goes. */
const CODEX_TYPED = "› [dummyPlane] Spike test. Do these in order\n\n  gpt-5.6-luna medium · D:\\temp\\spike\\repo\n                                                                                              ⚠ 2 warnings · f2 to view";
const CODEX_TRUST = "  Folder access\n\n  D:\\temp\\spike\\repo\n\n  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings\n  can run code automatically, even without a model request. Continue only if you trust these files. Your trust\n  decision will be saved.\n\n› 1. Trust and continue\n  2. Back to Agent Command Center\n\n  enter continue · esc back";
const CODEX_TRUST_BACK = CODEX_TRUST.replace("› 1. Trust and continue\n  2.", "  1. Trust and continue\n› 2.");

/** An agent's terminal on a simulated clock: what it shows, when it last wrote, what was pressed. */
function agent(first: string, onPress: (keys: string, show: (screen: string) => void) => void = () => undefined) {
  let clock = 0;
  let wrote = 0;
  let screen = first;
  const pressed: string[] = [];
  const show = (next: string) => {
    screen = next;
    wrote = clock;
  };
  const probe: ReadyProbe = {
    running: () => true,
    quietMs: () => clock - wrote,
    screen: () => screen,
    press: async (keys) => {
      pressed.push(keys);
      onPress(keys, show);
    },
  };
  const wait = async (ms: number) => {
    clock += ms;
  };
  return { probe, wait, pressed, now: () => clock, wroteAt: () => wrote };
}

describe("trustKey", () => {
  it("moves down while « No » is selected and confirms only « Yes »", () => {
    expect(trustKey(TRUST)).toBe("\x1b[B");
    expect(trustKey(TRUST_YES)).toBe("\r");
    expect(trustKey(CLAUDE)).toBeNull();
  });

  it("waits for the options: the question drawn without its menu takes no key (README mission)", () => {
    expect(trustKey(TRUST_QUESTION)).toBeNull();
  });
});

describe("Codex's screens", () => {
  it("is up on its idle prompt only: not mid-turn, not with text typed, not on its trust question nor a shell", () => {
    expect(codexUp(CODEX)).toBe(true);
    expect(codexUp(CODEX_WORKING)).toBe(false);
    expect(codexUp(CODEX_TYPED)).toBe(false);
    expect(codexUp(CODEX_TRUST)).toBe(false);
    expect(codexUp("PS D:\\temp\\spike\\repo> codex")).toBe(false);
    expect(promptUp("codex", CODEX)).toBe(true);
    expect(promptUp("claude", CODEX)).toBe(false);
    expect(promptUp("gemini", "")).toBe(true);
  });

  it("confirms only « Trust and continue », and reads Claude's prompt as no question of its own", () => {
    expect(trustKey(CODEX_TRUST, "codex")).toBe("\r");
    expect(trustKey(CODEX_TRUST_BACK, "codex")).toBe("\x1b[A");
    expect(trustKey(CODEX, "codex")).toBeNull();
    expect(trustKey(TRUST, "codex")).toBeNull();
  });

  it("starts a Codex agent once its trust question is answered and its prompt quiet", async () => {
    const a = agent(CODEX_TRUST, (keys, show) => {
      if (keys === "\r") show(CODEX);
    });
    expect(await whenReady({ ...a.probe, agent: "codex" }, a.wait)).toBe(true);
    expect(a.pressed).toEqual(["\r"]);
    expect(a.now() - a.wroteAt()).toBeGreaterThanOrEqual(2000);
  });

  it("never takes Codex at work for ready", async () => {
    const a = agent(CODEX_WORKING);
    expect(await whenReady({ ...a.probe, agent: "codex" }, a.wait)).toBe(false);
  });
});

describe("whenReady", () => {
  it("accepts the trust prompt once, then waits for Claude's prompt to stay quiet 2 s", async () => {
    const a = agent(TRUST, (keys, show) => {
      if (keys === "\x1b[B") show(TRUST_YES);
      if (keys === "\r") show(CLAUDE);
    });
    expect(await whenReady(a.probe, a.wait)).toBe(true);
    expect(a.pressed).toEqual(["\x1b[B", "\r"]);
    expect(a.now() - a.wroteAt()).toBeGreaterThanOrEqual(2000);
    expect(a.now() - a.wroteAt()).toBeLessThan(2500);
  });

  it("is ready at once when Claude is already quiet", async () => {
    const a = agent(CLAUDE);
    await a.wait(5000);
    expect(await whenReady(a.probe, a.wait)).toBe(true);
    expect(a.pressed).toEqual([]);
  });

  it("never confirms « No, exit »: a Down the menu missed is sent again, Enter waits for « Yes » (README mission)", async () => {
    let downs = 0;
    const a = agent(TRUST, (keys, show) => {
      // Claude's menu draws before it takes keys: the first Down is lost.
      if (keys === "\x1b[B" && ++downs === 2) show(TRUST_YES);
      if (keys === "\r") show(CLAUDE);
    });
    expect(await whenReady(a.probe, a.wait)).toBe(true);
    expect(a.pressed).toEqual(["\x1b[B", "\x1b[B", "\r"]);
  });

  it("lets the prompt settle before its first key", async () => {
    const quietAtPress: number[] = [];
    const a = agent(TRUST);
    a.probe.press = async (keys) => {
      quietAtPress.push(a.probe.quietMs());
      a.pressed.push(keys);
    };
    await whenReady(a.probe, a.wait);
    expect(quietAtPress[0]).toBeGreaterThanOrEqual(TRUST_QUIET_MS);
  });

  it("gives up after 60 s, never confirming a prompt that stays on « No »", async () => {
    const a = agent(TRUST);
    expect(await whenReady(a.probe, a.wait)).toBe(false);
    expect(a.now()).toBeGreaterThanOrEqual(60_000);
    expect(a.pressed).not.toContain("\r");
    expect(a.pressed.length).toBeLessThanOrEqual(5);
  });

  it("reads Claude Code's question about a project's new MCP server as neither its prompt nor a trust question (screens of 12 Nov)", () => {
    expect(claudeUp(MCP)).toBe(false);
    expect(trustKey(MCP)).toBeNull();
    expect(claudeUp(MCP_ANSWERED)).toBe(true);
  });

  it("waits past the minute while told to, for a question only the user answers, says so once, and presses nothing", async () => {
    // The user answered it 27 minutes later (mission of 12 Nov).
    const a = agent(MCP);
    let slow = 0;
    let answered = false;
    const probe: ReadyProbe = {
      ...a.probe,
      screen: () => {
        if (!answered && a.now() >= 27 * 60_000) answered = true;
        return answered ? MCP_ANSWERED : MCP;
      },
      quietMs: () => (answered ? a.now() - 27 * 60_000 : 0),
      waitLonger: () => true,
      slow: () => slow++,
    };
    expect(await whenReady(probe, a.wait)).toBe(true);
    expect(a.now()).toBeGreaterThanOrEqual(27 * 60_000 + 2000);
    expect(slow).toBe(1);
    expect(a.pressed).toEqual([]);
  });

  it("gives up past the minute as soon as it is no longer told to wait", async () => {
    const a = agent(TRUST);
    let left = 4;
    let slow = 0;
    expect(await whenReady({ ...a.probe, waitLonger: () => left-- > 0, slow: () => slow++ }, a.wait, false)).toBe(false);
    expect(a.now()).toBeGreaterThanOrEqual(60_000 + 4 * 250);
    expect(a.now()).toBeLessThan(62_000);
    expect(slow).toBe(1);
  });

  it("knows Claude is up by its input box, the banner gone from a resumed conversation (final review H2)", async () => {
    const a = agent(RESUMED);
    await a.wait(5000);
    expect(await whenReady(a.probe, a.wait, false)).toBe(true);
  });

  it("never takes a trust prompt it may not answer for Claude's prompt (final review H2)", async () => {
    const a = agent(TRUST);
    expect(await whenReady(a.probe, a.wait, false)).toBe(false);
    expect(a.pressed).toEqual([]);
  });
});

describe("whenReady's held", () => {
  it("tells once what holds the session, as soon as it stands still, then null once the user answered it (issues #3, #14)", async () => {
    // Held 5 minutes by the MCP question; answered, the prompt comes up.
    const a = agent(MCP);
    const told: (string | null)[] = [];
    let answeredAt: number | null = null;
    const probe: ReadyProbe = {
      ...a.probe,
      screen: () => {
        if (answeredAt === null && a.now() >= 5 * 60_000) answeredAt = a.now();
        return answeredAt === null ? MCP : MCP_ANSWERED;
      },
      quietMs: () => (answeredAt === null ? a.now() : a.now() - answeredAt),
      waitLonger: () => true,
      held: (dialog) => told.push(dialog && `${dialog.kind}: ${dialog.title}`),
    };
    expect(await whenReady(probe, a.wait)).toBe(true);
    expect(told).toEqual(["mcp: New MCP server found in this project: supabase", null]);
    expect(a.pressed).toEqual([]);
  });

  it("never counts the trust prompt it answers itself, and lets go of a dialog on its way out", async () => {
    const trusting = agent(TRUST, (keys, show) => show(keys === "\r" ? CLAUDE : TRUST_YES));
    const told: unknown[] = [];
    expect(await whenReady({ ...trusting.probe, held: (dialog) => told.push(dialog) }, trusting.wait)).toBe(true);
    expect(told).toEqual([]);
    // One it may not answer holds it until it gives up: it hears null then.
    const held = agent(TRUST);
    const kinds: (string | null)[] = [];
    expect(await whenReady({ ...held.probe, held: (dialog) => kinds.push(dialog?.kind ?? null) }, held.wait, false)).toBe(false);
    expect(kinds).toEqual(["trust", null]);
  });
});

describe("whenReady's held, after its own Enter", () => {
  it("never takes the trust menu it just answered for a dialog, while Claude takes its time to redraw", async () => {
    // Under load, Claude redraws a second after the Enter; until then the menu stands still, on « Yes ».
    let enteredAt: number | null = null;
    const a = agent(TRUST, (keys, show) => {
      if (keys === "\r") enteredAt = a.now();
      else show(TRUST_YES);
    });
    const told: unknown[] = [];
    const probe: ReadyProbe = {
      ...a.probe,
      screen: () => (enteredAt !== null && a.now() - enteredAt >= 1000 ? CLAUDE : a.probe.screen()),
      quietMs: () => (enteredAt !== null && a.now() - enteredAt >= 1000 ? a.now() - enteredAt - 1000 : a.probe.quietMs()),
      held: (dialog) => told.push(dialog),
    };
    expect(await whenReady(probe, a.wait)).toBe(true);
    expect(told).toEqual([]);
  });
});
