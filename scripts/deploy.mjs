#!/usr/bin/env node
// Deploy the full Darwin stack to Stellar testnet with the stellar CLI:
//   oracle (Reflector feeds) → market → constituents → baskets, all settling in Circle's USDC.
// The market's USDC reserve is seeded with real Circle USDC, swapped from friendbot XLM.
// Writes deployments/testnet.json and web/src/config/testnet.json (read by the web app).
//
//   node scripts/deploy.mjs            # source identity: darwin-stellar-admin
//   SOURCE=my-key node scripts/deploy.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { BASKETS, CONSTITUENTS, LAUNCH_NAV_USD, REFLECTOR } from "./catalog.mjs";
import { CIRCLE, ensureTrustline, freshUsdcAccount, transferUsdc } from "./circle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = join(ROOT, "contracts/target/wasm32v1-none/release");
const SOURCE = process.env.SOURCE ?? "darwin-stellar-admin";
const NET = ["--source", SOURCE, "--network", "testnet"];
const DEC = 7; // USDC + basket shares (Stellar native precision)
const ASSET_DEC = 12; // constituents: keeps a $1 share's BTC leg precise
const ASSET_ONE = 10n ** BigInt(ASSET_DEC);

function cli(args) {
  const out = execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return out.split("\n").pop().trim();
}
const upload = (name) => cli(["contract", "upload", "--wasm", join(WASM, `darwin_${name}.wasm`), ...NET]);
const deploy = (hash, alias, ctor) => {
  const id = cli(["contract", "deploy", "--wasm-hash", hash, "--alias", alias, ...NET, "--", ...ctor]);
  console.log(`  ${alias.padEnd(24)} ${id}`);
  return id;
};
const invoke = (id, fn, args = [], send = true) =>
  cli(["contract", "invoke", "--id", id, ...NET, ...(send ? [] : ["--send=no"]), "--", fn, ...args]);

const admin = cli(["keys", "address", SOURCE]);
const { Keypair } = createRequire(join(ROOT, "web/package.json"))("@stellar/stellar-sdk");
const adminKp = Keypair.fromSecret(cli(["keys", "show", SOURCE]));
const SEED_ACCOUNTS = Number(process.env.SEED_ACCOUNTS ?? 3); // × ~8,500 USDC each
console.log(`admin ${admin}`);

console.log("uploading wasm…");
const H = Object.fromEntries(["token", "oracle", "market", "basket"].map((n) => [n, upload(n)]));

const token = (alias, name, symbol, faucet, tokenAdmin = admin, decimals = DEC) =>
  deploy(H.token, alias, ["--admin", tokenAdmin, "--decimals", String(decimals), "--name", name, "--symbol", symbol, "--faucet_amount", String(faucet)]);

console.log("core…");
const usdc = CIRCLE.sac;
console.log(`  ${"circle-usdc (SAC)".padEnd(24)} ${usdc}`);
// The admin receives the protocol fees: a classic account needs a USDC trustline for that.
if (await ensureTrustline(adminKp)) console.log("  admin: USDC trustline added");
const oracle = deploy(H.oracle, "darwin-oracle", ["--admin", admin, "--max_age_secs", "3600"]);
const market = deploy(H.market, "darwin-market", ["--admin", admin, "--usdc", usdc, "--oracle", oracle, "--spread_bps", "10"]);

const t0 = Math.floor(Date.now() / 1000);
const feedJson = (c) => {
  let source;
  if (c.feed.fixed != null) source = { Fixed: c.feed.fixed.toString() };
  else if (c.feed.fiat) source = { Reflector: [REFLECTOR.fiat, { Other: c.feed.fiat }] };
  else source = { Reflector: [REFLECTOR.crypto, { Other: c.feed.crypto }] };
  return JSON.stringify({ source, apy_bps: c.apyBps, t0 });
};
invoke(oracle, "set_feed", ["--token", usdc, "--feed", JSON.stringify({ source: { Fixed: (10n ** 14n).toString() }, apy_bps: 0, t0 })]);

console.log("constituents…");
const assets = {};
for (const c of CONSTITUENTS) {
  const id = token(`darwin-${c.sym.toLowerCase()}`, c.name, c.sym, 0, market, ASSET_DEC);
  invoke(oracle, "set_feed", ["--token", id, "--feed", feedJson(c)]);
  invoke(market, "list", ["--token", id]);
  const price = BigInt(JSON.parse(invoke(oracle, "price", ["--token", id], false)));
  assets[c.sym] = { ...c, feed: c.feed.fixed != null ? { fixed: c.feed.fixed.toString() } : c.feed, id, decimals: ASSET_DEC, launchPrice: price.toString(), t0 };
  console.log(`    ${c.sym.padEnd(8)} $${(Number(price) / 1e14).toFixed(4)}`);
}

console.log(`seeding market reserve with Circle USDC (${SEED_ACCOUNTS} friendbot accounts)…`);
for (let k = 0; k < SEED_ACCOUNTS; k++) {
  const { kp, got } = await freshUsdcAccount(9_500);
  const base = BigInt(Math.floor(Number(got) * 0.995 * 1e7)); // leave the swap's rounding behind
  await transferUsdc(kp, market, base);
  console.log(`  +${(Number(base) / 1e7).toFixed(2)} USDC from ${kp.publicKey().slice(0, 8)}…`);
}
invoke(market, "sync");
console.log(`  reserve ${(Number(invoke(market, "reserve", [], false).replace(/"/g, "")) / 1e7).toFixed(2)} USDC`);

console.log("baskets…");
const baskets = [];
for (const b of BASKETS) {
  const syms = Object.keys(b.weights);
  // units per share: weight × launch NAV / price, in the constituent's base units
  const units = syms.map((s) => {
    const p = BigInt(assets[s].launchPrice);
    return ((BigInt(b.weights[s]) * LAUNCH_NAV_USD * 10n ** 14n * ASSET_ONE) / (10_000n * p)).toString();
  });
  const shares = token(`darwin-${b.symbol.toLowerCase()}-shares`, `Darwin ${b.name}`, b.symbol, 0);
  const vault = deploy(H.basket, `darwin-${b.symbol.toLowerCase()}`, [
    "--admin", admin, "--name", b.name, "--symbol", b.symbol, "--usdc", usdc, "--market", market,
    "--oracle", oracle, "--shares", shares,
    "--constituents", JSON.stringify(syms.map((s) => assets[s].id)),
    "--units", JSON.stringify(units), "--buy_fee_bps", "30", "--sell_fee_bps", "20",
  ]);
  invoke(shares, "set_admin", ["--new_admin", vault]);
  baskets.push({ ...b, vault, shares, constituents: syms.map((s, i) => ({ sym: s, token: assets[s].id, weightBps: b.weights[s], units: units[i] })) });
}

const out = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  deployedAt: new Date().toISOString(),
  admin,
  wasm: H,
  reflector: REFLECTOR,
  usdc,
  usdcIssuer: CIRCLE.issuer,
  oracle,
  market,
  assets,
  baskets,
};
for (const f of ["deployments/testnet.json", "web/src/config/testnet.json"]) {
  mkdirSync(dirname(join(ROOT, f)), { recursive: true });
  writeFileSync(join(ROOT, f), JSON.stringify(out, null, 2) + "\n");
  console.log(`→ ${f}`);
}
