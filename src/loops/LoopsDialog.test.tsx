// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { requestUi } from "@/commands/uiRequests";
import { accessibleDescription, getByRole } from "@/lib/a11y";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
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
    {
      now: () => Date.now(),
      isLive: () => true,
      isAgent: () => true,
      activityOf: () => undefined,
      screenOf: () => "",
      canReceive: () => true,
      send: async (ids) => (sends.push(ids), { sent: ids.length }),
    },
    { read: async () => null, write: async () => undefined, projectsOf: async () => ({}), activeProject: () => "p1" },
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
  // Project p1 is open, its canvas w1; p2 is another project, its canvas w2.
  projectsStore.setState({ activeId: "p1", projects: [project("p1"), project("p2")] as never });
  workspacesStore.setState({ projectId: "p1", workspaces: [{ id: "w1", projectId: "p1", name: "Main", position: 0, pantheon: null, kind: "canvas", folder: null }] });
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

function project(id: string) {
  return { id, name: id, path: `C:/${id}`, position: 0, createdAt: 0, lastOpenedAt: 0, missing: false };
}

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

describe("loops target agents only, and each project has its own", () => {
  const loop = (id: string, projectId: string, targets: string[] = ["batman"]) => ({
    id,
    name: `Loop ${id}`,
    instruction: "go",
    targets,
    trigger: { kind: "interval" as const, minutes: 30 },
    maxRuns: 3,
    projectId,
  });
  const terminal = (name: string, workspaceId: string, agent: "claude" | "shell") => ({
    workspaceId,
    kind: "terminal" as const,
    payload: { title: name, name, agent, cwd: "C:/code", shell: "default" as const, command: "" },
  });
  const targets = () => [...document.querySelectorAll<HTMLElement>("[data-target]")].map((t) => t.dataset.target);
  const rows = () => [...document.querySelectorAll<HTMLElement>("[data-loop-row]")].map((r) => r.dataset.loopRow);

  beforeEach(async () => {
    await nodesStore.getState().create("console", terminal("Console", "w1", "shell"));
    await nodesStore.getState().create("thor", terminal("Thor", "w2", "claude"));
  });

  it("offers this project's agents as targets, never a plain shell nor another project's agent", async () => {
    await open();
    await act(async () => button("New loop").click());
    expect(targets()).toEqual(["batman"]);
  });

  it("lists this project's loops and those of no project, saves a loop in this project, and says what runs elsewhere", async () => {
    loopsStore.setState({ loops: [loop("mine", "p1"), loop("theirs", "p2", ["thor"]), loop("none", "")], loaded: true, runtime: {} });
    await act(async () => loopsStore.getState().start("theirs"));
    await open();
    expect(rows()).toEqual(["mine", "none"]);
    // The other project's loop still runs: the indicator counts it, and the list says where it is.
    expect(document.querySelector("[data-loops-indicator]")?.textContent).toContain("1 loop");
    expect(document.querySelector("[data-loops-elsewhere]")?.textContent).toBe("1 loop runs in other projects: Stop all, at the bottom left, stops them too.");
    // Saved here, a loop of no project becomes this project's.
    const edits = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === "Edit");
    await act(async () => edits[1].click());
    await act(async () => button("Save").click());
    await vi.waitFor(() => expect(loopsStore.getState().loops.find((l) => l.id === "none")?.projectId).toBe("p1"));
    // Another project open: its own loops only.
    await act(async () => projectsStore.setState({ activeId: "p2" }));
    expect(rows()).toEqual(["theirs"]);
    expect(document.querySelector("[data-loops-elsewhere]")).toBeNull();
    // Stop all, from the indicator, stops every project's loop.
    await act(async () => document.querySelector<HTMLButtonElement>("[data-loops-indicator] button[data-stop-all]")!.click());
    expect(loopsStore.getState().runningCount()).toBe(0);
  });

  it("shows a loop whose only target is a shell as having no agent, off, and drops the shell when it is edited", async () => {
    loopsStore.setState({ loops: [loop("old", "p1", ["console"]), loop("mixed", "p1", ["console", "batman"])], loaded: true, runtime: {} });
    await open();
    const [old, mixed] = [...document.querySelectorAll<HTMLElement>("[data-loop-row]")];
    expect(old.textContent).toContain("no agent among its targets: edit it to choose agents");
    const turnOn = (row: HTMLElement) => [...row.querySelectorAll("button")].find((b) => b.textContent === "Turn on")!;
    expect(turnOn(old).disabled).toBe(true);
    // An agent beside the shell: it runs, and only the agent is typed into.
    expect(turnOn(mixed).disabled).toBe(false);
    await act(async () => [...old.querySelectorAll("button")].find((b) => b.textContent === "Edit")!.click());
    expect(targets()).toEqual(["batman"]);
    await act(async () => button("Save").click());
    expect(document.body.textContent).toContain("Choose at least one agent");
    expect(loopsStore.getState().loops[0].targets).toEqual(["console"]);
  });
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

it("opens a loop to edit without the error a form left before it", async () => {
  loopsStore.setState({
    loops: [{ id: "a", name: "Point", instruction: "go", targets: ["batman"], trigger: { kind: "interval", minutes: 30 }, maxRuns: 3, projectId: "p1" }],
    loaded: true,
    runtime: {},
  });
  await open();
  await act(async () => button("New loop").click());
  await act(async () => button("Save").click());
  expect(field("Name").getAttribute("aria-invalid")).toBe("true");
  await act(async () => button("Cancel").click());
  await act(async () => button("Edit").click());
  // A valid loop: nothing is marked wrong in it.
  expect(field("Name").value).toBe("Point");
  expect(field("Name").hasAttribute("aria-invalid")).toBe(false);
  expect(document.body.textContent).not.toContain("Give the loop a name");
});

it("names the indicator by what it shows first", async () => {
  loopsStore.setState({ loops: [], loaded: true, runtime: { a: { running: true, runs: 2, startedAt: 0, stoppedBecause: null } as never } });
  await act(async () => undefined);
  const indicator = getByRole(document.body, "button", "1 loop · 2 runs, open the loops");
  expect(indicator.textContent).toBe("1 loop · 2 runs");
});

it("deletes a loop at once and takes it back, turned off and at its place, from an Undo in its row (audit P2 #42)", async () => {
  toast.mockClear();
  const loop = (id: string, name: string) => ({ id, name, instruction: "go", targets: ["batman"], trigger: { kind: "interval" as const, minutes: 30 }, maxRuns: 3, projectId: "p1" });
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
