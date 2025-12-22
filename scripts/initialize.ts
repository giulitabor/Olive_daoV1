import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OliveDao } from "../target/types/olive_dao";

// Official SPL Token-2022 program ID
const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenzQdQhRnJ1Jd6YtA3V7R1HcP3nm3b1Qb7PbmjP5"
);

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.OliveDao as Program<OliveDao>;

(async () => {
  const [statePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );
  const [mintAuthorityPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    program.programId
  );
  const [treasuryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  const mint = anchor.web3.Keypair.generate();

  await program.methods
    .initialize()
    .accounts({
      state: statePda,
      mint: mint.publicKey,
      mintAuthority: mintAuthorityPda,
      treasury: treasuryPda,
      authority: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([mint])
    .rpc();

  console.log("✅ OLV DAO initialized");
  console.log("Mint address:", mint.publicKey.toBase58());
})();
