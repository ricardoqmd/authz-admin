import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PolicyRule } from "@/lib/pdp/contracts";
import { render, screen } from "@/test/render";
import { RuleBuilder } from "./RuleBuilder";

const ONE_RULE: PolicyRule[] = [
  {
    id: "r1",
    effect: "PERMIT",
    condition: {
      type: "comparison",
      op: "EQ",
      left: { ref: "subject.attr.area" },
      right: { ref: "resource.attr.area" },
    },
  },
];

describe("RuleBuilder — interaction", () => {
  it("keeps a newly added (empty) group instead of collapsing it away", async () => {
    const user = userEvent.setup();
    render(<RuleBuilder value={ONE_RULE} onChange={vi.fn()} />);

    // Single group, one condition → no empty-group message yet.
    expect(screen.queryByText(/Sin condiciones/)).not.toBeInTheDocument();

    await user.click(screen.getByText("+ Agregar grupo"));

    // The empty second group persists (local structural state, not collapsed).
    expect(await screen.findByText(/Sin condiciones/)).toBeInTheDocument();
  });

  it("adds an opt-in subgroup that stays visible", async () => {
    const user = userEvent.setup();
    render(<RuleBuilder value={ONE_RULE} onChange={vi.fn()} />);

    await user.click(screen.getByText("+ Subgrupo"));

    // The subgroup box renders (labeled) and does not vanish on re-render.
    expect(await screen.findByText("Subgrupo")).toBeInTheDocument();
  });
});
