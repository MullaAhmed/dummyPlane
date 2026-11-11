// @vitest-environment happy-dom
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/ipc/invoke";
import { sourceFiles } from "@/theme/cssBlocks";
import { MAX_DETAIL, errorDetail, toastError } from "./errorToast";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe("an error's detail, as a toast's last line shows it", () => {
  it("drops the class name String() puts first: AppError, Error, TypeError", () => {
    expect(errorDetail(new AppError("io", "access denied"))).toBe("access denied");
    expect(errorDetail(String(new AppError("io", "access denied")))).toBe("access denied");
    expect(errorDetail("Error: no such workspace")).toBe("no such workspace");
    expect(errorDetail(new TypeError("x is undefined"))).toBe("x is undefined");
  });

  it("drops the OS error code and a stack: the user can do nothing with them", () => {
    expect(errorDetail(new AppError("io", "The system cannot find the path specified. (os error 3)"))).toBe("The system cannot find the path specified.");
    expect(errorDetail("Error: boom\n    at save (http://localhost:1420/src/store/nodes.ts:69:12)\n    at run")).toBe("boom");
  });

  it("reads a Tauri payload that never became an AppError, and shows nothing for what has no words", () => {
    expect(errorDetail({ kind: "db", message: "database is locked" })).toBe("database is locked");
    expect(errorDetail({})).toBe("");
    expect(errorDetail(undefined)).toBe("");
    expect(errorDetail(null)).toBe("");
  });

  it("stops at MAX_DETAIL characters with an ellipsis; the log keeps it whole", () => {
    const detail = errorDetail("x".repeat(500));
    expect(detail.length).toBe(MAX_DETAIL);
    expect(detail.endsWith("…")).toBe(true);
  });
});

/** The description sonner was given, as markup. */
function description(call = 0): string {
  const options = vi.mocked(toast.error).mock.calls[call][1] as { description?: ReactNode };
  const node = options.description;
  return isValidElement(node) ? renderToStaticMarkup(node as ReactElement) : String(node ?? "");
}

describe("the app's one error toast", () => {
  it("titles it in the app's words and puts the error under it, cleaned, in the code font and a step quieter", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new AppError("io", "Access is denied. (os error 5)");
    toastError("Could not save the canvas", { error });
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe("Could not save the canvas");
    const html = description();
    expect(html).toContain("Access is denied.");
    expect(html).not.toContain("AppError");
    expect(html).not.toContain("os error");
    expect(html).toMatch(/class="[^"]*font-mono[^"]*text-dp-text-3[^"]*"/);
    // The whole error goes to the log (console.warn reaches it, app/log.ts).
    expect(warn).toHaveBeenCalledWith("Could not save the canvas:", error);
    warn.mockRestore();
  });

  it("says what to do next above the detail", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    toastError("Could not save the setting", { error: "disk full", next: "It applies for now" });
    const html = description();
    expect(html.indexOf("It applies for now")).toBeLessThan(html.indexOf("disk full"));
  });

  it("shows a plain sentence alone: no description, nothing logged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    toastError("Too many loops (30 at most): delete one first");
    expect(vi.mocked(toast.error).mock.calls[0]).toEqual(["Too many loops (30 at most): delete one first"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("passes sonner's other options through: an id, a duration, an action", () => {
    toastError("Could not change the presets", { id: "presets", duration: 5000 });
    expect(vi.mocked(toast.error).mock.calls[0][1]).toMatchObject({ id: "presets", duration: 5000 });
  });
});

/**
 * The calls of `name(` in `text` and their first argument, found by matching brackets. Quotes are skipped, so a
 * bracket inside a string does not count.
 */
function firstArguments(text: string, name: RegExp): { at: number; arg: string; call: string }[] {
  const found: { at: number; arg: string; call: string }[] = [];
  for (const match of text.matchAll(name)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    let comma = -1;
    let end = -1;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      } else if (c === "," && depth === 1 && comma < 0) comma = i;
    }
    if (end < 0) continue;
    found.push({ at: match.index!, arg: text.slice(open + 1, comma < 0 ? end : comma).trim(), call: text.slice(match.index!, end + 1) });
  }
  return found;
}

/** What gives a raw error away in a title: an error variable, its message, or the text String() makes of it. */
const RAW = /\b(?:error|err|e|reason|detail|cause)\b|\bString\(|\berrorText\(|\berrorDetail\(|\.message\b/;

describe("no toast's title is a raw error (Alerts)", () => {
  const files = Object.entries(sourceFiles()).filter(([file]) => /\.tsx?$/.test(file));

  it("sends every error toast through toastError: sonner's toast.error is called in errorToast.tsx only", () => {
    for (const [file, text] of files) {
      if (file === "lib/errorToast.tsx") continue;
      expect(text.match(/\btoast\.error\(/g) ?? [], file).toEqual([]);
    }
  });

  it("titles every toast with a sentence of the app, never with the error, its message or String() of it", () => {
    let seen = 0;
    for (const [file, text] of files) {
      if (file === "lib/errorToast.tsx") continue;
      for (const { arg } of firstArguments(text, /\b(?:toastError|toastRemoteFailure|toast(?:\.(?:success|info|warning|message|loading))?)\(/g)) {
        seen++;
        expect(arg, `${file}: ${arg}`).not.toMatch(RAW);
      }
    }
    // The guard reads the real call sites: about a hundred and thirty of them.
    expect(seen).toBeGreaterThan(100);
  });

  it("puts no raw error in a plain toast's description either: an error goes through toastError, which cleans it", () => {
    for (const [file, text] of files) {
      if (file === "lib/errorToast.tsx") continue;
      for (const { call } of firstArguments(text, /\btoast(?:\.(?:success|info|warning|message|loading))?\(/g)) {
        expect(call, file).not.toMatch(/\bString\((?:error|err|e|reason)\)|\berrorText\(|\.message\b/);
      }
    }
  });

  it("rejects a title that is a raw error, in the guard's own words", () => {
    for (const raw of ["String(error)", "errorText(error)", "t.saveFailed(String(e))", "error.message", "`Could not save: ${error}`", "result.error"]) {
      expect(raw).toMatch(RAW);
    }
    for (const plain of ["t.saveFailed", "messages(homeMessages).card[what]", "messages(studioMessages).saveFailed(path)", "t.notRunning(name)", "`dummyPlane ${version}`", "messages(missionMessages).cleaned(result.removed, result.kept)"]) {
      expect(plain).not.toMatch(RAW);
    }
  });
});
