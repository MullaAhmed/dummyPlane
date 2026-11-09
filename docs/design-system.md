# Design system

Short rules for dummyPlane UI. Source of truth: `src/theme/tokens.css`.

## Palettes

Three palettes. Each follows 60/30/10: canvas, text and surfaces, accent.

- `calm`: light. Default for daylight work.
- `electric`: dark blue. Accent is lime.
- `expressive`: dark. Default when no palette is set (`:root`).

Every palette defines the same token names. Never add a token to one palette only.

## Token roles

Surfaces, from back to front:

- `--dp-canvas`: app background. Dot grid sits on it.
- `--dp-surface`: panels, dialogs, menus. Base for cards.
- `--dp-card`: nested cards and rows inside a surface.
- `--dp-field`: input fill.
- `--dp-hover`: hover and subtle fill.
- `--dp-glass`, `--dp-glass-strong`: translucent layers. Strong glass carries text.

Lines and shadows:

- `--dp-line`: borders and dividers.
- `--dp-shadow`, `--dp-float-shadow`: elevation for dialogs and floating bars.
- `--dp-glass-hi`, `--dp-glass-edge`: inner highlight and edge ring of glass.
- `--dp-scrim`: veil behind dialogs and sheets. Per palette.

Text:

- `--dp-text`: primary text. Titles, values, active labels.
- `--dp-text-2`: secondary text. Labels, helper text, menu items.
- `--dp-text-3`: tertiary text. Hints, idle state, metadata.
- `--dp-secondary`: secondary accent for chrome and links in some palettes.

Accent:

- `--dp-accent`: fills, focus ring, primary buttons, selection.
- `--dp-accent-ink`: accent used as text. Use it when the accent is too pale on the canvas.
- `--dp-accent-soft`: tinted background for selected rows.
- `--dp-on-accent`: text drawn on an accent fill.

Status:

- `--dp-wait`: waiting or attention state.
- `--dp-ok`: success or live state.
- `--dp-danger`: errors and destructive actions.

Terminals:

- `--dp-terminal`, `--dp-terminal-head`: terminal body and header.

## Contrast

Text tokens meet WCAG AA on `surface`, `card` and `canvas`.

- Body text, `text-2` and `text-3`: at least 4.5:1.
- Large text and UI parts: at least 3:1.
- Status tokens and `accent-ink`: at least 4.5:1 on each surface.

Check any new pair with a contrast tool before use.

## Radius

Use the scale. Never hard-code a pixel radius.

- `rounded-sm`: chips, small tags.
- `rounded-md`: inputs, small buttons.
- `rounded-lg` (`--radius-lg`, 12px): buttons, menus, popovers, toasts.
- `rounded-xl` (`--radius-xl`, about 17px): dialogs.

## Type

- Font: Inter Variable for UI, JetBrains Mono for code and terminals.
- Section labels: `.dp-label`. 11px, medium, uppercase, `text-dp-text-2`.
- Body: 13px to 14px. Keep line length short in menus.
- Headings: weight 600 at most. Avoid 700 for chrome.

## Spacing

- Use Tailwind spacing steps (4px grid).
- Menu items: 6px to 8px vertical padding.
- Dialog body: 16px to 20px padding.

## Heights

Controls share one height scale:

- `sm`: `h-7`. Dense toolbars and menus.
- default: `h-8`. Buttons and inputs.
- `lg`: `h-9`. Primary actions in dialogs.

## Motion

Tokens live in `tokens.css`:

- `--dp-ease-out: cubic-bezier(.23,1,.32,1)`. Default for every entrance and press.
- `--dp-dur-fast: 150ms`. Presses, hovers, tooltips.
- `--dp-dur: 200ms`. Popovers, menus, dialogs.

Rules:

- Keep UI motion under 300ms.
- Never animate keyboard-driven actions.
- Never use `ease-in` on UI elements.
- Never start scale animations from `scale(0)`. Use `0.9` or higher with opacity.
- Popovers scale from their trigger. Dialogs stay centered.
- Use transitions for interactive state. Keyframes only for one-shot effects.
- List transitioned properties. Never use `transition-all`.
- Under `prefers-reduced-motion`, drop movement. Keep colour and opacity cues.

## Interaction

- Hover: subtle fill from `--dp-hover`. Never change layout.
- Focus: `focus-visible:ring-2 ring-dp-accent/50`. Show on keyboard focus only.
- Press: buttons scale to `0.97` on `:active`.
- Disabled: `opacity-50` and `pointer-events-none`.
- Touch devices: gate hover effects behind `(hover: hover) and (pointer: fine)`.

## Surfaces and layers

- Menus, popovers, selects, toasts: dense glass, radius `lg`.
- Dialogs: dense glass, radius `xl`, veil from `--dp-scrim`.
- Transparency off: glass becomes solid `surface`. Respect `prefers-reduced-transparency`.

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
