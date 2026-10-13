#![no_std]
//! Darwin price adapter over Reflector (SEP-40).
//!
//! Every constituent token maps to a `Feed`:
//!   - `Reflector { oracle, asset }` — live Reflector price (crypto: CEX/DEX feed, FX + gold: fiat feed)
//!   - `Fixed(price)`                — a fixed USD reference (USD-denominated funds, test USDC)
//! plus an optional yield accrual (`apy_bps` since `t0`), which is how a tokenized bill / bond
//! behaves: CETES = MXN/USD × accrued index, TESOURO = BRL/USD × accrued index, etc.
//!
//! All prices come out in USD with 14 decimals (Reflector's native precision).

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
};

pub const PRICE_DECIMALS: u32 = 14;
const YEAR_SECS: i128 = 31_536_000;
const DAY_LEDGERS: u32 = 17_280;
const BUMP: u32 = 30 * DAY_LEDGERS;

// ── Reflector (SEP-40) interface ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "ReflectorClient")]
pub trait Reflector {
    fn lastprice(e: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(e: Env) -> u32;
}

// ── Darwin oracle ─────────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    UnknownToken = 1,
    NoPrice = 2,
    StalePrice = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Source {
    Reflector(Address, Asset),
    Fixed(i128),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Feed {
    pub source: Source,
    /// Annual yield accrued on top of the reference price, in bps (0 = spot asset).
    pub apy_bps: u32,
    /// Accrual start (unix seconds).
    pub t0: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    MaxAge,
    Feed(Address),
}

#[contract]
pub struct Oracle;

fn feed_of(e: &Env, token: &Address) -> Feed {
    match e.storage().persistent().get::<_, Feed>(&DataKey::Feed(token.clone())) {
        Some(f) => {
            e.storage().persistent().extend_ttl(&DataKey::Feed(token.clone()), BUMP - DAY_LEDGERS, BUMP);
            f
        }
        None => panic_with_error!(e, Error::UnknownToken),
    }
}

fn reference_price(e: &Env, src: &Source) -> (i128, u64) {
    match src {
        Source::Fixed(p) => (*p, e.ledger().timestamp()),
        Source::Reflector(oracle, asset) => {
            let r = ReflectorClient::new(e, oracle);
            let pd = match r.lastprice(asset) {
                Some(pd) => pd,
                None => panic_with_error!(e, Error::NoPrice),
            };
            let dec = r.decimals();
            let p = if dec >= PRICE_DECIMALS {
                pd.price / 10i128.pow(dec - PRICE_DECIMALS)
            } else {
                pd.price * 10i128.pow(PRICE_DECIMALS - dec)
            };
            (p, pd.timestamp)
        }
    }
}

fn accrue(e: &Env, price: i128, f: &Feed) -> i128 {
    if f.apy_bps == 0 {
        return price;
    }
    let now = e.ledger().timestamp();
    let dt = now.saturating_sub(f.t0) as i128;
    price * (YEAR_SECS * 10_000 + f.apy_bps as i128 * dt) / (YEAR_SECS * 10_000)
}

#[contractimpl]
impl Oracle {
    pub fn __constructor(e: Env, admin: Address, max_age_secs: u64) {
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::MaxAge, &max_age_secs);
    }

    pub fn admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_feed(e: Env, token: Address, feed: Feed) {
        Self::admin(e.clone()).require_auth();
        e.storage().instance().extend_ttl(BUMP - DAY_LEDGERS, BUMP);
        let key = DataKey::Feed(token);
        e.storage().persistent().set(&key, &feed);
        e.storage().persistent().extend_ttl(&key, BUMP - DAY_LEDGERS, BUMP);
    }

    pub fn set_max_age(e: Env, max_age_secs: u64) {
        Self::admin(e.clone()).require_auth();
        e.storage().instance().set(&DataKey::MaxAge, &max_age_secs);
    }

    pub fn feed(e: Env, token: Address) -> Feed {
        feed_of(&e, &token)
    }

    /// USD price of one whole `token` (14 decimals). Reverts on a stale feed.
    pub fn price(e: Env, token: Address) -> i128 {
        e.storage().instance().extend_ttl(BUMP - DAY_LEDGERS, BUMP);
        let f = feed_of(&e, &token);
        let (p, ts) = reference_price(&e, &f.source);
        let max_age: u64 = e.storage().instance().get(&DataKey::MaxAge).unwrap_or(3600);
        if e.ledger().timestamp() > ts + max_age {
            panic_with_error!(&e, Error::StalePrice);
        }
        if p <= 0 {
            panic_with_error!(&e, Error::NoPrice);
        }
        accrue(&e, p, &f)
    }

    pub fn decimals(_e: Env) -> u32 {
        PRICE_DECIMALS
    }
}

#[cfg(test)]
mod test;
