import { signalWire } from "@/canvas/wireActivity";

/** Stub until the wires branch lands (CONTRACT.md): a message passed from `fromId` to `toId`. */
export function talk(fromId: string, toId: string): void {
  signalWire(toId, "toAgent", fromId);
}
