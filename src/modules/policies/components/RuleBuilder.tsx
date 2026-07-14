"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ComparisonOp, Condition, Operand, PolicyRule } from "@/lib/pdp/contracts";
import { Button, Card, cn, Field, Input, Select, Textarea } from "@/ui";
import { COMPARISON_OPS, isOrderingOp } from "../policy.schema";

/*
 * Visual rule builder, v1.
 *
 * Builder scope: rules whose condition is a single comparison or a flat AND of
 * comparisons — which covers every policy authored in the ecosystem so far.
 * Documents using OR / nested groups are still fully supported through the
 * JSON mode; the builder detects them and steps aside instead of corrupting.
 * The builder is a PURE VIEW over PolicyRule[] — the form state (and the
 * submit path) never depends on which mode authored the rules.
 */

/* ---- builder view model (flat) ---- */

interface ComparisonRow {
  left: string; // ref path
  op: ComparisonOp;
  rightKind: "ref" | "literal";
  rightText: string;
}

interface BuilderRule {
  id: string;
  effect: "PERMIT" | "DENY";
  conditions: ComparisonRow[];
}

const REF_SUGGESTIONS = [
  "subject.id",
  "subject.attr.",
  "resource.id",
  "resource.type",
  "resource.attr.",
  "context.",
];

/* ---- PolicyRule[] ⇄ builder mapping ---- */

function operandToText(operand: Operand): { kind: "ref" | "literal"; text: string } {
  if ("ref" in operand) return { kind: "ref", text: operand.ref };
  return { kind: "literal", text: JSON.stringify(operand.value) };
}

function textToOperand(kind: "ref" | "literal", text: string): Operand {
  if (kind === "ref") return { ref: text.trim() };
  const trimmed = text.trim();
  // Auto-typing: valid JSON scalars (numbers, true/false, null, quoted
  // strings, arrays) pass through typed; anything else is a plain string.
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { value: trimmed };
  }
}

function conditionToRows(condition: Condition | undefined): ComparisonRow[] | null {
  if (!condition) return [];
  if (condition.type === "comparison") {
    const left = operandToText(condition.left);
    if (left.kind !== "ref") return null; // builder models left as a ref
    const right = operandToText(condition.right);
    return [
      { left: left.text, op: condition.op, rightKind: right.kind, rightText: right.text },
    ];
  }
  if (condition.type === "and") {
    const rows: ComparisonRow[] = [];
    for (const child of condition.conditions) {
      if (child.type !== "comparison") return null; // nested groups → JSON mode
      const mapped = conditionToRows(child);
      if (mapped === null) return null;
      rows.push(...mapped);
    }
    return rows;
  }
  return null; // "or" → JSON mode
}

/** null → document uses structures the builder does not model. */
export function rulesToBuilder(rules: PolicyRule[]): BuilderRule[] | null {
  const result: BuilderRule[] = [];
  for (const rule of rules) {
    const conditions = conditionToRows(rule.condition);
    if (conditions === null) return null;
    result.push({ id: rule.id, effect: rule.effect, conditions });
  }
  return result;
}

export function builderToRules(builder: BuilderRule[]): PolicyRule[] {
  return builder.map((rule) => {
    const comparisons: Condition[] = rule.conditions.map((row) => ({
      type: "comparison",
      op: row.op,
      left: { ref: row.left.trim() },
      right: textToOperand(row.rightKind, row.rightText),
    }));
    return {
      id: rule.id,
      effect: rule.effect,
      ...(comparisons.length === 0
        ? {}
        : comparisons.length === 1
          ? { condition: comparisons[0] }
          : { condition: { type: "and" as const, conditions: comparisons } }),
    };
  });
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
  const initialBuilder = rulesToBuilder(value);
  const [mode, setMode] = useState<"builder" | "json">(
    initialBuilder === null ? "json" : "builder",
  );
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const builder = rulesToBuilder(value);

  function commitBuilder(next: BuilderRule[]) {
    onChange(builderToRules(next));
  }

  function switchToJson() {
    setJsonText(JSON.stringify(value, null, 2));
    setJsonError(null);
    setMode("json");
  }

  function switchToBuilder() {
    try {
      const parsed = JSON.parse(jsonText) as PolicyRule[];
      if (rulesToBuilder(parsed) === null) {
        setJsonError(t("advancedJson"));
        return;
      }
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
            rows={12}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
              try {
                onChange(JSON.parse(e.target.value) as PolicyRule[]);
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
                { id: `rule-${builder.length + 1}`, effect: "PERMIT", conditions: [] },
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
        <span className="text-xs font-medium text-muted">{t("conditions")}</span>
        {rule.conditions.length === 0 && (
          <p className="text-xs italic text-muted">{t("noConditions")}</p>
        )}
        {rule.conditions.map((row, rowIndex) => (
          <ConditionRow
            key={rowIndex}
            row={row}
            onChange={(next) =>
              onChange({
                ...rule,
                conditions: rule.conditions.map((c, i) => (i === rowIndex ? next : c)),
              })
            }
            onRemove={() =>
              onChange({
                ...rule,
                conditions: rule.conditions.filter((_, i) => i !== rowIndex),
              })
            }
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() =>
            onChange({
              ...rule,
              conditions: [
                ...rule.conditions,
                {
                  left: "subject.attr.",
                  op: "EQ",
                  rightKind: "ref",
                  rightText: "resource.attr.",
                },
              ],
            })
          }
        >
          + {t("addCondition")}
        </Button>
      </div>
    </Card>
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
  const literalIsNonNumeric =
    row.rightKind === "literal" &&
    isOrderingOp(row.op) &&
    Number.isNaN(Number(row.rightText.trim()));

  return (
    <div className="space-y-1 rounded border border-line bg-surface p-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_1fr_auto]">
        <Input
          aria-label={t("left")}
          list="ref-suggestions"
          value={row.left}
          onChange={(e) => onChange({ ...row, left: e.target.value })}
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
      {row.rightKind === "literal" && (
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
