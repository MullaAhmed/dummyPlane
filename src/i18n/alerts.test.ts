import { describe, expect, it } from "vitest";
import { accountsMessages } from "@/accounts/messages";
import { agentsMessages } from "@/agents/messages";
import { appMessages } from "@/app/messages";
import { canvasMessages } from "@/canvas/messages";
import { commandsMessages } from "@/commands/messages";
import { fleetMessages } from "@/fleet/messages";
import { homeMessages } from "@/home/messages";
import { kanbanMessages } from "@/kanban/messages";
import { loopsMessages } from "@/loops/messages";
import { missionMessages } from "@/mission/messages";
import { nodesMessages } from "@/nodes/messages";
import { noteMessages } from "@/nodes/note/messages";
import { outputMessages } from "@/nodes/output/messages";
import { notesMessages } from "@/notes/messages";
import { presetsMessages } from "@/presets/messages";
import { shellMessages } from "@/shell/messages";
import { storeMessages } from "@/store/messages";
import { studioMessages } from "@/studio/messages";
import { messages } from "./index";

const agents = messages(agentsMessages);
const app = messages(appMessages);
const shell = messages(shellMessages);
const home = messages(homeMessages);
const commands = messages(commandsMessages);

/** Every error toast's title and next-step line rewritten for the Alerts rules: what failed, in the app's words. */
const TITLES: [string, string][] = [
  [messages(accountsMessages).failed, "Could not change the Claude profiles"],
  [agents.launchFailed, "Could not launch the agent"],
  [agents.fleetFailed, "Could not create the fleet"],
  [agents.settingNotSaved, "Could not save the setting"],
  [agents.launchFolder.saveFailed, "Could not save the launch folder"],
  [agents.install.terminalFailed, "Could not open the install terminal"],
  [agents.remote.notChanged(true), "Could not turn on Remote Control"],
  [agents.remote.notChanged(false), "Could not turn off Remote Control"],
  [agents.remote.failedFor("Batman", true), "Could not turn on Remote Control for Batman"],
  [app.settingNotSaved, "Could not save the setting"],
  [app.updateCheckFailed, "Could not check for updates"],
  [app.startFailed, "dummyPlane could not start"],
  [messages(canvasMessages).saveFailed, "Could not save the canvas"],
  [messages(canvasMessages).selection.copyFailed, "Could not copy the terminal"],
  [messages(canvasMessages).selection.pickFolderFailed, "Could not open the folder picker"],
  [commands.failed("Overview"), "Overview failed"],
  [commands.failedLike["terminal.duplicate"]!, "Could not duplicate the terminal"],
  [commands.failedLike["workspace.new"]!, "Could not create the workspace"],
  [commands.failedLike["workspace.delete"]!, "Could not delete the workspace"],
  [commands.failedLike["group.linkFleet"]!, "Could not create the fleet"],
  [commands.goTo.openFailed, "Could not open the project"],
  [messages(fleetMessages).agent.notSaved, "Could not save the Fleet's agent"],
  [home.addFailed, "Could not add the project"],
  [home.start.agentsFailed, "Could not look for the installed agents"],
  [home.noAgent.openFailed, "Could not open the project"],
  [home.noAgent.recheckFailed, "Could not check the agents again"],
  [home.card.openFailed, "Could not open the project"],
  [home.card.renameFailed, "Could not rename the project"],
  [home.card.changeFailed, "Could not change the project's folder"],
  [home.card.removeFailed, "Could not remove the project"],
  [messages(kanbanMessages).placeFailed, "Could not create the Kanban board"],
  [messages(kanbanMessages).github.failed, "Could not reach GitHub"],
  [messages(loopsMessages).dialog.failed, "Could not change the loops"],
  [messages(missionMessages).overnight.linearFailed, "Linear's sign-in did not finish"],
  [messages(missionMessages).cleanFailed, "Could not clean up the mission"],
  [messages(nodesMessages).terminal.duplicateFailed, "Could not duplicate the terminal"],
  [messages(noteMessages).addFailed, "Could not add the note"],
  [messages(outputMessages).copyFailed, "Could not copy to the clipboard"],
  [messages(notesMessages).openFailed, "Could not open the notes"],
  [messages(presetsMessages).toast.failed, "Could not change the presets"],
  [messages(storeMessages).saveFailed, "Could not save your last change"],
  [messages(studioMessages).saveFailed("src/a.ts"), "Could not save src/a.ts"],
  [shell.scene.exportFailed, "Could not export the scene"],
  [shell.scene.importFailed, "Could not import the scene"],
  [shell.tabs.renameFailed, "Could not rename the workspace"],
  [shell.tabs.deleteFailed, "Could not delete the workspace"],
  [shell.tabs.createFailed, "Could not create the workspace"],
  [shell.tabs.folderFailed, "Could not change the workspace's folder"],
  [shell.window.minimizeFailed, "Could not minimize the window"],
  [shell.window.restoreFailed, "Could not restore the window"],
  [shell.window.maximizeFailed, "Could not maximize the window"],
  [shell.window.closeFailed, "Could not close the window"],
  [shell.projectPicker.openFailed, "Could not open the project"],
  [shell.projectView.loadFailed, "Could not load the workspaces"],
];

/** What to do next, under a title, where the app knows it. */
const NEXT: [string, string][] = [
  [agents.launchNext, "Check that the agent is installed and its folder exists, then try again"],
  [agents.settingForNow, "It applies for now; dummyPlane will not remember it after a restart"],
  [app.settingForNow, "It applies for now; dummyPlane will not remember it after a restart"],
  [app.updateCheckNext, "Check your connection, then try again"],
  [messages(fleetMessages).agent.forNow, "It applies for now; dummyPlane will not remember it after a restart"],
  [messages(studioMessages).saveNext, "Your changes stay in the tab: save again"],
];

describe("error toasts in the app's voice (docs/design-system.md, Alerts)", () => {
  it("says what failed in a plain sentence of its own", () => {
    for (const [actual, expected] of TITLES) expect(actual).toBe(expected);
  });

  it("says what to do next in one short sentence", () => {
    for (const [actual, expected] of NEXT) expect(actual).toBe(expected);
  });

  it("keeps them short and calm: no exclamation mark, no trailing period, no error class or code", () => {
    for (const [text] of [...TITLES, ...NEXT]) {
      expect(text, text).not.toMatch(/!|\.$|Error:|os error|\$\{/);
      expect(text.length, text).toBeLessThanOrEqual(80);
    }
  });

  it("titles every Windows notification with the agent and its state, the finish's format", () => {
    expect(shell.notification.title("Batman", shell.notification.waiting)).toBe("Batman · Waiting");
    expect(shell.notification.title("Batman", shell.finishAlert.states.done)).toBe("Batman · Done");
    expect(shell.notification.question).toBe("Has a question for you");
    // The notice in the window keeps its own line, which names the agent.
    expect(shell.waitingNotice.question("Batman")).toBe("Batman has a question");
  });
});
