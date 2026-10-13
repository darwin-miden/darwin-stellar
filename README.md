# Darwin on Stellar

**One token, a whole strategy.** Darwin baskets are tokens backed by fixed units of tokenized real-world assets and crypto on Stellar: US and euro T-bills, UK gilts, Mexican CETES, Brazilian Tesouro, gold, BTC, ETH, XLM. Spend USDC once and the vault buys every constituent in **a single Soroban transaction**. Sell, and you get your pro-rata slice of every leg back as USDC.

Prices are read **on-chain from [Reflector](https://reflector.network)** (SEP-40): crypto from the CEX/DEX feed, FX + gold from the fiat feed. Tokenized bills and bonds are priced as `FX rate × accrued yield index`, which is how a stablebond actually behaves.

Live on **Stellar testnet** (protocol 29).

## Baskets

Every basket token launched at **$1**. The number shown on each basket is an **index** (base 100 on 1 July 2026): the basket's fixed units priced at market rates over time, i.e. its track record. What one token is backed by (vault value / supply) is read on-chain in the trade card.

| Basket | Symbol | Composition |
| --- | --- | --- |
| Global T-Bills | `DXTB` | Ondo USDY 30 · Franklin BENJI 25 · Spiko EUTBL 25 · Etherfuse GILTS 20 |
| Emerging Yield | `DXEM` | Etherfuse CETES 50 · Etherfuse TESOURO 50 |
| Blue Chip | `DXBC` | BTC 50 · ETH 30 · XLM 20 |
| All-Weather | `DXAW` | USTRY 30 · Gold 25 · BTC 20 · EUTBL 15 · CETES 10 |

The constituents mirror assets that are live on Stellar mainnet (Ondo USDY, Franklin Templeton BENJI, Spiko euro T-bills, the Etherfuse stablebonds). On testnet each one is a Darwin SEP-41 token (12 decimals) issued by the market at its oracle price:

| Token | Reference price (on-chain) | Accrual |
| --- | --- | --- |
| USDY | $1.10 fixed | 4.5% APY |
| BENJI | $1.00 fixed | 4.1% APY |
| EUTBL | Reflector `EUR` | 2.0% APY |
| USTRY | $1.00 fixed | 4.0% APY |
| GILTS | Reflector `GBP` | 4.2% APY |
| CETES | Reflector `MXN` | 9.0% APY |
| TESOURO | Reflector `BRL` | 14.0% APY |
| GOLD | Reflector `XAU` | — |
| BTC / ETH / XLM | Reflector CEX/DEX feed | — |

## How it works

```
             USDC                                      shares (SEP-41)
  user ───────────────▶ Basket vault ─── mint ──────▶ user
                          │   ▲  holds every constituent, fixed units per share
           USDC per leg   │   │  constituent tokens
                          ▼   │
                        Market ◀── price ── Darwin oracle ◀── Reflector (crypto + FX + XAU)
```

| Contract | Role |
| --- | --- |
| `basket` | The vault. `buy(user, usdc_in, min_shares)`: splits USDC across legs by live value, buys each leg on the market, mints shares on the scarcest leg (rounded down). `sell(user, shares, min_usdc)`: burns shares, sells the pro-rata slice of every leg (rounded down). `nav()`: NAV/share, TVL, supply, prices, holdings, live weights in one read. |
| `oracle` | Darwin price adapter over Reflector. Per-token feed: Reflector asset or fixed USD reference, plus a yield accrual (`apy_bps` since `t0`). Rejects stale prices (> 1h). USD, 14 decimals. |
| `market` | Testnet liquidity: issues and burns constituents against USDC at the oracle price with a 10 bps spread. Settles on the delta over its tracked reserve, so the vault just transfers then calls, without nested auth. On mainnet this leg routes to real venues (Stellar DEX path payments, Soroswap, Aquarius) for the issuers' actual assets. |
| `token` | SEP-41 token used for shares, constituents and test USDC (with a public 1,000 USDC / hour faucet). |

**Backing invariant:** `holdings[i] ≥ units[i] × supply / 1e7` for every leg, by construction (mint rounds down on the scarcest leg, redeem is pro-rata, rounded down).

**One signature per trade:** the user is the transaction source, so every `require_auth` in the call tree (USDC transfer in, share burn) is covered by the single transaction signature.

### Fees

| Fee | Buy | Sell |
| --- | --- | --- |
| Protocol | 30 bps | 20 bps |
| Market spread | 10 bps | 10 bps |

## Deployments (Stellar testnet)

| Contract | Address |
| --- | --- |
| Test USDC | [`CBU5AHUX…HYF23I`](https://stellar.expert/explorer/testnet/contract/CBU5AHUXRIZNARUYBWJ7WTQH42FFEB4KY6PT2CA2XNWCPI5IH7HYF23I) |
| Oracle | [`CDQRPS52…F6FVRS`](https://stellar.expert/explorer/testnet/contract/CDQRPS52N4MBQAFA6FYC4K4PRGFWCPWE5CI7IJZL6UHWI66PDUF6FVRS) |
| Market | [`CA4ZGEKF…SB4S6O`](https://stellar.expert/explorer/testnet/contract/CA4ZGEKFNT342QC5M6XRQDDPG5MVT5TIUPGI46TVXIBNDK7KXXSB4S6O) |
| DXTB vault | [`CBWS4NDQ…S3BVRM`](https://stellar.expert/explorer/testnet/contract/CBWS4NDQGNHCRXKSIUZHGKSWX4ETQZQOZ2HR2F2D5ZXCHL52FYS3BVRM) |
| DXEM vault | [`CDORJ6HI…7ALWHP`](https://stellar.expert/explorer/testnet/contract/CDORJ6HIZIJK5P6KD3PMG2NHGDZ6CUCGUN3FS7D6QHMS7EI3O67ALWHP) |
| DXBC vault | [`CBTPXZE6…DDQOJA`](https://stellar.expert/explorer/testnet/contract/CBTPXZE6YGA5QAXNS7RGY33ZI4KFZ4UJK4XY2L63KGPADDVP76DDQOJA) |
| DXAW vault | [`CDCFIAN5…324NZ6`](https://stellar.expert/explorer/testnet/contract/CDCFIAN5SNMWCVN46HVWGDXTUU77RMJ43B7OZXY32W7UWU7L2K324NZ6) |

Every address (constituents, share tokens, units per share, launch prices): [`deployments/testnet.json`](deployments/testnet.json).

## Repo layout

```
contracts/   Soroban workspace: token, oracle, market, basket (+ tests)
scripts/     catalog.mjs (assets + baskets), deploy.mjs (full testnet deploy)
web/         Next.js app (same front as app.darwin.market): hero, Explore baskets, basket screen with index chart, trade card, portfolio, activity
deployments/ testnet.json
```

## Run it

```bash
# contracts
cd contracts && cargo test && stellar contract build

# deploy everything to testnet (needs a funded identity, default `darwin-stellar-admin`)
stellar keys generate darwin-stellar-admin --network testnet --fund
node scripts/deploy.mjs      # writes deployments/testnet.json + web/src/config/testnet.json

# app
cd web && npm install && npm run dev   # http://localhost:3050
```

The index charts draw each constituent's history (Yahoo: BTC-USD, GC=F, EURUSD=X, MXNUSD=X…, served by `/api/history`) × the instrument's yield index, exactly as the oracle prices it on-chain.

In the app, connect any Stellar wallet (Freighter, xBull, Lobstr, Albedo, Hana, Rabet… through the Stellar Wallets Kit) or **try with a demo wallet** (an in-browser testnet key, funded by friendbot). Then open Deposit → *Claim 1,000 test USDC* and buy a basket.

## End-to-end check

`node scripts/e2e.mjs` runs against the live testnet deployment: fresh accounts from friendbot, real signatures, real Reflector prices. 104 checks, all green:

- **Wiring**: every constituent's admin is the market and it is listed; every share token's admin is its vault; fees are 30 / 20 bps.
- **Oracle**: each price equals the Reflector feed (or the fixed reference) × its yield index, and the feed is fresh.
- **Faucet + permissions**: 1,000 USDC claim, hourly cooldown, nobody else can mint USDC or a constituent.
- **Per basket** (buy 200 USDC, sell 50%, sell the rest): the minted amount equals the dry-run quote and `200 × (1−0.30%) × (1−0.10%) / NAV`; **one transaction mints every leg into the vault** (read from the tx events); exactly 0.60 USDC fee and +199.40 USDC market reserve; the backing invariant holds on every leg; NAV is unchanged by a trade; a min-out above the quote reverts; a third party can't sell someone else's shares; overselling reverts; the round trip costs 69 bps (30 + 20 fees, 10 + 10 spread).

## Roadmap

- Mainnet routing to the issuers' real assets through Stellar DEX path payments / Soroswap / Aquarius.
- Permissionless basket factory (any creator, allowlisted constituents, owner fee).
- Confidential positions, as on the Miden version of Darwin, using Stellar's BN254 + Poseidon host functions for ZK proofs.
