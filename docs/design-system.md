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

No glows and no coloured shadows. Depth is surface steps and edges: a hairline, and on a surface stacked on another in the dark palettes the stronger line (see Token roles).

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
- `--dp-selection`: selected text (`::selection`), under the ink: 28% ink in `calm` and `expressive`, 16% in `electric`, so the text keeps 4.5:1 on every ground. xterm, the code editor and Excalidraw draw their own.

Every surface is opaque. There is no glass, no blur and no transparency setting. `.dp-glass` and `.dp-glass-strong` survive as class names for the rails and bars that already use them, and both draw the same raised surface: the `--dp-surface` fill, a `--dp-line` hairline and `--dp-float-shadow`.

Lines and shadows:

- `--dp-line`: borders and dividers.
- `--dp-line-strong`: a control's own boundary (Input, Textarea, the Select trigger), and in `electric` and `expressive` also the edge of a surface stacked on another (menus and sub-menus, popovers, selects, dialogs, toasts), which has no shadow there: the ink at 60% in `calm` and `electric` and 40% in `expressive`, 3:1 or more on every ground, where the hairline reads about 1.2:1. Never a divider.
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
- Claude Code's own colours (its prompt, accents, panels, diffs) follow too: a Claude terminal's `--settings` names `custom:dummyplane`, Claude's ANSI-only dark theme (`src-tauri/src/agents/claude_theme.json`, written to `<Claude folder>/themes/`), so it draws in the 16 colours above. Its panels move from `brightBlack` to `black` and its diff lines to dark 256-colour greens and reds, keeping the text at 4.5:1 on them; `claudeTheme.test.ts` checks it. A theme the user set in their own settings wins.

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
- On an inverse surface (the tooltip: `bg-foreground text-background`, the ink under the canvas colour) a quiet line is the canvas colour at 85% (`text-background/85`), at least 4.5:1 in every palette. Never `text-dp-text-3`, which is no ink there, and never an opacity.
- Tests: `src/theme/legibility.test.ts` computes these pairs from `tokens.css`.

Check any new pair with a contrast tool before use.

## Radius

Use the scale. Never hard-code a pixel radius.

- `rounded-sm` (`--radius-sm`, 6px): chips, tags, keycaps.
- `rounded-md` (`--radius-md`, 8px): controls. Buttons, inputs, menu rows.
- `rounded-lg` (`--radius-lg`, 12px): cards, menus, popovers, toasts.
- `rounded-xl` (`--radius-xl`, 16px): panels, dialogs, windows.
- `rounded-xs` (Tailwind's own, 2px): marks and the small parts of a chart. A failed agent's square (`StatusDot`), a chart's bars, keys and focus ring, the tooltip's arrow. Not a card, a panel, a dialog or a button.

Nested radius: inner = outer minus the padding, never below 4px.

## Type

- Font: Inter Variable for UI, JetBrains Mono for code and terminals, and for figures (counts, sizes, durations, ids), which it sets tabular.
- Section labels: `.dp-label`. 12px, medium, sentence case, `text-dp-text-2`. Do not resize it where you use it.
- Scale: `text-xs` (12px), the UI step (13px), `text-sm` (14px). Write the step `text-(length:--text-ui)`, never `text-ui` (`cn` reads that as a colour and drops it beside `text-dp-text`) and never `text-[13px]`. Menu rows, tabs, node titles and small buttons use it. No arbitrary pixel size, and nothing under 12px.
- Body: 13px to 14px. Keep line length short in menus.
- Headings: weight 600 at most. Avoid 700 for chrome.

## Spacing

- Use Tailwind spacing steps (4px grid).
- Menu items: 32px high (`min-h-8`), 13px text (`text-(length:--text-ui)`), an 8px gap after the icon.
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
- The camera follows what asked for the move (`cameraMotion`, `src/canvas/viewActions.ts`). A move the keyboard asked for (a shortcut, the palette) is instant. One the pointer asked for (the rail, the radial ring) or the app (a node added out of sight) glides for `CAMERA_MS` (300ms), never Excalidraw's 500ms. Under reduced motion every camera move is instant.
- A dialog a command opened (the palette, a shortcut) takes `instant` on `DialogContent`: `data-instant` on its content and its scrim, so it shows and leaves at once. A dialog a click can open too passes it only when a command asked (the loops and troubleshooting dialogs). The update dialog and the confirms that close an agent, a group or a fleet do not take it yet: they ease in.
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
- Where the keyboard goes: a launch the person asked for gives the new terminal the keyboard and arrives in place (`arriveLaunched`, `src/agents/arrivals.ts`, which is `arrive` with `moveView: false` in `src/canvas/arrive.ts`): `arrive` leaves the view as the launch made it, and Canvas does not bring the terminal to 100% for it (`arrivedInPlace`), so the person keeps their zoom. Ctrl+Tab and Go to bring a terminal to 100%, and so do the install terminal and the installed toast's Launch. A surface that closes gives it back to what opened it (`src/lib/focusReturn.tsx`): a dialog through `closeAutoFocusTo`; the git window, the review panel and the Agents panel through `returnFocus`, with the opener `useOpener` kept; the palette to the element it was opened from. A menu's item stands for the menu's button. Unless something else took the keyboard meanwhile: a terminal a launch gave it to, a field, a click elsewhere.
- A hint opens on hover, and on focus only after Tab, Shift+Tab or an arrow (`TooltipTrigger`), never on a focus the app hands back, which would leave it over what it names. A blur closes it.
- Press: buttons scale to `0.97` on `:active`. Ease it on `scale`, not `transform` (see Node chrome).
- Disabled: `opacity-50` and `pointer-events-none`, unless the row or control carries a reason, beside it or in its hint (a menu or palette row, a greyed router switch): then it is greyed by its ink, `text-dp-text-3` (4.5:1), never by opacity, which took the reason to about 2.4:1. Precedent: Send (`disabled:text-dp-text-3 disabled:opacity-100`).
- Touch: hover styles are not gated behind `(hover: hover) and (pointer: fine)` today (a desktop app, mouse first). Gate any new hover-only effect that a touch screen could stick on.
- Hints: a control names itself in the app's `Hint` tooltip, never in a native `title`. A greyed control takes neither the pointer nor the keyboard, so its hint goes on a wrapper (`GreyedHint`, `src/shell/GreyedHint.tsx`). The two chevrons on the canvas (a group label's fold and its menu) keep a native `title`: no tooltip over the canvas. A native `title` also stays on text that truncates, for its whole value (a path, a commit subject).
- Node controls: a node's controls (its header's buttons, an agent's foot, a Fleet's mission panel, a minimized card's Expand) take a press whether or not the node is active, with the selection tool (`src/canvas/liveControls.ts`, `src/theme/excalidraw.css`): the press activates the node without selecting it or moving the view, and the keyboard stays on the control. The rest of an inactive node, a drawing tool's press and the wheel (a text field's own aside) stay the canvas's. Only the active node is in the Tab order (`src/canvas/tabStops.ts`). A terminal's or a Fleet's Edit is its header's pencil (`EditButton`), and Excalidraw's link bar never shows on a dummyPlane node.
- A hint may name only a key that a test ties to a registered shortcut (`FUNCTIONS_SHORTCUT`, `src/commands/launchRoutes.test.ts`): never a key the app does not answer.

## Surfaces and layers

- Menus, popovers, selects, toasts: opaque `--dp-surface`, radius `lg`, `--dp-shadow`. The edge is the hairline in `calm`, whose shadow sets the surface apart, and `--dp-line-strong` in `electric` and `expressive`, which have no shadow (`index.css`, under `:root[data-theme="dark"]`; a sub-menu too).
- Dialogs: opaque `--dp-surface`, radius `xl`, veil from `--dp-scrim`, the same edge as the menus.
- Raised bars and rails: `.dp-glass` or `.dp-glass-strong` (the same opaque look, see Token roles). Panels, work windows and nodes keep the hairline in every palette.
- The shadcn parts set this once, through `data-slot` rules in `index.css`. Do not re-set the fill, border or radius on a dialog or menu.
- Overlays stay inside the window and below `OVERLAY_TOP` (the title bar's 38px plus an 8px gap), 8px from its other edges (`src/shell/overlayBounds.ts`). A menu, popover or select flips, shifts and caps its height by `OVERLAY_COLLISION_PADDING`, which the primitives set: a call site passes no `collisionPadding` of its own. A dialog is never taller than the window less 46px above and below (centred); the radial ring's centre keeps under the title bar too. At 960×600 a tall one scrolls inside these bounds.
- A tall dialog puts its middle in `DialogBody` (`src/components/ui/dialog.tsx`), which scrolls between a header and a footer that stay in view. A dialog without one scrolls whole.
- Where a surface stands and the layer it takes: see Layer zones.
- A list a UI request opens at a point of the window (the layouts of "Arrange as…", the agents of "Other agent…" and of a group's "Add an agent") is a `PointMenu` (`src/agents/PointMenu.tsx`) of the shared dropdown menu, its rows `POINT_MENU_ROW`: a line of the UI step, the ticked row under the keyboard first, and `data-instant`, like any menu a request opens.

## Layer zones

The window is cut into fixed zones, and each floating surface stands in one. The zones' numbers are in `src/shell/layout.ts` (the overlays' in `src/shell/overlayBounds.ts`), and `src/shell/layout.test.ts` holds the code to them. Sizes are CSS px.

- One inset, `FLOAT_INSET` (12px): what a floating surface keeps from the window's edge, from the bars and from its neighbour.
- The top row is the title bar (38) and the workspace tabs (34), 72 in all (`TOP_ROW_HEIGHT`). The bottom band is the 12px gutter and a one-line command bar (48), 60 in all (`BOTTOM_BAR_HEIGHT`; the bar grows with its lines). The git chip and the zoom control stand in the band, on the gutter.
- Two rails, one each side, 46 wide and 12 in: the tool rail on the left (canvas only), the activity rail on the right. Each takes 70 from its side (`RAIL_ROOM`).
- The right lane is 336 wide (`LANE_WIDTH`: the Agents panel's width). Its right edge is 70 from the window's, one inset left of the activity rail (`LANE_RIGHT`). Its top is 84, one inset under the bars (`LANE_TOP`), and its foot 72, one inset above the command band (`LANE_BOTTOM`).
- The lane's one occupant is the Agents panel (`useLaneOccupant`, `src/shell/lane.ts`). A work window that opens (the review panel, the git window, Code Studio, Notes) folds it to its rail badge. The Agents panel that a window folded comes back when the last window has gone, as it was (its filter too); one the person opened or closed since is left. Below 1,100px a window starts with the Agents panel folded, and that is not saved (`src/agents/panelFold.ts`, `agentsPanelState.ts`).
- A terminal's or a Fleet's Edit panel is no occupant: it stands beside its node, in the work area (`besideRect`, `src/canvas/panelPlace.ts`). On the node's right, else its left, its top on the node's. It never covers the node's header, where the pencil that opened it and folds it stands: when neither side has room (a 720px terminal at 100%), it stands over the node's body, its right edge on the node's, one gap under the header (36px, `NODE_HEADER_HEIGHT`, as it shows at the zoom), or above the node when less than 200px would show under the header and more shows above. It keeps one inset under the bars and above the command band, clear of the rails and left of an occupied lane. It follows the node as the view pans and zooms, and stays on the work area's edge when the node goes past it. The Agents panel and the Edit panel never fold each other. A work window that opens folds the Edit panel to the pencil in its node's header, since the window would hide it; a folded Edit panel stays folded until its node's pencil opens it again.
- The notifications and the usage popovers open from their buttons: the notifications left of the bell, on the activity rail, their top on the bell's; the usage detail under the meter, its right edge on the meter's. The Settings menu opens from its rail button.
- The lane is reserved only while it has an occupant. The work area is the window less the top row, the bottom band, the rails and, then, the lane: 72 above, 60 below, 70 left, and 70 right (`RAIL_ROOM`) or 418 (`LANE_ROOM`: the rail's 70, the lane's 336 and an inset) while the lane is occupied. `--dp-lane-room` publishes the right inset. Ctrl+Tab and Go to bring a terminal to 100% centred there, fits frame it and launches drop it (`workArea`, `currentWorkArea`); one wider than the area keeps its left edge on the area's. A Go to target is centred clear of the open lane, and its neighbour may stand partly under it. A launch the person asked for arrives in place, as Interaction says: its terminal is added by `addTerminal`, which scrolls to it only when it is out of sight, at the zoom the view has and centred in the work area (`revealNode`, as for a new note). In sight is the window under the bars less an occupied lane, the rails not counted. A node only the lane hides moves the view too, unless that would take the active node, the one the person was at, out of sight. A terminal nobody asked for (a mission's agent, a sub-agent) neither moves the view nor takes the keyboard, and is placed out from under an occupied lane.
- The review panel and the git window stand from the lane's top to its foot (84 and 72), at most 920 wide and no nearer than 108 to the window's left edge (`WORK_WINDOW_MAX`, `WORK_WINDOW_LEFT`). The Code and Notes workspaces take the same top and right, and run down to one inset above the window's foot (they have no command band). While the lane is occupied they all start beside it, on `LANE_ROOM`, if they keep 400 there (`WORK_WINDOW_MIN`: at the 960px minimum 434 remain). Narrower, they keep their place on the rail's room and the occupant stands over them (`workWindowPlace`, `useWorkWindowPlace`).
- The z scale is one stacking context, the project view's (`Z`): 10 canvas furniture (a drawing's panel, a terminal's Edit panel, the loops pill, the waiting notice); 20 work windows; 30 the lane's occupant (the Agents panel), with the bars and the rails (it never meets them); 40 the placement and link modes, and a panel's crash notice; 50 overlays (menus, popovers, selects, dialogs, tooltips). The radial ring stands at 45. The toasts stand over all of them: Sonner sets its own z-index.
- The most recent surface is on top. A work window that opens folds the occupant, so the occupant is always newer than an open window: where the window cannot start beside the lane, the lane (30) stands over it (20). It folds an open Edit panel too, which stands on the canvas (10), under the windows. The popovers and every overlay stand over all of them.
- The bottom left corner is one stack on one set of numbers. The git chip stands on the gutter, in the band. The loops pill, 32 tall and 12 from the left, stands above the band (`LOOPS_PILL_BOTTOM`, 68). The waiting notice, 260 wide and 70 from the left (`WAITING_NOTICE_LEFT`), stands where the pill's foot would be, and above the pill while one shows (`--dp-loops-room`). Below 1,340px the command bar reaches the notice's column, and the notice keeps one gap above the bar's band, however many lines the bar grows to (`--dp-bottom-band`). The pill and the notice take layer 10, under the work windows, and are inert while a window reaches left over their column (`coversCorner`, `CORNER_COLUMN_RIGHT`, 330): no hidden button keeps the keyboard.
- The toasts stand bottom right, 336 wide like the lane (`TOAST_WIDTH`), on the lane's edge and foot (`TOAST_RIGHT` 70, `TOAST_BOTTOM` 72, `AppToaster`): clear of the activity rail and one inset above the command band. They keep off the surfaces that register with `useKeepToastsOff`: the review and git windows, whole, and a Fleet's mission panel while it is in view. Where the front toast would meet one, they take the first place that meets none (`clearOfWindows`, `src/shell/toastLift.ts`): the lane's foot; left of what they meet, at their height, while they keep the tool rail's room; above it, while one toast fits under the title bar; else down in the bottom band, 8 from the bottom (`TOAST_IN_BAND`), on the same edge, over the command bar's end for their few seconds rather than on a window's fields. They also keep clear of an open rail popover (notifications, usage, Settings): above it where one toast fits between it and the title bar, else left of it.
- Overlays keep `OVERLAY_TOP` (46: the title bar and an 8px gap), not the lane's top, so a menu may rise over the tabs row. Their collision padding is the 46 above and 8 on the other sides (`OVERLAY_COLLISION_PADDING`, `src/shell/overlayBounds.ts`; see Surfaces and layers).

## Words

One word per state of an agent, on every surface: the status pill and the foot, the Agents rows and filters, the group labels and counts, the mission rows and the alerts. The table is `stateWords` (`src/agents/messages.ts`), and `src/i18n/wording.test.ts` holds each surface to it.

- Working: it is at work.
- Waiting: it asks for the person.
- Ready: its turn is over and it waits for the next message. The Agents panel's resting filter is Ready.
- Blocked, Failed: what its last report says.
- Exited: its process ended (`Exited · 2` carries the code).
- Done: only for an agent that reported done. An agent that merely rests is Ready, never Done.
- Inside a line the word is lowercase (`inLine`): "2 working", "1 waiting", "ready".
- Some words name an event or a category, not a state, and stay: Stopped (no process runs), Agent exited (Claude left and the terminal is back at its shell), and Finished, the notifications' category and a mission's state.
- A decision a panel asks of the person (a Fleet's plan go-ahead, Land, Clean up) is a wait, as an agent's question is. It counts as Waiting, shows in the waiting notice and the rail's badge, and notifies.

Sentences:

- A one-sentence text of the interface ends without a period: a label, a hint, a line in a dialog or a toast. "Could not save the canvas", not "Could not save the canvas." `src/i18n/wording.test.ts` scans the `messages*.ts` files, `src/mcp/` apart, for one that keeps it. A trailing ellipsis stays.
- Text of several sentences keeps the periods between its sentences, and the test leaves it alone: it does not ask for a last one. Text an agent reads keeps its periods whole (the MCP server's, in `src/mcp/`, the Notes tool's lines, a loop's prompts), and so do the clauses of a paragraph the app joins (the clean-up's report, a link's reason). The test lists each such exception by a fragment of its text.

## Marks

What each small mark means is fixed, so the round dot stays the one signature of an agent.

- The round 8px dot is an agent's status alone: `StatusDot` (`src/nodes/terminal/StatusDot.tsx`) draws it. A palette's swatch and a chart's points and keys are the only other round dots (`statusDotOnly.test.ts`).
- A group or a role is a bar of its colour, 2px by 14px (`RoleMark`, `src/components/marks.tsx`). Beside its name it is hidden from screen readers; alone, as in a terminal's header, it takes a `label`.
- A step is a segment of its frieze (`STEP_LOOK`): done thin, under way thicker, to come dashed, failed ending on a stop. It reads by its shape as much as its colour.
- Unread is a row's weight and ink (medium, `--dp-text`, with a screen-reader word), not a dot. Unsaved is its word ("Unsaved changes"), and a pencil in a file's tab.
- Role hues stay at least 25° of OKLCH hue from every palette's wait colour, so a frame beside a waiting agent never reads as waiting. A grey has no hue to mistake (`sceneColors.test.ts`).

## Alerts

Toasts, the waiting notice, the error screens and the Windows notifications are one family: one surface, a tone per type, the app's buttons, one voice. Their copy lives in each area's `messages.ts`: plain, short English, no exclamation marks.

Toasts (Sonner: `src/components/ui/sonner.tsx`, placed by `AppToaster`):

- Surface: the opaque `--dp-surface`, `rounded-lg`, `--dp-shadow`, the edge of a menu (see Surfaces and layers). One toaster, bottom right, on the lane's edge and foot (`AppToaster`, `TOAST_RIGHT`, `TOAST_BOTTOM`; see Layer zones): it keeps off the review and git windows and a Fleet's mission panel, and clear of a rail popover. Inter, like the rest of the app.
- Type: the title at the UI step (13px), medium, `--dp-text`. The description `text-xs`, `--dp-text-2`.
- Tone (`TOAST_TONES`): each type has its own icon shape drawn in its status colour. Success is a check in `--dp-ok`, info an "i" in `--dp-accent-ink`, warning a triangle in `--dp-wait`, error an octagon in `--dp-danger`, loading a spinner in `--dp-text-2`. Never the colour alone, never a tinted fill or a coloured border, no `richColors`: the text stays `--dp-text`.
- Buttons (`TOAST_CLASSES`): the action (Undo, Show) is the `outline` button at `sm`; the cancel is the quiet ghost at `sm`, in `--dp-text-2`. Both keep the focus ring and the press. A question in a toast is drawn by `showDecisionToast` (`src/shell/DecisionToast.tsx`), like the resume offer (`ResumeAllToast`, which draws its own): `AccentButton` first, then a quiet dismiss, both at `sm`. The outline button is a side action, not the answer to a question. A question a panel asks too shows in a toast only while that panel is out of sight (`askInToast`, `src/mission/missionToasts.ts`): its home asks it always, and the toast goes when the panel comes into view or the question no longer stands.
- Motion: `--dp-dur` on `--dp-ease-out`, with no `box-shadow` in the transition list. Under reduced motion, toasts only fade.
- Sonner injects its own style unlayered, later than `index.css`, so it beats every utility. `index.css` rolls each property it sets on the title, the description and the buttons back to the utilities' layer (`revert-layer`), with a selector that out-ranks its strongest rule. Opacity stays Sonner's, since it hides the toasts stacked behind. It also puts the app's font back. `src/theme/alerts.test.ts` checks all this against Sonner's stylesheet.
- A custom toast (`toast.custom`) draws the same: `dp-glass-strong`, `rounded-lg`, the same type steps. Sonner does not style it, so it carries its own mark (`data-decision-toast`, `data-resume-toast`) for the dark palettes' stronger edge (`index.css`); `legibility.test.ts` checks both.
- A toast is not kept. The notification panel (the bell of the right rail, `src/notifications/`) keeps three kinds of news, each recorded where it happens with `recordNotification`, its node named so its entry is filed under that node's workspace: an agent that finished (`src/shell/finishAlert.ts`), a question an agent asks (`src/shell/waitingAlert.ts`) and a board whose cards are all done (`src/shell/boardDoneAlert.ts`).

Errors:

- Every error toast goes through `toastError` (`src/lib/errorToast.tsx`). `toast.error` appears nowhere else.
- The title says what failed, in the app's words ("Could not save the canvas"). It is never the error itself: no `String(error)`, no `error.message`, no "AppError:", nothing in Rust's or the OS's wording.
- Under it, when the app knows, comes what to do next (`next`): one sentence in `--dp-text-2`. Promise no fix the app cannot know.
- Last comes the error's own text, as a detail (`errorDetail`). It keeps the first line only, without the class name, the `(os error N)` or a stack, at most 160 characters. It is set in the code font in `--dp-text-3`. The whole error goes to the log.
- `src/lib/errorToast.test.tsx` rejects a toast whose title is a raw error, and any `toast.error` outside the helper.
- Inside a panel the same parts stand in `InlineProblem` (`src/components/InlineProblem.tsx`), never a raw error. The title says what failed in the app's words. Then the next step, naming only what the app or a terminal can do (no git command as if the app had it). At most one action, the `outline` button at `sm`. The error's own first line comes last as a detail, in the code font in `--dp-text-3` (`errorDetail`), and the whole error goes to the log. It sits where the problem is, a `place`: a band under a panel's tabs, the middle of a pane that has nothing else to show, a line among a list's rows, or bare in a row of its own. Its tone is the toasts': an octagon in `--dp-danger` for an error, a triangle in `--dp-wait` for a warning, never the colour alone. `src/i18n/alerts.test.ts` holds the panels' lines to the toasts' voice.

Screens and notices:

- The start-up error (`StatusScreen`), a project whose workspaces do not load (`ProjectView`) and a render error (`CrashNotice`, `AppCrash`) all read the same. The title comes in the app's words, then the error's detail in the code font, `text-xs`, `--dp-text-2`. The full screens and the crash notices end with the ways out: try again, the logs, troubleshooting. The project's load error has none of its own; the title bar and the project picker stay usable.
- The waiting notice (`WaitingNotice`) uses the same raised surface, bottom left, with one row per agent. Each row shows the agent's waiting `StatusDot`, the ringed signature dot, never a plain colour dot. It stands in the corner's stack, under the work windows, and is inert while one covers it (see Layer zones). A row names the agent and shows the question's first two lines: the question's text may show here, in the window.

Questions:

- Code Studio asks about an open file in one decision bar under the tabs (`DecisionBar`, `src/studio/parts.tsx`), over the editor's top edge so the code never moves down for it. The question first, then the quiet dismiss, the destructive answer and the accent one, all at `sm`. Only one question at a time: the bar for a tab's unsaved changes covers the file's own question (changed or deleted on disk). The window's close keeps its dialog (`UnsavedDialog`), in the same words and the same order.

Windows notifications (`waitingAlert`, `finishAlert`):

- The title is the agent and its state, in the state table's words (see Words): `<name> · Waiting`, or `<name> · Done`, `· Blocked`, `· Failed` for a report, `· Ready` for a turn that ended without one. The finish toast in the window reads the same. The body is one line.
- A waiting agent's body is fixed, "Has a question for you". Never the question: a notification can show on the lock screen. A Fleet's decision says its own fixed line too ("Has a plan for your go-ahead", "Asks to land its mission"), never the mission's name, branch or folder. What stays in the window may quote the question: the waiting notice does. The notification panel records today the notification's own title and fixed line (`recordQuestion`). A finish's body is its summary line.
- Never "dummyPlane" in the title: Windows shows the app's name and icon above it. That holds for the installed app, whose Start menu shortcut carries the identifier (`dev.dummyplane.app`). A build run from `target/debug` or `target/release` shows as Windows PowerShell, because the notification plugin leaves the identifier off there.

Native dialogs:

- Only the folder pickers (`@tauri-apps/plugin-dialog` `open`, `directory: true`). Everything else is the app's own dialog or toast, with no `window.alert`, `confirm` or `prompt`.
- One exception: a database that does not open at start-up (`database_failure`, `src-tauri/src/lib.rs`). It happens before any interface can run, and its text follows the same voice.

## Empty and loading states

What a pane or a list says when it has nothing to show (still reading, nothing there, nothing picked) is `EmptyState` (`src/components/EmptyState.tsx`), the one copy for the git, review, studio and notes panels: `text-xs` in `--dp-text-2`, centred in a pane (`place="pane"`) or a line among a list's rows (`place="list"`). A problem is an `InlineProblem`, never an `EmptyState` (see Alerts). `src/theme/panels.test.ts` keeps the copies out.

- A loading line opts in to a grace (`grace`). It keeps its place, empty, for `GRACE_MS` (150ms), then speaks, so an answer that arrives within it shows no "Reading…" flash. The other states, nothing there and nothing picked, speak at once, and so does a loading line that turns into one: the answer is in (`useGrace`).
- A lazy workspace (Code Studio, Notes) loads behind a `PanelSkeleton` (`src/shell/PanelSkeleton.tsx`) in its `Suspense` fallback, never the bare canvas: its own frame, a list and a page in `dp-glass-strong` with quiet bars (`bg-dp-hover`), where the workspace will stand (under the bars, left of the activity rail or of an occupied lane; see Layer zones). It waits `GRACE_MS` before it draws, so a module already loaded shows nothing. It is named for a screen reader at once (`role="status"`, `aria-busy`) and is still: nothing in it moves.

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

## Wires

A wire is an Excalidraw elbow arrow marked `customData.dummyplane.kind === "wire"` (`src/agents/wires.ts`), 2px, no heads, drawn in the palette's accent. A message passing over it runs a light along it (`WireActivity`, see Motion). What a wire is reads from its stroke and its place, never from its colour alone:

- A team link (Fleet to a group or a terminal), an agent link ("+ Link"), a spawn wire (`spawn_agent`, from the parent to the sub-agent): solid.
- A talk wire: dashed, in the same colour. It forms when a message passes between two terminals, a Fleet or a Kanban board that no wire joins yet (`talk` in `src/agents/talkWires.ts`). It is saved with the scene, is no undo step, and never puts an agent on a Fleet's team; linking the two by hand turns it solid.
- A mission's wires: its Fleet to its board, its board to its Manager. Plain solid wires; a Kanban board is a wire's end.

The Manager's team is a vertical tree, not the left-to-right flowchart of other spawn trees (`src/agents/treeLayout.ts`): the Manager on top, each agent's sub-agents under it in rows of at most four that wrap (twelve agents read as a 4×3 grid, about a screen's shape), the rows left-aligned on the parent, `GROUP_GAP` (96px) between a parent and its first row and between rows, `COLUMN_GAP` (32px) between siblings. Each wire leaves its parent's bottom middle and enters its child's top middle. A first-row child's wire goes down to the middle of the gap, across, down; a later row's runs down a riser 16px left of the rows and across in the middle of the gap above its row. No wire crosses a node. Every reflow redraws a wire whose route went astray, so a drag or a closed agent leaves the tree tidy again.

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
