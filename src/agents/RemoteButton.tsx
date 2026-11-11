import { Smartphone } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messages, useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { IconButton } from "@/shell/buttons";
import { agentsMessages } from "./messages";
import { remoteErrorText, setRemoteControl, toastRemoteFailure, useRemoteLink, type RemoteLink } from "./remoteControl";

/** What the phone icon says. */
export function remoteLabel(link: RemoteLink | undefined, wanted: boolean, running: boolean): string {
  const t = messages(agentsMessages).remote;
  if (link?.state === "on") return t.on;
  if (link?.state === "connecting") return t.connecting;
  if (link?.state === "pending") return t.pending;
  if (link?.state === "error") return t.error(link.error ? remoteErrorText(link.error) : t.failed);
  if (wanted) return running ? t.requested : t.nextStart;
  return t.label;
}

/** The actions of the menu: while the state is an error, Remote Control may still be on, so cutting stays offered next to retrying. */
export function remoteActions(link: RemoteLink | undefined, wanted: boolean): ("turnOn" | "turnOff" | "retry")[] {
  if (link?.state === "error") return ["turnOff", "retry"];
  return [wanted ? "turnOff" : "turnOn"];
}

/** Turns Remote Control on or off: now for a running session, at its next start otherwise; a failure says why in a toast. */
export function switchRemote(nodeId: string, on: boolean) {
  void setRemoteControl(nodeId, on).then((result) => {
    if (result && "error" in result) toastRemoteFailure(messages(agentsMessages).remote.notChanged(on), result.error);
  });
}

/** Remote Control of one Claude session, in its header (spec update §2). */
export function RemoteButton({ nodeId, wanted, running }: { nodeId: string; wanted: boolean; running: boolean }) {
  const t = useMessages(agentsMessages).remote;
  const link = useRemoteLink(nodeId);
  const label = remoteLabel(link, wanted, running);
  const url = link?.url;
  return (
    <DropdownMenu>
      {/* The same 28 px icon button and hint as the header's others; the hint stays shut while the menu is open and when the menu hands the focus back. */}
      <DropdownMenuTrigger asChild>
        <IconButton
          label={label}
          data-remote={link?.state ?? (wanted ? "wanted" : "off")}
          className={cn(
            // Connecting is said by the hint and a dimmer icon, not a pulse: only a waiting agent's dot moves.
            link?.state === "on" ? "text-dp-accent-ink hover:text-dp-accent-ink" : link?.state === "error" ? "text-dp-danger hover:text-dp-danger" : wanted ? "text-dp-text" : "",
            (link?.state === "connecting" || link?.state === "pending") && "opacity-60",
          )}
        >
          <Smartphone />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {remoteActions(link, wanted).map((action) => (
          // Retrying repeats what failed: a cut that failed is cut again.
          <DropdownMenuItem key={action} onSelect={() => switchRemote(nodeId, action === "turnOn" || (action === "retry" && wanted))}>
            {t[action]}
          </DropdownMenuItem>
        ))}
        {url && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(url).then(() => toast(t.linkCopied))}>{t.copyLink}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void openUrl(url)}>{t.openInBrowser}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
