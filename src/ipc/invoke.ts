import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";

export type AppErrorKind = "invalidInput" | "notFound" | "pty" | "io" | "db" | "toolsUnavailable" | "github";

/** Error raised by a Tauri command; mirrors Rust's `AppError` (`{ kind, message }`). */
export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }
}

function isAppErrorPayload(value: unknown): value is { kind: AppErrorKind; message: string } {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

/** `invoke` with Rust errors turned into `AppError` instances. Raw bytes as `args` travel as they are, not as JSON. */
export async function call<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try {
    return await invoke<T>(command, args, options);
  } catch (error) {
    if (isAppErrorPayload(error)) throw new AppError(error.kind, error.message);
    throw new AppError("io", String(error));
  }
}
