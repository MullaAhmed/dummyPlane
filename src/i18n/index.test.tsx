import { expect, it } from "vitest";
import { defineMessages, messages, plural } from "./index";

it("returns the English messages unchanged", () => {
  const dict = defineMessages({ title: "Projects", count: (n: number) => plural(n, "agent", "agents") });
  expect(messages(dict).title).toBe("Projects");
  expect(messages(dict).count(0)).toBe("0 agents");
  expect(messages(dict).count(1)).toBe("1 agent");
  expect(messages(dict).count(3)).toBe("3 agents");
});

it("uses the singular for 1 only", () => {
  expect(plural(0, "file", "files")).toBe("0 files");
  expect(plural(1, "file", "files")).toBe("1 file");
  expect(plural(2, "file", "files")).toBe("2 files");
});
