import { describe, expect, it } from "vitest";
import { generatedAsText } from "./plainText";

describe("generated output as text", () => {
  it("fences a Code block with more backticks than the code holds, so the code's own fence never closes it", () => {
    expect(generatedAsText('root = Code("const x = 1;", "ts")')).toBe("```ts\nconst x = 1;\n```");
    expect(generatedAsText('root = Code("Run:\\n```sh\\nnpm test\\n```", "md")')).toBe("````md\nRun:\n```sh\nnpm test\n```\n````");
    expect(generatedAsText('root = Code("a ````` b", "")')).toBe("``````\na ````` b\n``````");
  });

  it("says a Progress's share as its bar shows it: a value that is no finite number is 0%", () => {
    expect(generatedAsText('root = Progress(30, 60, "Tests")')).toBe("Tests: 50%");
    // 1e999 reads as Infinity: the bar draws 0%, so the text says 0% too.
    expect(generatedAsText('root = Progress(1e999, 100, "Big")')).toBe("Big: 0%");
    expect(generatedAsText('root = Progress(-1e999, 100, "Low")')).toBe("Low: 0%");
  });
});
