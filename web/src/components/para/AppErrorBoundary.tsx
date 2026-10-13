"use client";

/**
 * App-level error boundary. Without one, ANY thrown render error unmounts the whole React tree to a
 * blank WHITE SCREEN with no way out — which is what happened when the Miden WASM client got into a
 * bad state (a "RefCell already borrowed" / "unreachable" panic surfacing through a render/commit).
 * Here we catch it, keep the Darwin chrome, tell the user their funds are safe, and offer a one-tap
 * reload (which re-inits the WASM client cleanly). The raw error is logged + shown collapsed for us.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it for us (and any error reporter) instead of swallowing it.
    console.error("[app-error-boundary]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--paper)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            borderRadius: 16,
            padding: 28,
            boxShadow: "0 20px 60px rgba(11,11,12,0.14)",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>Something went wrong</div>
          <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: "var(--ink-3)" }}>
            The app hit an unexpected error and needs a reload. <strong>Your funds are safe</strong> — they
            live on-chain and in your wallet, not in this page. Reloading re-syncs everything.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="nav-cta"
            style={{
              marginTop: 18,
              width: "100%",
              background: "var(--ink)",
              color: "var(--paper)",
              border: "none",
              borderRadius: 10,
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 12, color: "var(--ink-3)", cursor: "pointer" }}>Error details</summary>
            <pre
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--ink-3)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--font-mono-stack)",
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {String(error?.message ?? error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
