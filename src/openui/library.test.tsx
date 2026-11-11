// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GeneratedText } from "./GeneratedText";
import { COMPONENT_NAMES, splitGenerated } from "./detect";
import { LIBRARY_COMPONENT_NAMES, outputGuide } from "./library";
import { checkOpenUI, readOpenUI } from "./parse";
import { highlight } from "./highlight";
import { httpUrl } from "./actions";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];
afterEach(() => {
  mounted.splice(0).forEach((unmount) => unmount());
  vi.mocked(openUrl).mockClear();
});

async function show(text: string, props: Partial<Parameters<typeof GeneratedText>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GeneratedText text={text} {...props} />));
  // OpenUI loads on demand, the first time a text is OpenUI Lang.
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const program = (...lines: string[]) => ["root = Stack([a])", ...lines].join("\n");

describe("the library draws each component in the app's own style", () => {
  it("lays out Stack, Row and Card, with a Card's title and its children", async () => {
    const host = await show(program('a = Card("Summary", [Row([Text("left"), Text("right")]), Stack([Text("below")], "lg")])'));
    expect(host.querySelector("[data-openui]")).not.toBeNull();
    const card = host.querySelector("section")!;
    expect(card.className).toContain("bg-dp-card");
    expect(card.querySelector("h3")?.textContent).toBe("Summary");
    expect(card.textContent).toContain("left");
    expect(card.textContent).toContain("right");
    expect(host.querySelector(".gap-4")?.textContent).toBe("below");
  });

  it("writes Heading by level, Text with inline Markdown, muted Text a step back", async () => {
    const host = await show(program('a = Stack([Heading("Big"), Heading("Small", 3), Text("a **bold** word"), Text("aside", "muted")])'));
    expect(host.querySelector("h2")?.textContent).toBe("Big");
    expect(host.querySelector("h4")?.textContent).toBe("Small");
    expect(host.querySelector("strong")?.textContent).toBe("bold");
    expect([...host.querySelectorAll("p")].find((p) => p.textContent === "aside")?.className).toContain("text-dp-text-2");
  });

  it("renders Markdown and List, with no HTML: a tag stays text", async () => {
    const host = await show(program('a = Stack([Markdown("## Notes\\n- one\\n- two\\n\\n<b>raw</b>"), List(["x", "y"], true)])'));
    expect(host.querySelector("h2")?.textContent).toBe("Notes");
    expect(host.querySelectorAll("ul li")).toHaveLength(2);
    expect(host.querySelector("ol")?.className).toContain("list-decimal");
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("<b>raw</b>");
  });

  it("draws a Table with its headers, numbers to the right, and KeyValue pairs", async () => {
    const host = await show(program('a = Stack([Table(["Name", "Count"], [["a", 3], ["b", 1200]]), KeyValue([{label: "Branch", value: "main"}, {label: "Ahead", value: 2}])])'));
    expect([...host.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Name", "Count"]);
    const cells = [...host.querySelectorAll("td")];
    expect(cells.map((td) => td.textContent)).toEqual(["a", "3", "b", "1,200"]);
    expect(cells[1].className).toContain("text-right");
    expect([...host.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Branch", "Ahead"]);
    expect([...host.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["main", "2"]);
  });

  it("colours Stat, Badge and Callout with the palette's role inks", async () => {
    const host = await show(program('a = Stack([Stat("Passed", 412, "+12", "success"), Badge("blocked", "danger"), Callout("warning", "Check this", "Heads up")])'));
    expect(host.textContent).toContain("412");
    expect([...host.querySelectorAll("span")].find((s) => s.textContent === "+12")?.className).toContain("text-dp-ok");
    const badge = [...host.querySelectorAll("span")].find((s) => s.textContent === "blocked")!;
    expect(badge.className).toContain("text-dp-danger");
    expect(badge.className).not.toContain("rounded-full");
    const note = host.querySelector("[role=note]")!;
    expect(note.className).toContain("border-l-dp-wait");
    expect(note.textContent).toContain("Heads up");
    expect(note.textContent).toContain("Check this");
  });

  it("shows Code on the surface, highlighted with the palette's syntax colours once loaded", async () => {
    const host = await show(program('a = Code("const x = 1;", "ts")'));
    const pre = host.querySelector("pre")!;
    expect(pre.parentElement?.className).toContain("bg-dp-surface");
    expect(pre.textContent).toBe("const x = 1;");
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(pre.querySelectorAll("span[style]").length).toBeGreaterThan(0);
  });

  it("draws Progress as a bar, Divider as a rule, and both charts in SVG", async () => {
    const host = await show(
      program('a = Stack([Progress(30, 60, "Tests"), Divider(), BarChart(["a", "b"], [2, 4], "Bars"), LineChart(["Mon", "Tue", "Wed"], [{name: "p95", values: [3, 1, 2]}, {name: "p50", values: [1, 1, 1]}], "Lines")])'),
    );
    const bar = host.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("30");
    expect(host.textContent).toContain("50%");
    expect(host.querySelector("hr")).not.toBeNull();
    expect(host.querySelectorAll("svg rect")).toHaveLength(2);
    expect(host.querySelectorAll("svg polyline")).toHaveLength(2);
    expect([...host.querySelectorAll("figcaption")].map((f) => f.textContent)).toEqual(["Bars", "Lines"]);
    // The legend names each series beside its swatch.
    expect(host.querySelector("ul")?.textContent).toBe("p95p50");
  });
});

describe("links and buttons do nothing by themselves", () => {
  it("opens an http(s) Link through the opener on a click, and shows any other as plain text", async () => {
    const host = await show(program('a = Stack([Link("Docs", "https://example.com/a"), Link("Bad", "javascript:alert(1)"), Link("File", "file:///C:/x")])'));
    const buttons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Docs");
    expect(buttons).toHaveLength(1);
    expect(openUrl).not.toHaveBeenCalled();
    await act(async () => buttons[0].click());
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
    expect(host.querySelector("a")).toBeNull();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Bad" || b.textContent === "File")).toBe(false);
  });

  it("opens a Markdown link through the opener too, and never a javascript: one", async () => {
    const host = await show("See [the docs](https://example.com) or [this](javascript:alert(1)).");
    expect(host.querySelector("a")).toBeNull();
    const link = [...host.querySelectorAll("button")].find((b) => b.textContent === "the docs")!;
    await act(async () => link.click());
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "this")).toBe(false);
  });

  it("sends a Button's message on a click only, and disables it where no agent listens", async () => {
    const send = vi.fn();
    const text = program('a = Button("Fix them", "Fix the failing tests")');
    const host = await show(text, { actions: { send } });
    expect(send).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Fix them")!;
    await act(async () => button.click());
    expect(send).toHaveBeenCalledWith("Fix the failing tests", "Fix them");
    const alone = await show(text);
    expect([...alone.querySelectorAll("button")].find((b) => b.textContent === "Fix them")?.disabled).toBe(true);
  });

  it("accepts absolute http(s) URLs only", () => {
    expect(httpUrl("https://a.b/c?d=1")).toBe("https://a.b/c?d=1");
    expect(httpUrl("HTTP://a.b")).toBe("HTTP://a.b");
    for (const bad of ["javascript:alert(1)", "file:///C:/x", "/relative", "dummyplane://output/x", "https://a b", "data:text/html,x", 42]) expect(httpUrl(bad), String(bad)).toBeNull();
  });
});

describe("OpenUI Lang or Markdown", () => {
  it("renders plain text and Markdown as Markdown: no root line, no OpenUI", async () => {
    expect(readOpenUI("# Title\n\nSome **bold** text\nx = 3")).toBeNull();
    const host = await show("# Title\n\n- a\n- b");
    expect(host.querySelector("[data-openui]")).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Title");
    expect(host.querySelectorAll("li")).toHaveLength(2);
  });

  it("keeps Markdown that shows a program further down as Markdown: its prose stays", async () => {
    const text = 'Use show_output like this:\n\n```\nroot = Stack([Text("hi")])\n```\n\nThen **call it**.';
    expect(readOpenUI(text)).toBeNull();
    const host = await show(text);
    expect(host.querySelector("[data-openui]")).toBeNull();
    expect(host.textContent).toContain("Use show_output like this:");
    expect(host.querySelector("strong")?.textContent).toBe("call it");
    expect(await splitGenerated(text)).toEqual({ text });
  });

  it("splits a program into its text and itself, and refuses one with errors rather than keep what parsed", async () => {
    expect(await splitGenerated('root = Stack([Heading("Done"), Text("All green")])')).toEqual({
      text: "# Done\n\nAll green",
      ui: 'root = Stack([Heading("Done"), Text("All green")])',
    });
    const broken = await splitGenerated('root = Stack([Text("kept"), Foo("lost"), missing])');
    expect(broken.ui).toBeUndefined();
    expect(broken.errors?.join(" ")).toMatch(/Unknown component "Foo".*never defined: missing/);
  });

  it("treats a root line that parses to nothing as text, shown as written", async () => {
    const host = await show("root = Nonsense(");
    expect(host.querySelector("[data-openui]")).toBeNull();
    expect(host.textContent).toContain("root = Nonsense(");
  });

  it("shows what parsed of a program with errors, says some did not, and keeps the source a click away", async () => {
    const text = 'root = Stack([Text("kept"), Foo("lost")])';
    const host = await show(text);
    expect(host.textContent).toContain("kept");
    expect(host.textContent).toContain("Part of this output could not be shown.");
    expect(host.querySelector("pre")).toBeNull();
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent === "Show source")!;
    await act(async () => toggle.click());
    expect(host.querySelector("pre")?.textContent).toBe(text);
  });

  it("does not call a forward reference an error while the text streams", async () => {
    const host = await show('root = Stack([a, b])\na = Text("first")', { isStreaming: true });
    expect(host.textContent).toContain("first");
    expect(host.textContent).not.toContain("could not be shown");
  });

  it("shows the raw text instead when asked for the source", async () => {
    const text = program('a = Text("x")');
    const host = await show(text, { source: true });
    expect(host.querySelector("pre")?.textContent).toBe(text);
  });
});

describe("the guide and the checks an agent reads", () => {
  it("lists the library's components where the tool's description reads them, without loading OpenUI", () => {
    expect([...COMPONENT_NAMES]).toEqual(LIBRARY_COMPONENT_NAMES);
  });

  it("names every component in the guide, with its signature and an example that itself passes", () => {
    const guide = outputGuide();
    for (const name of COMPONENT_NAMES) expect(guide, name).toContain(`${name}(`);
    expect(guide).toContain("root = Stack(");
    const example = guide.slice(guide.indexOf("root = Stack([title"), guide.indexOf('next = Button("Fix the failures", "Fix the three failing tests")') + 64);
    expect(checkOpenUI(example)).toEqual({ errors: [], warnings: [] });
    // It is read once per output, not paid by every session: still, keep it to a few pages.
    expect(guide.length).toBeLessThan(12_000);
  });

  it("says in plain words what to fix", () => {
    expect(checkOpenUI("").errors[0]).toMatch(/empty/);
    expect(checkOpenUI("# Just markdown").errors[0]).toMatch(/The first line must be the root statement/);
    expect(checkOpenUI('root = Stack([Foo("x")])').errors.join(" ")).toMatch(/Unknown component "Foo"/);
    expect(checkOpenUI("root = Stack([Text()])").errors.join(" ")).toMatch(/missing required field "\/text"/);
    expect(checkOpenUI("root = Stack([a])").errors.join(" ")).toMatch(/never defined: a/);
    expect(checkOpenUI('root = Stack([Text("open').errors.join(" ")).toMatch(/not closed/);
    expect(checkOpenUI('root = Stack([Text("x")])\nlost = Text("y")').warnings.join(" ")).toMatch(/not reachable from root.*lost/);
    expect(checkOpenUI("x".repeat(200_001)).errors[0]).toMatch(/most is 200000/);
  });

  it("refuses data fetching and state: output is static", () => {
    expect(checkOpenUI('root = Stack([Text("x")])\ndata = Query("tool", {})').errors.join(" ")).toMatch(/Query\(\) and Mutation\(\) are not supported/);
  });
});

describe("what OpenUI may not do in dummyPlane", () => {
  it("never loads the devtools widget: its package resolves to a stub that fetches nothing", async () => {
    const devtools = (await import("@openuidev/devtools")) as unknown as Record<string, unknown>;
    expect(Object.keys(devtools).sort()).toEqual(["OpenUIDevtools", "mountOpenUIDevtoolsFromCdn"]);
    expect((devtools.OpenUIDevtools as () => unknown)()).toBeNull();
  });

  it("highlights only the languages the Code Studio knows, in the palette's colours", () => {
    const lines = highlight("let a = 'x';\nfn()", "typescript", "calm")!;
    expect(lines).toHaveLength(2);
    expect(lines[0].some((token) => token.style?.color)).toBe(true);
    expect(highlight("x", "cobol", "calm")).toBeNull();
    expect(highlight("x", "../../etc", "calm")).toBeNull();
  });
});
