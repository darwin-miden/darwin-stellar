"use client";

/**
 * Wallet connection. Two ways in, mirroring the Miden app's "Para / native wallet" split:
 *   - "kit"  → any Stellar wallet through the Stellar Wallets Kit (Freighter, xBull, Lobstr,
 *              Albedo, Hana, Rabet, …). The wallet signs every transaction.
 *   - "demo" → an in-browser testnet key (kept in localStorage), funded by friendbot. No
 *              extension needed: the fastest way to try a basket.
 * Either way the app gets the same `{ address, sign }` and never cares which one it is.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import { PASSPHRASE } from "./config";
import { ensureFunded, type Signer } from "./stellar";

export type ConnectMethod = "kit" | "demo";

interface WalletState {
  address: string | null;
  method: ConnectMethod | null;
  walletName: string | null;
  connecting: boolean;
  sign: Signer;
  connect: (m: ConnectMethod) => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);
const DEMO_KEY = "darwin-stellar.demo-secret";
const LAST_KEY = "darwin-stellar.last";

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;
let kitPromise: Promise<Kit> | null = null;

/** Lazy: the kit touches `window`, so it's only loaded in the browser, on first use. */
function loadKit(): Promise<Kit> {
  kitPromise ??= (async () => {
    const [{ StellarWalletsKit, Networks }, { defaultModules }] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
    ]);
    StellarWalletsKit.init({ modules: defaultModules(), network: Networks.TESTNET });
    return StellarWalletsKit;
  })();
  return kitPromise;
}

function demoKeypair(): Keypair {
  let secret = localStorage.getItem(DEMO_KEY);
  if (!secret) {
    secret = Keypair.random().secret();
    localStorage.setItem(DEMO_KEY, secret);
  }
  return Keypair.fromSecret(secret);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [method, setMethod] = useState<ConnectMethod | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async (m: ConnectMethod) => {
    setConnecting(true);
    try {
      let a: string;
      if (m === "demo") {
        a = demoKeypair().publicKey();
        setWalletName("Demo wallet");
      } else {
        const kit = await loadKit();
        a = (await kit.authModal()).address;
        setWalletName(kit.selectedModule?.productName ?? "Stellar wallet");
      }
      // Gas onboarding: a fresh testnet account gets XLM from friendbot before its first trade.
      await ensureFunded(a).catch(() => {});
      setAddress(a);
      setMethod(m);
      localStorage.setItem(LAST_KEY, m);
    } finally {
      setConnecting(false);
    }
  }, []);

  // A returning demo user is reconnected silently (no prompt involved). Kit wallets need a click.
  useEffect(() => {
    if (localStorage.getItem(LAST_KEY) === "demo" && localStorage.getItem(DEMO_KEY)) void connect("demo");
  }, [connect]);

  const disconnect = useCallback(async () => {
    if (method === "kit") {
      try {
        (await loadKit()).disconnect();
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(LAST_KEY);
    setAddress(null);
    setMethod(null);
    setWalletName(null);
  }, [method]);

  const sign = useCallback<Signer>(
    async (txXdr) => {
      if (!address) throw new Error("Wallet not connected");
      if (method === "demo") {
        const tx = TransactionBuilder.fromXDR(txXdr, PASSPHRASE);
        tx.sign(demoKeypair());
        return tx.toXDR();
      }
      const kit = await loadKit();
      const { signedTxXdr } = await kit.signTransaction(txXdr, { networkPassphrase: PASSPHRASE, address });
      return signedTxXdr;
    },
    [address, method],
  );

  const value = useMemo(
    () => ({ address, method, walletName, connecting, sign, connect, disconnect }),
    [address, method, walletName, connecting, sign, connect, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
