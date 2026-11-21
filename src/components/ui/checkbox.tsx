import * as React from "react"
import { cn } from "@/lib/utils"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group/checkbox relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-dp-text-3 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-dp-accent/70 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-dp-danger aria-invalid:ring-2 aria-invalid:ring-dp-danger data-checked:border-dp-accent data-checked:bg-dp-accent data-checked:text-dp-on-accent data-[state=indeterminate]:border-dp-accent data-[state=indeterminate]:bg-dp-accent data-[state=indeterminate]:text-dp-on-accent",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon className="group-data-[state=indeterminate]/checkbox:hidden" />
        <MinusIcon className="hidden group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
