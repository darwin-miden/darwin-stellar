#![cfg(test)]
use super::*;
use soroban_sdk::{contract, contractimpl, symbol_short, testutils::{Address as _, Ledger}, Env};

#[contract]
pub struct MockReflector;

#[contractimpl]
impl MockReflector {
    pub fn lastprice(e: Env, _asset: Asset) -> Option<PriceData> {
        Some(PriceData { price: 5 * 10i128.pow(20), timestamp: e.ledger().timestamp() }) // $5, 20 dec
    }
    pub fn decimals(_e: Env) -> u32 {
        20
    }
}

#[test]
fn reflector_scaling_and_accrual() {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let admin = Address::generate(&e);
    let refl = e.register(MockReflector, ());
    let id = e.register(Oracle, (admin.clone(), 3600u64));
    let o = OracleClient::new(&e, &id);
    let spot = Address::generate(&e);
    let bond = Address::generate(&e);
    let usd = Address::generate(&e);
    o.set_feed(&spot, &Feed { source: Source::Reflector(refl.clone(), Asset::Other(symbol_short!("MXN"))), apy_bps: 0, t0: 0 });
    o.set_feed(&bond, &Feed { source: Source::Reflector(refl.clone(), Asset::Other(symbol_short!("MXN"))), apy_bps: 1000, t0: 1_000_000 });
    o.set_feed(&usd, &Feed { source: Source::Fixed(100_000_000_000_000), apy_bps: 0, t0: 0 });
    assert_eq!(o.price(&spot), 5 * 10i128.pow(14));
    assert_eq!(o.price(&usd), 10i128.pow(14));
    e.ledger().with_mut(|l| l.timestamp = 1_000_000 + 31_536_000);
    assert_eq!(o.price(&bond), 55 * 10i128.pow(13)); // +10% after a year
    assert!(o.try_price(&Address::generate(&e)).is_err());
}

/// Reflector that last published at a fixed time and knows only `EUR`.
#[contract]
pub struct FrozenReflector;

#[contractimpl]
impl FrozenReflector {
    pub fn lastprice(_e: Env, asset: Asset) -> Option<PriceData> {
        match asset {
            Asset::Other(s) if s == symbol_short!("EUR") => Some(PriceData { price: 11 * 10i128.pow(13), timestamp: 1_000 }),
            _ => None,
        }
    }
    pub fn decimals(_e: Env) -> u32 {
        14
    }
}

#[test]
fn stale_and_missing_prices_revert() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let refl = e.register(FrozenReflector, ());
    let o = OracleClient::new(&e, &e.register(Oracle, (admin.clone(), 3600u64)));
    let eur = Address::generate(&e);
    let jpy = Address::generate(&e);
    o.set_feed(&eur, &Feed { source: Source::Reflector(refl.clone(), Asset::Other(symbol_short!("EUR"))), apy_bps: 0, t0: 0 });
    o.set_feed(&jpy, &Feed { source: Source::Reflector(refl.clone(), Asset::Other(symbol_short!("JPY"))), apy_bps: 0, t0: 0 });

    e.ledger().with_mut(|l| l.timestamp = 1_000 + 3_600);
    assert_eq!(o.price(&eur), 11 * 10i128.pow(13), "exactly max_age old is still fresh");
    e.ledger().with_mut(|l| l.timestamp = 1_000 + 3_601);
    assert_eq!(o.try_price(&eur), Err(Ok(Error::StalePrice.into())));
    o.set_max_age(&7_200);
    assert!(o.try_price(&eur).is_ok());
    assert_eq!(o.try_price(&jpy), Err(Ok(Error::NoPrice.into())));
}

#[test]
fn only_the_admin_sets_feeds() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let o = OracleClient::new(&e, &e.register(Oracle, (admin.clone(), 3600u64)));
    let t = Address::generate(&e);
    assert!(o.try_set_feed(&t, &Feed { source: Source::Fixed(1), apy_bps: 0, t0: 0 }).is_err());
    assert!(o.try_set_max_age(&1).is_err());
    assert!(o.try_set_admin(&t).is_err());
}
