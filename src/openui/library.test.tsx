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
    // A toned figure takes its tone's ink too, and the type scale's own size.
    const figure = [...host.querySelectorAll("span")].find((s) => s.textContent === "412")!;
    expect(figure.className).toContain("text-dp-ok");
    expect(figure.className).toContain("text-2xl");
    const badge = [...host.querySelectorAll("span")].find((s) => s.textContent === "blocked")!;
    expect(badge.className).toContain("text-dp-danger");
    expect(badge.className).toContain("bg-dp-danger/10");
    expect(badge.className).not.toContain("rounded-full");
    const note = host.querySelector("[role=note]")!;
    // On its tone's tint, not behind a coloured rule.
    expect(note.className).toContain("bg-dp-wait/10");
    expect(note.className).not.toMatch(/border-l/);
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

const click = (element: Element | null | undefined) => act(() => (element as HTMLElement).click());
const rowsOf = (host: HTMLElement) => [...host.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
const header = (host: HTMLElement, name: string) => [...host.querySelectorAll("th")].find((th) => th.textContent === name)!;

describe("what makes an output better than the same words in a terminal", () => {
  it("shows one Tab at a time, each with its count, and switches on a click", async () => {
    const host = await show(program('a = Tabs([Tab("Failing", [Text("three red")], 3), Tab("Passing", [Text("all green")], 409)])'));
    const tabs = [...host.querySelectorAll("[role=tab]")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Failing3", "Passing409"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    const panel = host.querySelector("[role=tabpanel]")!;
    expect(panel.textContent).toBe("three red");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
    await click(tabs[1]);
    expect(host.querySelector("[role=tabpanel]")?.textContent).toBe("all green");
    expect(tabs[1].getAttribute("tabindex")).toBe("0");
    expect(tabs[0].getAttribute("tabindex")).toBe("-1");
  });

  it("moves between Tabs with the arrows, and keeps the arrows from the canvas", async () => {
    const host = await show(program('a = Tabs([Tab("One", [Text("1")]), Tab("Two", [Text("2")]), Tab("Three", [Text("3")])])'));
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    const list = host.querySelector("[role=tablist]")!;
    const press = (key: string) => act(() => void list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    await press("ArrowLeft");
    expect(host.querySelector("[role=tabpanel]")?.textContent).toBe("3");
    expect(document.activeElement?.textContent).toBe("Three");
    await press("ArrowRight");
    expect(host.querySelector("[role=tabpanel]")?.textContent).toBe("1");
    await press("End");
    expect(host.querySelector("[role=tabpanel]")?.textContent).toBe("3");
    expect(outside).not.toHaveBeenCalled();
    // Any other key is the canvas's.
    await press("a");
    expect(outside).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", outside);
  });

  it("draws a Tab met outside Tabs as a titled group, its count beside the title", async () => {
    const host = await show(program('a = Tab("Loose", [Text("inside")], 2)'));
    expect(host.querySelector("section h3")?.textContent).toBe("Loose · 2");
    expect(host.querySelector("section")?.textContent).toContain("inside");
  });

  it("draws a Badge in a Table's cell, and sorts the column by its words", async () => {
    const host = await show(program('a = Table(["Ticket", "Status"], [["OPE-2", Badge("Todo", "neutral")], ["OPE-1", Badge("Done", "success")]])'));
    const badge = [...host.querySelectorAll("td span")].find((span) => span.textContent === "Done")!;
    expect(badge.className).toContain("bg-dp-ok/10");
    await click(header(host, "Status").querySelector("button"));
    expect(rowsOf(host)).toEqual([["OPE-1", "Done"], ["OPE-2", "Todo"]]);
  });

  it("sorts on a header's click: up, then down, then as written; numbers as numbers, blanks last", async () => {
    const host = await show(program('a = Table(["Name", "Size"], [["b", 10], ["a", null], ["c", 9], ["item 10", 2], ["item 9", 1]])'));
    const size = () => header(host, "Size");
    expect(size().className).toContain("text-right");
    await click(size().querySelector("button"));
    expect(size().getAttribute("aria-sort")).toBe("ascending");
    expect(rowsOf(host).map((row) => row[0])).toEqual(["item 9", "item 10", "c", "b", "a"]);
    await click(size().querySelector("button"));
    expect(size().getAttribute("aria-sort")).toBe("descending");
    expect(rowsOf(host).map((row) => row[0])).toEqual(["b", "c", "item 10", "item 9", "a"]);
    await click(size().querySelector("button"));
    expect(size().getAttribute("aria-sort")).toBeNull();
    expect(rowsOf(host).map((row) => row[0])).toEqual(["b", "a", "c", "item 10", "item 9"]);
    // Words sort as people count: item 9 before item 10.
    await click(header(host, "Name").querySelector("button"));
    expect(rowsOf(host).map((row) => row[0])).toEqual(["a", "b", "c", "item 9", "item 10"]);
  });

  it("folds a long Table past eight rows behind a button, and shows a row or two more whole", async () => {
    const rows = (n: number) => `[${Array.from({ length: n }, (_, i) => `["r${i + 1}"]`).join(", ")}]`;
    const long = await show(program(`a = Table(["Row"], ${rows(28)})`));
    expect(rowsOf(long)).toHaveLength(8);
    const more = [...long.querySelectorAll("button")].find((b) => b.textContent === "Show all 28 rows")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more);
    expect(rowsOf(long)).toHaveLength(28);
    expect(more.textContent).toBe("Show fewer rows");
    const short = await show(program(`a = Table(["Row"], ${rows(10)})`));
    expect(rowsOf(short)).toHaveLength(10);
    expect([...short.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Show all"))).toBe(false);
  });

  it("folds a Card under its title when collapsed is given, closed when true", async () => {
    const host = await show(program('a = Stack([Card("Details", [Text("hidden")], true), Card("Open", [Text("shown")], false), Card("Plain", [Text("plain")])])'));
    const [closed, open] = [...host.querySelectorAll("section h3 button")];
    expect(host.querySelectorAll("section h3 button")).toHaveLength(2);
    expect(closed.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("hidden");
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("shown");
    await click(closed);
    expect(host.textContent).toContain("hidden");
    expect(document.getElementById(closed.getAttribute("aria-controls")!)?.textContent).toBe("hidden");
  });

  it("splits a Breakdown's bar in proportion, its key giving each part's figure and share", async () => {
    const host = await show(program('a = Breakdown([{label: "Done", value: 9, tone: "success"}, {label: "Rest", value: 0, tone: "neutral"}, {label: "Open", value: 27}], "Tickets")'));
    expect(host.querySelector("figcaption")?.textContent).toBe("Tickets");
    const bar = host.querySelector("[role=img]")!;
    expect(bar.getAttribute("aria-label")).toBe("Done: 9 (25%), Rest: 0 (0%), Open: 27 (75%)");
    // A part of nothing has no segment, but keeps its place in the key.
    const segments = [...bar.children] as HTMLElement[];
    expect(segments.map((s) => s.style.flex)).toEqual(["9 1 0px", "27 1 0px"]);
    expect(segments[0].style.background).toBe("var(--dp-ok)");
    expect([...host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Done925%", "Rest00%", "Open2775%"]);
    const empty = await show(program('a = Breakdown([{label: "None", value: 0}])'));
    expect(empty.textContent).toBe("No data");
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
    const end = 'next = Button("Fix the two tickets", "Fix OPE-12 and OPE-31")';
    const example = guide.slice(guide.indexOf("root = Stack([verdict"), guide.indexOf(end) + end.length);
    expect(example).toContain("Tabs([");
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

  it("warns, and shows anyway, what will read like a terminal: long prose, lists of sentences, a column of open Cards", () => {
    const long = "word ".repeat(80);
    expect(checkOpenUI(`root = Stack([Text("${long}")])`).warnings.join(" ")).toMatch(/The Text "word word.*" runs 400 characters/);
    expect(checkOpenUI(`root = Stack([Markdown("${long}")])`).warnings.join(" ")).toMatch(/The Markdown .* runs 400 characters/);
    const items = Array.from({ length: 9 }, (_, i) => `"item ${i}"`).join(", ");
    expect(checkOpenUI(`root = Stack([List([${items}])])`).warnings.join(" ")).toMatch(/The List "item 0" has 9 items: make it a Table/);
    expect(checkOpenUI(`root = Stack([List(["${"x".repeat(150)}"])])`).warnings.join(" ")).toMatch(/has 1 items, 1 over 140 characters/);
    const cards = (n: number, collapsed = "") => Array.from({ length: n }, (_, i) => `Card("c${i}", [Text("x")]${collapsed})`).join(", ");
    expect(checkOpenUI(`root = Stack([${cards(4)}])`).warnings.join(" ")).toMatch(/4 open Cards one under another: put them in Tabs/);
    expect(checkOpenUI(`root = Stack([${cards(4, ", true")}])`).warnings).toEqual([]);
    expect(checkOpenUI(`root = Stack([${cards(3)}])`).warnings).toEqual([]);
    // Inside Tabs too, and never more than five.
    expect(checkOpenUI(`root = Tabs([Tab("a", [Text("${long}")])])`).warnings).toHaveLength(1);
    expect(checkOpenUI(`root = Stack([${Array.from({ length: 8 }, () => `Text("${long}")`).join(", ")}])`).warnings).toHaveLength(5);
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

  it("keeps every style of a token inside another one: emphasis in a quote keeps the quote's ink, in a heading its weight", () => {
    const quote = highlight("> quoted *em* text", "markdown", "calm")!;
    expect(quote[0].find((token) => token.text === "em")?.style).toEqual({ color: "var(--dp-text-2)", fontStyle: "italic" });
    const heading = highlight("# Head *em*", "markdown", "calm")!;
    expect(heading[0].find((token) => token.text === "em")?.style).toEqual({ fontWeight: "600", fontStyle: "italic" });
  });

  it("highlights only the languages the Code Studio knows, in the palette's colours", () => {
    const lines = highlight("let a = 'x';\nfn()", "typescript", "calm")!;
    expect(lines).toHaveLength(2);
    expect(lines[0].some((token) => token.style?.color)).toBe(true);
    expect(highlight("x", "cobol", "calm")).toBeNull();
    expect(highlight("x", "../../etc", "calm")).toBeNull();
  });
});
