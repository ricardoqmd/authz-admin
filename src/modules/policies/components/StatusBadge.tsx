import { Badge } from "@/ui";

export function StatusBadge({ activeVersion }: { activeVersion: number | null }) {
  return activeVersion !== null ? (
    <Badge tone="success">active · v{activeVersion}</Badge>
  ) : (
    <Badge tone="neutral">inactive</Badge>
  );
}
