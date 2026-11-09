import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { listOllamaModels, type OllamaLaunch, type OllamaMode } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { AccentButton } from "@/shell/buttons";
import { OLLAMA_SUGGESTIONS, sameOllamaModel, validOllamaModel } from "./installCommands";
import { fleetMessages } from "./messages";

type Models = { models: string[] } | { error: string } | null;

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

  const modeButton = (value: OllamaMode, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? t.aiderNotFound : undefined}
      onClick={() => setMode(value)}
      className={cn(
        "flex-1 rounded-md border border-transparent bg-dp-card py-1.5 text-xs transition-[background-color,border-color,transform] duration-150 ease-out hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        mode === value && "border-dp-accent bg-dp-accent-soft text-dp-accent-ink",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-3 p-1">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start rounded-md text-xs text-dp-text-2 transition-[color] duration-150 ease-out hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none">
        <ArrowLeft className="size-3.5" /> {t.title}
      </button>
      <div className="flex gap-1.5">
        {modeButton("code", t.codeAgent, !aiderAvailable)}
        {modeButton("chat", t.chat)}
      </div>
      <div className="grid max-h-40 gap-0.5 overflow-auto">
        {models === null && <p className="px-2 py-1 text-xs text-dp-text-2">{t.reading}</p>}
        {models && "error" in models && (
          <div className="grid justify-items-start gap-1 px-2 py-1">
            <p title={models.error} className="text-xs text-dp-danger">
              {t.serverDown}
            </p>
            <button type="button" onClick={() => void read()} className="rounded-md text-xs text-dp-accent-ink underline-offset-4 transition-[color] duration-150 ease-out hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none">
              {t.retry}
            </button>
          </div>
        )}
        {models && "models" in models && models.models.length === 0 && <p className="px-2 py-1 text-xs text-dp-text-2">{t.noModels}</p>}
        {installed.map((model) => (
          <button
            key={model}
            type="button"
            data-model={model}
            onClick={() => onPick({ model, mode })}
            className="rounded-md px-2 py-1.5 text-left font-mono text-xs text-dp-text transition-[background-color,transform] duration-150 ease-out hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] motion-reduce:transition-none"
          >
            {model}
          </button>
        ))}
      </div>
      <form onSubmit={pull} className="grid gap-1.5 border-t border-dp-line pt-2">
        <p className="dp-label">{t.pullLabel}</p>
        <div className="flex gap-1.5">
          <Input
            value={name}
            aria-label={t.pullLabel}
            placeholder={t.pullPlaceholder}
            onChange={(e) => {
              setName(e.target.value);
              setInvalid(false);
            }}
            className="h-8 min-w-0 font-mono text-xs"
          />
          <AccentButton type="submit" disabled={down} className="px-3 text-xs">
            {t.pull}
          </AccentButton>
        </div>
        {invalid && <p className="text-xs text-dp-danger">{t.pullInvalid}</p>}
        <p className="text-[11px] text-dp-text-2">{t.pullHint}</p>
      </form>
      {suggestions.length > 0 && (
        <div className="grid gap-0.5">
          <p className="dp-label px-2">{t.suggestions}</p>
          {suggestions.map(({ model, sizeGb, use }) => (
            <button
              key={model}
              type="button"
              data-suggestion={model}
              onClick={() => onPull(model)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] motion-reduce:transition-none"
            >
              <Download className="size-3.5 shrink-0 text-dp-text-2" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-dp-text">{model}</span>
                <span className="block text-[11px] text-dp-text-2">{t.uses[use]}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-dp-text-2">{t.sizeGb(sizeGb)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
