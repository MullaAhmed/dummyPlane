import { describe, expect, it } from "vitest";
import { backlinks, edges, linksIn, noteNamed, type LinkedNote } from "./links";

const note = (name: string, text: string): LinkedNote => ({ name, text });

describe("wikilinks", () => {
  it("finds the plain and the labelled form, once each", () => {
    expect(linksIn("See [[Auth]] and [[Deploy|the deploy]], and [[Auth]] again.")).toEqual([
      { target: "Auth", label: "Auth" },
      { target: "Deploy", label: "the deploy" },
      { target: "Auth", label: "Auth" },
    ]);
  });

  it("trims what is inside the brackets", () => {
    expect(linksIn("[[ Auth | login ]]")).toEqual([{ target: "Auth", label: "login" }]);
  });

  it("ignores links in code", () => {
    expect(linksIn("`[[a]]`\n```\n[[b]]\n```\n[[c]]")).toEqual([{ target: "c", label: "c" }]);
  });

  it("leaves out a fence's links as the reader does: indented, closed by its own kind, or never closed", () => {
    const targets = (text: string) => linksIn(text).map((link) => link.target);
    // In a list item the fence is indented; the reader shows it as code.
    expect(targets("- item\n  ```\n  [[in code]]\n  ```\n[[real]]")).toEqual(["real"]);
    // A `~~~` fence is closed by a `~~~` line: the ``` inside it is code too.
    expect(targets("~~~\n[[a]]\n```\n[[b]]\n~~~\n[[c]]")).toEqual(["c"]);
    // A fence left open runs to the end of the note.
    expect(targets("[[before]]\n```\n[[after]]")).toEqual(["before"]);
    // CRLF notes read the same.
    expect(targets("[[x]]\r\n  ~~~\r\n[[y]]\r\n  ~~~\r\n[[z]]")).toEqual(["x", "z"]);
  });

  it("ignores empty or broken brackets", () => {
    expect(linksIn("[[]] [[ ]] [[a] [b]] [[a/b]]")).toEqual([]);
  });

  it("resolves a name whatever its case", () => {
    const notes = [note("Auth", ""), note("deploy", "")];
    expect(noteNamed(notes, "auth")?.name).toBe("Auth");
    expect(noteNamed(notes, "DEPLOY")?.name).toBe("deploy");
    expect(noteNamed(notes, "none")).toBeNull();
  });
});

describe("what links to what", () => {
  const notes = [note("a", "[[B]] [[b]] [[ghost]]"), note("b", "[[a]] [[b]]"), note("c", "plain")];

  it("lists the notes that link to a note, whatever the case, without itself", () => {
    expect(backlinks(notes, "b").map((n) => n.name)).toEqual(["a"]);
    expect(backlinks(notes, "A").map((n) => n.name)).toEqual(["b"]);
    expect(backlinks(notes, "c")).toEqual([]);
  });

  it("counts each link between two notes once, and ignores absent notes and self-links", () => {
    expect(edges(notes)).toEqual([{ from: "a", to: "b" }]);
  });
});
