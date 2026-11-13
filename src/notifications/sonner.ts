import { toast as sonner, type ExternalToast } from "sonner";
import { capture, type ToastKind } from "./capture";

// Everything else sonner exports (the Toaster, useSonner, the types) comes through untouched.
export * from "sonner";

type Message = Parameters<typeof sonner>[0];
type Open = (message: Message, data?: ExternalToast) => string | number;

/** A call that shows a popup and hands what it showed to the notification history, under the id it was shown with. */
const recorded =
  (kind: ToastKind, open: Open): Open =>
  (message, data) => {
    const id = open(message, data);
    capture({ kind, title: message, description: data?.description, action: data?.action, toastId: data?.id ?? id });
    return id;
  };

/**
 * sonner's `toast`, with every popup it shows also recorded in the notification history (`./store`).
 * `vite.config.ts` sends every import of "sonner" here (`scripts/route-sonner.mjs`), so no call site changes and
 * a new one is recorded too. What a popup shows, and how it behaves, is sonner's own: the call is passed through
 * as it came, and its id returned. `loading` and `promise` are passed through unrecorded: a loading popup is
 * replaced by its outcome, which sonner publishes by itself where this cannot see it, and the app uses neither.
 */
export const toast = Object.assign(
  recorded("plain", (message, data) => sonner(message, data)),
  {
    message: recorded("plain", (message, data) => sonner.message(message, data)),
    success: recorded("success", (message, data) => sonner.success(message, data)),
    info: recorded("info", (message, data) => sonner.info(message, data)),
    warning: recorded("warning", (message, data) => sonner.warning(message, data)),
    error: recorded("error", (message, data) => sonner.error(message, data)),
    // A popup that is a component has no text to read: its call site says it (`withPlane({ text })`).
    custom: ((jsx, data) => {
      const id = sonner.custom(jsx, data);
      capture({ kind: "plain", title: undefined, toastId: data?.id ?? id });
      return id;
    }) as typeof sonner.custom,
    loading: ((message, data) => sonner.loading(message, data)) as typeof sonner.loading,
    promise: ((promise, data) => sonner.promise(promise, data)) as typeof sonner.promise,
    dismiss: ((id) => sonner.dismiss(id)) as typeof sonner.dismiss,
    getHistory: () => sonner.getHistory(),
    getToasts: () => sonner.getToasts(),
  },
) as typeof sonner;
