use anchor_lang::prelude::*;

pub const GLOBAL_STATE_SEED: &[u8] = b"global-state";
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint-authority";
pub const VAULT_SEED: &[u8] = b"vault";

pub const OLV_DECIMALS: u8 = 6;
pub const TOTAL_SUPPLY: u64 = 10_000_000 * 10u64.pow(OLV_DECIMALS as u32);
