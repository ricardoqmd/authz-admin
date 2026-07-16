"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PolicyVersionSummary } from "@/lib/pdp/contracts";
import { Badge, Card, Skeleton } from "@/ui";
import { usePolicyVersion } from "../api/policy.queries";

/**
 * Linear vertical timeline — the natural shape for an append-only history,
 * and mobile-friendly by construction. Newest first. Each version can be
 * expanded to inspect its immutable document, active or not (the content is
 * fetched on demand, so an inactive/never-activated version is viewable too).
 */
export function VersionsTimeline({
  app,
  policyId,
  versions,
  activeVersion,
}: {
  app: string;
  policyId: string;
  versions: PolicyVersionSummary[];
  activeVersion: number | null;
}) {
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {sorted.map((v) => (
        <li key={v.version} className="relative">
          <span className="absolute -left-[1.42rem] top-3 h-2.5 w-2.5 rounded-full border border-line bg-surface" />
          <VersionItem
            app={app}
            policyId={policyId}
            summary={v}
            isActive={v.version === activeVersion}
          />
        </li>
      ))}
    </ol>
  );
}

function VersionItem({
  app,
  policyId,
  summary,
  isActive,
}: {
  app: string;
  policyId: string;
  summary: PolicyVersionSummary;
  isActive: boolean;
}) {
  const t = useTranslations("status");
  const tDetail = useTranslations("detail");
  const [open, setOpen] = useState(false);
  // Lazy: the content is fetched only once the version is expanded (version
  // null → query disabled), so opening the page doesn't fan out N requests.
  const detail = usePolicyVersion(app, policyId, open ? summary.version : null);

  return (
    <Card className="space-y-1 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">v{summary.version}</span>
        {isActive && <Badge tone="success">{t("inProduction")}</Badge>}
      </div>
      <p className="text-xs text-muted">
        {summary.audit.createdBy} · {new Date(summary.audit.createdAt).toLocaleString()}
      </p>
      {summary.audit.changeReason && (
        <p className="text-xs italic text-muted">“{summary.audit.changeReason}”</p>
      )}
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs text-primary">
          {tDetail("viewDocument")}
        </summary>
        {open &&
          (detail.isLoading || !detail.data ? (
            <Skeleton className="mt-2 h-24" />
          ) : detail.error ? (
            <p className="mt-2 text-xs text-danger">{(detail.error as Error).message}</p>
          ) : (
            <pre className="mt-2 overflow-x-auto rounded bg-neutral-bg p-3 text-xs">
              {JSON.stringify(detail.data, null, 2)}
            </pre>
          ))}
      </details>
    </Card>
  );
}
