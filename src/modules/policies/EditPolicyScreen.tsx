"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Controller, type Resolver, useForm } from "react-hook-form";
import { ApiError } from "@/lib/pdp/client";
import type { PolicyRule } from "@/lib/pdp/contracts";
import { Button, Card, Field, Input, Select, Skeleton } from "@/ui";
import { useAppendVersion } from "./api/policy.mutations";
import { usePolicy, usePolicyVersion, usePolicyVersions } from "./api/policy.queries";
import { RuleBuilder } from "./components/RuleBuilder";
import { type EditPolicyForm, editPolicySchema, toPolicyDocument } from "./policy.schema";

/**
 * Edit = append a new version (R014). The form is prefilled from the latest
 * version's content; policyId, app and version number are fixed. The write is
 * conditional (R018): If-Match = head revision, with the same reload-and-retry
 * UX as activation. The new version is created INACTIVE — a separate activate
 * step puts it in production (R020).
 */
export function EditPolicyScreen({ app, policyId }: { app: string; policyId: string }) {
  const t = useTranslations("edit");
  const tc = useTranslations("create");
  const tRules = useTranslations("rules");
  const tLife = useTranslations("lifecycle");
  const tv = useTranslations("validation");
  const router = useRouter();

  const head = usePolicy(app, policyId);
  const versions = usePolicyVersions(app, policyId);
  const latestVersion = versions.data
    ? Math.max(...versions.data.data.map((v) => v.version))
    : null;
  const latest = usePolicyVersion(app, policyId, latestVersion);
  const append = useAppendVersion(app, policyId);

  const [banner, setBanner] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const schema = useMemo(() => editPolicySchema((key) => tv(key)), [tv]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditPolicyForm>({
    resolver: zodResolver(schema) as Resolver<EditPolicyForm>,
    defaultValues: {
      resourceType: "",
      actions: "*",
      combiningAlgorithm: "DENY_OVERRIDES",
      defaultEffect: "DENY",
      rules: [],
      changeReason: "",
    },
  });

  // Prefill once the latest version is loaded. The version endpoint returns
  // the policy document directly (not wrapped in `content`).
  useEffect(() => {
    const c = latest.data;
    if (c) {
      reset({
        resourceType: c.resourceType,
        actions: c.actions.join(", "),
        combiningAlgorithm: c.combiningAlgorithm,
        defaultEffect: c.defaultEffect,
        rules: c.rules,
        changeReason: "",
      });
    }
  }, [latest.data, reset]);

  async function onSubmit(values: EditPolicyForm) {
    setBanner(null);
    if (!head.data || latestVersion === null) return;
    try {
      await append.mutateAsync({
        content: toPolicyDocument({ ...values, policyId }, latestVersion + 1),
        changeReason: values.changeReason,
        revision: head.data.revision, // R018: If-Match = the head we were shown
      });
      router.push(`/policies/${app}/${policyId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        setStale(true);
        setBanner(t("staleRevision"));
      } else if (error instanceof ApiError && error.problem) {
        const { code, detail, invalidParams } = error.problem;
        if (code === "INVALID_POLICY" && invalidParams?.length) {
          setBanner(tc("pdpRejected"));
          for (const p of invalidParams) {
            if (p.field.startsWith("rules")) setError("rules", { message: p.reason });
            else if (p.field === "resourceType")
              setError("resourceType", { message: p.reason });
            else setError("rules", { message: p.reason });
          }
        } else {
          setBanner(detail ?? error.message);
        }
      } else {
        setBanner((error as Error).message);
      }
    }
  }

  const loading = head.isLoading || versions.isLoading || latest.isLoading;

  const rulesError =
    errors.rules?.message ??
    (Array.isArray(errors.rules)
      ? errors.rules
          .filter(Boolean)
          .map((e) =>
            e?.message === "orderingNeedsNumber"
              ? tRules("orderingNeedsNumber")
              : e?.message,
          )
          .join(" · ")
      : undefined);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href={`/policies/${app}/${policyId}`}
        className="text-sm text-muted hover:underline"
      >
        ← {policyId}
      </Link>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted">
        {t.rich("intro", {
          b: (chunks) => <strong>{chunks}</strong>,
          version: (latestVersion ?? 0) + 1,
        })}
      </p>

      {banner && (
        <Card className="border-danger-bg text-sm text-danger">
          {banner}
          {stale && (
            <Button
              variant="outline"
              className="mt-2 h-8"
              onClick={() => {
                head.refetch();
                versions.refetch();
                latest.refetch();
                setStale(false);
                setBanner(null);
              }}
            >
              {tLife("reloadAndRetry")}
            </Button>
          )}
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-96" />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Card className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tc("fields.policyId")} hint={t("fixedHint")}>
                {(a11y) => <Input {...a11y} value={policyId} disabled readOnly />}
              </Field>
              <Field label={tc("fields.project")} hint={t("fixedHint")}>
                {(a11y) => <Input {...a11y} value={app} disabled readOnly />}
              </Field>
            </div>

            <Field
              label={tc("fields.resourceType")}
              error={errors.resourceType?.message}
              hint={tc("fields.resourceTypeHint")}
            >
              {(a11y) => <Input {...a11y} {...register("resourceType")} />}
            </Field>

            <Field
              label={tc("fields.actions")}
              error={errors.actions?.message}
              hint={tc("fields.actionsHint")}
            >
              {(a11y) => <Input {...a11y} {...register("actions")} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tc("fields.combiningAlgorithm")}>
                {(a11y) => (
                  <Select {...a11y} {...register("combiningAlgorithm")}>
                    <option value="DENY_OVERRIDES">{tc("fields.denyOverrides")}</option>
                    <option value="PERMIT_OVERRIDES">
                      {tc("fields.permitOverrides")}
                    </option>
                  </Select>
                )}
              </Field>
              <Field label={tc("fields.defaultEffect")}>
                {(a11y) => (
                  <Select {...a11y} {...register("defaultEffect")}>
                    <option value="DENY">{tc("fields.denyFailSafe")}</option>
                    <option value="PERMIT">{tc("fields.permit")}</option>
                  </Select>
                )}
              </Field>
            </div>

            <Controller
              control={control}
              name="rules"
              render={({ field }) => (
                <RuleBuilder
                  value={field.value as PolicyRule[]}
                  onChange={field.onChange}
                  error={rulesError}
                />
              )}
            />

            <Field
              label={t("changeReason")}
              error={errors.changeReason?.message}
              hint={t("changeReasonHint")}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  {...register("changeReason")}
                  placeholder={t("changeReasonPlaceholder")}
                />
              )}
            </Field>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/policies/${app}/${policyId}`)}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || append.isPending || stale}>
                {isSubmitting || append.isPending
                  ? t("saving")
                  : t("submit", { version: (latestVersion ?? 0) + 1 })}
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
