// Constituents + baskets. Each constituent is a testnet mirror of a real Stellar asset, priced
// on-chain from Reflector (crypto via the CEX/DEX feed, FX + gold via the fiat feed) plus the
// instrument's yield accrual for bills / bonds.
export const REFLECTOR = {
  crypto: "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63", // testnet: external CEXs & DEXs
  fiat: "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W", // testnet: fiat exchange rates
};

const USD = 100_000_000_000_000n; // $1 at 14 decimals

export const CONSTITUENTS = [
  // tokenized cash / T-bill funds
  { sym: "USDY", name: "Ondo US Dollar Yield", issuer: "Ondo Finance", kind: "T-bill note", feed: { fixed: (USD * 11n) / 10n }, apyBps: 450 },
  { sym: "BENJI", name: "Franklin OnChain US Gov Money Fund", issuer: "Franklin Templeton", kind: "Money market fund", feed: { fixed: USD }, apyBps: 410 },
  { sym: "EUTBL", name: "Spiko EU T-Bills Money Market Fund", issuer: "Spiko", kind: "Euro T-bills", feed: { fiat: "EUR" }, apyBps: 200 },
  // Etherfuse stablebonds
  { sym: "USTRY", name: "Etherfuse US Treasury Stablebond", issuer: "Etherfuse", kind: "US Treasury notes", feed: { fixed: USD }, apyBps: 400 },
  { sym: "GILTS", name: "Etherfuse UK Gilts Stablebond", issuer: "Etherfuse", kind: "UK government bonds", feed: { fiat: "GBP" }, apyBps: 420 },
  { sym: "CETES", name: "Etherfuse Mexican CETES Stablebond", issuer: "Etherfuse", kind: "Mexican T-bills", feed: { fiat: "MXN" }, apyBps: 900 },
  { sym: "TESOURO", name: "Etherfuse Brazil Tesouro Stablebond", issuer: "Etherfuse", kind: "Brazilian T-bills", feed: { fiat: "BRL" }, apyBps: 1400 },
  // hard assets + crypto
  { sym: "GOLD", name: "Tokenized Gold (1 oz)", issuer: "Reflector XAU", kind: "Gold", feed: { fiat: "XAU" }, apyBps: 0 },
  { sym: "BTC", name: "Bitcoin", issuer: "Reflector BTC", kind: "Crypto", feed: { crypto: "BTC" }, apyBps: 0 },
  { sym: "ETH", name: "Ethereum", issuer: "Reflector ETH", kind: "Crypto", feed: { crypto: "ETH" }, apyBps: 0 },
  { sym: "XLM", name: "Stellar Lumens", issuer: "Reflector XLM", kind: "Crypto", feed: { crypto: "XLM" }, apyBps: 0 },
];

export const BASKETS = [
  {
    symbol: "DXTB", name: "Global T-Bills",
    description: "Tokenized government cash: Ondo USDY, Franklin BENJI, Spiko euro T-bills and UK gilts.",
    weights: { USDY: 3000, BENJI: 2500, EUTBL: 2500, GILTS: 2000 },
  },
  {
    symbol: "DXEM", name: "Emerging Yield",
    description: "High-yield LatAm sovereign debt: Mexican CETES and Brazilian Tesouro stablebonds.",
    weights: { CETES: 5000, TESOURO: 5000 },
  },
  {
    symbol: "DXBC", name: "Blue Chip",
    description: "The crypto blue chips plus Stellar's own: Bitcoin, Ethereum and XLM.",
    weights: { BTC: 5000, ETH: 3000, XLM: 2000 },
  },
  {
    symbol: "DXAW", name: "All-Weather",
    description: "Treasuries, gold, Bitcoin, euro bills and CETES: one token for every regime.",
    weights: { USTRY: 3000, GOLD: 2500, BTC: 2000, EUTBL: 1500, CETES: 1000 },
  },
];

export const LAUNCH_NAV_USD = 1n; // every basket token launches at $1 (the index, base 100, is the track record)
