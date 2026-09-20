"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/ui";
import { useSessionApps } from "./api/session.queries";

/**
 * Pick an application: a link per application the session lists.
 *
 * The options come from `/api/session` and are ADVISORY — offering an
 * application here promises nothing, and the screen it leads to renders the
 * engine's `403` if the engine says no.
 */
export function AppSelector({
  current,
  allHref,
}: {
  /** The application in the current route, if any. */
  current?: string;
  /** Where "all applications" leads; omitted, the option is not offered. */
  allHref?: string;
}) {
  const t = useTranslations("access");
  const apps = useSessionApps();

  return (
    <nav aria-label={t("selectorLabel")} className="flex flex-wrap items-center gap-2">
      {allHref && (
        <Link href={allHref}>
          <Button variant={current ? "outline" : "primary"} className="h-8 px-3">
            {t("allApplications")}
          </Button>
        </Link>
      )}
      {apps.map((app) => (
        <Link key={app} href={`/policies/${encodeURIComponent(app)}`}>
          <Button variant={app === current ? "primary" : "outline"} className="h-8 px-3">
            {app}
          </Button>
        </Link>
      ))}
    </nav>
  );
}
