import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AccentButton } from "@/shell/buttons";

/** A question's toast: what it asks, and its two answers, the one that acts first. */
export interface Decision {
  title: string;
  description: string;
  /** An icon of the subject, drawn in the second text role (the resume offer's `History`). */
  icon: LucideIcon;
  action: { label: string; onClick: () => void };
  cancel: { label: string; onClick: () => void };
}

/**
 * Drawn like the resume offer (`ResumeAllToast`), the app's other question in a toast: the alerts' surface and type
 * steps, and the answer that acts as `AccentButton` first (docs/design-system.md, Alerts). The plain toast's action is
 * the outline button, which reads as a side action, not as the answer to a question.
 */
function DecisionToast({ title, description, icon: Icon, action, cancel }: Decision) {
  return (
    <div data-decision-toast className="dp-glass-strong flex w-90 items-start gap-3 rounded-lg p-4 text-dp-text">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-dp-text-2" />
      <div className="min-w-0 flex-1">
        <p className="text-(length:--text-ui) font-medium">{title}</p>
        <p className="text-xs text-dp-text-2">{description}</p>
        <div className="mt-3 flex gap-2">
          <AccentButton size="sm" onClick={action.onClick}>
            {action.label}
          </AccentButton>
          <Button type="button" variant="ghost" size="sm" className="text-dp-text-2 hover:text-dp-text" onClick={cancel.onClick}>
            {cancel.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Shows the question `id` until it is answered or dismissed: a newer one with the same id replaces it in place. */
export function showDecisionToast(id: string, decision: Decision): void {
  toast.custom(() => <DecisionToast {...decision} />, { id, duration: Infinity });
}
