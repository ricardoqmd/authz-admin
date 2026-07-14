import { describe, expect, it } from "vitest";
import { createPolicySchema, toPolicyDocument } from "./policy.schema";

const tv = (key: string) => key; // identity translator for tests

const VALID_FORM = {
  policyId: "doc-access",
  app: "records",
  resourceType: "document",
  actions: "read, update",
  combiningAlgorithm: "DENY_OVERRIDES" as const,
  defaultEffect: "DENY" as const,
  rules: [
    {
      id: "r1",
      effect: "PERMIT" as const,
      condition: {
        type: "comparison" as const,
        op: "IN" as const,
        left: { ref: "subject.id" },
        right: { ref: "resource.attr.assignees" },
      },
    },
  ],
};

describe("createPolicySchema", () => {
  it("accepts a valid form", () => {
    expect(createPolicySchema(tv).safeParse(VALID_FORM).success).toBe(true);
  });

  it("rejects a non-kebab policy id", () => {
    const result = createPolicySchema(tv).safeParse({
      ...VALID_FORM,
      policyId: "DocAccess",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an ordering operator with a non-numeric literal (ADR-023 mirror)", () => {
    const result = createPolicySchema(tv).safeParse({
      ...VALID_FORM,
      rules: [
        {
          id: "bad",
          effect: "PERMIT",
          condition: {
            type: "comparison",
            op: "GT",
            left: { ref: "subject.attr.clearance" },
            right: { value: "abc" },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows an ordering operator against a reference (runtime concern, not authoring)", () => {
    const result = createPolicySchema(tv).safeParse({
      ...VALID_FORM,
      rules: [
        {
          id: "ok",
          effect: "PERMIT",
          condition: {
            type: "comparison",
            op: "GT",
            left: { ref: "subject.attr.clearance" },
            right: { ref: "resource.attr.minClearance" },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("toPolicyDocument", () => {
  it("keeps app OUT of the document — it is a route coordinate (R026)", () => {
    const doc = toPolicyDocument(VALID_FORM);
    expect("app" in doc).toBe(false); // a stray app in the body is a 400
    expect(doc.resourceType).toBe("document");
    expect(doc.version).toBe(1);
    expect(doc.actions).toEqual(["read", "update"]);
  });
});
