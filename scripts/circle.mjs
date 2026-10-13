// Circle USDC on Stellar testnet: the classic asset USDC:GBBD47IF…, used by contracts through its
// Stellar Asset Contract. Holding it takes a trustline; getting it, either faucet.circle.com
// (20 USDC every 2 hours, by hand) or a swap from friendbot XLM through the testnet XLM/USDC
// pool. The scripts use the swap.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "web/package.json"));
const sdk = require("@stellar/stellar-sdk");
const { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, Contract, Address, nativeToScVal, rpc, BASE_FEE } = sdk;

export const CIRCLE = {
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  sac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  faucet: "https://faucet.circle.com/",
};
export const USDC_ASSET = new Asset("USDC", CIRCLE.issuer);

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const soroban = new rpc.Server("https://soroban-testnet.stellar.org");

async function submitClassic(kp, ops) {
  const acct = await horizon.loadAccount(kp.publicKey());
  let b = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: Networks.TESTNET });
  for (const op of ops) b = b.addOperation(op);
  const tx = b.setTimeout(60).build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

export async function friendbot(pub) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pub}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${r.status}`);
}

export async function usdcBalance(pub) {
  const a = await horizon.loadAccount(pub).catch(() => null);
  const line = a?.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === CIRCLE.issuer);
  return line ? line.balance : null; // null = no trustline
}

export async function ensureTrustline(kp) {
  if ((await usdcBalance(kp.publicKey())) !== null) return false;
  await submitClassic(kp, [Operation.changeTrust({ asset: USDC_ASSET })]);
  return true;
}

/** Swap `xlm` XLM for Circle USDC through the testnet pool, paid to the same account. */
export async function swapXlmForUsdc(kp, xlm) {
  const paths = await horizon.strictSendPaths(Asset.native(), String(xlm), [USDC_ASSET]).call();
  const best = paths.records[0];
  if (!best) throw new Error("no XLM → USDC path on testnet");
  const destMin = (Number(best.destination_amount) * 0.99).toFixed(7);
  await submitClassic(kp, [
    Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: String(xlm),
      destination: kp.publicKey(),
      destAsset: USDC_ASSET,
      destMin,
      path: best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer))),
    }),
  ]);
  return best.destination_amount;
}

/** Move `amount` base units of Circle USDC from an account to any address (account or contract). */
export async function transferUsdc(kp, to, amount) {
  const src = await soroban.getAccount(kp.publicKey());
  const raw = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(
      new Contract(CIRCLE.sac).call(
        "transfer",
        new Address(kp.publicKey()).toScVal(),
        new Address(to).toScVal(),
        nativeToScVal(BigInt(amount), { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();
  const tx = await soroban.prepareTransaction(raw);
  tx.sign(kp);
  const sent = await soroban.sendTransaction(tx);
  const res = await soroban.pollTransaction(sent.hash, { attempts: 40, sleepStrategy: () => 1000 });
  if (res.status !== "SUCCESS") throw new Error(`USDC transfer failed: ${res.status}`);
  return sent.hash;
}

/** A fresh friendbot account holding Circle USDC: trustline + swap of `xlm` XLM. */
export async function freshUsdcAccount(xlm = 1000) {
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  await ensureTrustline(kp);
  const got = await swapXlmForUsdc(kp, xlm);
  return { kp, got };
}
