import { createContext, useContext, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * The view switcher of a panel's bar (git window, review panel, notes): shadcn's Tabs in the
 * house skin, small soft tabs with the chosen one in the accent's tint, the same in every palette.
 * The chosen soft tab is bordered in the accent as well: the tint alone reads 1.2-1.4:1 on the surface.
 * A panel whose tabs head its whole body (a terminal's edit panel) takes the line look instead:
 * the labels on a hairline, the chosen one underlined in ink.
 * Both follow the design system: hover tints with --dp-hover (the line look, which has no padding
 * to fill, darkens its label), the chosen one keeps its tint under the pointer, nothing moves or
 * changes size on hover, the focus ring shows on the keyboard only, and only the listed properties
 * transition, on the motion tokens.
 */

/** Radix picks a tab on mousedown, keys and focus; a bare click (assistive tech, scripts) picks it too. */
const Pick = createContext<((value: string) => void) | null>(null);

type Look = "soft" | "line";
/** The list's look, for its tabs. */
const LookOf = createContext<Look>("soft");

const SOFT =
  "h-7 flex-none rounded-md border-transparent px-2.5 py-0 text-xs font-normal text-dp-text-2 transition-[background-color,border-color,color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none hover:bg-dp-hover hover:text-dp-text active:scale-[0.97] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none";

/**
 * As wide as its label, no side padding: the first label starts on the panel's edge, under its
 * title. The underline is shadcn's line one (the ::after), moved onto the list's hairline; the
 * focus ring stands 2 px off the label.
 */
const LINE =
  "h-8 flex-none rounded-sm border-transparent px-0 py-0 text-(length:--text-ui) font-normal text-dp-text-2 transition-[color] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none hover:text-dp-text focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dp-surface focus-visible:outline-none dark:text-dp-text-2 dark:hover:text-dp-text data-active:bg-transparent data-active:text-dp-text dark:data-active:border-transparent dark:data-active:bg-transparent dark:data-active:text-dp-text after:bg-dp-accent after:duration-(--dp-dur-fast) after:ease-(--dp-ease-out) motion-reduce:after:transition-none group-data-horizontal/tabs:after:-bottom-px";

export function PanelTabs({ onValueChange, className, ...props }: ComponentProps<typeof Tabs>) {
  return (
    <Pick value={onValueChange ?? null}>
      <Tabs onValueChange={onValueChange} className={cn("gap-0", className)} {...props} />
    </Pick>
  );
}

/** `look="line"`: the tabs on a hairline, as wide as their labels. Never a scroller: they must fit. */
export function PanelTabsList({ look = "soft", className, ...props }: Omit<ComponentProps<typeof TabsList>, "variant"> & { look?: Look }) {
  return (
    <LookOf value={look}>
      <TabsList
        variant={look === "line" ? "line" : "default"}
        className={cn(
          "gap-1 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto",
          look === "line" && "justify-start gap-4 border-b border-dp-line",
          className,
        )}
        {...props}
      />
    </LookOf>
  );
}

export function PanelTabsTrigger({ value, onClick, className, ...props }: ComponentProps<typeof TabsTrigger>) {
  const pick = useContext(Pick);
  const look = useContext(LookOf);
  return (
    <TabsTrigger
      value={value}
      onClick={(event) => {
        onClick?.(event);
        pick?.(value);
      }}
      className={cn(
        look === "line" ? LINE : SOFT,
        look === "soft" &&
          "dark:text-dp-text-2 dark:hover:text-dp-text data-active:border-dp-accent data-active:bg-dp-accent-soft data-active:hover:bg-dp-accent-soft data-active:text-dp-text dark:data-active:border-dp-accent dark:data-active:bg-dp-accent-soft dark:data-active:text-dp-text group-data-[variant=default]/tabs-list:data-active:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

/** A view's page: it fills what the bar leaves. Radix makes it a tab stop, so it shows its focus. */
export function PanelTabsContent({ className, ...props }: ComponentProps<typeof TabsContent>) {
  return <TabsContent className={cn("flex min-h-0 flex-col focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dp-accent/70", className)} {...props} />;
}

/** A choice in a panel's bar beside the tabs (a single-choice ToggleGroup): the Toggle's choice look, which the soft tabs match. */
export function PanelToggleItem(props: ComponentProps<typeof ToggleGroupItem>) {
  return <ToggleGroupItem variant="choice" size="sm" {...props} />;
}
