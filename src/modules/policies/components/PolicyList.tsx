"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Paginated, PolicyHeadSummary } from "@/lib/pdp/contracts";
import { RequestError } from "@/modules/access/RequestError";
import { Badge, Button, Card, Skeleton } from "@/ui";
import type { StatusFilter } from "../api/policy.queries";
import { StatusBadge } from "./StatusBadge";

const STATUS_FILTERS: StatusFilter[] = ["all", "active", "inactive"];

/**
 * One page of policy heads, exactly as the engine returned it — mobile-first:
 * cards on small screens, table from md up.
 *
 * Nothing here counts, filters or merges. The total and the page position are
 * the engine's `pagination`, and the rows are its `data`: a list that re-counted
 * what it received would report a total the engine never stated, and one that
 * filtered in the browser would page over rows the caller was never shown.
 */
export function PolicyList({
  query,
  status,
  onStatus,
  onPage,
  emptyText,
}: {
  query: { data?: Paginated<PolicyHeadSummary>; isLoading: boolean; error: unknown };
  status: StatusFilter;
  onStatus: (status: StatusFilter) => void;
  onPage: (page: number) => void;
  /** What an empty page means on THIS surface. */
  emptyText: string;
}) {
  const t = useTranslations("policies");

  if (query.error) {
    return (
      <RequestError
        error={query.error}
        other={(message) => t("loadError", { message })}
      />
    );
  }

  const page = query.data;
  const rows = page?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted">
          {page && t("count", { count: page.pagination.totalElements })}
        </span>
        {/* status filter — server-side (R025) */}
        <div className="flex gap-1 rounded border border-line bg-surface p-0.5">
          {STATUS_FILTERS.map((sf) => (
            <Button
              key={sf}
              variant={sf === status ? "primary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => onStatus(sf)}
            >
              {t(`statusFilter.${sf}`)}
            </Button>
          ))}
        </div>
      </div>

      {query.isLoading || !page ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <>
          {/* mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((p) => (
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
                {rows.map((p) => (
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

          {rows.length === 0 && (
            <Card className="text-center text-muted">{emptyText}</Card>
          )}

          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted">
              {t("pageOf", {
                page: page.pagination.page,
                totalPages: page.pagination.totalPages,
              })}
            </span>
            <Button
              variant="outline"
              className="h-8 px-3"
              disabled={page.pagination.page <= 1}
              onClick={() => onPage(page.pagination.page - 1)}
            >
              {t("previousPage")}
            </Button>
            <Button
              variant="outline"
              className="h-8 px-3"
              disabled={page.pagination.page >= page.pagination.totalPages}
              onClick={() => onPage(page.pagination.page + 1)}
            >
              {t("nextPage")}
            </Button>
          </div>
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
