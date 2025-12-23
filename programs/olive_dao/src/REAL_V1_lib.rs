use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("B3EdVG6FJndxAemD9fXqVSYmoqhmY11TZShuTHGjV5Wz");

#[program]
pub mod olive_dao {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.proposal_count = 0;
        Ok(())
    }

    pub fn join_dao(ctx: Context<JoinDao>, amount: u64) -> Result<()> {
        // Price: 0.001 SOL per token (Adjust as needed)
        // 1 token = 1,000,000,000 lamports (if 9 decimals)
        let sol_price = amount / 1000; 

        // 1. Transfer SOL to Treasury
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, sol_price)?;

        // 2. Mint tokens to user
        let state_seeds = &[b"state".as_ref(), &[ctx.bumps.state]];
        let signer = &[&state_seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.olv_mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::mint_to(CpiContext::new_with_signer(cpi_program, cpi_accounts, signer), amount)?;

        Ok(())
    }

    pub fn create_proposal(ctx: Context<CreateProposal>, title: String, amount: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let state = &mut ctx.accounts.state;
        let clock = Clock::get()?;

        proposal.id = state.proposal_count;
        proposal.creator = ctx.accounts.authority.key();
        proposal.title = title;
        proposal.requested_amount = amount;
        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.executed = false;
        proposal.created_at = clock.unix_timestamp;

        state.proposal_count += 1;
        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, increment_yes: bool) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp < proposal.created_at + 86400, OliveError::ProposalExpired);

        let weight = ctx.accounts.voter_token_account.amount;
        require!(weight > 0, OliveError::NoTokens);

        if increment_yes {
            proposal.yes_votes += weight;
        } else {
            proposal.no_votes += weight;
        }

        ctx.accounts.vote_record.voted = true;
        Ok(())
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        
        require!(proposal.yes_votes > proposal.no_votes, OliveError::ProposalFailed);
        require!(!proposal.executed, OliveError::AlreadyExecuted);

        let amount = proposal.requested_amount;
        let vault_info = ctx.accounts.vault.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();

        require!(vault_info.lamports() >= amount, OliveError::InsufficientVaultFunds);

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **creator_info.try_borrow_mut_lamports()? += amount;

        proposal.executed = true;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8, seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinDao<'info> {
    #[account(mut, seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
    #[account(mut)]
    /// CHECK:` MINT
    pub olv_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = olv_mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault"], bump)]
    /// CHECK: Treasury
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
    #[account(
        init, payer = authority, 
        space = 8 + 8 + 32 + (4 + 64) + 8 + 8 + 8 + 1 + 8, 
        seeds = [b"proposal", state.proposal_count.to_le_bytes().as_ref()], 
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(init, payer = voter, space = 8 + 1, seeds = [b"vote_record", proposal.key().as_ref(), voter.key().as_ref()], bump)]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(constraint = voter_token_account.mint == olv_mint.key())]
    pub voter_token_account: Account<'info, TokenAccount>,
    /// CHECK: MINt 
    pub olv_mint: AccountInfo<'info>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut, seeds = [b"vault"], bump)]
    /// CHECK: Treasury PDA
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub creator: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account] pub struct State { pub authority: Pubkey, pub proposal_count: u64 }
#[account] pub struct VoteRecord { pub voted: bool }
#[account] pub struct Proposal {
    pub id: u64, pub creator: Pubkey, pub title: String, 
    pub requested_amount: u64, pub yes_votes: u64, pub no_votes: u64, 
    pub executed: bool, pub created_at: i64 
}

#[error_code]
pub enum OliveError {
    #[msg("Voting period has ended")] ProposalExpired,
    #[msg("No OLV tokens")] NoTokens,
    #[msg("Proposal failed")] ProposalFailed,
    #[msg("Already paid")] AlreadyExecuted,
    #[msg("Vault empty")] InsufficientVaultFunds,
}