#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, token::StellarAssetClient, Env};

const P14: i128 = 100_000_000_000_000; // $1 at 14 dec
const ONE: i128 = 10_000_000; // 1 USDC (7 dec)
const T: i128 = 1_000_000_000_000; // 1 constituent (12 dec)

/// Fixed-price oracle: every token is worth `Price` USD (14 dec).
#[contract]
pub struct MockOracle;

#[contracttype]
enum MockKey {
    Price,
}

#[contractimpl]
impl MockOracle {
    pub fn set(e: Env, price: i128) {
        e.storage().instance().set(&MockKey::Price, &price);
    }
    pub fn price(e: Env, _token: Address) -> i128 {
        e.storage().instance().get(&MockKey::Price).unwrap()
    }
    pub fn decimals(_e: Env) -> u32 {
        14
    }
}

struct Setup {
    e: Env,
    usdc: Address,
    asset: Address,
    market: Address,
    m: MarketClient<'static>,
    o: MockOracleClient<'static>,
}

fn setup(price: i128) -> Setup {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let usdc = e.register_stellar_asset_contract_v2(admin.clone()).address();
    let oracle = e.register(MockOracle, ());
    let o = MockOracleClient::new(&e, &oracle);
    o.set(&price);
    let market = e.register(Market, (admin.clone(), usdc.clone(), oracle.clone(), 10u32));
    let m = MarketClient::new(&e, &market);
    // a 12-decimal constituent issued by the market (SAC with the market as admin)
    let sac = e.register_stellar_asset_contract_v2(market.clone());
    let asset = sac.address();
    m.list(&asset);
    StellarAssetClient::new(&e, &usdc).mint(&market, &(1_000_000 * ONE));
    m.sync();
    Setup { e, usdc, asset, market, m, o }
}

#[test]
fn buy_settles_the_delta_at_the_oracle_price() {
    let s = setup(2 * P14); // $2
    let user = Address::generate(&s.e);
    let usdc = TokenClient::new(&s.e, &s.usdc);
    StellarAssetClient::new(&s.e, &s.usdc).mint(&user, &(100 * ONE));
    assert_eq!(s.m.reserve(), 1_000_000 * ONE);

    usdc.transfer(&user, &s.market, &(100 * ONE));
    let quote = s.m.quote_buy(&s.asset, &(100 * ONE));
    let out = s.m.buy(&s.asset, &0, &user);
    assert_eq!(out, quote);
    // SACs have 7 decimals: 100 USDC / $2 = 50 tokens, minus 10 bps
    assert_eq!(out, 50 * ONE * 9_990 / 10_000);
    assert_eq!(TokenClient::new(&s.e, &s.asset).balance(&user), out);
    assert_eq!(s.m.reserve(), 1_000_100 * ONE);

    // nothing new paid → a second buy reverts
    assert_eq!(s.m.try_buy(&s.asset, &0, &user), Err(Ok(Error::NothingPaid.into())));
}

#[test]
fn sell_burns_and_pays_from_the_reserve() {
    let s = setup(2 * P14);
    let user = Address::generate(&s.e);
    StellarAssetClient::new(&s.e, &s.usdc).mint(&user, &(100 * ONE));
    TokenClient::new(&s.e, &s.usdc).transfer(&user, &s.market, &(100 * ONE));
    let got = s.m.buy(&s.asset, &0, &user);

    let a = TokenClient::new(&s.e, &s.asset);
    a.transfer(&user, &s.market, &got);
    let back = s.m.sell(&s.asset, &0, &user);
    // round trip pays the spread twice
    assert_eq!(back, got * 2 * 9_990 / 10_000);
    assert_eq!(a.balance(&s.market), 0, "sold tokens are burnt");
    assert_eq!(a.balance(&user), 0);
    assert_eq!(s.m.reserve(), 1_000_100 * ONE - back);
    assert_eq!(TokenClient::new(&s.e, &s.usdc).balance(&s.market), s.m.reserve());
}

#[test]
fn slippage_and_listing_are_enforced() {
    let s = setup(P14);
    let user = Address::generate(&s.e);
    StellarAssetClient::new(&s.e, &s.usdc).mint(&user, &(10 * ONE));
    TokenClient::new(&s.e, &s.usdc).transfer(&user, &s.market, &(10 * ONE));
    assert_eq!(s.m.try_buy(&s.asset, &(10 * ONE), &user), Err(Ok(Error::Slippage.into())));

    let other = s.e.register_stellar_asset_contract_v2(s.market.clone()).address();
    assert!(!s.m.is_listed(&other));
    assert_eq!(s.m.try_buy(&other, &0, &user), Err(Ok(Error::NotListed.into())));
    assert_eq!(s.m.try_quote_sell(&other, &ONE), Err(Ok(Error::NotListed.into())));
}

#[test]
fn sell_cannot_exceed_the_reserve() {
    let s = setup(P14);
    let user = Address::generate(&s.e);
    // the price jumps 10x after a buy: the position is now worth more than the whole reserve
    StellarAssetClient::new(&s.e, &s.usdc).mint(&user, &(1_000_000 * ONE));
    TokenClient::new(&s.e, &s.usdc).transfer(&user, &s.market, &(1_000_000 * ONE));
    let got = s.m.buy(&s.asset, &0, &user);
    s.o.set(&(10 * P14));
    TokenClient::new(&s.e, &s.asset).transfer(&user, &s.market, &got);
    assert_eq!(s.m.try_sell(&s.asset, &0, &user), Err(Ok(Error::InsufficientReserve.into())));
}

#[test]
fn large_amounts_do_not_overflow_with_12_decimals() {
    // pure math: 10M USDC into a 12-decimal $0.05 bond and back
    let usdc = 10_000_000 * ONE;
    let price = 5 * P14 / 100;
    let out = usdc_to_token(usdc, price, 14, 7, 12);
    assert_eq!(out, 200_000_000 * T);
    assert_eq!(token_to_usdc(out, price, 14, 7, 12), usdc);
    // and a $100k BTC leg keeps sub-cent precision for $1
    let btc = usdc_to_token(ONE, 100_000 * P14, 14, 7, 12);
    assert_eq!(btc, 10_000_000); // 1e-5 BTC in 12-dec units
}

#[test]
fn only_the_admin_lists_and_syncs() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let usdc = e.register_stellar_asset_contract_v2(admin.clone()).address();
    let oracle = e.register(MockOracle, ());
    let market = e.register(Market, (admin.clone(), usdc, oracle, 10u32));
    let m = MarketClient::new(&e, &market);
    let t = Address::generate(&e);
    assert!(m.try_list(&t).is_err());
    assert!(m.try_sync().is_err());
}

#[test]
fn admin_handover() {
    let s = setup(P14);
    let next = Address::generate(&s.e);
    s.m.set_admin(&next);
    assert_eq!(s.m.admin(), next);
    s.e.set_auths(&[]);
    assert!(s.m.try_set_admin(&next).is_err());
    assert!(s.m.try_list(&s.asset).is_err());
}
