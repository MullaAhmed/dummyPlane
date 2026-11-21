import { showTroubleshooting } from "@/shell/troubleshoot";

/**
 * "About dummyPlane" of the palette: the version and what the app is stand at the head of Troubleshooting, a dialog that
 * stays, where a toast would go in a few seconds, and holds the version a bug report needs.
 */
export function showAbout() {
  return showTroubleshooting({ instant: true });
}
