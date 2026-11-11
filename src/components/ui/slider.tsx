import * as React from "react"
import { cn } from "@/lib/utils"
import { Slider as SliderPrimitive } from "radix-ui"

/**
 * A horizontal slider of one thumb, on the panel's scale: a 4 px track in the
 * line colour, the part up to the thumb in ink, a 12 px thumb. Its stops are
 * its `step`s; the thumb follows the pointer at once (no slide animation),
 * only its colours fade. The thumb is the control a screen reader meets:
 * `thumbLabel` names it, `valueText` says its value in words.
 */
function Slider({
  className,
  thumbLabel,
  valueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { thumbLabel?: string; valueText?: string }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1 grow overflow-hidden rounded-sm bg-dp-line">
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-dp-text-3" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={thumbLabel}
        aria-valuetext={valueText}
        className="block size-3 shrink-0 rounded-full border border-dp-text-2 bg-dp-surface transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) outline-none after:absolute after:-inset-2 hover:border-dp-text focus-visible:ring-2 focus-visible:ring-dp-accent/70 motion-reduce:transition-none"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
