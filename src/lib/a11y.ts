/**
 * Queries by role and accessible name for the tests, the way a screen reader finds a control
 * (the repo has no testing-library). It covers the parts of the accname algorithm the app uses:
 * aria-labelledby, aria-label, a label (`for` or wrapping), a field's title or placeholder, a fieldset's
 * legend, then the content, skipping what is aria-hidden. Hidden elements (aria-hidden, `hidden`) are not found.
 */

const IMPLICIT: Record<string, string> = {
  button: "button",
  textarea: "textbox",
  ul: "list",
  ol: "list",
  li: "listitem",
  nav: "navigation",
  fieldset: "group",
  select: "combobox",
};

const INPUT_ROLES: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  checkbox: "checkbox",
  radio: "radio",
  number: "spinbutton",
  range: "slider",
};

/** The element's role: its `role` attribute, else the one its tag implies. */
export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "input") return INPUT_ROLES[(element.getAttribute("type") ?? "text").toLowerCase()] ?? "textbox";
  if (tag === "a") return element.hasAttribute("href") ? "link" : null;
  return IMPLICIT[tag] ?? null;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function hidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
  }
  return false;
}

/** The text an element gives a name computed from content: its own name if it has one, else its children's. */
function contentText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
  const label = node.getAttribute("aria-label");
  if (label?.trim()) return label;
  return [...node.childNodes].map(contentText).join("");
}

const byIds = (element: Element, attribute: string) =>
  (element.getAttribute(attribute) ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((found): found is HTMLElement => found !== null);

/** The accessible name, whitespace squashed. */
export function accessibleName(element: Element): string {
  const labelledBy = byIds(element, "aria-labelledby");
  if (labelledBy.length > 0) return squash(labelledBy.map(contentText).join(" "));
  const label = element.getAttribute("aria-label");
  if (label?.trim()) return squash(label);
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const labels = [...((element as HTMLInputElement).labels ?? [])];
    if (labels.length > 0) return squash(labels.map(contentText).join(" "));
    // Last resorts (HTML-AAM): the title, then the placeholder, which is gone once the field is filled.
    return squash(element.getAttribute("title") || element.getAttribute("placeholder") || "");
  }
  if (tag === "fieldset") {
    const legend = element.querySelector(":scope > legend");
    return legend ? squash(contentText(legend)) : "";
  }
  return squash(contentText(element));
}

/** The accessible description: what aria-describedby points at, hidden or not. */
export function accessibleDescription(element: Element): string {
  return squash(byIds(element, "aria-describedby").map((found) => found.textContent ?? "").join(" "));
}

const matches = (actual: string, name: string | RegExp) => (typeof name === "string" ? actual === name : name.test(actual));

/** Every visible element of that role (and that name, if given) under `container`. */
export function queryAllByRole(container: ParentNode, role: string, name?: string | RegExp): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("*")].filter(
    (element) => roleOf(element) === role && !hidden(element) && (name === undefined || matches(accessibleName(element), name)),
  );
}

/** The one element of that role and name, or null; more than one is an error. */
export function queryByRole(container: ParentNode, role: string, name?: string | RegExp): HTMLElement | null {
  const found = queryAllByRole(container, role, name);
  if (found.length > 1) throw new Error(`${found.length} elements of role ${role} named ${String(name)}`);
  return found[0] ?? null;
}

/** The one element of that role and name; none or several is an error that lists the names of that role. */
export function getByRole(container: ParentNode, role: string, name?: string | RegExp): HTMLElement {
  const found = queryByRole(container, role, name);
  if (found) return found;
  const names = queryAllByRole(container, role).map((element) => JSON.stringify(accessibleName(element)));
  throw new Error(`No ${role} named ${String(name)}; the ${role}s are: ${names.join(", ") || "none"}`);
}
