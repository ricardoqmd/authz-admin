"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Controller, type Resolver, useForm } from "react-hook-form";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/pdp/client";
import { CatalogueActionsField } from "@/modules/catalogue/CatalogueActionsField";
import { Button, Card, Field, Input, Select } from "@/ui";
import { useCreatePolicy } from "./api/policy.mutations";
import { RuleBuilder } from "./components/RuleBuilder";
import {
  type CreatePolicyForm,
  createPolicySchema,
  DEFAULT_RULES,
  toPolicyDocument,
} from "./policy.schema";

/**
 * Create policy — react-hook-form + zod (schema factory so validation messages
 * follow the active locale). Rules are structured data authored through the
 * visual RuleBuilder (JSON mode for advanced shapes).
 *
 * Error contract handling (RFC 9457):
 *   409 POLICY_ALREADY_EXISTS → inline error on policyId
 *   400/422 INVALID_POLICY    → invalidParams[] mapped onto the form
 *   403 PROJECT_ACCESS_DENIED → banner (no write access to that project)
 */
export function CreatePolicyScreen() {
  const t = useTranslations("create");
  const tRules = useTranslations("rules");
  const tDetail = useTranslations("detail");
  const tv = useTranslations("validation");
  const router = useRouter();
  const { user } = useAuth();
  const create = useCreatePolicy();
  const [banner, setBanner] = useState<string | null>(null);

  const schema = useMemo(() => createPolicySchema((key) => tv(key)), [tv]);

  const {
    register,
    control,
    watch,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreatePolicyForm>({
    resolver: zodResolver(schema) as Resolver<CreatePolicyForm>,
    defaultValues: {
      policyId: "",
      app: "",
      resourceType: "",
      actions: "*",
      combiningAlgorithm: "DENY_OVERRIDES",
      defaultEffect: "DENY",
      rules: DEFAULT_RULES,
    },
  });

  async function onSubmit(values: CreatePolicyForm) {
    setBanner(null);
    try {
      const created = await create.mutateAsync({
        app: values.app,
        document: toPolicyDocument(values),
      });
      router.push(`/policies/${values.app}/${created.policyId}`);
    } catch (error) {
      if (error instanceof ApiError && error.problem) {
        const { code, detail, invalidParams } = error.problem;
        if (code === "POLICY_ALREADY_EXISTS") {
          setError("policyId", { message: t("duplicateId") });
        } else if (code === "INVALID_POLICY" && invalidParams?.length) {
          // The PDP names the exact offending fields (ADR-023) — surface them.
          setBanner(t("pdpRejected"));
          for (const param of invalidParams) {
            setError(mapPdpField(param.field), { message: param.reason });
          }
        } else {
          setBanner(detail ?? error.message);
        }
      } else {
        setBanner((error as Error).message);
      }
    }
  }

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
      <Link href="/policies" className="text-sm text-muted hover:underline">
        ← {tDetail("back")}
      </Link>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted">
        {t.rich("intro", { b: (chunks) => <strong>{chunks}</strong> })}
      </p>

      {banner && <Card className="border-danger-bg text-sm text-danger">{banner}</Card>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card className="space-y-4">
          <Field
            label={t("fields.policyId")}
            error={errors.policyId?.message}
            hint={t("fields.policyIdHint")}
          >
            {(a11y) => (
              <Input {...a11y} {...register("policyId")} placeholder="doc-access" />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("fields.project")}
              error={errors.app?.message}
              hint={t("fields.projectHint")}
            >
              {(a11y) => (
                <>
                  <Input
                    {...a11y}
                    {...register("app")}
                    placeholder="records"
                    list="app-suggestions"
                  />
                  {/* Catalog decision (handoff §5.1): the PDP has no app
                      catalog by design; suggestions come from the session
                      (apps the admin administers). Free text stays allowed —
                      the enforcement seam rejects apps outside the scope. */}
                  <datalist id="app-suggestions">
                    {(user?.apps ?? []).map((app) => (
                      <option key={app} value={app} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field
              label={t("fields.resourceType")}
              error={errors.resourceType?.message}
              hint={t("fields.resourceTypeHint")}
            >
              {(a11y) => (
                <Input {...a11y} {...register("resourceType")} placeholder="document" />
              )}
            </Field>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">{t("fields.actions")}</span>
            <Controller
              control={control}
              name="actions"
              render={({ field }) => (
                <CatalogueActionsField
                  app={watch("app")}
                  resourceType={watch("resourceType")}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.actions?.message && (
              <p className="mt-1 text-xs text-danger">{errors.actions.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.combiningAlgorithm")}>
              {(a11y) => (
                <Select {...a11y} {...register("combiningAlgorithm")}>
                  <option value="DENY_OVERRIDES">{t("fields.denyOverrides")}</option>
                  <option value="PERMIT_OVERRIDES">{t("fields.permitOverrides")}</option>
                </Select>
              )}
            </Field>
            <Field label={t("fields.defaultEffect")}>
              {(a11y) => (
                <Select {...a11y} {...register("defaultEffect")}>
                  <option value="DENY">{t("fields.denyFailSafe")}</option>
                  <option value="PERMIT">{t("fields.permit")}</option>
                </Select>
              )}
            </Field>
          </div>

          <Controller
            control={control}
            name="rules"
            render={({ field }) => (
              <RuleBuilder
                value={field.value}
                onChange={field.onChange}
                error={rulesError}
              />
            )}
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/policies")}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending}>
              {isSubmitting || create.isPending ? t("submitting") : t("submit")}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

/** Map PDP invalidParams field paths onto form field names (best effort). */
function mapPdpField(field: string): "policyId" | "resourceType" | "actions" | "rules" {
  if (field.startsWith("rules")) return "rules";
  if (field === "resourceType") return "resourceType";
  if (field === "policyId") return "policyId";
  if (field === "actions") return "actions";
  return "rules"; // document-level issues surface on the rules editor
}
