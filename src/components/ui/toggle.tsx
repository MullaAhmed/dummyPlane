import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-[color,background-color,border-color] motion-reduce:active:scale-100 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-dp-accent/70 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        // The house look of "one of a few" (filters, segmented choices, due dates, widths): its skin is in
        // compoundVariants below, so it outranks the sizes' text and min width.
        choice: "",
        // A colour to pick: a round swatch, ringed in the accent when chosen. The colour is the caller's.
        swatch: "",
      },
      size: {
        xs: "h-6 min-w-6 px-1.5 py-0",
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-md px-2.5 text-(length:--text-ui) has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    compoundVariants: [
      {
        // The chosen one: the accent's tint and an accent border (8:1 or more), so the choice never rests
        // on the 1.2-1.4:1 tint alone. The border is there, transparent, at rest: nothing moves when chosen.
        variant: "choice",
        class:
          "min-w-0 rounded-md border border-transparent text-xs font-normal text-dp-text-2 hover:bg-dp-hover hover:text-dp-text aria-pressed:border-dp-accent aria-pressed:bg-dp-accent-soft aria-pressed:text-dp-text data-[state=on]:border-dp-accent data-[state=on]:bg-dp-accent-soft data-[state=on]:text-dp-text",
      },
      {
        // Read on aria-checked (a single-choice group's radio): a hint's trigger takes over data-state.
        variant: "swatch",
        class:
          "size-6 min-w-0 rounded-full p-0 ring-offset-2 ring-offset-dp-surface hover:bg-transparent hover:ring-1 hover:ring-dp-text-3 aria-checked:ring-2 aria-checked:ring-dp-accent aria-pressed:ring-2 aria-pressed:ring-dp-accent",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
