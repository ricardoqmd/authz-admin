"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Badge, cn } from "@/ui";
import { LocaleSwitcher } from "./_shell/LocaleSwitcher";

/** Minimal authenticated shell — header + primary nav; grows with the views. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const t = useTranslations("shell");
  const pathname = usePathname();

  const nav = [
    {
      href: "/policies",
      label: t("navPolicies"),
      active: pathname.startsWith("/policies"),
    },
    {
      href: "/catalogue",
      label: t("navCatalogue"),
      active: pathname.startsWith("/catalogue"),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-5">
            <span className="font-semibold">
              {t("appName")}{" "}
              <span className="font-normal text-muted">· {t("appSubtitle")}</span>
            </span>
            <nav className="flex items-center gap-4 text-sm">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "hover:text-text",
                    n.active ? "font-medium text-text" : "text-muted",
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
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
