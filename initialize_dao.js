import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, Program, web3, BN } = anchorPkg;
import fs from "fs";

// ---- Setup provider ----
const provider = AnchorProvider.env();
anchorPkg.setProvider(provider);

// ---- Load IDL ----
const idl = JSON.parse(fs.readFileSync("./target/idl/olive_dao.json", "utf8"));

// ---- Program ID (DEPLOYED) ----
const programId = new web3.PublicKey("AFgep1Bo5rqsBYTRNqFvGHSAR9hrsWAq93n6UMFxCx22");

// ---- Program ----
const program = new Program(idl, programId, provider);

// ---- Your new SPL 2022 token mint ----
const mint = new web3.PublicKey("7eiwNiei5ePBxhT9rSNw6qL4RREDUi6wgg8z9DdawtFk");

(async () => {
  // ---- PDAs ----
  const [statePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  const [mintAuthorityPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    program.programId
  );

  const [treasuryPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  console.log("State PDA:", statePda.toBase58());
  console.log("Mint Authority PDA:", mintAuthorityPda.toBase58());
  console.log("Treasury PDA:", treasuryPda.toBase58());

  // ---- Call initialize ----
  await program.methods
    .initialize(new BN(1_000_000)) // example token price
    .accounts({
      state: statePda,
      authority: provider.wallet.publicKey,
      mint,
      mintAuthority: mintAuthorityPda,
      treasury: treasuryPda,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: program.programId, // 2022 token program, Anchor handles it
    })
    .rpc();

  console.log("✅ DAO initialized");
})();
