import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type{ OliveDao } from "../target/types/olive_dao";
import { assert } from "chai";

describe("olive_dao", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.OliveDao as Program<OliveDao>;

  // Find the State PDA
  const [statePDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  const proposalPDAs: anchor.web3.PublicKey[] = [];

  it("Initialize DAO", async () => {
  // Check if account exists
  const info = await provider.connection.getAccountInfo(statePDA);
  
  if (info === null) {
    await program.methods
      .initialize()
      .accounts({
        state: statePDA,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("DAO Initialized!");
  } else {
    console.log("DAO already initialized, skipping...");
  }

    const stateAccount = await program.account.state.fetch(statePDA);
    assert.equal(stateAccount.proposalCount.toNumber(), 0);
  });

  it("Create Proposals", async () => {
    for (let i = 0; i < 2; i++) {
      const stateAccount = await program.account.state.fetch(statePDA);
      
      // Calculate Proposal PDA: "proposal" + u64 index
      const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("proposal"),
          stateAccount.proposalCount.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createProposal(`Proposal #${i}`)
        .accounts({
          state: statePDA,
          proposal: proposalPDA,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      proposalPDAs.push(proposalPDA);
    }
  });

  it("Vote on proposals", async () => {
    await program.methods
      .vote(true) // Vote YES
      .accounts({
        proposal: proposalPDAs[0],
        voter: provider.wallet.publicKey,
      })
      .rpc();

    const prop = await program.account.proposal.fetch(proposalPDAs[0]);
    assert.equal(prop.yesVotes.toNumber(), 1);
  });
});