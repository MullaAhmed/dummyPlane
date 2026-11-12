import { expect, it } from "vitest";
import { labelFleets } from "./fleetLabels";

const numbered = (name: string, rank: number) => `${name} #${rank}`;

it("tells fleets that share a name apart by their rank, in canvas order", () => {
  expect(labelFleets(["Fleet", "Fleet", "Fleet"], numbered)).toEqual(["Fleet #1", "Fleet #2", "Fleet #3"]);
});

it("leaves a name nobody else has as it is, and ranks each shared name on its own", () => {
  expect(labelFleets(["Atlas", "Fleet", "Fleet", "Atlas", "Zeus"], numbered)).toEqual(["Atlas #1", "Fleet #1", "Fleet #2", "Atlas #2", "Zeus"]);
  expect(labelFleets(["Fleet"], numbered)).toEqual(["Fleet"]);
  expect(labelFleets([], numbered)).toEqual([]);
});
