import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-dp-line bg-transparent px-2.5 py-1 text-sm text-dp-text transition-[color,background-color,border-color] duration-(--dp-dur-fast) ease-(--dp-ease-out) outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-dp-text placeholder:text-dp-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-dp-danger aria-invalid:ring-2 aria-invalid:ring-dp-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
