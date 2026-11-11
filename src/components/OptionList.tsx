import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * One choice among a few, as a column of options with a radio dot: a single-choice
 * ToggleGroup, which Radix exposes as a radiogroup of radios (arrows move, Space picks).
 */
export function OptionList<T extends string>({
  label,
  value,
  onValueChange,
  className,
  children,
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ToggleGroup
      type="single"
      orientation="vertical"
      spacing={0.5}
      aria-label={label}
      value={value}
      // A click on the chosen option would leave none chosen: a radio stays on.
      onValueChange={(next) => next && onValueChange(next as T)}
      className={cn("w-full", className)}
    >
      {children}
    </ToggleGroup>
  );
}

/** An option: the dot fills when chosen, so the choice does not rest on the tint alone. */
export function OptionItem({ value, label, help, disabled, className }: { value: string; label: string; help?: ReactNode; disabled?: boolean; className?: string }) {
  const helpId = useId();
  return (
    <ToggleGroupItem
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-describedby={help ? helpId : undefined}
      className={cn(
        "h-auto min-h-8 w-full items-start justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal whitespace-normal text-dp-text transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none hover:bg-dp-hover hover:text-dp-text focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-dp-accent/70 data-[state=on]:bg-dp-accent-soft disabled:opacity-100 disabled:text-dp-text-3",
        className,
      )}
    >
      {/* Centred on the first line of the label (20px line, 14px dot). */}
      <span
        aria-hidden
        className="mt-0.75 size-3.5 shrink-0 rounded-full border border-dp-text-3 group-data-[state=on]/toggle:border-4 group-data-[state=on]/toggle:border-dp-accent"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {help && (
          <span id={helpId} className="text-xs text-dp-text-2">
            {help}
          </span>
        )}
      </span>
    </ToggleGroupItem>
  );
}
