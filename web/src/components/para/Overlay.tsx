"use client";

import { useEffect, useRef } from "react";

/**
 * Modal overlay: click-out + Esc to close, background scroll lock, focus into the dialog.
 * Kept in its own light module (no app/WASM deps) so ConnectGate can use it without pulling
 * in ParaAppShell — that lets the connect screen render before the Miden client chunk loads.
 */
// `hidden` keeps the dialog + its children MOUNTED but unpainted (display:none) — React keeps the
// subtree alive, so its effects/refs/timers keep running. The trade panel uses this to stay alive
// after the user closes the modal while a buy is still queued/firing: its queue processor must keep
// draining even with no visible modal (see ParaAppShell), and display:none avoids remounting it
// (which would drop the processor and orphan the queued buy). When hidden we also release the scroll
// lock / Esc / focus so the closed modal doesn't freeze the page behind it.
export function Overlay({
  children,
  onClose,
  hidden = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  hidden?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without making the mount effect depend on it — callers pass an inline
  // `() => setX(null)`, a fresh reference every parent render, and re-running the effect would
  // re-focus the dialog and STEAL focus from whatever the user is typing in (e.g. the amount input).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Esc closes (via the ref), background scroll locked, focus moved into the dialog — but ONLY while
    // visible. Depends on `hidden` so hiding (modal closed, panel kept alive) releases the lock/Esc and
    // showing re-applies them; it does NOT re-run on ordinary re-renders, so it never re-steals focus.
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [hidden]);

  // When closed-but-kept-mounted (display:none so the queue processor keeps draining), mark the
  // subtree `inert`: it blurs any still-focused control (e.g. the close button) and removes the
  // subtree from the focus + a11y trees. This supersedes aria-hidden and avoids Chrome's "Blocked
  // aria-hidden on an element because its descendant retained focus" warning. Set imperatively
  // because `inert` isn't a typed React 18 prop.
  useEffect(() => {
    if (overlayRef.current) overlayRef.current.inert = hidden;
  }, [hidden]);

  return (
    <div
      ref={overlayRef}
      onClick={hidden ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: hidden ? "none" : "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflowY: "auto",
        background: "rgba(11,11,12,0.55)",
        padding: "40px 16px",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: 18,
          padding: 22,
          boxShadow: "0 20px 60px rgba(11,11,12,0.25)",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--ink-3)", lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
