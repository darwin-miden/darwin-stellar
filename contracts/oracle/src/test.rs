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
