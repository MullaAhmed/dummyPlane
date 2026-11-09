import { defineMessages } from "@/i18n";

const AGO = defineMessages({
  now: "just now",
  ago: (count: number, unit: "min" | "h" | "d") => `${count} ${unit} ago`,
});

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function formatAgo(timestampMs: number, nowMs = Date.now()): string {
  const t = AGO;
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 60) return t.now;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t.ago(minutes, "min");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.ago(hours, "h");
  return t.ago(Math.floor(hours / 24), "d");
}

/** "1 agent active", "3 agents active": singular for 1 only. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "45 s", "12 min", "1 h 05": how long an agent has been in its state (spec habillage §10.4). */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
