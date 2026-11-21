import { describe, expect, it } from "vitest";
import { AppError } from "@/ipc/invoke";
import { gitLine, gitProblem, gitRefusal, type GitDoing } from "./problems";

const REJECTED = [
  "To github.com:acme/api.git",
  " ! [rejected]        main -> main (fetch first)",
  "error: failed to push some refs to 'github.com:acme/api.git'",
  "hint: Updates were rejected because the remote contains work that you do not",
  "hint: 'git pull ...') before pushing again.",
].join("\n");

describe("git's telling line, for a problem's detail", () => {
  it("takes the ref git refused over the `To <url>` a push starts with", () => {
    expect(gitLine(new AppError("invalidInput", REJECTED))).toBe("! [rejected]        main -> main (fetch first)");
  });

  it("else the first fatal or error line, else the first line that is not a hint", () => {
    expect(gitLine("Author identity unknown\n\n*** Please tell me who you are.\nfatal: unable to auto-detect email address")).toBe(
      "fatal: unable to auto-detect email address",
    );
    expect(gitLine("hint: one\npre-commit: lint failed\nsecond")).toBe("pre-commit: lint failed");
    expect(gitLine("")).toBe("");
  });
});

describe("the refusals the panels say more of", () => {
  it("tells them by git's English words", () => {
    expect(gitRefusal("fatal: not a git repository (or any of the parent directories): .git")).toBe("notRepo");
    expect(gitRefusal("fatal: Unable to create 'C:/a/.git/index.lock': File exists.")).toBe("locked");
    expect(gitRefusal(REJECTED)).toBe("rejected");
    expect(gitRefusal(" ! [rejected]        main -> main (non-fast-forward)")).toBe("rejected");
    expect(gitRefusal("error: Your local changes to the following files would be overwritten by checkout:\n\ta.ts")).toBe("overwritten");
    expect(gitRefusal("*** Please tell me who you are.")).toBe("identity");
  });

  it("never takes a hook's refusal for a push the remote is ahead of, nor guesses at another language", () => {
    expect(gitRefusal(" ! [remote rejected] main -> main (protected branch hook declined)")).toBeNull();
    expect(gitRefusal("fatal: ni ceci ni aucun de ses répertoires parents n'est un dépôt git : .git")).toBeNull();
  });
});

describe("a git problem in the window's words", () => {
  const doings: GitDoing[] = [
    { what: "read" },
    { what: "diff", path: "src/a.ts" },
    { what: "history" },
    { what: "branches" },
    { what: "push", target: "origin/main" },
    { what: "switch", branch: "side" },
    { what: "commit" },
    { what: "discard", path: "src/a.ts" },
  ];
  const said = ["fatal: something git says", REJECTED, "error: Your local changes would be overwritten by checkout:", "*** Please tell me who you are.", "fatal: not a git repository", "index.lock"];

  it("titles every failure with what was being done, never with git's text, and always says what to do next", () => {
    for (const doing of doings) {
      for (const text of said) {
        const problem = gitProblem(doing, text);
        expect(problem.title, `${doing.what}: ${text}`).not.toMatch(/fatal|error:|hint:|\[rejected\]|\*\*\*/i);
        expect(problem.next.length, `${doing.what}: ${text}`).toBeGreaterThan(0);
        expect(problem.line, `${doing.what}: ${text}`).toBe(gitLine(text));
      }
    }
  });

  it("offers a terminal where what is left is git the window does not have: pull, init; never after a failed commit, whose message the window keeps", () => {
    expect(gitProblem({ what: "push", target: "origin/main" }, REJECTED)).toMatchObject({ terminal: true, next: "Pull them in a terminal here, then push again" });
    expect(gitProblem({ what: "read" }, "fatal: not a git repository").terminal).toBe(true);
    expect(gitProblem({ what: "commit" }, "*** Please tell me who you are.").terminal).toBe(false);
    expect(gitProblem({ what: "switch", branch: "side" }, "error: Your local changes would be overwritten by checkout:").terminal).toBe(false);
    expect(gitProblem({ what: "commit" }, "pre-commit: lint failed").terminal).toBe(false);
  });

  it("never sends the person to a command the window lacks as if it had it: no git pull in its words", () => {
    for (const doing of doings) {
      for (const text of said) {
        const { title, next } = gitProblem(doing, text);
        expect(`${title} ${next}`).not.toMatch(/git pull|git fetch/);
      }
    }
  });
});
