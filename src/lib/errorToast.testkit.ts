import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Test helper: the text of a toast's description as sonner received it, the markup dropped. */
export function descriptionText(options: unknown): string {
  const node = (options as { description?: ReactNode } | undefined)?.description;
  if (node === undefined || node === null) return "";
  if (!isValidElement(node)) return String(node);
  return renderToStaticMarkup(node as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Test helper: the error toasts a `toast.error` mock or spy received, as a title and its description's text. */
export function errorToasts(spy: { mock: { calls: unknown[][] } }): { title: string; description: string }[] {
  return spy.mock.calls.map(([title, options]) => ({ title: String(title), description: descriptionText(options) }));
}
