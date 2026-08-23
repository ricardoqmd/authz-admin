/*
 * ProjectAccessPolicy — the enforcement seam of the PAP BFF (model D).
 *
 * Every write (and optionally read) against the PDP goes through this check.
 * Phase 1 ships a permissive hardcoded implementation; the target
 * implementation asks the PDP itself via POST /v1/evaluate against the
 * seeded meta-policy ("pap-project-access", resourceType "policy"):
 *
 *   { action: "policy:read" | "policy:write" | ...,
 *     resource: { type: "policy", attributes: { app } },
 *     subject: user.sub,                       // delegated → needs pdp-client
 *     subjectAttributes: { role, apps } }      // mapped from the user's token
 *
 * Swapping implementations must not touch any route handler — that is the
 * whole point of the interface (same adapter discipline as the UI facade).
 */

export type ProjectAction = "read" | "write" | "activate" | "deactivate";

/** The caller, as the policy sees them — the verified claims, nothing else. */
type PolicySubject = { sub: string; roles: string[]; apps: string[] };

export interface ProjectAccessPolicy {
  /** May this caller take `action` on `app`? The app is always a real one. */
  can(user: PolicySubject, action: ProjectAction, app: string): Promise<boolean>;

  /**
   * May this caller read ACROSS all applications — the cross-app catalogue?
   *
   * A distinct faculty, not `can(user, "read", <every app>)`: the question has no
   * app to be about. It exists because the one read that names no app used to ask
   * `can(user, "read", "*")`, and `"*"` was never a project — it was a placeholder
   * for this missing question, compared with `includes` against a list of real app
   * names and therefore false for everyone except an admin, by accident rather than
   * by decision.
   *
   * It lives on the interface rather than in the route so the handler stays free of
   * role checks: a bare `roles.includes(...)` in a route is authorisation logic
   * outside the seam, which is what the seam exists to prevent. The phase-2
   * PDP-backed implementation has to answer this question too.
   */
  canReadAcrossApps(user: PolicySubject): Promise<boolean>;
}

/** Phase-1 stand-in: pap-admin sees everything, others only their apps. */
export class HardcodedProjectAccessPolicy implements ProjectAccessPolicy {
  async can(user: PolicySubject, _action: ProjectAction, app: string): Promise<boolean> {
    if (user.roles.includes("pap-admin")) return true;
    return user.apps.includes(app);
  }

  /**
   * Only an administrator reads across applications. A caller scoped to apps —
   * however many — is scoped: holding every app that happens to exist today is not
   * the same statement as "may read the catalogue of what exists", and the second
   * is the one this answers.
   */
  async canReadAcrossApps(user: PolicySubject): Promise<boolean> {
    return user.roles.includes("pap-admin");
  }
}

// TODO(phase 2): EvaluateProjectAccessPolicy — calls the PDP /v1/evaluate with
// the BFF service credential (authz-admin + pdp-client markers) and the
// seeded meta-policy. See docs in CONTEXT-pap.
export const projectAccess: ProjectAccessPolicy = new HardcodedProjectAccessPolicy();
