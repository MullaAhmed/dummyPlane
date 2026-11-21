import { stateWords } from "@/agents/messages";
import { defineMessages } from "@/i18n";
import type { KanbanAgentStatus } from "@/nodes/types";

/** The texts of the board's card and its dialog that came after `messages.ts`: read beside it, never instead of it. */
export const kanbanBoardMessages = defineMessages<{
  titleRequired: string;
  agentState: Record<KanbanAgentStatus, string>;
  github: string;
}>({
  // Said under the title field when Save finds it empty.
  titleRequired: "A card needs a title",
  // After the agent's name on its chip: the alert in a word, not in the chip's colour alone.
  agentState: { blocked: stateWords.blocked, failed: stateWords.failed },
  github: "GitHub",
});
