"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/pdp/client";
import { Input } from "@/ui";
import { useCatalogueEntry } from "./api/catalogue.queries";

/**
 * Catalogue-aware actions field (R028). Replaces the free-text actions input in
 * the policy editor: it fetches the (app, resourceType) catalogue and offers a
 * multi-select of the declared actions plus a "todas (*)" toggle that submits
 * `["*"]` (the PDP expands it at authoring). If the resource type has no
 * vocabulary, it prompts to declare one instead of letting the write 400.
 *
 * The field value stays the comma-separated string the schema already parses
 * ("create, edit" or "*") — this is a UI over that string, so nothing downstream
 * changes.
 */
export function CatalogueActionsField({
  app,
  resourceType,
  value,
  onChange,
}: {
  app: string;
  resourceType: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTranslations("catalogueActions");
  const entry = useCatalogueEntry(app.trim(), resourceType.trim());

  if (!app.trim() || !resourceType.trim()) {
    return <p className="text-xs italic text-muted">{t("pickFirst")}</p>;
  }

  if (entry.isLoading) {
    return <p className="text-xs text-muted">{t("loading")}</p>;
  }

  // Undeclared vocabulary → guide the admin to declare it (deep-link to the app).
  if (entry.error instanceof ApiError && entry.error.status === 404) {
    return (
      <div className="rounded-lg border border-line bg-neutral-bg/60 p-3 text-xs">
        <p>{t("notDeclared", { app, resourceType })}</p>
        <Link
          className="mt-1 inline-block font-medium text-primary underline"
          href={`/catalogue?app=${encodeURIComponent(app.trim())}`}
        >
          {t("declareLink")}
        </Link>
      </div>
    );
  }

  // Any other read failure: don't block authoring — fall back to free text.
  if (entry.error || !entry.data) {
    return (
      <div className="space-y-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
        <p className="text-xs text-muted">{t("fallbackHint")}</p>
      </div>
    );
  }

  const catalogue = entry.data.actions;
  const isAll = value.trim() === "*";
  const selected = new Set(
    isAll
      ? []
      : value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
  );

  function toggle(action: string) {
    const next = new Set(selected);
    if (next.has(action)) next.delete(action);
    else next.add(action);
    // Preserve catalogue order in the emitted string.
    onChange(catalogue.filter((a) => next.has(a)).join(", "));
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {catalogue.map((action) => (
          <label
            key={action}
            className={`flex items-center gap-2 rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-xs ${
              isAll ? "opacity-45" : ""
            }`}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary"
              checked={isAll || selected.has(action)}
              disabled={isAll}
              onChange={() => toggle(action)}
            />
            {action}
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-primary"
          checked={isAll}
          onChange={(e) => onChange(e.target.checked ? "*" : "")}
        />
        {t("all")}
      </label>

      {isAll && (
        <p className="font-mono text-xs text-muted">
          {t("allPreview", { actions: catalogue.join(", ") })}
        </p>
      )}
    </div>
  );
}
