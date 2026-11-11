import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { BarChart, LineChart } from "./charts";
import * as P from "./parts";
import { TONES } from "./tones";

/**
 * dummyPlane's OpenUI library: what an agent may build an output with
 * (show_output), drawn with the app's own parts on the palette's tokens.
 * Small on purpose: each description feeds `outputGuide()`, the text an
 * agent reads before it writes OpenUI Lang. No raw HTML, no images, no
 * Query()/Mutation(): output is data, and nothing in it runs by itself.
 */

/** Any component of this library, for a container's children: set below, once every component exists. */
let child: z.ZodType = z.unknown();
const children = () => z.array(z.lazy(() => child));
const gap = z.enum(["sm", "md", "lg"]);
const tone = z.enum(TONES);
const cell = z.union([z.string(), z.number(), z.null()]);

const Stack = defineComponent({
  name: "Stack",
  description: "Lays its children out top to bottom. The usual root: root = Stack([...]). gap: sm, md (default) or lg.",
  props: z.object({ children: children(), gap: gap.optional() }),
  component: ({ props, renderNode }) => <P.Stack {...props} renderNode={renderNode} />,
});

const Row = defineComponent({
  name: "Row",
  description: "Lays its children side by side in equal shares, wrapping when narrow: Stats, small Cards, Badges.",
  props: z.object({ children: children(), gap: gap.optional() }),
  component: ({ props, renderNode }) => <P.Row {...props} renderNode={renderNode} />,
});

const Card = defineComponent({
  name: "Card",
  description: "A titled, bordered group of children. Use \"\" for no title.",
  props: z.object({ title: z.string(), children: children() }),
  component: ({ props, renderNode }) => <P.Card {...props} renderNode={renderNode} />,
});

const Heading = defineComponent({
  name: "Heading",
  description: "A heading; level 1 (default), 2 or 3.",
  props: z.object({ text: z.string(), level: z.number().optional() }),
  component: ({ props }) => <P.Heading {...props} />,
});

const Text = defineComponent({
  name: "Text",
  description: "A paragraph. Inline Markdown works (**bold**, `code`, [links](https://…)); tone muted for secondary text.",
  props: z.object({ text: z.string(), tone: z.enum(["default", "muted"]).optional() }),
  component: ({ props }) => <P.Text {...props} />,
});

const Markdown = defineComponent({
  name: "Markdown",
  description: "A block of Markdown: headings, lists, tables, quotes, fenced code. No HTML, no images.",
  props: z.object({ text: z.string() }),
  component: ({ props }) => <P.Markdown {...props} />,
});

const List = defineComponent({
  name: "List",
  description: "A bulleted list of strings (inline Markdown); ordered true numbers it.",
  props: z.object({ items: z.array(z.string()), ordered: z.boolean().optional() }),
  component: ({ props }) => <P.List {...props} />,
});

const Table = defineComponent({
  name: "Table",
  description: "A table: column headers, then rows of cells (strings or numbers; numbers align right).",
  props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(cell)) }),
  component: ({ props }) => <P.Table {...props} />,
});

const KeyValue = defineComponent({
  name: "KeyValue",
  description: "Label/value pairs, one per line: KeyValue([{label: \"Branch\", value: \"main\"}, …]).",
  props: z.object({ items: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })) }),
  component: ({ props }) => <P.KeyValue {...props} />,
});

const Stat = defineComponent({
  name: "Stat",
  description: "A figure with its label, and an optional change line (delta) in a tone: success, danger…",
  props: z.object({ label: z.string(), value: z.union([z.string(), z.number()]), delta: z.string().optional(), tone: tone.optional() }),
  component: ({ props }) => <P.Stat {...props} />,
});

const Badge = defineComponent({
  name: "Badge",
  description: "A short status word in a tone: neutral, info, success, warning or danger.",
  props: z.object({ text: z.string(), tone: tone.optional() }),
  component: ({ props }) => <P.Badge {...props} />,
});

const Callout = defineComponent({
  name: "Callout",
  description: "A note that stands out, in a tone (info, success, warning, danger), with an optional title last.",
  props: z.object({ tone, text: z.string(), title: z.string().optional() }),
  component: ({ props }) => <P.Callout {...props} />,
});

const Code = defineComponent({
  name: "Code",
  description: "A block of code, highlighted for ts, js, tsx, json, css, html, rust, python, md; copyable.",
  props: z.object({ code: z.string(), language: z.string().optional() }),
  component: ({ props }) => <P.Code {...props} />,
});

const Progress = defineComponent({
  name: "Progress",
  description: "A progress bar: value out of max (100 by default), with an optional label.",
  props: z.object({ value: z.number(), max: z.number().optional(), label: z.string().optional() }),
  component: ({ props }) => <P.Progress {...props} />,
});

const Link = defineComponent({
  name: "Link",
  description: "A link the user can open in the browser (http or https only).",
  props: z.object({ label: z.string(), url: z.string() }),
  component: ({ props }) => <P.Link {...props} />,
});

const Divider = defineComponent({
  name: "Divider",
  description: "A horizontal rule between sections.",
  props: z.object({}),
  component: () => <P.Divider />,
});

const Bars = defineComponent({
  name: "BarChart",
  description: "Bars, one per label: BarChart([\"a\", \"b\"], [3, 5], \"Title\").",
  props: z.object({ labels: z.array(z.string()), values: z.array(z.number()), title: z.string().optional() }),
  component: ({ props }) => <BarChart {...props} />,
});

const Lines = defineComponent({
  name: "LineChart",
  description: "Lines over labels (x axis), one per series: LineChart([\"Mon\", \"Tue\"], [{name: \"p95 ms\", values: [120, 98]}], \"Title\").",
  props: z.object({ labels: z.array(z.string()), series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })), title: z.string().optional() }),
  component: ({ props }) => <LineChart {...props} />,
});

const Button = defineComponent({
  name: "Button",
  description: "A button; when the user clicks it, its message is typed into your terminal as if they had sent it. For a follow-up the user may want.",
  props: z.object({ label: z.string(), message: z.string() }),
  component: ({ props }) => <P.ActionButton {...props} />,
});

const COMPONENTS = [Stack, Row, Card, Heading, Text, Markdown, List, Table, KeyValue, Stat, Badge, Callout, Code, Progress, Link, Divider, Bars, Lines, Button];

child = z.union(COMPONENTS.map((c) => c.ref) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);

/** Every component's name, as an agent writes it (`./detect.ts` lists the same, without loading OpenUI). */
export const LIBRARY_COMPONENT_NAMES: readonly string[] = COMPONENTS.map((c) => c.name);

export const outputLibrary = createLibrary({ components: COMPONENTS, root: "Stack" });

const EXAMPLE = `root = Stack([title, stats, details, next])
title = Heading("Test run")
stats = Row([Stat("Passed", 412, "+12", "success"), Stat("Failed", 3, "-2", "danger"), Stat("Duration", "41 s")])
details = Card("Failures", [failures, note])
failures = Table(["Test", "File", "Reason"], [["saves a node", "store/nodes.test.ts", "timeout"], ["reads a link", "mcp/nodeTools.test.ts", "expected 2, got 1"]])
note = Callout("warning", "Two of the three fail on Windows only.", "Flaky")
next = Button("Fix the failures", "Fix the three failing tests")`;

/** What an agent reads to write an output (output_guide): the syntax, every component's signature, an example. */
export function outputGuide(): string {
  return outputLibrary.prompt({
    preamble:
      "You show results to the user in dummyPlane with show_output, written in OpenUI Lang: one statement per line, `name = Component(args…)`, arguments by position. dummyPlane draws it in an output node beside your terminal, in the app's own style.",
    additionalRules: [
      "Pick the component that fits: Table to compare, Stat and Row for figures, KeyValue for facts, Callout for what needs attention, Code for code, Markdown for prose.",
      "Strings are double-quoted; write \\n for a line break inside Markdown or Code text.",
      "Do not use Query(), Mutation(), $variables or @actions: output is static.",
      "show_output answers with the errors to fix, if any; call it again with the whole program. Pass output (the id it gave) to update that output instead of making a new one.",
    ],
    examples: [EXAMPLE],
  });
}
