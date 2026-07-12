"use client";

import Link from "next/link";
import { projectOf } from "@/lib/pdp/contracts";
import { Badge, Card, Skeleton } from "@/ui";
import { usePolicy, usePolicyVersions } from "./api/policy.queries";
import { StatusBadge } from "./components/StatusBadge";
import { VersionsTimeline } from "./components/VersionsTimeline";

/**
 * Policy detail — head status + linear versions timeline (append-only history).
 * Write actions (new version / activate / deactivate) land in phase 2 with the
 * ETag/If-Match pattern.
 */
export function PolicyDetailScreen({ policyId }: { policyId: string }) {
  const head = usePolicy(policyId);
  const versions = usePolicyVersions(policyId);

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
        ← Policies
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
            <Badge>{projectOf(head.data)}</Badge>
            <span className="font-mono">{head.data.resourceType}</span>
            <span>· revision {head.data.revision}</span>
          </div>
          {head.data.activeContent && (
            <details>
              <summary className="cursor-pointer text-sm text-primary">
                Active document (v{head.data.activeVersion})
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-bg p-3 text-xs">
                {JSON.stringify(head.data.activeContent, null, 2)}
              </pre>
            </details>
          )}
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted">Version history</h2>
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
