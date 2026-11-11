import { describe, expect, it } from "vitest";
import { BUDGET_COLOR, budgetTitle, dotsOf, STEP_COLOR } from "./timeline";

describe("the steps' frieze", () => {
  it("spreads the steps evenly along the terminal's width, half a slot from each end", () => {
    const dots = dotsOf(
      [
        { title: "Plan", state: "fait" },
        { title: "Code", state: "en_cours" },
        { title: "Tests", state: "a_venir" },
        { title: "Revue", state: "echec" },
      ],
      400,
    );
    expect(dots.map((d) => d.x)).toEqual([50, 150, 250, 350]);
    expect(dots.map((d) => d.slot)).toEqual([100, 100, 100, 100]);
    expect(dots.map((d) => d.color)).toEqual([STEP_COLOR.fait, STEP_COLOR.en_cours, STEP_COLOR.a_venir, STEP_COLOR.echec]);
  });

  it("colors by state: done, running, to come, failed", () => {
    expect(STEP_COLOR).toEqual({ fait: "var(--dp-ok)", en_cours: "var(--dp-working)", a_venir: "var(--dp-text-3)", echec: "var(--dp-danger)" });
  });
});

it("colours a budget's bar with the identity's tokens", () => {
  expect(BUDGET_COLOR).toEqual({ ok: "var(--dp-ok)", late: "var(--dp-wait)", over: "var(--dp-danger)" });
});

it("titles a budget's bar with the time over the budget, and says how a reported agent ended", () => {
  expect(budgetTitle({ spent: 6.8, budget: 15 })).toBe("6 / 15 min");
  expect(budgetTitle({ spent: 22.4, budget: 50, report: "termine" })).toBe("Done in 22 min of 50");
  expect(budgetTitle({ spent: 22, budget: 50, report: "bloque" })).toBe("Blocked after 22 min of 50");
  expect(budgetTitle({ spent: 22, budget: 50, report: "echec" })).toBe("Failed after 22 min of 50");
});
