import { openLogDir } from "@/app/logs";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { AccentButton } from "./buttons";
import { shellMessages } from "./messages";
import { TitleBar } from "./TitleBar";
import { showTroubleshooting } from "./troubleshoot";

/** Reloading the interface runs the start again; the agents keep running in Rust and are found again. */
const reload = () => location.reload();

/**
 * Loading and error screens keep the title bar: the window stays movable and closable. A failed start is no dead
 * end: it says what failed, and offers to try again, the logs and the troubleshooting dialog.
 */
export function StatusScreen({ message, failed = false, retry = reload }: { message: string; failed?: boolean; retry?: () => void }) {
  const t = useMessages(shellMessages).statusScreen;
  return (
    <div className="dp-ambient flex h-screen flex-col">
      <TitleBar leading={<span className="text-(length:--text-ui) font-medium text-dp-text">dummyPlane</span>} />
      {failed ? (
        <div role="alert" className="grid flex-1 place-items-center px-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <p className="text-sm text-dp-text">{message}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <AccentButton onClick={retry}>{t.tryAgain}</AccentButton>
              <Button variant="outline" onClick={() => void openLogDir()} className="px-3 text-(length:--text-ui) font-normal">
                {t.openLogs}
              </Button>
              <Button variant="ghost" onClick={() => void showTroubleshooting()} className="px-3 text-(length:--text-ui) font-normal text-dp-text-2 hover:text-dp-text">
                {t.troubleshooting}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div role="status" className="grid flex-1 place-items-center text-sm text-dp-text-2">
          {message}
        </div>
      )}
    </div>
  );
}
