import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { Program, AnchorProvider, web3, BN } from "@project-serum/anchor";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
//import fs from "fs";
const idl = JSON.parse(fs.readFileSync("./target/idl/olive_dao.json", "utf8"));

// ----------------------------
// CONFIGURATION
// ----------------------------
const PROGRAM_ID = new PublicKey("FGQnunbYqLLKxh2qdfzn2nmeJjxP3FSLQMirKJwzZrtp");
const MINT_ADDRESS = new PublicKey("5tuxvjjUCBy2grf8TSyj9bbXvcf1zWDbuwk1XY1ipN3o");
const TOKEN_PRICE = new BN(1_000_000_000); // lamports
const WALLET_KEYPAIR_PATH = "~/.config/solana/id.json"; // Your wallet

// ----------------------------
// MAIN FUNCTION
// ----------------------------
(async () => {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load wallet
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_KEYPAIR_PATH, "utf8")))
  );

  const provider = new AnchorProvider(connection, { publicKey: walletKeypair.publicKey, signTransaction: (tx) => walletKeypair.signTransaction(tx), signAllTransactions: (txs) => walletKeypair.signAllTransactions(txs) }, {});
  const program = new Program(idl, PROGRAM_ID, provider);

  // ----------------------------
  // 1️⃣ Create DAO state account
  // ----------------------------
  const stateAccount = Keypair.generate();
  console.log("State account:", stateAccount.publicKey.toBase58());

  // ----------------------------
  // 2️⃣ Create treasury account
  // ----------------------------
  const treasuryAccount = Keypair.generate();
  console.log("Treasury account:", treasuryAccount.publicKey.toBase58());

  // ----------------------------
  // 3️⃣ Derive PDA for mint authority
  // ----------------------------
  const [mintAuthorityPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("mint-authority")],
    PROGRAM_ID
  );
  console.log("Mint Authority PDA:", mintAuthorityPDA.toBase58());

  // ----------------------------
  // 4️⃣ Set mint authority to PDA
  // ----------------------------
  const token = new Token(connection, MINT_ADDRESS, TOKEN_PROGRAM_ID, walletKeypair);
  await token.setAuthority(
    MINT_ADDRESS,
    mintAuthorityPDA,
    "MintTokens",
    walletKeypair.publicKey,
    [walletKeypair]
  );
  console.log("Mint authority updated to PDA.");

  // ----------------------------
  // 5️⃣ Initialize DAO program
  // ----------------------------
  await program.methods.initialize(TOKEN_PRICE)
    .accounts({
      state: stateAccount.publicKey,
      mint: MINT_ADDRESS,
      mintAuthority: mintAuthorityPDA,
      treasury: treasuryAccount.publicKey,
      authority: walletKeypair.publicKey,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([stateAccount])
    .rpc();

  console.log("✅ DAO initialized successfully!");
})();
import fs from "fs";
import pkg from "@project-serum/anchor";
const { Program, AnchorProvider, web3, BN } = pkg;

const idl = JSON.parse(fs.readFileSync("./target/idl/olive_dao.json", "utf8"));

// --- Connection & Wallet ---
const connection = new web3.Connection(web3.clusterApiUrl("devnet"));
const wallet = web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")))
);
const provider = new AnchorProvider(connection, wallet, { preflightCommitment: "processed" });

// --- Program ---
const programId = new web3.PublicKey("FGQnunbYqLLKxh2qdfzn2nmeJjxP3FSLQMirKJwzZrtp");
const program = new Program(idl, programId, provider);

// --- Helper: derive PDA for state & treasury ---
const [statePDA, stateBump] = await web3.PublicKey.findProgramAddress(
  [Buffer.from("state")],
  program.programId
);

const [treasuryPDA, treasuryBump] = await web3.PublicKey.findProgramAddress(
  [Buffer.from("treasury")],
  program.programId
);

// --- Mint (assuming you already created a mint) ---
const mint = new web3.PublicKey("5tuxvjjUCBy2grf8TSyj9bbXvcf1zWDbuwk1XY1ipN3o");

// --- Initialize DAO ---
(async () => {
  try {
    console.log("Initializing DAO...");
    
    const tx = await program.methods
      .initialize(new BN(1_000_000_000)) // token_price in lamports (1 SOL = 1_000_000_000 lamports)
      .accounts({
        state: statePDA,
        mint: mint,
        mintAuthority: wallet.publicKey,
        treasury: treasuryPDA,
        authority: wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: web3.TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("DAO initialized!");
    console.log("Transaction signature:", tx);
    console.log("State PDA:", statePDA.toBase58());
    console.log("Treasury PDA:", treasuryPDA.toBase58());
  } catch (err) {
    console.error("Error initializing DAO:", err);
  }
})();
#!/bin/bash
set -e

# Paths for keypairs
STATE_KEY="./state.json"
TREASURY_KEY="./treasury.json"

# Create state keypair if it doesn't exist
if [ ! -f "$STATE_KEY" ]; then
  echo "Creating DAO state account..."
  solana-keygen new --outfile "$STATE_KEY" --no-bip39-passphrase
  echo "State account saved to $STATE_KEY"
else
  echo "State account already exists at $STATE_KEY"
fi

# Create treasury keypair if it doesn't exist
if [ ! -f "$TREASURY_KEY" ]; then
  echo "Creating treasury account..."
  solana-keygen new --outfile "$TREASURY_KEY" --no-bip39-passphrase
  echo "Treasury account saved to $TREASURY_KEY"
else
  echo "Treasury account already exists at $TREASURY_KEY"
fi

# Export environment variables for Node.js script
export STATE_KEY
export TREASURY_KEY

# Run Node.js initialization which calls the initialize() RPC
echo "Running Node.js DAO initialization..."
node initialize_dao.js

echo "✅ DAO initialized successfully!"
