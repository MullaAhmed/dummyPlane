import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Check, Kanban, Network, SquareTerminal } from "lucide-react";
import { toastError } from "@/lib/errorToast";
import { useUiRequest } from "@/commands/uiRequests";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { placeKanban } from "@/kanban/place";
import { messages, useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { uiStore } from "@/store/ui";
import { agentsStore, useAgents } from "./agentsStore";
import { AGENT_ORDER, agentInk, AGENTS, defaultAgent } from "./catalog";
import { installAgent, pullOllamaModel } from "./installAgent";
import { AGENT_INSTALLS } from "./installCommands";
import { InstallPrompt } from "./InstallPrompt";
import { defaultLaunchOptions, launchAgent, type LaunchOptions } from "./launchAgent";
import { folderSaveFailed, launchFolderStore, sameFolder, useLaunchFolder } from "./launchFolder";
import { LaunchFolderBar } from "./LaunchFolderBar";
import { agentsMessages } from "./messages";
import { LaunchOptionsForm } from "./LaunchOptionsForm";
import { OllamaPicker } from "./OllamaPicker";
import { newConsole, placeFleet } from "./quickActions";
import type { Point } from "./terminals";

/**
 * "options" is the Custom agent's form: its command, where and how it runs. The
 * palette's "Launch a custom agent…" asks for it by that name. "launch" is the
 * folder, shell and title of the next agents, the footer's "Options".
 */
type View = "agents" | "options" | "launch" | "ollama" | { install: AgentId };

/** What takes the keyboard in a view that has none yet: its first control, Back in every sub-view. */
const FIRST_CONTROL = "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** One entry of the menu: an icon, a name, sometimes a line under it. */
const ROW = "h-auto w-full justify-start gap-2.5 rounded-md border-0 px-2 py-1.5 text-left font-normal whitespace-normal";

/** "Launch an agent", opened from the tool rail's ＋ or the agents panel (spec identity §5.4, §5.6). */
export function AgentMenu({
  trigger,
  side = "right",
  answersRequests = false,
}: {
  trigger: (open: boolean) => ReactElement;
  side?: "right" | "left" | "bottom";
  /** The tool rail's menu answers the palette's "Launch a custom agent…" and "Launch Ollama…". */
  answersRequests?: boolean;
}) {
  const t = useMessages(agentsMessages);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("agents");
  const [options, setOptions] = useState<LaunchOptions | null>(null);
  const agents = useAgents((s) => s.agents);
  const shells = useAgents((s) => s.shells);
  const launchFolder = useLaunchFolder();
  // The folder is the workspace's choice, read from the store: the form only types over it until the user leaves it.
  const [typedFolder, setTypedFolder] = useState<string | null>(null);
  const current: LaunchOptions = { ...(options ?? defaultLaunchOptions()), cwd: typedFolder ?? launchFolder.folder };
  const fallback = defaultAgent(agents);
  const available = (id: AgentId) => agents.find((a) => a.id === id)?.available ?? false;
  // Before the first detection nothing is known to be missing.
  const missing = (id: AgentId) => agents.some((a) => a.id === id && !a.available) && id in AGENT_INSTALLS;

  const requestedView = useRef<View | null>(null);
  const agentRows = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The control that opened a sub-view (a row, an Install, Options): its Back gives the keyboard back to it.
  const opener = useRef<string | null>(null);
  const [placeAt, setPlaceAt] = useState<Point | null>(null);
  // Opened by a request (the palette, a shortcut, the radial menu), not by its trigger: it shows at once.
  const [instant, setInstant] = useState(false);

  // Another folder chosen at the top of the menu, or the menu opened again: what was typed no longer holds.
  useEffect(() => {
    setTypedFolder(null);
  }, [launchFolder.folder, open]);

  // Before paint: a view asked for by the palette shows at once, without the agents list for a frame.
  useLayoutEffect(() => {
    if (!open) {
      setPlaceAt(null);
      opener.current = null;
      return;
    }
    setView(requestedView.current ?? "agents");
    requestedView.current = null;
    void agentsStore.getState().load();
  }, [open]);

  // The keyboard follows the view (WCAG 2.4.3): the control that swapped it is gone, and focus would fall to the page.
  // A sub-view takes it on its first control, unless one of its own took it (Custom's command); back on the agents,
  // the control that opened the sub-view has it again.
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return;
    if (view === "agents") {
      const from = opener.current;
      opener.current = null;
      const back = from ? root.querySelector<HTMLElement>(from) : null;
      if (back) back.focus();
      else if (!root.contains(document.activeElement)) agentRows.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      return;
    }
    if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>(FIRST_CONTROL)?.focus();
  }, [view]);

  /** A sub-view, opened from the control `from` names: Back gives it the keyboard again. */
  const showView = (next: View, from: string) => {
    opener.current = from;
    setView(next);
  };

  useUiRequest(
    "agentMenu",
    (request) => {
      // Already open, the effect above will not run again.
      if (open) setView(request.view);
      else requestedView.current = request.view;
      setPlaceAt(request.at ?? null);
      setInstant(true);
      setOpen(true);
      return true;
    },
    answersRequests,
  );

  /** A folder typed or browsed in a form becomes the workspace's folder when the form is left or launches: the choice holds. */
  const settleFolder = (cwd: string) => {
    setTypedFolder(null);
    if (cwd.trim() && !sameFolder(cwd, launchFolder.folder)) void launchFolderStore.getState().choose(cwd).catch(folderSaveFailed);
  };

  const leaveForm = () => {
    settleFolder(current.cwd);
    setView("agents");
  };

  const place = (agent: AgentId, launch: LaunchOptions) => {
    setOpen(false);
    settleFolder(launch.cwd);
    // Only a Custom terminal runs its command: another agent would just carry it.
    const kept = agent === "custom" ? launch : { ...launch, command: "" };
    // "Other agent…" of the radial menu: launched where the right click was (spec menu radial §4.1).
    if (placeAt) void launchAgent(agent, kept, placeAt).catch((error: unknown) => toastError(messages(agentsMessages).launchFailed, { error, next: messages(agentsMessages).launchNext }));
    else uiStore.getState().setPlacing({ agent, options: kept });
  };

  const pick = (agent: AgentId) => {
    if (agent === "ollama") showView("ollama", `[data-agent-pick="ollama"]`);
    // The command is what a Custom terminal is: it is shown, the last one filled in, before anything runs.
    else if (agent === "custom") showView("options", `[data-agent-pick="custom"]`);
    else place(agent, current);
  };

  const launchCustom = (event: FormEvent) => {
    event.preventDefault();
    if (current.command.trim()) place("custom", current);
  };

  const changeOptions = (value: LaunchOptions) => {
    setOptions(value);
    setTypedFolder(sameFolder(value.cwd, launchFolder.folder) ? null : value.cwd);
  };

  const inTerminal = (run: (at?: Point) => void) => {
    setOpen(false);
    run(placeAt ?? undefined);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Its trigger opened it: it grows from it, as a popover does.
        if (next) setInstant(false);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{trigger(open)}</PopoverTrigger>
      <PopoverContent
        ref={content}
        side={side}
        align="start"
        data-instant={instant ? "" : undefined}
        className="w-72 p-2"
        onOpenAutoFocus={(event) => {
          // The launch folder's Change… comes first, but the first thing to reach is an agent: Enter launches it, not the picker.
          const first = agentRows.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
      >
        {view === "agents" && (
          <>
            <LaunchFolderBar />
            <Separator className="my-1.5" />
            <p className="dp-label px-2 pb-1 pt-1">{t.agentMenu.title}</p>
            <div ref={agentRows} className="flex flex-col">
              {AGENT_ORDER.map((id) => {
                const meta = AGENTS[id];
                const usable = available(id);
                return (
                  <div key={id} className="relative">
                    {/* Its title says why it is greyed: the row keeps the pointer while disabled. */}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!usable}
                      data-agent-pick={id}
                      title={usable ? undefined : t.agentMenu.notFound(meta.binary)}
                      onClick={() => pick(id)}
                      className={cn(ROW, "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:hover:bg-transparent")}
                    >
                      <span
                        className="grid size-7 place-items-center rounded-md"
                        style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: agentInk(meta.tint) }}
                      >
                        <meta.Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-(length:--text-ui) font-medium text-dp-text">{meta.label}</span>
                        <span className="block text-xs text-dp-text-2">{meta.vendor}</span>
                      </span>
                      {id === fallback && <Check className="size-3.5 text-dp-accent-ink" />}
                    </Button>
                    {/* Beside the row and not inside it: the row is disabled, this button is not. */}
                    {missing(id) && (
                      <Button
                        type="button"
                        size="xs"
                        data-install={id}
                        aria-label={t.install.installAgent(meta.label)}
                        onClick={() => showView({ install: id }, `[data-install="${id}"]`)}
                        className="absolute right-2 top-1/2 h-auto -translate-y-1/2 border-0 bg-dp-accent-soft px-2 py-0.5 text-xs font-medium text-dp-accent-ink hover:bg-dp-accent/25"
                      >
                        {t.install.button}
                      </Button>
                    )}
                  </div>
                );
              })}
              <Separator className="my-1" />
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  newConsole(placeAt ?? undefined);
                }}
                className={ROW}
              >
                <span className="grid size-7 place-items-center rounded-md bg-dp-field text-dp-text-2">
                  <SquareTerminal className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-(length:--text-ui) font-medium text-dp-text">{t.agentMenu.newConsole}</span>
              </Button>
              {/* Spec theme §10.1: placed the same way as an agent. */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  if (placeAt) placeFleet(placeAt);
                  else uiStore.getState().setPlacing({ fleet: true });
                }}
                className={ROW}
              >
                <span className="grid size-7 place-items-center rounded-md bg-dp-accent-soft text-dp-accent-ink">
                  <Network className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-(length:--text-ui) font-medium text-dp-text">{t.agentMenu.fleet}</span>
                  <span className="block text-xs text-dp-text-2">{t.agentMenu.fleetHint}</span>
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  placeKanban(placeAt ?? undefined);
                }}
                className={ROW}
              >
                <span className="grid size-7 place-items-center rounded-md bg-dp-field text-dp-text-2">
                  <Kanban className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-(length:--text-ui) font-medium text-dp-text">{t.agentMenu.kanban}</span>
                  <span className="block text-xs text-dp-text-2">{t.agentMenu.kanbanHint}</span>
                </span>
              </Button>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-dp-line px-2 pt-2 text-xs text-dp-text-2">
              <span>{placeAt ? t.agentMenu.placedWhereClicked : t.agentMenu.thenClickCanvas}</span>
              <Button
                type="button"
                variant="link"
                size="xs"
                data-launch-options
                className="h-auto px-1 text-xs font-normal text-dp-accent-ink"
                onClick={() => showView("launch", "[data-launch-options]")}
              >
                {t.agentMenu.options}
              </Button>
            </div>
          </>
        )}
        {view === "options" && (
          // A form, so Enter in the command launches it.
          <form onSubmit={launchCustom}>
            <LaunchOptionsForm
              value={current}
              shells={shells}
              onChange={changeOptions}
              showCommand
              title={t.options.customTitle}
              onBack={leaveForm}
              className="p-1"
              footer={
                <Button type="submit" disabled={!current.command.trim()} className="w-full">
                  {t.agentMenu.launchCustom}
                </Button>
              }
            />
          </form>
        )}
        {view === "launch" && (
          <LaunchOptionsForm
            value={current}
            shells={shells}
            onChange={changeOptions}
            showCommand={false}
            onBack={leaveForm}
            className="p-1"
            footer={<p className="text-xs text-dp-text-2">{t.agentMenu.optionsHint}</p>}
          />
        )}
        {view === "ollama" && (
          <OllamaPicker
            aiderAvailable={available("aider")}
            onBack={() => setView("agents")}
            onPick={(ollama) => place("ollama", { ...current, ollama })}
            onPull={(model) => inTerminal((at) => void pullOllamaModel(model, at))}
          />
        )}
        {typeof view === "object" && (
          <InstallPrompt key={view.install} agent={view.install} onBack={() => setView("agents")} onRun={() => inTerminal((at) => void installAgent(view.install, at))} />
        )}
      </PopoverContent>
    </Popover>
  );
}
