import './polyfill'; 
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import idl from "./idl.json";


// --- CONFIG ---
const OLV_MINT = new PublicKey("6nab5Rttp45AfjaYrdwGxKuH9vK9RKCJdeaBvQJt8pLA");
const programId = new PublicKey("B3EdVG6FJndxAemD9fXqVSYmoqhmY11TZShuTHGjV5Wz");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const ADMIN_WALLET = "8xkNHk2VpWBM6Nk3enitFCs7vwh2inCveTNintcXHc54";

const getProgram = () => {
  const provider = new anchor.AnchorProvider(connection, (window as any).solana, { preflightCommitment: "confirmed" });
  return new anchor.Program(idl as any, provider);
};

// --- NAVIGATION LOGIC ---
(window as any).showView = (view: 'home' | 'voting') => {
  const home = document.getElementById('view-home')!;
  const voting = document.getElementById('view-voting')!;
  
  if (view === 'voting') {
    home.classList.add('hidden');
    voting.classList.remove('hidden');
    renderProposals();
    getMintSupply();
  } else {
    home.classList.remove('hidden');
    voting.classList.add('hidden');
  }
};

// --- UI UPDATES ---
async function updateUIBalances() {
  try {
    const program = getProgram();
    const wallet = program.provider.publicKey;
    if (!wallet) return;

    const adminPanel = document.getElementById("admin-panel");
    if (adminPanel) adminPanel.style.display = wallet.toBase58() === ADMIN_WALLET ? "block" : "none";

    document.getElementById("display-address")!.innerText = wallet.toBase58();
    
    const solBal = await connection.getBalance(wallet);
    document.getElementById("display-sol")!.innerText = (solBal / 1e9).toFixed(3);

    const ata = getAssociatedTokenAddressSync(OLV_MINT, wallet);
    const tokenBal = await connection.getTokenAccountBalance(ata);
    document.getElementById("display-olv")!.innerText = Math.floor(tokenBal.value.uiAmount || 0).toLocaleString();
  } catch (e) {
    document.getElementById("display-olv")!.innerText = "0";
  }
}

async function getMintSupply() {
  try {
    const supply = await connection.getTokenSupply(OLV_MINT);
    const display = document.getElementById("total-minted");
    if (display) display.innerText = Math.floor(supply.value.uiAmount || 0).toLocaleString() + " OLV";
  } catch (e) { console.error("Supply fetch failed"); }
}

// --- PROPOSAL RENDER ---
async function renderProposals() {
  const program = getProgram();
  const proposals = await program.account.proposal.all();
  const voter = program.provider.publicKey;
  const container = document.querySelector('#proposal-list')!;
  container.innerHTML = "";
  const now = Math.floor(Date.now() / 1000);

  for (const p of proposals) {
    let hasVoted = false;
    if (voter) {
      const [voteRecordPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote_record"), p.publicKey.toBuffer(), voter.toBuffer()],
        programId
      );
      try { await program.account.voteRecord.fetch(voteRecordPDA); hasVoted = true; } catch (e) { hasVoted = false; }
    }

    const expiry = p.account.createdAt.toNumber() + 86400; 
    const isExpired = now > expiry;

    const card = document.createElement('div');
    card.className = "glass p-6 rounded-2xl border border-white/5 space-y-4 hover:border-green-400/20 transition-all";
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <h3 class="font-black text-lg italic tracking-tighter uppercase">${p.account.title}</h3>
        <span class="text-[9px] px-2 py-1 rounded-md bg-white/5 ${isExpired ? 'text-red-400' : 'text-green-400'}">
          ${isExpired ? 'FINALIZED' : 'ACTIVE'}
        </span>
      </div>
      <div class="flex gap-2">
        <div class="flex-1 bg-black/40 p-3 rounded-xl border border-white/5 text-center">
          <p class="text-[9px] text-gray-500 uppercase">Yes</p>
          <p class="font-bold text-green-400">${(p.account.yesVotes.toNumber() / 1e9).toFixed(0)}</p>
        </div>
        <div class="flex-1 bg-black/40 p-3 rounded-xl border border-white/5 text-center">
          <p class="text-[9px] text-gray-500 uppercase">No</p>
          <p class="font-bold text-red-400">${(p.account.noVotes.toNumber() / 1e9).toFixed(0)}</p>
        </div>
      </div>
      ${hasVoted ? `<div class="w-full py-2 bg-green-500/10 text-green-400 text-center rounded-xl text-[10px] font-bold uppercase italic">Voted ✓</div>` :
        (!isExpired ? `
          <div class="flex gap-2">
            <button onclick="window.vote('${p.publicKey}', true)" class="flex-1 py-2 bg-white text-black rounded-xl font-bold hover:bg-green-400 transition text-xs">YES</button>
            <button onclick="window.vote('${p.publicKey}', false)" class="flex-1 py-2 border border-white/10 rounded-xl font-bold hover:bg-red-500/20 transition text-xs">NO</button>
          </div>` : '')}
      ${isExpired && !p.account.executed ? `<button onclick="window.execute('${p.publicKey}')" class="w-full py-2 bg-green-400 text-black font-bold rounded-xl text-xs uppercase">Execute & Payout</button>` : ''}
    `;
    container.appendChild(card);
  }
}

// --- GLOBAL HANDLERS ---
(window as any).vote = async (id: string, side: boolean) => {
  const program = getProgram();
  const propKey = new PublicKey(id);
  const voter = program.provider.publicKey!;
  const ata = getAssociatedTokenAddressSync(OLV_MINT, voter);
  const [rec] = PublicKey.findProgramAddressSync([Buffer.from("vote_record"), propKey.toBuffer(), voter.toBuffer()], programId);
  await program.methods.vote(side).accounts({
    proposal: propKey, voteRecord: rec, voterTokenAccount: ata, olvMint: OLV_MINT, voter, systemProgram: anchor.web3.SystemProgram.programId
  }).rpc();
  renderProposals();
};

(window as any).joinDao = async () => {
  try {
    const program = getProgram();
    const user = program.provider.publicKey!;
    const [state] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
    const ata = getAssociatedTokenAddressSync(OLV_MINT, user);
    await program.methods.joinDao(new anchor.BN(100 * 1e9)).accounts({
      state, olvMint: OLV_MINT, userTokenAccount: ata, vault, user,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId
    }).rpc();
    alert("Success! Welcome to the Grove.");
    updateUIBalances();
  } catch (err: any) { alert("Join failed: " + err.message); }
};

// --- APP INITIALIZATION ---
const init = async () => {
  const provider = (window as any).solana;

  const refreshWalletUI = () => {
    const btn = document.querySelector('#connect');
    if (btn) btn.innerHTML = provider?.isConnected ? "Disconnect" : "Connect Wallet";
    if (provider?.isConnected) {
      updateUIBalances();
      getMintSupply();
    } else {
      (window as any).showView('home'); // Redirect home on disconnect
    }
  };

  if (provider) {
    provider.on("connect", refreshWalletUI);
    provider.on("disconnect", refreshWalletUI);
    if (provider.isConnected) refreshWalletUI();
  }

  document.querySelector('#connect')?.addEventListener('click', async () => {
    provider.isConnected ? await provider.disconnect() : await provider.connect();
  });

  document.querySelector('#join-dao-btn')?.addEventListener('click', async () => {
    if (!provider?.isConnected) await provider.connect();
    await (window as any).joinDao();
  });

  document.querySelector('#create-btn')?.addEventListener('click', async () => {
    const program = getProgram();
    const title = (document.querySelector('#title-input') as HTMLInputElement).value;
    const amount = (document.querySelector('#amount-input') as HTMLInputElement).value;
    const [state] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
    const stateData = await program.account.state.fetch(state);
    const [prop] = PublicKey.findProgramAddressSync([Buffer.from("proposal"), stateData.proposalCount.toArrayLike(Buffer, "le", 8)], programId);
    await program.methods.createProposal(title, new anchor.BN(parseFloat(amount)*1e9)).accounts({
      state, proposal: prop, authority: program.provider.publicKey, systemProgram: anchor.web3.SystemProgram.programId
    }).rpc();
    renderProposals();
  });

  // Admin Listeners
  document.getElementById("admin-init-btn")?.addEventListener("click", async () => {
    const program = getProgram();
    const [state] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
    await program.methods.initialize().accounts({ state, authority: program.provider.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).rpc();
    alert("DAO State Initialized.");
  });
};

if (document.readyState === 'complete' || document.readyState === 'interactive') { init(); } 
else { window.addEventListener('load', init); }

