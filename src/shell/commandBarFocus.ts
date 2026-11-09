/** "Write an instruction": the cursor in the command bar's field. False when it is not on screen. */
export function focusCommandBar(doc: Document = document): boolean {
  const field = doc.querySelector<HTMLTextAreaElement>("[data-command-bar] textarea");
  field?.focus();
  return field !== null;
}
