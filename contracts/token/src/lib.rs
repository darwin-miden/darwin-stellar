#![no_std]
//! Darwin SEP-41 token.
//!
//! One contract, three roles on testnet:
//!   - basket shares   (admin = the basket vault, mints on buy / burns on sell)
//!   - constituents    (admin = the market, mints on buy / burns on sell)
//!   - test USDC       (admin = deployer, plus a public `faucet` so anyone can try the app)
//!
//! Standard SEP-41 surface (balance / transfer / approve / burn …) so Freighter, the Stellar
//! Wallets Kit and explorers read it like any other token, plus `mint`, `total_supply`.

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, panic_with_error, contracterror, Address, Env,
    MuxedAddress, String,
};

const DAY_LEDGERS: u32 = 17_280;
const BUMP: u32 = 30 * DAY_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP - DAY_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NegativeAmount = 1,
    InsufficientBalance = 2,
    InsufficientAllowance = 3,
    AllowanceExpired = 4,
    FaucetDisabled = 5,
    FaucetCooldown = 6,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Name,
    Symbol,
    Decimals,
    Supply,
    FaucetAmount,
    Balance(Address),
    Allowance(Address, Address),
    LastFaucet(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contractevent(data_format = "single-value")]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(data_format = "single-value")]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(data_format = "single-value")]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(data_format = "single-value")]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
}

#[contract]
pub struct Token;

fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP);
}

fn balance_of(e: &Env, id: &Address) -> i128 {
    let key = DataKey::Balance(id.clone());
    match e.storage().persistent().get::<_, i128>(&key) {
        Some(b) => {
            e.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP);
            b
        }
        None => 0,
    }
}

fn set_balance(e: &Env, id: &Address, amount: i128) {
    let key = DataKey::Balance(id.clone());
    e.storage().persistent().set(&key, &amount);
    e.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP);
}

fn check_nonneg(e: &Env, amount: i128) {
    if amount < 0 {
        panic_with_error!(e, Error::NegativeAmount);
    }
}

fn debit(e: &Env, id: &Address, amount: i128) {
    let b = balance_of(e, id);
    if b < amount {
        panic_with_error!(e, Error::InsufficientBalance);
    }
    set_balance(e, id, b - amount);
}

fn credit(e: &Env, id: &Address, amount: i128) {
    let b = balance_of(e, id);
    set_balance(e, id, b + amount);
}

fn supply(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::Supply).unwrap_or(0)
}

fn read_allowance(e: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(from.clone(), spender.clone());
    match e.storage().temporary().get::<_, AllowanceValue>(&key) {
        Some(a) if a.expiration_ledger >= e.ledger().sequence() => a,
        _ => AllowanceValue { amount: 0, expiration_ledger: 0 },
    }
}

fn spend_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
    let a = read_allowance(e, from, spender);
    if a.amount < amount {
        panic_with_error!(e, Error::InsufficientAllowance);
    }
    if amount > 0 {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        e.storage().temporary().set(
            &key,
            &AllowanceValue { amount: a.amount - amount, expiration_ledger: a.expiration_ledger },
        );
    }
}

fn do_mint(e: &Env, to: &Address, amount: i128) {
    check_nonneg(e, amount);
    credit(e, to, amount);
    e.storage().instance().set(&DataKey::Supply, &(supply(e) + amount));
    Mint { to: to.clone(), amount }.publish(e);
}

fn do_burn(e: &Env, from: &Address, amount: i128) {
    check_nonneg(e, amount);
    debit(e, from, amount);
    e.storage().instance().set(&DataKey::Supply, &(supply(e) - amount));
    Burn { from: from.clone(), amount }.publish(e);
}

#[contractimpl]
impl Token {
    /// `faucet_amount` > 0 turns on the public test faucet (test USDC only).
    pub fn __constructor(e: Env, admin: Address, decimals: u32, name: String, symbol: String, faucet_amount: i128) {
        let s = e.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Decimals, &decimals);
        s.set(&DataKey::Name, &name);
        s.set(&DataKey::Symbol, &symbol);
        s.set(&DataKey::Supply, &0i128);
        s.set(&DataKey::FaucetAmount, &faucet_amount);
    }

    // ── admin ─────────────────────────────────────────────────────────────────────────────

    pub fn admin(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(e: Env, new_admin: Address) {
        Self::admin(e.clone()).require_auth();
        bump_instance(&e);
        e.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        Self::admin(e.clone()).require_auth();
        bump_instance(&e);
        do_mint(&e, &to, amount);
    }

    /// Public test faucet: `faucet_amount` per address per hour.
    pub fn faucet(e: Env, to: Address) -> i128 {
        to.require_auth();
        bump_instance(&e);
        let amount: i128 = e.storage().instance().get(&DataKey::FaucetAmount).unwrap_or(0);
        if amount <= 0 {
            panic_with_error!(&e, Error::FaucetDisabled);
        }
        let key = DataKey::LastFaucet(to.clone());
        let now = e.ledger().timestamp();
        if let Some(last) = e.storage().temporary().get::<_, u64>(&key) {
            if now < last + 3600 {
                panic_with_error!(&e, Error::FaucetCooldown);
            }
        }
        e.storage().temporary().set(&key, &now);
        e.storage().temporary().extend_ttl(&key, DAY_LEDGERS, DAY_LEDGERS);
        do_mint(&e, &to, amount);
        amount
    }

    pub fn total_supply(e: Env) -> i128 {
        supply(&e)
    }

    // ── SEP-41 ────────────────────────────────────────────────────────────────────────────

    pub fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        read_allowance(&e, &from, &spender).amount
    }

    pub fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        check_nonneg(&e, amount);
        bump_instance(&e);
        if amount > 0 && expiration_ledger < e.ledger().sequence() {
            panic_with_error!(&e, Error::AllowanceExpired);
        }
        let key = DataKey::Allowance(from.clone(), spender.clone());
        e.storage().temporary().set(&key, &AllowanceValue { amount, expiration_ledger });
        if amount > 0 {
            let live = expiration_ledger.saturating_sub(e.ledger().sequence());
            e.storage().temporary().extend_ttl(&key, live, live);
        }
        Approve { from, spender, amount }.publish(&e);
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        balance_of(&e, &id)
    }

    pub fn transfer(e: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        check_nonneg(&e, amount);
        bump_instance(&e);
        let to = to.address();
        debit(&e, &from, amount);
        credit(&e, &to, amount);
        Transfer { from, to, amount }.publish(&e);
    }

    pub fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        check_nonneg(&e, amount);
        bump_instance(&e);
        spend_allowance(&e, &from, &spender, amount);
        debit(&e, &from, amount);
        credit(&e, &to, amount);
        Transfer { from, to, amount }.publish(&e);
    }

    pub fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        bump_instance(&e);
        do_burn(&e, &from, amount);
    }

    pub fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        bump_instance(&e);
        spend_allowance(&e, &from, &spender, amount);
        do_burn(&e, &from, amount);
    }

    pub fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    pub fn name(e: Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(e: Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }
}

#[cfg(test)]
mod test;
