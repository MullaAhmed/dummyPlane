import { useEffect, type ComponentProps } from "react";
import { FolderPlus, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agentsStore } from "@/agents/agentsStore";
import { toastError } from "@/lib/errorToast";
import { messages, useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton } from "@/shell/buttons";
import { SearchField } from "@/shell/SearchField";
import { TitleBar } from "@/shell/TitleBar";
import { showTroubleshooting } from "@/shell/troubleshoot";
import { UpdateChip } from "@/shell/UpdateDialog";
import { projectsStore, useProjects } from "@/store/projects";
import { addProject } from "./addProject";
import { GettingStarted, gettingStartedShown, useHasAgent } from "./GettingStarted";
import { homeMessages } from "./messages";
import { ProjectCard } from "./ProjectCard";

/** The header's "Add a project" while another action is the screen's primary: the raised surface with a hairline. */
function OutlineButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button type="button" variant="outline" className={cn("px-4 text-(length:--text-ui) font-normal [&_svg:not([class*='size-'])]:size-4", className)} {...props} />;
}

/** Projects as glass cards under the title bar; a click opens one on its last workspace (spec identity §5.9). */
export function HomeScreen() {
  const t = useMessages(homeMessages);
  const projects = useProjects((s) => s.projects);
  const hasAgent = useHasAgent();
  // "Getting started" holds the first steps: the empty list does not say it again under it.
  const guiding = gettingStartedShown(hasAgent, projects.length > 0);
  // One filled button per state: "Install Claude Code" while no agent is installed, "Add a project" after.
  const AddButton = hasAgent === false ? OutlineButton : AccentButton;

  useEffect(() => {
    void projectsStore.getState().refresh();
    agentsStore
      .getState()
      .load()
      .catch((error: unknown) => toastError(messages(homeMessages).start.agentsFailed, { error }));
  }, []);

  return (
    <div className="dp-ambient flex h-screen w-screen flex-col">
      <TitleBar leading={<span data-tauri-drag-region="" className="text-(length:--text-ui) font-medium text-dp-text">dummyPlane</span>} center={<SearchField />} trailing={<UpdateChip />} />
      {/* The scroller starts below the title bar: scrolled cards never slide under it. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative mx-auto max-w-5xl px-8 pb-12 pt-8">
          <header className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-medium text-dp-text">{t.title}</h1>
            <AddButton onClick={() => void addProject()}>
              <FolderPlus /> {t.add}
            </AddButton>
          </header>
          <GettingStarted hasProject={projects.length > 0} />
          {projects.length === 0 ? (
            !guiding && (
              <div data-no-projects className="mt-24 grid place-items-center gap-3 text-center">
                <p className="text-lg font-medium text-dp-text">{t.none}</p>
                <p className="max-w-sm text-sm text-dp-text-2">{t.noneHint}</p>
              </div>
            )
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void showTroubleshooting()}
            className="mx-auto mt-10 flex gap-2 px-2 text-xs font-normal text-dp-text-2 hover:text-dp-text [&_svg]:text-dp-text-3"
          >
            <LifeBuoy /> {t.troubleshoot}
          </Button>
        </div>
      </div>
    </div>
  );
}
