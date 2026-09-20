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
import { useSession } from "@/modules/access/api/session.queries";
import { isRefusal, useDescribeError } from "@/modules/access/errors";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/ui";
import { useEvaluate, useSimulate } from "./api/evaluate.mutations";
import { usePolicy, usePolicyVersion, usePolicyVersions } from "./api/policy.queries";

type Source = "active" | "draft";

/** A verb, or `prefix:verb` — one colon at most, no whitespace, nothing blank. */
const ACTION_SHAPE = /^(?:([^\s:]+):)?[^\s:]+$/;

/**
 * Check the composed action against the resource type it is asked about.
 *
 * The engine selects policies by the verb and, until service-policy ADR-036
 * lands, ignores the prefix — so `document:read` asked of a `report` would be
 * answered as `report:read`, a decision about a question nobody asked. ADR-036
 * turns that disagreement into a `400`. This screen composes an action that
 * agrees either way: its prefix equals the resource type, or it has none (a
 * bare verb names no type and cannot contradict one). Literal comparison, as in
 * the engine: no trimming inside, no case folding.
 */
export function checkAction(
  action: string,
  resourceType: string,
):
  | { ok: true }
  | { ok: false; reason: "shape" }
  | { ok: false; reason: "prefix"; prefix: string } {
  const match = ACTION_SHAPE.exec(action);
  if (!match) return { ok: false, reason: "shape" };
  const prefix = match[1];
  if (prefix !== undefined && prefix !== resourceType) {
    return { ok: false, reason: "prefix", prefix };
  }
  return { ok: true };
}

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
  const describeError = useDescribeError();
  const evaluate = useEvaluate(app);
  const simulate = useSimulate(app);
  /*
   * The caller's own subject, as the verified session reports it. Two different
   * things, kept apart, because the engine treats them differently
   * (service-policy AuthContext, v0.6.1):
   *  - a BLANK `sub` is not an identity. The engine falls back to
   *    `preferred_username` when the subject is blank, so the string this screen
   *    would compare the field against is not the one the engine resolves. Blank
   *    is therefore NOT KNOWN, and an unknown own subject says nothing about
   *    delegation — the rule below needs it defined.
   *  - a `sub` that merely carries spaces IS known, and it is known WITH its
   *    spaces. `callerSubject()` returns a non-blank `sub` verbatim and
   *    `resolveEffectiveSubject` compares it with `equals`, neither side
   *    trimmed. So the raw string is what the field is compared against here;
   *    trimming is only how blank is recognised, never the identity.
   */
  const rawSubject = useSession().data?.sub;
  const ownSubject = rawSubject?.trim() ? rawSubject : undefined;

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
      // The action must agree with the resource type (see checkAction): caught
      // here with a clear message, before the engine is asked anything.
      const trimmedAction = action.trim();
      const trimmedType = resourceType.trim();
      const check = checkAction(trimmedAction, trimmedType);
      if (!check.ok) {
        throw new Error(
          check.reason === "shape"
            ? t("actionFormat")
            : t("actionPrefixMismatch", {
                prefix: check.prefix,
                resourceType: trimmedType,
              }),
        );
      }
      request = {
        action: trimmedAction,
        resource: {
          type: trimmedType,
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

    // Whether a refusal of THIS request can be put down to delegation. The
    // delegated sentence names a cause, so it is shown only where this screen can
    // be right about it, and everything it needs is known here — from the
    // request it built, never from the answer:
    //  - the request goes to evaluate. Simulate runs the engine's control-plane
    //    gate before it resolves the subject, so its refusal may mean "not your
    //    application" whatever the field says.
    //  - the field names a subject, and not the caller's own: the engine asks no
    //    marker for that (service-policy AuthContext.resolveEffectiveSubject). The
    //    caller's subject is the verified `sub` of /api/session; while it is not
    //    known, the screen cannot tell, and says nothing about delegation.
    // Anywhere else a refusal gets the generic sentence.
    const simulating = source === "draft" && policy !== undefined;
    const delegated =
      !simulating &&
      request.subject !== undefined &&
      ownSubject !== undefined &&
      request.subject !== ownSubject;
    try {
      const result =
        simulating && policy
          ? await simulate.mutateAsync({ policy, request } satisfies SimulationRequest)
          : await evaluate.mutateAsync(request);
      setDecision(result);
    } catch (e) {
      // A 400 — the engine's ADR-036 refusal included, whatever its code — is a
      // validation failure like any other: its detail, and its invalidParams when
      // it names fields. A 403 is a refusal, read by its status alone: nothing of
      // its body is shown. When the refusal can be put down to delegation (the
      // rule above), the screen says so — from what it sent, not what came back.
      if (isRefusal(e)) {
        setError(delegated ? t("delegatedRefusal") : describeError(e));
        setErrorParams([]);
        return;
      }
      setError(describeError(e));
      setErrorParams(e instanceof ApiError ? (e.problem?.invalidParams ?? []) : []);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/policies/${app}`} className="text-sm text-muted hover:underline">
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
