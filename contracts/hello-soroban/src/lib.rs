#![no_std]
//! Minimal Soroban sample contract used as the source-verification fixture.
//!
//! This contract exists purely so the MVP can prove the core verification
//! primitive end to end: rebuild this source into WASM and assert the rebuilt
//! SHA-256 matches the on-chain `ContractCodeEntry` hash for a deployed
//! instance of it (see ../../scripts and ../../reader).
//!
//! It deliberately stays tiny and dependency-light so the build is fast and
//! reproducible. It is NOT a template for production contracts.

use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, String, Symbol, Vec};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    /// Returns ["Hello", <to>] — the canonical Soroban hello-world shape.
    pub fn hello(env: Env, to: String) -> Vec<String> {
        vec![&env, String::from_str(&env, "Hello"), to]
    }

    /// A trivial pure function, present so the WASM has more than one export
    /// and the verification diff has real bytes to compare.
    pub fn add(_env: Env, a: u32, b: u32) -> u32 {
        a.checked_add(b).expect("overflow in add")
    }

    /// Returns a fixed symbol identifying this fixture build.
    pub fn name(_env: Env) -> Symbol {
        symbol_short!("soroscan")
    }
}

mod test;
