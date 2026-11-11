import { createContext, useContext, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * What generated output may do when the user acts on it. Its text comes from
 * an agent: it is data, so nothing runs by itself. A link opens in the
 * browser through the opener, and only an http(s) one; a Button sends its
 * message to the agent the output came from, on the user's click only.
 */
export interface OutputActions {
  /** Sends a Button's message to the output's agent; absent where no agent listens (the Button is then disabled). */
  send?: (message: string, label: string) => void;
}

const ActionsContext = createContext<OutputActions>({});

export function OutputActionsProvider({ value, children }: { value: OutputActions; children: ReactNode }) {
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

export const useOutputActions = () => useContext(ActionsContext);

/** The URL if it is an absolute http(s) one, else null: no `file:`, `javascript:`, relative or custom scheme. */
export function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  // Control characters and spaces never belong in a URL a user should follow.
  if (!/^https?:\/\//i.test(text) || /[\u0000- \u007f]/.test(text)) return null;
  return text;
}

/** Opens an http(s) link in the user's browser; any other is ignored. */
export function openLink(raw: string) {
  const url = httpUrl(raw);
  if (url) void openUrl(url).catch((error: unknown) => console.warn("link not opened", error));
}
