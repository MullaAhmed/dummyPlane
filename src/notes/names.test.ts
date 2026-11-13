import { describe, expect, it } from "vitest";
import { isNoteName } from "./names";

describe("note names", () => {
  it("takes names with spaces and accents", () => {
    for (const name of ["Auth", "décisions d'archi", "v1.2 notes", "a-b_c"]) expect(isNoteName(name), name).toBe(true);
  });

  it("refuses what is no file name or would break a link", () => {
    for (const name of ["", " ", ".hidden", "a/b", "a\\b", "a:b", "a*", "a?", 'a"', "a<", "a>", "a|b", "[a]", "a#b", "a^b", "a.", "a ", "a\nb"]) {
      expect(isNoteName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("refuses Windows' reserved names, as Rust does", () => {
    for (const name of ["NUL", "con", "COM1", "lpt9", "aux.notes"]) expect(isNoteName(name), name).toBe(false);
    expect(isNoteName("console")).toBe(true);
  });

  it("refuses the same device names as Rust: spaces before the dot, superscript ports, the console's", () => {
    // `notes::is_valid_name` refuses these; the field said they were fine and the disk answered "note name refused".
    for (const name of ["con .x", "CON  .md", "nul ", "COM¹", "lpt³.txt", "com²", "CONIN$", "conout$.log"]) expect(isNoteName(name), name).toBe(false);
    for (const name of ["COM10", "com9x", "CONIN", "CON$", "console .x", "COM¹²"]) expect(isNoteName(name), name).toBe(true);
  });

  it("stops at 120 characters", () => {
    expect(isNoteName("a".repeat(120))).toBe(true);
    expect(isNoteName("a".repeat(121))).toBe(false);
  });
});
