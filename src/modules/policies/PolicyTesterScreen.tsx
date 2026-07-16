"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/pdp/client";
import type {
  Decision,
  EvaluationRequest,
  PolicyDocument,
  SimulationRequest,
} from "@/lib/pdp/contracts";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/ui";
import { useEvaluate, useSimulate } from "./api/evaluate.mutations";
import { usePolicy, usePolicyVersion, usePolicyVersions } from "./api/policy.queries";

type Source = "active" | "draft";

/** Starter draft: a valid document (mirrors DEFAULT_RULES) the admin edits. */
const DRAFT_SKELETON = JSON.stringify(
  {
    policyId: "draft",
    version: 1,
    resourceType: "document",
    actions: ["*"],
    combiningAlgorithm: "DENY_OVERRIDES",
    defaultEffect: "DENY",
    rules: [
      {
        id: "assigned-access",
        effect: "PERMIT",
        condition: {
          type: "comparison",
          op: "IN",
          left: { ref: "subject.id" },
          right: { ref: "resource.attr.assignees" },
        },
      },
    ],
  },
  null,
  2,
);

/**
 * Policy tester (v3) — two sources:
 *  - "active": POST /v1/apps/{app}/evaluate — what production decides now.
 *  - "draft":  POST /v1/apps/{app}/policies:simulate (R027) — dry-run a policy
 *    document with zero effect. The PDP validates it as a create first, so an
 *    INVALID_POLICY comes back with the same invalidParams as create.
 *
 * When reached from a specific policy (policyId given), the draft is prefilled
 * with that policy's version content: one version → prefilled directly; many →
 * a version selector chooses which one prefills. So you can dry-run any saved
 * version — active or not — without activating it.
 */
export function PolicyTesterScreen({
  app,
  policyId,
}: {
  app: string;
  policyId?: string;
}) {
  const t = useTranslations("tester");
  const tDetail = useTranslations("detail");
  const evaluate = useEvaluate(app);
  const simulate = useSimulate(app);

  const scoped = Boolean(policyId);
  const pid = policyId ?? "";
  const head = usePolicy(app, pid);
  const versionsQuery = usePolicyVersions(app, pid);
  const versions = versionsQuery.data?.data ?? [];

  const [source, setSource] = useState<Source>(scoped ? "draft" : "active");
  const [policyDraft, setPolicyDraft] = useState(DRAFT_SKELETON);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const [action, setAction] = useState("document:read");
  const [resourceType, setResourceType] = useState("document");
  const [resourceId, setResourceId] = useState("d1");
  const [attributes, setAttributes] = useState('{\n  "assignees": ["test-user"]\n}');
  const [subjectAttributes, setSubjectAttributes] = useState("{}");
  const [context, setContext] = useState("{}");
  const [subject, setSubject] = useState("");

  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorParams, setErrorParams] = useState<{ field: string; reason: string }[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const pending = evaluate.isPending || simulate.isPending;

  // Pick the version to prefill from: the active one, else the latest.
  useEffect(() => {
    if (!scoped || selectedVersion !== null || versions.length === 0) return;
    const active = head.data?.activeVersion ?? null;
    const latest = Math.max(...versions.map((v) => v.version));
    setSelectedVersion(active ?? latest);
  }, [scoped, selectedVersion, versions, head.data]);

  const versionContent = usePolicyVersion(app, pid, scoped ? selectedVersion : null);

  // Prefill the draft (and derive action/resourceType) from the chosen version.
  // Keys off the loaded document only; the setters are stable.
  useEffect(() => {
    const doc = versionContent.data;
    if (!doc) return;
    setPolicyDraft(JSON.stringify(doc, null, 2));
    setSource("draft");
    setResourceType(doc.resourceType);
    const verb = doc.actions[0];
    if (verb && verb !== "*") setAction(`${doc.resourceType}:${verb}`);
  }, [versionContent.data]);

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
    setErrorParams([]);
    setJsonError(null);
    setDecision(null);

    let request: EvaluationRequest;
    let policy: PolicyDocument | undefined;
    try {
      // The engine reads the verb from a "resource:verb" action; a bare or
      // hyphenated value (e.g. "stepper-create") selects nothing and comes back
      // as "no applicable policy". Catch the shape here with a clear message.
      const trimmedAction = action.trim();
      if (!/^[^\s:]+:[^\s:]+$/.test(trimmedAction)) {
        throw new Error(t("actionFormat"));
      }
      request = {
        action: trimmedAction,
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
      if (source === "draft") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(policyDraft);
        } catch {
          throw new Error(t("invalidPolicyJson"));
        }
        // Common mistake: pasting the bare rules array (what the RuleBuilder's
        // JSON mode takes) instead of a full document. Catch it client-side so
        // the user gets a clear message, not a raw upstream deserialization 400.
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed) ||
          !("policyId" in parsed) ||
          !("rules" in parsed)
        ) {
          throw new Error(t("policyNotDocument"));
        }
        policy = parsed as PolicyDocument;
      }
    } catch (e) {
      setJsonError((e as Error).message);
      return;
    }

    try {
      const result =
        source === "draft" && policy
          ? await simulate.mutateAsync({ policy, request } satisfies SimulationRequest)
          : await evaluate.mutateAsync(request);
      setDecision(result);
    } catch (e) {
      if (e instanceof ApiError && e.problem) {
        setError(e.problem.detail ?? e.problem.title);
        setErrorParams(e.problem.invalidParams ?? []);
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
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Badge>{app}</Badge>
        {scoped && <span className="font-mono text-sm text-muted">{policyId}</span>}
      </div>
      <p className="text-sm text-muted">{t("intro")}</p>

      <Card className="space-y-4">
        <Field label={t("source")} hint={t("sourceHint")}>
          {(a11y) => (
            <Select
              {...a11y}
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
            >
              <option value="active">{t("sourceActive")}</option>
              <option value="draft">{t("sourceDraft")}</option>
            </Select>
          )}
        </Field>

        {source === "draft" && scoped && versions.length > 1 && (
          <Field label={t("version")} hint={t("versionHint")}>
            {(a11y) => (
              <Select
                {...a11y}
                value={selectedVersion ?? ""}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
              >
                {[...versions]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version}
                      {v.version === head.data?.activeVersion
                        ? ` · ${t("versionActiveMark")}`
                        : ""}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}

        {source === "draft" && (
          <Field label={t("policyDraft")} hint={t("policyDraftHint")}>
            {(a11y) => (
              <Textarea
                {...a11y}
                rows={12}
                value={policyDraft}
                onChange={(e) => setPolicyDraft(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
            )}
          </Field>
        )}
      </Card>

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
          <Button onClick={run} disabled={pending}>
            {pending ? t("evaluating") : t("evaluate")}
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="border-danger-bg text-sm text-danger">
          <p>{error}</p>
          {errorParams.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {errorParams.map((p) => (
                <li key={`${p.field}:${p.reason}`}>
                  <span className="font-mono">{p.field}</span> — {p.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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
