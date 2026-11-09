import { call } from "./invoke";

export const ping = () => call<string>("ping");

/** Whether the Claude sessions' built-in Agent/Task tool is denied in favour of spawn_agent (a runtime switch: running sessions follow it). */
export const setSubagentTerminals = (on: boolean) => call<void>("set_subagent_terminals", { on });
