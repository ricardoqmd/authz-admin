import { z } from "zod";
import type {
  ComparisonOp,
  Condition,
  Operand,
  PolicyDocument,
  PolicyRule,
} from "@/lib/pdp/contracts";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ORDERING_OPS: ComparisonOp[] = ["GT", "GTE", "LT", "LTE"];

export const COMPARISON_OPS: ComparisonOp[] = [
  "EQ",
  "NEQ",
  "IN",
  "NOT_IN",
  "GT",
  "GTE",
  "LT",
  "LTE",
];

export function isOrderingOp(op: ComparisonOp): boolean {
  return ORDERING_OPS.includes(op);
}

/** Translator signature: next-intl's t for the "validation" namespace. */
type Tv = (key: string) => string;

const operandSchema: z.ZodType<Operand> = z.union([
  z.object({ ref: z.string().min(1) }),
  z.object({ value: z.unknown() }),
]);

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("comparison"),
      op: z.enum(COMPARISON_OPS as [ComparisonOp, ...ComparisonOp[]]),
      left: operandSchema,
      right: operandSchema,
    }),
    z.object({
      type: z.enum(["and", "or"]),
      conditions: z.array(z.lazy(() => conditionSchema)),
    }),
  ]),
);

const ruleSchema: z.ZodType<PolicyRule> = z.object({
  id: z.string().min(1),
  effect: z.enum(["PERMIT", "DENY"]),
  condition: conditionSchema.optional(),
});

/**
 * ADR-023, client-side mirror: an ordering operator with a non-numeric LITERAL
 * is rejected at authoring. (A non-numeric REFERENCE resolved at runtime is
 * not an authoring error — the engine denies fail-safe.) The PDP remains the
 * authority; this only saves a round-trip and names the field early.
 */
function findOrderingLiteralViolation(condition: Condition | undefined): boolean {
  if (!condition) return false;
  if (condition.type === "comparison") {
    if (!isOrderingOp(condition.op)) return false;
    for (const operand of [condition.left, condition.right]) {
      if ("value" in operand && typeof operand.value !== "number") return true;
    }
    return false;
  }
  return condition.conditions.some(findOrderingLiteralViolation);
}

/** Form schema factory — messages resolved through the active locale. */
export function createPolicySchema(tv: Tv) {
  return z.object({
    policyId: z.string().min(1, tv("required")).regex(KEBAB, tv("kebabCase")),
    app: z
      .string()
      .min(1, tv("required"))
      .regex(/^[a-z0-9-]+$/, tv("lowercaseId")),
    resourceType: z
      .string()
      .min(1, tv("required"))
      .regex(/^[a-z0-9-]+$/, tv("lowercaseId")),
    actions: z
      .string()
      .min(1, tv("required"))
      .regex(/^\s*(\*|[a-z0-9-]+)(\s*,\s*[a-z0-9-]+)*\s*$/, tv("actionsFormat")),
    combiningAlgorithm: z.enum(["DENY_OVERRIDES", "PERMIT_OVERRIDES"]),
    defaultEffect: z.enum(["PERMIT", "DENY"]),
    rules: z.array(ruleSchema).superRefine((rules, ctx) => {
      rules.forEach((rule, index) => {
        if (findOrderingLiteralViolation(rule.condition)) {
          ctx.addIssue({
            code: "custom",
            path: [index],
            message: "orderingNeedsNumber", // translated at render site
          });
        }
      });
    }),
  });
}

/**
 * Explicit form type (not z.infer): the recursive Condition schema widens
 * inference to unknown[]; the runtime validation is identical either way.
 */
export interface CreatePolicyForm {
  policyId: string;
  app: string;
  resourceType: string;
  actions: string;
  combiningAlgorithm: "DENY_OVERRIDES" | "PERMIT_OVERRIDES";
  defaultEffect: "PERMIT" | "DENY";
  rules: PolicyRule[];
}

/**
 * Compose the PDP policy document from the validated form values.
 * NOTE (R026): form.app is NOT part of the document — it selects the ROUTE
 * (/v1/apps/{app}/policies). A stray `app` in the body is a 400 by design.
 */
export function toPolicyDocument(form: CreatePolicyForm): PolicyDocument {
  return {
    policyId: form.policyId,
    version: 1, // create is always version 1; appends bump it (R014)
    resourceType: form.resourceType,
    actions: form.actions
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    combiningAlgorithm: form.combiningAlgorithm,
    defaultEffect: form.defaultEffect,
    rules: form.rules,
  };
}

export const DEFAULT_RULES: PolicyRule[] = [
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
];
