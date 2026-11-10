// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, expect, it } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import { StatusDot, type DotState } from "./StatusDot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STATES: DotState[] = ["working", "waiting", "idle", "done", "stopped", "error"];
const looks = {} as Record<DotState, string>;

beforeAll(async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        {STATES.map((state) => (
          <StatusDot key={state} state={state} />
        ))}
      </>,
    ),
  );
  for (const state of STATES) looks[state] = host.querySelector(`[data-status="${state}"]`)!.getAttribute("class")!;
  await act(async () => root.unmount());
  host.remove();
});

it("is one 8px dot whose shape tells the state apart, not its colour alone: solid alive, a ring at rest, a square on error", () => {
  for (const state of STATES) expect(looks[state], state).toContain("size-2");
  for (const state of ["working", "waiting"] as const) expect(looks[state], state).toMatch(/\bbg-dp-/);
  for (const state of ["idle", "done", "stopped"] as const) expect(looks[state], state).toContain("border-[1.5px]");
  expect(looks.error).not.toContain("rounded-full");
  expect(new Set(STATES.map((s) => looks[s])).size).toBe(STATES.length);
});

it("moves only while an agent waits for the user, and never with reduced motion", () => {
  expect(looks.waiting).toContain("motion-reduce:animate-none");
  for (const state of STATES.filter((s) => s !== "waiting")) expect(looks[state], state).not.toMatch(/animate-/);
});

it("is the status of the terminal header, the minimized card and the fleet panel alike", () => {
  expect(readSource("nodes/terminal/StatusPill.tsx")).toContain("<StatusDot");
  for (const file of ["nodes/terminal/TerminalHeader.tsx", "nodes/terminal/MinimizedCard.tsx", "fleet/AgentRow.tsx"]) {
    expect(readSource(file), file).toContain("<StatusPill");
  }
});
