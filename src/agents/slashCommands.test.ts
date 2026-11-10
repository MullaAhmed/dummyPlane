import { describe, expect, it } from "vitest";
import { commandAt, isSlashCommand, matchCommands, takesCommands } from "./slashCommands";

describe("isSlashCommand", () => {
  it("knows a command for the agents' CLI by its leading slash", () => {
    expect(isSlashCommand("/effort ultracode")).toBe(true);
    expect(isSlashCommand("  /remote-control")).toBe(true);
    expect(isSlashCommand("lance les tests /vite")).toBe(false);
    expect(isSlashCommand("/")).toBe(false);
    // A path stays a shell command (final review maj §1).
    expect(isSlashCommand("/usr/bin/make test")).toBe(false);
    expect(isSlashCommand("/c/Users/x/run.sh")).toBe(false);
  });
});

describe("commandAt", () => {
  it("finds the /word typed at the start of the command, after its mentions", () => {
    expect(commandAt("/ef", 3)).toEqual({ start: 0, query: "ef" });
    expect(commandAt("@thot/zeus /rem", 15)).toEqual({ start: 11, query: "rem" });
    expect(commandAt("/", 1)).toEqual({ start: 0, query: "" });
  });

  it("is null past the command's name or inside a sentence", () => {
    expect(commandAt("/effort ", 8)).toBeNull();
    expect(commandAt("lance /ef", 9)).toBeNull();
    expect(commandAt("C:/code", 7)).toBeNull();
  });
});

describe("matchCommands", () => {
  it("lists the commands starting with the query, then those containing it", () => {
    expect(matchCommands("ef").map((c) => c.name)).toEqual(["/effort"]);
    expect(matchCommands("remote").map((c) => c.name)).toEqual(["/remote-control"]);
    expect(matchCommands("").length).toBeGreaterThan(5);
    expect(matchCommands("zz")).toEqual([]);
  });
});

describe("takesCommands", () => {
  it("leaves out the terminals without an agent: a shell would run /effort as a program", () => {
    expect(takesCommands("claude")).toBe(true);
    expect(takesCommands("codex")).toBe(true);
    expect(takesCommands("shell")).toBe(false);
    expect(takesCommands("custom")).toBe(false);
  });
});
