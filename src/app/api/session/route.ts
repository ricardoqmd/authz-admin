/*
 * Who the server thinks you are.
 *
 * The browser has no server-derived answer to "which applications does my token
 * carry": `useAuth()` decodes the token CLIENT-side, which is fine for rendering
 * and worthless as an authority — the same decode runs on data the user controls.
 * This route answers from the same verified token every other route is gated on.
 *
 * It returns what the caller's token carries, never what exists: the apps come
 * from the caller's own verified claim, not from the PDP's catalogue, so this
 * endpoint cannot become a way to enumerate applications.
 *
 * **It reports capabilities, never raw material to interpret.** That rule is why
 * `roles` is not in the payload: handing the browser the ingredients of a
 * decision invites it to re-derive the decision.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/route-guard";
import type { SessionView } from "@/lib/auth/session";

// `apps` is ADVISORY: it feeds the application selector and decides nothing.
// The engine decides every request against the same token (see SessionView).

export async function GET(req: NextRequest) {
  // The same guard, the same 401, the same body as the PDP proxy — one
  // implementation, so an unauthenticated caller cannot tell the two routes apart.
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  // Built field by field from the verified user rather than spread, so a field
  // added to VerifiedUser — the raw token is one — cannot reach the browser by
  // accident.
  const session: SessionView = {
    sub: caller.sub,
    apps: caller.apps,
  };

  // Never cached: it is per-caller and derived from a token that expires.
  return NextResponse.json(session, {
    headers: { "cache-control": "no-store" },
  });
}
