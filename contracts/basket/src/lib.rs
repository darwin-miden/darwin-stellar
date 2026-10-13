#![no_std]
//! Darwin basket vault.
//!
//! A basket is a fixed quantity of every constituent per share (`units[i]` base units per one
//! whole share). One `buy` turns USDC into the whole portfolio in a single transaction: the
//! vault splits the USDC across the legs by their live value, buys every leg on the market,
//! and mints shares against what it received. `sell` burns shares, sells the holder's pro-rata
//! slice of every leg and pays USDC back. No rebalancing, no manager discretion:
//! NAV = Σ holdings × oracle price.
//!
//! Backing invariant: holdings[i] ≥ units[i] × supply / SHARE_UNIT — shares are minted on the
//! scarcest leg (rounded down) and redemptions are pro-rata (rounded down).

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, token::TokenClient,
    Address, Env, String, Vec,
};

const DAY_LEDGERS: u32 = 17_280;
const BUMP: u32 = 30 * DAY_LEDGERS;
const BPS: i128 = 10_000;
const MAX_FEE_BPS: u32 = 200;

#[contractclient(name = "OracleClient")]
pub trait OracleApi {
    fn price(e: Env, token: Address) -> i128;
    fn decimals(e: Env) -> u32;
}

#[contractclient(name = "MarketClient")]
pub trait MarketApi {
    fn buy(e: Env, token: Address, min_out: i128, to: Address) -> i128;
    fn sell(e: Env, token: Address, min_out: i128, to: Address) -> i128;
}

#[contractclient(name = "SharesClient")]
pub trait SharesApi {
    fn mint(e: Env, to: Address, amount: i128);
    fn total_supply(e: Env) -> i128;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    BadConfig = 1,
    ZeroAmount = 2,
    Slippage = 3,
    NoSupply = 4,
    FeeTooHigh = 5,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Fees,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    pub admin: Address,
    pub name: String,
    pub symbol: String,
    pub usdc: Address,
    pub market: Address,
    pub oracle: Address,
    pub shares: Address,
    pub constituents: Vec<Address>,
    pub units: Vec<i128>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Fees {
    pub buy_bps: u32,
    pub sell_bps: u32,
    pub fee_to: Address,
}

/// Everything the app needs in one read.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Nav {
    /// USDC base units per whole share.
    pub nav_per_share: i128,
    /// Total vault value in USDC base units.
    pub tvl: i128,
    pub supply: i128,
    pub prices: Vec<i128>,
    pub holdings: Vec<i128>,
    /// Live weight of each leg in bps (from units × price).
    pub weights_bps: Vec<u32>,
}

#[contract]
pub struct Basket;

fn pow10(n: u32) -> i128 {
    10i128.pow(n)
}

fn cfg(e: &Env) -> Config {
    e.storage().instance().get(&DataKey::Config).unwrap()
}

fn fees(e: &Env) -> Fees {
    e.storage().instance().get(&DataKey::Fees).unwrap()
}

fn bump(e: &Env) {
    e.storage().instance().extend_ttl(BUMP - DAY_LEDGERS, BUMP);
}

/// USDC value (base units) of `amount` base units of a token.
/// Ordered so nothing overflows i128 for 12-decimal tokens (amount × price ≤ ~1e34).
fn value(amount: i128, price: i128, pdec: u32, udec: u32, tdec: u32) -> i128 {
    if tdec >= udec {
        amount * price / pow10(pdec) / pow10(tdec - udec)
    } else {
        amount * price * pow10(udec - tdec) / pow10(pdec)
    }
}

struct Legs {
    prices: Vec<i128>,
    tdecs: Vec<u32>,
    pdec: u32,
    udec: u32,
}

fn legs(e: &Env, c: &Config) -> Legs {
    let oracle = OracleClient::new(e, &c.oracle);
    let mut prices = Vec::new(e);
    let mut tdecs = Vec::new(e);
    for t in c.constituents.iter() {
        prices.push_back(oracle.price(&t));
        tdecs.push_back(TokenClient::new(e, &t).decimals());
    }
    Legs { prices, tdecs, pdec: oracle.decimals(), udec: TokenClient::new(e, &c.usdc).decimals() }
}

#[contractimpl]
impl Basket {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        e: Env,
        admin: Address,
        name: String,
        symbol: String,
        usdc: Address,
        market: Address,
        oracle: Address,
        shares: Address,
        constituents: Vec<Address>,
        units: Vec<i128>,
        buy_fee_bps: u32,
        sell_fee_bps: u32,
    ) {
        if constituents.is_empty() || constituents.len() != units.len() || constituents.len() > 16 {
            panic_with_error!(&e, Error::BadConfig);
        }
        for u in units.iter() {
            if u <= 0 {
                panic_with_error!(&e, Error::BadConfig);
            }
        }
        if buy_fee_bps > MAX_FEE_BPS || sell_fee_bps > MAX_FEE_BPS {
            panic_with_error!(&e, Error::FeeTooHigh);
        }
        let fee_to = admin.clone();
        e.storage().instance().set(
            &DataKey::Config,
            &Config { admin, name, symbol, usdc, market, oracle, shares, constituents, units },
        );
        e.storage().instance().set(&DataKey::Fees, &Fees { buy_bps: buy_fee_bps, sell_bps: sell_fee_bps, fee_to });
    }

    pub fn config(e: Env) -> Config {
        cfg(&e)
    }

    pub fn fees(e: Env) -> Fees {
        fees(&e)
    }

    pub fn set_fees(e: Env, buy_bps: u32, sell_bps: u32, fee_to: Address) {
        cfg(&e).admin.require_auth();
        if buy_bps > MAX_FEE_BPS || sell_bps > MAX_FEE_BPS {
            panic_with_error!(&e, Error::FeeTooHigh);
        }
        bump(&e);
        e.storage().instance().set(&DataKey::Fees, &Fees { buy_bps, sell_bps, fee_to });
    }

    pub fn nav(e: Env) -> Nav {
        let c = cfg(&e);
        let l = legs(&e, &c);
        let me = e.current_contract_address();
        let share_unit = pow10(TokenClient::new(&e, &c.shares).decimals());
        let supply = SharesClient::new(&e, &c.shares).total_supply();
        let mut holdings = Vec::new(&e);
        let mut per_share_vals = Vec::new(&e);
        let mut nav_per_share = 0i128;
        let mut tvl = 0i128;
        for i in 0..c.constituents.len() {
            let t = c.constituents.get(i).unwrap();
            let p = l.prices.get(i).unwrap();
            let td = l.tdecs.get(i).unwrap();
            let h = TokenClient::new(&e, &t).balance(&me);
            holdings.push_back(h);
            tvl += value(h, p, l.pdec, l.udec, td);
            let v = value(c.units.get(i).unwrap(), p, l.pdec, l.udec, td);
            per_share_vals.push_back(v);
            nav_per_share += v;
        }
        // Once shares exist, NAV per share is the real backing (dust included).
        if supply > 0 {
            nav_per_share = tvl * share_unit / supply;
        }
        let total: i128 = per_share_vals.iter().sum();
        let mut weights_bps = Vec::new(&e);
        for v in per_share_vals.iter() {
            weights_bps.push_back(if total > 0 { (v * BPS / total) as u32 } else { 0 });
        }
        Nav { nav_per_share, tvl, supply, prices: l.prices, holdings, weights_bps }
    }

    /// USDC → the whole basket, in one transaction. Returns shares minted.
    pub fn buy(e: Env, user: Address, usdc_in: i128, min_shares: i128) -> i128 {
        user.require_auth();
        if usdc_in <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        bump(&e);
        let c = cfg(&e);
        let f = fees(&e);
        let me = e.current_contract_address();
        let usdc = TokenClient::new(&e, &c.usdc);
        usdc.transfer(&user, &me, &usdc_in);

        let fee = usdc_in * f.buy_bps as i128 / BPS;
        if fee > 0 {
            usdc.transfer(&me, &f.fee_to, &fee);
        }
        let net = usdc_in - fee;

        // Split by each leg's live value per share.
        let l = legs(&e, &c);
        let mut vals = Vec::new(&e);
        let mut total = 0i128;
        for i in 0..c.constituents.len() {
            let v = value(c.units.get(i).unwrap(), l.prices.get(i).unwrap(), l.pdec, l.udec, l.tdecs.get(i).unwrap());
            vals.push_back(v);
            total += v;
        }
        if total <= 0 {
            panic_with_error!(&e, Error::BadConfig);
        }

        let market = MarketClient::new(&e, &c.market);
        let share_unit = pow10(TokenClient::new(&e, &c.shares).decimals());
        let n = c.constituents.len();
        let mut spent = 0i128;
        let mut shares = i128::MAX;
        for i in 0..n {
            let leg = if i + 1 == n { net - spent } else { net * vals.get(i).unwrap() / total };
            spent += leg;
            if leg <= 0 {
                panic_with_error!(&e, Error::ZeroAmount);
            }
            usdc.transfer(&me, &c.market, &leg);
            let out = market.buy(&c.constituents.get(i).unwrap(), &0, &me);
            let s = out * share_unit / c.units.get(i).unwrap();
            if s < shares {
                shares = s;
            }
        }
        if shares <= 0 || shares < min_shares {
            panic_with_error!(&e, Error::Slippage);
        }
        SharesClient::new(&e, &c.shares).mint(&user, &shares);
        shares
    }

    /// Burn shares → the holder's pro-rata slice of every leg, sold for USDC. Returns USDC paid.
    pub fn sell(e: Env, user: Address, shares: i128, min_usdc: i128) -> i128 {
        user.require_auth();
        if shares <= 0 {
            panic_with_error!(&e, Error::ZeroAmount);
        }
        bump(&e);
        let c = cfg(&e);
        let f = fees(&e);
        let me = e.current_contract_address();
        let supply = SharesClient::new(&e, &c.shares).total_supply();
        if supply <= 0 {
            panic_with_error!(&e, Error::NoSupply);
        }
        TokenClient::new(&e, &c.shares).burn(&user, &shares);

        let market = MarketClient::new(&e, &c.market);
        let mut got = 0i128;
        for t in c.constituents.iter() {
            let tok = TokenClient::new(&e, &t);
            let amt = tok.balance(&me) * shares / supply;
            if amt > 0 {
                tok.transfer(&me, &c.market, &amt);
                got += market.sell(&t, &0, &me);
            }
        }
        let usdc = TokenClient::new(&e, &c.usdc);
        let fee = got * f.sell_bps as i128 / BPS;
        if fee > 0 {
            usdc.transfer(&me, &f.fee_to, &fee);
        }
        let out = got - fee;
        if out < min_usdc {
            panic_with_error!(&e, Error::Slippage);
        }
        usdc.transfer(&me, &user, &out);
        out
    }
}

#[cfg(test)]
mod test;
