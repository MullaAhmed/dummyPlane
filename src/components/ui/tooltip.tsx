"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip as TooltipPrimitive } from "radix-ui"

/** How long the pointer rests on a control before its first hint opens. */
const HINT_DELAY_MS = 400

/** Whether a TooltipProvider is above: the app's one provider, set in App. */
const HasTooltipProvider = React.createContext(false)

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <HasTooltipProvider.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    </HasTooltipProvider.Provider>
  )
}

/**
 * Shares the app's provider, so once one hint is open its neighbours open at once
 * and unanimated (Radix's skip delay; `instant-open` runs no animation). Only a
 * component rendered alone (a test) gets a provider of its own.
 */
function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  if (React.useContext(HasTooltipProvider)) return root
  return <TooltipProvider delayDuration={HINT_DELAY_MS}>{root}</TooltipProvider>
}

/** The keys that move the keyboard on purpose: Tab and Shift+Tab, the arrows of a list or a toolbar. */
const NAVIGATION_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
/** How long a focus counts as that key's: the browser moves it at once, a roving list within a frame. */
const NAVIGATION_MS = 100
let navigatedAt = Number.NEGATIVE_INFINITY

// Read in the capture phase, before any handler moves the focus. Any other key (Enter, Escape) or a press of the
// pointer ends it: the focus the app hands back after them is not the keyboard's moving.
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      const moves = NAVIGATION_KEYS.has(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey
      navigatedAt = moves ? performance.now() : Number.NEGATIVE_INFINITY
    },
    true
  )
  window.addEventListener("pointerdown", () => (navigatedAt = Number.NEGATIVE_INFINITY), true)
}

/** Whether the focus that arrives now was brought by Tab, Shift+Tab or an arrow. */
function focusFromNavigation(): boolean {
  return performance.now() - navigatedAt < NAVIGATION_MS
}

/**
 * A hint opens on hover, and on a focus only when Tab, Shift+Tab or an arrow brought it: never on a focus the
 * app hands back (a menu, a dialog or a panel that closes, a launch), which would leave it over what it names.
 * A blur closes it (Radix's own).
 */
function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      onFocus={(event) => {
        onFocus?.(event)
        if (!focusFromNavigation()) event.preventDefault()
      }}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs duration-(--dp-dur-fast) ease-(--dp-ease-out) origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-xs bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { HINT_DELAY_MS, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
