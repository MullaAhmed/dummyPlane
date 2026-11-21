// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { keepOutOfTabOrder } from "./tabStops";

/** Lets a MutationObserver's records arrive. */
const settle = () => new Promise((done) => setTimeout(done, 0));

function node() {
  document.body.innerHTML = `<div id="node">
    <header><button id="close">Close</button><button id="off" disabled>Off</button><a id="link" href="#x">Docs</a><a id="plain">Plain</a></header>
    <div id="roving" tabindex="0"></div><div id="later" tabindex="2"></div><div id="skipped" tabindex="-1"></div>
    <textarea id="xterm"></textarea><span id="text">text</span>
  </div>`;
  return document.getElementById("node")!;
}
const byId = (id: string) => document.getElementById(id)!;
const tabIndexes = (...ids: string[]) => ids.map((id) => byId(id).tabIndex);
const attributes = (...ids: string[]) => ids.map((id) => byId(id).getAttribute("tabindex"));

afterEach(() => document.body.replaceChildren());

describe("keepOutOfTabOrder", () => {
  it("takes every stop out of the Tab order and puts each back as it was", () => {
    const stop = keepOutOfTabOrder(node());
    expect(tabIndexes("close", "off", "link", "roving", "later", "xterm")).toEqual([-1, -1, -1, -1, -1, -1]);
    // What was no stop is left alone.
    expect(attributes("skipped", "plain", "text")).toEqual(["-1", null, null]);
    stop();
    expect(attributes("close", "off", "link", "roving", "later", "xterm", "skipped", "plain", "text")).toEqual([null, null, null, "0", "2", null, "-1", null, null]);
    expect(document.querySelector("[data-dp-tabindex]")).toBeNull();
  });

  it("keeps a withdrawn element focusable: the app still gives it the keyboard", () => {
    const stop = keepOutOfTabOrder(node());
    byId("xterm").focus();
    expect(document.activeElement).toBe(byId("xterm"));
    stop();
  });

  it("withdraws what mounts meanwhile, and puts it back too", async () => {
    const root = node();
    const stop = keepOutOfTabOrder(root);
    root.insertAdjacentHTML("beforeend", '<footer><button id="link-button">Link</button></footer><input id="field" />');
    await settle();
    expect(tabIndexes("link-button", "field")).toEqual([-1, -1]);
    stop();
    expect(attributes("link-button", "field")).toEqual([null, null]);
  });

  it("follows a tabindex the page sets meanwhile (a roving one): that one goes back", async () => {
    const stop = keepOutOfTabOrder(node());
    byId("roving").setAttribute("tabindex", "-1");
    byId("skipped").setAttribute("tabindex", "0");
    await settle();
    expect(tabIndexes("roving", "skipped")).toEqual([-1, -1]);
    stop();
    expect(attributes("roving", "skipped")).toEqual(["-1", "0"]);
  });

  it("stops watching once it has put the stops back", async () => {
    const root = node();
    keepOutOfTabOrder(root)();
    root.insertAdjacentHTML("beforeend", '<button id="after">After</button>');
    await settle();
    expect(byId("after").tabIndex).toBe(0);
  });
});
