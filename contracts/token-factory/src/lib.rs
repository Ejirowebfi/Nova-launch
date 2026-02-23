#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};
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
        storage::get_token_info(&env, index).ok_or(Error::TokenNotFound)
    }

    /// Burn tokens from a token holder's balance
    /// 
    /// # Arguments
    /// * `token_address` - The address of the token contract
    /// * `from` - The address of the token holder burning tokens
    /// * `amount` - The amount of tokens to burn
    /// 
    /// # Errors
    /// * `InvalidBurnAmount` - If amount is zero or negative
    /// * `BurnAmountExceedsBalance` - If the holder doesn't have enough tokens
    pub fn burn(
        env: Env,
        token_address: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), Error> {
        // Require authorization from the token holder
        from.require_auth();

        // Validate amount
        if amount <= 0 {
            return Err(Error::InvalidBurnAmount);
        }

        // Get token contract
        let token = token::Client::new(&env, &token_address);

        // Check balance
        let balance = token.balance(&from);
        if balance < amount {
            return Err(Error::BurnAmountExceedsBalance);
        }

        // Burn tokens (reduce balance and total supply)
        token.burn(&from, &amount);

        // Update token info
        storage::update_token_supply(&env, &token_address, -amount);

        // Emit event
        env.events().publish(
            (symbol_short!("burn"), token_address.clone()),
            (from.clone(), amount, env.ledger().timestamp()),
        );

        Ok(())
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;

#[cfg(test)]
mod burn_property_test;
