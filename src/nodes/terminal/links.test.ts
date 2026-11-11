import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import { isWebLink, openTerminalLink, resetTerminalLinks, terminalLinkHandler } from "./links";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

describe("a link clicked in a terminal", () => {
  beforeEach(() => {
    resetTerminalLinks();
    vi.mocked(openUrl).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens a program's OSC 8 hyperlink through the opener, with no prompt and no window.open", () => {
    const confirm = vi.fn(() => true);
    const open = vi.fn();
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal("open", open);
    terminalLinkHandler.activate({} as MouseEvent, "https://example.com/docs", { start: { x: 1, y: 1 }, end: { x: 5, y: 1 } });
    expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/docs");
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("opens once when the same click reaches both finders, the addon and the OSC 8 link", () => {
    openTerminalLink("https://example.com", 1000);
    openTerminalLink("https://example.com", 1010);
    expect(openUrl).toHaveBeenCalledTimes(1);
    // A later click on the same link opens it again.
    openTerminalLink("https://example.com", 2000);
    expect(openUrl).toHaveBeenCalledTimes(2);
    // Another link at once is another click.
    openTerminalLink("https://example.org", 2001);
    expect(openUrl).toHaveBeenCalledTimes(3);
  });

  it("opens only web addresses", () => {
    for (const uri of ["file:///C:/Windows/system32/calc.exe", "javascript:alert(1)", "ms-settings:", "not a url"]) openTerminalLink(uri);
    expect(openUrl).not.toHaveBeenCalled();
    expect(isWebLink("http://localhost:1420")).toBe(true);
    expect(terminalLinkHandler.allowNonHttpProtocols).toBe(false);
  });

  it("is the handler every terminal is made with, and the addon's opener", () => {
    const source = readSource("nodes/terminal/registry.ts");
    expect(source).toMatch(/linkHandler: terminalLinkHandler/);
    expect(source).toMatch(/new WebLinksAddon\(\(_event, uri\) => openTerminalLink\(uri\)\)/);
    expect(source).not.toMatch(/plugin-opener/);
  });
});
