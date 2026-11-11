import { describe, expect, it } from "vitest";
import { AGENT_IDS } from "@/ipc/pty";
import { blend, contrast } from "@/theme/colorMath";
import { cssBlock, readSource } from "@/theme/cssBlocks";
import { AGENT_ORDER, AGENTS, AGENTS_WITHOUT_OPTIONS, agentInk, defaultAgent } from "./catalog";

describe("agent catalog", () => {
  it("describes every agent, in menu order", () => {
    expect(AGENT_ORDER).toEqual([...AGENT_IDS]);
    for (const id of AGENT_IDS) expect(AGENTS[id].label).not.toBe("");
  });

  it("picks Claude, then Codex, then Shell as the default agent", () => {
    const info = (...ids: string[]) =>
      AGENT_IDS.map((id) => ({ id, available: ids.includes(id) || id === "shell" || id === "custom" }));
    expect(defaultAgent(info("claude", "codex"))).toBe("claude");
    expect(defaultAgent(info("codex"))).toBe("codex");
    expect(defaultAgent(info())).toBe("shell");
    expect(defaultAgent([])).toBe("shell");
  });
});

it("lists the agents that start without options, in catalog order", () => {
  expect(AGENTS_WITHOUT_OPTIONS).toEqual(["claude", "codex", "gemini", "qwen", "cursor", "opencode", "aider", "shell"]);
});

it("draws an agent's icon in its tint pulled toward the theme's text, readable on light and dark", () => {
  // Codex's indigo would vanish on Argile's dark: 65 % of the tint, the rest the theme's text.
  expect(agentInk(AGENTS.codex.tint)).toBe(`color-mix(in srgb, ${AGENTS.codex.tint} 65%, var(--dp-text))`);
  // Ollama's cream on Ivoire's white: pulled further toward the text.
  expect(agentInk(AGENTS.ollama.tint)).toBe(`color-mix(in srgb, ${AGENTS.ollama.tint} 40%, var(--dp-text))`);
});

describe("an agent's icon carries it at 3:1 on every ground it sits on, in every palette (WCAG 1.4.11, P2 #21)", () => {
  const tokens = readSource("theme/tokens.css");
  const PALETTES = {
    calm: ':root[data-palette="calm"]',
    electric: ':root[data-palette="electric"]',
    expressive: ':root, :root[data-palette="expressive"]',
  };
  /** The ink agentInk asks the browser for: its share of the tint, over the palette's text. */
  const inkOf = (tint: string, text: string) => {
    const share = /(\d+)%/.exec(agentInk(tint))![1];
    return blend(text, tint, Number(share) / 100);
  };

  it.each(Object.entries(PALETTES))("%s", (_, selector) => {
    const t = cssBlock(tokens, selector);
    for (const [id, { tint }] of Object.entries(AGENTS)) {
      const ink = inkOf(tint, t["--dp-text"]);
      const grounds = {
        surface: t["--dp-surface"],
        card: t["--dp-card"],
        head: t["--dp-terminal-head"],
        // The agent menu's and Go to's chip: the tint at 18 % over the surface.
        chip: blend(t["--dp-surface"], tint, 0.18),
      };
      for (const [ground, color] of Object.entries(grounds)) expect(contrast(ink, color), `${id} on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("measures what the audit measured: Cursor 2.45:1 and Ollama 2.08:1 on calm's surface at 65 %", () => {
    const calm = cssBlock(tokens, PALETTES.calm);
    expect(contrast(blend(calm["--dp-text"], AGENTS.cursor.tint, 0.65), calm["--dp-surface"])).toBeCloseTo(2.45, 2);
    expect(contrast(blend(calm["--dp-text"], AGENTS.ollama.tint, 0.65), calm["--dp-surface"])).toBeCloseTo(2.08, 2);
  });
});
