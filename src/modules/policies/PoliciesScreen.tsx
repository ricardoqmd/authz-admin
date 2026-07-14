"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { PolicyHeadSummary } from "@/lib/pdp/contracts";
import { Badge, Button, Card, Skeleton } from "@/ui";
import { type StatusFilter, usePolicies } from "./api/policy.queries";
import { StatusBadge } from "./components/StatusBadge";

const STATUS_FILTERS: StatusFilter[] = ["all", "active", "inactive"];

/**
 * Policies list — mobile-first: cards on small screens, table from md up.
 * App grouping uses the first-class `app` field (R024); status filtering is
 * server-side (R025).
 */
export function PoliciesScreen() {
  const t = useTranslations("policies");
  const { user } = useAuth();
  const [status, setStatus] = useState<StatusFilter>("all");
  const { data, isLoading, error } = usePolicies(status);
  const [project, setProject] = useState<string>("all");

  const policies = data?.data ?? [];

  const projects = useMemo(() => {
    const visible = new Set(policies.map((p) => p.app));
    return ["all", ...Array.from(visible).sort()];
  }, [policies]);

  const filtered = useMemo(
    () => (project === "all" ? policies : policies.filter((p) => p.app === project)),
    [policies, project],
  );

  if (error) {
    return (
      <Card className="border-danger-bg text-danger">
        {t("loadError", { message: (error as Error).message })}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">
            {user?.name} · {t("count", { count: filtered.length })}
          </span>
          <Link href="/policies/new">
            <Button>{t("newPolicy")}</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* app filter — becomes the persistent app selector later */}
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <Button
              key={p}
              variant={p === project ? "primary" : "outline"}
              className="h-8 px-3"
              onClick={() => setProject(p)}
            >
              {p === "all" ? t("filterAll") : p}
            </Button>
          ))}
        </div>
        {/* status filter — server-side (R025) */}
        <div className="flex gap-1 rounded border border-line bg-surface p-0.5">
          {STATUS_FILTERS.map((sf) => (
            <Button
              key={sf}
              variant={sf === status ? "primary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setStatus(sf)}
            >
              {t(`statusFilter.${sf}`)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <>
          {/* mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {filtered.map((p) => (
              <li key={`${p.app}/${p.policyId}`}>
                <PolicyCard policy={p} />
              </li>
            ))}
          </ul>

          {/* desktop: table */}
          <div className="hidden overflow-hidden rounded border border-line md:block">
            <table className="w-full bg-surface text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("table.policy")}</th>
                  <th className="px-4 py-2 font-medium">{t("table.project")}</th>
                  <th className="px-4 py-2 font-medium">{t("table.resourceType")}</th>
                  <th className="px-4 py-2 font-medium">{t("table.status")}</th>
                  <th className="px-4 py-2 font-medium">{t("table.lastChange")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={`${p.app}/${p.policyId}`}
                    className="border-b border-line last:border-0 hover:bg-neutral-bg"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/policies/${p.app}/${p.policyId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.policyId}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Badge>{p.app}</Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{p.resourceType}</td>
                    <td className="px-4 py-2">
                      <StatusBadge activeVersion={p.activeVersion} />
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {p.audit.createdBy} ·{" "}
                      {new Date(p.audit.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <Card className="text-center text-muted">{t("empty")}</Card>
          )}
        </>
      )}
    </div>
  );
}

function PolicyCard({ policy }: { policy: PolicyHeadSummary }) {
  return (
    <Link href={`/policies/${policy.app}/${policy.policyId}`} className="block">
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-primary">{policy.policyId}</span>
          <StatusBadge activeVersion={policy.activeVersion} />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <Badge>{policy.app}</Badge>
          <span className="font-mono">{policy.resourceType}</span>
        </div>
        <p className="text-xs text-muted">
          {policy.audit.createdBy} ·{" "}
          {new Date(policy.audit.createdAt).toLocaleDateString()}
        </p>
      </Card>
    </Link>
  );
}
