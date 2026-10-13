"use client";

/**
 * Side toast notifications — replace the inline red/status boxes inside the trade & funding modals.
 * Darwin palette (cream paper, ink type, orange/green/red accents). A toast can carry a title, an
 * optional detail line, an optional action button (for recoveries like re-sync / fresh account), and
 * auto-dismisses by type. The loading type persists until update()d — so a flow can push a loading
 * toast and flip it to success/error in place.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type ToastType = "loading" | "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  type?: ToastType;
  title: string;
  message?: string;
  action?: ToastAction;
  /** ms before auto-dismiss; 0 or loading = sticky until updated/dismissed. */
  duration?: number;
}

interface Toast extends ToastInput {
  id: number;
  type: ToastType; // always set on push (ToastInput.type is optional; here it's resolved)
}

interface ToastApi {
  push: (t: ToastInput) => number;
  update: (id: number, t: Partial<ToastInput>) => void;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

/** Default auto-dismiss per type (ms). loading never auto-dismisses — a pending op stays on screen until
 * it flips to success/error, so nothing vanishes before it's actually done. success lingers a few extra
 * seconds so a "Bought ✓" is comfortably readable before it fades. */
const DEFAULT_MS: Record<ToastType, number> = {
  loading: 0,
  success: 7000,
  error: 9000,
  info: 6000,
};

const ACCENT: Record<ToastType, string> = {
  loading: "var(--ink-3)",
  success: "var(--green)",
  error: "#d64545",
  info: "var(--orange)",
};

// The heap-reclaim recycle terminates the old WASM client, which makes its in-flight ops throw
// "unreachable"/RuntimeError. Those are expected, not crashes — the global error catcher below ignores
// FATAL errors while this window is open. Set generously around a recycle (covers remount + reveal +
// the deferred old-client terminate).
let suppressFatalUntil = 0;
export function suppressFatalToasts(ms: number) {
  suppressFatalUntil = Math.max(suppressFatalUntil, Date.now() + ms);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const h = timers.current.get(id);
    if (h) {
      clearTimeout(h);
      timers.current.delete(id);
    }
  }, []);

  const arm = useCallback(
    (id: number, type: ToastType, duration?: number) => {
      const ms = duration ?? DEFAULT_MS[type];
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.delete(id);
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      const type = t.type ?? "info";
      setToasts((ts) => [...ts, { ...t, id, type }]);
      arm(id, type, t.duration);
      return id;
    },
    [arm],
  );

  const update = useCallback(
    (id: number, patch: Partial<ToastInput>) => {
      setToasts((ts) => {
        const cur = ts.find((t) => t.id === id);
        if (!cur) return ts;
        const type = patch.type ?? cur.type;
        arm(id, type, patch.duration);
        return ts.map((t) => (t.id === id ? { ...t, ...patch, type } : t));
      });
    },
    [arm],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
    };
  }, []);

  // Global capture for ASYNC crashes the React error boundary can't see — a Miden WASM panic
  // ("RefCell already borrowed" / "unreachable" / "recursive use of an object") fires in a promise
  // callback, so it never hits render; the page would just go white then the provider resets to the
  // connect screen. Surface those as a sticky toast (with the exact message + a Reload) so the user
  // isn't staring at a blank page and we can see the real error.
  useEffect(() => {
    const FATAL = /already borrowed|unreachable|recursive use|RuntimeError|wasm|panicked/i;
    const shown = { current: false };
    const surface = (raw: unknown) => {
      const msg = String((raw as { message?: string })?.message ?? raw ?? "");
      if (!FATAL.test(msg) || shown.current) return;
      // Ignore the WASM traps the heap-reclaim recycle intentionally causes (terminating the old client
      // makes its in-flight ops throw "unreachable"/RuntimeError) — those are expected, not a real crash.
      if (Date.now() < suppressFatalUntil) {
        console.warn("[global-crash] suppressed during client recycle:", msg.slice(0, 120));
        return;
      }
      shown.current = true;
      console.error("[global-crash]", raw);
      push({
        type: "error",
        title: "The app hit an error",
        message: msg.slice(0, 240),
        duration: 0,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    };
    const onError = (e: ErrorEvent) => surface(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => surface(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [push]);

  return (
    <ToastCtx.Provider value={{ push, update, dismiss }}>
      {children}
      <div style={sty.stack} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  // No-throw fallback: if a panel renders outside a provider (shouldn't happen), toasts become no-ops
  // rather than crashing a trade.
  return (
    ctx ?? {
      push: () => -1,
      update: () => {},
      dismiss: () => {},
    }
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const accent = ACCENT[toast.type ?? "info"];
  return (
    <div style={sty.card} role={toast.type === "error" ? "alert" : "status"}>
      <span style={{ ...sty.stripe, background: accent }} aria-hidden />
      <div style={sty.body}>
        <div style={sty.head}>
          <span style={sty.icon} aria-hidden>
            {toast.type === "loading" ? <Spinner /> : <Glyph type={toast.type ?? "info"} color={accent} />}
          </span>
          <span style={sty.title}>{toast.title}</span>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="toast-close">
            ✕
          </button>
        </div>
        {toast.message && <div style={sty.msg}>{toast.message}</div>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onClose();
            }}
            style={sty.action}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Glyph({ type, color }: { type: ToastType; color: string }) {
  const ch = type === "success" ? "✓" : type === "error" ? "!" : "•";
  return <span style={{ color, fontWeight: 700, fontSize: 13, lineHeight: 1 }}>{ch}</span>;
}

function Spinner() {
  return <span className="toast-spin" style={sty.spinner} aria-hidden />;
}

const sty: Record<string, CSSProperties> = {
  stack: {
    position: "fixed",
    bottom: 16,
    right: 16,
    zIndex: 1000,
    display: "flex",
    flexDirection: "column", // anchored bottom-right: newest sits at the corner, older ones stack above
    gap: 10,
    width: "min(360px, calc(100vw - 32px))",
    pointerEvents: "none",
  },
  card: {
    pointerEvents: "auto",
    display: "flex",
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 12px 32px rgba(11,11,12,0.16)",
    animation: "toast-in 220ms cubic-bezier(0.16,1,0.3,1)",
  },
  stripe: { width: 4, flex: "0 0 4px", alignSelf: "stretch" },
  body: { flex: 1, padding: "12px 14px", minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: 8 },
  icon: { width: 16, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 16px" },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--ink)",
    lineHeight: 1.3,
    minWidth: 0,
  },
  msg: {
    marginTop: 4,
    fontSize: 13,
    color: "var(--ink-3)",
    lineHeight: 1.4,
    paddingLeft: 24,
    wordBreak: "break-word",
  },
  action: {
    marginTop: 10,
    marginLeft: 24,
    background: "var(--ink)",
    color: "var(--paper)",
    border: "none",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  spinner: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    border: "2px solid var(--rule)",
    borderTopColor: "var(--ink-3)",
    display: "inline-block",
  },
};
