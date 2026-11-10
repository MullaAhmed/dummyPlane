import type { ComponentProps } from "react";
import { BookOpen, Code2, Settings, Users } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useWorkspaceAgentCounts } from "@/fleet/agentCounts";
import { setAgentsPanel, useAgentsPanel } from "@/fleet/agentsPanelState";
import { useMessages } from "@/i18n";
import { openNotes } from "@/notes/notesStore";
import { useProjects } from "@/store/projects";
import { isCode, useWorkspaces } from "@/store/workspaces";
import { studioMessages } from "@/studio/messages";
import { openCodeWorkspace } from "@/studio/navigate";
import { ToolButton } from "./buttons";
import { shellMessages } from "./messages";
import { SettingsMenu } from "./SettingsMenu";

/** A button of this rail: it sits at the window's right edge, so its hint opens to the left. */
function RailButton(props: ComponentProps<typeof ToolButton>) {
  return <ToolButton hintSide="left" {...props} />;
}

/** The rail on the right: the activities (spec identité §5.5). "Functions" comes with J8. */
export function ActivityRail() {
  const t = useMessages(shellMessages).activityRail;
  const open = useAgentsPanel((s) => s.open);
  const { waiting } = useWorkspaceAgentCounts();
  const studioLabel = useMessages(studioMessages).open;
  const inProject = useProjects((s) => s.activeId !== null);
  const codeOnScreen = useWorkspaces((s) => isCode(s.workspaces.find((w) => w.id === s.activeId)));
  return (
    <nav className="dp-glass absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-lg p-1">
      <RailButton label={t.agents} active={open} onClick={() => setAgentsPanel(!open)}>
        <Users />
        {waiting > 0 && (
          <span
            data-pip
            className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-dp-wait px-1 font-mono text-xs font-medium leading-3.5 tabular-nums text-dp-on-role"
          >
            {waiting}
          </span>
        )}
      </RailButton>
      <RailButton
        label={studioLabel}
        active={codeOnScreen}
        disabled={!inProject}
        onClick={() => void openCodeWorkspace()}
      >
        <Code2 />
      </RailButton>
      <RailButton label={t.notes} onClick={openNotes}>
        <BookOpen />
      </RailButton>
      <Separator className="my-1 bg-dp-line data-horizontal:w-6" />
      <SettingsMenu
        side="left"
        align="start"
        trigger={
          <RailButton label={t.settings}>
            <Settings />
          </RailButton>
        }
      />
    </nav>
  );
}
