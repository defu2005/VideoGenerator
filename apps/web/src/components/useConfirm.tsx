import { useCallback, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PendingConfirm = ConfirmRequest & {
  resolve: (accepted: boolean) => void;
};

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const ask = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => {
    setPending({
      confirmLabel: "Đồng ý",
      cancelLabel: "Hủy",
      ...request,
      resolve,
    });
  }), []);

  const close = (accepted: boolean) => {
    pending?.resolve(accepted);
    setPending(null);
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      message={pending?.message ?? ""}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { ask, dialog };
}

/** Block an in-app link click while a form is dirty, then ask with the app dialog. */
export function guardDirtyNavigation(
  event: MouseEvent,
  dirty: boolean,
  ask: (request: ConfirmRequest) => Promise<boolean>,
  request: ConfirmRequest,
): void {
  if (!dirty || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a[href]") as HTMLAnchorElement | null;
  if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
  const next = `${link.pathname}${link.search}${link.hash}`;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === here) return;
  event.preventDefault();
  event.stopPropagation();
  void ask(request).then((accepted) => {
    if (accepted) window.location.assign(next);
  });
}
