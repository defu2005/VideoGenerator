import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "success" | "error";
type ToastItem = { id: number; tone: Tone; message: string };

const ToastContext = createContext<{ push: (tone: Tone, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
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
