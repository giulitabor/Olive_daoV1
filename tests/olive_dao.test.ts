import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OliveDao } from "../target/types/olive_dao";
import { assert } from "chai";

describe("olive_dao", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.OliveDao as Program<OliveDao>;
  const authority = provider.wallet;

  let statePda: anchor.web3.PublicKey;
  let proposalPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;

  it("Initialize DAO", async () => {
    [statePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );

    await program.methods.initialize().accounts({
      state: statePda,
      authority: authority.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();

    const state = await program.account.state.fetch(statePda);
    assert.ok(state.authority.equals(authority.publicKey));
  });

  it("Create proposal", async () => {
    const state = await program.account.state.fetch(statePda);

    [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(state.proposalCount).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .createProposal("Test payout", new anchor.BN(500_000_000))
      .accounts({
        state: statePda,
        proposal: proposalPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.executed, false);
  });

  it("Fails execution before timelock", async () => {
    try {
      await program.methods.executeProposal().accounts({
        proposal: proposalPda,
        vault: vaultPda,
        creator: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).rpc();
      assert.fail("Should fail");
    } catch (e) {
      assert.ok(e.toString().includes("ExecutionTimelocked"));
    }
  });
});
