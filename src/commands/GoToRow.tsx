import { Folder, Layers, LayoutGrid, Network } from "lucide-react";
import { agentInk, AGENTS, INDIGO } from "@/fleet/catalog";
import { useMessages } from "@/i18n";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import { useActivity } from "@/store/agentActivity";
import { useTerminalStatus } from "@/store/terminalStatus";
import type { GoToItem } from "./goTo";
import { commandsMessages } from "./messages";

const Elsewhere = ({ item }: { item: GoToItem }) =>
  item.elsewhere ? <span className="shrink-0 text-ov-text-3">{item.elsewhere}</span> : null;

function TerminalLine({ item }: { item: GoToItem }) {
  const id = item.targetId ?? "";
  const status = useTerminalStatus(id);
  const activity = useActivity(id);
  const meta = AGENTS[item.agent ?? "shell"];
  return (
    <>
      <span
        className="grid size-5 shrink-0 place-items-center rounded-[5px]"
        style={{ backgroundColor: `color-mix(in srgb, ${meta.tint} 18%, transparent)`, color: agentInk(meta.tint) }}
      >
        <meta.Icon className="size-3" />
      </span>
      <span className="truncate font-medium text-ov-text">{item.label}</span>
      <span className="shrink-0 text-ov-text-2">{meta.label}</span>
      {item.group && (
        <span className="flex shrink-0 items-center gap-1 text-ov-text-2">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: item.group.color }} />
          {item.group.name}
        </span>
      )}
      <Elsewhere item={item} />
      <span className="ml-auto shrink-0">
        <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} />
      </span>
    </>
  );
}

/** A line of "Go to" (spec window §7.2). */
export function GoToRow({ item }: { item: GoToItem }) {
  const t = useMessages(commandsMessages).goTo;
  switch (item.kind) {
    case "terminal":
      return <TerminalLine item={item} />;
    case "group":
      return (
        <>
          <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.group?.color }} />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="shrink-0 text-ov-text-2">{t.members(item.members ?? 0)}</span>
          <Elsewhere item={item} />
          <Layers className="ml-auto size-3.5 shrink-0 text-ov-text-3" />
        </>
      );
    case "orchestrator":
      return (
        <>
          <Network className="size-3.5 shrink-0 text-ov-accent" />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="shrink-0 text-ov-text-2">{t.linked(item.links ?? 0)}</span>
          <Elsewhere item={item} />
        </>
      );
    case "workspace":
      return (
        <>
          <LayoutGrid className="size-3.5 shrink-0 text-ov-text-2" />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="shrink-0 font-mono text-[11px] text-ov-text-2">{t.live(item.live ?? 0)}</span>
          {item.current && <span className="ml-auto shrink-0 text-ov-text-3">{t.shown}</span>}
        </>
      );
    case "project":
      return (
        <>
          <Folder className="size-3.5 shrink-0 text-ov-text-2" />
          <span className="truncate font-medium text-ov-text">{item.label}</span>
          <span className="ml-auto truncate font-mono text-[11px] text-ov-text-3">{item.path}</span>
        </>
      );
  }
}
