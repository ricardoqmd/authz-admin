/*
 * Who the server thinks you are.
 *
 * The browser has no server-derived answer to "which projects may I administer":
 * `useAuth()` decodes the token CLIENT-side, which is fine for rendering and
 * worthless as an authority — the same decode runs on data the user controls. This
 * route answers from the same verified token every other route is gated on.
 *
 * It REPORTS; it does not DECIDE. No handler may consult it to authorise anything:
 * authorisation is ProjectAccessPolicy, server-side, per request. What this enables
 * is a UI that stops offering actions the BFF will refuse — a usability fix, never
 * an enforcement one. If this route were ever wrong in the caller's favour, nothing
 * would be permitted that is not permitted today.
 *
 * It returns what the caller may administer, never what exists: the apps come from
 * the caller's own verified claim, not from the PDP's catalogue, so this endpoint
 * cannot become a way to enumerate applications.
 *
 * **It reports CAPABILITIES the server computed, never raw material to interpret.**
 * Every question the UI has is answered here by asking the same policy that gates the
 * API, so the menu is a projection of that policy rather than a second opinion about
 * it. That rule is why `roles` is not in the payload: handing the browser the
 * ingredients of a decision invites it to re-derive the decision, and two
 * implementations of one rule are free to drift apart. When the PDP-backed policy
 * lands, the answers here change with it and no browser code moves.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/route-guard";
import { projectAccess } from "@/lib/authz/project-access";

/** The verified caller. Every field is derived server-side from the signed token. */
export interface SessionView {
  /** Opaque IdP subject, from the verified `sub`. Never PII. */
  sub: string;
  /** The projects this caller may administer. Absent claim → empty, never "all". */
  apps: string[];
  /**
   * May this caller read the cross-app catalogue (`GET /v1/policies`)?
   *
   * NOT derivable from `apps`: an administrator may hold an empty list and still
   * read across every application — the case any claim-derived implementation gets
   * wrong. The only correct source is the policy, so that is what is asked.
   */
  canReadAcrossApps: boolean;
}

export async function GET(req: NextRequest) {
  // The same guard, the same 401, the same body as the PDP proxy — one
  // implementation, so an unauthenticated caller cannot tell the two routes apart.
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  // Built field by field from the verified user rather than spread, so a claim
  // added to VerifiedUser later cannot reach the browser by accident.
  const session: SessionView = {
    sub: caller.sub,
    apps: caller.apps,
    // Asked, not inferred. Not `roles.includes(...)`, not `apps.length > 0` — the
    // same call the read gate makes, so the answer the UI renders and the answer the
    // BFF enforces are one computation with one implementation.
    canReadAcrossApps: await projectAccess.canReadAcrossApps(caller),
  };

  // Never cached: it is per-caller and derived from a token that expires.
  return NextResponse.json(session, {
    headers: { "cache-control": "no-store" },
  });
}
