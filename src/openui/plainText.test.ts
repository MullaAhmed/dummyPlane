import { describe, expect, it } from "vitest";
import { generatedAsText } from "./plainText";

describe("generated output as text", () => {
  it("fences a Code block with more backticks than the code holds, so the code's own fence never closes it", () => {
    expect(generatedAsText('root = Code("const x = 1;", "ts")')).toBe("```ts\nconst x = 1;\n```");
    expect(generatedAsText('root = Code("Run:\\n```sh\\nnpm test\\n```", "md")')).toBe("````md\nRun:\n```sh\nnpm test\n```\n````");
    expect(generatedAsText('root = Code("a ````` b", "")')).toBe("``````\na ````` b\n``````");
  });

  it("gives every Tab as a section with its count, a Breakdown as its parts and shares, a Badge in a cell as its words", () => {
    expect(generatedAsText('root = Tabs([Tab("Failing", [Text("red")], 3), Tab("Passing", [Text("green")])])')).toBe("### Failing (3)\n\nred\n\n### Passing\n\ngreen");
    expect(generatedAsText('root = Breakdown([{label: "Done", value: 1, tone: "success"}, {label: "Open", value: 3}], "Tickets")')).toBe("Tickets\n\n- Done: 1 (25%)\n- Open: 3 (75%)");
    expect(generatedAsText('root = Table(["Ticket", "Status"], [["OPE-1", Badge("Done", "success")]])')).toBe("| Ticket | Status |\n| --- | --- |\n| OPE-1 | [Done] |");
    expect(generatedAsText('root = Card("Details", [Text("x")], true)')).toBe("### Details\n\nx");
  });

  it("says a Progress's share as its bar shows it: a value that is no finite number is 0%", () => {
    expect(generatedAsText('root = Progress(30, 60, "Tests")')).toBe("Tests: 50%");
    // 1e999 reads as Infinity: the bar draws 0%, so the text says 0% too.
    expect(generatedAsText('root = Progress(1e999, 100, "Big")')).toBe("Big: 0%");
    expect(generatedAsText('root = Progress(-1e999, 100, "Low")')).toBe("Low: 0%");
  });
});
