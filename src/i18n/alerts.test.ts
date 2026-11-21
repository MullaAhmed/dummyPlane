import { describe, expect, it } from "vitest";
import { accountsMessages } from "@/accounts/messages";
import { agentsMessages } from "@/agents/messages";
import { appMessages } from "@/app/messages";
import { canvasMessages } from "@/canvas/messages";
import { commandsMessages } from "@/commands/messages";
import { fleetMessages } from "@/fleet/messages";
import { gitMessages } from "@/git/messages";
import { homeMessages } from "@/home/messages";
import { kanbanMessages } from "@/kanban/messages";
import { loopsMessages } from "@/loops/messages";
import { missionMessages } from "@/mission/messages";
import { nodesMessages } from "@/nodes/messages";
import { noteMessages } from "@/nodes/note/messages";
import { outputMessages } from "@/nodes/output/messages";
import { notesMessages } from "@/notes/messages";
import { presetsMessages } from "@/presets/messages";
import { reviewMessages } from "@/review/messages";
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
  [app.resetList.loops, "Your loops could not be read and start empty"],
  [app.resetList.presets, "Your team presets could not be read and start empty"],
  [app.resetList.history, "A project's command history could not be read and starts empty"],
  [app.resetList.folders, "A project's recent folders could not be read and start empty"],
  [app.resetList.notifications, "Your notification history could not be read and starts empty"],
  [app.resetList.order, "A project's workspace order could not be read and starts again"],
  [app.resetList.levels, "Your model router levels could not be read and start again"],
  [app.resetList.other("ui.theme"), "The setting ui.theme could not be read and starts again"],
  [app.resetList.some.loops, "Some of your loops could not be read and were left out"],
  [app.resetList.some.presets, "Some of your team presets could not be read and were left out"],
  [app.resetList.some.history, "Part of a project's command history could not be read and was left out"],
  [app.resetList.some.folders, "Some of a project's recent folders could not be read and were left out"],
  [app.resetList.some.levels, "Some of your model router levels could not be read and were left out"],
  [app.resetList.some.order, "Part of a project's workspace order could not be read and was left out"],
  [app.startFailed, "dummyPlane could not start"],
  [messages(canvasMessages).saveFailed, "Could not save the canvas"],
  [messages(canvasMessages).imagesNotSaved, "Could not save the images of the canvas"],
  [messages(canvasMessages).selection.copyFailed, "Could not copy the terminal"],
  [messages(canvasMessages).selection.pickFolderFailed, "Could not open the folder picker"],
  [commands.failed("Overview"), "Overview failed"],
  [commands.failedLike["terminal.duplicate"]!, "Could not duplicate the terminal"],
  [commands.failedLike["workspace.new"]!, "Could not create the workspace"],
  [commands.failedLike["workspace.delete"]!, "Could not delete the workspace"],
  [commands.failedLike["group.linkFleet"]!, "Could not create the fleet"],
  [commands.goTo.openFailed, "Could not open the project"],
  [commands.goTo.openFileFailed, "Could not open the file"],
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
  [shell.projectPicker.closeFailed, "Could not close the project"],
  [shell.projectView.loadFailed, "Could not load the workspaces"],
];

/** What to do next, under a title, where the app knows it. */
const NEXT: [string, string][] = [
  [agents.launchNext, "Check that the agent is installed and its folder exists, then try again"],
  [agents.settingForNow, "It applies for now; dummyPlane will not remember it after a restart"],
  [app.settingForNow, "It applies for now; dummyPlane will not remember it after a restart"],
  [app.updateCheckNext, "Check your connection, then try again"],
  [app.resetList.kept("loops.list.unreadable"), "The old text is kept in the settings as loops.list.unreadable"],
  [messages(fleetMessages).agent.forNow, "It applies for now; dummyPlane will not remember it after a restart"],
  [messages(studioMessages).saveNext, "Your changes stay in the tab: save again"],
];

/** The problems shown inside panels (InlineProblem): a title in the app's words and a next step, as a toast's. */
const git = messages(gitMessages).problem;
const review = messages(reviewMessages).problem;
const studio = messages(studioMessages);
const loops = messages(loopsMessages).dialog;
const INLINE: [string, string][] = [
  [git.rejected("origin/main"), "Push refused: origin/main has commits this branch does not have"],
  [git.rejectedNext, "Pull them in a terminal here, then push again"],
  [git.push("origin/main"), "Could not push to origin/main"],
  [git.pushNext, "Push from a terminal here to see what git asks for"],
  [git.overwritten("side"), "Could not switch to side: your uncommitted changes would be overwritten"],
  [git.overwrittenNext, "Commit or discard them first, then switch"],
  [git.switch("side"), "Could not switch to side"],
  [git.switchNext, "The branch did not change: refresh, then try again"],
  [git.commit, "Could not commit"],
  [git.commitNext, "Your message and choices are kept: fix what git says, then commit again"],
  [git.identity, "Git does not know who you are"],
  [git.identityNext, "Set user.name and user.email with git config in a terminal"],
  [git.discard("src/a.ts"), "Could not discard src/a.ts"],
  [git.discardNext, "Look at the file again, then discard it again"],
  [git.branches, "Could not list the branches"],
  [git.branchesNext, "Refresh, then open the menu again"],
  [git.read, "Could not read the repository"],
  [git.diff("src/a.ts"), "Could not read the diff of src/a.ts"],
  [git.history, "Could not read the history"],
  [git.readNext, "Refresh to read it again"],
  [git.notRepo, "This folder is not a git repository"],
  [git.notRepoNext, "Run git init in a terminal here, then refresh"],
  [git.locked, "Another git command is using this repository"],
  [git.lockedNext, "Wait for it to finish, then try again"],
  [git.terminal, "Open a terminal here"],
  [review.changes, "Could not read the changes"],
  [review.diff("src/a.ts"), "Could not read the diff of src/a.ts"],
  [review.files, "Could not list the files"],
  [review.file("README.md"), "Could not read README.md"],
  [review.next, "Refresh to read it again"],
  [review.notRepo, "This folder is not a git repository"],
  [review.notRepoNext, "Run git init in a terminal here, or start the agent in a repository"],
  [studio.treeFailed, "Could not read the project's files"],
  [studio.treeNext, "Refresh the tree to read them again"],
  [studio.readFailed("logo.png"), "Could not open logo.png"],
  [studio.readNext, "Open it in another editor, or pick another file"],
  [studio.reloadFailed("src/a.ts"), "Could not read src/a.ts again from the disk"],
  [studio.reloadNext, "Your version stays in the tab: reload again, or overwrite"],
  [messages(canvasMessages).loadFailed, "Could not load this workspace"],
  [messages(canvasMessages).loadNext, "Try again, or open another workspace"],
  [messages(canvasMessages).selection.listFailed, "Could not read the list"],
  [messages(canvasMessages).selection.listNext, "Check that the folder can be read, then try again"],
  [messages(nodesMessages).file.readFailed, "Could not read the file"],
  [messages(nodesMessages).file.readNext, "Refresh to read it again"],
  [shell.troubleshoot.failed, "Could not run the diagnostics"],
  [shell.troubleshoot.failedNext, "Check again, or report the problem if it keeps failing"],
  [messages(missionMessages).overnight.checkFailed, "The project could not be checked"],
  [messages(missionMessages).overnight.checkNext, "Check that git and gh run in a terminal, then try again"],
  [messages(notesMessages).listFailed, "Could not read the notes"],
  [messages(notesMessages).listNext, "Check that .dummyplane/notes can be read, then refresh"],
  [messages(notesMessages).createFailed("auth"), "Could not create the note auth"],
  [messages(notesMessages).createNext, "Check that .dummyplane/notes can be written, then try again"],
  [messages(notesMessages).group.readFailed, "Could not read the project's notes"],
  [messages(notesMessages).group.readNext, "Check that .dummyplane/notes can be read, then try again"],
  [shell.usage.tokensFailed, "Could not read Claude's logs"],
  [shell.usage.tokensNext, "Check that Claude's folder can be read, then try again"],
  [loops.problem.noTargets, "Stopped: none of its agents is running"],
  [loops.problemNext.noTargets, "Restart one of its agents, or edit the loop to pick others"],
  [loops.problem.noAgents, "Stopped: its targets are shells, not agents"],
  [loops.problem.noAgent, "Off: none of its targets is an agent"],
  [loops.problemNext.noAgent, "Edit the loop to choose agents"],
];

describe("problems inside panels in the app's voice, as toasts (docs/design-system.md, Alerts)", () => {
  it("says what failed, then what to do next, each in a sentence of its own", () => {
    for (const [actual, expected] of INLINE) expect(actual).toBe(expected);
  });

  it("keeps them short and calm, and never sends the person to a git command the app does not have as if it had it", () => {
    for (const [text] of INLINE) {
      expect(text, text).not.toMatch(/!|\.$|Error:|os error|\$\{|git pull|git fetch/);
      expect(text.length, text).toBeLessThanOrEqual(80);
    }
  });
});

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
    // The state table's words: Done only for an agent that reported, Ready for one whose turn ended without a report.
    expect(shell.notification.title("Batman", shell.finishAlert.states.blocked)).toBe("Batman · Blocked");
    expect(shell.notification.title("Batman", shell.finishAlert.states.failed)).toBe("Batman · Failed");
    expect(shell.notification.title("Batman", shell.finishAlert.states.finished)).toBe("Batman · Ready");
    expect(shell.notification.question).toBe("Has a question for you");
    // A Fleet's decision is a wait too, in fixed lines: no mission, branch or folder on the lock screen.
    expect(shell.notification.decision).toEqual({
      plan: "Has a plan for your go-ahead",
      changes: "Proposes changes to the waiting tasks",
      land: "Asks to land its mission",
      leftovers: "Asks to clean up leftovers",
    });
    expect(shell.waitingNotice.decision.plan("Atlas")).toBe("Atlas has a plan for you");
    expect(shell.waitingNotice.decision.changes("Atlas")).toBe("Atlas proposes changes");
    expect(shell.waitingNotice.decision.land("Atlas")).toBe(shell.waitingNotice.question("Atlas"));
    expect(shell.waitingNotice.decision.leftovers("Atlas")).toBe(shell.waitingNotice.question("Atlas"));
    // The notice in the window keeps its own line, which names the agent.
    expect(shell.waitingNotice.question("Batman")).toBe("Batman has a question");
  });

  it("tells a board done with its count of cards, one card in words of one, and Show to go to it", () => {
    expect(shell.boardDoneAlert.title(4)).toBe("Board done: all 4 cards finished");
    expect(shell.boardDoneAlert.title(1)).toBe("Board done: its one card finished");
    expect(shell.boardDoneAlert.show).toBe("Show");
  });
});
