import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALES, type Locale } from "./locales";

const DEFAULT_LOCALE: Locale = (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) ?? "es";

/**
 * Locale resolution without URL routing: a NEXT_LOCALE cookie (set by the
 * header switcher) with an env-configurable default. The department deploys
 * with "es"; the public demo defaults to "en" via env.
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = LOCALES.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
