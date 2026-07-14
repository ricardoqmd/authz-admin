import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/render";
import { PoliciesScreen } from "./PoliciesScreen";

describe("PoliciesScreen", () => {
  it("renders policies from the BFF, including INACTIVE heads", async () => {
    render(<PoliciesScreen />);

    expect(await screen.findAllByText("doc-access")).not.toHaveLength(0);
    // The control plane must show what is NOT in production yet:
    expect((await screen.findAllByText("inactiva")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("activa · v2")).length).toBeGreaterThan(0);
  });
});
