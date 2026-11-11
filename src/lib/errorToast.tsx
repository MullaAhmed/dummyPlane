import type { ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";

/** The longest detail line a toast shows, in characters; the log keeps it whole. */
export const MAX_DETAIL = 160;

/** "AppError: ", "Error: ", "TypeError: ": the class name `String(error)` puts first. */
const CLASS_PREFIX = /^(?:[A-Z]\w*)?Error:\s*/;
/** Rust's and Windows' "(os error 3)": a code the user can do nothing with. */
const OS_CODE = /\s*\(os error -?\d+\)/gi;

function rawText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  try {
    return String(error);
  } catch {
    return "";
  }
}

/**
 * What went wrong underneath, as a toast's last line shows it: the first line of the error's message, without the
 * class name `String()` puts first, the OS error code or a stack, at most MAX_DETAIL characters. Never a toast's
 * title: the title says in the app's words what failed (docs/design-system.md, Alerts).
 */
export function errorDetail(error: unknown): string {
  const line = rawText(error)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !/^at\s/.test(part));
  const text = (line ?? "").replace(CLASS_PREFIX, "").replace(OS_CODE, "").trim();
  if (text === "" || text === "[object Object]" || text === "undefined" || text === "null") return "";
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1).trimEnd()}…` : text;
}

/** The second and third lines of an error toast: what to do next, then the raw detail, quieter, in the code font. */
function description(next: string | undefined, detail: string): ReactNode {
  if (!next && !detail) return undefined;
  return (
    <>
      {next && <span className="block">{next}</span>}
      {detail && <span className="mt-0.5 line-clamp-2 font-mono break-words text-dp-text-3">{detail}</span>}
    </>
  );
}

export type ErrorToastOptions = Omit<ExternalToast, "description"> & {
  /** The error underneath: its detail shows under the title, quieter, and goes whole to the log. */
  error?: unknown;
  /** What the user can do now, when the app knows: one short sentence from the area's messages. */
  next?: string;
};

/**
 * The app's one error toast (docs/design-system.md, Alerts). `title` is a plain sentence from the area's
 * messages that says what failed, never the error itself: the error's text is Rust's or the OS's wording, so it
 * goes under the title as a detail, and whole to the log, where a user who sends it can be helped.
 */
export function toastError(title: string, { error, next, ...options }: ErrorToastOptions = {}) {
  if (error !== undefined) console.warn(`${title}:`, error);
  const lines = description(next, error === undefined ? "" : errorDetail(error));
  const extra = lines === undefined ? options : { ...options, description: lines };
  return Object.keys(extra).length > 0 ? toast.error(title, extra) : toast.error(title);
}
