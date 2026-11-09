import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-dp-line bg-transparent px-2.5 py-1 text-base text-dp-text transition-[color,background-color,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-dp-text placeholder:text-dp-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-dp-danger aria-invalid:ring-2 aria-invalid:ring-dp-danger/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
