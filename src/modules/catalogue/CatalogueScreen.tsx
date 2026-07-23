"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError } from "@/lib/pdp/client";
import type { CatalogueEntry } from "@/lib/pdp/contracts";
import { usePolicies } from "@/modules/policies/api/policy.queries";
import { Button, Card, Field, Input, Skeleton } from "@/ui";
import {
  useCreateCatalogueEntry,
  useDeleteCatalogueEntry,
  useReplaceCatalogueEntry,
} from "./api/catalogue.mutations";
import { useCatalogue } from "./api/catalogue.queries";

/**
 * Action catalogue (R028) — per-app vocabulary management. Declaring the actions
 * that exist for a (app, resourceType) is a prerequisite for authoring policies.
 * CRUD with the same ETag/If-Match discipline as policy heads; the ACTION_IN_USE
 * rejection surfaces the blocking policies so the admin can act.
 */
export function CatalogueScreen() {
  const t = useTranslations("catalogue");
  const params = useSearchParams();
  const [app, setApp] = useState(params.get("app") ?? "");

  // Known apps for the datalist — derived from existing policies (a new app can
  // still be typed by hand).
  const policies = usePolicies();
  const knownApps = Array.from(
    new Set((policies.data?.data ?? []).map((p) => p.app)),
  ).sort();

  const catalogue = useCatalogue(app);
  const entries = catalogue.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      </div>

      <Card>
        <Field label={t("app")} hint={t("appHint")}>
          {(a11y) => (
            <Input
              {...a11y}
              list="catalogue-apps"
              value={app}
              onChange={(e) => setApp(e.target.value.trim())}
              placeholder="kronia"
              className="font-mono"
            />
          )}
        </Field>
        <datalist id="catalogue-apps">
          {knownApps.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </Card>

      {!app ? (
        <p className="text-sm italic text-muted">{t("appEmpty")}</p>
      ) : catalogue.error ? (
        <Card className="border-danger-bg text-sm text-danger">
          {t("loadError", { message: (catalogue.error as Error).message })}
        </Card>
      ) : catalogue.isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="space-y-3">
          {entries.length === 0 && (
            <p className="text-sm italic text-muted">{t("empty")}</p>
          )}
          {entries.map((entry) => (
            <EntryCard key={entry.resourceType} app={app} entry={entry} />
          ))}
          <CreateEntryCard app={app} />
        </div>
      )}
    </div>
  );
}

/** Renders an ApiError: ACTION_IN_USE lists blocking policies; 412 is stale. */
function ErrorNote({
  app,
  error,
  onReload,
}: {
  app: string;
  error: ApiError;
  onReload?: () => void;
}) {
  const t = useTranslations("catalogue");
  const problem = error.problem;
  const policyIds = (problem?.policyIds as string[] | undefined) ?? [];

  if (problem?.code === "ACTION_IN_USE") {
    return (
      <Card className="border-danger-bg text-sm text-danger">
        <p>{t("actionInUse")}</p>
        {policyIds.length > 0 && (
          <p className="mt-1 text-xs">
            {t("blocking")}{" "}
            {policyIds.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Link className="underline" href={`/policies/${app}/${id}`}>
                  {id}
                </Link>
              </span>
            ))}
          </p>
        )}
      </Card>
    );
  }

  if (error.status === 412) {
    return (
      <Card className="border-danger-bg text-sm text-danger">
        <p>{t("stale")}</p>
        {onReload && (
          <Button variant="outline" className="mt-2 h-7 px-2 text-xs" onClick={onReload}>
            {t("reload")}
          </Button>
        )}
      </Card>
    );
  }

  if (problem?.code === "CATALOGUE_ENTRY_ALREADY_EXISTS") {
    return <p className="text-xs text-danger">{t("alreadyExists")}</p>;
  }

  return <p className="text-xs text-danger">{problem?.detail ?? error.message}</p>;
}

function EntryCard({ app, entry }: { app: string; entry: CatalogueEntry }) {
  const t = useTranslations("catalogue");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(entry.actions);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const replace = useReplaceCatalogueEntry(app, entry.resourceType);
  const remove = useDeleteCatalogueEntry(app, entry.resourceType);

  async function save() {
    setError(null);
    try {
      await replace.mutateAsync({ actions: draft, revision: entry.revision });
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
    }
  }

  async function del() {
    setError(null);
    try {
      await remove.mutateAsync({ revision: entry.revision });
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      setConfirmDelete(false);
    }
  }

  return (
    <Card className={`space-y-2 ${editing ? "border-primary" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-mono text-sm font-semibold">{entry.resourceType}</span>
          <span className="ml-2 text-xs text-muted">
            {t("revision", { revision: entry.revision })}
          </span>
        </span>
        {!editing && (
          <span className="flex gap-2">
            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setDraft(entry.actions);
                setError(null);
                setEditing(true);
              }}
            >
              {t("edit")}
            </Button>
            {confirmDelete ? (
              <Button
                variant="danger"
                className="h-7 px-2 text-xs"
                disabled={remove.isPending}
                onClick={del}
              >
                {t("confirmDelete")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                {t("delete")}
              </Button>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <>
          <ActionSetEditor value={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <Button
              className="h-8 px-3 text-xs"
              disabled={replace.isPending}
              onClick={save}
            >
              {replace.isPending ? t("saving") : t("save")}
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-3 text-xs"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entry.actions.map((a) => (
            <span
              key={a}
              className="rounded-full border border-line bg-neutral-bg px-2.5 py-0.5 font-mono text-xs"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {error && (
        <ErrorNote
          app={app}
          error={error}
          onReload={error.status === 412 ? () => window.location.reload() : undefined}
        />
      )}
    </Card>
  );
}

function CreateEntryCard({ app }: { app: string }) {
  const t = useTranslations("catalogue");
  const [resourceType, setResourceType] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const create = useCreateCatalogueEntry(app);

  async function submit() {
    setError(null);
    setLocalError(null);
    if (!resourceType.trim()) return setLocalError(t("resourceTypeRequired"));
    if (actions.length === 0) return setLocalError(t("emptyActions"));
    try {
      await create.mutateAsync({ resourceType: resourceType.trim(), actions });
      setResourceType("");
      setActions([]);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
    }
  }

  return (
    <Card className="space-y-3 bg-neutral-bg/40">
      <span className="text-xs font-semibold text-muted">{t("newEntry")}</span>
      <Field label={t("resourceType")} hint={t("resourceTypeHint")}>
        {(a11y) => (
          <Input
            {...a11y}
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            placeholder="document"
            className="font-mono"
          />
        )}
      </Field>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">{t("actions")}</span>
        <ActionSetEditor value={actions} onChange={setActions} />
      </div>
      {localError && <p className="text-xs text-danger">{localError}</p>}
      <div>
        <Button className="h-8 px-3 text-xs" disabled={create.isPending} onClick={submit}>
          {create.isPending ? t("creating") : t("create")}
        </Button>
      </div>
      {error && <ErrorNote app={app} error={error} />}
    </Card>
  );
}

/** Editable set of action ids: removable chips + an add input. No `"*"`. */
function ActionSetEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("catalogue");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function add() {
    const a = text.trim();
    if (!a) return;
    if (a === "*") return setErr(t("noStar"));
    if (value.includes(a)) return setErr(t("dupAction"));
    onChange([...value, a]);
    setText("");
    setErr(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-xs"
          >
            {a}
            <button
              type="button"
              className="text-danger"
              aria-label={t("removeAction", { action: a })}
              onClick={() => onChange(value.filter((x) => x !== a))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("actionPlaceholder")}
          className="h-8 max-w-[180px] font-mono text-xs"
        />
        <Button variant="outline" className="h-8 px-3 text-xs" onClick={add}>
          {t("addAction")}
        </Button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
