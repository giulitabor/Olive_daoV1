const anchor = require("@coral-xyz/anchor");
const { Program, BN } = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const idl = require("../target/idl/olive_dao.json");

describe("olive_dao", () => {
  // Use localnet provider
  const provider = anchor.AnchorProvider.local("http://127.0.0.1:8899");
  anchor.setProvider(provider);

  // Program ID
  const programId = new PublicKey("B3EdVG6FJndxAemD9fXqVSYmoqhmY11TZShuTHGjV5Wz");
  const program = new anchor.Program(idl, provider);

  // PDA for state
  let statePDA;
  let stateBump;

  // PDA for proposal
  let proposalPDA;
  let proposalBump;

  it("Initialize DAO", async () => {
    [statePDA, stateBump] = await PublicKey.findProgramAddress(
      [Buffer.from("state")],
      program.programId
    );

    console.log("State PDA:", statePDA.toBase58());

    await program.methods
      .initialize()
      .accounts({
        state: statePDA,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fetch and log state account
    const stateAccount = await program.account.state.fetch(statePDA);
    console.log("DAO state:", stateAccount);
  });

  it("Create a proposal", async () => {
    const proposalIndex = 0; // first proposal
    [proposalPDA, proposalBump] = await PublicKey.findProgramAddress(
      [Buffer.from("proposal"), new BN(proposalIndex).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    console.log("Proposal PDA:", proposalPDA.toBase58());

    await program.methods
      .createProposal("Test Proposal")
      .accounts({
        state: statePDA,
        proposal: proposalPDA,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fetch and log proposal account
    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    console.log("Proposal account:", proposalAccount);
  });
});
