import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import idl from "./idl.json";

const programId = new PublicKey("B3EdVG6FJndxAemD9fXqVSYmoqhmY11TZShuTHGjV5Wz");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Helper to get Anchor Program instance
const getProgram = () => {
  const provider = new anchor.AnchorProvider(
    connection,
    (window as any).solana,
    { preflightCommitment: "confirmed" }
  );
  return new anchor.Program(idl as any, programId, provider);
};

// 1. Connect Wallet
document.querySelector('#connect')?.addEventListener('click', async () => {
  const resp = await (window as any).solana.connect();
  document.querySelector('#wallet-addr')!.innerHTML = `Connected: ${resp.publicKey.toString().slice(0, 6)}...`;
  renderProposals();
});

// 2. Create Proposal
document.querySelector('#create-btn')?.addEventListener('click', async () => {
  const title = (document.querySelector('#title-input') as HTMLInputElement).value;
  if (!title) return alert("Enter a title");

  const program = getProgram();
  const [statePDA] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
  const stateAccount = await program.account.state.fetch(statePDA);

  const [proposalPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), stateAccount.proposalCount.toArrayLike(Buffer, "le", 8)],
    programId
  );

  await program.methods.createProposal(title).accounts({
    state: statePDA,
    proposal: proposalPDA,
    authority: program.provider.publicKey,
  }).rpc();

  alert("Proposal Created!");
  renderProposals();
});

// 3. Render Proposals
async function renderProposals() {
  const program = getProgram();
  const proposals = await program.account.proposal.all();
  const container = document.querySelector('#proposal-list')!;
  container.innerHTML = "";

  proposals.forEach((p) => {
    const card = document.createElement('div');
    card.className = "card";
    card.innerHTML = `
      <h4>${p.account.title}</h4>
      <p class="status">ID: ${p.account.id.toString()}</p>
      <p>✅ Yes: ${p.account.yesVotes.toString()} | ❌ No: ${p.account.noVotes.toString()}</p>
      <div class="vote-btns">
        <button onclick="window.vote('${p.publicKey.toString()}', true)">Vote Yes</button>
        <button style="background:#f44336" onclick="window.vote('${p.publicKey.toString()}', false)">Vote No</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// 4. Global Vote Function
(window as any).vote = async (pubkeyStr: string, side: boolean) => {
  const program = getProgram();
  await program.methods.vote(side).accounts({
    proposal: new PublicKey(pubkeyStr),
    voter: program.provider.publicKey,
  }).rpc();
  renderProposals();
};