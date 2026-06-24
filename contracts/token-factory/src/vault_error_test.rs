//! Vault Error Diagnostic Context Tests (#1384)
//!
//! Verifies that:
//! 1. Vault-related `Error` variants expose a stable, named string
//!    representation via `Error::name()` (so off-chain indexers such as
//!    `vaultEventParser.ts` never have to hardcode a numeric-to-name map).
//! 2. Every vault entry point that rejects an operation emits a structured
//!    `OperationFailed` event (topic `vlt_fail`) carrying the numeric error
//!    code, the stable error name, the affected amount, and a machine
//!    readable "condition" describing exactly why the operation failed.
//! 3. The diagnostic context (vault id, amount, condition) reported in the
//!    event matches the actual failure being tested.

#![cfg(test)]

use crate::types::Error;
use crate::{TokenFactory, TokenFactoryClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    Address, BytesN, Env, FromVal, String, Symbol,
};

const BASE_FEE: i128 = 70_000_000;
const METADATA_FEE: i128 = 30_000_000;

fn setup() -> (Env, TokenFactoryClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TokenFactory);
    let client = TokenFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &BASE_FEE, &METADATA_FEE);

    let creator = Address::generate(&env);
    let token = client.create_token(
        &creator,
        &String::from_str(&env, "Vault Token"),
        &String::from_str(&env, "VLT"),
        &7,
        &1_000_000_000,
        &None,
        &1_000_000,
    );

    (env, client, creator, token)
}

/// Decodes the most recently emitted event into (vault_id_topic, error_code,
/// error_name, amount, condition), asserting it is a `vlt_fail` event.
fn last_operation_failed(env: &Env) -> (u64, u32, Symbol, i128, Symbol) {
    let events = env.events().all();
    let (topics, data) = events.get(events.len() - 1).unwrap();

    let name_topic: Symbol = FromVal::from_val(env, &topics.get(0).unwrap());
    assert_eq!(
        name_topic,
        symbol_short!("vlt_fail"),
        "expected the last event to be an OperationFailed (vlt_fail) event"
    );
    let vault_id: u64 = FromVal::from_val(env, &topics.get(1).unwrap());

    let payload: (u32, Symbol, i128, Symbol) = FromVal::from_val(env, &data);
    (vault_id, payload.0, payload.1, payload.2, payload.3)
}

// ── Error::name() stability ───────────────────────────────────────────────

#[test]
fn test_vault_error_names_are_stable() {
    // These names are part of the off-chain indexer contract (vaultEventParser.ts).
    // Renaming or removing any of these is a breaking change.
    assert_eq!(Error::TokenNotFound.name(), "TokenNotFound");
    assert_eq!(Error::Unauthorized.name(), "Unauthorized");
    assert_eq!(Error::InvalidParameters.name(), "InvalidParameters");
    assert_eq!(Error::InvalidAmount.name(), "InvalidAmount");
    assert_eq!(Error::ContractPaused.name(), "ContractPaused");
    assert_eq!(Error::ArithmeticError.name(), "ArithmeticError");
    assert_eq!(Error::NothingToClaim.name(), "NothingToClaim");
    assert_eq!(Error::CliffNotReached.name(), "CliffNotReached");
    assert_eq!(Error::MilestoneUnauthorized.name(), "MilestoneUnauthorized");
    assert_eq!(
        Error::MilestoneAlreadyVerified.name(),
        "MilestoneAlreadyVerified"
    );
    assert_eq!(
        Error::VaultOwnerChangePending.name(),
        "VaultOwnerChangePending"
    );
    assert_eq!(
        Error::VaultOwnerChangeNotFound.name(),
        "VaultOwnerChangeNotFound"
    );
    assert_eq!(
        Error::VaultOwnerChangeAlreadyApproved.name(),
        "VaultOwnerChangeAlreadyApproved"
    );
}

#[test]
fn test_unknown_error_code_maps_to_unknown_error_name() {
    // Codes with no registered variant must not panic; they map to a
    // documented sentinel so indexers can detect drift instead of crashing.
    assert_eq!(Error(255).name(), "UnknownError");
}

// ── create_vault failure diagnostics ──────────────────────────────────────

#[test]
fn test_create_vault_invalid_amount_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let no_milestone = BytesN::from_array(&env, &[0u8; 32]);

    let result = client.try_create_vault(
        &creator,
        &token,
        &owner,
        &0, // invalid: amount must be positive
        &1_750_000_000,
        &no_milestone,
        &None,
    );
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));

    let (vault_id, code, name, amount, condition) = last_operation_failed(&env);
    assert_eq!(vault_id, u64::MAX, "no vault id is allocated yet");
    assert_eq!(code, Error::InvalidAmount.0);
    assert_eq!(name, Symbol::new(&env, "InvalidAmount"));
    assert_eq!(amount, 0);
    assert_eq!(condition, Symbol::new(&env, "amount_not_positive"));
}

#[test]
fn test_create_vault_missing_unlock_condition_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let no_milestone = BytesN::from_array(&env, &[0u8; 32]);

    let result = client.try_create_vault(
        &creator,
        &token,
        &owner,
        &500_000,
        &0, // no time unlock
        &no_milestone, // no milestone unlock either
        &None,
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));

    let (_, code, name, amount, condition) = last_operation_failed(&env);
    assert_eq!(code, Error::InvalidParameters.0);
    assert_eq!(name, Symbol::new(&env, "InvalidParameters"));
    assert_eq!(amount, 500_000);
    assert_eq!(condition, Symbol::new(&env, "missing_unlock_condition"));
}

#[test]
fn test_create_vault_milestone_without_verifier_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let milestone_hash = BytesN::from_array(&env, &[7u8; 32]);

    let result = client.try_create_vault(
        &creator,
        &token,
        &owner,
        &500_000,
        &0,
        &milestone_hash,
        &None, // missing required verifier
    );
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));

    let (_, _, _, _, condition) = last_operation_failed(&env);
    assert_eq!(condition, Symbol::new(&env, "milestone_without_verifier"));
}

#[test]
fn test_create_vault_unknown_token_emits_operation_failed() {
    let (env, client, creator, _token) = setup();
    let owner = Address::generate(&env);
    let unregistered_token = Address::generate(&env);
    let no_milestone = BytesN::from_array(&env, &[0u8; 32]);

    let result = client.try_create_vault(
        &creator,
        &unregistered_token,
        &owner,
        &500_000,
        &1_750_000_000,
        &no_milestone,
        &None,
    );
    assert_eq!(result, Err(Ok(Error::TokenNotFound)));

    let (_, code, name, _, condition) = last_operation_failed(&env);
    assert_eq!(code, Error::TokenNotFound.0);
    assert_eq!(name, Symbol::new(&env, "TokenNotFound"));
    assert_eq!(condition, Symbol::new(&env, "token_not_registered"));
}

// ── claim_vault failure diagnostics ────────────────────────────────────────

fn create_test_vault(
    env: &Env,
    client: &TokenFactoryClient,
    creator: &Address,
    token: &Address,
    owner: &Address,
    amount: i128,
    unlock_time: u64,
) -> u64 {
    let no_milestone = BytesN::from_array(env, &[0u8; 32]);
    client.create_vault(
        creator,
        token,
        owner,
        &amount,
        &unlock_time,
        &no_milestone,
        &None,
    )
}

#[test]
fn test_claim_vault_nonexistent_emits_operation_failed_with_vault_id() {
    let (env, client, _creator, _token) = setup();
    let owner = Address::generate(&env);

    let missing_vault_id = 999u64;
    let result = client.try_claim_vault(&owner, &missing_vault_id, &None);
    assert_eq!(result, Err(Ok(Error::TokenNotFound)));

    let (vault_id, code, name, amount, condition) = last_operation_failed(&env);
    assert_eq!(vault_id, missing_vault_id);
    assert_eq!(code, Error::TokenNotFound.0);
    assert_eq!(name, Symbol::new(&env, "TokenNotFound"));
    assert_eq!(amount, 0);
    assert_eq!(condition, Symbol::new(&env, "vault_not_found"));
}

#[test]
fn test_claim_vault_unauthorized_emits_operation_failed_with_amount() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    let vault_id = create_test_vault(&env, &client, &creator, &token, &owner, 500_000, 1);

    let result = client.try_claim_vault(&attacker, &vault_id, &None);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    let (evt_vault_id, code, name, amount, condition) = last_operation_failed(&env);
    assert_eq!(evt_vault_id, vault_id);
    assert_eq!(code, Error::Unauthorized.0);
    assert_eq!(name, Symbol::new(&env, "Unauthorized"));
    assert_eq!(amount, 500_000, "diagnostic context should carry the vault total");
    assert_eq!(condition, Symbol::new(&env, "not_vault_owner"));
}

#[test]
fn test_claim_vault_before_unlock_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);

    env.ledger().set(LedgerInfo {
        timestamp: 1_000,
        protocol_version: 22,
        sequence_number: 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 16,
        min_persistent_entry_ttl: 16,
        max_entry_ttl: 6_312_000,
    });

    let vault_id = create_test_vault(&env, &client, &creator, &token, &owner, 500_000, 5_000);

    let result = client.try_claim_vault(&owner, &vault_id, &None);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));

    let (_, _, _, amount, condition) = last_operation_failed(&env);
    assert_eq!(amount, 500_000);
    assert_eq!(condition, Symbol::new(&env, "cliff_not_reached"));
}

#[test]
fn test_claim_vault_nothing_to_claim_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);

    let vault_id = create_test_vault(&env, &client, &creator, &token, &owner, 500_000, 1);

    // First claim succeeds and drains the vault.
    client.claim_vault(&owner, &vault_id, &None);

    // Second claim has nothing left.
    let result = client.try_claim_vault(&owner, &vault_id, &None);
    assert_eq!(result, Err(Ok(Error::InvalidParameters)));

    let (_, code, name, _, condition) = last_operation_failed(&env);
    assert_eq!(code, Error::InvalidParameters.0);
    assert_eq!(name, Symbol::new(&env, "InvalidParameters"));
    assert_eq!(condition, Symbol::new(&env, "vault_not_active"));
}

// ── cancel_vault failure diagnostics ───────────────────────────────────────

#[test]
fn test_cancel_vault_unauthorized_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    let vault_id = create_test_vault(&env, &client, &creator, &token, &owner, 500_000, 1_750_000_000);

    let result = client.try_cancel_vault(&vault_id, &attacker);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    let (evt_vault_id, code, name, amount, condition) = last_operation_failed(&env);
    assert_eq!(evt_vault_id, vault_id);
    assert_eq!(code, Error::Unauthorized.0);
    assert_eq!(name, Symbol::new(&env, "Unauthorized"));
    assert_eq!(amount, 500_000);
    assert_eq!(condition, Symbol::new(&env, "not_creator_or_admin"));
}

// ── verify_milestone failure diagnostics ───────────────────────────────────

#[test]
fn test_verify_milestone_wrong_verifier_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let verifier = Address::generate(&env);
    let attacker = Address::generate(&env);
    let milestone_hash = BytesN::from_array(&env, &[3u8; 32]);

    let vault_id = client.create_vault(
        &creator,
        &token,
        &owner,
        &500_000,
        &0,
        &milestone_hash,
        &Some(verifier),
    );

    let result = client.try_verify_milestone(&attacker, &vault_id);
    assert_eq!(result, Err(Ok(Error::MilestoneUnauthorized)));

    let (evt_vault_id, code, name, _, condition) = last_operation_failed(&env);
    assert_eq!(evt_vault_id, vault_id);
    assert_eq!(code, Error::MilestoneUnauthorized.0);
    assert_eq!(name, Symbol::new(&env, "MilestoneUnauthorized"));
    assert_eq!(condition, Symbol::new(&env, "not_designated_verifier"));
}

#[test]
fn test_verify_milestone_already_verified_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let verifier = Address::generate(&env);
    let milestone_hash = BytesN::from_array(&env, &[3u8; 32]);

    let vault_id = client.create_vault(
        &creator,
        &token,
        &owner,
        &500_000,
        &0,
        &milestone_hash,
        &Some(verifier.clone()),
    );

    client.verify_milestone(&verifier, &vault_id);

    let result = client.try_verify_milestone(&verifier, &vault_id);
    assert_eq!(result, Err(Ok(Error::MilestoneAlreadyVerified)));

    let (_, code, name, _, condition) = last_operation_failed(&env);
    assert_eq!(code, Error::MilestoneAlreadyVerified.0);
    assert_eq!(name, Symbol::new(&env, "MilestoneAlreadyVerified"));
    assert_eq!(condition, Symbol::new(&env, "milestone_already_verified"));
}

// ── propose/approve vault owner change failure diagnostics ────────────────

#[test]
fn test_propose_vault_owner_change_unauthorized_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let vault_id = create_test_vault(&env, &client, &creator, &token, &owner, 500_000, 1_750_000_000);

    let result = client.try_propose_vault_owner_change(&attacker, &vault_id, &new_owner);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    let (_, code, name, _, condition) = last_operation_failed(&env);
    assert_eq!(code, Error::Unauthorized.0);
    assert_eq!(name, Symbol::new(&env, "Unauthorized"));
    assert_eq!(condition, Symbol::new(&env, "not_owner_or_creator"));
}

#[test]
fn test_approve_vault_owner_change_not_found_emits_operation_failed() {
    let (env, client, creator, token) = setup();
    let owner = Address::generate(&env);

    let vault_id = create_test_vault(&env, &client, &creator, &token, &owner, 500_000, 1_750_000_000);

    // No proposal has been created yet.
    let result = client.try_approve_vault_owner_change(&owner, &vault_id);
    assert_eq!(result, Err(Ok(Error::VaultOwnerChangeNotFound)));

    let (evt_vault_id, code, name, _, condition) = last_operation_failed(&env);
    assert_eq!(evt_vault_id, vault_id);
    assert_eq!(code, Error::VaultOwnerChangeNotFound.0);
    assert_eq!(name, Symbol::new(&env, "VaultOwnerChangeNotFound"));
    assert_eq!(condition, Symbol::new(&env, "no_pending_owner_change"));
}
