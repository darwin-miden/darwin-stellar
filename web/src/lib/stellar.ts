/**
 * Thin Soroban client: reads are free simulations, writes are simulate → assemble (auth + fees)
 * → sign by the connected wallet → submit → poll. The user is always the transaction source, so
 * every `require_auth` in the call tree (USDC transfer, share burn) is covered by the single
 * transaction signature: one wallet prompt per trade.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { DEPLOYMENT, FRIENDBOT, PASSPHRASE, RPC_URL } from "./config";

export const server = new rpc.Server(RPC_URL);

/** Simulation needs a well-formed source; it isn't charged or checked for sequence. */
const READ_SOURCE = DEPLOYMENT.admin;

export const addr = (a: string) => new Address(a).toScVal();
export const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });

export async function read<T = unknown>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(simError(sim));
  return scValToNative(sim.result!.retval) as T;
}

export type Signer = (txXdr: string) => Promise<string>;

/** Dry-run a write as `user` — the exact return value the real call would produce right now. */
export async function simulateAs<T = unknown>(user: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<T> {
  const tx = new TransactionBuilder(new Account(user, "0"), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(simError(sim));
  return scValToNative(sim.result!.retval) as T;
}

export interface WriteResult<T> {
  hash: string;
  value: T;
}

export async function write<T = unknown>(
  user: string,
  sign: Signer,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<WriteResult<T>> {
  const source = await server.getAccount(user);
  const raw = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  let prepared;
  try {
    prepared = await server.prepareTransaction(raw);
  } catch (e) {
    throw new Error(prettyContractError(String((e as Error)?.message ?? e)));
  }
  const signedXdr = await sign(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, PASSPHRASE);
  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR" || sent.status === "DUPLICATE" || sent.status === "TRY_AGAIN_LATER") {
    throw new Error(`Transaction rejected (${sent.status})`);
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed on-chain (${final.status})`);
  }
  const ok = final as rpc.Api.GetSuccessfulTransactionResponse;
  return { hash: sent.hash, value: (ok.returnValue ? scValToNative(ok.returnValue) : undefined) as T };
}

/** Testnet XLM for fees. Idempotent: an already-funded account is left alone. */
export async function ensureFunded(user: string): Promise<boolean> {
  try {
    await server.getAccount(user);
    return false;
  } catch {
    const r = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(user)}`);
    if (!r.ok && r.status !== 400) throw new Error("Friendbot unavailable, try again in a minute");
    return true;
  }
}

export async function xlmBalance(user: string): Promise<number | null> {
  try {
    const r = await fetch(`https://horizon-testnet.stellar.org/accounts/${user}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { balances: Array<{ asset_type: string; balance: string }> };
    const n = j.balances.find((b) => b.asset_type === "native");
    return n ? Number(n.balance) : 0;
  } catch {
    return null;
  }
}

// Contract error codes → readable copy (codes are per-contract, see contracts/*/src/lib.rs; these
// are the ones a user can actually hit from the app).
const CONTRACT_ERRORS: Record<string, string> = {
  "2": "Insufficient balance.",
  "3": "The price moved (or the feed is refreshing) beyond your slippage limit. Try again.",
  "4": "Market reserve too low for this sale.",
  "6": "Faucet cooldown: you can claim test USDC once an hour.",
};

function prettyContractError(msg: string): string {
  const m = msg.match(/Error\(Contract, #(\d+)\)/);
  if (m) return CONTRACT_ERRORS[m[1]] ?? `Contract error #${m[1]}`;
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

function simError(sim: rpc.Api.SimulateTransactionResponse): string {
  const e = (sim as rpc.Api.SimulateTransactionErrorResponse).error ?? "simulation failed";
  return prettyContractError(e);
}
