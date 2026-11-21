import { Fragment, memo, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RoleMark } from "@/components/marks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameGroup, setGroupFolded } from "@/agents/groups";
import { GroupMenu } from "@/agents/GroupMenu";
import { agentStateIn, type AgentState } from "@/agents/agentState";
import { membersIn, summaryParts } from "@/agents/groupSummary";
import { screenRectOf } from "@/agents/placement";
import { ROLES } from "@/agents/roles";
import { useActivities } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useStore } from "zustand";
import { uiStore, useUi } from "@/store/ui";
import { canvasStore, useCanvas } from "../canvasStore";
import { groupBeingRenamed, isGroup, type SceneGroup } from "../groups";
import { useMessages } from "@/i18n";
import { canvasMessages } from "../messages";
import { scrollLayerPlace, ScrollLayer } from "./layers";

/** The label sits on the frame's top edge, 16 px from its corner, like a tab. */
const LABEL_INSET = 16;
const LABEL_HEIGHT = 24;

/**
 * Group labels, above the canvas. Excalidraw's own frame name stays below as
 * the handle that selects, drags and renames the frame: excalidraw.css gives
 * it the label's font and place, and it is made transparent here.
 *
 * `.excalidraw` makes no stacking context, so its layers compete with ours:
 * at z-index 3, placed before Excalidraw in the DOM, the labels cover frame
 * names and nodes (2) but stay under its text editor (3) and its panels (4).
 * Placed at the view's zoom in a layer that scrolls: a pan moves that layer and
 * draws no label again. A label is drawn again when what it shows changed.
 */
export function GroupLabels() {
  const frames = useCanvas((s) => s.frames);
  const zoom = useCanvas((s) => s.view.zoom);
  const editingFrame = useCanvas((s) => s.view.editingFrame);
  const activities = useActivities();
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const nodes = useNodes((s) => s.nodes);
  // The reading every count shares (agentState): a stopped process, an agent that exited or a plain shell is never at work.
  const members = (group: SceneGroup, state: AgentState | readonly AgentState[]) =>
    membersIn(group.memberIds, state, (id) => agentStateIn(id, nodes, statuses, activities));
  const groups = frames.filter(isGroup);
  const renaming = useUi((s) => s.renamingGroup);
  const takeover = groupBeingRenamed(editingFrame, frames);

  // Double-click (or Enter) on a group's name opened Excalidraw's editor:
  // close it before anything is typed, and rename in the label instead.
  useEffect(() => {
    if (!takeover) return;
    canvasStore.getState().api?.updateScene({ appState: { editingFrame: null } });
    uiStore.getState().setRenamingGroup(takeover);
  }, [takeover]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
      <style>{groups.map((g) => `.excalidraw [id$="-frame-name-${CSS.escape(g.id)}"]{color:transparent!important}`).join("\n")}</style>
      <ScrollLayer>
        {groups.map((group) =>
          group.id === editingFrame ? null : (
            <GroupLabel
              key={group.id}
              group={group}
              zoom={zoom}
              renaming={group.id === renaming}
              working={members(group, "working")}
              waiting={members(group, "waiting")}
              ready={members(group, ["ready", "done"])}
            />
          ),
        )}
      </ScrollLayer>
    </div>
  );
}

const GroupLabel = memo(function GroupLabel(props: { group: SceneGroup; zoom: number; working: number; waiting: number; ready: number; renaming: boolean }) {
  const { group, zoom, working, waiting, ready, renaming } = props;
  const rect = screenRectOf(group, scrollLayerPlace(zoom));
  const { role: roleId, speciality, folded } = group.group;
  const t = useMessages(canvasMessages);
  const role = ROLES[roleId];
  return (
    <div
      // 12px, weight 500, sentence case: the type of Excalidraw's frame name under it, so the grab handle lines up.
      className="absolute flex items-center rounded-t-md border border-b-0 bg-dp-surface pr-1 text-xs whitespace-nowrap"
      style={{
        // One pixel left so the name lines up with the native one under it, despite the border.
        left: rect.x + LABEL_INSET - 1,
        top: rect.y - LABEL_HEIGHT,
        height: LABEL_HEIGHT,
        borderColor: `color-mix(in srgb, ${role.color} 60%, transparent)`,
      }}
    >
      {/* A chevron says what it does: a native title is enough, no tooltip over the canvas. */}
      <Button
        type="button"
        variant="ghost"
        aria-label={folded ? t.unfoldGroup : t.foldGroup}
        title={folded ? t.unfoldGroup : t.foldGroup}
        onClick={() => setGroupFolded(group.id, !folded)}
        className="pointer-events-auto relative h-full w-4 rounded-sm p-0 text-dp-text-2 after:absolute after:-inset-x-1 hover:text-dp-text"
      >
        {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </Button>
      {/* The role as a bar (the round dot is an agent's), in a 6 px box: chevron 16 + mark 6 + gap 6 = the 28 px the native name is aligned on. */}
      <RoleMark color={role.color} className="mr-1.5 w-1.5" />
      {renaming ? (
        <NameField name={group.name} onDone={(name) => name !== null && renameGroup(group.id, name)} />
      ) : (
        <span className="font-medium text-dp-text">{group.name}</span>
      )}
      {speciality && (
        <span title={speciality} className="pointer-events-auto ml-2 max-w-40 truncate text-dp-text-2">
          {speciality}
        </span>
      )}
      {/* Worst first: who waits for the user stands in the wait tone, ahead of who works. */}
      <span className="ml-2 font-mono text-dp-text-2">
        {summaryParts({ members: group.memberIds.length, waiting, working, ready }).map((part, i) => (
          <Fragment key={part.text}>
            {i > 0 && " · "}
            {part.waiting ? <span className="text-dp-wait">{part.text}</span> : part.text}
          </Fragment>
        ))}
      </span>
      <GroupMenu groupId={group.id} />
    </div>
  );
});

/** The group's name, edited in place: Enter or a click elsewhere keeps it, Escape cancels. */
function NameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const t = useMessages(canvasMessages);
  // Removing the focused field may fire one last blur: only the first ending counts.
  const done = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // `autoFocus` would scroll the label layer (overflow-hidden) when the label is still out of view.
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    uiStore.getState().setRenamingGroup(null);
    onDone(value);
  };
  return (
    <Input
      ref={field}
      defaultValue={name}
      aria-label={t.groupNameLabel}
      size={Math.max(4, name.length + 1)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") finish(null);
      }}
      // Sized by its `size`, in the label's own type; the ink ring says it is being edited.
      className="pointer-events-auto h-5 w-auto rounded-sm border-0 bg-dp-field px-1 py-0 text-xs font-medium ring-1 ring-dp-accent focus-visible:ring-1 focus-visible:ring-dp-accent md:text-xs"
    />
  );
}
