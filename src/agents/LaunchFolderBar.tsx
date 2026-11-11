import { Folder, FolderOpen, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { Hint } from "@/shell/buttons";
import { agentsMessages } from "./messages";
import { folderName, folderSaveFailed, launchFolderStore, pickFolder, useLaunchFolder } from "./launchFolder";

/** Recent folders listed in the menu: the store keeps a few more. */
const SHOWN_RECENT = 3;

/** A path in a hint: whole, wrapped anywhere, in the mono face, under what the control does. */
function PathHint({ path, above }: { path: string; above?: string }) {
  return (
    <span className="flex flex-col">
      {above && <span>{above}</span>}
      <span className={above ? "break-all font-mono opacity-70" : "break-all font-mono"}>{path}</span>
    </span>
  );
}

/**
 * Where the next terminals of the workspace start (the "Launch folder"): its name, its full path
 * in the app's hint (on hover, and on Change… for the keyboard), a button to pick another one,
 * the recent ones, and the way back to the project's own.
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
        {/* The full path on hover: the name alone is what fits. Change… says it too, for the keyboard. */}
        <Hint label={<PathHint path={folder} />}>
          <div data-launch-folder-box className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-dp-field px-2">
            <FolderOpen className="size-3.5 shrink-0 text-dp-text-2" aria-hidden />
            <span data-launch-folder-name className="min-w-0 flex-1 truncate text-(length:--text-ui) font-medium text-dp-text">
              {folderName(folder)}
            </span>
          </div>
        </Hint>
        <Hint label={<PathHint above={t.changeTooltip} path={folder} />}>
          <Button type="button" variant="outline" size="sm" onClick={() => void change()}>
            {t.change}
          </Button>
        </Hint>
      </div>
      {custom && (
        <Hint label={<PathHint above={t.backToProject} path={projectFolder} />}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void launchFolderStore.getState().useProjectFolder().catch(folderSaveFailed)}
            className="justify-start gap-2 px-2 font-normal text-dp-text-2 hover:text-dp-text"
          >
            <Undo2 className="size-3.5" />
            {t.projectFolder}
          </Button>
        </Hint>
      )}
      {!compact && recent.length > 0 && (
        <>
          <p className="dp-label px-1 pt-1">{t.recent}</p>
          {recent.slice(0, SHOWN_RECENT).map((path) => (
            <Hint key={path} label={<PathHint path={path} />}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-recent-folder
                onClick={() => void launchFolderStore.getState().choose(path).catch(folderSaveFailed)}
                className="justify-start gap-2 px-2 font-normal text-dp-text-2 hover:text-dp-text"
              >
                <Folder className="size-3.5" />
                <span className="min-w-0 truncate">{folderName(path)}</span>
              </Button>
            </Hint>
          ))}
        </>
      )}
    </div>
  );
}
