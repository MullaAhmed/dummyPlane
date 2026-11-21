---
name: dummyplane-output
description: How to design an output that dummyPlane draws beside your terminal with show_output (OpenUI Lang) so the user gets it at a glance on a zoomable canvas. The verdict comes first, then the figures, with the detail behind a click. Read it before your first show_output; output_guide returns it after the syntax.
---

# Designing a dummyPlane output

An output is a panel of 560 by 520 pixels on a canvas the user pans and zooms, often zoomed out, beside a dozen terminals. The user glances at it between other things. Within five seconds it has to tell them what happened and whether they have to act. That is all it is for. If the same words in your terminal would do as well, the output has failed.

Think of it as an instrument panel, not a document. You choose the components and the words. dummyPlane draws everything in the app's own type, spacing and palette, in light and dark themes, so you never pick a colour, a size or a font.

## The first screen

About 450 pixels of content show before the panel scrolls, its sections 20 px apart. That is room for:

- a verdict Callout (about 60 px),
- a strip of up to four Stats with their change lines (about 90 px),
- a row of Tabs (about 35 px),
- five rows of a Table (34 px each, under a 30 px header).

So build every output in this order, and stop as soon as the user has what they need:

1. **The verdict.** One Callout. Its title is the conclusion in a few words ("Not ready to merge", "All 412 tests pass"). Its text is one sentence: why, or what to do. Its tone is the news: success, warning or danger. When the figures are the verdict (a benchmark, a count), skip the Callout and start with them.
2. **The figures.** Two to four Stats in a Row, or a Breakdown when the numbers are parts of one whole.
3. **The detail.** A Table, one row per item, its status a Badge. Several groups of items go in Tabs, each with its count, the group that needs action first. Supporting material goes in a Card with collapsed true.
4. **The next step.** One or two Buttons at the end, each a follow-up the user is likely to want, whose message is the exact instruction you would act on.

## Pick the component by the job

| The content | Use | Not |
|---|---|---|
| The conclusion, or what needs the user | Callout, one per output | Text in bold, a Heading, several Callouts |
| One to four headline numbers | Stat in a Row | A BarChart of one or two bars |
| Parts of one whole (tickets by status) | Breakdown, six parts at most | Stats that add up to a total |
| Items that each have a status or a reason | Table with a Badge cell | A List of sentences, a Card per item |
| Groups of items in one report | Tabs, each Tab with its count | Open Cards one under another |
| A value over time | LineChart, four series at most, one unit | A Table of dates |
| Named amounts side by side | BarChart, three bars or more | A pie, a Table of two rows |
| A ratio against a limit (coverage, a quota) | Progress, toned when it is bad news | A Stat reading "81 / 100" |
| Facts about one thing (branch, version, path) | KeyValue | A two-column Table |
| Code, a command, a diff | Code with its language | Markdown fences inside Text |
| Prose that has to stay prose | Markdown inside a collapsed Card | A long Text at the top |
| Where to read more | Link | A raw URL in Text |
| A follow-up the user may ask for | Button | "Let me know if you want me to..." |

## Words

- **Write fragments, not sentences**, everywhere but the Callout. A Table cell reads "Scans files up to 2 GiB, not 4 GB", not "I noticed that the scanner only handles files up to 2 GiB".
- **Lead with the identifier.** The first column is what the user would search for: the ticket, the file, the test, the endpoint.
- **Name things the user's way.** "Failed", "Needs review", "Slow" in Badges: a state in one or two words, never a sentence.
- **Sentence case, no trailing colons**, no exclamation marks, no emoji, no "Here is", "I have", "Overall", "Summary".
- **Real figures with their units.** "98 ms", "0.4%", "+12 since main". Round to what the decision needs. A column that should sort and align holds numbers, its unit in the header ("Time, ms").
- **A delta names its reference**: "−22 ms vs Monday", "+3 since main". The renderer draws an arrow from its sign.
- **The title names the subject** in a few words ("Release check: six tickets", "p95 latency this week"). The node's header shows it: never repeat it in a Heading.

## Tone

Tones carry meaning, the same meaning everywhere in one output:

- **success**: done, passing, better.
- **warning**: needs attention, partial, slower.
- **danger**: broken, blocking, failing.
- **info**: in progress, for information.
- **neutral**: not started, other, the rest of a whole.

Tone only what is news. A Stat's tone inks its figure and its delta, so give one only when the figure itself is good or bad ("Failed 3" in danger); a plain count ("Skipped 4") stays untoned. A Badge always says its state in words, so the colour is never the only signal. One Callout stands out; two are the most an output holds, or none does.

## Layout

- **Stack is the page.** dummyPlane spaces its sections; add a Divider only between groups that have nothing to do with each other.
- **A Row of Stats becomes one strip** of figures with hairlines between them. Two to four Stats; more go in a Table or a Breakdown.
- **Buttons, Links and Badges in a Row keep their own width**: a cluster, never stretched.
- **Five columns at most** in a Table: past them it crowds 560 pixels and may scroll sideways. Past eight rows it folds behind "Show all" and the user can sort it, so give all the rows and order them by what matters.
- **Two to five Tabs**, each with its count, the one that needs action first.
- **Cards are for a titled section.** Open at most three; fold detail with collapsed true; never a Card inside a Card.
- **Headings are rare.** Tabs and Cards carry titles. Use Heading level 2 or 3 to title a section of a long Stack.

## Charts

- **No chart for one number.** One or two figures are Stats; a share of a limit is a Progress.
- **LineChart**: labels in order (dates, builds), four series at most, all in one unit; two units are two charts. Name each series with its unit ("p95 ms"). The legend shows each series' last value; the user hovers for any other.
- **BarChart**: three bars or more, twelve at most. Short labels ("Mon", "v1.2") draw columns; longer ones draw rows of bars, so sort them largest first unless their order means something (time, versions).
- **Breakdown**: six parts at most, toned when the parts are states; fold a long tail into "Other".
- **Charts have titles.** Say what is measured and in what unit: "Time per file, ms".

## Updating

An output is a live panel. While work runs, call show_output again without output: the same output updates in place. Keep its title and its structure, and change the figures, so the user's eye finds the same place. Use new: true only for a second, different result.

## Good and bad outputs

Each good example below passes show_output with no warning; each bad one draws warnings.

**Good**: a test run. The verdict, four figures, the failures in a Table, the slow files folded away, the next step.

```openui
root = Stack([verdict, figures, failing, slow, next])
verdict = Callout("danger", "Three tests fail in the output node: a class name changed.", "Not ready to merge")
figures = Row([Stat("Passed", 409, "+12 since main"), Stat("Failed", 3, "+3 since main", "danger"), Stat("Skipped", 4), Stat("Duration", "48 s", "−6 s")])
failing = Table(["Test", "File", "Status", "Time, ms"], [["shows its title", "OutputNode.test.tsx", Badge("Failed", "danger"), 412], ["colours Stat", "library.test.tsx", Badge("Failed", "danger"), 88], ["splits a Breakdown", "library.test.tsx", Badge("Failed", "danger"), 61]])
slow = Card("Slowest files", [bars], true)
bars = BarChart(["legibility", "focus", "motion", "library"], [4210, 2890, 1900, 1240], "Time per file, ms")
next = Button("Fix the three tests", "Fix the three failing tests in the output node")
```

**Good**: a review of six tickets. A Breakdown for the split, Tabs for the groups, the group to fix first.

```openui
root = Stack([verdict, split, groups, next])
verdict = Callout("danger", "Two tickets break a commitment in code: fix them before the release.", "Six tickets checked")
split = Breakdown([{label: "Done", value: 2, tone: "success"}, {label: "Partial", value: 2, tone: "warning"}, {label: "Not started", value: 2, tone: "danger"}])
groups = Tabs([Tab("Fix first", [fix], 2), Tab("Partial", [partial], 2), Tab("Done", [done], 2)])
fix = Table(["Ticket", "Problem"], [["OPE-12", "Scans files up to 2 GiB, not 4 GB"], ["OPE-31", "Imports reach the AI search"]])
partial = Table(["Ticket", "Status", "Missing"], [["OPE-40", Badge("In progress", "info"), "A test that a deleted file stops serving"], ["OPE-44", Badge("Todo", "neutral"), "The 30-day log window"]])
done = Table(["Ticket", "Proof"], [["OPE-7", Badge("Tested", "success")], ["OPE-9", Badge("Needs prod check", "warning")]])
next = Button("Fix the two tickets", "Fix OPE-12 and OPE-31")
```

**Good**: a measurement. The figures are the verdict, so no Callout; the trend, then the facts.

```openui
root = Stack([figures, trend, facts, next])
figures = Row([Stat("p95 now", "98 ms", "−22 ms vs Monday", "success"), Stat("Error rate", "0.4%", "+0.1 pt", "warning"), Stat("Cache hits", "81%")])
trend = LineChart(["Mon", "Tue", "Wed", "Thu", "Fri"], [{name: "p95 ms", values: [120, 118, 121, 104, 98]}, {name: "p50 ms", values: [40, 41, 40, 35, 32]}], "Latency this week, ms")
facts = KeyValue([{label: "Branch", value: "perf/cache-ttl"}, {label: "Deployed", value: "Thu 09:40"}, {label: "Change", value: "TTL from 30 s to 5 min on `/search`"}])
next = Row([Button("Roll out to EU", "Roll the cache change out to the EU region"), Link("Dashboard", "https://grafana.example.com/d/search")])
```

**Good**: work in progress, updated in place as it runs.

```openui
root = Stack([status, files])
status = Progress(34, 120, "Files migrated", "info")
files = Table(["File", "Status", "Note"], [["api/users.ts", Badge("Done", "success"), ""], ["api/orders.ts", Badge("Running", "info"), "Rewriting 4 queries"], ["api/legacy.ts", Badge("Skipped", "warning"), "Uses the old ORM"]])
```

**Bad**: a terminal pasted into a box. The title repeated, a paragraph, a list of sentences. The user has to read all of it to learn that three things need fixing.

```openui
root = Stack([title, intro, issues])
title = Heading("Audit of the output node")
intro = Text("I went through the whole codebase and looked at every module to see how the output node renders its components. Overall the code is in decent shape but there are a number of issues that need attention, which I list below in detail so you can decide what to do about each of them one by one. Some of them are small and some are larger, so I would go through them in order.")
issues = List(["The table component does not handle very wide content well when the node is narrow, and the last column then overflows the panel", "Stats do not have consistent heights when one of them has a delta and the others do not, which makes the row look uneven", "The callout uses an icon that is not always aligned with the first line of its text"])
```

Instead: a Callout ("Three layout issues", one sentence), then a Table of the three, a Badge for each one's severity.

**Bad**: everything shouts. Six toned figures, three Callouts: nothing stands out, and the Row overflows.

```openui
root = Stack([a, b, c, figures])
a = Callout("danger", "Build failed.")
b = Callout("warning", "Coverage dropped.")
c = Callout("success", "Lint passed.")
figures = Row([Stat("Tests", 412, "", "success"), Stat("Failed", 3, "", "danger"), Stat("Lint", 0, "", "success"), Stat("Coverage", "71%", "", "warning"), Stat("Bundle", "1.2 MB", "", "warning"), Stat("Time", "48 s", "", "info")])
```

Instead: one danger Callout for the build, the other two as Badges in a Table of checks, and two to four Stats.

**Bad**: a column of open Cards and a chart of one bar.

```openui
root = Stack([one, two, three, four])
one = Card("Tables", [Text("Overflow when narrow.")])
two = Card("Stats", [Text("Uneven heights.")])
three = Card("Callouts", [Text("Icon alignment.")])
four = Card("Size", [BarChart(["Bundle"], [1.2], "Bundle size, MB")])
```

Instead: one Table of the four, and a Stat for the bundle's size.

## Before you call show_output

- Does the first screen say what happened and whether the user has to act?
- Is every status a Badge with a word, every figure a number with its unit?
- Is there one verdict, two Callouts at most, and is everything else quiet?
- Is the detail behind a click: Tabs, collapsed Cards, a folded Table?
- Would you rather look at this than read your terminal?

show_output answers with warnings when an output breaks these rules. Fix them and call it again with the whole program.
