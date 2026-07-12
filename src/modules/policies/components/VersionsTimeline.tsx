import type { PolicyVersionSummary } from "@/lib/pdp/contracts";
import { Badge, Card } from "@/ui";

/**
 * Linear vertical timeline — the natural shape for an append-only history,
 * and mobile-friendly by construction. Newest first.
 */
export function VersionsTimeline({
  versions,
  activeVersion,
}: {
  versions: PolicyVersionSummary[];
  activeVersion: number | null;
}) {
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {sorted.map((v) => (
        <li key={v.version} className="relative">
          <span className="absolute -left-[1.42rem] top-3 h-2.5 w-2.5 rounded-full border border-line bg-surface" />
          <Card className="space-y-1 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">v{v.version}</span>
              {v.version === activeVersion && (
                <Badge tone="success">in production</Badge>
              )}
            </div>
            <p className="text-xs text-muted">
              {v.audit.createdBy} ·{" "}
              {new Date(v.audit.createdAt).toLocaleString()}
            </p>
            {v.audit.changeReason && (
              <p className="text-xs italic text-muted">
                “{v.audit.changeReason}”
              </p>
            )}
          </Card>
        </li>
      ))}
    </ol>
  );
}
