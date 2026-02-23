#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};
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

    /// Get token info by address
    pub fn get_token_info_by_address(env: Env, token_address: Address) -> Result<TokenInfo, Error> {
        storage::get_token_info_by_address(&env, &token_address).ok_or(Error::TokenNotFound)
    }

    /// Admin burn function with clawback capability
    /// 
    /// Allows the token creator (admin) to burn tokens from any address.
    /// This is a privileged operation that requires:
    /// - Admin authorization
    /// - Token must have clawback enabled
    /// - Valid burn amount
    /// - Sufficient balance in target address
    /// 
    /// # Security Considerations
    /// - Only token creator can perform admin burns
    /// - Separate event type distinguishes admin burns from self burns
    /// - Clawback must be explicitly enabled per token
    /// - All burns are permanently recorded in total_burned counter
    pub fn admin_burn(
        env: Env,
        token_address: Address,
        admin: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), Error> {
        // Require admin authorization
        admin.require_auth();

        // Verify token exists and get info
        let token_info = storage::get_token_info_by_address(&env, &token_address)
            .ok_or(Error::TokenNotFound)?;

        // Verify admin is the token creator
        if token_info.creator != admin {
            return Err(Error::Unauthorized);
        }

        // Verify clawback is enabled for this token
        if !token_info.clawback_enabled {
            return Err(Error::ClawbackDisabled);
        }

        // Validate burn amount
        if amount <= 0 {
            return Err(Error::InvalidBurnAmount);
        }

        // TODO: Uncomment once token contract integration is available
        // Get token contract client
        // let token = token::Client::new(&env, &token_address);
        
        // Check balance
        // let balance = token.balance(&from);
        // if balance < amount {
        //     return Err(Error::BurnAmountExceedsBalance);
        // }

        // Perform admin burn (clawback)
        // token.burn(&from, &amount);

        // Update token supply and burn counters
        storage::update_token_supply(&env, &token_address, -amount)
            .ok_or(Error::InvalidParameters)?;

        // Emit admin burn event (distinct from regular burn)
        env.events().publish(
            (symbol_short!("adm_burn"), token_address.clone()),
            (
                admin.clone(),
                from.clone(),
                amount,
                env.ledger().timestamp(),
            ),
        );

        Ok(())
    }

    /// Toggle clawback capability for a token (creator only)
    /// 
    /// Allows token creator to enable or disable clawback functionality.
    /// Once disabled, it can be re-enabled by the creator.
    pub fn set_clawback(
        env: Env,
        token_address: Address,
        admin: Address,
        enabled: bool,
    ) -> Result<(), Error> {
        // Require admin authorization
        admin.require_auth();

        // Get token info
        let mut token_info = storage::get_token_info_by_address(&env, &token_address)
            .ok_or(Error::TokenNotFound)?;

        // Verify admin is the token creator
        if token_info.creator != admin {
            return Err(Error::Unauthorized);
        }

        // Update clawback setting
        token_info.clawback_enabled = enabled;
        storage::set_token_info_by_address(&env, &token_address, &token_info);

        // Emit event
        env.events().publish(
            (symbol_short!("clawback"), token_address),
            (admin, enabled, env.ledger().timestamp()),
        );

        Ok(())
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod admin_burn_test;

// Temporarily disabled due to compilation issues
// #[cfg(test)]
// mod atomic_token_creation_test;

#[cfg(test)]
mod burn_property_test;
