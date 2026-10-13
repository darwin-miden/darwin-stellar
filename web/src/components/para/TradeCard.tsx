"use client";

/**
 * The trade card's LOOK, and nothing else.
 *
 * It exists because the card has to be the same object whether or not a wallet is connected.
 * Before this, a visitor without one got a small "Connect wallet" box where the card should be,
 * and the page changed shape under them the moment they connected — the thing they had been
 * reading was replaced by a different thing. Same for an account with no USDC: the form
 * collapsed into a funding box.
 *
 * So the card never changes shape. Position, sides, amount, what you get for it — always there.
 * What changes is the one button at the bottom: Connect wallet, then Add funds, then Buy. The
 * next step is always the same control in the same place.
 *
 * Pure presentation: every value and every handler is a prop. BasketTradePanel drives it with
 * live chain state; the signed-out card drives it with nothing, which is exactly the point.
 */

import type { ReactNode } from "react";
import s from "./TradeCard.module.css";

export interface TradeCardChip {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function TradeCard({
  symbol,
  side,
  onSide,
  sellDisabled,
  sellTitle,
  position,
  spendLabel,
  amount,
  onAmount,
  amountUnit,
  amountDisabled,
  onMax,
  maxDisabled,
  over,
  chips,
  available,
  receiveValue,
  receiveUnit,
  fine,
  warn,
  notes,
  cta,
  children,
  footer,
}: {
  symbol: string;
  side: "buy" | "sell";
  onSide: (side: "buy" | "sell") => void;
  sellDisabled?: boolean;
  sellTitle?: string;
  /** Shown above the sides when the account holds some. */
  position?: { value: string; sub?: string } | null;
  spendLabel: string;
  amount: string;
  onAmount: (v: string) => void;
  amountUnit: string;
  amountDisabled?: boolean;
  onMax?: () => void;
  maxDisabled?: boolean;
  over?: boolean;
  chips?: TradeCardChip[];
  /** Right of the "you receive" label — the balance this side can draw on. */
  available?: string | null;
  receiveValue: string;
  receiveUnit: string;
  /** One line under the estimate: the share count and the fee. */
  fine?: string | null;
  warn?: string | null;
  /** Muted lines between the estimate and the button. */
  notes?: ReactNode;
  cta: { label: string; onClick: () => void; disabled?: boolean };
  /** Anything that belongs under the button: progress, queue, claim. */
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const buying = side === "buy";
  return (
    <div>
      {position && (
        <div className={s.position}>
          <span className={s.positionLabel}>Your position</span>
          <span className={s.positionValue}>{position.value}</span>
          {position.sub && <span className={s.positionUsd}>{position.sub}</span>}
        </div>
      )}

      <div className={s.sides} role="group" aria-label="Trade side">
        <button type="button" className={s.side} data-on={buying || undefined} onClick={() => onSide("buy")}>
          Buy
        </button>
        <button
          type="button"
          className={s.side}
          data-on={!buying || undefined}
          disabled={sellDisabled}
          title={sellTitle}
          onClick={() => onSide("sell")}
        >
          Sell
        </button>
      </div>

      <div className={s.fieldLabel}>
        <span>{spendLabel}</span>
        <button type="button" className={s.maxLink} disabled={maxDisabled || !onMax} onClick={() => onMax?.()}>
          Max
        </button>
      </div>
      <div className={s.field} data-over={over || undefined}>
        <input
          value={amount}
          onChange={(e) => onAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          disabled={amountDisabled}
          className={s.input}
          placeholder="0.0"
          aria-label={spendLabel}
        />
        <span className={s.unit}>{amountUnit}</span>
      </div>

      {chips && chips.length > 0 && (
        <div className={s.chips}>
          {chips.map((c) => (
            <button key={c.label} type="button" className={s.chip} disabled={c.disabled} onClick={c.onClick}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className={s.fieldLabel} style={{ marginTop: 16 }}>
        <span>You receive</span>
        {available && (
          <span style={{ textTransform: "none", letterSpacing: 0 }}>Available {available}</span>
        )}
      </div>
      <div className={s.receive}>
        <span className={s.receiveValue} data-empty={receiveValue === "$0.00" || undefined}>
          ≈ {receiveValue}
        </span>
        <span className={s.unit}>{receiveUnit}</span>
      </div>
      {fine && <p className={s.note}>{fine}</p>}

      {warn && <p className={s.warn}>{warn}</p>}
      {notes}

      <button type="button" onClick={cta.onClick} disabled={cta.disabled} className={s.cta}>
        {cta.label}
      </button>

      {children}
      {footer}
    </div>
  );
}
