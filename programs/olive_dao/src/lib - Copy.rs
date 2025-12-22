use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, MintTo, mint_to};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::Token2022;

declare_id!("8XDLGS1wQNgTZ6z5pymBtrjbxWnEtddN4q5mCzzmxBds");

#[program]
pub mod olive_dao {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, token_price: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.mint = ctx.accounts.mint.key();
        state.mint_authority = ctx.accounts.mint_authority.key();
        state.treasury = ctx.accounts.treasury.key();
        state.token_price = token_price;
        state.owner = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn buy_with_sol(ctx: Context<BuyWithSol>, amount: u64) -> Result<()> {
        let total_price = amount
            .checked_mul(ctx.accounts.state.token_price)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        let bump = ctx.bumps.mint_authority;
        let seeds = &[b"mint-authority".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );

        mint_to(cpi_ctx, amount)?;

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.treasury.key(),
            total_price,
        );

        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, new_price: u64) -> Result<()> {
        ctx.accounts.state.token_price = new_price;
        Ok(())
    }
}

#[account]
pub struct State {
    pub mint: Pubkey,
    pub mint_authority: Pubkey,
    pub treasury: Pubkey,
    pub token_price: u64,
    pub owner: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 * 4 + 8)]
    pub state: Account<'info, State>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(seeds = [b"mint-authority"], bump)]
    /// CHECK: PDA mint authority
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Treasury chosen at initialization
    pub treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct BuyWithSol<'info> {
    #[account(mut, has_one = mint, has_one = treasury)]
    pub state: Account<'info, State>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(seeds = [b"mint-authority"], bump)]
    /// CHECK: PDA mint authority
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut, address = state.treasury)]
    /// CHECK: Must match treasury in state
    pub treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut, has_one = owner)]
    pub state: Account<'info, State>,
    pub owner: Signer<'info>,
}

