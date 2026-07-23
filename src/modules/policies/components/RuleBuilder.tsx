"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ComparisonOp, Condition, Operand, PolicyRule } from "@/lib/pdp/contracts";
import { Button, Card, cn, Field, Input, Select, Textarea } from "@/ui";
import { COMPARISON_OPS, isOrderingOp } from "../policy.schema";

/*
 * Visual rule builder, v2.
 *
 * Builder scope: a rule condition up to THREE combinator levels deep —
 *   rule (and|or) over GROUPS → group (and|or) over rows + SUBGROUPS →
 *   subgroup (and|or) over rows (comparisons).
 * That covers "(admin) OR (capturista AND (draft OR review))". A subgroup holds
 * comparisons only, never another subgroup — the model is fixed-depth and
 * non-recursive. A document nested deeper than three levels is still fully
 * supported through JSON mode: the builder detects it and steps aside.
 * The builder is a PURE VIEW over PolicyRule[].
 */

type Kind = "and" | "or";

/* ---- builder view model ---- */

interface ComparisonRow {
  leftKind: "ref" | "literal";
  leftText: string;
  op: ComparisonOp;
  rightKind: "ref" | "literal";
  rightText: string;
}

/** Level 3: a combinator over comparisons only (no further nesting). */
interface SubGroup {
  combinator: Kind;
  rows: ComparisonRow[];
}

/** Level 2: a combinator over comparison rows and subgroups. */
interface Group {
  combinator: Kind;
  rows: ComparisonRow[];
  subgroups: SubGroup[];
}

/** Level 1: a combinator over groups. */
interface BuilderRule {
  id: string;
  effect: "PERMIT" | "DENY";
  combinator: Kind;
  groups: Group[];
}

const REF_SUGGESTIONS = [
  "subject.id",
  "subject.attr.",
  "subject.attr.roles",
  "resource.id",
  "resource.type",
  "resource.attr.",
  "context.",
];

const EMPTY_ROW: ComparisonRow = {
  leftKind: "ref",
  leftText: "subject.attr.",
  op: "EQ",
  rightKind: "ref",
  rightText: "resource.attr.",
};

const ROLE_ROW: ComparisonRow = {
  leftKind: "literal",
  leftText: "",
  op: "IN",
  rightKind: "ref",
  rightText: "subject.attr.roles",
};

/* ---- PolicyRule[] ⇄ builder mapping (pure) ---- */

function operandToText(operand: Operand): { kind: "ref" | "literal"; text: string } {
  if ("ref" in operand) return { kind: "ref", text: operand.ref };
  return { kind: "literal", text: JSON.stringify(operand.value) };
}

function textToOperand(kind: "ref" | "literal", text: string): Operand {
  if (kind === "ref") return { ref: text.trim() };
  const trimmed = text.trim();
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { value: trimmed };
  }
}

function rowToComparison(row: ComparisonRow): Condition {
  return {
    type: "comparison",
    op: row.op,
    left: textToOperand(row.leftKind, row.leftText),
    right: textToOperand(row.rightKind, row.rightText),
  };
}

function comparisonToRow(c: Condition & { type: "comparison" }): ComparisonRow {
  const left = operandToText(c.left);
  const right = operandToText(c.right);
  return {
    leftKind: left.kind,
    leftText: left.text,
    op: c.op,
    rightKind: right.kind,
    rightText: right.text,
  };
}

/** Combine conditions under a combinator, collapsing 0/1-length. */
function combine(kind: Kind, conds: Condition[]): Condition | undefined {
  if (conds.length === 0) return undefined;
  if (conds.length === 1) return conds[0];
  return { type: kind, conditions: conds };
}

function subgroupToCondition(sg: SubGroup): Condition | undefined {
  return combine(sg.combinator, sg.rows.map(rowToComparison));
}

function groupToCondition(g: Group): Condition | undefined {
  const members: Condition[] = [
    ...g.rows.map(rowToComparison),
    ...g.subgroups
      .map(subgroupToCondition)
      .filter((c): c is Condition => c !== undefined),
  ];
  return combine(g.combinator, members);
}

export function builderToRules(builder: BuilderRule[]): PolicyRule[] {
  return builder.map((rule) => {
    const groupConds = rule.groups
      .map(groupToCondition)
      .filter((c): c is Condition => c !== undefined);
    const condition = combine(rule.combinator, groupConds);
    return { id: rule.id, effect: rule.effect, ...(condition ? { condition } : {}) };
  });
}

/** Parse a flat list of comparisons (subgroup content). null if any is nested. */
function toRows(conds: Condition[]): ComparisonRow[] | null {
  const rows: ComparisonRow[] = [];
  for (const c of conds) {
    if (c.type !== "comparison") return null;
    rows.push(comparisonToRow(c));
  }
  return rows;
}

/** Parse one group (level 2): rows + subgroups, subgroups capped at comparisons. */
function toGroup(cond: Condition): Group | null {
  if (cond.type === "comparison") {
    return { combinator: "and", rows: [comparisonToRow(cond)], subgroups: [] };
  }
  const rows: ComparisonRow[] = [];
  const subgroups: SubGroup[] = [];
  for (const child of cond.conditions) {
    if (child.type === "comparison") {
      rows.push(comparisonToRow(child));
    } else {
      const sgRows = toRows(child.conditions); // level 4 → null
      if (sgRows === null) return null;
      subgroups.push({ combinator: child.type, rows: sgRows });
    }
  }
  return { combinator: cond.type, rows, subgroups };
}

/** Parse a rule condition (level 1). null → deeper than the builder models. */
function conditionToRuleShape(
  condition: Condition | undefined,
): { combinator: Kind; groups: Group[] } | null {
  if (!condition) return { combinator: "and", groups: [] };
  if (condition.type === "comparison") {
    return {
      combinator: "and",
      groups: [{ combinator: "and", rows: [comparisonToRow(condition)], subgroups: [] }],
    };
  }
  // A flat and/or of only comparisons is a single group, not N groups.
  const flat = condition.conditions.every((c) => c.type === "comparison");
  if (flat) {
    return {
      combinator: condition.type,
      groups: [
        {
          combinator: condition.type,
          rows: condition.conditions.map((c) =>
            comparisonToRow(c as Condition & { type: "comparison" }),
          ),
          subgroups: [],
        },
      ],
    };
  }
  // Mixed / nested: outer combinator over groups.
  const groups: Group[] = [];
  for (const child of condition.conditions) {
    const g = toGroup(child);
    if (g === null) return null;
    groups.push(g);
  }
  return { combinator: condition.type, groups };
}

/** null → document uses structures the builder does not model. */
export function rulesToBuilder(rules: PolicyRule[]): BuilderRule[] | null {
  const result: BuilderRule[] = [];
  for (const rule of rules) {
    const shape = conditionToRuleShape(rule.condition);
    if (shape === null) return null;
    result.push({
      id: rule.id,
      effect: rule.effect,
      combinator: shape.combinator,
      groups: shape.groups,
    });
  }
  return result;
}

/* ---- component ---- */

export function RuleBuilder({
  value,
  onChange,
  error,
}: {
  value: PolicyRule[];
  onChange: (rules: PolicyRule[]) => void;
  error?: string;
}) {
  const t = useTranslations("rules");
  // Local structural state. The builder keeps its group/subgroup skeleton even
  // for shapes the canonical PolicyRule[] would collapse (an empty group, a
  // single-member group: "(a) AND (b)" == "a AND b"). We emit the canonical
  // value on every edit, and re-derive local state only when `value` changes
  // from the OUTSIDE (prefill/reset, JSON edits) — tracked via `synced`.
  const [builder, setBuilder] = useState<BuilderRule[] | null>(() =>
    rulesToBuilder(value),
  );
  const [mode, setMode] = useState<"builder" | "json">(
    builder === null ? "json" : "builder",
  );
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const synced = useRef(JSON.stringify(value));
  useEffect(() => {
    const next = JSON.stringify(value);
    if (next !== synced.current) {
      synced.current = next;
      setBuilder(rulesToBuilder(value));
    }
  }, [value]);

  function commitBuilder(next: BuilderRule[]) {
    setBuilder(next);
    const rules = builderToRules(next);
    synced.current = JSON.stringify(rules);
    onChange(rules);
  }

  function switchToJson() {
    setJsonText(JSON.stringify(value, null, 2));
    setJsonError(null);
    setMode("json");
  }

  function switchToBuilder() {
    try {
      const parsed = JSON.parse(jsonText) as PolicyRule[];
      const next = rulesToBuilder(parsed);
      if (next === null) {
        setJsonError(t("advancedJson"));
        return;
      }
      setBuilder(next);
      synced.current = JSON.stringify(parsed);
      onChange(parsed);
      setMode("builder");
      setJsonError(null);
    } catch {
      setJsonError(t("invalidJson"));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("title")}</span>
        <div className="flex gap-1">
          <ModeTab active={mode === "builder"} onClick={switchToBuilder}>
            {t("builderMode")}
          </ModeTab>
          <ModeTab active={mode === "json"} onClick={switchToJson}>
            {t("jsonMode")}
          </ModeTab>
        </div>
      </div>

      {mode === "json" || builder === null ? (
        <div className="space-y-1">
          <Textarea
            rows={14}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
              try {
                const rules = JSON.parse(e.target.value) as PolicyRule[];
                synced.current = JSON.stringify(rules);
                onChange(rules);
              } catch {
                /* incomplete JSON while typing — submit validates anyway */
              }
            }}
            spellCheck={false}
          />
          <p className="text-xs text-muted">{t("jsonHint")}</p>
          {jsonError && <p className="text-xs text-danger">{jsonError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {builder.map((rule, ruleIndex) => (
            <RuleCard
              key={ruleIndex}
              rule={rule}
              index={ruleIndex}
              onChange={(next) =>
                commitBuilder(builder.map((r, i) => (i === ruleIndex ? next : r)))
              }
              onRemove={() => commitBuilder(builder.filter((_, i) => i !== ruleIndex))}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              commitBuilder([
                ...builder,
                {
                  id: `rule-${builder.length + 1}`,
                  effect: "PERMIT",
                  combinator: "and",
                  groups: [{ combinator: "and", rows: [], subgroups: [] }],
                },
              ])
            }
          >
            + {t("addRule")}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 text-xs font-medium",
        active ? "bg-primary text-primary-fg" : "text-muted hover:bg-neutral-bg",
      )}
    >
      {children}
    </button>
  );
}

/** and/or picker rendered as "Match [all|any]". */
function Combinator({
  value,
  onChange,
}: {
  value: Kind;
  onChange: (kind: Kind) => void;
}) {
  const t = useTranslations("rules");
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      {t("matchLabel")}
      <Select
        aria-label={t("matchLabel")}
        value={value}
        onChange={(e) => onChange(e.target.value as Kind)}
        className="w-auto text-xs"
      >
        <option value="and">{t("matchAll")}</option>
        <option value="or">{t("matchAny")}</option>
      </Select>
    </span>
  );
}

function RuleCard({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: BuilderRule;
  index: number;
  onChange: (rule: BuilderRule) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("rules");
  const groups = rule.groups;

  function setGroup(i: number, next: Group) {
    onChange({ ...rule, groups: groups.map((g, gi) => (gi === i ? next : g)) });
  }
  function removeGroup(i: number) {
    onChange({ ...rule, groups: groups.filter((_, gi) => gi !== i) });
  }

  return (
    <Card className="space-y-3 bg-neutral-bg/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">
          {t("rule", { index: index + 1 })}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs text-danger"
          onClick={onRemove}
        >
          {t("removeRule")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ruleId")}>
          {(a11y) => (
            <Input
              {...a11y}
              value={rule.id}
              onChange={(e) => onChange({ ...rule, id: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("effect")}>
          {(a11y) => (
            <Select
              {...a11y}
              value={rule.effect}
              onChange={(e) =>
                onChange({ ...rule, effect: e.target.value as "PERMIT" | "DENY" })
              }
            >
              <option value="PERMIT">{t("permit")}</option>
              <option value="DENY">{t("deny")}</option>
            </Select>
          )}
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">{t("conditions")}</span>
          {groups.length > 1 && (
            <Combinator
              value={rule.combinator}
              onChange={(k) => onChange({ ...rule, combinator: k })}
            />
          )}
        </div>

        {groups.length === 0 && (
          <p className="text-xs italic text-muted">{t("noConditions")}</p>
        )}

        {groups.map((group, gi) => (
          <GroupBox
            key={gi}
            group={group}
            // Flat (borderless) only when it is the sole group with no subgroup.
            bordered={groups.length > 1 || group.subgroups.length > 0}
            onChange={(next) => setGroup(gi, next)}
            onRemove={groups.length > 1 ? () => removeGroup(gi) : undefined}
          />
        ))}

        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            onChange({
              ...rule,
              groups: [...groups, { combinator: "and", rows: [], subgroups: [] }],
            })
          }
        >
          + {t("addGroup")}
        </Button>
      </div>
    </Card>
  );
}

function GroupBox({
  group,
  bordered,
  onChange,
  onRemove,
}: {
  group: Group;
  bordered: boolean;
  onChange: (group: Group) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("rules");
  const memberCount = group.rows.length + group.subgroups.length;

  function setRow(i: number, next: ComparisonRow) {
    onChange({ ...group, rows: group.rows.map((r, ri) => (ri === i ? next : r)) });
  }
  function removeRow(i: number) {
    onChange({ ...group, rows: group.rows.filter((_, ri) => ri !== i) });
  }
  function setSub(i: number, next: SubGroup) {
    onChange({
      ...group,
      subgroups: group.subgroups.map((s, si) => (si === i ? next : s)),
    });
  }
  function removeSub(i: number) {
    onChange({ ...group, subgroups: group.subgroups.filter((_, si) => si !== i) });
  }

  const body = (
    <>
      {(memberCount > 1 || bordered) && (
        <div className="flex items-center justify-between">
          {memberCount > 1 ? (
            <Combinator
              value={group.combinator}
              onChange={(k) => onChange({ ...group, combinator: k })}
            />
          ) : (
            <span />
          )}
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              className="h-6 px-2 text-xs text-danger"
              onClick={onRemove}
            >
              {t("removeGroup")}
            </Button>
          )}
        </div>
      )}

      {memberCount === 0 && (
        <p className="text-xs italic text-muted">{t("noConditions")}</p>
      )}

      {group.rows.map((row, ri) => (
        <ConditionRow
          key={ri}
          row={row}
          onChange={(next) => setRow(ri, next)}
          onRemove={() => removeRow(ri)}
        />
      ))}

      {group.subgroups.map((sub, si) => (
        <SubGroupBox
          key={si}
          subgroup={sub}
          onChange={(next) => setSub(si, next)}
          onRemove={() => removeSub(si)}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => onChange({ ...group, rows: [...group.rows, { ...EMPTY_ROW }] })}
        >
          + {t("addCondition")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => onChange({ ...group, rows: [...group.rows, { ...ROLE_ROW }] })}
        >
          + {t("addRoleCheck")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs text-primary"
          onClick={() =>
            onChange({
              ...group,
              subgroups: [
                ...group.subgroups,
                { combinator: "or", rows: [{ ...EMPTY_ROW }] },
              ],
            })
          }
        >
          + {t("addSubgroup")}
        </Button>
      </div>
    </>
  );

  if (!bordered) return <div className="space-y-2">{body}</div>;
  return <Card className="space-y-2 border-line bg-surface">{body}</Card>;
}

function SubGroupBox({
  subgroup,
  onChange,
  onRemove,
}: {
  subgroup: SubGroup;
  onChange: (sub: SubGroup) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("rules");

  return (
    <div className="space-y-2 rounded-lg border border-l-2 border-line border-l-primary bg-neutral-bg/40 p-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <span className="text-xs font-semibold text-muted">{t("subgroup")}</span>
          {subgroup.rows.length > 1 && (
            <Combinator
              value={subgroup.combinator}
              onChange={(k) => onChange({ ...subgroup, combinator: k })}
            />
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="h-6 px-2 text-xs text-danger"
          onClick={onRemove}
        >
          {t("removeGroup")}
        </Button>
      </div>

      {subgroup.rows.map((row, ri) => (
        <ConditionRow
          key={ri}
          row={row}
          onChange={(next) =>
            onChange({
              ...subgroup,
              rows: subgroup.rows.map((r, i) => (i === ri ? next : r)),
            })
          }
          onRemove={() =>
            onChange({ ...subgroup, rows: subgroup.rows.filter((_, i) => i !== ri) })
          }
        />
      ))}

      <Button
        type="button"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() =>
          onChange({ ...subgroup, rows: [...subgroup.rows, { ...EMPTY_ROW }] })
        }
      >
        + {t("addCondition")}
      </Button>
    </div>
  );
}

function ConditionRow({
  row,
  onChange,
  onRemove,
}: {
  row: ComparisonRow;
  onChange: (row: ComparisonRow) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("rules");
  const orderingLiteralBad = (kind: "ref" | "literal", text: string) =>
    kind === "literal" && isOrderingOp(row.op) && Number.isNaN(Number(text.trim()));
  const literalIsNonNumeric =
    orderingLiteralBad(row.leftKind, row.leftText) ||
    orderingLiteralBad(row.rightKind, row.rightText);
  const hasLiteral = row.leftKind === "literal" || row.rightKind === "literal";

  return (
    <div className="space-y-1 rounded border border-line bg-surface p-2">
      <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto_auto_1fr_auto]">
        <Select
          aria-label={t("leftType")}
          value={row.leftKind}
          onChange={(e) =>
            onChange({ ...row, leftKind: e.target.value as "ref" | "literal" })
          }
          className="w-auto text-xs"
        >
          <option value="ref">{t("reference")}</option>
          <option value="literal">{t("literal")}</option>
        </Select>
        <Input
          aria-label={t("left")}
          list={row.leftKind === "ref" ? "ref-suggestions" : undefined}
          value={row.leftText}
          onChange={(e) => onChange({ ...row, leftText: e.target.value })}
          className="font-mono text-xs"
        />
        <Select
          aria-label={t("operator")}
          value={row.op}
          onChange={(e) => onChange({ ...row, op: e.target.value as ComparisonOp })}
          className="w-auto font-mono text-xs"
        >
          {COMPARISON_OPS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("rightType")}
          value={row.rightKind}
          onChange={(e) =>
            onChange({ ...row, rightKind: e.target.value as "ref" | "literal" })
          }
          className="w-auto text-xs"
        >
          <option value="ref">{t("reference")}</option>
          <option value="literal">{t("literal")}</option>
        </Select>
        <Input
          aria-label={t("rightValue")}
          list={row.rightKind === "ref" ? "ref-suggestions" : undefined}
          value={row.rightText}
          onChange={(e) => onChange({ ...row, rightText: e.target.value })}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          className="h-9 px-2 text-xs text-danger"
          onClick={onRemove}
        >
          ✕
        </Button>
      </div>
      {hasLiteral && (
        <p className={cn("text-xs", literalIsNonNumeric ? "text-danger" : "text-muted")}>
          {literalIsNonNumeric ? t("orderingNeedsNumber") : t("literalHint")}
        </p>
      )}
      <datalist id="ref-suggestions">
        {REF_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
