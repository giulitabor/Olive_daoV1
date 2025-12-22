use anchor_lang::prelude::*;

#[error_code]
pub enum OliveError {
    #[msg("Protocol is paused")]
    ProtocolPaused,

    #[msg("Insufficient tokens in vault")]
    InsufficientSupply,

    #[msg("Invalid authority")]
    InvalidAuthority,
}
