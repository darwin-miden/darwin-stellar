#!/usr/bin/env node
// End-to-end check of the live testnet deployment. No mocks: fresh accounts funded by friendbot,
// real signatures, real Reflector prices. For every basket it buys, checks every number the
// contracts promise (fees, spread, backing invariant, reserve accounting, one tx = every leg),
// tries the attacks / mistakes that must revert, then sells everything back.
//
//   node scripts/e2e.mjs            # all baskets
//   node scripts/e2e.mjs DXEM       # one basket
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "web/package.json"));
const { Keypair, Contract, TransactionBuilder, BASE_FEE, Address, nativeToScVal, scValToNative, rpc, StrKey, xdr } =
  require("@stellar/stellar-sdk");

const D = JSON.parse(readFileSync(join(ROOT, "deployments/testnet.json"), "utf8"));
const server = new rpc.Server(D.rpcUrl);
const NET = D.passphrase;
const USDC_ONE = 10n ** 7n;
const ONLY = process.argv[2];

// ── tiny client ───────────────────────────────────────────────────────────────────────────

const a = (s) => new Address(s).toScVal();
const i = (v) => nativeToScVal(BigInt(v), { type: "i128" });
const results = [];
let failures = 0;

function check(ok, label, detail = "") {
  results.push({ ok, label });
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
}

async function read(id, fn, args = []) {
  const tx = new TransactionBuilder(await server.getAccount(D.admin), { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(new Contract(id).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

async function send(kp, id, fn, args) {
  const src = await server.getAccount(kp.publicKey());
  const raw = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(new Contract(id).call(fn, ...args))
    .setTimeout(60)
    .build();
  const tx = await server.prepareTransaction(raw);
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error(`rejected: ${sent.errorResult?.result().switch().name}`);
  const final = await server.pollTransaction(sent.hash, { attempts: 40, sleepStrategy: () => 1000 });
  if (final.status !== "SUCCESS") throw new Error(`failed on-chain: ${final.status}`);
  return { hash: sent.hash, value: final.returnValue ? scValToNative(final.returnValue) : undefined, events: final.events, ledger: final.ledger };
}

/** Must fail at simulation (that's where Soroban enforces auth + contract errors). */
async function mustFail(kp, id, fn, args, expect) {
  try {
    await send(kp, id, fn, args);
    return { failed: false, msg: "went through" };
  } catch (e) {
    const msg = String(e.message ?? e);
    return { failed: expect ? new RegExp(expect).test(msg) : true, msg: (msg.match(/Error\([^)]*\)/) ?? [msg.slice(0, 80)])[0] };
  }
}

async function fresh(label) {
  const kp = Keypair.random();
  const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
  console.log(`  ${label}: ${kp.publicKey()}`);
  return kp;
}

/** Contract events of a tx: [{ contract, topics:[...], data }], decoded from the raw RPC XDR. */
async function eventsOf(res) {
  const r = await fetch(D.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash: res.hash } }),
  }).then((x) => x.json());
  const out = [];
  for (const op of r.result?.events?.contractEventsXdr ?? []) {
    for (const b64 of op) {
      // stellar-sdk 17 decodes XDR into plain objects (body.v0.topics, contractId.value)
      const ev = xdr.ContractEvent.fromXDR(b64, "base64");
      const body = ev.body.v0;
      out.push({
        contract: StrKey.encodeContract(Buffer.from(ev.contractId.value)),
        topics: body.topics.map((t) => scValToNative(t)),
        data: scValToNative(body.data),
      });
    }
  }
  return out;
}

const bal = (token, who) => read(token, "balance", [a(who)]).then(BigInt);
const usd = (base, dec = 7) => (Number(base) / 10 ** dec).toFixed(dec === 7 ? 4 : 6);
const close = (x, y, tolBps) => {
  const d = x > y ? x - y : y - x;
  return d * 10_000n <= (y < 0n ? -y : y) * BigInt(tolBps);
};

// ── deployment wiring ─────────────────────────────────────────────────────────────────────

async function checkWiring() {
  console.log("\n[1] Deployment wiring");
  check((await read(D.market, "usdc")) === D.usdc, "market settles in the deployed USDC");
  check((await read(D.market, "oracle")) === D.oracle, "market prices through the Darwin oracle");
  for (const [s, asset] of Object.entries(D.assets)) {
    const admin = await read(asset.id, "admin");
    const listed = await read(D.market, "is_listed", [a(asset.id)]);
    check(admin === D.market && listed, `${s}: admin = market, listed`);
  }
  for (const b of D.baskets) {
    if (ONLY && b.symbol !== ONLY) continue;
    const cfg = await read(b.vault, "config");
    const sharesAdmin = await read(b.shares, "admin");
    const fees = await read(b.vault, "fees");
    check(
      sharesAdmin === b.vault && cfg.shares === b.shares && cfg.constituents.length === b.constituents.length,
      `${b.symbol}: share token admin = vault, ${cfg.constituents.length} legs`,
    );
    check(Number(fees.buy_bps) === 30 && Number(fees.sell_bps) === 20, `${b.symbol}: fees 30 bps buy / 20 bps sell`);
  }
}

// ── oracle vs Reflector ───────────────────────────────────────────────────────────────────

async function checkOracle() {
  console.log("\n[2] Oracle = Reflector × yield index");
  const now = Math.floor(Date.now() / 1000);
  for (const [s, asset] of Object.entries(D.assets)) {
    const p = BigInt(await read(D.oracle, "price", [a(asset.id)]));
    let ref, age = 0;
    if (asset.feed.fixed) ref = BigInt(asset.feed.fixed);
    else {
      const feed = asset.feed.fiat ? D.reflector.fiat : D.reflector.crypto;
      const code = asset.feed.fiat ?? asset.feed.crypto;
      const last = await read(feed, "lastprice", [xdrAssetOther(code)]);
      ref = BigInt(last.price);
      age = now - Number(last.timestamp);
    }
    const accrued = Number(ref) * (1 + (asset.apyBps / 10_000) * ((now - asset.t0) / 31_536_000));
    const ok = Math.abs(Number(p) - accrued) / accrued < 0.0005;
    check(ok, `${s.padEnd(8)} $${(Number(p) / 1e14).toFixed(4)}`, `${asset.apyBps ? `${asset.apyBps / 100}% APY accrued, ` : ""}${asset.feed.fixed ? "fixed ref" : `Reflector ${age}s old`}`);
  }
}

// Reflector's Asset enum: Other(Symbol)
function xdrAssetOther(code) {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol(code)]);
}

// ── one basket, end to end ────────────────────────────────────────────────────────────────

async function basketRoundTrip(b, alice, bob) {
  console.log(`\n[${b.symbol}] ${b.name} — ${b.constituents.map((c) => `${c.sym} ${c.weightBps / 100}%`).join(" · ")}`);
  const SPEND = 200n * USDC_ONE;
  const legs = b.constituents;

  const nav0 = await read(b.vault, "nav");
  const fee0 = await bal(D.usdc, D.admin);
  const reserve0 = BigInt(await read(D.market, "reserve"));
  const usdc0 = await bal(D.usdc, alice.publicKey());
  const navPerShare = BigInt(nav0.nav_per_share);
  console.log(`  NAV ${usd(navPerShare)} USDC / ${b.symbol}, supply ${usd(BigInt(nav0.supply))}, TVL $${usd(BigInt(nav0.tvl))}`);

  // quote = exact dry-run of the real call
  const quote = BigInt(await (async () => {
    const tx = new TransactionBuilder(await server.getAccount(alice.publicKey()), { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(new Contract(b.vault).call("buy", a(alice.publicKey()), i(SPEND), i(0)))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    return scValToNative(sim.result.retval);
  })());

  // slippage guard: asking for 5% more than the market gives must revert, and cost nothing
  const slip = await mustFail(alice, b.vault, "buy", [a(alice.publicKey()), i(SPEND), i((quote * 105n) / 100n)], "#3");
  check(slip.failed, "buy with min_shares = quote + 5% reverts (slippage guard)", slip.msg);

  // the buy
  const buy = await send(alice, b.vault, "buy", [a(alice.publicKey()), i(SPEND), i((quote * 99n) / 100n)]);
  const minted = BigInt(buy.value);
  console.log(`  buy tx ${buy.hash} (ledger ${buy.ledger})`);
  check(close(minted, quote, 20), `minted ${usd(minted)} ${b.symbol} ≈ quoted ${usd(quote)}`);

  // expected: 200 − 0.30% fee − 0.10% spread, at NAV
  const expectShares = (SPEND * 9970n * 9990n * USDC_ONE) / (10_000n * 10_000n * navPerShare);
  check(close(minted, expectShares, 30), `shares = 200 × (1−0.30%) × (1−0.10%) / NAV`, `expected ${usd(expectShares)}`);

  // one transaction bought every leg: the constituent mints to the vault are in its events
  const ev = await eventsOf(buy);
  const legMints = legs.filter((c) => ev.some((e) => e.contract === c.token && e.topics[0] === "mint" && e.topics[1] === b.vault));
  check(legMints.length === legs.length, `one tx minted all ${legs.length} legs into the vault`, legMints.map((c) => c.sym).join(", "));
  check(ev.some((e) => e.contract === b.shares && e.topics[0] === "mint" && e.topics[1] === alice.publicKey()), `${b.symbol} minted to the buyer in the same tx`);

  const usdc1 = await bal(D.usdc, alice.publicKey());
  const fee1 = await bal(D.usdc, D.admin);
  const reserve1 = BigInt(await read(D.market, "reserve"));
  check(usdc0 - usdc1 === SPEND, `buyer paid exactly 200 USDC`);
  check(fee1 - fee0 === (SPEND * 30n) / 10_000n, `protocol fee 0.60 USDC to the fee recipient`);
  check(reserve1 - reserve0 === SPEND - (SPEND * 30n) / 10_000n, `market reserve +${usd(reserve1 - reserve0)} USDC = exactly the 199.40 net`);

  // backing invariant on every leg
  const nav1 = await read(b.vault, "nav");
  const supply1 = BigInt(nav1.supply);
  const backed = legs.every((c, k) => BigInt(nav1.holdings[k]) * USDC_ONE >= BigInt(c.units) * supply1);
  check(backed, `backing invariant holds: holdings[i] ≥ units[i] × supply on every leg`);
  check(close(BigInt(nav1.nav_per_share), navPerShare, 15), `NAV unchanged by the buy (${usd(BigInt(nav1.nav_per_share))})`);

  // bob can't spend alice's shares, and alice can't sell more than she has
  const steal = await mustFail(bob, b.vault, "sell", [a(alice.publicKey()), i(minted), i(0)]);
  check(steal.failed, "a third party can't sell the buyer's shares (require_auth)", steal.msg);
  const over = await mustFail(alice, b.vault, "sell", [a(alice.publicKey()), i(minted + 1n), i(0)]);
  check(over.failed, "selling more than the balance reverts", over.msg);

  // sell half, then the rest
  const half = minted / 2n;
  const sell1 = await send(alice, b.vault, "sell", [a(alice.publicKey()), i(half), i(0)]);
  const back1 = BigInt(sell1.value);
  const expectBack = (half * navPerShare * 9990n * 9980n) / (USDC_ONE * 10_000n * 10_000n);
  console.log(`  sell 50% tx ${sell1.hash}`);
  check(close(back1, expectBack, 40), `50% sold for ${usd(back1)} USDC ≈ NAV × (1−0.10%) × (1−0.20%)`, `expected ${usd(expectBack)}`);
  const sellEv = await eventsOf(sell1);
  const legBurns = legs.filter((c) => sellEv.some((e) => e.contract === c.token && e.topics[0] === "burn"));
  check(legBurns.length === legs.length, `one tx sold all ${legs.length} legs`);

  const rest = await bal(b.shares, alice.publicKey());
  const sell2 = await send(alice, b.vault, "sell", [a(alice.publicKey()), i(rest), i(0)]);
  const back = back1 + BigInt(sell2.value);
  check((await bal(b.shares, alice.publicKey())) === 0n, `all ${b.symbol} burned`);
  check(BigInt((await read(b.vault, "nav")).supply) === BigInt(nav0.supply), `supply back to its pre-test value`);

  const lossBps = Number(((SPEND - back) * 10_000n) / SPEND);
  check(lossBps >= 60 && lossBps <= 85, `round trip: 200 → ${usd(back)} USDC, ${lossBps} bps = fees 30+20 + spread 10+10 (+ price move)`);
  return { symbol: b.symbol, buy: buy.hash, sell: sell1.hash, minted, back, lossBps };
}

// ── run ───────────────────────────────────────────────────────────────────────────────────

console.log(`Darwin on Stellar — e2e on ${D.network} (deployed ${D.deployedAt})`);
await checkWiring();
await checkOracle();

console.log("\n[3] Accounts + faucet");
const alice = await fresh("alice (trader)");
const bob = await fresh("bob (attacker)");
const f = await send(alice, D.usdc, "faucet", [a(alice.publicKey())]);
check(BigInt(f.value) === 1000n * USDC_ONE && (await bal(D.usdc, alice.publicKey())) === 1000n * USDC_ONE, "faucet: 1,000 test USDC");
const again = await mustFail(alice, D.usdc, "faucet", [a(alice.publicKey())], "#6");
check(again.failed, "second claim within the hour reverts (cooldown)", again.msg);
const noAuth = await mustFail(bob, D.usdc, "mint", [a(bob.publicKey()), i(1_000_000n * USDC_ONE)]);
check(noAuth.failed, "nobody but the admin can mint USDC", noAuth.msg);
const legMint = await mustFail(bob, D.assets.BTC.id, "mint", [a(bob.publicKey()), i(10n ** 12n)]);
check(legMint.failed, "nobody but the market can mint a constituent", legMint.msg);

const summary = [];
for (const b of D.baskets) {
  if (ONLY && b.symbol !== ONLY) continue;
  summary.push(await basketRoundTrip(b, alice, bob));
}

console.log("\n──────── summary");
for (const s of summary) console.log(`  ${s.symbol}: 200 USDC → ${usd(s.minted)} ${s.symbol} → ${usd(s.back)} USDC (${s.lossBps} bps)  buy ${s.buy.slice(0, 10)}…`);
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
