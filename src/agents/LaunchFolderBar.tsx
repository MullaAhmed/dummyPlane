import { Folder, FolderOpen, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { agentsMessages } from "./messages";
import { folderName, folderSaveFailed, launchFolderStore, pickFolder, useLaunchFolder } from "./launchFolder";

/** Recent folders listed in the menu: the store keeps a few more. */
const SHOWN_RECENT = 3;

/**
 * Where the next terminals of the workspace start (the "Launch folder"): its name, its full path
 * on hover, a button to pick another one, the recent ones, and the way back to the project's own.
 * The choice is the workspace's: it holds until it is changed, and terminals already started stay where they are.
 */
export function LaunchFolderBar({ compact = false }: { /** The group's window: the folder and its button only. */ compact?: boolean }) {
  const t = useMessages(agentsMessages).launchFolder;
  const { folder, projectFolder, custom, recent } = useLaunchFolder();
  const change = async () => {
    const picked = await pickFolder(folder);
    if (picked) void launchFolderStore.getState().choose(picked).catch(folderSaveFailed);
  };

  return (
    // A column of flex, not a grid: a grid item would not shrink below its text, and a long name would widen the popover.
    <div className="flex flex-col gap-1" data-launch-folder>
      <p className="dp-label px-1 pt-1">{t.label}</p>
      <div className="flex items-center gap-1.5">
        {/* The full path on hover: the name alone is what fits. */}
        <div title={folder} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-dp-field px-2">
          <FolderOpen className="size-3.5 shrink-0 text-dp-text-2" aria-hidden />
          <span data-launch-folder-name className="min-w-0 flex-1 truncate text-(length:--text-ui) font-medium text-dp-text">
            {folderName(folder)}
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" title={t.changeTooltip} onClick={() => void change()}>
          {t.change}
        </Button>
      </div>
      {custom && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={`${t.backToProject}: ${projectFolder}`}
          onClick={() => void launchFolderStore.getState().useProjectFolder().catch(folderSaveFailed)}
          className="justify-start gap-2 px-2 font-normal text-dp-text-2 hover:text-dp-text"
        >
          <Undo2 className="size-3.5" />
          {t.projectFolder}
        </Button>
      )}
      {!compact && recent.length > 0 && (
        <>
          <p className="dp-label px-1 pt-1">{t.recent}</p>
          {recent.slice(0, SHOWN_RECENT).map((path) => (
            <Button
              key={path}
              type="button"
              variant="ghost"
              size="sm"
              data-recent-folder
              title={path}
              onClick={() => void launchFolderStore.getState().choose(path).catch(folderSaveFailed)}
              className="justify-start gap-2 px-2 font-normal text-dp-text-2 hover:text-dp-text"
            >
              <Folder className="size-3.5" />
              <span className="min-w-0 truncate">{folderName(path)}</span>
            </Button>
          ))}
        </>
      )}
    </div>
  );
}
