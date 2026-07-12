"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/ui";

/** Minimal authenticated shell — header only; nav grows with the views. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <span className="font-semibold">
            PAP <span className="font-normal text-muted">· Authz Admin</span>
          </span>
          {user && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="hidden sm:inline">{user.name}</span>
              {user.roles.map((r) => (
                <Badge key={r}>{r}</Badge>
              ))}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
