#![cfg(test)]
extern crate std;
use super::*;
use darwin_market::{Market, MarketClient as MClient};
use darwin_oracle::{Feed, Oracle, OracleClient as OClient, Source};
use darwin_token::{Token, TokenClient as TClient};
use soroban_sdk::{testutils::Address as _, vec, Env, String};

const P: i128 = 100_000_000_000_000; // $1 at 14 dec
const ONE: i128 = 10_000_000; // 7-dec unit

fn tok_dec(e: &Env, admin: &Address, sym: &str, faucet: i128, dec: u32) -> Address {
    e.register(Token, (admin.clone(), dec, String::from_str(e, sym), String::from_str(e, sym), faucet))
}
fn tok(e: &Env, admin: &Address, sym: &str, faucet: i128) -> Address {
    tok_dec(e, admin, sym, faucet, 7)
}
const T: i128 = 1_000_000_000_000; // 12-dec constituent unit

#[test]
fn buy_then_sell_round_trip() {
    let e = Env::default();
    e.mock_all_auths();
    e.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&e);
    let user = Address::generate(&e);

    let usdc = tok(&e, &admin, "USDC", 1_000 * ONE);
    let oracle = e.register(Oracle, (admin.clone(), 3600u64));
    let o = OClient::new(&e, &oracle);
    let market = e.register(Market, (admin.clone(), usdc.clone(), oracle.clone(), 10u32));
    let m = MClient::new(&e, &market);

    // three legs: $50 000 (BTC-like), $2 (bond-like), $1 (USD fund)
    let prices = [50_000 * P, 2 * P, P];
    let mut legs = vec![&e];
    for (i, p) in prices.iter().enumerate() {
        let t = tok_dec(&e, &market, ["A", "B", "C"][i], 0, 12);
        o.set_feed(&t, &Feed { source: Source::Fixed(*p), apy_bps: 0, t0: 0 });
        m.list(&t);
        legs.push_back(t);
    }
    o.set_feed(&usdc, &Feed { source: Source::Fixed(P), apy_bps: 0, t0: 0 });

    // seed market reserve
    TClient::new(&e, &usdc).mint(&market, &(1_000_000 * ONE));
    m.sync();

    // $1 / share at 50/30/20 (12-dec constituents keep the BTC leg precise)
    let units = vec![&e, T / 2 / 50_000, 3 * T / 10 / 2, T / 5];
    let shares_tok = tok(&e, &admin, "DXT", 0);
    let basket = e.register(
        Basket,
        (
            admin.clone(), String::from_str(&e, "Test"), String::from_str(&e, "DXT"),
            usdc.clone(), market.clone(), oracle.clone(), shares_tok.clone(),
            legs.clone(), units.clone(), 30u32, 20u32,
        ),
    );
    TClient::new(&e, &shares_tok).set_admin(&basket);
    let b = BasketClient::new(&e, &basket);

    let u = TClient::new(&e, &usdc);
    u.faucet(&user); // 1000 USDC
    let shares = b.buy(&user, &(1_000 * ONE), &0);
    // 1000 − 0.3% fee − 0.1% spread ≈ 996 shares at $1
    std::println!("shares {shares}");
    assert!(shares > 995 * ONE && shares < 997 * ONE, "{shares}");
    let nav = b.nav();
    std::println!("nav/share {} tvl {} w {:?}", nav.nav_per_share, nav.tvl, nav.weights_bps);
    assert_eq!(nav.weights_bps, vec![&e, 5000u32, 3000, 2000]);
    assert_eq!(u.balance(&admin), 3 * ONE); // buy fee

    assert_eq!(nav.nav_per_share / 1000, ONE / 1000); // ≈ $1.000

    // a whale-size buy must not overflow
    TClient::new(&e, &usdc).mint(&user, &(5_000_000 * ONE));
    let big = b.buy(&user, &(5_000_000 * ONE), &0);
    assert!(big > 4_970_000 * ONE);
    b.sell(&user, &big, &0);

    let out = b.sell(&user, &shares, &0);
    std::println!("usdc back {out}");
    // ≈ 1000 × (1−.003)(1−.001)(1−.001)(1−.002) ≈ 993.0
    assert!(out > 992 * ONE && out < 994 * ONE, "{out}");
    assert_eq!(TClient::new(&e, &shares_tok).total_supply(), 0);
    for t in legs.iter() {
        assert!(TClient::new(&e, &t).balance(&basket) < 1_000, "dust only");
    }
}
