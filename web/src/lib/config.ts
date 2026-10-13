import deployment from "../config/testnet.json";

export const DEPLOYMENT = deployment;
export const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC ?? deployment.rpcUrl;
export const PASSPHRASE = deployment.passphrase;
export const FRIENDBOT = "https://friendbot.stellar.org";
export const EXPLORER = "https://stellar.expert/explorer/testnet";

/** Every Darwin token (USDC, constituents, shares) uses 7 decimals, Stellar's native precision. */
export const DECIMALS = 7;
export const ONE = 10n ** BigInt(DECIMALS);
/** Oracle prices: USD with 14 decimals (Reflector precision). */
export const PRICE_DECIMALS = 14;

export const USDC = deployment.usdc;
