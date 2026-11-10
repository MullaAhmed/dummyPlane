import { useEffect, useState, type ReactElement } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { returnKeyboardToCanvas } from "@/canvas/keyboardFocus";
import { useUiRequest } from "@/commands/uiRequests";
import { messages, useMessages } from "@/i18n";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentId } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { workspacesStore } from "@/store/workspaces";
import { agentsStore, useAgents } from "./agentsStore";
import { agentInk, AGENTS, AGENTS_WITHOUT_OPTIONS, defaultAgent } from "./catalog";
import { agentsOf, DEFAULT_GROUP_SIZE, MAX_GROUP_SIZE, resizeSlots, type Slot } from "./composer";
import { agentsMessages } from "./messages";
import { launchGroup } from "./groups";
import { defaultLaunchOptions } from "./launchAgent";
import { LaunchFolderBar } from "./LaunchFolderBar";
import { PANTHEONS, pantheonById } from "./names";
import { NamesRadios } from "./NamesMenu";
import { pantheonForNewGroup } from "./naming";
import { ROLE_ORDER, ROLES, type RoleId } from "./roles";

/** An agent's logo: its icon in its own ink, the one place its tint shows. */
function AgentLogo({ agent, className }: { agent: AgentId; className?: string }) {
  const meta = AGENTS[agent];
  return (
    <span className={cn("grid size-7 place-items-center", className)} style={{ color: agentInk(meta.tint) }}>
      <meta.Icon className="size-4" />
    </span>
  );
}

/** A slot of the grid: the agent's logo and label; a click opens the agents (spec §11.2). */
function SlotButton(props: { agent: AgentId; choices: AgentId[]; onPick: (agent: AgentId) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-18 flex-col gap-1 rounded-lg bg-dp-card px-1 font-normal transition-[border-color,background-color,scale] hover:border-dp-text-3"
        >
          <AgentLogo agent={props.agent} />
          <span className="max-w-full truncate px-1 text-xs text-dp-text">{AGENTS[props.agent].label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.choices.map((id) => {
          const meta = AGENTS[id];
          return (
            <DropdownMenuItem key={id} onSelect={() => props.onPick(id)}>
              <meta.Icon style={{ color: agentInk(meta.tint) }} /> {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Compose a group", anchored to its trigger (spec theme §11.2). */
export function ComposeGroup({
  trigger,
  side = "top",
  answersRequests = false,
}: {
  trigger: ReactElement;
  side?: "top" | "left" | "bottom";
  /** The agents panel's copy answers the palette's "Compose a group…". */
  answersRequests?: boolean;
}) {
  const t = useMessages(agentsMessages).compose;
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<RoleId>("general");
  // What the user typed; until then the name is the role's, in the language of the moment.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? ROLES[role].label;
  const [slots, setSlots] = useState<Slot[]>(resizeSlots([], DEFAULT_GROUP_SIZE));
  // The set the agents' names come from; offered as the first one no group of the workspace uses.
  const [pantheon, setPantheon] = useState<string>(PANTHEONS[0].id);
  useUiRequest(
    "composeGroup",
    () => {
      setOpen(true);
      return true;
    },
    answersRequests,
  );
  const agents = useAgents((s) => s.agents);
  const fallback = defaultAgent(agents);
  const choices = AGENTS_WITHOUT_OPTIONS.filter((id) => agents.some((a) => a.id === id && a.available));
  const color = ROLES[role].color;

  useEffect(() => {
    if (!open) return;
    setRole("general");
    setTypedName(null);
    setSlots(resizeSlots([], DEFAULT_GROUP_SIZE));
    const workspaceId = workspacesStore.getState().activeId;
    setPantheon(workspaceId ? pantheonForNewGroup(workspaceId) : PANTHEONS[0].id);
    void agentsStore.getState().load();
  }, [open]);

  const pickRole = (next: RoleId) => {
    // An emptied field follows the role again (spec §11.2).
    setTypedName((current) => (current === null || current.trim() === "" ? null : current));
    setRole(next);
  };

  const launch = () => {
    setOpen(false);
    returnKeyboardToCanvas();
    void launchGroup({ name, role, agents: agentsOf(slots, fallback), pantheon }, defaultLaunchOptions()).catch((error: unknown) =>
      toast.error(messages(agentsMessages).launchFailed(String(error))),
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} sideOffset={8} className="flex w-90 flex-col gap-3 p-3">
        <p className="dp-label">{t.title}</p>
        {/* Where the agents start: the same folder as the Agent menu's, changed here the same way. */}
        <LaunchFolderBar compact />
        {/* The role's dot sits in the field, before the name it colours. */}
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-2 rounded-full -translate-y-1/2" style={{ backgroundColor: color }} />
          <Input
            autoFocus
            value={name}
            onChange={(e) => setTypedName(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Enter launches the group, unless it ends an IME composition.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) launch();
            }}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t.groupName}
            className="h-9 bg-dp-card pl-7 text-(length:--text-ui) font-medium md:text-(length:--text-ui)"
          />
        </div>
        <ToggleGroup
          type="single"
          aria-label={t.role}
          value={role}
          // A group always has a role: pressing the one in force keeps it.
          onValueChange={(next) => next && pickRole(next as RoleId)}
          spacing={1.5}
          className="flex-wrap"
        >
          {ROLE_ORDER.map((id) => {
            const active = id === role;
            return (
              <ToggleGroupItem
                key={id}
                value={id}
                className="h-7 min-w-0 gap-2 rounded-md border border-dp-line px-2.5 text-xs font-normal text-dp-text-2 transition-[background-color,border-color,color,scale] duration-150 ease-out hover:bg-dp-hover hover:text-dp-text focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] motion-reduce:transition-none data-[state=on]:font-medium data-[state=on]:text-dp-on-role"
                // The chosen role is filled with its own colour: inline, so it outranks the hover.
                style={active ? { backgroundColor: ROLES[id].color, borderColor: ROLES[id].color } : undefined}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: active ? "var(--dp-on-role)" : ROLES[id].color }} />
                {ROLES[id].label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <div className="flex items-center justify-between text-xs text-dp-text-2">
          <span>{t.names}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-7 gap-1.5 rounded-md bg-dp-card px-2.5 text-xs font-normal text-dp-text hover:border-dp-text-3">
                {pantheonById(pantheon).label}
                <ChevronDown className="size-3.5 text-dp-text-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <NamesRadios current={pantheon} onPick={setPantheon} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {slots.map((slot, i) => (
            <SlotButton
              key={i}
              agent={slot ?? fallback}
              choices={choices}
              onPick={(agent) => setSlots((current) => current.map((s, j) => (j === i ? agent : s)))}
            />
          ))}
        </div>
        {choices.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-dp-text-2">
            <span className="mr-1">{t.fillWith}</span>
            {choices.map((id) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t.fillAllWith(AGENTS[id].label)}
                    onClick={() => setSlots((current) => current.map(() => id))}
                    className="rounded-md"
                  >
                    <AgentLogo agent={id} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {t.fillAllWith(AGENTS[id].label)}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
        <Separator />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.fewer}
              disabled={slots.length <= 1}
              onClick={() => setSlots((current) => resizeSlots(current, current.length - 1))}
              className="rounded-md text-dp-text-2 hover:text-dp-text"
            >
              <Minus className="size-4" />
            </Button>
            <span className="w-6 text-center font-mono text-(length:--text-ui) text-dp-text tabular-nums">{slots.length}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.more}
              disabled={slots.length >= MAX_GROUP_SIZE}
              onClick={() => setSlots((current) => resizeSlots(current, current.length + 1))}
              className="rounded-md text-dp-text-2 hover:text-dp-text"
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {/* Filled with the role's colour (inline, so it outranks the variant's fill); a hover brightens it. */}
          <Button
            type="button"
            onClick={launch}
            className="rounded-md px-4 text-(length:--text-ui) font-medium text-dp-on-role transition-[filter,scale] hover:brightness-110"
            style={{ backgroundColor: color }}
          >
            {t.launch(slots.length)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
