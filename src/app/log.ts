import { invoke } from "@tauri-apps/api/core";
import { LogLevel } from "@tauri-apps/plugin-log";

export interface LogTarget {
  warn: (message: string) => Promise<void>;
  error: (message: string) => Promise<void>;
}

/** The plugin names the log's target after the caller's stack (`webview::write@http://localhost:1420/src/app/log.ts:12:54`): a short one reads better. */
const send = (level: LogLevel) => (message: string) => invoke<void>("plugin:log|log", { level, message, location: "webview" });

/** A line in the log file for what is no warning (`console.info` does not reach it): never fails the caller. */
export function logInfo(message: string) {
  try {
    void send(LogLevel.Info)(message).catch(() => undefined);
  } catch {
    // No Tauri here (a test, a static preview): the line is lost, nothing else.
  }
}

/** One value as text; an object whose `toString` throws, or without prototype, never fails the caller. */
function show(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * `console.error("%s failed: %o", name, error)`: each format directive takes the next value, wherever it stands, as
 * the console fills it (React's errors start with them); `%c` takes a style, which is no text, and `%%` is a percent
 * sign. A directive with no value left stays as written; values left over follow.
 */
const DIRECTIVE = /%[oOdisfc%]/g;

const text = (values: unknown[]) => {
  const [first, ...rest] = values;
  if (typeof first !== "string") return values.map(show).join(" ").trim();
  let next = 0;
  const line = first.replace(DIRECTIVE, (directive) => {
    if (directive === "%%") return "%";
    if (next >= rest.length) return directive;
    const value = rest[next++];
    return directive === "%c" ? "" : show(value);
  });
  return [line, ...rest.slice(next).map(show)].join(" ").trim();
};

/**
 * Console warnings and errors, uncaught errors and unhandled rejections also go
 * to the log file a user can send. Writing to the
 * file never fails the caller.
 */
export function installLogging(target: LogTarget = { warn: send(LogLevel.Warn), error: send(LogLevel.Error) }, cons: Console = console, win: Window = window) {
  const write = (level: keyof LogTarget, message: string) => void target[level](message).catch(() => undefined);
  for (const level of ["warn", "error"] as const) {
    const original = cons[level].bind(cons);
    cons[level] = (...values: unknown[]) => {
      original(...values);
      write(level, text(values));
    };
  }
  win.addEventListener("error", (event) => {
    const { error, message } = event as ErrorEvent;
    write("error", `uncaught: ${text([error ?? message])}`);
  });
  win.addEventListener("unhandledrejection", (event) => write("error", `unhandled rejection: ${text([(event as PromiseRejectionEvent).reason])}`));
}
