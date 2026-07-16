"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError } from "@/lib/pdp/client";
import type { PolicyHeadView, PolicyVersionSummary } from "@/lib/pdp/contracts";
import { Button, Card, Field, Input, Select } from "@/ui";
import { useActivatePolicy, useDeactivatePolicy } from "../api/policy.mutations";

/**
 * Activation / deactivation from the detail screen (R020), with the optimistic
 * concurrency UX (R018): every write carries If-Match = the head revision the
 * admin was looking at. A 412 means another admin moved the head meanwhile —
 * we surface a reload-and-retry banner and DO NOT lose the admin's input
 * (version choice + changeReason stay in the dialog).
 */
export function LifecycleActions({
  head,
  versions,
  onReload,
}: {
  head: PolicyHeadView;
  versions: PolicyVersionSummary[];
  onReload: () => void;
}) {
  const t = useTranslations("lifecycle");
  const [dialog, setDialog] = useState<"activate" | "deactivate" | null>(null);

  const isActive = head.activeVersion !== null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setDialog("activate")}>
        {isActive ? t("changeActiveVersion") : t("activate")}
      </Button>
      <Link href={`/policies/${head.app}/${head.policyId}/edit`}>
        <Button variant="outline">{t("newVersion")}</Button>
      </Link>
      <Link href={`/policies/${head.app}/${head.policyId}/test`}>
        <Button variant="ghost">{t("test")}</Button>
      </Link>
      {isActive && (
        <Button variant="danger" onClick={() => setDialog("deactivate")}>
          {t("deactivate")}
        </Button>
      )}

      {dialog === "activate" && (
        <ActivateDialog
          head={head}
          versions={versions}
          onClose={() => setDialog(null)}
          onReload={onReload}
        />
      )}
      {dialog === "deactivate" && (
        <DeactivateDialog
          head={head}
          onClose={() => setDialog(null)}
          onReload={onReload}
        />
      )}
    </div>
  );
}

/** Shared inline banner for the 412 stale-revision case. */
function useStaleGuard() {
  const t = useTranslations("lifecycle");
  const [stale, setStale] = useState(false);
  function handle(error: unknown): string | null {
    if (error instanceof ApiError && error.status === 412) {
      setStale(true);
      return t("staleRevision");
    }
    if (error instanceof ApiError && error.problem) {
      return error.problem.detail ?? error.problem.title;
    }
    return (error as Error).message;
  }
  return { stale, setStale, handle };
}

function ActivateDialog({
  head,
  versions,
  onClose,
  onReload,
}: {
  head: PolicyHeadView;
  versions: PolicyVersionSummary[];
  onClose: () => void;
  onReload: () => void;
}) {
  const t = useTranslations("lifecycle");
  const activate = useActivatePolicy(head.app, head.policyId);
  const { stale, setStale, handle } = useStaleGuard();
  const [version, setVersion] = useState(
    String(head.activeVersion ?? versions.at(-1)?.version ?? 1),
  );
  const [changeReason, setChangeReason] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  async function submit() {
    setBanner(null);
    try {
      await activate.mutateAsync({
        version: Number(version),
        changeReason,
        revision: head.revision, // R018: If-Match = the head we were shown
      });
      onClose();
    } catch (error) {
      setBanner(handle(error));
    }
  }

  return (
    <Dialog title={t("activateTitle", { policyId: head.policyId })} onClose={onClose}>
      <p className="text-sm text-muted">{t("activateIntro")}</p>
      {banner && (
        <Card className="border-danger-bg text-sm text-danger">
          {banner}
          {stale && (
            <Button
              variant="outline"
              className="mt-2 h-8"
              onClick={() => {
                onReload();
                setStale(false);
                setBanner(null);
              }}
            >
              {t("reloadAndRetry")}
            </Button>
          )}
        </Card>
      )}
      <Field label={t("version")}>
        {(a11y) => (
          <Select {...a11y} value={version} onChange={(e) => setVersion(e.target.value)}>
            {[...versions]
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                  {v.version === head.activeVersion ? ` · ${t("current")}` : ""}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label={t("changeReason")} hint={t("changeReasonHint")}>
        {(a11y) => (
          <Input
            {...a11y}
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder={t("changeReasonPlaceholder")}
          />
        )}
      </Field>
      <DialogActions>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={submit} disabled={activate.isPending || stale}>
          {activate.isPending ? t("activating") : t("confirmActivate", { version })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeactivateDialog({
  head,
  onClose,
  onReload,
}: {
  head: PolicyHeadView;
  onClose: () => void;
  onReload: () => void;
}) {
  const t = useTranslations("lifecycle");
  const deactivate = useDeactivatePolicy(head.app, head.policyId);
  const { stale, setStale, handle } = useStaleGuard();
  const [changeReason, setChangeReason] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  async function submit() {
    setBanner(null);
    try {
      await deactivate.mutateAsync({ changeReason, revision: head.revision });
      onClose();
    } catch (error) {
      setBanner(handle(error));
    }
  }

  return (
    <Dialog title={t("deactivateTitle", { policyId: head.policyId })} onClose={onClose}>
      <p className="text-sm text-muted">
        {t("deactivateIntro", { version: head.activeVersion ?? 0 })}
      </p>
      {banner && (
        <Card className="border-danger-bg text-sm text-danger">
          {banner}
          {stale && (
            <Button
              variant="outline"
              className="mt-2 h-8"
              onClick={() => {
                onReload();
                setStale(false);
                setBanner(null);
              }}
            >
              {t("reloadAndRetry")}
            </Button>
          )}
        </Card>
      )}
      <Field label={t("changeReason")} hint={t("changeReasonHint")}>
        {(a11y) => (
          <Input
            {...a11y}
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder={t("changeReasonPlaceholder")}
          />
        )}
      </Field>
      <DialogActions>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          variant="danger"
          onClick={submit}
          disabled={deactivate.isPending || stale}
        >
          {deactivate.isPending ? t("deactivating") : t("confirmDeactivate")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---- lightweight modal (no dialog-triggering native APIs) ---- */

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card className="w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            aria-label="close"
          >
            ✕
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-1">{children}</div>;
}
