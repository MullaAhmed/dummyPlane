import { toast } from "sonner";
import { messages } from "@/i18n";
import { onSettingKept } from "@/ipc/db";
import { appMessages } from "./messages";

/**
 * A saved list, by its key, in the words the user knows it by. The keys are those of the stores (`loops.list`,
 * `presets.teams`, `command.history.<project>`, `launch.folder.<project>`, `ui.notifications`,
 * `ui.workspaceOrder.<project>`, `agents.modelRouterLevels`); any other setting says its key.
 */
type List = "loops" | "presets" | "history" | "folders" | "notifications" | "order" | "levels";

function listOf(key: string): List | null {
  if (key === "loops.list") return "loops";
  if (key === "presets.teams") return "presets";
  if (key.startsWith("command.history.")) return "history";
  if (key.startsWith("launch.folder.")) return "folders";
  if (key === "ui.notifications") return "notifications";
  if (key.startsWith("ui.workspaceOrder.")) return "order";
  if (key === "agents.modelRouterLevels") return "levels";
  return null;
}

function titleOf(key: string, some: boolean): string {
  const t = messages(appMessages).resetList;
  const list = listOf(key);
  if (!list) return t.other(key);
  // The notification history has no "some": its old entries are dropped on purpose.
  return some && list !== "notifications" ? t.some[list] : t[list];
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
  onSettingKept((key, aside, some) => toast.warning(titleOf(key, some), { description: messages(appMessages).resetList.kept(aside) }));
}
