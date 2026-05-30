#![cfg(test)]

use super::{HelloContract, HelloContractClient};
use soroban_sdk::{vec, Env, String};

#[test]
fn test_hello() {
    let env = Env::default();
    let contract_id = env.register(HelloContract, ());
    let client = HelloContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "Soroban"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "Soroban"),
        ]
    );
}

#[test]
fn test_add() {
    let env = Env::default();
    let contract_id = env.register(HelloContract, ());
    let client = HelloContractClient::new(&env, &contract_id);

    assert_eq!(client.add(&2, &3), 5);
}

#[test]
fn test_name() {
    let env = Env::default();
    let contract_id = env.register(HelloContract, ());
    let client = HelloContractClient::new(&env, &contract_id);

    assert_eq!(client.name(), soroban_sdk::symbol_short!("soroscan"));
}
