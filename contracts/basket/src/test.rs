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

struct World {
    e: Env,
    admin: Address,
    usdc: Address,
    oracle: Address,
    shares: Address,
    legs: Vec<Address>,
    basket: Address,
}

/// Two legs at $50 000 and $1, $1 per share at 60/40.
fn world() -> World {
    let e = Env::default();
    e.mock_all_auths();
    e.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&e);
    let usdc = tok(&e, &admin, "USDC", 1_000 * ONE);
    let oracle = e.register(Oracle, (admin.clone(), 3600u64));
    let o = OClient::new(&e, &oracle);
    let market = e.register(Market, (admin.clone(), usdc.clone(), oracle.clone(), 10u32));
    let m = MClient::new(&e, &market);
    let mut legs = vec![&e];
    for (i, p) in [50_000 * P, P].iter().enumerate() {
        let t = tok_dec(&e, &market, ["X", "Y"][i], 0, 12);
        o.set_feed(&t, &Feed { source: Source::Fixed(*p), apy_bps: 0, t0: 0 });
        m.list(&t);
        legs.push_back(t);
    }
    TClient::new(&e, &usdc).mint(&market, &(10_000_000 * ONE));
    m.sync();
    let shares = tok(&e, &admin, "DXT", 0);
    let units = vec![&e, 6 * T / 10 / 50_000, 4 * T / 10];
    let basket = e.register(
        Basket,
        (
            admin.clone(), String::from_str(&e, "Test"), String::from_str(&e, "DXT"),
            usdc.clone(), market.clone(), oracle.clone(), shares.clone(),
            legs.clone(), units, 30u32, 20u32,
        ),
    );
    TClient::new(&e, &shares).set_admin(&basket);
    World { e, admin, usdc, oracle, shares, legs, basket }
}

fn backed(w: &World) -> bool {
    let b = BasketClient::new(&w.e, &w.basket);
    let c = b.config();
    let supply = TClient::new(&w.e, &w.shares).total_supply();
    (0..c.constituents.len()).all(|i| {
        let h = TClient::new(&w.e, &c.constituents.get(i).unwrap()).balance(&w.basket);
        h >= c.units.get(i).unwrap() * supply / ONE
    })
}

#[test]
fn min_shares_and_min_usdc_protect_the_trader() {
    let w = world();
    let b = BasketClient::new(&w.e, &w.basket);
    let user = Address::generate(&w.e);
    TClient::new(&w.e, &w.usdc).faucet(&user);
    assert_eq!(b.try_buy(&user, &(100 * ONE), &(100 * ONE)), Err(Ok(Error::Slippage.into())));
    assert_eq!(TClient::new(&w.e, &w.usdc).balance(&user), 1_000 * ONE, "reverted buy moves nothing");
    let s = b.buy(&user, &(100 * ONE), &0);
    assert_eq!(b.try_sell(&user, &s, &(100 * ONE)), Err(Ok(Error::Slippage.into())));
    assert_eq!(b.try_buy(&user, &0, &0), Err(Ok(Error::ZeroAmount.into())));
    assert_eq!(b.try_sell(&user, &0, &0), Err(Ok(Error::ZeroAmount.into())));
}

#[test]
fn price_moves_keep_every_leg_backed() {
    let w = world();
    let b = BasketClient::new(&w.e, &w.basket);
    let o = OClient::new(&w.e, &w.oracle);
    let (alice, bob) = (Address::generate(&w.e), Address::generate(&w.e));
    let u = TClient::new(&w.e, &w.usdc);
    u.faucet(&alice);
    u.faucet(&bob);
    let a = b.buy(&alice, &(1_000 * ONE), &0);
    assert!(backed(&w));

    // BTC-like leg doubles: NAV goes up ~60%, bob now gets fewer shares for the same USDC
    o.set_feed(&w.legs.get(0).unwrap(), &Feed { source: Source::Fixed(100_000 * P), apy_bps: 0, t0: 0 });
    let nav = b.nav();
    assert!(nav.nav_per_share > 159 * ONE / 100 && nav.nav_per_share < 161 * ONE / 100, "{}", nav.nav_per_share);
    assert_eq!(nav.weights_bps, vec![&w.e, 7500u32, 2500]);
    let bb = b.buy(&bob, &(1_000 * ONE), &0);
    assert!(bb < a * 63 / 100 && bb > a * 62 / 100, "{bb} vs {a}");
    assert!(backed(&w));

    // alice exits with her gain, bob's position stays whole
    let out = b.sell(&alice, &a, &0);
    assert!(out > 1_580 * ONE, "{out}");
    assert!(backed(&w));
    let back = b.sell(&bob, &bb, &0);
    assert!(back > 990 * ONE && back < 1_000 * ONE, "{back}");
    assert_eq!(TClient::new(&w.e, &w.shares).total_supply(), 0);
}

#[test]
fn donations_do_not_change_minting() {
    let w = world();
    let b = BasketClient::new(&w.e, &w.basket);
    let (alice, bob) = (Address::generate(&w.e), Address::generate(&w.e));
    let u = TClient::new(&w.e, &w.usdc);
    u.faucet(&alice);
    u.faucet(&bob);
    let before = b.buy(&alice, &(100 * ONE), &0);
    // someone sends constituents straight to the vault: shares are minted on units, not NAV,
    // so the next buyer gets the same amount and the gift goes to existing holders pro-rata
    TClient::new(&w.e, &w.legs.get(1).unwrap()).mint(&w.basket, &(50 * T));
    let after = b.buy(&bob, &(100 * ONE), &0);
    assert_eq!(before, after);
    assert!(b.nav().nav_per_share > ONE);
}

fn register_with(legs: usize, units: &[i128], fee: u32) {
    let w = world();
    let e = &w.e;
    let c = BasketClient::new(e, &w.basket).config();
    let mut l = vec![e];
    for i in 0..legs {
        l.push_back(w.legs.get(i as u32 % 2).unwrap());
    }
    let mut u = vec![e];
    for x in units {
        u.push_back(*x);
    }
    e.register(
        Basket,
        (
            w.admin.clone(), String::from_str(e, "x"), String::from_str(e, "x"),
            c.usdc, c.market, c.oracle, c.shares, l, u, fee, 0u32,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn rejects_an_empty_basket() {
    register_with(0, &[], 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn rejects_mismatched_units() {
    register_with(2, &[1], 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn rejects_a_zero_unit() {
    register_with(2, &[1, 0], 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn rejects_fees_above_the_cap() {
    register_with(2, &[1, 1], 201);
}

#[test]
fn fee_updates_are_capped() {
    let w = world();
    let b = BasketClient::new(&w.e, &w.basket);
    assert_eq!(b.try_set_fees(&201, &0, &w.admin), Err(Ok(Error::FeeTooHigh.into())));
    b.set_fees(&0, &0, &w.admin);
    assert_eq!(b.fees().buy_bps, 0);
}

#[test]
fn only_the_holder_can_sell_and_only_the_admin_sets_fees() {
    let w = world();
    let b = BasketClient::new(&w.e, &w.basket);
    let alice = Address::generate(&w.e);
    TClient::new(&w.e, &w.usdc).faucet(&alice);
    let s = b.buy(&alice, &(100 * ONE), &0);
    w.e.set_auths(&[]);
    assert!(b.try_sell(&alice, &s, &0).is_err(), "no signature from alice");
    assert!(b.try_buy(&alice, &ONE, &0).is_err(), "no signature from alice");
    assert!(b.try_set_fees(&0, &0, &alice).is_err());
}

#[test]
fn buys_and_sells_emit_events() {
    use soroban_sdk::{testutils::Events as _, Event};
    let w = world();
    let b = BasketClient::new(&w.e, &w.basket);
    let alice = Address::generate(&w.e);
    TClient::new(&w.e, &w.usdc).faucet(&alice);
    let shares = b.buy(&alice, &(100 * ONE), &0);
    let bought = Bought { user: alice.clone(), usdc_in: 100 * ONE, fee: 100 * ONE * 30 / 10_000, shares };
    assert_eq!(w.e.events().all().filter_by_contract(&w.basket), [bought.to_xdr(&w.e, &w.basket)]);
    let u = TClient::new(&w.e, &w.usdc);
    let fees_before = u.balance(&w.admin);
    let usdc_out = b.sell(&alice, &shares, &0);
    let evs = w.e.events().all().filter_by_contract(&w.basket);
    let sold = Sold { user: alice.clone(), shares, fee: u.balance(&w.admin) - fees_before, usdc_out };
    assert_eq!(evs, [sold.to_xdr(&w.e, &w.basket)]);
    assert_eq!(TClient::new(&w.e, &w.usdc).balance(&alice), 900 * ONE + usdc_out);
}
