import { HttpResponse, http } from "msw";
import type { SessionView } from "@/lib/auth/session";
import type { Paginated, PolicyHeadSummary } from "@/lib/pdp/contracts";

export const POLICIES_FIXTURE: PolicyHeadSummary[] = [
  {
    policyId: "doc-access",
    app: "records",
    resourceType: "document",
    activeVersion: 2,
    revision: 3,
    audit: {
      createdBy: "someone",
      createdAt: "2026-07-10T12:00:00Z",
      changeReason: "go live",
    },
  },
  {
    policyId: "billing-reports",
    app: "billing",
    resourceType: "report",
    activeVersion: null,
    revision: 0,
    audit: {
      createdBy: "someone",
      createdAt: "2026-07-11T12:00:00Z",
      changeReason: null,
    },
  },
];

/** What the default session reports: the apps the (mock) token carries. */
export const SESSION_FIXTURE: SessionView = {
  sub: "mock-admin",
  apps: ["records", "billing"],
};

export const handlers = [
  http.get("/api/session", () => HttpResponse.json<SessionView>(SESSION_FIXTURE)),
  http.get("/api/pdp/policies", () =>
    HttpResponse.json<Paginated<PolicyHeadSummary>>({
      data: POLICIES_FIXTURE,
      pagination: { page: 1, size: 50, totalPages: 1, totalElements: 2 },
    }),
  ),
];

/**
 * The engine's refusal as the BFF passes it through: service-policy 0.6.1's one
 * control-plane denial, byte for byte, served as application/problem+json. The
 * engine answers an application the caller does not hold and one that does not
 * exist with exactly this — so a test that needs "the refusal" uses this and
 * nothing hand-made.
 */
export const ENGINE_REFUSAL_BODY =
  '{"type":"https://github.com/ricardoqmd/service-policy/blob/main/docs/ERRORS.md#forbidden",' +
  '"code":"FORBIDDEN","title":"Forbidden","status":403,' +
  '"detail":"not authorized for this control-plane operation."}';

export function engineRefusal() {
  return new HttpResponse(ENGINE_REFUSAL_BODY, {
    status: 403,
    headers: { "content-type": "application/problem+json" },
  });
}
