import { NextResponse } from "next/server";

/**
 * Liveness only: it answers that this process is up and serving.
 *
 * Deliberately unauthenticated, because a liveness probe runs before anyone has
 * a token, and deliberately empty of detail — no version, no build id, no word
 * about the PDP behind it. Those turn a probe into a free reconnaissance
 * endpoint on a console that is otherwise closed, and none of them are needed
 * to answer the only question asked here.
 *
 * It is not a readiness probe: it does not reach the PDP. A console that cannot
 * reach the PDP still has to come up and say so on screen, and a probe that
 * failed for that reason would take the console down instead — turning one
 * outage into two.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
