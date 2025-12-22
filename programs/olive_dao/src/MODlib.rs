use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, Mint, Token, TokenAccount, MintTo, Transfer, SetAuthority,
};
use anchor_spl::token::spl_token::instruction::AuthorityType;
use switchboard_solana::AggregatorAccountData; // Ensure switchboard-solana is in Cargo.toml

mod errors;
use errors::*;

declare_id!("6BU1fyoGLqvRUyeWGJhYcLB9hp5rAEYkVivA6Ppvwc72");

// ---------------- CONSTANTS ----------------
const DECIMALS: u8 = 6;
const TOTAL_SUPPLY: u64 = 10_000_000 * 10u64.pow(DECIMALS as u32);

const STATE_SEED: &[u8] = b"state";
const MINT_AUTH_SEED: &[u8] = b"mint-auth";
const VAULT_SEED: &[u8] = b"vault";

// ---------------- STATE ----------------
#[account]
pub struct GlobalState {
    pub olv_mint: Pubkey,
    pub vault: Pubkey,
    pub oracle_feed: Pubkey,      // Switchboard feed address
    pub treasury_sol: Pubkey,
    pub treasury_usdc: Pubkey,

    pub token_price_lamports: u64,
    pub token_price_usdc: u64,

    pub sold_supply: u64,
    pub total_harvest_yield: u64, // Real-world data from Oracle
    pub last_update_ts: i64,      // Timestamp of last oracle sync
    
    pub authority: Pubkey,
    pub paused: bool,
}

// ---------------- PROGRAM ----------------
#[program]
pub mod olive_dao {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        price_sol: u64,
        price_usdc: u64,
        oracle_feed: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        state.olv_mint = ctx.accounts.mint.key();
        state.vault = ctx.accounts.vault.key();
        state.oracle_feed = oracle_feed;
        state.treasury_sol = ctx.accounts.treasury_sol.key();
        state.treasury_usdc = ctx.accounts.treasury_usdc.key();
        state.token_price_lamports = price_sol;
        state.token_price_usdc = price_usdc;
        state.sold_supply = 0;
        state.total_harvest_yield = 0;
        state.authority = ctx.accounts.authority.key();
        state.paused = false;

        let mint_auth_bump = ctx.bumps.mint_authority;
        let mint_auth_seeds = &[MINT_AUTH_SEED, &[mint_auth_bump]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[mint_auth_seeds],
            ),
            TOTAL_SUPPLY,
        )?;

        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[mint_auth_seeds],
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        Ok(())
    }

    /// Pulls the latest harvest data (e.g., total kg produced) from the Switchboard Oracle
    pub fn sync_harvest_data(ctx: Context<SyncHarvestData>) -> Result<()> {
        let clock = Clock::get()?;
        let aggregator = &ctx.accounts.aggregator.load()?;

        // Retrieve the latest value from the Switchboard feed
        let val: f64 = aggregator.get_result()?.try_into()?;
        
        let state = &mut ctx.accounts.state;
        state.total_harvest_yield = val as u64;
        state.last_update_ts = clock.unix_timestamp;

        msg!("Harvest data synced: {} kg at ts {}", val, state.last_update_ts);
        Ok(())
    }

    pub fn buy_with_sol(ctx: Context<BuyWithSol>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.state.paused, OliveError::ProtocolPaused);
        require!(ctx.accounts.vault.amount >= amount, OliveError::InsufficientSupply);

        let price = ctx.accounts.state.token_price_lamports;
        let cost = amount.checked_mul(price).unwrap();

        // Safety: Use system_program transfer instead of manual lamport adjustment
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.treasury_sol.to_account_info(),
                },
            ),
            cost,
        )?;

        let state_bump = ctx.bumps.state;
        let state_seeds = &[STATE_SEED, &[state_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                &[state_seeds],
            ),
            amount,
        )?;

        ctx.accounts.state.sold_supply += amount;
        Ok(())
    }

    pub fn buy_with_usdc(ctx: Context<BuyWithUsdc>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.state.paused, OliveError::ProtocolPaused);
        require!(ctx.accounts.vault.amount >= amount, OliveError::InsufficientSupply);

        let price = ctx.accounts.state.token_price_usdc;
        let cost = amount.checked_mul(price).unwrap();

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc_ata.to_account_info(),
                    to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            cost,
        )?;

        let state_bump = ctx.bumps.state;
        let state_seeds = &[STATE_SEED, &[state_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_olv_ata.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                &[state_seeds],
            ),
            amount,
        )?;

        ctx.accounts.state.sold_supply += amount;
        Ok(())
    }
}

// ---------------- ACCOUNTS ----------------

#[derive(Accounts)]
pub struct SyncHarvestData<'info> {
    #[account(mut, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, GlobalState>,

    /// The Switchboard aggregator account providing harvest data
    #[account(
        constraint = aggregator.key() == state.oracle_feed @ OliveError::InvalidOracle
    )]
    pub aggregator: AccountLoader<'info, AggregatorAccountData>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 300, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, GlobalState>,

    #[account(init, payer = authority, mint::decimals = DECIMALS, mint::authority = mint_authority)]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA used for minting and revoking authority
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(init, payer = authority, token::mint = mint, token::authority = state, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: SOL treasury wallet
    #[account(mut)]
    pub treasury_sol: UncheckedAccount<'info>,

    /// CHECK: USDC treasury wallet
    #[account(mut)]
    pub treasury_usdc: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyWithSol<'info> {
    #[account(mut, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, GlobalState>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer_ata: Account<'info, TokenAccount>,

    /// CHECK: Verified against state
    #[account(mut, constraint = treasury_sol.key() == state.treasury_sol)]
    pub treasury_sol: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyWithUsdc<'info> {
    #[account(mut, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, GlobalState>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer_olv_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer_usdc_ata: Account<'info, TokenAccount>,

    /// CHECK: Verified against state
    #[account(mut, constraint = treasury_usdc_ata.key() == state.treasury_usdc)]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}