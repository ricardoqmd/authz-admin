/*
 * Wire contracts of the service-policy PDP (hand-written from the documented
 * REST contract). Once the PDP is running locally, regenerate the full typed
 * client from its live OpenAPI with:  pnpm generate:pdp-types
 * (see scripts/generate-pdp-types.mjs). These hand-written shapes cover the
 * read surface consumed in phase 1.
 */

export interface AuditView {
  createdBy: string;
  createdAt: string;
  changeReason: string | null;
}

export interface PolicyHeadSummary {
  policyId: string;
  /** Owning application — first-class scoping dimension (R024). */
  app: string;
  resourceType: string;
  /** null while the policy is inactive. */
  activeVersion: number | null;
  revision: number;
  audit: AuditView;
}

export interface PolicyHeadView extends PolicyHeadSummary {
  /** Full policy document of the active version; null while inactive. */
  activeContent: PolicyDocument | null;
}

export interface PolicyVersionSummary {
  policyId: string;
  version: number;
  app: string;
  resourceType: string;
  audit: AuditView;
}

/** A single immutable version, including its full policy document. */
export interface PolicyVersionView extends PolicyVersionSummary {
  content: PolicyDocument;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    size: number;
    totalPages: number;
    totalElements: number;
  };
}

/* ---- policy document (what the editor will build in phase 2) ---- */

export type ComparisonOp = "EQ" | "NEQ" | "IN" | "NOT_IN" | "GT" | "GTE" | "LT" | "LTE";

export type Operand = { ref: string } | { value: unknown };

export type Condition =
  | { type: "comparison"; op: ComparisonOp; left: Operand; right: Operand }
  | { type: "and" | "or"; conditions: Condition[] };

export interface PolicyRule {
  id: string;
  effect: "PERMIT" | "DENY";
  condition?: Condition;
}

/**
 * The policy CONTENT (create/append body). Since R026 the app travels ONLY in
 * the route (/v1/apps/{app}/...): sending `app` in a body is a 400 — the
 * server rejects it even when it matches the route, so route-vs-body
 * ambiguity is unrepresentable. Read views (below) DO carry `app`.
 */
export interface PolicyDocument {
  policyId: string;
  version: number;
  /** Clean type name (e.g. "document") — namespaced per app by the route. */
  resourceType: string;
  actions: string[];
  combiningAlgorithm: "DENY_OVERRIDES" | "PERMIT_OVERRIDES";
  defaultEffect: "PERMIT" | "DENY";
  rules: PolicyRule[];
}

/* ---- RFC 9457 problem+json (uniform error contract of the PDP) ---- */

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  invalidParams?: { field: string; reason: string }[];
  [ext: string]: unknown;
}

export function isProblem(value: unknown): value is Problem {
  return (
    typeof value === "object" && value !== null && "status" in value && "code" in value
  );
}
