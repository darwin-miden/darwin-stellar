/**
 * Thin Soroban client: reads are free simulations, writes are simulate → assemble (auth + fees)
 * → sign by the connected wallet → submit → poll. The user is always the transaction source, so
 * every `require_auth` in the call tree (USDC transfer, share burn) is covered by the single
 * transaction signature: one wallet prompt per trade.
 */

import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { DEPLOYMENT, FRIENDBOT, HORIZON_URL, PASSPHRASE, RPC_URL, USDC_ISSUER } from "./config";

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
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(simError(sim, method));
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
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(simError(sim, method));
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
    throw new Error(prettyContractError(String((e as Error)?.message ?? e), method));
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

export const horizon = new Horizon.Server(HORIZON_URL);
export const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

/** What Horizon knows about an address: does the account exist, its XLM, and its Circle USDC line. */
export interface AccountState {
  exists: boolean;
  xlm: number;
  /** null = no USDC trustline yet (the account can't hold Circle's USDC). */
  usdc: bigint | null;
}

export async function accountState(user: string): Promise<AccountState> {
  const r = await fetch(`${HORIZON_URL}/accounts/${user}`);
  if (r.status === 404) return { exists: false, xlm: 0, usdc: null };
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  const j = (await r.json()) as { balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> };
  const native = j.balances.find((b) => b.asset_type === "native");
  const line = j.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  return { exists: true, xlm: native ? Number(native.balance) : 0, usdc: line ? toBase(line.balance) : null };
}

/** "12.3456789" → 123456789n (7 decimals). */
function toBase(amount: string): bigint {
  const [w, f = ""] = amount.split(".");
  return BigInt(w) * 10_000_000n + BigInt((f + "0000000").slice(0, 7));
}

/** A classic transaction (trustline, swap), signed by the connected wallet and sent to Horizon. */
async function sendClassic(user: string, sign: Signer, ops: xdr.Operation[]): Promise<string> {
  const acct = await horizon.loadAccount(user);
  let b = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: PASSPHRASE });
  for (const op of ops) b = b.addOperation(op);
  const tx = b.setTimeout(120).build();
  const signed = TransactionBuilder.fromXDR(await sign(tx.toXDR()), PASSPHRASE);
  try {
    const res = await horizon.submitTransaction(signed);
    return res.hash;
  } catch (e) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes;
    throw new Error(codes ? `Transaction failed: ${JSON.stringify(codes)}` : String((e as Error)?.message ?? e));
  }
}

/** One signature, once: lets the account hold Circle's USDC. */
export function addUsdcTrustline(user: string, sign: Signer): Promise<string> {
  return sendClassic(user, sign, [Operation.changeTrust({ asset: USDC_ASSET })]);
}

/** Best quote for swapping `xlm` XLM into USDC on the testnet DEX / pool. */
export async function quoteXlmToUsdc(xlm: string): Promise<{ usdc: string; path: Asset[] } | null> {
  const paths = await horizon.strictSendPaths(Asset.native(), xlm, [USDC_ASSET]).call();
  const best = paths.records[0];
  if (!best) return null;
  return {
    usdc: best.destination_amount,
    path: best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer))),
  };
}

/** Swap testnet XLM for real Circle USDC, paid to the same wallet (1% slippage floor). */
export async function swapXlmToUsdc(user: string, sign: Signer, xlm: string): Promise<{ hash: string; usdc: string }> {
  const q = await quoteXlmToUsdc(xlm);
  if (!q) throw new Error("No XLM → USDC route on testnet right now");
  const hash = await sendClassic(user, sign, [
    Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: xlm,
      destination: user,
      destAsset: USDC_ASSET,
      destMin: (Number(q.usdc) * 0.99).toFixed(7),
      path: q.path,
    }),
  ]);
  return { hash, usdc: q.usdc };
}

// Contract error codes → readable copy (codes are per-contract, see contracts/*/src/lib.rs; these
// are the ones a user can actually hit from the app).
const CONTRACT_ERRORS: Record<string, string> = {
  "2": "Insufficient balance.",
  "3": "The price moved (or the feed is refreshing) beyond your slippage limit. Try again.",
  "4": "Market reserve too low for this sale.",
  // Circle's USDC contract: the account has no USDC trustline.
  "13": "Add the USDC trustline first (Faucet tab).",
};

// The same code means different things per contract.
const METHOD_ERRORS: Record<string, Record<string, string>> = {
  faucet: { "6": "Faucet cooldown: you can claim test USDC once an hour." },
  buy: { "6": "New buys are paused on this basket. You can still sell." },
};

function prettyContractError(msg: string, method = ""): string {
  const m = msg.match(/Error\(Contract, #(\d+)\)/);
  if (m) return METHOD_ERRORS[method]?.[m[1]] ?? CONTRACT_ERRORS[m[1]] ?? `Contract error #${m[1]}`;
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

function simError(sim: rpc.Api.SimulateTransactionResponse, method = ""): string {
  const e = (sim as rpc.Api.SimulateTransactionErrorResponse).error ?? "simulation failed";
  return prettyContractError(e, method);
}
