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

/* ---- evaluation (data plane) ---- */

export interface EvaluationRequest {
  action: string; // "resource:verb", e.g. "document:read"
  resource: { type: string; id?: string; attributes?: Record<string, unknown> };
  context?: Record<string, unknown>;
  subjectAttributes?: Record<string, unknown>;
  /** Explicit subject → delegated query (needs the delegation marker). */
  subject?: string;
}

export interface Decision {
  allowed: boolean;
  reason: string;
  decisionId: string;
  policyVersion: string | null;
  obligations: unknown[];
}

/**
 * Dry-run simulation (R027): evaluate a hypothetical policy document — a draft
 * being edited, or the content of a saved version — against a case, without
 * persisting anything. POST /v1/apps/{app}/policies:simulate. The PDP validates
 * `policy` exactly like a create (400 INVALID_POLICY if malformed) BEFORE
 * evaluating, so a returned Decision implies the document is valid. Same
 * Decision shape as /evaluate — the render is reused.
 */
export interface SimulationRequest {
  /** Full policy document (no app — the route carries it, R026). */
  policy: PolicyDocument;
  /** The hypothetical case, same shape as an evaluate body (no app). */
  request: EvaluationRequest;
}

/* ---- action catalogue (R028) ---- */

/**
 * The declared vocabulary of a (app, resourceType): the set of action ids that
 * exist for that resource type. Authoring a policy whose actions fall outside
 * it is rejected. `app` comes from the route; `revision` is the strong ETag.
 */
export interface CatalogueEntry {
  app: string;
  resourceType: string;
  actions: string[];
  revision: number;
}

/**
 * GET /v1/apps/{app}/action-catalogue — the full (unpaginated) vocabulary.
 * Uses the API's `data` collection envelope (like Paginated, minus pagination —
 * a vocabulary is bounded); the list is not wrapped in `entries` (v0.4.1).
 */
export interface CatalogueList {
  data: CatalogueEntry[];
}

/* ---- per-app configuration (R029) ---- */

/**
 * Remote attribute source (PIP). `url` MUST be http(s) and carry the `{sub}`
 * placeholder (the opaque Keycloak subject id). `credentialRef` is a NAME
 * pointing at the deployment's secret mechanism — NEVER the secret itself; the
 * PDP stores only the reference and the adapter (R031) resolves it. Bounds:
 * timeoutMs 1–10000, cacheTtlSeconds 0–86400.
 */
export interface PipConfig {
  url: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  credentialRef: string;
}

/**
 * The per-app configuration singleton (R029): where subject attributes come
 * from (claim mapping) plus the optional PIP endpoint. A missing configuration
 * DEGRADES (attributes taken from the token as-is), it never denies. Absent
 * sections are omitted from the JSON (not empty objects). `app` is set by the
 * server from the route; `revision` is the strong ETag for If-Match writes.
 */
export interface AppConfig {
  app: string;
  /** attribute name → claim path (e.g. roles → resource_access.kronia.roles). */
  subjectAttributes?: Record<string, string>;
  pip?: PipConfig;
  revision: number;
}

/**
 * Create/replace body (no `app` — the route carries it, R026; no `revision` —
 * that travels as If-Match). At least one section must be present; a fully
 * empty config is rejected (INVALID_APP_CONFIG). To remove configuration
 * entirely, DELETE it (returns to the degraded default).
 */
export interface AppConfigWrite {
  subjectAttributes?: Record<string, string>;
  pip?: PipConfig;
}
