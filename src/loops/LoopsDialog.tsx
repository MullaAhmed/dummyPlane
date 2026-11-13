import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toastError } from "@/lib/errorToast";
import { OptionItem, OptionList } from "@/components/OptionList";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUiRequest } from "@/commands/uiRequests";
import { messages, useMessages } from "@/i18n";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { nodeNameOf, useNodes, type NodeRecord } from "@/store/nodes";
import { useProjects } from "@/store/projects";
import { useWorkspaces } from "@/store/workspaces";
import { useLoops, loopsStore } from "./live";
import { loopsMessages } from "./messages";
import { LOOP_TEMPLATES, loopsOf, validateLoop, type LoopDef, type LoopError, type LoopTrigger } from "./model";

interface Form {
  /** The loop being edited; null for a new one. */
  id: string | null;
  name: string;
  instruction: string;
  targets: string[];
  trigger: LoopTrigger["kind"];
  minutes: string;
  text: string;
  maxRuns: string;
  maxMinutes: string;
}

/** A loop's own actions: quiet until hovered, as a profile's in the accounts dialog; removing reads in the danger tone there too. */
const ROW_BUTTON = "font-normal text-dp-text-2 hover:text-dp-text";
const ROW_REMOVE = "font-normal text-dp-danger hover:bg-dp-danger/10 hover:text-dp-danger";

/**
 * A field's label: plain `<label>`, as the agents' rows below, in the section label's style. The Label primitive's
 * own text-sm (a utility) would win over .dp-label (a component class), and .dp-label is never resized.
 */
const LABEL = "dp-label";
/** The words around a number ("Every 30 minutes"): one sentence, in the secondary text role. */
const AROUND = "shrink-0 text-sm font-normal text-dp-text-2";
const NUMBER = "w-24 tabular-nums";

/** The `data-loop-row` of the row that stands where a deleted loop was. */
const DELETED_ROW = "deleted";

/** The rows, with the deleted loop's row back at its place. */
function withDeleted(row: ReactNode, index: number, rows: ReactNode[]): ReactNode[] {
  return row ? [...rows.slice(0, index), row, ...rows.slice(index)] : rows;
}

const BLANK: Form = { id: null, name: "", instruction: "", targets: [], trigger: "interval", minutes: "30", text: "", maxRuns: "", maxMinutes: "" };

const number = (value: string) => (value.trim() === "" ? undefined : Number(value));

/** A plain shell terminal: never a loop's target, its text would run as a command. */
const isShell = (node: NodeRecord | undefined) => node?.kind === "terminal" && node.payload.agent === "shell";

/**
 * The form of a loop. Its targets lose a shell and an agent of another project (a loop saved before loops were
 * agents only, and per project); one not on screen (a canvas not opened yet) stays, its project unknown here.
 */
function formOf(loop: LoopDef, nodes: Record<string, NodeRecord>, inProject: (workspaceId: string) => boolean): Form {
  const { trigger } = loop;
  return {
    id: loop.id,
    name: loop.name,
    instruction: loop.instruction,
    targets: loop.targets.filter((id) => !isShell(nodes[id]) && (nodes[id] === undefined || inProject(nodes[id].workspaceId))),
    trigger: trigger.kind,
    minutes: trigger.kind === "interval" ? String(trigger.minutes) : "30",
    text: trigger.kind === "output" ? trigger.text : "",
    maxRuns: loop.maxRuns === undefined ? "" : String(loop.maxRuns),
    maxMinutes: loop.maxMinutes === undefined ? "" : String(loop.maxMinutes),
  };
}

function triggerOf(form: Form): LoopTrigger {
  if (form.trigger === "idle") return { kind: "idle" };
  if (form.trigger === "output") return { kind: "output", text: form.text };
  return { kind: "interval", minutes: Number(form.minutes) };
}

/**
 * The open project's loops: the list and the form, opened by the palette or the indicator. A loop targets the
 * project's agents only, never a plain shell; a loop placed in no project shows in each until it is saved in one.
 */
export function LoopsDialog() {
  const t = useMessages(loopsMessages).dialog;
  const formId = useId();
  const errorId = `${formId}-error`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<LoopError | null>(null);
  // The loop just deleted: its row gives way to an Undo in its place, until the dialog closes. Not a toast: the
  // modal dialog keeps the pointer and the keyboard off everything outside it, a toast's button included.
  // `index`: its place in every project's list, where Undo puts it back; `at`: its row among this project's.
  const [deleted, setDeleted] = useState<{ loop: LoopDef; index: number; at: number } | null>(null);
  // The row the keyboard goes to next: the Undo that replaced a deleted loop, or the loop taken back.
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const all = useLoops((s) => s.loops);
  const runtime = useLoops((s) => s.runtime);
  const nodes = useNodes((s) => s.nodes);
  const projectId = useProjects((s) => s.activeId);
  const projects = useProjects((s) => s.projects);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const inProject = (workspaceId: string) => workspaces.some((w) => w.id === workspaceId);
  const loops = loopsOf(all, projectId, projects.map((p) => p.id));
  // Running in another project: the indicator counts them, and its Stop all stops them too.
  const elsewhere = all.filter((l) => runtime[l.id]?.running && !loops.includes(l)).length;
  // The agents of the open project: a plain shell would run the instruction as a command.
  const terminals = Object.entries(nodes).filter(([, node]) => node.kind === "terminal" && !isShell(node) && inProject(node.workspaceId));
  useUiRequest("loops", () => {
    setForm(null);
    setDeleted(null);
    setOpen(true);
    void loopsStore.getState().load();
    return true;
  });

  const change = (patch: Partial<Form>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setError(null);
  };

  const fromTemplate = (id: (typeof LOOP_TEMPLATES)[number]["id"]) => {
    const template = LOOP_TEMPLATES.find((tpl) => tpl.id === id)!;
    const { trigger } = template.draft;
    change({
      name: t.template[id],
      instruction: t.templateInstruction[id],
      trigger: trigger.kind,
      minutes: trigger.kind === "interval" ? String(trigger.minutes) : "30",
      text: trigger.kind === "output" ? trigger.text : "",
      maxRuns: template.draft.maxRuns === undefined ? "" : String(template.draft.maxRuns),
      maxMinutes: template.draft.maxMinutes === undefined ? "" : String(template.draft.maxMinutes),
    });
  };

  /** A field the error is about: marked invalid, and the error read as its description. */
  const invalidIf = (...about: LoopError[]) =>
    error !== null && about.includes(error) ? { "aria-invalid": true, "aria-describedby": errorId } : {};
  /** A group the error is about (no agent chosen, no end set): the error describes it. */
  const describedIf = (about: LoopError) => (error === about ? errorId : undefined);

  useEffect(() => {
    if (focusRow === null) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>("[data-loop-row]") ?? [])].find((r) => r.dataset.loopRow === focusRow);
    row?.querySelector("button")?.focus();
    setFocusRow(null);
  }, [focusRow]);

  // Deleted at once, and taken back from its row: the loop's instruction, targets and limits are the user's work.
  const remove = async (loop: LoopDef, at: number) => {
    const index = all.findIndex((l) => l.id === loop.id);
    try {
      await loopsStore.getState().remove(loop.id);
    } catch (e) {
      toastError(messages(loopsMessages).dialog.failed, { error: e });
      return;
    }
    setDeleted({ loop, index, at });
    setFocusRow(DELETED_ROW);
  };

  const undo = async () => {
    if (!deleted) return;
    try {
      const result = await loopsStore.getState().restore(deleted.loop, deleted.index);
      if (result === "full") {
        toastError(messages(loopsMessages).dialog.full);
        return;
      }
      setDeleted(null);
      setFocusRow(deleted.loop.id);
    } catch (e) {
      toastError(messages(loopsMessages).dialog.failed, { error: e });
    }
  };

  const save = async () => {
    if (!form) return;
    const checked = validateLoop({
      name: form.name,
      instruction: form.instruction,
      targets: form.targets,
      trigger: triggerOf(form),
      maxRuns: number(form.maxRuns),
      maxMinutes: number(form.maxMinutes),
    });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    try {
      // Saved in the open project: a loop placed in none becomes its own.
      const result = await loopsStore.getState().save({ ...checked.loop, id: form.id ?? crypto.randomUUID(), projectId: projectId ?? "" });
      if (result === "full") toastError(messages(loopsMessages).dialog.full);
      else setForm(null);
    } catch (e) {
      toastError(messages(loopsMessages).dialog.failed, { error: e });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDeleted(null);
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {form === null ? (
          <div ref={list} className="flex flex-col gap-2">
            {loops.length === 0 && !deleted && <p className="py-4 text-center text-xs text-dp-text-2">{t.empty}</p>}
            {elsewhere > 0 && (
              <p data-loops-elsewhere className="text-xs text-dp-text-2">
                {t.elsewhere(elsewhere)}
              </p>
            )}
            {withDeleted(
              deleted && (
                <div key={DELETED_ROW} data-loop-row={DELETED_ROW} className="flex items-center gap-2 rounded-md border border-dashed border-dp-line px-3 py-2">
                  <p id={`${formId}-deleted`} className="min-w-0 flex-1 truncate text-sm text-dp-text-2">
                    {t.removed(deleted.loop.name)}
                  </p>
                  <Button size="sm" variant="ghost" className={ROW_BUTTON} aria-describedby={`${formId}-deleted`} onClick={() => void undo()}>
                    {t.undo}
                  </Button>
                </div>
              ),
              deleted?.at ?? 0,
              loops.map((loop, index) => {
                const state = runtime[loop.id];
                const running = state?.running === true;
                // Saved when shells could be targets, it has no agent left to type into: it says so, and stays off.
                const noAgent = !running && loop.targets.every((id) => isShell(nodes[id]));
                const left =
                  running && loop.maxMinutes !== undefined && state.startedAt !== null
                    ? Math.max(0, Math.ceil(loop.maxMinutes - (Date.now() - state.startedAt) / 60_000))
                    : null;
                return (
                  <div key={loop.id} data-loop-row={loop.id} className="flex items-center gap-2 rounded-md bg-dp-card px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-dp-text">{loop.name}</p>
                      <p className="truncate text-xs text-dp-text-2">
                        {t.triggerSummary(loop.trigger)} · {t.cost(loop)}
                      </p>
                      <p className="font-mono text-xs text-dp-text-3 tabular-nums">
                        {running
                          ? `${t.round(state.runs, loop.maxRuns)}${left === null ? "" : ` · ${t.untilEnd(left)}`}`
                          : noAgent
                            ? t.noAgent
                            : state?.stoppedBecause
                              ? `${t.stopped[state.stoppedBecause]} · ${t.round(state.runs, loop.maxRuns)}`
                              : t.off}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={running ? "destructive" : "default"}
                      disabled={noAgent}
                      onClick={() => (running ? loopsStore.getState().stop(loop.id) : loopsStore.getState().start(loop.id))}
                    >
                      {running ? t.turnOff : t.turnOn}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={ROW_BUTTON}
                      onClick={() => {
                        setForm(formOf(loop, nodes, inProject));
                        setError(null);
                      }}
                    >
                      {t.edit}
                    </Button>
                    <Button size="sm" variant="ghost" className={ROW_REMOVE} onClick={() => void remove(loop, index)}>
                      {t.remove}
                    </Button>
                  </div>
                );
              }),
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="dp-label">{t.templates}</span>
              {LOOP_TEMPLATES.map((tpl) => (
                <Button key={tpl.id} size="sm" variant="outline" onClick={() => fromTemplate(tpl.id)}>
                  {t.template[tpl.id]}
                </Button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${formId}-name`} className={LABEL}>
                {t.name}
              </label>
              <Input id={`${formId}-name`} value={form.name} onChange={(e) => change({ name: e.currentTarget.value })} {...invalidIf("name")} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${formId}-instruction`} className={LABEL}>
                {t.instruction}
              </label>
              <Textarea
                id={`${formId}-instruction`}
                value={form.instruction}
                onChange={(e) => change({ instruction: e.currentTarget.value })}
                rows={3}
                className="resize-none field-sizing-fixed"
                {...invalidIf("instruction")}
              />
            </div>
            <fieldset aria-describedby={describedIf("targets")} className="flex flex-col gap-1">
              <legend className="dp-label mb-1">{t.targets}</legend>
              {terminals.length === 0 && <p className="text-xs text-dp-text-2">{t.noTargets}</p>}
              {terminals.map(([id, node]) => (
                <label key={id} className="-mx-2 flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-dp-text transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover motion-reduce:transition-none">
                  <Checkbox
                    data-target={id}
                    checked={form.targets.includes(id)}
                    onCheckedChange={(checked) => change({ targets: checked === true ? [...form.targets, id] : form.targets.filter((x) => x !== id) })}
                    className="border-dp-text-3 after:-inset-1"
                  />
                  {nodeNameOf(node) || id}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="dp-label mb-1">{t.trigger}</legend>
              <OptionList label={t.trigger} value={form.trigger} onValueChange={(trigger) => change({ trigger })} className="-mx-2 w-auto">
                {(["interval", "idle", "output"] as const).map((kind) => (
                  <OptionItem key={kind} value={kind} label={t.triggers[kind]} />
                ))}
              </OptionList>
              {/* A number reads with its unit, as one sentence ("Every 30 minutes"); its name is the words around it. */}
              {form.trigger === "interval" && (
                <div className="flex items-center gap-2">
                  <label id={`${formId}-interval-before`} htmlFor={`${formId}-interval`} className={AROUND}>
                    {t.every}
                  </label>
                  <Input
                    id={`${formId}-interval`}
                    aria-labelledby={`${formId}-interval-before ${formId}-interval-unit`}
                    type="number"
                    min={1}
                    max={1440}
                    value={form.minutes}
                    onChange={(e) => change({ minutes: e.currentTarget.value })}
                    className={NUMBER}
                    {...invalidIf("interval")}
                  />
                  <span id={`${formId}-interval-unit`} className={AROUND}>
                    {t.unitMinutes}
                  </span>
                </div>
              )}
              {form.trigger === "output" && (
                <div className="grid gap-1.5">
                  <label htmlFor={`${formId}-text`} className={LABEL}>
                    {t.text}
                  </label>
                  <Input id={`${formId}-text`} value={form.text} onChange={(e) => change({ text: e.currentTarget.value })} {...invalidIf("text")} />
                </div>
              )}
            </fieldset>
            <fieldset aria-describedby={describedIf("stop")} className="flex flex-col gap-2">
              <legend className="dp-label mb-1">{t.stop}</legend>
              <div className="flex items-center gap-2">
                <label id={`${formId}-runs-before`} htmlFor={`${formId}-runs`} className={AROUND}>
                  {t.atMost}
                </label>
                <Input
                  id={`${formId}-runs`}
                  aria-labelledby={`${formId}-runs-before ${formId}-runs-unit`}
                  type="number"
                  min={1}
                  max={1000}
                  value={form.maxRuns}
                  onChange={(e) => change({ maxRuns: e.currentTarget.value })}
                  className={NUMBER}
                  {...invalidIf("runs")}
                />
                <span id={`${formId}-runs-unit`} className={AROUND}>
                  {t.unitRuns}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label id={`${formId}-duration-before`} htmlFor={`${formId}-duration`} className={AROUND}>
                  {t.atMost}
                </label>
                <Input
                  id={`${formId}-duration`}
                  aria-labelledby={`${formId}-duration-before ${formId}-duration-unit`}
                  type="number"
                  min={1}
                  max={1440}
                  value={form.maxMinutes}
                  onChange={(e) => change({ maxMinutes: e.currentTarget.value })}
                  className={NUMBER}
                  {...invalidIf("minutes")}
                />
                <span id={`${formId}-duration-unit`} className={AROUND}>
                  {t.unitMinutes}
                </span>
              </div>
            </fieldset>
            {error && (
              <p id={errorId} role="alert" className="text-xs text-dp-danger">
                {t.errors[error]}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {form === null ? (
            <>
              <QuietButton onClick={() => setOpen(false)}>{t.close}</QuietButton>
              <AccentButton
                size="lg"
                onClick={() => {
                  setForm({ ...BLANK });
                  setError(null);
                }}
              >
                {t.new}
              </AccentButton>
            </>
          ) : (
            <>
              <QuietButton onClick={() => setForm(null)}>{t.cancel}</QuietButton>
              <AccentButton size="lg" onClick={() => void save()}>
                {t.save}
              </AccentButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
