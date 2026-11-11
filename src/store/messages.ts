import { defineMessages } from "@/i18n";

/** Texts of the stores' own toasts. */
export const storeMessages = defineMessages(
  {
    saveFailed: "Could not save your last change",
    duplicateName: (name: string) => `A workspace is already named "${name}".`,
  },
);
