import { showAbout } from "@/app/about";
import { openLogDir } from "@/app/logs";
import { checkForUpdate } from "@/app/updates";
import { addProject } from "@/home/addProject";
import { closeWindow, minimizeWindow, toggleMaximizeWindow, windowStore } from "@/shell/windowState";
import { showTroubleshooting } from "@/shell/troubleshoot";
import { projectsStore } from "@/store/projects";
import type { Command } from "../command";
import { command, sectionNamed } from "./define";
import { catalog } from "./messages";

const always = () => true;
const projects = sectionNamed((s) => s.projects);
const windowSection = sectionNamed((s) => s.window);
const help = sectionNamed((s) => s.help);

/** Projects, Window and Help (spec window §7.3), the last sections of the palette. */
export const APP: readonly Command[] = [
  command("project.add", { section: projects, available: () => projectsStore.getState().view === "home", run: () => addProject() }),
  command("window.minimize", { section: windowSection, available: always, run: () => minimizeWindow() }),
  command("window.maximize", {
    label: () => (windowStore.getState().maximized ? catalog().restore : catalog().maximize),
    section: windowSection,
    available: always,
    run: () => toggleMaximizeWindow(),
  }),
  command("window.close", { section: windowSection, available: always, run: () => closeWindow() }),
  command("app.about", { section: help, available: always, run: () => showAbout() }),
  command("app.updates", { section: help, available: always, run: () => checkForUpdate({ manual: true }) }),
  command("app.logs", { section: help, available: always, run: () => openLogDir() }),
  command("app.troubleshoot", { section: help, available: always, run: () => showTroubleshooting() }),
];
