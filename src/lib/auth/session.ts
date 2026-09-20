/*
 * The wire shape of GET /api/session, shared by the route that builds it and
 * the screens that read it.
 */

/** The verified caller. Every field is derived server-side from the signed token. */
export interface SessionView {
  /** Opaque IdP subject, from the verified `sub`. Never PII. */
  sub: string;
  /**
   * The applications the caller's token carries. Absent claim → empty, never "all".
   *
   * ADVISORY. This list shapes the application selector and DECIDES NOTHING —
   * not in the BFF, not in the browser. Whether the caller may read or change an
   * application is the engine's decision, made per request against the same
   * token (service-policy ADR-033). The two can disagree — the engine may hold a
   * policy that narrows what the claim suggests — and when they do the engine
   * wins: a `403` for an application listed here is a normal answer, not a
   * broken session. No code may treat membership in this list as permission.
   */
  apps: string[];
}
