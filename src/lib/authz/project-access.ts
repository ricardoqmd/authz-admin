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

export interface ProjectAccessPolicy {
  can(
    user: { sub: string; roles: string[]; apps: string[] },
    action: ProjectAction,
    app: string,
  ): Promise<boolean>;
}

/** Phase-1 stand-in: pap-admin sees everything, others only their apps. */
export class HardcodedProjectAccessPolicy implements ProjectAccessPolicy {
  async can(
    user: { sub: string; roles: string[]; apps: string[] },
    _action: ProjectAction,
    app: string,
  ): Promise<boolean> {
    if (user.roles.includes("pap-admin")) return true;
    return user.apps.includes(app);
  }
}

// TODO(phase 2): EvaluateProjectAccessPolicy — calls the PDP /v1/evaluate with
// the BFF service credential (authz-admin + pdp-client markers) and the
// seeded meta-policy. See docs in CONTEXT-pap.
export const projectAccess: ProjectAccessPolicy =
  new HardcodedProjectAccessPolicy();
