"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { projectOf, type PolicyHeadSummary } from "@/lib/pdp/contracts";
import { Badge, Button, Card, Skeleton } from "@/ui";
import { usePolicies } from "./api/policy.queries";
import { StatusBadge } from "./components/StatusBadge";

/**
 * Policies list — mobile-first: cards on small screens, table from md up.
 * Project grouping uses the `<app>:<type>` convention (projectOf) until the
 * PDP grows a first-class `app` field.
 */
export function PoliciesScreen() {
  const { user } = useAuth();
  const { data, isLoading, error } = usePolicies();
  const [project, setProject] = useState<string>("all");

  const policies = data?.data ?? [];

  const projects = useMemo(() => {
    const visible = new Set(policies.map(projectOf));
    return ["all", ...Array.from(visible).sort()];
  }, [policies]);

  const filtered = useMemo(
    () =>
      project === "all"
        ? policies
        : policies.filter((p) => projectOf(p) === project),
    [policies, project],
  );

  if (error) {
    return (
      <Card className="border-danger-bg text-danger">
        Could not reach the PDP: {(error as Error).message}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Policies</h1>
        <span className="text-sm text-muted">
          {user?.name} · {filtered.length} policies
        </span>
      </div>

      {/* project filter — becomes the persistent project selector later */}
      <div className="flex flex-wrap gap-2">
        {projects.map((p) => (
          <Button
            key={p}
            variant={p === project ? "primary" : "outline"}
            className="h-8 px-3"
            onClick={() => setProject(p)}
          >
            {p}
          </Button>
        ))}
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
              <li key={p.policyId}>
                <PolicyCard policy={p} />
              </li>
            ))}
          </ul>

          {/* desktop: table */}
          <div className="hidden overflow-hidden rounded border border-line md:block">
            <table className="w-full bg-surface text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Policy</th>
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Resource type</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Last change</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.policyId} className="border-b border-line last:border-0 hover:bg-neutral-bg">
                    <td className="px-4 py-2">
                      <Link href={`/policies/${p.policyId}`} className="font-medium text-primary hover:underline">
                        {p.policyId}
                      </Link>
                    </td>
                    <td className="px-4 py-2"><Badge>{projectOf(p)}</Badge></td>
                    <td className="px-4 py-2 font-mono text-xs">{p.resourceType}</td>
                    <td className="px-4 py-2"><StatusBadge activeVersion={p.activeVersion} /></td>
                    <td className="px-4 py-2 text-muted">
                      {p.audit.createdBy} · {new Date(p.audit.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <Card className="text-center text-muted">
              No policies yet. Create one against the PDP (see lifecycle-walkthrough.http) and refresh.
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PolicyCard({ policy }: { policy: PolicyHeadSummary }) {
  return (
    <Link href={`/policies/${policy.policyId}`} className="block">
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-primary">{policy.policyId}</span>
          <StatusBadge activeVersion={policy.activeVersion} />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <Badge>{projectOf(policy)}</Badge>
          <span className="font-mono">{policy.resourceType}</span>
        </div>
        <p className="text-xs text-muted">
          {policy.audit.createdBy} · {new Date(policy.audit.createdAt).toLocaleDateString()}
        </p>
      </Card>
    </Link>
  );
}
