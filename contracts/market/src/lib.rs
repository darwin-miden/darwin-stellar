#![no_std]
//! Darwin testnet market — liquidity for the tokenized constituents.
//!
//! Issues and redeems constituent tokens against USDC at the Darwin oracle price (Reflector
//! under the hood) with a small spread. The market is the token admin of every listed
//! constituent, so a buy mints and a sell burns: there is always depth, at the oracle price.
//! On mainnet this leg is replaced by real venues (Stellar DEX path payments, Soroswap,
//! Aquarius) for the issuers' actual assets (USDY, BENJI, CETES, …).
//!
//! Payment is pull-free: the caller transfers USDC (or the constituent) to the market in the
//! same transaction, then calls `buy` / `sell`, which settles the delta over the tracked
//! reserve. That keeps the router a plain sequence of transfers + calls, no nested auth.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, token::TokenClient,
    Address, BytesN, ContractExecutable, Env,
};

const DAY_LEDGERS: u32 = 17_280;
const BUMP: u32 = 30 * DAY_LEDGERS;
const BPS: i128 = 10_000;

#[contractclient(name = "OracleClient")]
pub trait OracleApi {
    fn price(e: Env, token: Address) -> i128;
    fn decimals(e: Env) -> u32;
}

#[contractclient(name = "MintableClient")]
pub trait Mintable {
    fn mint(e: Env, to: Address, amount: i128);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotListed = 1,
    NothingPaid = 2,
    Slippage = 3,
    InsufficientReserve = 4,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Usdc,
    Oracle,
    SpreadBps,
    Reserve,
    Listed(Address),
}

#[contract]
pub struct Market;

fn get<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(e: &Env, k: &DataKey) -> T {
    e.storage().instance().get(k).unwrap()
}

fn bump(e: &Env) {
    e.storage().instance().extend_ttl(BUMP - DAY_LEDGERS, BUMP);
}

fn require_listed(e: &Env, token: &Address) {
    let key = DataKey::Listed(token.clone());
    if !e.storage().persistent().get::<_, bool>(&key).unwrap_or(false) {
        panic_with_error!(e, Error::NotListed);
    }
    e.storage().persistent().extend_ttl(&key, BUMP - DAY_LEDGERS, BUMP);
}

fn pow10(n: u32) -> i128 {
    10i128.pow(n)
}

/// USDC base units → token base units at `price` (USD × 10^pdec per whole token), before spread.
/// Ordered so nothing overflows i128 for 12-decimal tokens and 10M+ USDC (see tests).
fn usdc_to_token(usdc: i128, price: i128, pdec: u32, udec: u32, tdec: u32) -> i128 {
    if tdec >= udec {
        usdc * pow10(tdec - udec) * pow10(pdec) / price
    } else {
        usdc * pow10(pdec) / price / pow10(udec - tdec)
    }
}

fn token_to_usdc(amount: i128, price: i128, pdec: u32, udec: u32, tdec: u32) -> i128 {
    if tdec >= udec {
        amount * price / pow10(pdec) / pow10(tdec - udec)
    } else {
        amount * price * pow10(udec - tdec) / pow10(pdec)
    }
}

impl Market {
    fn quote(e: &Env, token: &Address, amount: i128, buy: bool) -> i128 {
        require_listed(e, token);
        let usdc: Address = get(e, &DataKey::Usdc);
        let oracle = OracleClient::new(e, &get::<Address>(e, &DataKey::Oracle));
        let price = oracle.price(token);
        let pdec = oracle.decimals();
        let udec = TokenClient::new(e, &usdc).decimals();
        let tdec = TokenClient::new(e, token).decimals();
        let spread: u32 = get(e, &DataKey::SpreadBps);
        let gross = if buy {
            usdc_to_token(amount, price, pdec, udec, tdec)
        } else {
            token_to_usdc(amount, price, pdec, udec, tdec)
        };
        gross * (BPS - spread as i128) / BPS
    }
}

#[contractimpl]
impl Market {
    pub fn __constructor(e: Env, admin: Address, usdc: Address, oracle: Address, spread_bps: u32) {
        let s = e.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Usdc, &usdc);
        s.set(&DataKey::Oracle, &oracle);
        s.set(&DataKey::SpreadBps, &spread_bps);
        s.set(&DataKey::Reserve, &0i128);
    }

    pub fn admin(e: Env) -> Address {
        get(&e, &DataKey::Admin)
    }

    pub fn set_admin(e: Env, new_admin: Address) {
        Self::admin(e.clone()).require_auth();
        e.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn upgrade(e: Env, wasm_hash: BytesN<32>) {
        Self::admin(e.clone()).require_auth();
        e.deployer().update_current_contract(ContractExecutable::Wasm(wasm_hash));
    }

    pub fn usdc(e: Env) -> Address {
        get(&e, &DataKey::Usdc)
    }

    pub fn oracle(e: Env) -> Address {
        get(&e, &DataKey::Oracle)
    }

    pub fn reserve(e: Env) -> i128 {
        get(&e, &DataKey::Reserve)
    }

    pub fn spread_bps(e: Env) -> u32 {
        get(&e, &DataKey::SpreadBps)
    }

    /// List a constituent. The market must already be that token's admin.
    pub fn list(e: Env, token: Address) {
        Self::admin(e.clone()).require_auth();
        bump(&e);
        let key = DataKey::Listed(token);
        e.storage().persistent().set(&key, &true);
        e.storage().persistent().extend_ttl(&key, BUMP - DAY_LEDGERS, BUMP);
    }

    pub fn is_listed(e: Env, token: Address) -> bool {
        e.storage().persistent().get::<_, bool>(&DataKey::Listed(token)).unwrap_or(false)
    }

    /// Count USDC sent to the market outside buy/sell (seed liquidity) as reserve.
    pub fn sync(e: Env) {
        Self::admin(e.clone()).require_auth();
        bump(&e);
        let usdc: Address = get(&e, &DataKey::Usdc);
        let bal = TokenClient::new(&e, &usdc).balance(&e.current_contract_address());
        e.storage().instance().set(&DataKey::Reserve, &bal);
    }

    pub fn quote_buy(e: Env, token: Address, usdc_in: i128) -> i128 {
        Self::quote(&e, &token, usdc_in, true)
    }

    pub fn quote_sell(e: Env, token: Address, amount_in: i128) -> i128 {
        Self::quote(&e, &token, amount_in, false)
    }

    /// Buy `token` with the USDC transferred to the market since the last settlement.
    pub fn buy(e: Env, token: Address, min_out: i128, to: Address) -> i128 {
        bump(&e);
        let usdc: Address = get(&e, &DataKey::Usdc);
        let me = e.current_contract_address();
        let reserve: i128 = get(&e, &DataKey::Reserve);
        let bal = TokenClient::new(&e, &usdc).balance(&me);
        let paid = bal - reserve;
        if paid <= 0 {
            panic_with_error!(&e, Error::NothingPaid);
        }
        let out = Self::quote(&e, &token, paid, true);
        if out < min_out || out <= 0 {
            panic_with_error!(&e, Error::Slippage);
        }
        e.storage().instance().set(&DataKey::Reserve, &bal);
        MintableClient::new(&e, &token).mint(&to, &out);
        out
    }

    /// Sell the `token` balance transferred to the market for USDC, paid to `to`.
    pub fn sell(e: Env, token: Address, min_out: i128, to: Address) -> i128 {
        bump(&e);
        let me = e.current_contract_address();
        let t = TokenClient::new(&e, &token);
        let amount = t.balance(&me);
        if amount <= 0 {
            panic_with_error!(&e, Error::NothingPaid);
        }
        let out = Self::quote(&e, &token, amount, false);
        if out < min_out {
            panic_with_error!(&e, Error::Slippage);
        }
        let reserve: i128 = get(&e, &DataKey::Reserve);
        if out > reserve {
            panic_with_error!(&e, Error::InsufficientReserve);
        }
        t.burn(&me, &amount);
        e.storage().instance().set(&DataKey::Reserve, &(reserve - out));
        let usdc: Address = get(&e, &DataKey::Usdc);
        TokenClient::new(&e, &usdc).transfer(&me, &to, &out);
        out
    }
}

#[cfg(test)]
mod test;
