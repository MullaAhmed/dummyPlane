import { toast } from "sonner";
import { messages } from "@/i18n";
import { onSettingKept } from "@/ipc/db";
import { appMessages } from "./messages";

/**
 * A saved list, by its key, in the words the user knows it by. The keys are those of the stores (`loops.list`,
 * `presets.teams`, `command.history.<project>`, `launch.folder.<project>`, `ui.notifications`,
 * `ui.workspaceOrder.<project>`, `agents.modelRouterLevels`); any other setting says its key.
 */
function titleOf(key: string): string {
  const t = messages(appMessages).resetList;
  if (key === "loops.list") return t.loops;
  if (key === "presets.teams") return t.presets;
  if (key.startsWith("command.history.")) return t.history;
  if (key.startsWith("launch.folder.")) return t.folders;
  if (key === "ui.notifications") return t.notifications;
  if (key.startsWith("ui.workspaceOrder.")) return t.order;
  if (key === "agents.modelRouterLevels") return t.levels;
  return t.other(key);
}

let installed = false;

/**
 * Says, once, when a write replaced a saved list that could not be read: which one, and where its old text is kept
 * in the settings, so that nothing it held is lost. Rust tells only the first time a text is kept
 * (`settings::set`), so a list is not told again after the next start. In the notification history like any popup.
 */
export function installResetNotice() {
  if (installed) return;
  installed = true;
  onSettingKept((key, aside) => toast.warning(titleOf(key), { description: messages(appMessages).resetList.kept(aside) }));
}
