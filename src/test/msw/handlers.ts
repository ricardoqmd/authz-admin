import { HttpResponse, http } from "msw";
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

export const handlers = [
  http.get("/api/pdp/policies", () =>
    HttpResponse.json<Paginated<PolicyHeadSummary>>({
      data: POLICIES_FIXTURE,
      pagination: { page: 1, size: 50, totalPages: 1, totalElements: 2 },
    }),
  ),
];
