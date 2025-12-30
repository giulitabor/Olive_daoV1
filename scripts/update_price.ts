import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OliveDao } from "../target/types/olive_dao";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.OliveDao as Program<OliveDao>;

(async () => {
  const [statePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  await program.methods
    .updatePrice(new anchor.BN(150_000_000)) // 0.15 SOL per token
    .accounts({
      state: statePda,
      authority: provider.wallet.publicKey,
    })
    .rpc();

  console.log("✅ Token price updated via oracle simulation");
})();
