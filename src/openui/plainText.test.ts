import { describe, expect, it } from "vitest";
import { generatedAsText } from "./plainText";

describe("generated output as text", () => {
  it("fences a Code block with more backticks than the code holds, so the code's own fence never closes it", () => {
    expect(generatedAsText('root = Code("const x = 1;", "ts")')).toBe("```ts\nconst x = 1;\n```");
    expect(generatedAsText('root = Code("Run:\\n```sh\\nnpm test\\n```", "md")')).toBe("````md\nRun:\n```sh\nnpm test\n```\n````");
    expect(generatedAsText('root = Code("a ````` b", "")')).toBe("``````\na ````` b\n``````");
  });
});
