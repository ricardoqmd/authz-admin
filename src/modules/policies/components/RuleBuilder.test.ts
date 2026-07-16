import { describe, expect, it } from "vitest";
import type { Condition, PolicyRule } from "@/lib/pdp/contracts";

type AndCondition = { type: "and" | "or"; conditions: Condition[] };

import { builderToRules, rulesToBuilder } from "./RuleBuilder";

const FLAT_AND_RULE: PolicyRule = {
  id: "scope",
  effect: "PERMIT",
  condition: {
    type: "and",
    conditions: [
      {
        type: "comparison",
        op: "EQ",
        left: { ref: "resource.attr.area" },
        right: { ref: "subject.attr.area" },
      },
      {
        type: "comparison",
        op: "GTE",
        left: { ref: "subject.attr.clearance" },
        right: { value: 3 },
      },
    ],
  },
};

const ROLE_RULE: PolicyRule = {
  id: "admin-can-edit",
  effect: "PERMIT",
  condition: {
    type: "comparison",
    op: "IN",
    left: { value: "administrador" },
    right: { ref: "subject.attr.roles" },
  },
};

describe("rulesToBuilder / builderToRules", () => {
  it("round-trips a flat AND of comparisons", () => {
    const builder = rulesToBuilder([FLAT_AND_RULE]);
    expect(builder).not.toBeNull();
    expect(builder![0].conditions).toHaveLength(2);
    expect(builderToRules(builder!)).toEqual([FLAT_AND_RULE]);
  });

  it("collapses a single condition to a bare comparison (no and-wrapper)", () => {
    const builder = rulesToBuilder([FLAT_AND_RULE])!;
    builder[0].conditions = builder[0].conditions.slice(0, 1);
    const [rule] = builderToRules(builder);
    expect(rule.condition?.type).toBe("comparison");
  });

  it("models a left literal (role membership) instead of stepping aside", () => {
    const builder = rulesToBuilder([ROLE_RULE]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    expect(builder[0].conditions[0]).toMatchObject({
      leftKind: "literal",
      leftText: '"administrador"',
      op: "IN",
      rightKind: "ref",
      rightText: "subject.attr.roles",
    });
    expect(builderToRules(builder)).toEqual([ROLE_RULE]);
  });

  it("steps aside (null) for OR groups — JSON mode territory", () => {
    const orRule: PolicyRule = {
      id: "either",
      effect: "PERMIT",
      condition: {
        type: "or",
        conditions: [
          {
            type: "comparison",
            op: "EQ",
            left: { ref: "subject.id" },
            right: { value: "u1" },
          },
        ],
      },
    };
    expect(rulesToBuilder([orRule])).toBeNull();
  });

  it("auto-types literals: numbers, booleans and strings", () => {
    const builder = rulesToBuilder([FLAT_AND_RULE])!;
    builder[0].conditions[1].rightText = "true";
    let [rule] = builderToRules(builder);
    let and = rule.condition as AndCondition;
    expect(and.conditions[1]).toMatchObject({ right: { value: true } });

    builder[0].conditions[1].rightText = "plain text";
    [rule] = builderToRules(builder);
    and = rule.condition as AndCondition;
    expect(and.conditions[1]).toMatchObject({ right: { value: "plain text" } });
  });
});
