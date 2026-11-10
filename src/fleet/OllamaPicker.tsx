import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import { listOllamaModels, type OllamaLaunch, type OllamaMode } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { BACK, LINK } from "./InstallPrompt";
import { OLLAMA_SUGGESTIONS, sameOllamaModel, validOllamaModel } from "./installCommands";
import { fleetMessages } from "./messages";

type Models = { models: string[] } | { error: string } | null;

/** A model of the lists: a full-width row, so no press scale. */
const ROW = "h-auto w-full justify-start rounded-md px-2 py-1.5 text-left font-normal active:scale-100";

/** Model and mode of an Ollama agent (spec theme §8.1); a new model is pulled in a visible terminal (spec installation §5). */
export function OllamaPicker(props: { aiderAvailable: boolean; onBack: () => void; onPick: (ollama: OllamaLaunch) => void; onPull: (model: string) => void }) {
  const { aiderAvailable, onBack, onPick, onPull } = props;
  const t = useMessages(fleetMessages).ollama;
  const [models, setModels] = useState<Models>(null);
  const [mode, setMode] = useState<OllamaMode>(aiderAvailable ? "code" : "chat");
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);

  const read = () =>
    listOllamaModels().then(
      (list) => setModels({ models: list }),
      (error: unknown) => setModels({ error: String(error) }),
    );

  useEffect(() => {
    void read();
  }, []);

  const installed = models && "models" in models ? models.models : [];
  // `ollama pull` needs the server too: better said here than failed in a terminal.
  const down = models !== null && "error" in models;
  const suggestions = down ? [] : OLLAMA_SUGGESTIONS.filter((s) => !installed.some((model) => sameOllamaModel(model, s.model)));

  const pull = (event: FormEvent) => {
    event.preventDefault();
    const model = name.trim();
    if (!model || down) return;
    if (validOllamaModel(model)) onPull(model);
    else setInvalid(true);
  };

  return (
    <div className="grid gap-3 p-1">
      <Button type="button" variant="ghost" size="xs" onClick={onBack} className={BACK}>
        <ArrowLeft className="size-3.5" /> {t.title}
      </Button>
      <ToggleGroup
        type="single"
        aria-label={t.mode}
        value={mode}
        // A mode is always chosen: pressing the one in force keeps it.
        onValueChange={(next) => next && setMode(next as OllamaMode)}
        spacing={1.5}
        className="w-full"
      >
        {(
          [
            ["code", t.codeAgent, !aiderAvailable],
            ["chat", t.chat, false],
          ] as const
        ).map(([value, label, disabled]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            disabled={disabled}
            // Pointer events kept on a disabled mode, so its title says why.
            title={disabled ? t.aiderNotFound : undefined}
            className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-dp-card text-xs font-normal transition-[background-color,border-color,transform] duration-150 ease-out hover:bg-dp-hover focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] disabled:pointer-events-auto disabled:cursor-not-allowed motion-reduce:transition-none data-[state=on]:border-dp-accent data-[state=on]:bg-dp-accent-soft data-[state=on]:text-dp-text"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {/* The viewport carries the cap: a ScrollArea with only a max-height would clip instead of scroll. */}
      <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-40">
        <div className="grid gap-0.5">
          {models === null && <p className="px-2 py-1 text-xs text-dp-text-2">{t.reading}</p>}
          {models && "error" in models && (
            <div className="grid justify-items-start gap-1 px-2 py-1">
              <p title={models.error} className="text-xs text-dp-danger">
                {t.serverDown}
              </p>
              <Button type="button" variant="link" onClick={() => void read()} className={LINK}>
                {t.retry}
              </Button>
            </div>
          )}
          {models && "models" in models && models.models.length === 0 && <p className="px-2 py-1 text-xs text-dp-text-2">{t.noModels}</p>}
          {installed.map((model) => (
            <Button key={model} type="button" variant="ghost" data-model={model} onClick={() => onPick({ model, mode })} className={cn(ROW, "font-mono text-xs")}>
              {model}
            </Button>
          ))}
        </div>
      </ScrollArea>
      <Separator />
      <form onSubmit={pull} className="grid gap-2">
        <p className="dp-label">{t.pullLabel}</p>
        <div className="flex gap-2">
          <Input
            value={name}
            aria-label={t.pullLabel}
            placeholder={t.pullPlaceholder}
            onChange={(e) => {
              setName(e.target.value);
              setInvalid(false);
            }}
            className="h-8 min-w-0 rounded-md font-mono text-xs md:text-xs"
          />
          <Button type="submit" disabled={down} className="rounded-md px-3 text-xs">
            {t.pull}
          </Button>
        </div>
        {invalid && <p className="text-xs text-dp-danger">{t.pullInvalid}</p>}
        <p className="text-xs text-dp-text-2">{t.pullHint}</p>
      </form>
      {suggestions.length > 0 && (
        <div className="grid gap-0.5">
          <p className="dp-label px-2">{t.suggestions}</p>
          {suggestions.map(({ model, sizeGb, use }) => (
            <Button key={model} type="button" variant="ghost" data-suggestion={model} onClick={() => onPull(model)} className={cn(ROW, "gap-2 py-1")}>
              <Download className="size-4 shrink-0 text-dp-text-2" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-dp-text">{model}</span>
                <span className="block text-xs text-dp-text-2">{t.uses[use]}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-dp-text-2 tabular-nums">{t.sizeGb(sizeGb)}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
