#!/bin/bash
set -e

# Paths for keypairs
STATE_KEYPAIR="./state.json"
TREASURY_KEYPAIR="./treasury.json"

# Program ID of your deployed DAO program
PROGRAM_ID="FGQnunbYqLLKxh2qdfzn2nmeJjxP3FSLQMirKJwzZrtp"

echo "==============================="
echo "Creating DAO state account..."
solana-keygen new --no-bip39-passphrase -o $STATE_KEYPAIR --force
STATE_PUBKEY=$(solana-keygen pubkey $STATE_KEYPAIR)
echo "DAO state pubkey: $STATE_PUBKEY"

echo "==============================="
echo "Creating Treasury account..."
solana-keygen new --no-bip39-passphrase -o $TREASURY_KEYPAIR --force
TREASURY_PUBKEY=$(solana-keygen pubkey $TREASURY_KEYPAIR)
echo "Treasury pubkey: $TREASURY_PUBKEY"

echo "==============================="
echo "Deriving Mint Authority PDA..."

# Derive PDA using seeds ["mint", state_pubkey] and program ID
MINT_AUTHORITY_PDA=$(solana address -k <(solana-keygen new --no-bip39-passphrase --silent --outfile /tmp/mint_temp.json) 2>/dev/null)
# Note: We'll replace this with proper derivation using solana CLI below

# Proper derivation using solana CLI:
# Solana CLI can't directly do findProgramAddress, so use Node.js/Anchor instead
MINT_AUTHORITY_PDA=$(node -e "
const anchor = require('@project-serum/anchor');
(async () => {
  const [pda, _] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from('mint'), new anchor.web3.PublicKey('$STATE_PUBKEY').toBuffer()],
    new anchor.web3.PublicKey('$PROGRAM_ID')
  );
  console.log(pda.toBase58());
})();
")

echo "Mint Authority PDA: $MINT_AUTHORITY_PDA"

echo "==============================="
echo "All accounts ready!"
echo "State: $STATE_PUBKEY"
echo "Treasury: $TREASURY_PUBKEY"
echo "Mint Authority PDA: $MINT_AUTHORITY_PDA"
#!/bin/bash

