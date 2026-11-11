import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Each toast type's tone (docs/design-system.md, Alerts): its own icon shape, drawn in its status colour.
 * Never the colour alone, and the text stays `--dp-text`: the shape and the title say it too.
 */
export const TOAST_TONES = {
  success: "text-dp-ok",
  info: "text-dp-accent-ink",
  warning: "text-dp-wait",
  error: "text-dp-danger",
  loading: "text-dp-text-2",
} as const

/**
 * The parts sonner draws, in the app's own classes: the title, the description a step quieter, the action
 * as the app's outline button and the cancel as its quiet ghost, both with the focus ring and the press.
 * `index.css` hands these parts back from sonner's injected style, or its rules would win over the classes.
 */
export const TOAST_CLASSES = {
  title: "text-(length:--text-ui) font-medium text-dp-text",
  description: "text-xs text-dp-text-2",
  actionButton: buttonVariants({ variant: "outline", size: "sm" }),
  cancelButton: cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-dp-text-2 hover:text-dp-text"),
} as const

/** The app passes its theme (`AppToaster`): sonner follows the palette, light for calm, dark for the two others. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className={cn("size-4", TOAST_TONES.success)} />,
        info: <InfoIcon className={cn("size-4", TOAST_TONES.info)} />,
        warning: <TriangleAlertIcon className={cn("size-4", TOAST_TONES.warning)} />,
        error: <OctagonXIcon className={cn("size-4", TOAST_TONES.error)} />,
        loading: <Loader2Icon className={cn("size-4 motion-safe:animate-spin", TOAST_TONES.loading)} />,
      }}
      style={
        {
          "--normal-bg": "var(--dp-surface)",
          "--normal-text": "var(--dp-text)",
          "--normal-border": "var(--dp-line)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: TOAST_CLASSES }}
      {...props}
    />
  )
}

export { Toaster }
