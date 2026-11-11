import { Route } from "lucide-react";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { IconButton } from "@/shell/buttons";
import { missionMessages } from "./messages";

/**
 * The model router as a sticky switch in a node's header, a terminal's or a Fleet's: the same 28px icon button as
 * the header's others, on until it is turned off. Its name stays "Model router" and its state is `aria-pressed`'s
 * (one name, never "Turn the router off"); on, it takes the accent's tint, which the icon's ink keeps legible in
 * every palette (as the rails' active button). A header shows it from 28rem of node on (`WIDE_ONLY`): a narrower
 * node reaches the same switch in its Edit tab.
 */
export function RouterToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useMessages(missionMessages);
  return (
    <IconButton
      label={t.routerSwitch}
      aria-pressed={on}
      data-router={on ? "on" : "off"}
      onClick={() => onChange(!on)}
      className={cn(on && "bg-dp-accent-soft text-dp-accent-ink hover:bg-dp-accent-soft hover:text-dp-accent-ink")}
    >
      <Route />
    </IconButton>
  );
}
