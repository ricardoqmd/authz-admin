"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError } from "@/lib/pdp/client";
import type { Decision, EvaluationRequest } from "@/lib/pdp/contracts";
import { Badge, Button, Card, Field, Input, Textarea } from "@/ui";
import { useEvaluate } from "./api/evaluate.mutations";

/**
 * Policy tester (v1) — dry-run an authorization case against the app's ACTIVE
 * policies (POST /v1/apps/{app}/evaluate). Testing an explicit inactive version
 * before activation is a future PDP capability (proposed R027); this v1 answers
 * "what would production decide right now".
 */
export function PolicyTesterScreen({ app }: { app: string }) {
  const t = useTranslations("tester");
  const tDetail = useTranslations("detail");
  const evaluate = useEvaluate(app);

  const [action, setAction] = useState("document:read");
  const [resourceType, setResourceType] = useState("document");
  const [resourceId, setResourceId] = useState("d1");
  const [attributes, setAttributes] = useState('{\n  "assignees": ["test-user"]\n}');
  const [subjectAttributes, setSubjectAttributes] = useState("{}");
  const [context, setContext] = useState("{}");
  const [subject, setSubject] = useState("");

  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  function parseOptional(
    label: string,
    text: string,
  ): Record<string, unknown> | undefined {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "{}") return undefined;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error(t("invalidJsonIn", { field: label }));
    }
  }

  async function run() {
    setError(null);
    setJsonError(null);
    setDecision(null);
    let request: EvaluationRequest;
    try {
      request = {
        action: action.trim(),
        resource: {
          type: resourceType.trim(),
          ...(resourceId.trim() ? { id: resourceId.trim() } : {}),
          ...(() => {
            const a = parseOptional(t("attributes"), attributes);
            return a ? { attributes: a } : {};
          })(),
        },
        ...(() => {
          const s = parseOptional(t("subjectAttributes"), subjectAttributes);
          return s ? { subjectAttributes: s } : {};
        })(),
        ...(() => {
          const c = parseOptional(t("context"), context);
          return c ? { context: c } : {};
        })(),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
      };
    } catch (e) {
      setJsonError((e as Error).message);
      return;
    }
    try {
      setDecision(await evaluate.mutateAsync(request));
    } catch (e) {
      if (e instanceof ApiError && e.problem) {
        setError(e.problem.detail ?? e.problem.title);
      } else {
        setError((e as Error).message);
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/policies" className="text-sm text-muted hover:underline">
        ← {tDetail("back")}
      </Link>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Badge>{app}</Badge>
      </div>
      <p className="text-sm text-muted">{t("intro")}</p>

      <Card className="space-y-4">
        <Field label={t("action")} hint={t("actionHint")}>
          {(a11y) => (
            <Input {...a11y} value={action} onChange={(e) => setAction(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("resourceType")}>
            {(a11y) => (
              <Input
                {...a11y}
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("resourceId")} hint={t("optional")}>
            {(a11y) => (
              <Input
                {...a11y}
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("attributes")} hint={t("attributesHint")}>
          {(a11y) => (
            <Textarea
              {...a11y}
              rows={4}
              value={attributes}
              onChange={(e) => setAttributes(e.target.value)}
              spellCheck={false}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("subjectAttributes")} hint={t("jsonHint")}>
            {(a11y) => (
              <Textarea
                {...a11y}
                rows={3}
                value={subjectAttributes}
                onChange={(e) => setSubjectAttributes(e.target.value)}
                spellCheck={false}
              />
            )}
          </Field>
          <Field label={t("context")} hint={t("jsonHint")}>
            {(a11y) => (
              <Textarea
                {...a11y}
                rows={3}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                spellCheck={false}
              />
            )}
          </Field>
        </div>
        <Field label={t("subject")} hint={t("subjectHint")}>
          {(a11y) => (
            <Input
              {...a11y}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("subjectPlaceholder")}
            />
          )}
        </Field>

        {jsonError && <p className="text-xs text-danger">{jsonError}</p>}
        <div className="flex justify-end">
          <Button onClick={run} disabled={evaluate.isPending}>
            {evaluate.isPending ? t("evaluating") : t("evaluate")}
          </Button>
        </div>
      </Card>

      {error && <Card className="border-danger-bg text-sm text-danger">{error}</Card>}

      {decision && (
        <Card
          className={
            decision.allowed
              ? "border-success bg-success-bg/40"
              : "border-danger bg-danger-bg/40"
          }
        >
          <div className="flex items-center gap-2">
            <Badge tone={decision.allowed ? "success" : "danger"}>
              {decision.allowed ? t("permit") : t("deny")}
            </Badge>
            {decision.policyVersion && (
              <span className="text-xs text-muted">
                {t("policyVersion", { version: decision.policyVersion })}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm">{decision.reason}</p>
          <p className="mt-1 font-mono text-xs text-muted">
            {t("decisionId")}: {decision.decisionId}
          </p>
        </Card>
      )}
    </div>
  );
}
