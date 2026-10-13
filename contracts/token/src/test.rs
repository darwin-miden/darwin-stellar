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

#[test]
fn allowances_expire_and_are_spent() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let (a, spender, c) = (Address::generate(&e), Address::generate(&e), Address::generate(&e));
    let id = e.register(Token, (admin, 7u32, String::from_str(&e, "T"), String::from_str(&e, "T"), 0i128));
    let t = TokenClient::new(&e, &id);
    t.mint(&a, &1_000);
    let exp = e.ledger().sequence() + 100;
    t.approve(&a, &spender, &300, &exp);
    assert_eq!(t.allowance(&a, &spender), 300);
    t.transfer_from(&spender, &a, &c, &200);
    assert_eq!(t.allowance(&a, &spender), 100);
    assert_eq!(t.try_transfer_from(&spender, &a, &c, &101), Err(Ok(Error::InsufficientAllowance.into())));
    t.burn_from(&spender, &a, &100);
    assert_eq!(t.total_supply(), 900);
    t.approve(&a, &spender, &50, &exp);
    e.ledger().with_mut(|l| l.sequence_number = exp + 1);
    assert_eq!(t.allowance(&a, &spender), 0, "expired");
    assert!(t.try_transfer_from(&spender, &a, &c, &1).is_err());
}

#[test]
fn balances_and_amounts_are_checked() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let (a, b) = (Address::generate(&e), Address::generate(&e));
    let id = e.register(Token, (admin, 7u32, String::from_str(&e, "T"), String::from_str(&e, "T"), 0i128));
    let t = TokenClient::new(&e, &id);
    t.mint(&a, &10);
    assert_eq!(t.try_transfer(&a, &b, &11), Err(Ok(Error::InsufficientBalance.into())));
    assert_eq!(t.try_transfer(&a, &b, &-1), Err(Ok(Error::NegativeAmount.into())));
    assert_eq!(t.try_burn(&b, &1), Err(Ok(Error::InsufficientBalance.into())));
    assert_eq!(t.try_faucet(&a), Err(Ok(Error::FaucetDisabled.into())));
}

#[test]
fn only_the_admin_mints() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let a = Address::generate(&e);
    let id = e.register(Token, (admin, 7u32, String::from_str(&e, "T"), String::from_str(&e, "T"), 0i128));
    let t = TokenClient::new(&e, &id);
    assert!(t.try_mint(&a, &1).is_err());
    assert!(t.try_set_admin(&a).is_err());
    assert_eq!(t.total_supply(), 0);
}
