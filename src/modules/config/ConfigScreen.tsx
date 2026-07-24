"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError } from "@/lib/pdp/client";
import type { AppConfig, AppConfigWrite } from "@/lib/pdp/contracts";
import { usePolicies } from "@/modules/policies/api/policy.queries";
import { Button, Card, Field, Input, Skeleton } from "@/ui";
import {
  useCreateAppConfig,
  useDeleteAppConfig,
  useReplaceAppConfig,
} from "./api/config.mutations";
import { useAppConfig } from "./api/config.queries";

/**
 * Per-app configuration (R029) — subject attribute claim mapping + optional PIP
 * endpoint, administered as a singleton with the same ETag/If-Match discipline
 * as the catalogue. A missing configuration is a first-class, safe state
 * (degrades, never denies): the 404 renders a "declare it" affordance, and
 * DELETE returns the app to that default.
 */
export function ConfigScreen() {
  const t = useTranslations("config");
  const params = useSearchParams();
  const [app, setApp] = useState(params.get("app") ?? "");
  const [creating, setCreating] = useState(false);

  const policies = usePolicies();
  const knownApps = Array.from(
    new Set((policies.data?.data ?? []).map((p) => p.app)),
  ).sort();

  const config = useAppConfig(app);
  const is404 = config.error instanceof ApiError && config.error.status === 404;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-muted">{t("intro")}</p>
      </div>

      <Card>
        <Field label={t("app")} hint={t("appHint")}>
          {(a11y) => (
            <Input
              {...a11y}
              list="config-apps"
              value={app}
              onChange={(e) => {
                setApp(e.target.value.trim());
                setCreating(false);
              }}
              placeholder="kronia"
              className="font-mono"
            />
          )}
        </Field>
        <datalist id="config-apps">
          {knownApps.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </Card>

      {!app ? (
        <p className="text-sm italic text-muted">{t("appEmpty")}</p>
      ) : config.isLoading ? (
        <Skeleton className="h-64" />
      ) : config.data ? (
        <ConfigEditor
          key={`${app}:${config.data.revision}`}
          app={app}
          config={config.data}
        />
      ) : is404 ? (
        creating ? (
          <ConfigEditor
            key={`${app}:new`}
            app={app}
            config={null}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <NoConfig app={app} onCreate={() => setCreating(true)} />
        )
      ) : (
        <Card className="border-danger-bg text-sm text-danger">
          {t("loadError", { message: (config.error as Error).message })}
        </Card>
      )}
    </div>
  );
}

/** The safe empty state: no configuration is a valid default, not a gap. */
function NoConfig({ app, onCreate }: { app: string; onCreate: () => void }) {
  const t = useTranslations("config");
  return (
    <Card className="space-y-3">
      <p className="text-sm font-semibold">{t("noneTitle")}</p>
      <p className="text-sm text-muted">{t("noneBody", { app })}</p>
      <div>
        <Button onClick={onCreate}>{t("create")}</Button>
      </div>
    </Card>
  );
}

type Row = { key: string; value: string };

/** credentialRef is a NAME, never a secret — soft-warn if the value looks like one. */
function looksLikeSecret(v: string): boolean {
  const s = v.trim();
  return /\s/.test(s) || s.length >= 40;
}

const PIP_TIMEOUT_MIN = 1;
const PIP_TIMEOUT_MAX = 10000;
const PIP_CACHE_MIN = 0;
const PIP_CACHE_MAX = 86400;

/**
 * Create/edit form. PUT is a FULL replace (not a section patch): both sections
 * travel together, or a section is omitted to clear it. `onCancel` is passed
 * only in create mode (back to the empty state); in edit mode cancel restores
 * the loaded values.
 */
function ConfigEditor({
  app,
  config,
  onCancel,
}: {
  app: string;
  config: AppConfig | null;
  onCancel?: () => void;
}) {
  const t = useTranslations("config");

  const initialRows = (): Row[] =>
    Object.entries(config?.subjectAttributes ?? {}).map(([key, value]) => ({
      key,
      value,
    }));

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [pipEnabled, setPipEnabled] = useState(!!config?.pip);
  const [url, setUrl] = useState(config?.pip?.url ?? "");
  const [timeoutMs, setTimeoutMs] = useState(
    config?.pip ? String(config.pip.timeoutMs) : "2000",
  );
  const [cacheTtl, setCacheTtl] = useState(
    config?.pip ? String(config.pip.cacheTtlSeconds) : "60",
  );
  const [credentialRef, setCredentialRef] = useState(config?.pip?.credentialRef ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverParams, setServerParams] = useState<{ field: string; reason: string }[]>(
    [],
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = useCreateAppConfig(app);
  const replace = useReplaceAppConfig(app);
  const remove = useDeleteAppConfig(app);
  const pending = create.isPending || replace.isPending;

  function resetToInitial() {
    setRows(initialRows());
    setPipEnabled(!!config?.pip);
    setUrl(config?.pip?.url ?? "");
    setTimeoutMs(config?.pip ? String(config.pip.timeoutMs) : "2000");
    setCacheTtl(config?.pip ? String(config.pip.cacheTtlSeconds) : "60");
    setCredentialRef(config?.pip?.credentialRef ?? "");
    setErrors({});
    setServerParams([]);
    setBanner(null);
  }

  function validate(): { body: AppConfigWrite } | { errors: Record<string, string> } {
    const errs: Record<string, string> = {};

    const filled = rows.filter((r) => r.key.trim() || r.value.trim());
    const seen = new Set<string>();
    const subjectAttributes: Record<string, string> = {};
    for (const [i, r] of filled.entries()) {
      const key = r.key.trim();
      const value = r.value.trim();
      if (!key) errs[`attr.${i}`] = t("vAttrKey");
      else if (!value) errs[`attr.${i}`] = t("vAttrValue");
      else if (seen.has(key)) errs[`attr.${i}`] = t("vDupAttr", { attr: key });
      else {
        seen.add(key);
        subjectAttributes[key] = value;
      }
    }

    let pip: AppConfigWrite["pip"];
    if (pipEnabled) {
      const u = url.trim();
      if (!u) errs["pip.url"] = t("vPipUrl");
      else if (!/^https?:\/\//.test(u) || !u.includes("{sub}"))
        errs["pip.url"] = t("vPipUrlSub");
      const to = Number(timeoutMs);
      if (!Number.isInteger(to) || to < PIP_TIMEOUT_MIN || to > PIP_TIMEOUT_MAX)
        errs["pip.timeoutMs"] = t("vPipTimeout");
      const ttl = Number(cacheTtl);
      if (!Number.isInteger(ttl) || ttl < PIP_CACHE_MIN || ttl > PIP_CACHE_MAX)
        errs["pip.cacheTtlSeconds"] = t("vPipCache");
      const cred = credentialRef.trim();
      if (!cred) errs["pip.credentialRef"] = t("vPipCredential");
      pip = { url: u, timeoutMs: to, cacheTtlSeconds: ttl, credentialRef: cred };
    }

    if (Object.keys(subjectAttributes).length === 0 && !pipEnabled)
      errs.general = t("vAtLeastOne");

    if (Object.keys(errs).length > 0) return { errors: errs };

    const body: AppConfigWrite = {};
    if (Object.keys(subjectAttributes).length > 0)
      body.subjectAttributes = subjectAttributes;
    if (pip) body.pip = pip;
    return { body };
  }

  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 412) {
      setStale(true);
      setBanner(t("stale"));
    } else if (
      error instanceof ApiError &&
      error.problem?.code === "APP_CONFIG_ALREADY_EXISTS"
    ) {
      setBanner(t("alreadyExists"));
    } else if (
      error instanceof ApiError &&
      error.problem?.code === "INVALID_APP_CONFIG" &&
      error.problem.invalidParams?.length
    ) {
      setServerParams(error.problem.invalidParams);
      setBanner(t("invalidConfig"));
    } else {
      setBanner(error instanceof Error ? error.message : String(error));
    }
  }

  async function save() {
    setBanner(null);
    setServerParams([]);
    const result = validate();
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      if (config)
        await replace.mutateAsync({ config: result.body, revision: config.revision });
      else await create.mutateAsync(result.body);
      // Success refetches the query; the screen re-renders into edit mode.
    } catch (error) {
      handleError(error);
    }
  }

  async function del() {
    if (!config) return;
    setBanner(null);
    try {
      await remove.mutateAsync({ revision: config.revision });
    } catch (error) {
      setConfirmDelete(false);
      handleError(error);
    }
  }

  // Inline error for a field: client validation first, then a matching server param.
  function fieldError(field: string): string | undefined {
    return errors[field] ?? serverParams.find((p) => p.field === field)?.reason;
  }
  const knownFields = new Set([
    "pip.url",
    "pip.timeoutMs",
    "pip.cacheTtlSeconds",
    "pip.credentialRef",
  ]);
  const otherParams = serverParams.filter((p) => !knownFields.has(p.field));

  return (
    <Card className="space-y-4 border-primary">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {t("editorTitle", { app })}
          {config && (
            <span className="ml-2 text-xs font-normal text-muted">
              {t("revision", { revision: config.revision })}
            </span>
          )}
        </span>
        {config &&
          (confirmDelete ? (
            <Button
              variant="danger"
              className="h-7 px-2 text-xs"
              disabled={remove.isPending}
              onClick={del}
            >
              {remove.isPending ? t("deleting") : t("confirmDelete")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              {t("deleteConfig")}
            </Button>
          ))}
      </div>

      {banner && (
        <Card className="border-danger-bg text-sm text-danger">
          {banner}
          {otherParams.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {otherParams.map((p) => (
                <li key={p.field}>
                  {t("rejected", { field: p.field, reason: p.reason })}
                </li>
              ))}
            </ul>
          )}
          {stale && (
            <Button
              variant="outline"
              className="mt-2 h-8"
              onClick={() => window.location.reload()}
            >
              {t("reload")}
            </Button>
          )}
        </Card>
      )}

      {/* subjectAttributes ------------------------------------------------ */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t("saTitle")}</span>
          <span className="rounded-full border border-line bg-neutral-bg px-2 py-0.5 text-[11px] text-muted">
            {t("saBadge")}
          </span>
        </div>
        <p className="text-xs text-muted">{t("saHint")}</p>

        {rows.map((row, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) =>
                  setRows(
                    rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                  )
                }
                placeholder={t("attrPlaceholder")}
                className="h-8 font-mono text-xs"
              />
              <span className="text-muted">→</span>
              <Input
                value={row.value}
                onChange={(e) =>
                  setRows(
                    rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                  )
                }
                placeholder={t("claimPlaceholder")}
                className="h-8 font-mono text-xs"
              />
              <button
                type="button"
                className="px-1 text-danger"
                aria-label={t("removeAttr", { attr: row.key || String(i + 1) })}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
            {fieldError(`attr.${i}`) && (
              <p className="text-xs text-danger">{fieldError(`attr.${i}`)}</p>
            )}
          </div>
        ))}
        <Button
          variant="outline"
          className="h-8 px-3 text-xs"
          onClick={() => setRows([...rows, { key: "", value: "" }])}
        >
          {t("addAttr")}
        </Button>
      </section>

      <div className="h-px bg-line" />

      {/* pip -------------------------------------------------------------- */}
      <section className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={pipEnabled}
            onChange={(e) => setPipEnabled(e.target.checked)}
          />
          {t("pipEnable")}
        </label>
        <p className="text-xs text-muted">{t("pipHint")}</p>

        {pipEnabled && (
          <div className="space-y-3">
            <Field
              label={t("pipUrl")}
              hint={t("pipUrlHint")}
              error={fieldError("pip.url")}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://kronia.internal/subjects/{sub}/attributes"
                  className="font-mono text-xs"
                />
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("pipTimeout")}
                hint={t("pipTimeoutHint")}
                error={fieldError("pip.timeoutMs")}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="numeric"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value)}
                    className="font-mono text-xs"
                  />
                )}
              </Field>
              <Field
                label={t("pipCache")}
                hint={t("pipCacheHint")}
                error={fieldError("pip.cacheTtlSeconds")}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="numeric"
                    value={cacheTtl}
                    onChange={(e) => setCacheTtl(e.target.value)}
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>
            <Field
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {t("pipCredential")}
                  <span className="rounded-full border border-danger-bg px-2 py-0.5 text-[11px] text-danger">
                    {t("pipCredentialBadge")}
                  </span>
                </span>
              }
              hint={t("pipCredentialHint")}
              error={fieldError("pip.credentialRef")}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  type="text"
                  value={credentialRef}
                  onChange={(e) => setCredentialRef(e.target.value)}
                  placeholder="kronia-pdp-client"
                  className="font-mono text-xs"
                />
              )}
            </Field>
            {looksLikeSecret(credentialRef) && (
              <p className="rounded-lg border border-line bg-neutral-bg/60 p-2 text-xs text-muted">
                ⚠︎ {t("pipCredentialWarn")}
              </p>
            )}
          </div>
        )}
      </section>

      {errors.general && <p className="text-xs text-danger">{errors.general}</p>}

      <p className="rounded-lg border border-line bg-neutral-bg/40 p-2 text-xs text-muted">
        {t("consumeNote")}
      </p>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => (onCancel ? onCancel() : resetToInitial())}
        >
          {t("cancel")}
        </Button>
        <Button type="button" disabled={pending || stale} onClick={save}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </Card>
  );
}
