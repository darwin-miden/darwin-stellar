#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Env};

#[test]
fn mint_transfer_burn_faucet() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let a = Address::generate(&e);
    let b = Address::generate(&e);
    let id = e.register(Token, (admin.clone(), 7u32, String::from_str(&e, "Test USD"), String::from_str(&e, "USDC"), 1_000_0000000i128));
    let t = TokenClient::new(&e, &id);
    t.mint(&a, &500);
    t.transfer(&a, &b, &200);
    assert_eq!(t.balance(&a), 300);
    assert_eq!(t.balance(&b), 200);
    t.burn(&b, &50);
    assert_eq!(t.total_supply(), 450);
    assert_eq!(t.faucet(&a), 1_000_0000000);
    assert!(t.try_faucet(&a).is_err());
    e.ledger().with_mut(|l| l.timestamp += 3601);
    t.faucet(&a);
    assert_eq!(t.balance(&a), 300 + 2 * 1_000_0000000);
}
