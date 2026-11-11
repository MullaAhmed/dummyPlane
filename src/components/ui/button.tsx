import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-[color,background-color] motion-reduce:active:scale-100 outline-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-dp-danger aria-invalid:ring-2 aria-invalid:ring-dp-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-dp-accent text-dp-on-accent hover:bg-dp-accent/85",
        outline:
          "border-dp-line bg-dp-surface text-dp-text hover:bg-dp-hover hover:text-dp-text aria-expanded:bg-dp-hover aria-expanded:text-dp-text",
        secondary:
          "bg-dp-card text-dp-text hover:bg-dp-hover aria-expanded:bg-dp-hover aria-expanded:text-dp-text",
        ghost:
          "text-dp-text hover:bg-dp-hover hover:text-dp-text aria-expanded:bg-dp-hover aria-expanded:text-dp-text",
        destructive:
          "bg-dp-danger/10 text-dp-danger hover:bg-dp-danger/20 focus-visible:ring-dp-danger",
        link: "text-dp-accent underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-(length:--text-ui) in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
