import { useTranslations } from "next-intl";
import { Badge } from "@/ui";

export function StatusBadge({ activeVersion }: { activeVersion: number | null }) {
  const t = useTranslations("status");
  return activeVersion !== null ? (
    <Badge tone="success">{t("active", { version: activeVersion })}</Badge>
  ) : (
    <Badge tone="neutral">{t("inactive")}</Badge>
  );
}
