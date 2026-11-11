// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { requestUi } from "@/commands/uiRequests";
import { accessibleDescription, getByRole } from "@/lib/a11y";
import { nodesStore } from "@/store/nodes";
import { LoopsDialog } from "./LoopsDialog";
import { LoopsIndicator } from "./LoopsIndicator";
import { loopsStore } from "./live";

const sends: string[][] = [];
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./live", async () => {
  const { useStore } = await import("zustand");
  const { createLoopsStore } = await import("./store");
  const store = createLoopsStore(
    { now: () => Date.now(), isLive: () => true, activityOf: () => undefined, screenOf: () => "", canReceive: () => true, send: async (ids) => (sends.push(ids), { sent: ids.length }) },
    { read: async () => null, write: async () => undefined },
    { setInterval: () => 0 as never, clearInterval: () => undefined },
  );
  return { loopsStore: store, useLoops: (selector: (s: never) => unknown) => useStore(store, selector as never) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mockIPC(() => null);
  sends.length = 0;
  loopsStore.setState({ loops: [], loaded: true, runtime: {} });
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <LoopsDialog />
        <LoopsIndicator />
      </>,
    ),
  );
});
afterEach(async () => {
  loopsStore.getState().stopAll();
  await act(async () => root.unmount());
  document.body.replaceChildren();
  clearMocks();
});

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
/** A field found as a screen reader finds it: by its role and the name its visible label gives it. */
const field = (name: string, role = "textbox") => getByRole(document.body, role, name) as HTMLInputElement | HTMLTextAreaElement;
const RUNS = "At most runs";
const DURATION = "At most minutes";
const write = async (name: string, value: string, role = "textbox") =>
  act(async () => {
    const el = field(name, role);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const open = async () => act(async () => requestUi({ kind: "loops" }));

it("opens on the list, empty at first, with the spending warning in the description", async () => {
  expect(document.body.textContent).not.toContain("New loop");
  await open();
  expect(document.body.textContent).toContain("No loop yet");
  expect(document.body.textContent).toContain("Each run spends real usage");
});

it("fills the form from a template and starts nothing", async () => {
  await open();
  await act(async () => button("New loop").click());
  await act(async () => button("Relaunch").click());
  expect(field("Instruction sent").value).toContain("Continue");
  expect(field(RUNS, "spinbutton").value).toBe("5");
  expect(loopsStore.getState().loops).toEqual([]);
  expect(loopsStore.getState().runningCount()).toBe(0);
  expect(sends).toEqual([]);
});

it("refuses a loop without an end and says so", async () => {
  await open();
  await act(async () => button("New loop").click());
  await write("Name", "Point");
  await write("Instruction sent", "va");
  await act(async () => document.querySelector<HTMLInputElement>('[data-target="batman"]')!.click());
  await act(async () => button("Save").click());
  expect(document.body.textContent).toContain("Set an end: a number of runs or a duration");
  expect(loopsStore.getState().loops).toEqual([]);
});

it("saves a bounded loop, lists it off with its end, turns it on, shows the runs and stops all from the indicator", async () => {
  await open();
  await act(async () => button("New loop").click());
  await write("Name", "Point");
  await write("Instruction sent", "va");
  await act(async () => document.querySelector<HTMLInputElement>('[data-target="batman"]')!.click());
  await write(RUNS, "4", "spinbutton");
  await act(async () => button("Save").click());
  await vi.waitFor(() => expect(loopsStore.getState().loops).toHaveLength(1));
  expect(document.body.textContent).toContain("Point");
  expect(document.body.textContent).toContain("up to 4 runs");
  expect(document.body.textContent).toContain("off");
  // Turned on only by a click.
  expect(loopsStore.getState().runningCount()).toBe(0);
  await act(async () => button("Turn on").click());
  expect(loopsStore.getState().runningCount()).toBe(1);
  expect(document.body.textContent).toContain("run 0 / 4");
  expect(document.body.textContent).toContain("1 loop · 0 runs");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-loops-indicator] button[data-stop-all]')!.click());
  expect(loopsStore.getState().runningCount()).toBe(0);
  expect(document.querySelector("[data-loops-indicator]")).toBeNull();
});

it("shows no indicator while nothing runs", () => {
  expect(document.querySelector("[data-loops-indicator]")).toBeNull();
});

it("labels every field visibly and shows each number with its unit", async () => {
  await open();
  await act(async () => button("New loop").click());
  for (const name of ["Name", "Instruction sent"]) {
    const el = field(name);
    // A visible label, not a placeholder that disappears once the field is filled.
    expect(el.labels?.[0]?.textContent).toBe(name);
    expect(el.getAttribute("placeholder")).toBeNull();
  }
  // The interval reads "Every 30 minutes": the words around the number name it.
  const interval = field("Every minutes", "spinbutton");
  expect(interval.value).toBe("30");
  expect(interval.parentElement!.textContent).toBe("Everyminutes");
  // The two ends of the loop, told apart by their units.
  await act(async () => button("Relaunch").click());
  expect(field(RUNS, "spinbutton").value).toBe("5");
  expect(field(RUNS, "spinbutton").parentElement!.textContent).toContain("runs");
  expect(field(DURATION, "spinbutton").parentElement!.textContent).toContain("minutes");
  await act(async () => getByRole(document.body, "radio", "Output contains a text").click());
  expect(field("Text to spot").labels?.[0]?.textContent).toBe("Text to spot");
});

it("ties an error to the field it is about", async () => {
  await open();
  await act(async () => button("New loop").click());
  await act(async () => button("Save").click());
  const name = field("Name");
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(accessibleDescription(name)).toBe("Give the loop a name");
  expect(field("Instruction sent").hasAttribute("aria-invalid")).toBe(false);
  // Fixing it clears the mark.
  await write("Name", "Point");
  expect(name.hasAttribute("aria-invalid")).toBe(false);

  await write("Instruction sent", "va");
  await act(async () => button("Save").click());
  expect(accessibleDescription(getByRole(document.body, "group", "Agents"))).toBe("Choose at least one agent");

  await act(async () => document.querySelector<HTMLInputElement>('[data-target="batman"]')!.click());
  await act(async () => button("Save").click());
  // No end set: the error describes the group of the two ends.
  expect(accessibleDescription(getByRole(document.body, "group", "End of the loop (at least one)"))).toBe("Set an end: a number of runs or a duration");

  await write(RUNS, "0", "spinbutton");
  await act(async () => button("Save").click());
  expect(field(RUNS, "spinbutton").getAttribute("aria-invalid")).toBe("true");
  expect(accessibleDescription(field(RUNS, "spinbutton"))).toBe("The number of runs is 1 to 1000");
  expect(field(DURATION, "spinbutton").hasAttribute("aria-invalid")).toBe(false);
});

it("names the indicator by what it shows first", async () => {
  loopsStore.setState({ loops: [], loaded: true, runtime: { a: { running: true, runs: 2, startedAt: 0, stoppedBecause: null } as never } });
  await act(async () => undefined);
  const indicator = getByRole(document.body, "button", "1 loop · 2 runs, open the loops");
  expect(indicator.textContent).toBe("1 loop · 2 runs");
});

it("deletes a loop at once and takes it back, turned off and at its place, from an Undo in its row (audit P2 #42)", async () => {
  toast.mockClear();
  const loop = (id: string, name: string) => ({ id, name, instruction: "go", targets: ["batman"], trigger: { kind: "interval" as const, minutes: 30 }, maxRuns: 3 });
  loopsStore.setState({ loops: [loop("a", "Point"), loop("b", "Tests")], loaded: true, runtime: {} });
  await open();
  await act(async () => loopsStore.getState().start("a"));
  expect(loopsStore.getState().runningCount()).toBe(1);
  const rows = () => [...document.querySelectorAll<HTMLElement>("[data-loop-row]")].map((r) => r.dataset.loopRow);
  const remove = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === "Delete")[0];
  await act(async () => remove.click());
  await vi.waitFor(() => expect(loopsStore.getState().loops.map((l) => l.id)).toEqual(["b"]));
  expect(loopsStore.getState().runningCount()).toBe(0);
  // Not a toast, which the modal dialog keeps out of reach: the Undo stands where the loop was, and has the keyboard.
  expect(toast).not.toHaveBeenCalled();
  expect(rows()).toEqual(["deleted", "b"]);
  const undo = button("Undo");
  expect(document.activeElement).toBe(undo);
  expect(accessibleDescription(undo)).toBe("Loop “Point” deleted");
  await act(async () => undo.click());
  await vi.waitFor(() => expect(loopsStore.getState().loops.map((l) => l.id)).toEqual(["a", "b"]));
  expect(rows()).toEqual(["a", "b"]);
  expect(loopsStore.getState().runningCount()).toBe(0);
  // The keyboard lands on the loop taken back, not on the page.
  expect(document.activeElement?.closest("[data-loop-row]")?.getAttribute("data-loop-row")).toBe("a");
});
