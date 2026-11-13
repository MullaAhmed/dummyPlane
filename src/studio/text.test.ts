import { describe, expect, it } from "vitest";
import { detectEol, smallestChange, toLf, withEndings, withEol } from "./text";

describe("line endings", () => {
  it("keeps the dominant ending of the file", () => {
    expect(detectEol("a\nb\n")).toBe("\n");
    expect(detectEol("a\r\nb\r\n")).toBe("\r\n");
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(detectEol("a\nb\nc\r\n")).toBe("\n");
    expect(detectEol("one line")).toBe("\n");
  });

  it("gives back a CRLF file byte for byte", () => {
    const disk = "﻿a\r\n\r\nb\r\n";
    expect(withEol(toLf(disk), detectEol(disk))).toBe(disk);
  });

  it("works in LF, as the editor does", () => {
    expect(toLf("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });
});

describe("writing back what the disk had", () => {
  const back = (raw: string, edited: string) => withEndings(raw, edited, detectEol(raw));

  it("gives an unedited file back byte for byte, whatever its endings", () => {
    for (const raw of ["", "a", "a\n", "﻿a\r\n\r\nb\r\n", "a\r\nb\nc\rd", "one\rtwo\n"]) expect(back(raw, toLf(raw)), JSON.stringify(raw)).toBe(raw);
  });

  it("keeps the ending of the lines before and after the edit, and gives the edited ones the dominant ending", () => {
    expect(back("a\r\nb\nc\nd\r\n", "a\nb\nC\nd\n")).toBe("a\r\nb\nC\nd\r\n");
    // Lines inserted take the file's ending; those around them keep theirs.
    expect(back("a\r\nb\r\nz\n", "a\nb\nnew\nmore\nz\n")).toBe("a\r\nb\r\nnew\r\nmore\r\nz\n");
    // Lines removed.
    expect(back("a\r\nb\nc\nd\n", "a\nd\n")).toBe("a\r\nd\n");
  });

  it("ends a last line that had no ending with the dominant one once a line follows it", () => {
    expect(back("a\r\nb", "a\nb\nc")).toBe("a\r\nb\r\nc");
    expect(back("a\nb\r\nc", "a\nb\nC")).toBe("a\nb\r\nC");
  });
});

describe("the smallest change", () => {
  it("replaces only what differs, so that a reload keeps the cursor", () => {
    expect(smallestChange("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
    expect(smallestChange("abcdef", "abXdef")).toEqual({ from: 2, to: 3, insert: "X" });
    expect(smallestChange("abc", "a")).toEqual({ from: 1, to: 3, insert: "" });
  });

  it("does not count a shared letter twice", () => {
    expect(smallestChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
  });

  it("is null when nothing differs", () => {
    expect(smallestChange("same", "same")).toBeNull();
  });
});
