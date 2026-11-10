import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { savePastedImage } from "@/ipc/pastedImages";
import { onTerminalPaste, pasteImage, pastedImage, pastedPath } from "./imagePaste";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
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

beforeEach(() => vi.clearAllMocks());

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

describe("a terminal's paste event", () => {
  const event = (data: ReturnType<typeof clipboard>) =>
    ({ clipboardData: data, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as ClipboardEvent;

  it("takes over an image: xterm would paste an empty string", async () => {
    vi.mocked(savePastedImage).mockResolvedValue(String.raw`C:\cache\paste-1.png`);
    const paste = vi.fn();
    const pasted = event(clipboard({ files: [image()] }));
    onTerminalPaste(pasted, paste);
    expect(pasted.preventDefault).toHaveBeenCalled();
    expect(pasted.stopPropagation).toHaveBeenCalled();
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith(String.raw`C:\cache\paste-1.png`));
  });

  it("lets xterm paste text as before", () => {
    const paste = vi.fn();
    const pasted = event(clipboard({ text: "hello", files: [image()] }));
    onTerminalPaste(pasted, paste);
    expect(pasted.preventDefault).not.toHaveBeenCalled();
    expect(pasted.stopPropagation).not.toHaveBeenCalled();
    expect(savePastedImage).not.toHaveBeenCalled();
  });
});
