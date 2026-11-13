import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error";
type ToastItem = { id: number; tone: Tone; message: string };

const ToastContext = createContext<{ push: (tone: Tone, message: string) => void; lastPushAt: () => number } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const lastPush = useRef(0);
  const push = useCallback((tone: Tone, message: string) => {
    lastPush.current = Date.now();
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }, []);
  const lastPushAt = useCallback(() => lastPush.current, []);
  const value = useMemo(() => ({ push, lastPushAt }), [push, lastPushAt]);
  return (
    <ToastContext.Provider value={value}>
      <MutationToasts />
      {children}
      <div className="ui-toasts" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`ui-toast is-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  return {
    success: (message: string) => context?.push("success", message),
    error: (message: string) => context?.push("error", message),
  };
}

function MutationToasts() {
  const cache = useQueryClient().getMutationCache();
  const context = useContext(ToastContext);
  useEffect(() => {
    if (!context) return undefined;
    return cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const action = event.action;
      if (action.type !== "success" && action.type !== "error") return;
      const message = action.type === "success"
        ? "Đã lưu"
        : action.error instanceof Error ? action.error.message : "Không thực hiện được";
      const tone = action.type === "success" ? "success" : "error";
      window.setTimeout(() => {
        if (Date.now() - context.lastPushAt() < 500) return;
        context.push(tone, message);
      }, 0);
    });
  }, [cache, context]);
  return null;
}
