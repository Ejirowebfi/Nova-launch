use soroban_sdk::{Address, Env};
use crate::types::Error;
use crate::storage;
use crate::burn;
use crate::events;

/// Execute a single buyback step: buy tokens and burn them
///
/// # Arguments
/// * `env` - Contract environment
/// * `campaign_id` - Campaign identifier
/// * `executor` - Address executing the buyback
/// * `max_spend` - Maximum amount to spend in this step
/// * `min_tokens_out` - Minimum tokens to receive (slippage protection)
/// * `dex_address` - DEX contract address for swap
///
/// # Returns
/// Amount of tokens bought and burned
///
/// # Errors
/// * `Error::TokenNotFound` - Campaign does not exist
/// * `Error::ContractPaused` - Campaign is not active
/// * `Error::InsufficientFee` - No remaining budget
/// * `Error::InvalidParameters` - Invalid spend amount
/// * `Error::InvalidAmount` - Slippage exceeded
pub fn execute_buyback_step(
    env: &Env,
    campaign_id: u32,
    executor: &Address,
    max_spend: i128,
    min_tokens_out: i128,
    dex_address: &Address,
) -> Result<i128, Error> {
    executor.require_auth();

    // Load campaign state
    let mut campaign = storage::get_buyback_campaign(env, campaign_id)
        .map_err(|_| Error::TokenNotFound)?;

    // Validate campaign is active
    if !campaign.active {
        return Err(Error::ContractPaused);
    }

    // Check remaining budget
    let remaining = campaign.total_budget - campaign.total_spent;
    if remaining <= 0 {
        return Err(Error::InsufficientFee);
    }

    // Enforce max spend per step
    let actual_spend = max_spend.min(campaign.max_spend_per_step).min(remaining);
    if actual_spend <= 0 {
        return Err(Error::InvalidParameters);
    }

    // Execute swap on DEX (simulated - in production would call actual DEX)
    let tokens_bought = simulate_swap(env, dex_address, actual_spend, min_tokens_out)?;

    // Enforce slippage tolerance
    if tokens_bought < min_tokens_out {
        return Err(Error::InvalidAmount);
    }

    // Burn the bought tokens
    burn::burn(env, executor.clone(), campaign.token_index, tokens_bought)?;

    // Update campaign accounting atomically
    campaign.total_spent += actual_spend;
    campaign.total_bought += tokens_bought;
    campaign.total_burned += tokens_bought;
    campaign.execution_count += 1;

    // Persist updated state
    storage::set_buyback_campaign(env, campaign_id, &campaign);

    // Emit event
    events::emit_buyback_executed(
        env,
        campaign_id,
        executor,
        actual_spend,
        tokens_bought,
    );

    Ok(tokens_bought)
}

/// Simulate DEX swap (placeholder for actual DEX integration)
fn simulate_swap(
    _env: &Env,
    _dex_address: &Address,
    spend_amount: i128,
    min_out: i128,
) -> Result<i128, Error> {
    // Simple simulation: 1:100 exchange rate
    let tokens_out = spend_amount * 100;
    
    if tokens_out < min_out {
        return Err(Error::InvalidAmount);
    }
    
    Ok(tokens_out)
}
