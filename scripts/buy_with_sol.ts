import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OliveDao } from "../target/types/olive_dao";

const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenzQdQhRnJ1Jd6YtA3V7R1HcP3nm3b1Qb7PbmjP5"
);

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.OliveDao as Program<OliveDao>;

(async () => {
  const state = anchor.web3.Keypair.generate();

  const [mintAuthorityPda] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint-authority")],
      program.programId
    );

  const mintAddress = new anchor.web3.PublicKey("REPLACE_WITH_MINT");

  const buyerTokenAccount = await anchor.utils.token.associatedAddress({
    mint: mintAddress,
    owner: provider.wallet.publicKey,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  await program.methods
    .buyWithSol(new anchor.BN(10))
    .accounts({
      state: state.publicKey,
      mint: mintAddress,
      mintAuthority: mintAuthorityPda,
      treasury: provider.wallet.publicKey,
      buyer: provider.wallet.publicKey,
      buyerTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([state])
    .rpc();

  console.log("✅ Bought 10 OLV tokens");
})();
