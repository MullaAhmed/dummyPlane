# dummyPlane: unslop direction

The one direction every agent follows when it unslops a dummyPlane screen (skill: `.claude/skills/unslop`, by Damir Sokolovsky, CC BY 4.0). Do not invent another.

- **Product.** A desktop canvas where a developer lays out, runs and directs a fleet of AI coding agents (Claude, Codex, shells) as live terminals, with orchestrators that hand them work.
- **Character.** Exact, calm under load, quietly alive.
- **World.** A drafting table at night: paper and ink. Each palette is exactly two hues, a ground and an ink (the user's rule). Every surface, line and text role is a step between them, and the ink doubles as the accent.
- **Moments.** The terminals' own content, the live text of the agents at work, and the wires between an orchestrator and its agents, where the messages travel. Those are where colour and motion may live. The chrome around them stays quiet.
- **Signature.** The live status dot: one small solid dot per agent (working, waiting, idle, error), in the same size everywhere an agent appears, and once per node: an AI agent's foot status line (under its terminal, next to where it asks its questions), a shell or custom terminal's header, the minimized card, the fleet panel. An orchestrator shows two: its session in the header, its mission in the foot. It is the only thing that may animate on its own, and only while an agent waits for the user.

## Audit (2026-11-09) and what each finding becomes

- `.dp-ambient`: three radial colour washes behind the app → a flat ground colour.
- `.dp-glass` and `.dp-glass-strong`: blurred glass with a white inner highlight → a plain raised surface with a hairline (ink at 6–10%). Floating things keep only a small, soft, neutral shadow. The Transparency setting was removed (the user: "glass/transparent effect is very shitty"): every surface is opaque and nothing uses backdrop blur.
- `--dp-glow-*`, `WAITING_GLOW`, glows on wires and pills → remove. Depth comes from surface steps and hairlines. A waiting terminal shows it through its status dot and a hairline in the wait colour, not a halo.
- Terminal frames coloured with each agent's tint (the pink frame) → a neutral hairline frame, with a 1px ink frame when selected. An agent's identity is its icon and status dot in the header, not a coloured border.
- `.dp-label` and other `uppercase` + `tracking-*` labels → sentence case, no tracking, 12px, secondary text role.
- `font-semibold`/`font-bold` → 400 and 500, with 600 only for rare emphasis.
- Arbitrary `-[Npx]` values → the 4px scale (4, 8, 12, 16, 20, 24, 32…). Equal things get equal sizes.
- `animate-pulse`/`ping` on things that are not live → static. `transition-all` and `hover:scale` → named transitions, a colour or surface step on hover, a 0.97 scale on press.
- Radius: controls 8, cards 12, panels and windows 14–16, with nested radius math. No pills except counters and dots.
- Copy: no trailing periods on labels and buttons, no exclamation marks, short labels.
