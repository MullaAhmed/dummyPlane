// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteButton } from "@/agents/RemoteButton";
import { readSource } from "@/theme/cssBlocks";
import { NODE_FRAME, TERMINAL_BODY } from "./frame";
import { NameField } from "./NameField";
import { StatusPill } from "./StatusPill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root, unmount: () => act(async () => root.unmount()) };
}

describe("the header of a terminal and of a Fleet", () => {
  it("are built from the same pieces, so they cannot drift: one row, one name, one status, one menu, one Close", () => {
    for (const file of ["nodes/terminal/TerminalHeader.tsx", "nodes/fleet/FleetNode.tsx"]) {
      const source = readSource(file);
      for (const piece of ["<NodeHeader", "<NodeHeaderEnd", "<NameField", "<StatusPill", "<HeaderMenu", "<HeaderButton", "<RemoteButton"]) {
        expect(source, `${file} ${piece}`).toContain(piece);
      }
    }
  });

  it("have no text of their own in the code: the labels live in messages.ts", () => {
    for (const file of ["nodes/terminal/TerminalHeader.tsx", "nodes/terminal/NodeHeader.tsx", "nodes/terminal/NameField.tsx", "nodes/fleet/FleetNode.tsx"]) {
      expect(readSource(file), file).not.toMatch(/aria-label="|\btitle="[A-Za-z]/);
    }
  });

  it("move with the design system's motion tokens, never a hard-coded duration, ease or transition-all", () => {
    const files = [
      "nodes/terminal/NodeHeader.tsx",
      "nodes/terminal/NameField.tsx",
      "nodes/terminal/TerminalHeader.tsx",
      "nodes/terminal/StatusPill.tsx",
      "nodes/terminal/StatusDot.tsx",
      "nodes/terminal/MinimizedCard.tsx",
      "nodes/terminal/ResumeCard.tsx",
      "nodes/terminal/AgentFoot.tsx",
      "nodes/foot/MessageBar.tsx",
      "nodes/foot/StatusLine.tsx",
      "nodes/fleet/FleetNode.tsx",
      "nodes/fleet/FleetInput.tsx",
      "nodes/subagent/SubagentNode.tsx",
    ];
    for (const file of files) expect(readSource(file), file).not.toMatch(/(?<![\w-])duration-\d|(?<![\w-])ease-(out|in|linear)\b|transition-all|#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("the frame of a node", () => {
  it("is one rounded frame for a terminal, a Fleet and a subagent, with 8px of air around the grid", () => {
    expect(NODE_FRAME).toContain("rounded-xl");
    expect(NODE_FRAME).toContain("overflow-hidden");
    expect(TERMINAL_BODY).toContain("p-2");
    for (const file of ["nodes/terminal/TerminalNode.tsx", "nodes/fleet/FleetNode.tsx", "nodes/subagent/SubagentNode.tsx"]) {
      expect(readSource(file), file).toContain("NODE_FRAME");
    }
    for (const file of ["nodes/terminal/TerminalNode.tsx", "nodes/fleet/FleetNode.tsx"]) {
      expect(readSource(file), file).toContain("TERMINAL_BODY");
    }
  });
});

describe("NameField", () => {
  const press = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

  it("shows the name as quiet text that a double-click edits", async () => {
    const onEditingChange = vi.fn();
    const view = await mount(<NameField value="Isis" editing={false} onEditingChange={onEditingChange} onCommit={() => {}} />);
    const name = view.host.querySelector("span")!;
    expect(name.textContent).toBe("Isis");
    expect(name.className).toContain("truncate");
    await act(async () => void name.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onEditingChange).toHaveBeenCalledWith(true);
    await view.unmount();
  });

  it("does not take the Enter that accepts an IME's candidate for a rename", async () => {
    const onEditingChange = vi.fn();
    const view = await mount(<NameField value="Isis" editing onEditingChange={onEditingChange} onCommit={() => {}} />);
    const field = view.host.querySelector("input")!;
    await act(async () => void press(field, { key: "Enter", isComposing: true }));
    expect(onEditingChange).not.toHaveBeenCalled();
    expect(view.host.querySelector("input")).not.toBeNull();
    await view.unmount();
  });

  it("selects the name when it opens, so typing replaces it", async () => {
    const view = await mount(<NameField value="Isis" editing onEditingChange={() => {}} onCommit={() => {}} />);
    const field = view.host.querySelector("input")!;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(4);
    await view.unmount();
  });
});

describe("StatusPill", () => {
  it("can hand its word to the screen readers and the tooltip, the dot alone staying on a narrow header", async () => {
    const view = await mount(<StatusPill status={{ state: "stopped" }} labelClassName="@max-xs/head:sr-only" />);
    const pill = view.host.firstElementChild!;
    expect(pill.getAttribute("title")).toBe("Stopped");
    expect(pill.querySelector("span:not([data-status])")!.className).toBe("@max-xs/head:sr-only");
    await view.unmount();
    // Beside a full row of text (a list), no tooltip repeats the word.
    const plain = await mount(<StatusPill status={{ state: "stopped" }} />);
    expect(plain.host.firstElementChild!.hasAttribute("title")).toBe(false);
    await plain.unmount();
  });
});

describe("RemoteButton in a header", () => {
  it("is the header's own 28px icon button with a 16px glyph, with no wrapper to size it", async () => {
    const view = await mount(<RemoteButton nodeId="isis" wanted={false} running />);
    const button = view.host.firstElementChild!;
    expect(button.matches("button[data-remote]")).toBe(true);
    expect(button.getAttribute("data-size")).toBe("icon-sm");
    expect(button.className).toContain("size-7");
    expect(button.className).toContain("[&_svg:not([class*='size-'])]:size-4");
    await view.unmount();
  });
});
