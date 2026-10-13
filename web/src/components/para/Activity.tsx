"use client";

/** Activity feed (Baskets-tab preview + full Activity tab) — same rows as the Miden app, plus a tx link. */

import { useState, useSyncExternalStore } from "react";

import { EXPLORER } from "../../lib/config";
import { getTradeHistory, subscribeTradeHistory, type TradeEntry } from "../../lib/tradeHistory";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One buy/sell row — shared by the Baskets-tab preview and the Activity tab. */
function ActivityRow({ h, first }: { h: TradeEntry; first: boolean }) {
  const isBuy = h.kind === "buy";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderTop: first ? "none" : "1px solid var(--rule)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: 6,
            color: isBuy ? "var(--green)" : "var(--orange)",
            background: isBuy ? "color-mix(in srgb, var(--green) 12%, transparent)" : "color-mix(in srgb, var(--orange) 12%, transparent)",
          }}
        >
          {isBuy ? "Buy" : "Sell"}
        </span>
        <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)", flexShrink: 0 }}>{h.symbol}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-mono-stack)", fontSize: 14 }}>
          {h.amount} {h.unit}
        </span>
        {h.tx && (
          <a
            href={`${EXPLORER}/tx/${h.tx}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "var(--orange)", textDecoration: "none" }}
          >
            tx ↗
          </a>
        )}
        <span style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 62, textAlign: "right" }}>{timeAgo(h.ts)}</span>
      </div>
    </div>
  );
}

/** Recent-activity preview for the Baskets tab — the latest `limit`, with a "View all" link. */
export function TradeHistory({ accountId, limit, onViewAll }: { accountId: string | null; limit?: number; onViewAll?: () => void }) {
  const history = useSyncExternalStore<TradeEntry[]>(
    subscribeTradeHistory,
    () => getTradeHistory(accountId),
    () => getTradeHistory(null),
  );
  if (!accountId) return null;
  const shown = limit != null ? history.slice(0, limit) : history;
  const more = history.length - shown.length;

  return (
    <section style={{ marginTop: "clamp(36px, 7vh, 72px)" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 14px" }}>Recent activity</h2>
      {history.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>Your buys and sells will show up here.</p>
      ) : (
        <div style={{ border: "1px solid var(--rule)", borderRadius: 12, overflow: "hidden" }}>
          {shown.map((h, i) => (
            <ActivityRow key={h.ts + "-" + i} h={h} first={i === 0} />
          ))}
        </div>
      )}
      {more > 0 && onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          style={{ marginTop: 12, background: "none", border: "none", padding: 0, color: "var(--orange)", cursor: "pointer", fontSize: 14, fontWeight: 500 }}
        >
          View all {history.length} →
        </button>
      )}
    </section>
  );
}

/** Full activity feed for the Activity tab — every logged trade, with a buy/sell filter. */
export function ActivityTab({ accountId }: { accountId: string | null }) {
  const history = useSyncExternalStore<TradeEntry[]>(
    subscribeTradeHistory,
    () => getTradeHistory(accountId),
    () => getTradeHistory(null),
  );
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const shown = filter === "all" ? history : history.filter((h) => h.kind === filter);

  const chip = (key: "all" | "buy" | "sell", text: string) => {
    const active = filter === key;
    return (
      <button
        type="button"
        onClick={() => setFilter(key)}
        style={{
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          padding: "5px 13px",
          borderRadius: 999,
          cursor: "pointer",
          transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
          // Selected = the app's soft-orange accent (same mix as the basket-card hover
          // border), not a heavy black fill. Readable ink text; inactive stays a quiet outline.
          border: active
            ? "1px solid color-mix(in srgb, var(--orange) 55%, var(--rule))"
            : "1px solid var(--rule)",
          background: active ? "color-mix(in srgb, var(--orange) 13%, transparent)" : "transparent",
          color: active ? "var(--ink)" : "var(--ink-3)",
        }}
      >
        {text}
      </button>
    );
  };

  return (
    <main style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(28px, 5vh, 56px) clamp(20px, 4vw, 40px)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Activity</h1>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {chip("all", "All")}
        {chip("buy", "Buys")}
        {chip("sell", "Sells")}
      </div>

      <div style={{ marginTop: 16 }}>
        {!accountId || history.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>Your buys and sells will show up here.</p>
        ) : shown.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>No {filter === "buy" ? "buys" : "sells"} yet.</p>
        ) : (
          <div style={{ border: "1px solid var(--rule)", borderRadius: 12, overflow: "hidden" }}>
            {shown.map((h, i) => (
              <ActivityRow key={h.ts + "-" + i} h={h} first={i === 0} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

