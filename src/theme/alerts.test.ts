import { describe, expect, it } from "vitest";
import { readSource } from "./cssBlocks";

/**
 * Sonner injects its stylesheet unlayered, later than index.css in a release build: it wins over every Tailwind
 * utility, and over index.css on equal specificity. These tests read its real stylesheet and hold index.css above it.
 */
const sonner = readSource("../node_modules/sonner/dist/styles.css");
const index = readSource("index.css");

interface Rule {
  selector: string;
  body: string;
}

/** The style rules of a stylesheet, those inside @media included; @keyframes skipped. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let start = 0;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      stack.push(text.slice(start, i).trim());
      depth++;
      start = i + 1;
    } else if (text[i] === "}") {
      const selector = stack.pop() ?? "";
      depth--;
      const body = text.slice(start, i);
      if (!selector.startsWith("@") && !stack.some((s) => s.startsWith("@keyframes")) && !/^(?:from|to|\d+%)$/.test(selector)) {
        out.push({ selector, body });
      }
      start = i + 1;
    }
  }
  return out;
}

/** Splits a selector list on its top-level commas. */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(list.slice(from).trim());
  return out;
}

/** A selector's (ids, classes and attributes and pseudo-classes, elements), `:is()` counting its strongest argument. */
function specificity(selector: string): [number, number, number] {
  let rest = selector;
  let extra: [number, number, number] = [0, 0, 0];
  rest = rest.replace(/:(?:is|not|where)\(((?:[^()]|\([^()]*\))*)\)/g, (whole, args: string) => {
    if (whole.startsWith(":where")) return "";
    const ranked = selectors(args).map(specificity).sort(compare);
    const best = ranked[ranked.length - 1];
    extra = [extra[0] + best[0], extra[1] + best[1], extra[2] + best[2]];
    return "";
  });
  const b = (rest.match(/\[[^\]]*\]|\.[\w-]+|:(?!:)[\w-]+/g) ?? []).length;
  const a = (rest.match(/#[\w-]+/g) ?? []).length;
  const c = (rest.replace(/\[[^\]]*\]/g, "").match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return [a + extra[0], b + extra[1], c + extra[2]];
}

function compare(x: [number, number, number], y: [number, number, number]): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** The properties a rule body sets. */
const properties = (body: string) => body.split(";").map((d) => d.split(":")[0].trim()).filter(Boolean);

/** The shorthand index.css rolls back for a longhand sonner sets. */
const SHORTHAND: Record<string, string> = {
  "padding-left": "padding",
  "padding-right": "padding",
  "margin-left": "margin",
  "margin-right": "margin",
  "border-color": "border",
};

const PARTS = ["data-title", "data-description", "data-button", "data-cancel", "data-action"];
/** The last compound of a selector: the element it styles. */
const subject = (selector: string) => {
  const compounds = selector.split(/[\s>+~]+/);
  return compounds[compounds.length - 1];
};

describe("a toast's title, description and buttons take the app's classes (Alerts)", () => {
  const handBack = rules(index).find((r) => r.body.includes("revert-layer") && r.selector.includes("data-sonner-toast"));

  it("rolls each property sonner sets on them back to the utilities' layer, but opacity, which hides the toasts stacked behind", () => {
    expect(handBack, "index.css hands the toast's parts back to the utilities").toBeDefined();
    const rolled = new Set(properties(handBack!.body));
    for (const property of rolled) expect(handBack!.body).toMatch(new RegExp(`${property}:\\s*revert-layer;`));
    const parts = handBack!.selector;
    for (const part of ["data-title", "data-description", "data-button"]) expect(parts).toContain(`[${part}]`);
    let seen = 0;
    for (const rule of rules(sonner)) {
      for (const sel of selectors(rule.selector)) {
        if (!PARTS.some((part) => subject(sel).includes(`[${part}`))) continue;
        for (const property of properties(rule.body)) {
          if (property === "opacity" || property.startsWith("--")) continue;
          seen++;
          expect(rolled.has(SHORTHAND[property] ?? property), `sonner sets ${property} in ${sel}`).toBe(true);
        }
      }
    }
    expect(seen, "sonner's stylesheet was read").toBeGreaterThan(20);
  });

  it("out-ranks every sonner rule on those parts, the dark cancel button's five attributes included", () => {
    const ours = specificity(handBack!.selector);
    let strongest: [number, number, number] = [0, 0, 0];
    for (const rule of rules(sonner)) {
      for (const sel of selectors(rule.selector)) {
        if (PARTS.some((part) => subject(sel).includes(`[${part}`)) && compare(specificity(sel), strongest) > 0) strongest = specificity(sel);
      }
    }
    expect(strongest).toEqual([0, 5, 0]);
    expect(compare(ours, strongest), `${ours} over ${strongest}`).toBeGreaterThan(0);
  });

  it("writes the toasts in the app's font, over sonner's system font", () => {
    const font = rules(index).find((r) => /font-family:\s*var\(--font-sans\)/.test(r.body) && r.selector.includes("data-sonner-toaster"));
    expect(font, "index.css sets the toaster's font").toBeDefined();
    const theirs = rules(sonner).find((r) => r.selector === "[data-sonner-toaster]" && r.body.includes("font-family"))!;
    expect(compare(specificity(font!.selector), specificity(theirs.selector))).toBeGreaterThan(0);
  });

  it("moves the toasts on the tokens, under 300 ms, with no box-shadow in the list, and leaves a swipe to the pointer", () => {
    const motion = rules(index).find((r) => r.selector.includes("[data-sonner-toast]") && r.body.includes("transition-duration"))!;
    expect(motion.selector).toContain(':not([data-swiping="true"])');
    expect(motion.body).toMatch(/transition-duration:\s*var\(--dp-dur\);/);
    expect(motion.body).toMatch(/transition-timing-function:\s*var\(--dp-ease-out\);/);
    expect(motion.body).not.toMatch(/box-shadow/);
    const list = /transition-property:\s*([^;]*);/.exec(motion.body)![1].split(",").map((p) => p.trim());
    expect(list).toEqual(["transform", "opacity", "height"]);
    // Above sonner's own `[data-sonner-toast]` transition (400 ms, box-shadow named).
    expect(compare(specificity(motion.selector), specificity("[data-sonner-toast]"))).toBeGreaterThan(0);
  });
});

describe("the alerts' rules are written down (docs/design-system.md, Alerts)", () => {
  const doc = readSource("../docs/design-system.md");

  it("keeps an Alerts part that names the toast, the error toast, the screens and the Windows notification", () => {
    const at = doc.indexOf("## Alerts");
    expect(at).toBeGreaterThan(0);
    const part = doc.slice(at, doc.indexOf("\n## ", at + 1));
    for (const word of ["toastError", "TOAST_TONES", "--dp-danger", "--dp-text-2", "outline", "· Done", "· Waiting", "folder picker"]) {
      expect(part, word).toContain(word);
    }
  });
});
