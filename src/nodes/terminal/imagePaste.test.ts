import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { savePastedImage } from "@/ipc/pastedImages";
import { clipboardImage, pasteImage, pastedImage, pastedPath, takeOverPaste, withPathAt } from "./imagePaste";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/ipc/pastedImages", () => ({ savePastedImage: vi.fn() }));

const image = (type = "image/png") => new File([new Uint8Array([137, 80, 78, 71])], "image", { type });

/** What a paste event's clipboardData answers: plain text and files. */
function clipboard({ text = "", html = "", files = [] as File[] } = {}) {
  const data: Record<string, string> = { "text/plain": text, "text/html": html };
  const items = [
    ...Object.entries(data)
      .filter(([, value]) => value !== "")
      .map(([type]) => ({ kind: "string", type, getAsFile: () => null })),
    ...files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
  ];
  return { getData: (type: string) => data[type] ?? "", items };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A failed paste writes to the log through the console (app/log.ts): checked below, kept out of the test output.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("what a paste hands to the terminal", () => {
  it("leaves text to xterm", () => {
    expect(pastedImage(clipboard({ text: "ls -la" }))).toBeNull();
  });

  it("takes an image that comes alone (a Win+Shift+S screenshot)", () => {
    const file = image();
    expect(pastedImage(clipboard({ files: [file] }))).toEqual({ file, extension: "png" });
  });

  it("keeps the text when an image comes with it (a copy from Office)", () => {
    expect(pastedImage(clipboard({ text: "Q3 figures", html: "<p>Q3</p>", files: [image()] }))).toBeNull();
  });

  it("takes a browser's copied image, which carries HTML but no plain text", () => {
    expect(pastedImage(clipboard({ html: '<img src="x.png">', files: [image()] }))?.extension).toBe("png");
  });

  it("names a JPEG .jpg and keeps GIF and WebP", () => {
    expect(pastedImage(clipboard({ files: [image("image/jpeg")] }))?.extension).toBe("jpg");
    expect(pastedImage(clipboard({ files: [image("image/gif")] }))?.extension).toBe("gif");
    expect(pastedImage(clipboard({ files: [image("image/webp")] }))?.extension).toBe("webp");
  });

  it("leaves to xterm what no agent reads: other images, other files, nothing", () => {
    expect(pastedImage(clipboard({ files: [image("image/svg+xml")] }))).toBeNull();
    expect(pastedImage(clipboard({ files: [new File(["x"], "notes.txt", { type: "text/plain" })] }))).toBeNull();
    expect(pastedImage(clipboard())).toBeNull();
    expect(pastedImage(null)).toBeNull();
  });
});

describe("the pasted path", () => {
  it("is pasted as is without a space", () => {
    expect(pastedPath(String.raw`C:\Users\Me\AppData\Local\dev.dummyplane.app\pasted-images\paste-1.png`)).toBe(
      String.raw`C:\Users\Me\AppData\Local\dev.dummyplane.app\pasted-images\paste-1.png`,
    );
  });

  it("is quoted when it holds a space, and never ends with a newline", () => {
    const path = String.raw`C:\Users\Jane Doe\AppData\Local\dev.dummyplane.app\pasted-images\paste-1.png`;
    expect(pastedPath(path)).toBe(`"${path}"`);
  });
});

describe("pasting an image", () => {
  it("saves its bytes and pastes the saved file's path", async () => {
    vi.mocked(savePastedImage).mockResolvedValue(String.raw`C:\Users\Jane Doe\paste-1.png`);
    const paste = vi.fn();
    await pasteImage({ file: image(), extension: "png" }, paste);
    expect(savePastedImage).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]), "png");
    expect(paste).toHaveBeenCalledWith(String.raw`"C:\Users\Jane Doe\paste-1.png"`);
  });

  it("says so in a toast when the image cannot be saved", async () => {
    vi.mocked(savePastedImage).mockRejectedValue(new Error("disk full"));
    const paste = vi.fn();
    await pasteImage({ file: image(), extension: "png" }, paste);
    expect(paste).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), { description: "disk full" });
  });
});

describe("the path put into a message field", () => {
  const path = String.raw`C:\cache\paste-1.png`;

  it("goes at the caret, a space after it to type on", () => {
    expect(withPathAt("", 0, 0, path)).toEqual({ text: `${path} `, caret: path.length + 1 });
    expect(withPathAt("look at ", 8, 8, path)).toEqual({ text: `look at ${path} `, caret: 8 + path.length + 1 });
  });

  it("is never glued to the words around it", () => {
    expect(withPathAt("look atthis", 7, 7, path)).toEqual({ text: `look at ${path} this`, caret: 8 + path.length + 1 });
    expect(withPathAt("look at this", 8, 8, path)).toEqual({ text: `look at ${path} this`, caret: 8 + path.length + 1 });
  });

  it("replaces the selected text", () => {
    expect(withPathAt("see HERE now", 4, 8, path).text).toBe(`see ${path} now`);
  });
});

describe("a paste taken over in a terminal or a message field", () => {
  const event = (data: ReturnType<typeof clipboard> | null) =>
    ({ clipboardData: data, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as ClipboardEvent;
  /** What `navigator.clipboard.read` answers once the event is over. */
  const reads = (...types: string[]) =>
    vi.fn(async () => [{ types, getType: async (type: string) => new Blob([new Uint8Array([1, 2, 3])], { type }) }]);

  it("takes over an image: xterm and a field would paste nothing", async () => {
    vi.mocked(savePastedImage).mockResolvedValue(String.raw`C:\cache\paste-1.png`);
    const paste = vi.fn();
    const read = reads("image/png");
    const pasted = event(clipboard({ files: [image()] }));
    expect(takeOverPaste(pasted, paste, read)).toBe(true);
    expect(pasted.preventDefault).toHaveBeenCalled();
    expect(pasted.stopPropagation).toHaveBeenCalled();
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith(String.raw`C:\cache\paste-1.png`));
    // The event's own image: the clipboard is not read again.
    expect(read).not.toHaveBeenCalled();
  });

  it("leaves text to the terminal or the field, even next to an image", () => {
    const paste = vi.fn();
    const read = reads("image/png");
    const pasted = event(clipboard({ text: "hello", files: [image()] }));
    expect(takeOverPaste(pasted, paste, read)).toBe(false);
    expect(pasted.preventDefault).not.toHaveBeenCalled();
    expect(pasted.stopPropagation).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(savePastedImage).not.toHaveBeenCalled();
  });

  it("reads the clipboard again when the event shows neither text nor image, and pastes the image found there", async () => {
    vi.mocked(savePastedImage).mockResolvedValue(String.raw`C:\cache\paste-2.png`);
    const paste = vi.fn();
    const read = reads("text/html", "image/png");
    const pasted = event(clipboard());
    expect(takeOverPaste(pasted, paste, read)).toBe(true);
    // No empty paste reaches the agent meanwhile.
    expect(pasted.preventDefault).toHaveBeenCalled();
    expect(pasted.stopPropagation).toHaveBeenCalled();
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith(String.raw`C:\cache\paste-2.png`));
    expect(savePastedImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "png");
    // The log keeps what the event carried, for a paste that still fails.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no text and no image in the paste event"));
  });

  it("says there is nothing to paste when the clipboard has no image either", async () => {
    const paste = vi.fn();
    expect(takeOverPaste(event(clipboard({ files: [image("image/svg+xml")] })), paste, reads("image/svg+xml"))).toBe(true);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Nothing to paste", { description: expect.stringContaining("no text") }));
    expect(paste).not.toHaveBeenCalled();
    expect(savePastedImage).not.toHaveBeenCalled();
  });

  it("says there is nothing to paste, and logs why, when the clipboard cannot be read", async () => {
    const read = vi.fn(async () => {
      throw new DOMException("Read permission denied", "NotAllowedError");
    });
    takeOverPaste(event(clipboard()), vi.fn(), read);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Nothing to paste", expect.anything()));
    expect(console.warn).toHaveBeenCalledWith("image paste: the clipboard could not be read", expect.any(DOMException));
  });

  it("logs a failed save as well as saying so", async () => {
    vi.mocked(savePastedImage).mockRejectedValue(new Error("disk full"));
    takeOverPaste(event(clipboard({ files: [image()] })), vi.fn());
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(console.error).toHaveBeenCalledWith("image paste failed", expect.any(Error));
  });

  it("leaves a synthetic paste without clipboard data alone", () => {
    expect(takeOverPaste(event(null), vi.fn())).toBe(false);
  });
});

describe("the clipboard read again after the event", () => {
  it("gives its first image an agent reads", async () => {
    const read = vi.fn(async () => [
      { types: ["text/plain"], getType: async () => new Blob(["x"]) },
      { types: ["image/jpeg"], getType: async (type: string) => new Blob([new Uint8Array([9])], { type }) },
    ]);
    expect((await clipboardImage(read))?.extension).toBe("jpg");
  });

  it("gives nothing for text alone, or an empty clipboard", async () => {
    expect(await clipboardImage(vi.fn(async () => [{ types: ["text/plain"], getType: async () => new Blob(["x"]) }]))).toBeNull();
    expect(await clipboardImage(vi.fn(async () => []))).toBeNull();
  });
});
