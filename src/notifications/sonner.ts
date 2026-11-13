// sonner, as it is. `vite.config.ts` sends every import of "sonner" here (`scripts/route-sonner.mjs`): once to
// record every popup in the notification history. The panel now keeps three kinds of news, recorded where they
// happen (`./capture`), and no popup: what a popup shows, and how it behaves, is sonner's own, untouched.
export * from "sonner";
