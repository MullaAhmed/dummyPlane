import * as React from "react"
import { cn } from "@/lib/utils"

/** Wears the same skin as Input (border, text size, placeholder, focus, invalid, disabled); only its height differs. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-dp-line bg-transparent px-2.5 py-2 text-sm text-dp-text transition-[color,background-color,border-color,box-shadow] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none outline-none placeholder:text-dp-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-dp-danger aria-invalid:ring-2 aria-invalid:ring-dp-danger/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
