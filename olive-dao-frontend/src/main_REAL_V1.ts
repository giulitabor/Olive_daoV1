import './polyfill'; // MUST BE FIRST
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

// --- UI REFRESH ---
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

async function updateUIBalances() {
  try {
    const program = getProgram();
    const wallet = program.provider.publicKey!;
    if (!wallet) return;

    // Show/hide admin panel
    const adminPanel = document.getElementById("admin-panel");
    if (adminPanel) adminPanel.style.display = wallet.toBase58() === ADMIN_WALLET ? "block" : "none";

    // Update wallet address
    document.getElementById("display-address")!.innerText = wallet.toBase58().slice(0, 4) + "..." + wallet.toBase58().slice(-4);

    // SOL balance
    const solBal = await connection.getBalance(wallet);
    document.getElementById("display-sol")!.innerText = (solBal / 1e9).toFixed(3);

    // OLV balance
    const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, OLV_MINT, wallet);
    const tokenBal = await connection.getTokenAccountBalance(ata.address);

    const OLV_DECIMALS = 6; // Confirm your token decimals
    const olvAmount = (tokenBal.value.uiAmount || 0) * 10 ** OLV_DECIMALS;

    document.getElementById("wallet-olv")!.innerText = olvAmount.toFixed(0);

    console.log("UI Balances updated. SOL:", solBal / 1e9, "OLV:", olvAmount);
  } catch (e) {
    console.error("Failed to update UI balances:", e);
    document.getElementById("wallet-olv")!.innerText = "0";
    document.getElementById("display-sol")!.innerText = "0.000";
  }
}

// --- PROPOSAL RENDERING ---
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
      try {
        await program.account.voteRecord.fetch(voteRecordPDA);
        hasVoted = true;
      } catch (e) { hasVoted = false; }
    }

    const expiry = p.account.createdAt.toNumber() + 86400; 
    const isExpired = now > expiry;

    const card = document.createElement('div');
    card.className = "glass p-6 rounded-2xl border border-white/5 space-y-4";
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <h3 class="font-black text-lg italic tracking-tighter uppercase">${p.account.title}</h3>
        <span class="text-[9px] px-2 py-1 rounded-md bg-white/5 ${isExpired ? 'text-red-400' : 'text-green-400'}">
          ${isExpired ? 'CLOSED' : 'VOTING'}
        </span>
      </div>
      
      <div class="flex gap-2">
        <div class="flex-1 bg-black/40 p-3 rounded-xl border border-white/5">
          <p class="text-[9px] text-gray-500 uppercase">Yes</p>
          <p class="font-bold text-green-400">${(p.account.yesVotes.toNumber() / 1e9).toFixed(0)}</p>
        </div>
        <div class="flex-1 bg-black/40 p-3 rounded-xl border border-white/5">
          <p class="text-[9px] text-gray-500 uppercase">No</p>
          <p class="font-bold text-red-400">${(p.account.noVotes.toNumber() / 1e9).toFixed(0)}</p>
        </div>
      </div>

      ${hasVoted ? 
        `<div class="w-full py-2 bg-green-500/10 text-green-400 text-center rounded-xl text-[10px] font-bold tracking-widest uppercase italic">Vote Recorded ✓</div>` :
        (!isExpired ? `
          <div class="flex gap-2">
            <button onclick="window.vote('${p.publicKey}', true)" class="flex-1 py-2 bg-white text-black rounded-xl font-bold hover:bg-green-400 transition text-xs">YES</button>
            <button onclick="window.vote('${p.publicKey}', false)" class="flex-1 py-2 border border-white/10 rounded-xl font-bold hover:bg-red-500/20 transition text-xs">NO</button>
          </div>
        ` : '')
      }

      ${isExpired && !p.account.executed ? `
        <button onclick="window.execute('${p.publicKey}')" class="w-full py-2 bg-green-400 text-black font-bold rounded-xl text-xs">EXECUTE PAYOUT</button>
      ` : ''}
    `;
    container.appendChild(card);
  }
}

// --- GLOBAL ACTIONS ---
(window as any).vote = async (id: string, side: boolean) => {
  try {
    const program = getProgram();
    const propKey = new PublicKey(id);
    const voter = program.provider.publicKey!;

    const ata = await getOrCreateAssociatedTokenAccount(connection, voter, OLV_MINT, voter);

    const [rec] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_record"), propKey.toBuffer(), voter.toBuffer()],
      programId
    );

    console.log("Voting with ATA:", ata.address.toBase58());

    await program.methods.vote(side).accounts({
      proposal: propKey,
      voteRecord: rec,
      voterTokenAccount: ata.address,
      olvMint: OLV_MINT,
      voter,
      systemProgram: anchor.web3.SystemProgram.programId
    }).rpc();

    console.log("Vote submitted for proposal:", id);
    await updateUIBalances();
    await renderProposals();
  } catch (err: any) {
    console.error("Voting failed:", err);
    alert("Voting failed: Do you have enough OLV?");
  }
};

(window as any).joinDao = async () => {
  try {
    const program = getProgram();
    const user = program.provider.publicKey!;

    const [state] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);

    const ata = await getOrCreateAssociatedTokenAccount(connection, user, OLV_MINT, user);

    const OLV_DECIMALS = 6;
    const amount = new anchor.BN(100 * 10 ** OLV_DECIMALS); // 100 OLV

    await program.methods.joinDao(amount).accounts({
      state,
      olvMint: OLV_MINT,
      userTokenAccount: ata.address,
      vault,
      user,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();

    alert("Welcome to Olive Tree DAO!");
    await updateUIBalances();

  } catch (err: any) {
    console.error("joinDao failed:", err);
    alert("Join failed: " + err.message);
  }
};

(window as any).execute = async (id: string) => {
  try {
    const program = getProgram();
    const propKey = new PublicKey(id);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
    const data = await program.account.proposal.fetch(propKey);
    await program.methods.executeProposal().accounts({
      proposal: propKey, vault, creator: data.creator, systemProgram: anchor.web3.SystemProgram.programId
    }).rpc();
    renderProposals();
    updateUIBalances();
  } catch (err: any) { alert("Execution failed: " + err.message); }
};

// --- INITIALIZATION ---
const init = async () => {
  const provider = (window as any).solana;

  const updateConnectButton = () => {
    const btn = document.querySelector('#connect');
    if (btn) btn.innerHTML = provider?.isConnected ? "Disconnect Wallet" : "Connect Wallet";
  };

  if (provider) {
    provider.on("connect", () => {
      updateConnectButton();
      updateUIBalances();
      renderProposals();
    });

    provider.on("disconnect", () => {
      updateConnectButton();
      document.getElementById("display-address")!.innerText = "--";
      document.getElementById("display-sol")!.innerText = "0.000";
      document.getElementById("display-olv")!.innerText = "0";
    });

    if (provider.isConnected) {
        updateConnectButton();
        updateUIBalances();
        renderProposals();
    }
  }

  // EVENT LISTENERS
  document.querySelector('#connect')?.addEventListener('click', async () => {
    if (provider.isConnected) {
      await provider.disconnect();
    } else {
      await provider.connect();
    }
  });

  document.querySelector('#join-dao-btn')?.addEventListener('click', async () => {
    if (!provider?.isConnected) {
      await provider.connect();
    } else {
      await (window as any).joinDao();
    }
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

  document.getElementById("admin-init-btn")?.addEventListener("click", async () => {
    try {
      const program = getProgram();
      const [state] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
      await program.methods.initialize().accounts({
        state, authority: program.provider.publicKey, systemProgram: anchor.web3.SystemProgram.programId
      }).rpc();
      alert("State Initialized");
    } catch (err: any) { alert(err.message); }
  });

  document.getElementById("admin-vault-btn")?.addEventListener("click", async () => {
    try {
      const program = getProgram();
      const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({ fromPubkey: program.provider.publicKey, toPubkey: vault, lamports: 0.1 * 1e9 })
      );
      await program.provider.sendAndConfirm(tx);
      alert("Vault Funded");
    } catch (err: any) { alert(err.message); }
  });
};


const init = () => {
  console.log("Olive DAO Logic Initialized");
  
  // Link Connect Button
  document.querySelector('#connect')?.addEventListener('click', async () => {
    const provider = (window as any).solana;
    await provider.connect();
    updateUIBalances();
    renderProposals();
  });

  // Link Join Button
  document.querySelector('#join-dao-btn')?.addEventListener('click', async () => {
    const provider = (window as any).solana;
    if (!provider.isConnected) {
      await provider.connect();
      updateUIBalances();
    } else {
      await (window as any).joinDao();
    }
  });

  // Link Create Button
  document.querySelector('#create-btn')?.addEventListener('click', async () => {
    // ... your creation logic
  });
};

// Run init
if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}

// --- START APP ---
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}