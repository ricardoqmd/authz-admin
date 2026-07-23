import { describe, expect, it } from "vitest";
import type { Condition, PolicyRule } from "@/lib/pdp/contracts";
import { builderToRules, rulesToBuilder } from "./RuleBuilder";

type AndCondition = { type: "and" | "or"; conditions: Condition[] };

const cmp = (op: string, l: string, r: string): Condition =>
  ({ type: "comparison", op, left: { ref: l }, right: { ref: r } }) as Condition;

const FLAT_AND_RULE: PolicyRule = {
  id: "scope",
  effect: "PERMIT",
  condition: {
    type: "and",
    conditions: [
      cmp("EQ", "resource.attr.area", "subject.attr.area"),
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

// (admin) OR (capturista AND (status=draft OR status=review)) — 3 levels.
const NESTED_RULE: PolicyRule = {
  id: "stepper-edit-access",
  effect: "PERMIT",
  condition: {
    type: "or",
    conditions: [
      {
        type: "comparison",
        op: "IN",
        left: { value: "administrador" },
        right: { ref: "subject.attr.roles" },
      },
      {
        type: "and",
        conditions: [
          {
            type: "comparison",
            op: "IN",
            left: { value: "capturista" },
            right: { ref: "subject.attr.roles" },
          },
          {
            type: "or",
            conditions: [
              {
                type: "comparison",
                op: "EQ",
                left: { ref: "resource.attr.status" },
                right: { value: "draft" },
              },
              {
                type: "comparison",
                op: "EQ",
                left: { ref: "resource.attr.status" },
                right: { value: "review" },
              },
            ],
          },
        ],
      },
    ],
  },
};

describe("rulesToBuilder / builderToRules", () => {
  it("round-trips a flat AND of comparisons (single group)", () => {
    const builder = rulesToBuilder([FLAT_AND_RULE]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    expect(builder[0].groups).toHaveLength(1);
    expect(builder[0].groups[0].rows).toHaveLength(2);
    expect(builderToRules(builder)).toEqual([FLAT_AND_RULE]);
  });

  it("round-trips a flat OR of comparisons", () => {
    const orRule: PolicyRule = {
      id: "either",
      effect: "PERMIT",
      condition: {
        type: "or",
        conditions: [
          cmp("EQ", "subject.id", "resource.attr.owner"),
          cmp("IN", "subject.id", "resource.attr.assignees"),
        ],
      },
    };
    const builder = rulesToBuilder([orRule]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    expect(builder[0].groups[0].combinator).toBe("or");
    expect(builderToRules(builder)).toEqual([orRule]);
  });

  it("models a left literal (role membership)", () => {
    const builder = rulesToBuilder([ROLE_RULE]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    expect(builder[0].groups[0].rows[0]).toMatchObject({
      leftKind: "literal",
      leftText: '"administrador"',
      rightKind: "ref",
      rightText: "subject.attr.roles",
    });
    expect(builderToRules(builder)).toEqual([ROLE_RULE]);
  });

  it("round-trips two-level groups: (A AND B) OR (C AND D)", () => {
    const rule: PolicyRule = {
      id: "profiles",
      effect: "PERMIT",
      condition: {
        type: "or",
        conditions: [
          {
            type: "and",
            conditions: [
              cmp("EQ", "subject.attr.a", "resource.attr.a"),
              cmp("EQ", "subject.attr.b", "resource.attr.b"),
            ],
          },
          {
            type: "and",
            conditions: [
              cmp("EQ", "subject.attr.c", "resource.attr.c"),
              cmp("EQ", "subject.attr.d", "resource.attr.d"),
            ],
          },
        ],
      },
    };
    const builder = rulesToBuilder([rule]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    expect(builder[0].combinator).toBe("or");
    expect(builder[0].groups).toHaveLength(2);
    expect(builder[0].groups[0].rows).toHaveLength(2);
    expect(builderToRules(builder)).toEqual([rule]);
  });

  it("round-trips three-level nesting via a subgroup", () => {
    const builder = rulesToBuilder([NESTED_RULE]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    expect(builder[0].combinator).toBe("or");
    expect(builder[0].groups).toHaveLength(2);
    // Group 2: one row (capturista) + one subgroup (status draft|review).
    const g2 = builder[0].groups[1];
    expect(g2.rows).toHaveLength(1);
    expect(g2.subgroups).toHaveLength(1);
    expect(g2.subgroups[0].combinator).toBe("or");
    expect(g2.subgroups[0].rows).toHaveLength(2);
    expect(builderToRules(builder)).toEqual([NESTED_RULE]);
  });

  it("collapses a single condition to a bare comparison (no wrapper)", () => {
    const builder = rulesToBuilder([FLAT_AND_RULE]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    builder[0].groups[0].rows = builder[0].groups[0].rows.slice(0, 1);
    const [rule] = builderToRules(builder);
    expect(rule.condition?.type).toBe("comparison");
  });

  it("steps aside (null) when nested deeper than three levels", () => {
    // or( and( or( and( … ) ) ) ) — a 4th combinator level inside a subgroup.
    const tooDeep: PolicyRule = {
      id: "deep",
      effect: "PERMIT",
      condition: {
        type: "or",
        conditions: [
          {
            type: "and",
            conditions: [
              {
                type: "or",
                conditions: [
                  {
                    type: "and",
                    conditions: [cmp("EQ", "subject.attr.a", "resource.attr.a")],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(rulesToBuilder([tooDeep])).toBeNull();
  });

  it("auto-types literals: numbers, booleans and strings", () => {
    const builder = rulesToBuilder([FLAT_AND_RULE]);
    expect(builder).not.toBeNull();
    if (!builder) return;
    builder[0].groups[0].rows[1].rightText = "true";
    let [rule] = builderToRules(builder);
    let and = rule.condition as AndCondition;
    expect(and.conditions[1]).toMatchObject({ right: { value: true } });

    builder[0].groups[0].rows[1].rightText = "plain text";
    [rule] = builderToRules(builder);
    and = rule.condition as AndCondition;
    expect(and.conditions[1]).toMatchObject({ right: { value: "plain text" } });
  });
});
