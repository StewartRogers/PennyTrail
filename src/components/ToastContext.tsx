"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

interface Toast {
  id: number;
  message: string;
}

const ToastCtx = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pushToast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current = timers.current.filter((t) => t !== timer);
    }, 2600);
    timers.current.push(timer);
  }, []);

  // The dismissal timers were fire-and-forget, so nothing could cancel them
  // on unmount. Harmless while the provider sits at the root and never
  // unmounts, but it makes the component unsafe to mount anywhere else (and
  // leaks a "state update on an unmounted component" in tests).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  return (
    <ToastCtx.Provider value={pushToast}>
      {children}
      {/* Toasts are the only channel for every error in the app (failed
          rename, failed merge, failed import) and they auto-dismiss in 2.6s,
          so without a live region a screen-reader user got no feedback at all
          on failure. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 100,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: "oklch(0.22 0.01 260)",
              color: "white",
              fontSize: 13,
              padding: "10px 16px",
              borderRadius: 8,
              boxShadow: "0 4px 16px oklch(0 0 0 / 0.2)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
