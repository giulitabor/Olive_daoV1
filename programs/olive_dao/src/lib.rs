use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("8MdiqqhZj1badeLArqCmZWeiWGK8tXQWiydRLcqzDn45");

const EXECUTION_DELAY: i64 = 60;
const JOIN_FEE: u64 = 10_000_000; // 0.01 SOL in lamports

#[program]
pub mod olive_dao {
    use super::*;

    /// 1. Initialize the global DAO state and Vault
    pub fn init_dao(ctx: Context<InitDao>) -> Result<()> {
        let dao = &mut ctx.accounts.dao;
        dao.authority = ctx.accounts.authority.key();
        dao.stake_mint = ctx.accounts.stake_mint.key();
        dao.total_staked = 0;
        dao.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// 2. Fund the vault directly (Donations)
    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )
    }

    /// 3. Stake tokens + Pay 0.01 SOL Treasury Fee
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        // A. Charge the 0.01 SOL joining/top-up fee
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            JOIN_FEE,
        )?;

        // B. Transfer SPL tokens from user to Stake Vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let dao = &mut ctx.accounts.dao;
        let stake_account = &mut ctx.accounts.stake_account;

        if stake_account.amount == 0 {
            stake_account.owner = ctx.accounts.user.key();
        }

        stake_account.amount += amount;
        stake_account.last_update = Clock::get()?.unix_timestamp;
        dao.total_staked += amount;

        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let dao = &mut ctx.accounts.dao;
        let stake_account = &mut ctx.accounts.stake_account;

        require!(stake_account.amount >= amount, OliveError::InsufficientStake);

        let user_key = ctx.accounts.user.key();
        let seeds = &[
            b"stake_vault",
            user_key.as_ref(),
            &[ctx.bumps.stake_vault],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.stake_vault.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        stake_account.amount -= amount;
        dao.total_staked -= amount;
        Ok(())
    }

    pub fn create_proposal(ctx: Context<CreateProposal>, description: String, duration: i64, payout: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let now = Clock::get()?.unix_timestamp;

        proposal.dao = ctx.accounts.dao.key();
        proposal.creator = ctx.accounts.creator.key();
        proposal.description = description;
        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.start_ts = now;
        proposal.end_ts = now + duration;
        proposal.execute_after = proposal.end_ts + EXECUTION_DELAY;
        proposal.payout = payout;
        proposal.executed = false;
        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, support: bool) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let stake = &ctx.accounts.stake_account;
        let now = Clock::get()?.unix_timestamp;

        require!(now <= proposal.end_ts, OliveError::VotingClosed);
        require!(stake.amount > 0, OliveError::NoStake);

        if support {
            proposal.yes_votes += stake.amount;
        } else {
            proposal.no_votes += stake.amount;
        }

        ctx.accounts.vote_record.voted = true;
        Ok(())
    }

   pub fn execute(ctx: Context<Execute>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let now = Clock::get()?.unix_timestamp;

        require!(!proposal.executed, OliveError::AlreadyExecuted);
        require!(now >= proposal.execute_after, OliveError::TimelockActive);
        require!(proposal.yes_votes > proposal.no_votes, OliveError::ProposalRejected);

        let vault_lamports = ctx.accounts.vault.lamports();
        require!(vault_lamports >= proposal.payout, OliveError::VaultEmpty);

        // Define the seeds as a simple slice of bytes
        let vault_bump = ctx.accounts.dao.vault_bump;
        let seeds = &[
            b"vault".as_ref(),
            &[vault_bump],
        ];
        let signer = &[&seeds[..]];

        // Perform the transfer
        **ctx.accounts.vault.try_borrow_mut_lamports()? -= proposal.payout;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += proposal.payout;

        proposal.executed = true;
        Ok(())
    }
}

// --- CONTEXTS ---

#[derive(Accounts)]
pub struct InitDao<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 8 + 1, seeds = [b"dao"], bump)]
    pub dao: Account<'info, Dao>,
    pub stake_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    /// CHECK: SOL Vault PDA
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [b"dao"], bump)]
    pub dao: Account<'info, Dao>,
    #[account(mut, seeds = [b"vault"], bump)]
    /// CHECK: Receives Fee
    pub vault: AccountInfo<'info>,
    #[account(init_if_needed, payer = user, space = 8 + 32 + 8 + 8, seeds = [b"stake", user.key().as_ref()], bump)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(init_if_needed, payer = user, token::mint = stake_mint, token::authority = stake_vault, seeds = [b"stake_vault", user.key().as_ref()], bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    pub stake_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"dao"], bump)]
    pub dao: Account<'info, Dao>,
    #[account(mut, seeds = [b"stake", user.key().as_ref()], bump)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut, seeds = [b"stake_vault", user.key().as_ref()], bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [b"dao"], bump)]
    pub dao: Account<'info, Dao>,
    #[account(init, payer = creator, space = 8 + 32 + 32 + 200 + 8 + 8 + 8 + 8 + 8 + 1)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(seeds = [b"stake", voter.key().as_ref()], bump)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(init, payer = voter, space = 8 + 1, seeds = [b"vote_record", proposal.key().as_ref(), voter.key().as_ref()], bump)]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(mut, seeds = [b"dao"], bump)]
    pub dao: Account<'info, Dao>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    /// CHECK: Payout Source
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Recipient
    pub recipient: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    /// CHECK: Vault
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

// --- DATA ---

#[account]
pub struct Dao { pub authority: Pubkey, pub stake_mint: Pubkey, pub total_staked: u64, pub vault_bump: u8 }

#[account]
pub struct StakeAccount { pub owner: Pubkey, pub amount: u64, pub last_update: i64 }

#[account]
pub struct Proposal {
    pub dao: Pubkey, pub creator: Pubkey, pub description: String,
    pub yes_votes: u64, pub no_votes: u64, pub start_ts: i64,
    pub end_ts: i64, pub execute_after: i64, pub payout: u64, pub executed: bool,
}

#[account]
pub struct VoteRecord { pub voted: bool }

#[error_code]
pub enum OliveError {
    #[msg("Voting closed")] VotingClosed,
    #[msg("No stake")] NoStake,
    #[msg("Insufficient stake")] InsufficientStake,
    #[msg("Already executed")] AlreadyExecuted,
    #[msg("Timelock active")] TimelockActive,
    #[msg("Rejected")] ProposalRejected,
    #[msg("Unauthorized")] Unauthorized,
    #[msg("Vault empty")] VaultEmpty,
}