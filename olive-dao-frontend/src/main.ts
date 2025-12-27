import './polyfill'; 
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL, SystemProgram, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import idl from "./idl.json";

// --- GLOBALS ---
const OLV_MINT = new PublicKey("6nab5Rttp45AfjaYrdwGxKuH9vK9RKCJdeaBvQJt8pLA");
const programId = new PublicKey("8MdiqqhZj1badeLArqCmZWeiWGK8tXQWiydRLcqzDn45");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// --- PDA DERIVATIONS ---
const [daoPDA] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);

// Helper to derive user-specific PDAs
const getStakePDAs = (userPubkey: PublicKey) => {
    const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from("stake"), userPubkey.toBuffer()], programId);
    const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from("stake_vault"), userPubkey.toBuffer()], programId);
    return { stakeAccount, stakeVault };
};

// --- CORE PROGRAM HELPER ---
const getProgram = () => {
    const wallet = (window as any).solana;
    if (!wallet) throw new Error("Wallet not connected");
    const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
    return new anchor.Program(idl as any, provider);
};

const toggleWalletGuards = (isConnected: boolean) => {
    const createBtn = document.querySelector('[onclick="window.createProposal()"]') as HTMLButtonElement;
    const publishBtn = document.querySelector('[onclick="document.getElementById(\'modal-create\').classList.toggle(\'hidden\')"]') as HTMLButtonElement;

    if (isConnected) {
        publishBtn?.classList.remove('opacity-50', 'cursor-not-allowed');
        publishBtn.disabled = false;
        publishBtn.innerText = "+ New Proposal";
    } else {
        publishBtn?.classList.add('opacity-50', 'cursor-not-allowed');
        publishBtn.disabled = true;
        publishBtn.innerText = "Connect to Propose";
    }
};
const showToast = (message: string) => {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast border-l-4 border-green-500';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
};

const getTimeLeft = (endTs: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = endTs - now;

    if (diff <= 0) return "Voting Ended";

    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
};
// --- UI REFRESH ---
const syncUI = async () => {
    const user = (window as any).solana?.publicKey;
    if (!user) return;

    try {
        const program = getProgram();
        const updateText = (id: string, val: string | number) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val.toString();
        };
        
        // 1. SOL Balance
        const solBal = await connection.getBalance(user);
        updateText('display-sol', (solBal / LAMPORTS_PER_SOL).toFixed(3));

        // 2. OLV Balance in Wallet
        try {
            const userATA = getAssociatedTokenAddressSync(OLV_MINT, user);
            const tokenBal = await connection.getTokenAccountBalance(userATA);
            updateText('display-olv', tokenBal.value.uiAmountString || "0");
        } catch (e) {
            updateText('display-olv', "0");
        }

        // 3. DAO Global Data
        try {
            const daoData: any = await program.account.dao.fetch(daoPDA);
            updateText('total-staked', (daoData.totalStaked.toNumber() / 1e9).toLocaleString());
            
            const vBal = await connection.getBalance(vaultPDA);
            updateText('vault-balance', (vBal / LAMPORTS_PER_SOL).toFixed(4));
        } catch (e) {
            console.log("DAO not initialized yet");
        }
        
        // 4. User Staked Balance
        const { stakeAccount } = getStakePDAs(user);
        try {
            const stakeData: any = await program.account.stakeAccount.fetch(stakeAccount);
            updateText('user-staked', (stakeData.amount.toNumber() / 1e9).toFixed(2));
        } catch {
            updateText('user-staked', "0");
        }
    } catch (e) {
        console.warn("Sync UI Warning:", e);
    }
};

// --- GOVERNANCE LOGIC ---
let currentTab = 'active';

(window as any).setVotingTab = (tab: string) => {
// 1. UPDATE GLOBAL STATE
    (window as any).currentTab = tab; 

    // 2. UI Updates (Visual Line)
    const activeBtn = document.getElementById('tab-active');
    const historyBtn = document.getElementById('tab-history');

    if (tab === 'active') {
        activeBtn?.classList.replace('text-gray-500', 'text-white');
        activeBtn?.classList.replace('border-transparent', 'border-green-500');
        historyBtn?.classList.replace('text-white', 'text-gray-500');
        historyBtn?.classList.replace('border-green-500', 'border-transparent');
    } else {
        historyBtn?.classList.replace('text-gray-500', 'text-white');
        historyBtn?.classList.replace('border-transparent', 'border-green-500');
        activeBtn?.classList.replace('text-white', 'text-gray-500');
        activeBtn?.classList.replace('border-green-500', 'border-transparent');
    }

    // 3. Trigger Render
    (window as any).renderProposals();
};
(window as any).renderProposals = async () => {
    const container = document.getElementById('proposal-list');
    const user = (window as any).solana?.publicKey; 
    if (!container) return;

    // 1. Show Professional Loading State
    container.innerHTML = `
        <div class="flex flex-col items-center py-20 gap-4">
            <div class="spinner"></div>
            <p class="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em] animate-pulse">Syncing Ledger...</p>
        </div>
    `;

    try {
        const program = getProgram();
        const now = Math.floor(Date.now() / 1000);
        const activeTab = (window as any).currentTab || 'active';
        
        // Single RPC call to get all proposals
        const proposals = await program.account.proposal.all();
        
        // Sort: Newest First
        proposals.sort((a: any, b: any) => b.account.endTs.toNumber() - a.account.endTs.toNumber());

        let html = "";

        for (const p of proposals) {
            const data: any = p.account;
            const endTs = data.endTs.toNumber();
            const isExpired = endTs < now;
            const isExecuted = data.executed;

            // --- TAB FILTERING ---
            if (activeTab === 'active' && isExpired) continue;
            if (activeTab === 'history' && !isExpired) continue;

            // --- VOTE RECORD CHECK (The "Already Voted" Guard) ---
            let hasVoted = false;
            let stakedAmount = 0;
            if (user) {
                try {
                    const [vRec] = PublicKey.findProgramAddressSync(
                        [Buffer.from("vote_record"), p.publicKey.toBuffer(), user.toBuffer()],
                        programId
                    );
                    const voteAcc: any = await program.account.voteRecord.fetchNullable(vRec);
                    if (voteAcc) {
                        hasVoted = true;
                        stakedAmount = voteAcc.amount.toNumber() / 1e9;
                    }
                } catch (e) { hasVoted = false; }
            }

            // --- DATA CALCULATIONS ---
            const yesVotes = data.yesVotes.toNumber() / 1e9;
            const noVotes = data.noVotes.toNumber() / 1e9;
            const totalVotes = yesVotes + noVotes;
            const yesPercentage = totalVotes > 0 ? (yesVotes / totalVotes) * 100 : 0;
            const isCreator = user && data.creator.equals(user);
            const isRejected = isExpired && (noVotes >= yesVotes);
            const timeLeft = getTimeLeft(endTs);

            // --- DYNAMIC BUTTON LOGIC (The Gatekeeper) ---
            let actionHtml = "";

            if (!user) {
                // STATE: DISCONNECTED
                actionHtml = `<div class="w-full py-4 bg-white/5 border border-white/5 text-gray-500 rounded-xl text-center text-[10px] font-black uppercase tracking-widest">Connect Wallet to Participate</div>`;
            } else if (!isExpired) {
                // STATE: ACTIVE PROPOSAL
                if (hasVoted) {
                    actionHtml = `<div class="w-full py-4 bg-green-500/10 border border-green-500/20 text-green-500 rounded-xl text-center text-[10px] font-black uppercase tracking-widest italic">✓ Participation Confirmed</div>`;
                } else {
                    actionHtml = `
                        <div class="flex gap-3">
                            <button onclick="window.vote('${p.publicKey.toBase58()}', true)" class="flex-1 py-4 bg-green-500 text-black font-black rounded-xl text-xs uppercase hover:bg-green-400 transition-all">Support</button>
                            <button onclick="window.vote('${p.publicKey.toBase58()}', false)" class="flex-1 py-4 border border-white/10 text-white font-bold rounded-xl text-xs uppercase hover:bg-white/5 transition-all">Against</button>
                        </div>`;
                }
            } else {
                // STATE: EXPIRED / HISTORY
                if (hasVoted) {
                    // Reclaim Logic (0.05% fee)
                    const fee = stakedAmount * 0.0005;
                    const refund = stakedAmount - fee;
                    actionHtml = `<button onclick="window.reclaimTokens('${p.publicKey.toBase58()}')" class="w-full py-4 bg-orange-500/10 border border-orange-500/50 text-orange-500 font-black rounded-xl text-xs uppercase hover:bg-orange-500 hover:text-white transition-all">Reclaim ${refund.toFixed(2)} OLV (Fee: ${fee.toFixed(4)})</button>`;
                } else if (isExecuted) {
                    actionHtml = `<div class="w-full py-4 bg-white/5 text-gray-500 rounded-xl text-center text-[10px] font-black uppercase">Success: Funds Disbursed</div>`;
                } else if (isRejected) {
                    actionHtml = `<div class="w-full py-4 bg-red-500/5 text-red-500/50 border border-red-500/10 rounded-xl text-center text-[10px] font-black uppercase">Closed: Rejected</div>`;
                } else if (isCreator) {
                    actionHtml = `<button onclick="window.executeProposal('${p.publicKey.toBase58()}')" class="w-full py-4 bg-white text-black font-black rounded-xl text-xs uppercase shadow-xl hover:scale-[1.02] transition-transform">Execute Settlement</button>`;
                } else {
                    actionHtml = `<div class="w-full py-4 bg-white/5 text-gray-600 rounded-xl text-center text-[10px] font-black uppercase tracking-widest">Awaiting Finalization</div>`;
                }
            }

            // --- HTML TEMPLATE ---
            html += `
                <div class="prop-card mb-6 animate-in">
                    <div class="flex justify-between items-start mb-4">
                        <div class="space-y-1">
                            <span class="prop-id">ID: ${p.publicKey.toBase58().slice(0, 8)}</span>
                            <h4 class="prop-title text-2xl text-white uppercase leading-tight">${data.description}</h4>
                        </div>
                        <div class="text-right flex flex-col items-end gap-2">
                            <span class="badge ${isExpired ? 'badge-history' : 'badge-active'}">
                                ${isExpired ? 'Finalized' : timeLeft}
                            </span>
                            <span class="text-green-400 font-mono text-xs font-black">${yesPercentage.toFixed(1)}% APPROVAL</span>
                        </div>
                    </div>

                    <div class="vote-track"><div class="vote-fill" style="width: ${yesPercentage}%"></div></div>
                    
                    <div class="flex justify-between mt-2 mb-8">
                        <span class="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">Support: ${yesVotes.toLocaleString()}</span>
                        <span class="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">Against: ${noVotes.toLocaleString()}</span>
                    </div>

                    ${actionHtml}
                </div>`;

            // RPC Breath (Prevent 429)
            await new Promise(r => setTimeout(r, 60));
        }

        container.innerHTML = html || `
            <div class="text-center py-20 border-2 border-dashed border-white/5 rounded-[3rem]">
                <p class="text-gray-600 font-bold uppercase text-[10px] tracking-widest">Empty Workspace</p>
            </div>`;

    } catch (e) {
        console.error("Critical Render Error:", e);
        container.innerHTML = `<div class="text-center py-10 text-red-500 font-black text-xs uppercase">Node Busy - Refresh Required</div>`;
    }
};

////----RECLAIM -------
(window as any).reclaimTokens = async (propId: string) => {
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const propKey = new PublicKey(propId);
        
        const [vRec] = PublicKey.findProgramAddressSync(
            [Buffer.from("vote_record"), propKey.toBuffer(), user.toBuffer()],
            programId
        );

        showToast("Processing Reclaim...");

        // Ensure user has an ATA (Associated Token Account) for the OLV mint
        const userAta = getAssociatedTokenAddressSync(OLV_MINT, user);

        await program.methods.reclaim().accounts({
            dao: daoPDA,
            proposal: propKey,
            voteRecord: vRec,
            user: user,
            userToken: userAta,
            vault: vaultPDA, // Fee (0.05%) goes to the treasury vault
            tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();

        showToast("OLV Reclaimed (0.05% Fee)");
        await (window as any).renderProposals();
        await syncUI();
    } catch (e) {
        console.error("Reclaim Error:", e);
        showToast("Reclaim Failed");
    }
};

// --- WALLET CONNECT ---
(window as any).connectWallet = async () => {
    const { solana } = window as any;
    if (!solana) return alert("Please install Phantom Wallet");

    try {
        // 1. Connect Phantom Wallet
        const response = await solana.connect();
        const publicKey = response.publicKey.toString();

        console.log("Wallet Connected:", publicKey);
        showToast("Wallet Connected");

        // 2. UI Updates (unlock dashboard)
        document.body.classList.remove('wallet-disconnected');
        document.querySelectorAll('.wallet-only').forEach(el => el.classList.remove('hidden'));

        // Change the Connect button label to user address
        const connectBtn = document.getElementById('connect-btn');
        if (connectBtn) {
            connectBtn.innerText = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
            connectBtn.classList.add(
                'bg-green-500/10',
                'text-green-500',
                'border-green-500/20'
            );
        }

        // Allow gated actions (Stake / Create Proposal / Vote)
        updateActionState(true);

        // 3. Critical Backend Sync
        await syncUI();                       // balances, staked, treasury value
        await updatePortfolioStats(publicKey); // <--- FIX incorrect variable
        await (window as any).renderProposals(); // refresh proposal list & vote state UI

    } catch (err) {
        console.error("Connection Error:", err);
        showToast("Wallet Connection Failed");
        document.body.classList.add('wallet-disconnected');
    }
};

/**
 * Helper to toggle button accessibility based on wallet state
 */
const updateActionState = (isConnected: boolean) => {
    // List all IDs of buttons that require a wallet
    const actionIds = ['btn-stake', 'btn-unstake', 'btn-new-proposal', 'btn-buy-olv'];
    
    actionIds.forEach(id => {
        const el = document.getElementById(id) as HTMLButtonElement;
        if (el) {
            el.disabled = !isConnected;
            el.style.opacity = isConnected ? "1" : "0.2";
            el.style.cursor = isConnected ? "pointer" : "not-allowed";
            
            // If disconnected, add a tooltip or change text
            if (!isConnected && el.innerText.indexOf("Connect") === -1) {
                el.dataset.originalText = el.innerText;
                el.innerText = "Connect Wallet";
            } else if (isConnected && el.dataset.originalText) {
                el.innerText = el.dataset.originalText;
            }
        }
    });
};
(window as any).showView = (viewId: string) => {
    const sections = document.querySelectorAll('.view-section');
    sections.forEach(s => {
        s.classList.add('hidden', 'opacity-0');
        s.style.transform = "translateY(10px)";
    });

    const active = document.getElementById(`view-${viewId}`);
    if (active) {
        active.classList.remove('hidden');
        // Small timeout to trigger CSS transition
        setTimeout(() => {
            active.classList.remove('opacity-0');
            active.style.transform = "translateY(0)";
            active.classList.add('transition-all', 'duration-500');
        }, 10);
    }
    
    if (viewId === 'voting') (window as any).renderProposals();
};

// --- STAKING ACTIONS ---
(window as any).stakeOLV = async () => {
    const amountVal = (document.getElementById('stake-amount') as HTMLInputElement).value;
    if (!amountVal) return;
    const amount = new anchor.BN(parseFloat(amountVal) * 1e9);

    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const { stakeAccount, stakeVault } = getStakePDAs(user);
        
        await program.methods.stake(amount).accounts({
            dao: daoPDA,
            vault: vaultPDA,
            stakeAccount,
            stakeVault,
            stakeMint: OLV_MINT,
            userToken: getAssociatedTokenAddressSync(OLV_MINT, user),
            user: user,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        }).rpc();
        
        alert("Staked successfully!");
        await syncUI();
    } catch (e) { console.error("Stake error:", e); }
};

(window as any).unstakeOLV = async () => {
    const amountVal = (document.getElementById('stake-amount') as HTMLInputElement).value;
    if (!amountVal) return;
    const amount = new anchor.BN(parseFloat(amountVal) * 1e9);

    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const { stakeAccount, stakeVault } = getStakePDAs(user);
        
        await program.methods.unstake(amount).accounts({
            dao: daoPDA,
            stakeAccount,
            stakeVault,
            userToken: getAssociatedTokenAddressSync(OLV_MINT, user),
            user: user,
            tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        
        alert("Unstaked successfully!");
        await syncUI();
    } catch (e) { console.error("Unstake error:", e); }
};

// --- PROPOSAL ACTIONS ---
(window as any).createProposal = async () => {
    const desc = (document.getElementById('prop-desc') as HTMLInputElement).value;
    const amount = (document.getElementById('prop-payout') as HTMLInputElement).value;
    const days = (document.getElementById('prop-days') as HTMLInputElement).value;

    if (!desc || !amount) {
        showToast("Error: Missing Details");
        return;
    }

    try {
        showToast("Signing Transaction...");
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const proposalKeypair = Keypair.generate();
        
        const duration = new anchor.BN(parseInt(days || "3") * 86400);
        const payout = new anchor.BN(parseFloat(amount) * 1e9);

        await program.methods.createProposal(desc, duration, payout)
            .accounts({
                dao: daoPDA,
                proposal: proposalKeypair.publicKey,
                creator: user,
                systemProgram: SystemProgram.programId,
            })
            .signers([proposalKeypair])
            .rpc();

        // 1. Hide Modal
        document.getElementById('modal-create')?.classList.add('hidden');
        
        // 2. Clear Inputs
        (document.getElementById('prop-desc') as HTMLInputElement).value = "";
        
        // 3. Switch Tab and Refresh
        showToast("Proposal Published!");
        (window as any).setVotingTab('active'); 

    } catch (e: any) { 
        console.error("Creation Error", e);
        showToast("Transaction Cancelled");
    }
};
/////////////-------VOTE
(window as any).vote = async (id: string, side: boolean) => {
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const propKey = new PublicKey(id);
        const { stakeAccount } = getStakePDAs(user);
        const [voteRecord] = PublicKey.findProgramAddressSync([Buffer.from("vote_record"), propKey.toBuffer(), user.toBuffer()], programId);

        await program.methods.vote(side).accounts({
            proposal: propKey,
            stakeAccount,
            voteRecord,
            voter: user,
            systemProgram: SystemProgram.programId,
        }).rpc();
        
        (window as any).renderProposals();
    } catch (e) { console.error("Vote Error", e); }
};

(window as any).executeProposal = async (propId: string) => {
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const propKey = new PublicKey(propId);

        console.group("🚀 PROPOSAL EXECUTION DEBUG");
        const propData: any = await program.account.proposal.fetch(propKey);
        
        // FIX: Safe access to the payout field
        const rawAmount = propData.payoutAmount || propData.amount || propData.payout || { toNumber: () => 0 };
        const payoutValue = rawAmount.toNumber();

        console.log("Proposal Creator:", propData.creator.toBase58());
        console.log("Payout:", (payoutValue / 1e9), " SOL");
        
        const vaultBalance = await connection.getBalance(vaultPDA);
        console.log("Vault Balance:", (vaultBalance / 1e9), " SOL");
        console.groupEnd();

        if (vaultBalance < payoutValue) {
            showToast("Vault Insufficient Funds");
            return;
        }

        showToast("Executing Settlement...");
        await program.methods.execute().accounts({
            dao: daoPDA,
            proposal: propKey,
            authority: user,
            vault: vaultPDA, 
            recipient: propData.creator,
            systemProgram: SystemProgram.programId,
        }).rpc();
        
        showToast("Success: Funds Released");
        await (window as any).renderProposals();
        await syncUI();

    } catch (e: any) {
        console.error("Execute Error:", e);
        showToast("Execution Failed");
    }
};
//---DISCONNECT----
(window as any).solana.on('disconnect', () => {
    console.log("Wallet Disconnected");
    showToast("Wallet Disconnected");
    
    // Reset Connect Button
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.innerText = "Connect Wallet";
        connectBtn.classList.remove('bg-green-500/10', 'text-green-500');
    }

    // Lock UI and Re-render as "Read Only"
    updateActionState(false);
    (window as any).renderProposals(); // This will now show "Connect Wallet to Participate"
});


// --- INITIALIZE ---
window.addEventListener('load', () => {
    setTimeout(() => {
        if ((window as any).solana?.isConnected) {
            syncUI();
        }
    }, 800);
});