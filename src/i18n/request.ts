import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALES, type Locale } from "./locales";

/**
 * Locale resolution without URL routing: a NEXT_LOCALE cookie (set by the
 * header switcher) with an env-configurable default.
 *
 * Read per request rather than at module load, and through a plain variable
 * rather than a NEXT_PUBLIC_ one: this runs on the server, so the value never
 * needed to be inlined into the bundle, and inlining it would have made the
 * default locale a property of the image instead of the deployment.
 */
export default getRequestConfig(async () => {
  const configured = process.env.PAP_DEFAULT_LOCALE as Locale | undefined;
  const fallback: Locale = LOCALES.includes(configured as Locale)
    ? (configured as Locale)
    : "es";

  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = LOCALES.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : fallback;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
