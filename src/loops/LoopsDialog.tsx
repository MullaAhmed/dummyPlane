import { useId, useState } from "react";
import { toast } from "sonner";
import { OptionItem, OptionList } from "@/components/OptionList";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUiRequest } from "@/commands/uiRequests";
import { messages, useMessages } from "@/i18n";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { useLoops, loopsStore } from "./live";
import { loopsMessages } from "./messages";
import { LOOP_TEMPLATES, validateLoop, type LoopDef, type LoopError, type LoopTrigger } from "./model";

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

const BLANK: Form = { id: null, name: "", instruction: "", targets: [], trigger: "interval", minutes: "30", text: "", maxRuns: "", maxMinutes: "" };

const number = (value: string) => (value.trim() === "" ? undefined : Number(value));

function formOf(loop: LoopDef): Form {
  const { trigger } = loop;
  return {
    id: loop.id,
    name: loop.name,
    instruction: loop.instruction,
    targets: loop.targets,
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

/** The loops: the list and the form (loops spec §4), opened by the palette or the indicator. */
export function LoopsDialog() {
  const t = useMessages(loopsMessages).dialog;
  const formId = useId();
  const errorId = `${formId}-error`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<LoopError | null>(null);
  const loops = useLoops((s) => s.loops);
  const runtime = useLoops((s) => s.runtime);
  const nodes = useNodes((s) => s.nodes);
  const terminals = Object.entries(nodes).filter(([, node]) => node.kind === "terminal");
  useUiRequest("loops", () => {
    setForm(null);
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
      const result = await loopsStore.getState().save({ ...checked.loop, id: form.id ?? crypto.randomUUID() });
      if (result === "full") toast.error(messages(loopsMessages).dialog.full);
      else setForm(null);
    } catch (e) {
      toast.error(messages(loopsMessages).dialog.failed(String(e)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {form === null ? (
          <div className="flex flex-col gap-2">
            {loops.length === 0 && <p className="py-4 text-center text-xs text-dp-text-2">{t.empty}</p>}
            {loops.map((loop) => {
              const state = runtime[loop.id];
              const running = state?.running === true;
              const left =
                running && loop.maxMinutes !== undefined && state.startedAt !== null
                  ? Math.max(0, Math.ceil(loop.maxMinutes - (Date.now() - state.startedAt) / 60_000))
                  : null;
              return (
                <div key={loop.id} className="flex items-center gap-2 rounded-md bg-dp-card px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-dp-text">{loop.name}</p>
                    <p className="truncate text-xs text-dp-text-2">
                      {t.triggerSummary(loop.trigger)} · {t.cost(loop)}
                    </p>
                    <p className="font-mono text-xs text-dp-text-3 tabular-nums">
                      {running
                        ? `${t.round(state.runs, loop.maxRuns)}${left === null ? "" : ` · ${t.untilEnd(left)}`}`
                        : state?.stoppedBecause
                          ? `${t.stopped[state.stoppedBecause]} · ${t.round(state.runs, loop.maxRuns)}`
                          : t.off}
                    </p>
                  </div>
                  <Button size="sm" variant={running ? "destructive" : "default"} onClick={() => (running ? loopsStore.getState().stop(loop.id) : loopsStore.getState().start(loop.id))}>
                    {running ? t.turnOff : t.turnOn}
                  </Button>
                  <Button size="sm" variant="ghost" className={ROW_BUTTON} onClick={() => setForm(formOf(loop))}>
                    {t.edit}
                  </Button>
                  <Button size="sm" variant="ghost" className={ROW_REMOVE} onClick={() => void loopsStore.getState().remove(loop.id)}>
                    {t.remove}
                  </Button>
                </div>
              );
            })}
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
