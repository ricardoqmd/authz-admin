"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Card, Skeleton } from "@/ui";
import { usePolicy, usePolicyVersions } from "./api/policy.queries";
import { LifecycleActions } from "./components/LifecycleActions";
import { StatusBadge } from "./components/StatusBadge";
import { VersionsTimeline } from "./components/VersionsTimeline";

/**
 * Policy detail — head status + linear versions timeline (append-only history).
 * Write actions (new version / activate / deactivate) land next with the
 * ETag/If-Match pattern.
 */
export function PolicyDetailScreen({ app, policyId }: { app: string; policyId: string }) {
  const t = useTranslations("detail");
  const head = usePolicy(app, policyId);
  const versions = usePolicyVersions(app, policyId);

  if (head.error) {
    return (
      <Card className="border-danger-bg text-danger">
        {(head.error as Error).message}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/policies" className="text-sm text-muted hover:underline">
        ← {t("back")}
      </Link>

      {head.isLoading || !head.data ? (
        <Skeleton className="h-28" />
      ) : (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">{head.data.policyId}</h1>
            <StatusBadge activeVersion={head.data.activeVersion} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge>{head.data.app}</Badge>
            <span className="font-mono">{head.data.resourceType}</span>
            <span>· {t("revision", { revision: head.data.revision })}</span>
          </div>
          {versions.data && (
            <LifecycleActions
              head={head.data}
              versions={versions.data.data}
              onReload={() => {
                head.refetch();
                versions.refetch();
              }}
            />
          )}
          {head.data.activeContent && (
            <details>
              <summary className="cursor-pointer text-sm text-primary">
                {t("activeDocument", { version: head.data.activeVersion ?? 0 })}
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-bg p-3 text-xs">
                {JSON.stringify(head.data.activeContent, null, 2)}
              </pre>
            </details>
          )}
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted">{t("versionHistory")}</h2>
        {versions.isLoading || !versions.data ? (
          <Skeleton className="h-40" />
        ) : (
          <VersionsTimeline
            versions={versions.data.data}
            activeVersion={head.data?.activeVersion ?? null}
          />
        )}
      </section>
    </div>
  );
}
