#![no_std]

mod storage;
mod burn;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env};
use types::{Error, FactoryState, TokenInfo};

#[contract]
pub struct TokenFactory;

#[contractimpl]
impl TokenFactory {
    /// Initialize the factory with admin, treasury, and fee structure
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
        base_fee: i128,
        metadata_fee: i128,
    ) -> Result<(), Error> {
        // Check if already initialized
        if storage::has_admin(&env) {
            return Err(Error::AlreadyInitialized);
        }

        // Validate parameters
        if base_fee < 0 || metadata_fee < 0 {
            return Err(Error::InvalidParameters);
        }

        // Set initial state
        storage::set_admin(&env, &admin);
        storage::set_treasury(&env, &treasury);
        storage::set_base_fee(&env, base_fee);
        storage::set_metadata_fee(&env, metadata_fee);

        Ok(())
    }

    /// Get the current factory state
    pub fn get_state(env: Env) -> FactoryState {
        storage::get_factory_state(&env)
    }

    /// Update fee structure (admin only)
    pub fn update_fees(
        env: Env,
        admin: Address,
        base_fee: Option<i128>,
        metadata_fee: Option<i128>,
    ) -> Result<(), Error> {
        admin.require_auth();

        let current_admin = storage::get_admin(&env);
        if admin != current_admin {
            return Err(Error::Unauthorized);
        }

        if let Some(fee) = base_fee {
            if fee < 0 {
                return Err(Error::InvalidParameters);
            }
            storage::set_base_fee(&env, fee);
        }

        if let Some(fee) = metadata_fee {
            if fee < 0 {
                return Err(Error::InvalidParameters);
            }
            storage::set_metadata_fee(&env, fee);
        }

        Ok(())
    }

    /// Get token count
    pub fn get_token_count(env: Env) -> u32 {
        storage::get_token_count(&env)
    }

    /// Get token info by index
   pub fn get_token_info(env: Env, index: u32) -> Result<TokenInfo, Error> {
    let mut info = storage::get_token_info(&env, index).ok_or(Error::TokenNotFound)?;
    info.is_paused = storage::is_token_paused(&env, index);   // ADD
    Ok(info)
}
    /// Create a new token (Simulated for registry)
    pub fn create_token(
        env: Env,
        creator: Address,
        name: soroban_sdk::String,
        symbol: soroban_sdk::String,
        decimals: u32,
        initial_supply: i128,
        metadata_uri: Option<soroban_sdk::String>,
        fee_paid: i128,
    ) -> Result<Address, Error> {
        // Validate fees
        let base_fee = storage::get_base_fee(&env);
        let metadata_fee = if metadata_uri.is_some() { storage::get_metadata_fee(&env) } else { 0 };
        let required_fee = base_fee + metadata_fee;

        if fee_paid < required_fee {
            return Err(Error::InsufficientFee);
        }

        // Validate params
        if initial_supply <= 0 {
            return Err(Error::InvalidParameters);
        }

        // In a real implementation, this would deploy a contract
        // For the simulated registry, we use the current contract address as a placeholder
        let token_address = env.current_contract_address();

        let info = TokenInfo {
            address: token_address.clone(),
            creator,
            name,
            symbol,
            decimals,
            total_supply: initial_supply,
            metadata_uri,
            created_at: env.ledger().timestamp(),
            is_paused: false, 
        };

        let index = storage::get_token_count(&env);
        storage::set_token_info(&env, index, &info);
        storage::increment_token_count(&env);

        Ok(token_address)
    }

    /// Update metadata for a token (must not be set already)
   pub fn set_metadata(env: Env, index: u32, new_metadata_uri: soroban_sdk::String) -> Result<(), Error> {
    let mut info = storage::get_token_info(&env, index).ok_or(Error::TokenNotFound)?;

    if storage::is_token_paused(&env, index) {   // ADD
        return Err(Error::TokenPaused);          // ADD
    }                                            // ADD

    if info.metadata_uri.is_some() {
        return Err(Error::MetadataAlreadySet);
    }
    info.metadata_uri = Some(new_metadata_uri);
    storage::set_token_info(&env, index, &info);
    Ok(())
}

    pub fn burn(env: Env, caller: Address, token_index: u32, amount: i128) -> Result<(), Error> {
        burn::burn(&env, caller, token_index, amount)
    }

    pub fn admin_burn(env: Env, admin: Address, token_index: u32, holder: Address, amount: i128) -> Result<(), Error> {
        burn::admin_burn(&env, admin, token_index, holder, amount)
    }

    pub fn batch_burn(env: Env, admin: Address, token_index: u32, burns: soroban_sdk::Vec<(Address, i128)>) -> Result<(), Error> {
        burn::batch_burn(&env, admin, token_index, burns)
    }

    pub fn get_burn_count(env: Env, token_index: u32) -> u32 {
        burn::get_burn_count(&env, token_index)
    }

    pub fn pause_token(env: Env, admin: Address, token_index: u32) -> Result<(), Error> {
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }
        storage::get_token_info(&env, token_index).ok_or(Error::TokenNotFound)?;
        storage::set_token_paused(&env, token_index, true);
        Ok(())
    }

    pub fn unpause_token(env: Env, admin: Address, token_index: u32) -> Result<(), Error> {
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }
        storage::get_token_info(&env, token_index).ok_or(Error::TokenNotFound)?;
        storage::set_token_paused(&env, token_index, false);
        Ok(())
    }

    pub fn is_token_paused(env: Env, token_index: u32) -> bool {
        storage::is_token_paused(&env, token_index)
    }

}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz_test;

#[cfg(test)]
mod bench_test;

#[cfg(test)]
mod supply_conservation_test;

#[cfg(test)]
mod fee_validation_test;

#[cfg(test)]
mod atomic_token_creation_test;

#[cfg(test)]
mod metadata_immutability_test;

#[cfg(test)]
mod token_registry_test;

#[cfg(test)]
mod token_pause_test;

