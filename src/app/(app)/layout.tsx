"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/ui";
import { LocaleSwitcher } from "./_shell/LocaleSwitcher";

/** Minimal authenticated shell — header only; nav grows with the views. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const t = useTranslations("shell");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <span className="font-semibold">
            {t("appName")}{" "}
            <span className="font-normal text-muted">· {t("appSubtitle")}</span>
          </span>
          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden items-center gap-2 text-sm text-muted sm:flex">
                <span>{user.name}</span>
                {user.roles.map((r) => (
                  <Badge key={r}>{r}</Badge>
                ))}
              </div>
            )}
            <LocaleSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
