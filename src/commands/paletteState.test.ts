// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./command";
import { closePalette, modeOf, openPalette, paletteStore, setPaletteQuery, stripPrefix } from "./paletteState";

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 2, terminalId: "isis" };

beforeEach(() => paletteStore.setState({ open: false, query: "", context: null, returnFocus: null }));
afterEach(() => document.body.replaceChildren());

describe("the palette (spec fenêtre §7.1)", () => {
  it("follows its text: > makes the functions mode", () => {
    expect(modeOf("")).toBe("goTo");
    expect(modeOf("isis")).toBe("goTo");
    expect(modeOf("> pause")).toBe("functions");
    expect(modeOf("  >pause")).toBe("functions");
    expect(stripPrefix("> pause")).toBe("pause");
    expect(stripPrefix("isis")).toBe("isis");
  });

  it("opens from a shortcut and remembers where the keyboard was, and the context of the moment", () => {
    document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div>';
    const xterm = document.querySelector("textarea")!;
    xterm.focus();
    openPalette("goTo", ctx);
    expect(paletteStore.getState()).toMatchObject({ open: true, query: "", context: ctx, returnFocus: xterm });
    closePalette();
    openPalette("functions", ctx);
    expect(paletteStore.getState().query).toBe("> ");
  });

  it("switches mode when open, keeping the search", () => {
    openPalette("goTo", ctx);
    setPaletteQuery("thot");
    openPalette("functions", ctx);
    expect(paletteStore.getState().query).toBe("> thot");
    openPalette("goTo", ctx);
    expect(paletteStore.getState().query).toBe("thot");
  });

  it("gives the keyboard back where it was when it closes", () => {
    document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div><input />';
    const xterm = document.querySelector("textarea")!;
    xterm.focus();
    openPalette("goTo", ctx);
    document.querySelector("input")!.focus();
    closePalette();
    expect(paletteStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(xterm);
  });

  it("gives it back without scrolling: an xterm's textarea can sit below the window's edge, under the canvas's hidden-overflow boxes", () => {
    document.body.innerHTML = '<div data-terminal="isis"><textarea></textarea></div>';
    const xterm = document.querySelector("textarea")!;
    xterm.focus();
    openPalette("goTo", ctx);
    const focus = vi.spyOn(xterm, "focus");
    closePalette();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
