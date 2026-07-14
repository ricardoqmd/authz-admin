/** Shared between server (request config) and client (locale switcher). */
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
