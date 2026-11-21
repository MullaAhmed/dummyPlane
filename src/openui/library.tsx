import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { BarChart, Breakdown, LineChart } from "./charts";
import * as P from "./parts";
import SKILL from "./skill/SKILL.md?raw";
import { TONES } from "./tones";

/**
 * dummyPlane's OpenUI library: what an agent may build an output with
 * (show_output), drawn with the app's own parts on the palette's tokens.
 * Small on purpose: each description feeds `outputGuide()`, the text an
 * agent reads before it writes OpenUI Lang, with the design rules of
 * `./skill/SKILL.md`. No raw HTML, no images, no Query()/Mutation(): output
 * is data, and nothing in it runs by itself.
 */

/** Any component of this library, for a container's children: set below, once every component exists. */
let child: z.ZodType = z.unknown();
const children = () => z.array(z.lazy(() => child));
const gap = z.enum(["sm", "md", "lg"]);
const tone = z.enum(TONES);
/** A table cell: words, a number, a blank, or a component (a Badge for a status). */
const cell = z.union([z.string(), z.number(), z.null(), z.lazy(() => child)]);

const Stack = defineComponent({
  name: "Stack",
  description: "Lays its children out top to bottom. The usual root: root = Stack([...]). gap: sm, md (default) or lg.",
  props: z.object({ children: children(), gap: gap.optional() }),
  component: ({ props, renderNode }) => <P.Stack {...props} renderNode={renderNode} />,
});

const Row = defineComponent({
  name: "Row",
  description: "Lays its children side by side, wrapping when narrow. Two to four Stats make one strip of figures; Buttons, Links and Badges keep their own width; anything else takes an equal share.",
  props: z.object({ children: children(), gap: gap.optional() }),
  component: ({ props, renderNode }) => <P.Row {...props} renderNode={renderNode} />,
});

const Card = defineComponent({
  name: "Card",
  description: "A titled, bordered group of children. Use \"\" for no title. collapsed true: folded under its title until the user opens it, for details the answer does not need.",
  props: z.object({ title: z.string(), children: children(), collapsed: z.boolean().optional() }),
  component: ({ props, renderNode }) => <P.Card {...props} renderNode={renderNode} />,
});

const Tab = defineComponent({
  name: "Tab",
  description: "One tab of Tabs: its label, its children, and an optional count shown beside the label.",
  props: z.object({ label: z.string(), children: children(), count: z.union([z.string(), z.number()]).optional() }),
  component: ({ props, renderNode }) => <P.Tab {...props} renderNode={renderNode} />,
});

const Tabs = defineComponent({
  name: "Tabs",
  description: "Groups the user switches between, one shown at a time: Tabs([Tab(\"Failing\", [table], 3), Tab(\"Passing\", [other], 409)]). For categories of one report, instead of Cards one under another.",
  props: z.object({ tabs: z.array(Tab.ref) }),
  component: ({ props, renderNode }) => <P.Tabs {...props} renderNode={renderNode} />,
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
  description: "A table: column headers, then rows of cells: strings (inline Markdown), numbers (aligned right) or a Badge for a status. The user sorts it by a click on a header; past 8 rows it folds behind \"Show all\".",
  props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(cell)) }),
  component: ({ props, renderNode }) => <P.Table {...props} renderNode={renderNode} />,
});

const KeyValue = defineComponent({
  name: "KeyValue",
  description: "Label/value pairs, one per line: KeyValue([{label: \"Branch\", value: \"main\"}, …]).",
  props: z.object({ items: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })) }),
  component: ({ props }) => <P.KeyValue {...props} />,
});

const Stat = defineComponent({
  name: "Stat",
  description: "A figure with its label, and an optional change line (delta) that names its reference (\"+12 since main\"): its sign draws an arrow. A tone (success, warning, danger…) inks both: only when the figure is good or bad news. Two to four side by side in a Row.",
  props: z.object({ label: z.string(), value: z.union([z.string(), z.number()]), delta: z.string().optional(), tone: tone.optional() }),
  component: ({ props }) => <P.Stat {...props} />,
});

const Badge = defineComponent({
  name: "Badge",
  description: "A short status word on its tone's tint: neutral, info, success, warning or danger. Put one in a Table cell for each row's status.",
  props: z.object({ text: z.string(), tone: tone.optional() }),
  component: ({ props }) => <P.Badge {...props} />,
});

const Callout = defineComponent({
  name: "Callout",
  description: "A note that stands out on its tone's tint (info, success, warning, danger), with an optional title last: the verdict, or what needs the user. One or two per output.",
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
  description: "A ratio against its limit: value out of max (100 by default), an optional label, and a tone (warning, danger…) when the ratio is news.",
  props: z.object({ value: z.number(), max: z.number().optional(), label: z.string().optional(), tone: tone.optional() }),
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
  description: "Named amounts, one bar per label, three or more: BarChart([\"api\", \"web\", \"cli\"], [42, 31, 8], \"Bundle size, kB\"). Short labels draw columns, longer ones rows of bars.",
  props: z.object({ labels: z.array(z.string()), values: z.array(z.number()), title: z.string().optional() }),
  component: ({ props }) => <BarChart {...props} />,
});

const Parts = defineComponent({
  name: "Breakdown",
  description: "Parts of a whole in one split bar, each with its figure and share: Breakdown([{label: \"Done\", value: 9, tone: \"success\"}, {label: \"Open\", value: 28, tone: \"warning\"}], \"Title\"). Instead of a Row of Stats that add up to a total.",
  props: z.object({ items: z.array(z.object({ label: z.string(), value: z.number(), tone: tone.optional() })), title: z.string().optional() }),
  component: ({ props }) => <Breakdown {...props} />,
});

const Lines = defineComponent({
  name: "LineChart",
  description: "Lines over labels (x axis, in order), one per series, four at most in one unit: LineChart([\"Mon\", \"Tue\"], [{name: \"p95 ms\", values: [120, 98]}], \"Title\"). Its legend shows each series' last value; a hover, any other.",
  props: z.object({ labels: z.array(z.string()), series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })), title: z.string().optional() }),
  component: ({ props }) => <LineChart {...props} />,
});

const Button = defineComponent({
  name: "Button",
  description: "A button; when the user clicks it, its message is typed into your terminal as if they had sent it. For a follow-up the user may want.",
  props: z.object({ label: z.string(), message: z.string() }),
  component: ({ props }) => <P.ActionButton {...props} />,
});

const COMPONENTS = [Stack, Row, Card, Tabs, Tab, Heading, Text, Markdown, List, Table, KeyValue, Stat, Parts, Badge, Callout, Code, Progress, Link, Divider, Bars, Lines, Button];

child = z.union(COMPONENTS.map((c) => c.ref) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);

/** Every component's name, as an agent writes it (`./detect.ts` lists the same, without loading OpenUI). */
export const LIBRARY_COMPONENT_NAMES: readonly string[] = COMPONENTS.map((c) => c.name);

export const outputLibrary = createLibrary({ components: COMPONENTS, root: "Stack" });

/** The guide's example of the syntax; the design rules bring their own, good and bad. */
const EXAMPLE = `root = Stack([verdict, figures, checks])
verdict = Callout("success", "Every check passes on main.", "Ready to merge")
figures = Row([Stat("Tests", 412, "+12 since main"), Stat("Coverage", "84%", "+2 pt", "success")])
checks = Table(["Check", "Status", "Time, s"], [["Lint", Badge("Passed", "success"), 9], ["Types", Badge("Passed", "success"), 21]])`;

/** The design rules (`./skill/SKILL.md`), without the front matter that makes the file a skill; Git may check it out with CRLF. */
export const OUTPUT_SKILL = SKILL.replace(/\r\n/g, "\n")
  .replace(/^---\n[\s\S]*?\n---\n+/, "")
  .trim();

/**
 * What output_guide answers: the syntax and every component's signature,
 * then the design rules, which say what to build with them.
 */
export function outputGuide(): string {
  const syntax = outputLibrary.prompt({
    preamble:
      "You show results to the user in dummyPlane with show_output, written in OpenUI Lang: one statement per line, `name = Component(args…)`, arguments by position. dummyPlane draws it in an output node beside your terminal, in the app's own style, about 560 by 520 pixels before it scrolls. The syntax and the components come first; the design rules after them say what to build.",
    additionalRules: [
      "Strings are double-quoted; write \\n for a line break inside Markdown or Code text.",
      "Do not use Query(), Mutation(), $variables or @actions: output is static.",
      "show_output answers with the errors to fix, if any, and with warnings on what will read badly; call it again with the whole program. A call without output updates your latest output in place; pass output (the id it gave) to update that one, or new: true to show another one beside it.",
    ],
    examples: [EXAMPLE],
  });
  return `${syntax}\n\n${OUTPUT_SKILL}\n`;
}
