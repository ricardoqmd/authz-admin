"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@/i18n/locales";
import { Button } from "@/ui";

/** Cookie-based locale toggle (no URL routing — see src/i18n/request.ts). */
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();

  function switchTo(next: string) {
    // biome-ignore lint/suspicious/noDocumentCookie: intentional — next-intl reads NEXT_LOCALE server-side; the Cookie Store API is not yet baseline.
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex gap-1">
      {LOCALES.map((l) => (
        <Button
          key={l}
          variant={l === locale ? "primary" : "ghost"}
          className="h-7 px-2 text-xs"
          onClick={() => switchTo(l)}
        >
          {t(l)}
        </Button>
      ))}
    </div>
  );
}
