use anchor_lang::prelude::*;

#[account]
pub struct GlobalState {
    pub olv_mint: Pubkey,
    pub vault: Pubkey,
    pub treasury_sol: Pubkey,

    pub token_price_lamports: u64,

    pub total_supply: u64,
    pub sold_supply: u64,

    pub authority: Pubkey,
    pub paused: bool,
}
