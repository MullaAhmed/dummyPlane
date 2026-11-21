import { describe, expect, it } from "vitest";
import { accountsMessages } from "@/accounts/messages";
import { agentsMessages, inLine, stateWords } from "@/agents/messages";
import { summaryParts } from "@/agents/groupSummary";
import { appMessages } from "@/app/messages";
import { catalogMessages } from "@/commands/catalog/messages";
import { loopsMessages } from "@/loops/messages";
import { missionMessages } from "@/mission/messages";
import { nodesMessages } from "@/nodes/messages";
import { kanbanBoardMessages } from "@/nodes/kanban/boardMessages";
import { notificationsMessages } from "@/notifications/messages";
import { reviewMessages } from "@/review/messages";
import { shellMessages } from "@/shell/messages";
import { readSource, sourceFiles } from "@/theme/cssBlocks";
import { messages } from "./index";

it("names one action with one word across the menus and the palette (final review R5a)", () => {
  expect(messages(shellMessages).toolRail.launchAgent).toBe("Add to canvas");
  const labels = messages(catalogMessages).commands;
  expect(labels["group.linkFleet"].label).toBe("Link a fleet");
  expect(labels["fleet.link"].label).toBe("Link");
  expect(labels["project.close"].label).toBe("Close the project");
  expect(labels["workspace.delete"].label).toBe("Delete the workspace");
  expect(labels["group.close"].label).toBe("Close the group");
  expect(labels["group.rename"].label).toBe("Rename the group");
});

it("counts in proper English", () => {
  expect(messages(missionMessages).linked(1)).toBe("1 agent linked");
  expect(messages(missionMessages).linked(2)).toBe("2 agents linked");
  expect(messages(reviewMessages).moreLines(1)).toBe("… 1 more line");
  expect(messages(reviewMessages).moreLines(3)).toBe("… 3 more lines");
  expect(messages(agentsMessages).resumeAll.stayStopped(1)).toBe("1 finished sub-agent stays stopped");
  expect(messages(agentsMessages).resumeAll.stayStopped(3)).toBe("3 finished sub-agents stay stopped");
});

it("tells that the local server is down, and names a new Fleet", () => {
  expect(messages(appMessages).hooksDown).toBe("Agent states are approximate: the local server is unavailable");
  expect(messages(nodesMessages).fleet.defaultName).toBe("Fleet");
});

it("says what dummyPlane really reads in a Claude profile's folder (review)", () => {
  const text = accountsMessages.description;
  expect(text).not.toContain("reads nothing");
  expect(text).toContain("settings.json");
});

describe("one-sentence UI strings end without a period", () => {
  /** What keeps its period: text an agent reads, and the clauses of a paragraph the app joins (the clean-up's report, a link's reason). */
  const KEEPS_ITS_PERIOD = [
    "Give a short progress check",
    "Continue: pick up where you stopped",
    "Tests are failing: read the output",
    "Name of a note from the list",
    "name must be a text",
    "No notes in this project.",
    "Removed: ${",
    "Uncommitted work saved as",
    "Kept: ${",
    "Left open: ${",
    "are linked, but not grouped",
    // Two sentences, where the template's own quotes hide the second from the scan below.
    "The agents created for it close",
    // The end of `cleanedMoved`'s template, which holds a template of its own.
    '.join("; ")}.',
  ];

  it("drops the final period of a short text, and keeps it only inside several sentences", () => {
    const found: string[] = [];
    for (const [path, text] of Object.entries(sourceFiles())) {
      if (!/(^|\/)messages\w*\.ts$/.test(path) || path.startsWith("mcp/")) continue;
      text.split("\n").forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const [, , literal] of line.matchAll(/(["`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) {
          const bare = literal.replace(/\$\{[^}]*\}/g, "X");
          if (!bare.endsWith(".") || bare.endsWith("...") || !/[A-Za-z]{2}/.test(bare)) continue;
          if (/[.?!]\s+[A-Z]/.test(bare)) continue;
          if (KEEPS_ITS_PERIOD.some((start) => literal.includes(start))) continue;
          found.push(`${path}:${index + 1} ${literal}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});

/** Every text of a messages object that is a string, with where it stands: the functions need arguments and are left out. */
function leaves(value: unknown, path: string[] = []): [string, string][] {
  if (typeof value === "string") return [[path.join("."), value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
}

describe("one state vocabulary (Working, Waiting, Ready, Blocked, Failed, Exited; Done for an agent that reported)", () => {
  it("writes the table once", () => {
    expect(stateWords).toEqual({ working: "Working", waiting: "Waiting", ready: "Ready", blocked: "Blocked", failed: "Failed", exited: "Exited", done: "Done" });
  });

  it("reads it in the status pill and the foot, which say the pill's words", () => {
    const pill = messages(nodesMessages).pill;
    for (const state of ["working", "waiting", "ready", "blocked", "failed", "exited", "done"] as const) expect(pill[state]).toBe(stateWords[state]);
    expect(pill.exitedWith(2)).toBe("Exited · 2");
    const bar = messages(nodesMessages).budgetBar;
    expect([bar.done(5, 20), bar.blocked(5, 20), bar.failed(5, 20)]).toEqual(["Done in 5 min of 20", "Blocked after 5 min of 20", "Failed after 5 min of 20"]);
  });

  it("reads it in the panel's filters: the resting filter is Ready, not Done", () => {
    const { filters } = messages(agentsMessages);
    expect([filters.all, filters.waiting, filters.working, filters.done]).toEqual(["All", stateWords.waiting, stateWords.working, stateWords.ready]);
  });

  it("reads it in the group counts, lowercase in a line, worst first", () => {
    const words = summaryParts({ members: 3, waiting: 1, working: 1, ready: 1 }).map((part) => part.text);
    expect(words).toEqual(["3", `1 ${inLine(stateWords.waiting)}`, `1 ${inLine(stateWords.working)}`]);
    expect(summaryParts({ members: 2, waiting: 0, working: 0, ready: 2 }).map((part) => part.text)).toEqual(["2", inLine(stateWords.ready)]);
  });

  it("reads it in the mission's rows and the card's chip", () => {
    const mission = messages(missionMessages);
    expect(mission.agent).toEqual({ travaille: "working", attend: "waiting", inactif: "ready", arrêté: "stopped" });
    expect(mission.report).toEqual({ termine: "done", bloque: "blocked", echec: "failed" });
    expect(mission.morning.done).toBe(stateWords.done);
    expect(messages(kanbanBoardMessages).agentState).toEqual({ blocked: stateWords.blocked, failed: stateWords.failed });
  });

  it("reads it in the alerts: a report says its own word, a turn that ended without one says Ready", () => {
    const { finishAlert, notification } = messages(shellMessages);
    expect(finishAlert.states).toEqual({ done: stateWords.done, blocked: stateWords.blocked, failed: stateWords.failed, finished: stateWords.ready });
    expect(notification.waiting).toBe(stateWords.waiting);
    expect(notification.title("Batman", finishAlert.states.finished)).toBe("Batman · Ready");
  });

  it("calls a loop's trigger by the table's word, not the internal idle", () => {
    expect(messages(loopsMessages).dialog.triggers.idle).toBe("An agent becomes ready");
  });

  it("is the table the design system's Words part writes, with the event words that stay", () => {
    const doc = readSource("../docs/design-system.md");
    const at = doc.indexOf("\n## Words");
    expect(at).toBeGreaterThan(0);
    const part = doc.slice(at, doc.indexOf("\n## ", at + 1));
    for (const word of Object.values(stateWords)) expect(part, word).toContain(word);
    const events = [messages(nodesMessages).pill.stopped, messages(nodesMessages).pill.left, messages(notificationsMessages).types.finished, messages(missionMessages).state.terminee];
    expect(events).toEqual(["Stopped", "Agent exited", "Finished", "Finished"]);
    for (const word of events) expect(part, word).toContain(word);
    // The sentence rule the first describe holds the messages to.
    expect(part).toContain("ends without a period");
    expect(part).toContain("periods between its sentences");
  });

  it("shows no internal id or word: nouveau, idle and the French keys are never in a visible text", () => {
    const modules = { agentsMessages, appMessages, catalogMessages, loopsMessages, missionMessages, nodesMessages, notificationsMessages, shellMessages };
    const internal = /(nouveau|inactif|travaille|attend|arrêté|idle)/i;
    for (const [name, module] of Object.entries(modules)) {
      for (const [path, text] of leaves(module)) expect(text, `${name}.${path}`).not.toMatch(internal);
    }
    // A plan row names the agent a task opens as "new agent", whatever the id it is kept under.
    expect(messages(missionMessages).newAgent).toBe("new agent");
  });
});
