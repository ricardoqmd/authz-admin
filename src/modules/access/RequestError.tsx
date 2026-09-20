"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/ui";
import { endsSession, isRefusal, isUpstreamUnauthenticated } from "./errors";

/**
 * A screen-level request failure.
 *
 * A refusal renders as one constant card — no application name, no engine
 * detail, nothing that varies — so an application the caller does not hold and
 * one that does not exist look exactly alike. Anything else renders through
 * `other`, which each screen words for itself.
 */
export function RequestError({
  error,
  other,
}: {
  error: unknown;
  other: (message: string) => string;
}) {
  const t = useTranslations("access");

  if (isRefusal(error)) {
    return (
      <Card role="alert" data-refusal="" className="border-danger-bg text-sm text-danger">
        {t("forbidden")}
      </Card>
    );
  }
  return (
    <Card role="alert" className="border-danger-bg text-sm text-danger">
      {endsSession(error)
        ? t("sessionEnded")
        : isUpstreamUnauthenticated(error)
          ? t("upstreamUnauthenticated")
          : other((error as Error).message)}
    </Card>
  );
}
