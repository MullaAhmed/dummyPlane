import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppError } from "@/ipc/invoke";
import { InlineProblem } from "./InlineProblem";

/** The problem's lines, in order, each with its classes. */
function lines(html: string): { text: string; classes: string }[] {
  return [...html.matchAll(/<p class="([^"]*)">([^<]*)<\/p>/g)].map(([, classes, text]) => ({ text, classes }));
}

describe("a problem shown inside a panel: the error toast's parts (docs/design-system.md, Alerts)", () => {
  it("says what failed in the app's words, then what to do, then the error's own first line, quieter, in the code font", () => {
    const html = renderToStaticMarkup(
      <InlineProblem title="Could not read the history" next="Refresh to read it again" error={new AppError("io", "fatal: bad object HEAD\nmore (os error 5)")} />,
    );
    const [title, next, detail] = lines(html);
    expect(title).toEqual({ text: "Could not read the history", classes: "text-(length:--text-ui) font-medium text-dp-text" });
    expect(next).toEqual({ text: "Refresh to read it again", classes: "text-xs text-dp-text-2" });
    expect(detail.text).toBe("fatal: bad object HEAD");
    expect(detail.classes).toMatch(/\bfont-mono\b/);
    expect(detail.classes).toMatch(/\btext-dp-text-3\b/);
    expect(html).not.toContain("AppError");
    expect(html).not.toContain("os error");
  });

  it("shows the title alone when the app knows no step and holds no error", () => {
    const html = renderToStaticMarkup(<InlineProblem title="Stopped: none of its agents is running" />);
    expect(lines(html).map((line) => line.text)).toEqual(["Stopped: none of its agents is running"]);
  });

  it("offers one way on at most, the toasts' outline button, under the lines", () => {
    const html = renderToStaticMarkup(<InlineProblem title="Could not load this workspace" action={{ label: "Try again", onClick: () => undefined }} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*data-variant="outline"[^>]*data-size="sm"[^>]*>Try again<\/button>/);
    expect(html.indexOf("Could not load this workspace")).toBeLessThan(html.indexOf("Try again"));
  });

  it("speaks as an alert, unless a live region around it already does; its tone is a shape and a colour, never the colour alone", () => {
    expect(renderToStaticMarkup(<InlineProblem title="Could not commit" />)).toMatch(/^<div role="alert" data-problem="error"/);
    expect(renderToStaticMarkup(<InlineProblem title="Could not commit" role={null} />)).not.toContain("role=");
    const error = renderToStaticMarkup(<InlineProblem title="Could not commit" />);
    expect(error).toMatch(/<svg[^>]*lucide-octagon-x[^>]*text-dp-danger/);
    const warning = renderToStaticMarkup(<InlineProblem title="Off: none of its targets is an agent" tone="warning" />);
    expect(warning).toMatch(/<svg[^>]*lucide-triangle-alert[^>]*text-dp-wait/);
    expect(warning).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
