"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AppSelector } from "@/modules/access/AppSelector";
import { Badge, Button } from "@/ui";
import { type StatusFilter, useAppPolicies } from "./api/policy.queries";
import { PolicyList } from "./components/PolicyList";

/**
 * One application's policies. The application comes from the ROUTE
 * (/policies/{app}) and nowhere else; the selector that leads here is fed by
 * `/api/session`, and is advisory — whether this caller may read this
 * application is the engine's answer, rendered in place when it is `403`.
 */
export function AppPoliciesScreen({ app }: { app: string }) {
  const t = useTranslations("policies");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const query = useAppPolicies(app, status, page);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <Badge>{app}</Badge>
        </div>
        <Link href="/policies/new">
          <Button>{t("newPolicy")}</Button>
        </Link>
      </div>

      <AppSelector current={app} allHref="/policies" />

      <PolicyList
        query={query}
        status={status}
        onStatus={(next) => {
          setStatus(next);
          setPage(1);
        }}
        onPage={setPage}
        emptyText={t("empty")}
      />
    </div>
  );
}
