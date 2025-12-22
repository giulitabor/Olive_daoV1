import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OliveDao } from "../target/types/olive_dao";
import { assert } from "chai";

describe("olive_dao", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.OliveDao as Program<OliveDao>;

  // Fresh state PDA per test run
  const state = anchor.web3.Keypair.generate();
  let stateAccount: any;

  // Keep track of proposal PDAs
  const proposalPDAs: anchor.web3.PublicKey[] = [];

  it("Initialize DAO", async () => {
    await program.methods
      .initialize()
      .accounts({
        state: state.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([state])
      .rpc();

    stateAccount = await program.account.state.fetch(state.publicKey);
    console.log("State PDA:", state.publicKey.toBase58());
    assert.equal(stateAccount.proposalCount.toNumber(), 0, "Proposal count should start at 0");
  });

  // Function to create proposals dynamically
  async function createProposal(title: string, description: string = "") {
    const proposalIndex = stateAccount.proposalCount.toNumber();

    const [proposalPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("proposal"),
        Buffer.from(Uint8Array.of(proposalIndex)),
      ],
      program.programId
    );

    await program.methods
      .createProposal(title)
      .accounts({
        state: state.publicKey,
        proposal: proposalPDA,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    stateAccount = await program.account.state.fetch(state.publicKey);

    console.log(`Proposal created: ${title}`);
    console.log("Proposal PDA:", proposalPDA.toBase58());

    proposalPDAs.push(proposalPDA);

    // Assert proposal exists and matches title
    const proposal = await program.account.proposal.fetch(proposalPDA);
    assert.equal(proposal.title, title, "Proposal title mismatch");
  }

  it("Create multiple proposals", async () => {
    await createProposal("My First Proposal", "Description 1");
    await createProposal("Second Proposal", "Description 2");
    await createProposal("Third Proposal", "Description 3");

    assert.equal(stateAccount.proposalCount.toNumber(), 3, "Proposal count should be 3");
  });

  // Example: add votes to proposals
  async function voteOnProposal(proposalIndex: number, vote: boolean) {
    const proposalPDA = proposalPDAs[proposalIndex];

    await program.methods
      .vote(vote)
      .accounts({
        state: state.publicKey,
        proposal: proposalPDA,
        voter: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPDA);
    console.log(`Proposal "${proposal.title}" vote updated.`);
  }

  it("Vote on proposals", async () => {
    await voteOnProposal(0, true);
    await voteOnProposal(1, false);
  });
});
