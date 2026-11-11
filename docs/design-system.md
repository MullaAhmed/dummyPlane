# Design system

Short rules for dummyPlane UI. Source of truth: `src/theme/tokens.css` and `src/index.css`. When this page and the code disagree, the code wins: fix the page.

## Palettes

Three palettes. Each is two colours: a ground (the canvas) and an ink.

- `calm`: light. Cream ground, deep green ink.
- `electric`: dark. Blue ground, off-white ink.
- `expressive`: dark. Near-black ground, off-white ink. Default when no palette is set (`:root`).

The ink writes the text and is also the accent: `--dp-accent`, `--dp-accent-ink`, `--dp-secondary` and `--dp-draw` all take its value. Everything else is a quiet step of the two:

- Surfaces and cards are the ground a step lighter or darker.
- Hairlines, hovers and the selection are the ink at a low alpha.
- The second and third text roles are the ink a step toward the ground.
- Only the status colours (`--dp-wait`, `--dp-ok`, `--dp-danger`), `--dp-on-role` and `--dp-on-wait` stand outside the two.

No glows and no coloured shadows. Depth is surface steps and hairlines.

Every palette defines the same token names. Never add a token to one palette only.

## Token roles

Surfaces, from back to front:

- `--dp-canvas`: app background. The dot grid (`--dp-dot`) sits on it.
- `--dp-surface`: panels, dialogs, menus. Base for cards.
- `--dp-card`: nested cards and rows inside a surface.
- `--dp-field`: input fill.
- `--dp-hover`: hover and subtle fill.
- `--dp-tray`: faint ink fill for trays and wells. Defined in each palette; no component reads it yet.
- `--dp-tab-on`: fill of the active tab.

Every surface is opaque. There is no glass, no blur and no transparency setting. `.dp-glass` and `.dp-glass-strong` survive as class names for the rails and bars that already use them, and both draw the same raised surface: the `--dp-surface` fill, a `--dp-line` hairline and `--dp-float-shadow`.

Lines and shadows:

- `--dp-line`: borders and dividers.
- `--dp-shadow`, `--dp-float-shadow`: elevation for dialogs, menus and floating bars. A small neutral shadow in `calm` only; no visible shadow in the dark palettes (`0 0 #0000`).
- `--dp-scrim`: veil behind dialogs and sheets. Flat, nothing blurred behind it. Per palette.

Text:

- `--dp-text`: primary text. Titles, values, active labels.
- `--dp-text-2`: secondary text. Labels, helper text, menu items.
- `--dp-text-3`: tertiary text. Hints, idle state, metadata.

Accent:

- `--dp-accent`: fills, focus ring, primary buttons, selection.
- `--dp-accent-ink`: accent used as text. Same value as `--dp-accent` in the three palettes; write text with it so a palette can split the two.
- `--dp-accent-soft`: tinted background for selected rows. A selected row also turns on `dp-on-soft` (`index.css`), where it turns selected (`data-[selected=true]:dp-on-soft`, or beside its `bg-dp-accent-soft`): every `text-3` inside steps up to `text-2`, since `text-3` falls to 4.2:1 on the tint. Danger on the tint is `--dp-danger-on-soft`.
- `--dp-on-accent`: text drawn on an accent fill. It is the ground colour.
- `--dp-secondary`: accent for chrome and links. Same value as the ink.
- `--dp-draw`: the ink for drawing on the canvas (the pen). Defined in each palette; no component reads it yet.

Status:

- `--dp-wait`: waiting or attention state.
- `--dp-ok`: success or live state.
- `--dp-danger`: errors and destructive actions.
- `--dp-on-role`: text drawn on a role colour (a group's role). One dark ink, the same in every palette.
- `--dp-on-wait`: text drawn on the `--dp-wait` fill (the waiting count on the Agents button). Per palette: calm's cream ground (its wait is dark), the dark ink in the other two. At least 4.5:1.
- `--dp-danger-on-soft`: danger written on the selection's tint (a selected row's `D` and `−N`). Danger mixed 70% with the ink, defined once in the shared block: at least 4.5:1 on the tint, where danger itself falls to 4.1:1 in expressive.

Terminals:

- `--dp-terminal`, `--dp-terminal-head`: terminal body and header.

Terminals stay dark in every palette. What xterm draws inside them is `src/nodes/terminal/terminalTheme.ts`, one full theme per palette (no xterm default left):

- Text, cursor and selected text: the palette's light colour (calm's cream, the off-white of the other two). `white` and `brightBlack` (dim text) are that colour a step and two steps toward the terminal's body; `black` is the body a step lighter.
- The six hues are tuned per palette in OKLCH (calm earthy and low in chroma, electric vivid, expressive matched to its status colours). Red, green and yellow sit within 10° of the hue of the palette's `danger`, `ok` and `wait`.
- Every ANSI colour but `black` reads at 4.5:1 at least on the body, `brightBlack` included, and the selected text at 4.5:1 on the selection. `terminalTheme.test.ts` checks it, with the hue bands and the gaps that keep the six apart.
- A palette switch recolours every open terminal at once. A subagent's transcript (`SubagentNode`) uses the same theme.

Code editor:

- The editor (the Code Studio, the notes) draws code with `src/studio/syntaxTheme.ts`, one highlight style per palette, never One Dark or CodeMirror's default (made for other grounds: electric's comments read 2.5:1).
- Its six hues are the terminals', each kept at its OKLCH hue (within 2°) and stepped in lightness for the editor's own grounds: at least 4.5:1 on the surface, the active line and the accent's tint (a search match, the line reached, a selection off the caret line). On the caret's line inside a selection, where the hover stacks on the tint, they read about 4.1:1. Operators and punctuation are `text-2`, comments `text-3` in italic, errors `danger`.
- Caret, selection, active line, gutter and matched brackets are tokens. A palette switch recolours an open editor at once, between the two dark palettes too. `syntaxTheme.test.ts` checks it.

## Contrast

Text tokens meet WCAG AA on `surface`, `card` and `canvas`.

- Body text, `text-2` and `text-3`: at least 4.5:1.
- Large text and UI parts: at least 3:1.
- Status tokens and `accent-ink`: at least 4.5:1 on each surface.
- On the selection's tint (`accent-soft` over a surface or a card): `text`, `text-2`, the lifted `text-3` and `--dp-danger-on-soft` at least 4.5:1.
- On a fill: `on-accent` on the accent, `on-wait` on the wait fill, at least 4.5:1.
- Text over a terminal's dark body sits on a surface card (as `ToolsUnavailable` does) or in the terminal's own inks (`terminalTheme.ts`): the text roles are the ink, which is calm's green, 1.3:1 on calm's body.
- Tests: `src/theme/legibility.test.ts` computes these pairs from `tokens.css`.

Check any new pair with a contrast tool before use.

## Radius

Use the scale. Never hard-code a pixel radius.

- `rounded-sm` (`--radius-sm`, 6px): chips, tags, keycaps.
- `rounded-md` (`--radius-md`, 8px): controls. Buttons, inputs, menu rows.
- `rounded-lg` (`--radius-lg`, 12px): cards, menus, popovers, toasts.
- `rounded-xl` (`--radius-xl`, 16px): panels, dialogs, windows.

Nested radius: inner = outer minus the padding, never below 4px.

## Type

- Font: Inter Variable for UI, JetBrains Mono for code and terminals.
- Section labels: `.dp-label`. 12px, medium, sentence case, `text-dp-text-2`. Do not resize it where you use it.
- Scale: `text-xs` (12px), the UI step (13px), `text-sm` (14px). Write the step `text-(length:--text-ui)`, never `text-ui` (`cn` reads that as a colour and drops it beside `text-dp-text`) and never `text-[13px]`. Menu rows, tabs, node titles and small buttons use it. No arbitrary pixel size, and nothing under 12px.
- Body: 13px to 14px. Keep line length short in menus.
- Headings: weight 600 at most. Avoid 700 for chrome.

## Spacing

- Use Tailwind spacing steps (4px grid).
- Menu items: 6px to 8px vertical padding.
- Dialog body: 16px to 20px padding.

## Heights

Controls share one height scale. The `Button` sizes:

- `sm` and `icon-sm`: `h-7`. Dense toolbars and menus.
- default and `icon`: `h-8`. Buttons and inputs.
- `lg` and `icon-lg`: `h-9`. Primary actions in dialogs.
- `xs` and `icon-xs`: `h-6`, still in use. Off the scale above, kept for inline chips and compact controls (about 40 call sites). Use them only there; for a standalone control pick `sm`, default or `lg`.

## Motion

Tokens live in `tokens.css`:

- `--dp-ease-out: cubic-bezier(0.22, 1, 0.36, 1)`. Default for every entrance and press. Tailwind's `ease-out` reads it.
- `--dp-dur-fast: 150ms`. Presses, hovers, tooltips.
- `--dp-dur: 200ms`. Popovers, menus, dialogs.

In class names write `duration-(--dp-dur-fast)` or `duration-(--dp-dur)` and `ease-(--dp-ease-out)`. Never a literal `duration-150`, `ease-out` and the like.

Rules:

- Keep UI motion under 300ms.
- Never animate keyboard-driven actions.
- Never use `ease-in` on UI elements.
- Never start scale animations from `scale(0)`. Use `0.9` or higher with opacity.
- Popovers scale from their trigger. Dialogs stay centered.
- Use transitions for interactive state. Keyframes only for one-shot effects.
- List transitioned properties. Never use `transition-all`.
- Under `prefers-reduced-motion`, drop movement. Keep colour and opacity cues.
- Exits are quicker than entries: overlays enter in `--dp-dur` and leave with `data-closed:duration-(--dp-dur-fast)`.
- What the keyboard opens appears at once. A menu or popover a request opened (the palette, a shortcut) carries `data-instant`, which runs no animation; the radial ring opens with none; its wedges stop easing while the arrows turn it (`data-keyboard`).
- Rows the pointer sweeps (file lists, diff lines, the tree) and selections the arrows move (the palette) snap: no transition on them.
- Tooltips share the app's one provider: after the first hint, its neighbours open at once and unanimated.
- Reduced motion, in `index.css`: overlays (every `[data-slot$="-content"]`) fade with no zoom or slide, toasts fade, the waiting dot breathes slower and shallower, a wire is lit for the message's length instead of a light running along it, and a control's press stops (`motion-reduce:active:scale-100`) while its colour still eases.
- The waiting dot is a dot inside a thin ring (an outline, off the layout): the one state that asks for the user reads without its colour or its motion.

## Interaction

- Hover: subtle fill from `--dp-hover`. Never change layout.
- Focus: `focus-visible:ring-2 focus-visible:ring-dp-accent/70`, at least 3:1 on the canvas, the surfaces and the cards in every palette (`/50` fell to 2.6:1). Show on keyboard focus only, at once: never name `box-shadow` in a transition list, or the ring fades in.
- Destructive focus: `focus-visible:ring-dp-danger`, the full colour (`/20` was 1.3:1).
- Menu and select rows: the pointer gets the `--dp-hover` fill; the keyboard also gets `focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-dp-accent/70`, since a 6% fill is 1.1:1. No transition on either.
- Tests: `src/theme/focus.test.ts` computes these ratios from `tokens.css` and reads the alphas from the components.
- Press: buttons scale to `0.97` on `:active`. Ease it on `scale`, not `transform` (see Node chrome).
- Disabled: `opacity-50` and `pointer-events-none`.
- Touch: hover styles are not gated behind `(hover: hover) and (pointer: fine)` today (a desktop app, mouse first). Gate any new hover-only effect that a touch screen could stick on.
- Hints: use the app's `Hint` tooltip, not a native `title`, on controls.

## Surfaces and layers

- Menus, popovers, selects, toasts: opaque `--dp-surface`, hairline, radius `lg`, `--dp-shadow`.
- Dialogs: opaque `--dp-surface`, hairline, radius `xl`, veil from `--dp-scrim`.
- Raised bars and rails: `.dp-glass` or `.dp-glass-strong` (the same opaque look, see Token roles).
- The shadcn parts set this once, through `data-slot` rules in `index.css`. Do not re-set the fill, border or radius on a dialog or menu.

## Node chrome

A terminal and a fleet share one header, `NodeHeader` in `src/nodes/terminal`, built from the same pieces so the two cannot drift:

- One 36px row (`h-9`) on the terminal's head colour (`bg-dp-terminal-head`), a hairline below.
- The name is 13px (`text-(length:--text-ui)`), medium weight. It gives way first: the end group never shrinks.
- A sub-agent (a terminal opened by `spawn_agent`, a Claude subagent cell) stacks what it was asked under its name (`NodeTitle`): two 16px lines in the row, the task in `text-xs` and `text-dp-text-2`, one line with an ellipsis, the whole line and an excerpt of the task in a tooltip that the keyboard reaches. While the name is renamed, its field takes the row alone.
- At the end, the quiet facts, then the actions as `icon-sm` (28px) buttons, muted until pointed at. Use `RemoteButton` and the other header buttons as they are; do not wrap them to resize them.
- What a node needs only now and then lives in one `⋯` menu (`HeaderMenu`), not on the row.
- Close is the last control.
- The chips and the clock (`WIDE_ONLY`) hide when the node is narrower than 448px. The header is a size container (`@md/head`), so it is the node's width that decides, not the window's.

Press rule: `active:scale-[0.97]` sets the CSS `scale` property, not `transform`. A transition list that names `transform` leaves the press snapping, so name `scale`: `transition-[color,background-color,scale]`, with `duration-(--dp-dur-fast)`, `ease-(--dp-ease-out)` and, under reduced motion, `motion-reduce:transition-[color,background-color] motion-reduce:active:scale-100` (the press stops moving, the colour still eases). `Button` already does this; when a class overrides its transition list, keep `scale` in it. (`transition-transform` is fine for a rotate or a translate: it covers `translate`, `scale` and `rotate`. A bare `transition-[transform]` does not.)

## Colour rules

- Use `dp-*` tokens only. No raw hex in components.
- Do not hard-code `black` or `white`. Use `dp-on-accent` or `dp-text`.
- Status colours carry meaning. Pair them with text or an icon.

## Deprecated aliases

These names still work. New code uses the base token.

- `--dp-surface-2` becomes `--dp-surface`.
- `--dp-command` becomes `--dp-surface`.
- `--dp-selected` becomes `--dp-accent-soft`.
- `--dp-working` becomes `--dp-accent`.
- `--dp-waiting` becomes `--dp-wait`.
- `--dp-idle` becomes `--dp-text-3`.
- `--dp-done`, `--dp-live` become `--dp-ok`.
- `--dp-glow-1`, `--dp-glow-2`, `--dp-glow-3` are `transparent`: glows are retired.

Removed, no longer defined: `--dp-glass`, `--dp-glass-strong`, `--dp-glass-hi`, `--dp-glass-edge`.
