import './polyfill'; 
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import idl from "./idl.json";


// --- CONFIG & GLOBALS ---
const OLV_MINT = new PublicKey("6nab5Rttp45AfjaYrdwGxKuH9vK9RKCJdeaBvQJt8pLA");
const programId = new PublicKey("8MdiqqhZj1badeLArqCmZWeiWGK8tXQWiydRLcqzDn45");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const ADMIN_WALLET = "8xkNHk2VpWBM6Nk3enitFCs7vwh2inCveTNintcXHc54";
const SystemProgram = anchor.web3.SystemProgram;

const [daoPDA] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);

const getProgram = () => {
  const provider = new anchor.AnchorProvider(connection, (window as any).solana, { preflightCommitment: "confirmed" });
  return new anchor.Program(idl as any, provider);
};

// --- ENHANCED VIEW MANAGEMENT ---
(window as any).showView = (viewId: string) => {
    const views = ['view-home', 'view-voting', 'view-whitepaper', 'view-game'];
    
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none'; // Extra insurance for layout
        }
    });

    const activeView = document.getElementById(`view-` + viewId);
    if (activeView) {
        activeView.classList.remove('hidden');
        activeView.style.display = 'block';
    }

    // Active Tab Styling
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('text-green-400', 'border-b-2', 'border-green-400');
        if (link.getAttribute('onclick')?.includes(viewId)) {
            link.classList.add('text-green-400', 'border-b-2', 'border-green-400');
        }
    });

    if (viewId === 'voting') renderProposals();
};

// --- CLEAN DISCONNECT & CONNECT ---
(window as any).connectWallet = async () => {
    try {
        const { solana } = window as any;
        if (!solana) return alert("Please install Phantom wallet!");

        // Trigger wallet connection
        const response = await solana.connect();
        console.log("Connected with Public Key:", response.publicKey.toString());
        
        // Refresh UI
        document.getElementById('display-address')!.innerText = 
            response.publicKey.toString().slice(0, 4) + "..." + response.publicKey.toString().slice(-4);
        
        // Update all metrics and lists now that we have a user
        updateDAOMetrics();
        renderProposals();
        updateOrchardUI();

    } catch (err) {
        console.error("Connection failed", err);
    }
};
const refreshWalletUI = async () => {
    const provider = (window as any).solana;
    const btn = document.querySelector('#connect') as HTMLButtonElement;
    
    if (provider?.isConnected) {
        const addr = provider.publicKey.toBase58();
        btn.innerHTML = `
            <span class="flex items-center gap-2">
                <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                ${addr.slice(0, 4)}...${addr.slice(-4)}
            </span>`;
        btn.className = "px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/50 text-green-400 font-bold text-sm transition-all hover:bg-green-500/20";
        
        updateUIBalances();
        updateDAOMetrics();
    } else {
        btn.innerText = "Connect Wallet";
        btn.className = "px-4 py-2 rounded-xl bg-white text-black font-bold text-sm hover:bg-gray-200 transition-all";
        
        // Wipe UI on disconnect
        document.getElementById('display-sol')!.innerText = "0.00";
        document.getElementById('display-olv')!.innerText = "0";
        (window as any).showView('home');
    }
};
async function updateDAOMetrics() {
    console.log("--- DEBUG: Updating Metrics ---");
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;

        // 1. Vault Balance
        const vaultBalance = await connection.getBalance(vaultPDA);
        
        // 2. DAO Account Data
        const daoData = await program.account.dao.fetch(daoPDA);
        const totalStaked = daoData.totalStaked.toNumber() / 1e9;

        // 3. Fetch Personal Stake
        if (user) {
            const [stakeAccountPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("stake"), user.toBuffer()],
                programId
            );
            try {
                const stakeData = await program.account.stakeAccount.fetch(stakeAccountPDA);
                const userStake = (stakeData.amount.toNumber() / 1e9).toLocaleString();
                const userEl = document.getElementById("user-staked-display");
                if (userEl) userEl.innerText = userStake;
            } catch (e) {
                if (document.getElementById("user-staked-display")) {
                    document.getElementById("user-staked-display")!.innerText = "0";
                }
            }
        }

        document.getElementById('vault-balance')!.innerText = (vaultBalance / 1e9).toFixed(4);
        document.getElementById('total-staked')!.innerText = totalStaked.toLocaleString();

    } catch (err) {
        console.error("DEBUG ERROR in updateDAOMetrics:", err);
    }
}
// Fixed Donation Function
(window as any).donateToDao = async () => {
    const amountInput = document.getElementById('donate-amount') as HTMLInputElement;
    const solAmount = parseFloat(amountInput.value);
    const provider = (window as any).solana;

    // 1. Security Check: Input validation
    if (!amountInput || isNaN(solAmount) || solAmount <= 0) {
        return alert("Please enter a valid SOL amount to donate.");
    }

    // 2. Security Check: Wallet connection
    if (!provider || !provider.publicKey) {
        return alert("Please connect your wallet first!");
    }

    try {
        const userPublicKey = provider.publicKey;

        // 3. Create Transaction
        const transaction = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.transfer({
                fromPubkey: userPublicKey,
                toPubkey: vaultPDA,
                lamports: solAmount * anchor.web3.LAMPORTS_PER_SOL,
            })
        );

        // 4. Critical Fix: Fetch recent blockhash & set feePayer
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userPublicKey;

        // 5. Sign and Send
        const { signature } = await provider.signAndSendTransaction(transaction);
        
        // 6. Confirm
        await connection.confirmTransaction(signature, "confirmed");
        
        alert(`Success! ${solAmount} SOL donated to the Olive Vault.`);
        
        // Clear input and refresh UI
        amountInput.value = "";
        if (typeof updateDAOMetrics === 'function') {
            updateDAOMetrics(); 
	    updateUIBalances();
        }

    } catch (err: any) {
        console.error("Donation failed:", err);
        alert("Transaction failed: " + (err.message || "User rejected or network error"));
    }
};
// --- UPDATE DASHBOARD ---
async function updateUIBalances() {
  const program = getProgram();
  const wallet = program.provider.publicKey;
  if (!wallet) return;
// --- 2. ADMIN PANEL VISIBILITY CHECK ---
  const adminPanel = document.getElementById("admin-panel");
  if (adminPanel) {
    adminPanel.style.display = wallet.toBase58() === ADMIN_WALLET ? "block" : "none";
  }
  document.getElementById("display-address")!.innerText = wallet.toBase58().slice(0, 6) + "...";
  
  const solBal = await connection.getBalance(wallet);
  document.getElementById("display-sol")!.innerText = (solBal / 1e9).toFixed(3);

  try {
    const ata = getAssociatedTokenAddressSync(OLV_MINT, wallet);
    const tokenBal = await connection.getTokenAccountBalance(ata);
    document.getElementById("display-olv")!.innerText = tokenBal.value.uiAmountString;
  } catch {
    document.getElementById("display-olv")!.innerText = "0.00";
  }
}
// --- 3. ADMIN ACTIONS ---
document.getElementById("admin-init-btn")?.addEventListener("click", async () => {
  try {
    const program = getProgram();
    const [statePDA] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
    
    await program.methods.initialize().accounts({
      state: statePDA,
      authority: program.provider.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();
    
    alert("DAO Initialized on Devnet!");
  } catch (err: any) {
    alert("Init Error: " + err.message);
  }
});

document.getElementById("admin-vault-btn")?.addEventListener("click", async () => {
  try {
    const program = getProgram();
    const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
    
    const transaction = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: program.provider.publicKey,
        toPubkey: vaultPDA,
        lamports: 0.1 * 1e9,
      })
    );
    
    await program.provider.sendAndConfirm(transaction);
    alert("Vault Funded with 0.1 SOL!");
  } catch (err: any) {
    alert("Funding Error: " + err.message);
  }
});

// --- JOIN DAO ---
(window as any).joinDao = async () => {
  try {
    const program = getProgram();
    const user = program.provider.publicKey!;
    const [statePDA] = PublicKey.findProgramAddressSync([Buffer.from("state")], programId);
    const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
    
    const amount = new anchor.BN(100 * 1e9); // Get 100 tokens
    const userTokenAccount = getAssociatedTokenAddressSync(OLV_MINT, user);

    await program.methods.joinDao(amount).accounts({
      state: statePDA,
      olvMint: OLV_MINT,
      userTokenAccount,
      vault: vaultPDA,
      user,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc();

    alert("Joined!");
    updateUIBalances();
  } catch (err: any) {
    alert("Error: " + err.message);
  }
};

// --- PROPOSAL RENDER (FIXED) ---
let currentGovTab = 'active';

(window as any).setGovTab = (tab: string) => {
    currentGovTab = tab;
    // Update Tab UI
    document.getElementById('tab-active')?.classList.toggle('border-green-500', tab === 'active');
    document.getElementById('tab-active')?.classList.toggle('text-white', tab === 'active');
    document.getElementById('tab-history')?.classList.toggle('border-green-500', tab === 'history');
    document.getElementById('tab-history')?.classList.toggle('text-white', tab === 'history');
    
    renderProposals();
};

async function renderProposals() {
const program = getProgram();
    const container = document.getElementById('proposal-list');
    if (!container) return;

// Fetching all vote records for the user at once is more efficient than one-by-one
const allVotes = await program.account.voteRecord.all([
    { memcmp: { offset: 32, bytes: user.toBase58() } } // Filter by voter address
]);

// Inside the .map(p => { ... }) loop:
const hasVotedOnThis = allVotes.some(v => v.account.proposal.toBase58() === p.publicKey.toBase58());

let actionHtml = '';
if (hasVotedOnThis) {
    actionHtml = `<div class="text-center py-2 bg-blue-500/10 rounded-lg text-[9px] font-bold text-blue-400 uppercase border border-blue-500/20">Already Voted</div>`;
} 
else if (!isExpired) {
actionHtml = `
        <div class="flex gap-2 w-full">
            <button onclick="window.vote('${p.publicKey.toBase58()}', true)" class="...">YES</button>
            <button onclick="window.vote('${p.publicKey.toBase58()}', false)" class="...">NO</button>
        </div>`;}
    try {
        const program = getProgram();
        const proposals = await program.account.proposal.all();
        const user = (window as any).solana?.publicKey;
        const hideRejected = (document.getElementById('hide-rejected') as HTMLInputElement)?.checked;
        const now = Math.floor(Date.now() / 1000);

        // Filter based on Tab selection
        const filtered = proposals.filter(p => {
            const isExpired = now > (p.account.endTs?.toNumber() ?? 0);
            if (currentGovTab === 'active') return !isExpired;
            return isExpired; // History tab
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="p-20 text-center glass rounded-3xl border border-white/5 text-gray-600 uppercase text-[10px] font-bold tracking-widest">No ${currentGovTab} proposals found</div>`;
            return;
        }

        container.innerHTML = filtered.map(p => {
            const rawPayout = p.account.payoutAmount ? p.account.payoutAmount.toNumber() : 0;
            const yesVotes = p.account.yesVotes?.toNumber() ?? 0;
            const noVotes = p.account.noVotes?.toNumber() ?? 0;
            const endTs = p.account.endTs?.toNumber() ?? 0;
            const isExpired = now > endTs;
            const didPass = yesVotes > noVotes;
            const isCreator = user && p.account.creator.toBase58() === user.toBase58();

            if (hideRejected && isExpired && !didPass) return '';

            // Dynamic Action Button
            let actionHtml = '';
            if (!isExpired) {
                actionHtml = `
                    <div class="flex gap-2 w-full">
                        <button onclick="window.vote('${p.publicKey.toBase58()}', true)" class="flex-1 py-3 bg-green-500 text-black font-black text-[10px] rounded-xl hover:scale-[1.02] transition">YES</button>
                        <button onclick="window.vote('${p.publicKey.toBase58()}', false)" class="flex-1 py-3 bg-red-500 text-black font-black text-[10px] rounded-xl hover:scale-[1.02] transition">NO</button>
                    </div>`;
            } else if (didPass && !p.account.executed && isCreator) {
                actionHtml = `<button onclick="window.executeProposal('${p.publicKey.toBase58()}')" class="w-full py-3 bg-white text-black font-black text-[10px] rounded-xl hover:bg-green-400 transition">CLAIM ${((rawPayout/1e9)*0.9).toFixed(2)} SOL</button>`;
            } else {
                actionHtml = `<div class="w-full py-3 bg-white/5 border border-white/10 text-center rounded-xl text-[9px] font-bold text-gray-500 uppercase">${p.account.executed ? '✓ Funds Distributed' : 'Archived'}</div>`;
            }

            return `
                <div class="glass p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent">
                    <div class="flex flex-col md:flex-row justify-between gap-6">
                        <div class="flex-1">
                            <div class="flex items-center gap-3 mb-2">
                                <span class="w-2 h-2 rounded-full ${isExpired ? (didPass ? 'bg-blue-500' : 'bg-red-500') : 'bg-green-500 animate-pulse'}"></span>
                                <span class="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">${isExpired ? (didPass ? 'Passed' : 'Rejected') : 'Voting Open'}</span>
                            </div>
                            <h4 class="text-xl font-black italic uppercase text-white mb-1">${p.account.description}</h4>
                            <p class="text-[10px] text-gray-500 font-mono italic">Creator: ${p.account.creator.toBase58().slice(0,6)}...${p.account.creator.toBase58().slice(-4)}</p>
                        </div>
                        
                        <div class="w-full md:w-64 space-y-4">
                            <div class="flex justify-between items-end">
                                <span class="text-[9px] text-gray-500 font-bold uppercase">Proposal Payout</span>
                                <span class="text-xl font-black italic text-green-400">${(rawPayout/1e9).toFixed(2)} SOL</span>
                            </div>
                            <div class="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex">
                                <div class="bg-green-500 h-full" style="width: ${(yesVotes/(yesVotes+noVotes+1e-9))*100}%"></div>
                                <div class="bg-red-500 h-full" style="width: ${(noVotes/(yesVotes+noVotes+1e-9))*100}%"></div>
                            </div>
                            ${actionHtml}
                        </div>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error("Render failed", e);
    }
}

// --- GLOBAL HANDLERS ---

// Local state for user's trees
let userOrchard: Array<{id: number, fraction: number, type: string}> = [];
(window as any).buyTree = async (currency: 'sol' | 'olv') => {
    const slider = document.getElementById('tree-slider') as HTMLInputElement;
    const fraction = parseInt(slider.value);
    const user = (window as any).solana.publicKey;

    if (!user) return alert("Please connect wallet.");

    try {
        const program = getProgram();
        // Assume Tree #104 is the current marketplace featured tree
        const featuredTreeId = 104; 

        // 1. Execute Blockchain Transaction
        await program.methods.buyTree(new anchor.BN(fraction), currency === 'sol')
            .accounts({
                dao: daoPDA,
                vault: vaultPDA,
                user: user,
                systemProgram: anchor.web3.SystemProgram.programId,
            }).rpc();

        // 2. Logic to update the local Orchard List
        const existingTree = userOrchard.find(t => t.id === featuredTreeId);
        if (existingTree) {
            existingTree.fraction += fraction; // Add to existing ownership
        } else {
            userOrchard.push({ 
                id: featuredTreeId, 
                fraction: fraction, 
                type: 'Koroneiki', 
                health: 'Excellent' 
            });
        }

        // 3. Refresh the UI
        updateOrchardUI();
        alert(`Success! You now own ${fraction}% more of Tree #${featuredTreeId}.`);
        
    } catch (e: any) {
        console.error("Marketplace Error:", e);
        alert("Transaction failed. Check wallet for details.");
    }
};
// Local state for the user's purchased fractions
function updateOrchardUI() {
    const container = document.getElementById('user-trees');
    if (!container) return;

    if (userOrchard.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-8 border-2 border-dashed border-white/5 rounded-3xl text-center">
                <p class="text-[10px] uppercase tracking-widest text-gray-600 font-bold">Your Orchard is empty</p>
                <p class="text-[9px] text-gray-700 mt-1 italic">Purchase tree fractions in the marketplace to see them here.</p>
            </div>`;
        return;
    }

    container.innerHTML = userOrchard.map(tree => `
        <div class="glass p-5 rounded-2xl border border-green-500/20 bg-green-500/[0.02] flex flex-col gap-3">
            <div class="flex justify-between items-start">
                <div>
                    <span class="text-[8px] font-black bg-green-500 text-black px-1.5 py-0.5 rounded">TREE #${tree.id}</span>
                    <h5 class="text-sm font-black italic uppercase mt-1 text-white">${tree.type}</h5>
                </div>
                <span class="text-[8px] uppercase font-bold text-green-400 border border-green-400/30 px-2 py-0.5 rounded-full">${tree.health}</span>
            </div>
            
            <div class="space-y-1">
                <div class="flex justify-between text-[9px] uppercase font-bold">
                    <span class="text-gray-500">Ownership</span>
                    <span class="text-white">${tree.fraction}%</span>
                </div>
                <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div class="bg-green-500 h-full rounded-full" style="width: ${tree.fraction}%"></div>
                </div>
            </div>
            
            <button class="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[8px] uppercase font-black text-gray-400 transition">
                View On-Chain Metadata
            </button>
        </div>
    `).join('');
}

(window as any).stakeOLV = async () => {
    const inputEl = document.getElementById('stake-amount') as HTMLInputElement;
    const amount = parseFloat(inputEl.value);

    // --- GATEKEEPER ---
    if (!inputEl.value || isNaN(amount) || amount <= 0) {
        inputEl.classList.add('border-red-500', 'animate-pulse');
        setTimeout(() => inputEl.classList.remove('border-red-500', 'animate-pulse'), 2000);
        return alert("Please enter a valid OLV amount to stake.");
    }
	
	try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        
        // Ensure ID matches your HTML input
        const inputEl = document.getElementById('stake-amount') as HTMLInputElement;
        const amount = parseFloat(inputEl.value);

        if (isNaN(amount) || amount <= 0) return alert("Enter a valid amount");

        // Derive all needed PDAs
        const [dao] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
        const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
        const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from("stake"), user.toBuffer()], programId);
        const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from("stake_vault"), user.toBuffer()], programId);
        
        const userToken = getAssociatedTokenAddressSync(OLV_MINT, user);

        await program.methods
            .stake(new anchor.BN(amount * 1e9))
            .accounts({
                dao,
                vault,
                stakeAccount,
                stakeVault,
                stakeMint: OLV_MINT,
                userToken,
                user,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        alert("Stake Successful! (0.01 SOL fee sent to treasury)");
        updateDAOMetrics();
        updateUIBalances();
    } catch (err) {
        console.error("Stake failed:", err);
    }
};


(window as any).unstakeOLV = async () => {
    console.log("--- DEBUG: Starting Unstake Transaction ---");
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        
        const inputEl = document.getElementById('unstake-amount') as HTMLInputElement;
        const amount = parseFloat(inputEl.value);

        if (isNaN(amount) || amount <= 0) return alert("Enter amount to unstake");

        const [dao] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
        const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from("stake"), user.toBuffer()], programId);
        const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from("stake_vault"), user.toBuffer()], programId);
        const userToken = getAssociatedTokenAddressSync(OLV_MINT, user);

        await program.methods
            .unstake(new anchor.BN(amount * 1e9))
            .accounts({
                dao,
                stakeAccount,
                stakeVault,
                userToken,
                user,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        alert("Unstaked Successfully!");
        updateDAOMetrics();
        updateUIBalances();
    } catch (err) {
        console.error("Unstake failed:", err);
        alert("Unstake failed. Check console.");
    }
};
(window as any).vote = async (proposalId: string, side: boolean) => {
    const program = getProgram();
    const propKey = new PublicKey(proposalId);
    const voter = (window as any).solana.publicKey;
    
    try {
        // --- UX GUARDRAIL: Check expiration before calling wallet ---
        const p = await program.account.proposal.fetch(propKey);
        const isExpired = Math.floor(Date.now() / 1000) > p.endTs.toNumber();
        
        if (isExpired) {
            alert("This proposal has ended. Voting is closed.");
            return;
        }

        const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from("stake"), voter.toBuffer()], programId);
        const [voteRecord] = PublicKey.findProgramAddressSync([Buffer.from("vote_record"), propKey.toBuffer(), voter.toBuffer()], programId);

        await program.methods.vote(side).accounts({
            proposal: propKey,
            stakeAccount,
            voteRecord,
            voter,
            systemProgram: SystemProgram.programId,
        }).rpc();
        
        renderProposals();
    } catch (e: any) {
        if (e.message.includes("already voted")) alert("You have already voted on this proposal.");
        else alert("Vote failed. Ensure you have tokens staked.");
    }
};

(window as any).executeProposal = async (proposalId: string) => {
    const program = getProgram();
    const propKey = new PublicKey(proposalId);
    const user = (window as any).solana.publicKey;

    try {
        const p = await program.account.proposal.fetch(propKey);
        
        // --- SECURITY: Only creator check ---
        if (p.creator.toBase58() !== user.toBase58()) {
            return alert("Only the proposal creator can execute and withdraw funds.");
        }

        const [dao] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
        const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);

        await program.methods.execute().accounts({
            dao,
            proposal: propKey,
            authority: user,
            vault,
            recipient: user,
            systemProgram: SystemProgram.programId,
        }).rpc();

        alert("Executed! Funds sent to your wallet (90%) and Treasury (10%).");
        renderProposals();
    } catch (e) {
        console.error("Execution failed", e);
        alert("Execution failed. Is the proposal passed and ended?");
    }
};
// --- APP INITIALIZATION ---
// --- APP INITIALIZATION ---

// Inside your main init()
const hideToggle = document.getElementById('hide-rejected');
if (hideToggle) {
    hideToggle.addEventListener('change', () => {
        console.log("Filtering proposals...");
        renderProposals(); // Re-run the render with the new filter state
    });
}

// --- ADMIN: CHECK TOTAL SUPPLY ---
async function getMintSupply() {
  try {
    const supply = await connection.getTokenSupply(OLV_MINT);
    const display = document.getElementById("total-minted");
    if (display) display.innerText = supply.value.uiAmountString + " OLV";
  } catch (e) { console.error("Could not fetch supply"); }
}

const syncWalletState = async () => {
  const provider = (window as any).solana;
  const isConnected = provider?.isConnected;

  // Button label
  const btn = document.querySelector('#connect');
  if (btn) btn.textContent = isConnected ? "Disconnect" : "Connect Wallet";

  if (!isConnected) {
    (window as any).showView('home');

    const addr = document.getElementById("display-address");
    if (addr) addr.innerText = "--";

    const admin = document.getElementById("admin-panel");
    if (admin) admin.style.display = "none";

    return;
  }

  // Connected flow
  await updateUIBalances();
  await getMintSupply();     // admin check
  await updateDAOMetrics();  // TVL / stats
};

let walletListenersAttached = false;

const init = async () => {
  const provider = (window as any).solana;
  if (!provider || walletListenersAttached) return;

  provider.on("connect", syncWalletState);
  provider.on("disconnect", syncWalletState);

  walletListenersAttached = true;
  await syncWalletState();
};

    
// Auto-disable buttons if inputs are empty
const watchInputs = (inputId: string, btnId: string) => {
    const input = document.getElementById(inputId) as HTMLInputElement;
    const btn = document.getElementById(btnId) as HTMLButtonElement;
    
    if (input && btn) {
        input.addEventListener('input', () => {
            btn.disabled = !input.value || parseFloat(input.value) <= 0;
            btn.style.opacity = btn.disabled ? "0.5" : "1";
            btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";
        });
    }
};
    watchInputs('stake-amount', 'stake-btn');
    watchInputs('amount-input', 'create-btn');

    // --- CREATE PROPOSAL HANDLER ---
    document.querySelector('#create-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        if (btn.disabled) return;

        const titleInput = document.querySelector('#title-input') as HTMLInputElement;
        const amountInput = document.querySelector('#amount-input') as HTMLInputElement;
        const description = titleInput.value.trim();
        const payoutAmount = parseFloat(amountInput.value);
        const PROPOSAL_FEE_LAMPORTS = 0.0132 * anchor.web3.LAMPORTS_PER_SOL;

        try {
            btn.disabled = true;
            btn.innerText = "SIGNING...";
            const program = getProgram();
            const user = (window as any).solana.publicKey;
            const proposalKeypair = anchor.web3.Keypair.generate();

            // 1. Fee Instruction
            const feeIx = anchor.web3.SystemProgram.transfer({
                fromPubkey: user,
                toPubkey: vaultPDA,
                lamports: PROPOSAL_FEE_LAMPORTS,
            });

            // 2. Create Instruction
            const createIx = await program.methods.createProposal(
                description, 
                new anchor.BN(3600), 
                new anchor.BN(payoutAmount * 1e9)
            )
            .accounts({
                dao: daoPDA,
                proposal: proposalKeypair.publicKey,
                creator: user,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .instruction();

            const tx = new anchor.web3.Transaction().add(feeIx).add(createIx);
            tx.feePayer = user;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            
            // IMPORTANT: Sign with the new proposal account keypair
            tx.partialSign(proposalKeypair);

            const signature = await (window as any).solana.signAndSendTransaction(tx);
            await connection.confirmTransaction(signature, "confirmed");
// --- ADD THESE LOGS TO YOUR CREATE BUTTON LISTENER ---
const amountInput = document.querySelector('#amount-input') as HTMLInputElement;
const amount = parseFloat(amountInput.value);

console.log("--- DEBUG PROPOSAL CREATION ---");
console.log("Raw Input Value:", amountInput.value);
console.log("Parsed Float:", amount);

// Convert to Lamports (This is where the 0.00 error usually lives)
const lamports = new anchor.BN(amount * 1_000_000_000); 
console.log("BN Lamports being sent:", lamports.toString());

// Check description length
console.log("Description:", description);
            alert("Proposal Created!");
            titleInput.value = ""; amountInput.value = "";
        } catch (err: any) {
            console.error(err);
            alert(err.message || "Failed");
        } finally {
            btn.disabled = false;
            btn.innerText = "CREATE PROPOSAL";
            renderProposals();
            updateDAOMetrics();
        }
    });

    // --- LIVE LISTENER ---
    connection.onProgramAccountChange(programId, () => {
        renderProposals();
        updateDAOMetrics();
    }, 'confirmed', [{ dataSize: 1000 }]);

    // --- ADMIN INIT ---


// Inside your initialization code
document.getElementById('hide-rejected')?.addEventListener('change', renderProposals);
    document.getElementById("admin-init-btn")?.addEventListener("click", async () => {
        try {
            const program = getProgram();
            await program.methods.initDao().accounts({
                dao: daoPDA,
                stakeMint: OLV_MINT,
                authority: (window as any).solana.publicKey,
                vault: vaultPDA,
                systemProgram: SystemProgram.programId,
            }).rpc();
            alert("DAO live!");
        } catch (err) { console.error(err); }
 });

if (document.readyState === 'complete' || document.readyState === 'interactive') { init(); } 
else { window.addEventListener('load', init); }