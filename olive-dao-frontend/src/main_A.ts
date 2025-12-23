import './polyfill'; 
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import idl from "./idl.json";

const OLV_MINT = new PublicKey("6nab5Rttp45AfjaYrdwGxKuH9vK9RKCJdeaBvQJt8pLA");
const DAO_STAKE_VAULT = new PublicKey("FrNP32Hxhuu4pS8yguHhtTEdU9QpU7odRYi5zKNps15N");
const programId = new PublicKey("B3EdVG6FJndxAemD9fXqVSYmoqhmY11TZShuTHGjV5Wz");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Helper to get Anchor Program
const getProgram = () => {
    const provider = new anchor.AnchorProvider((window as any).solana, (window as any).solana, { preflightCommitment: "confirmed" });
    return new anchor.Program(idl as any, provider);
};

// UI Sync Helper
const updateAll = (className: string, value: string) => {
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) (elements[i] as HTMLElement).innerText = value;
};

// --- CORE FUNCTIONS ATTACHED TO WINDOW ---

(window as any).updateUIBalances = async () => {
    console.log("DEBUG: Refreshing UI Balances...");
    const provider = (window as any).solana;
    if (!provider?.isConnected) 
    console.log("DEBUG:  wallet already connected...");

return;

    const wallet = provider.publicKey;
    const addrStr = wallet.toBase58();
    
    // Connect Button State
    const connectBtn = document.getElementById('connect');
    if (connectBtn) connectBtn.innerText = "CONNECTED";

    // Degen Address Display (First 5)
    updateAll("val-addr", addrStr.slice(0, 5));

    try {
        const solBal = await connection.getBalance(wallet);
        const solVal = (solBal / LAMPORTS_PER_SOL).toFixed(3);
        console.log(`DEBUG: Wallet SOL: ${solVal}`);
        updateAll("val-sol", solVal);

        const ata = getAssociatedTokenAddressSync(OLV_MINT, wallet);
        const tokenBal = await connection.getTokenAccountBalance(ata);
        const olvVal = (tokenBal.value.uiAmount ?? 0).toFixed(2);
        console.log(`DEBUG: Wallet OLV: ${olvVal}`);
        updateAll("val-olv", olvVal);

        const vaultSol = await connection.getBalance(DAO_STAKE_VAULT);
        updateAll("val-tvl", (vaultSol / LAMPORTS_PER_SOL).toFixed(2) + " SOL");
    } catch (err) {
        console.warn("DEBUG: Balance fetch partial failure (likely missing token account)");
    }
};

(window as any).renderProposals = async () => {
    console.log("DEBUG: Refreshing UI Proposals...");

  const program = getProgram();
  const proposals = await program.account.proposal.all();
  const container = document.querySelector('#proposal-list')!;
  container.innerHTML = "";
  const now = Math.floor(Date.now() / 1000);

  for (const p of proposals) {
    const req = (p.account.requestedAmount.toNumber() / 1e9).toFixed(2);
    const yes = (p.account.yesVotes.toNumber() / 1e9).toLocaleString();
    const no = (p.account.noVotes.toNumber() / 1e9).toLocaleString();
    
    // Calculate 24-hour expiry (86400 seconds)
    const expiry = p.account.createdAt.toNumber() + 86400;
    const isExpired = now > expiry;
    const timeLeft = expiry - now;

    const card = document.createElement('div');
    card.className = "card";
    
    // Timer Logic
    const timerText = isExpired 
      ? `<span style="color: #ff4a4a;">CLOSED</span>` 
      : `<span style="color: #00ffa3;">${Math.floor(timeLeft/3600)}h ${Math.floor((timeLeft%3600)/60)}m left</span>`;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between;">
        <small>ID: ${p.publicKey.toBase58().slice(0,4)}</small>
        <small>${timerText}</small>
      </div>
      <h3>${p.account.title}</h3>
      <p>Target: <strong>${req} SOL</strong></p>
      <div style="background:#222; padding:10px; border-radius:5px; margin:10px 0;">
        <p style="margin:0;">👍 Yes: ${yes} | 👎 No: ${no}</p>
      </div>
      
      <div class="actions">
        ${!isExpired ? `
          <button onclick="window.vote('${p.publicKey}', true)" style="background:#00ffa3; color:#000; margin-right:5px;">Vote Yes</button>
          <button onclick="window.vote('${p.publicKey}', false)" style="background:#ff4a4a; color:#fff;">Vote No</button>
        ` : ''}
        
        ${isExpired && !p.account.executed ? `
          <button onclick="window.execute('${p.publicKey}')" style="width:100%; background:#fff; color:#000;">Execute & Payout</button>
        ` : ''}
        
        ${p.account.executed ? `<p style="color:#888; text-align:center;">✅ Executed</p>` : ''}
      </div>
    `;
    container.appendChild(card);
  }
}
(window as any).stakeOLV = async () => {
    const val = (document.getElementById('stake-input') as HTMLInputElement).value;
    console.log(`DEBUG: Action -> Stake ${val} OLV`);
    alert(`Degen Transaction Initiated: Staking ${val} OLV`);
    // Logic: await program.methods.stake(new anchor.BN(val)).rpc();
};

(window as any).createProposal = async () => {
    const title = (document.getElementById('prop-title') as HTMLInputElement).value;
    console.log(`DEBUG: Action -> Create Proposal: ${title}`);
    alert("DAO Submission Broadcasted");
};

// --- VOTING LOGIC ---
(window as any).vote = async (id: string, side: boolean) => {
  try {
    const program = getProgram();
    const propKey = new PublicKey(id);
    const voter = program.provider.publicKey!;
    const ata = getAssociatedTokenAddressSync(OLV_MINT, voter);
    
    // Derive the unique Vote Record PDA for this user/proposal
    const [rec] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_record"), propKey.toBuffer(), voter.toBuffer()], 
      programId
    );

    console.log("Casting vote...");
    await program.methods.vote(side).accounts({
      proposal: propKey,
      voteRecord: rec,
      voterTokenAccount: ata,
      olvMint: OLV_MINT,
      voter,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();

    alert("Vote cast successfully!");
    renderProposals();
  } catch (err: any) {
    console.error("Vote failed:", err);
    alert("Voting failed. Do you have OLV tokens?");
  }
};

// --- EXECUTION LOGIC ---
(window as any).execute = async (id: string) => {
  try {
    const program = getProgram();
    const propKey = new PublicKey(id);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
    
    const data = await program.account.proposal.fetch(propKey);
    
    await program.methods.executeProposal().accounts({
      proposal: propKey,
      vault,
      creator: data.creator,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();

    alert("Proposal executed! Funds sent to creator.");
    renderProposals();
    updateUIBalances();
  } catch (err: any) {
    alert("Execution failed: " + err.message);
  }
};
(window as any).showView = (viewId: string) => {
    console.log(`DEBUG: Routing to ${viewId}`);
    const views = ['view-home', 'view-voting', 'view-market', 'view-game'];
    views.forEach(v => document.getElementById(v)?.classList.add('hidden'));
    document.getElementById(`view-${viewId}`)?.classList.remove('hidden');
    
    if (viewId === 'voting') {
        (window as any).updateUIBalances();
        (window as any).renderProposals();
    }
};

// --- BOOTSTRAP ---
window.addEventListener('load', async () => {
    const provider = (window as any).solana;
    if (provider) {
        provider.on("connect", () => {
            console.log("DEBUG: Wallet Connected Event");
            (window as any).showView('voting');
        });
        try { await provider.connect({ onlyIfTrusted: true }); } catch (e) {}
    }

    document.getElementById('connect')?.addEventListener('click', async () => {
        if (provider?.isConnected) await provider.disconnect();
        else await provider.connect();
    });

    (window as any).showView('home');
});