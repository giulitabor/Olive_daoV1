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

// --- GLOBAL GAME STATE ------ 1. GLOBAL HELPERS (Add these at the top level) ---

const getOracleData = () => {
    const oracleRaw = localStorage.getItem('olive_oracle_data');
    // Default to 25 degrees if no data exists
    return oracleRaw ? JSON.parse(oracleRaw) : { temp: 25 };
};
// --- 1. GLOBAL STATE & HELPERS (Must be first) ---
let myGrove: any[] = JSON.parse(localStorage.getItem('my_grove') || '[]');

// This function must be defined BEFORE the setInterval loop
const getCurrentWeather = () => {
    const oracleRaw = localStorage.getItem('olive_oracle_data');
    return oracleRaw ? JSON.parse(oracleRaw) : { temp: 25 };
};

const gameState = {
    weather: {
        temp: 0,
        humidity: 0,
        wind: 0,
        condition: 'CLEAR', // Added to prevent .includes() crash
        conditionCode: 0,
        timeStr: 'NIGHT',
        seasonStr: 'WINTER',
        isHeatwave: false
    },
    lastFetch: 0
};


const playSound = (freq: number, type: OscillatorType = 'sine', duration: number = 0.1) => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
};


(window as any).playClick = () => {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 note
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
};
// Hook these into your button
(window as any).playClick = () => playSound(440, 'sine', 0.05); // Subtle tap
(window as any).playSuccess = () => {
    playSound(523.25, 'sine', 0.1); // C5
    setTimeout(() => playSound(659.25, 'sine', 0.1), 100); // E5
};

// --- HOOK INTO NAVIGATION UI---
const originalShowView = (window as any).showView;
(window as any).showView = (viewId: string) => {
    console.log("Switching to view:", viewId);
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.add('hidden');
    });
    const activeView = document.getElementById(`view-${viewId}`);
    if (activeView) activeView.classList.remove('hidden');

    // Trigger specific renders
    if (viewId === 'game') (window as any).renderGrove();
    if (viewId === 'market') (window as any).renderMarketplace();
    if (viewId === 'voting') (window as any).renderProposals();
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

//////////////---NEW -----------

try {
        const program = getProgram();
        
        // 1. Fetch Basic Balances
        const solBal = await connection.getBalance(user);
        const formattedSol = (solBal / LAMPORTS_PER_SOL).toFixed(3);
        
        // 2. Fetch DAO & Vault Global Data
        const daoData: any = await program.account.dao.fetch(daoPDA);
        const vaultBal = await connection.getBalance(vaultPDA);

        // 3. Fetch User Staking Account
        const { stakeAccount } = getStakePDAs(user);
        let userStaked = "0.00";
        try {
            const stakeData: any = await program.account.stakeAccount.fetch(stakeAccount);
            userStaked = (stakeData.amount.toNumber() / 1e9).toFixed(2);
        } catch (e) { /* Stake account might not exist yet */ }

        // UPDATE GOVERNANCE HUD ELEMENTS
        const update = (id: string, val: string) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        update('gov-user-sol', formattedSol);
        update('gov-user-staked', userStaked);
        update('gov-vault-sol', (vaultBal / LAMPORTS_PER_SOL).toFixed(3));
        update('gov-total-staked', (daoData.totalStaked.toNumber() / 1e9).toLocaleString());

        // Update the OLV Token Balance
        try {
            const userATA = getAssociatedTokenAddressSync(OLV_MINT, user);
            const tokenBal = await connection.getTokenAccountBalance(userATA);
            update('gov-user-olv', tokenBal.value.uiAmountString || "0");
        } catch (e) { update('gov-user-olv', "0.00"); }

    } catch (e) {
        console.warn("Governance HUD Sync Error:", e);
    }




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
// --- GOVERNANCE INTERACTIVITY ---

const markInvalid = (elId: string) => {
    const el = document.getElementById(elId);
    if (el) {
        el.classList.add('input-error');
        // Remove the error state after 1 second so the user can try again
        setTimeout(() => {
            el.classList.remove('input-error');
        }, 1000);
    }
};

// --- GLOBAL GOVERNANCE ACTIONS ---

/**
 * Handles the blockchain transaction for creating a new DAO proposal
 */
(window as any).submitProposal = async () => {
    console.log("Submit Proposal Initiated");
    try {
        const titleInput = document.getElementById('prop-title') as HTMLInputElement;
        const amountInput = document.getElementById('prop-amount') as HTMLInputElement;

        // --- UX GATEKEEPER ---
        if (!titleInput.value) {
            showToast("⚠️ Title required");
            return triggerGatekeeper(titleInput);
        }
        if (!amountInput.value || parseFloat(amountInput.value) <= 0) {
            showToast("⚠️ Valid SOL amount required");
            return triggerGatekeeper(amountInput);
        }

        // --- DEFINE VARIABLES TO MATCH IDL ---
        const description = titleInput.value; // Your code used 'title' but defined 'titleInput'
        const amountValue = parseFloat(amountInput.value); // Your code used 'amount'
        
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const proposalKeypair = Keypair.generate(); 

        console.log("Using DAO PDA:", daoPDA.toBase58());
        showToast("Requesting Signature...");

        // Note: According to your IDL, create_proposal args are:
        // 1. description (string)
        // 2. duration (i64)
        // 3. payout (u64)
        await program.methods
            .createProposal(
                description, // Corrected variable
                new anchor.BN(259200), 
                new anchor.BN(amountValue * LAMPORTS_PER_SOL) // Corrected variable
            )
            .accounts({
                dao: daoPDA,
                proposal: proposalKeypair.publicKey,
                creator: user,
                systemProgram: SystemProgram.programId,
            })
            .signers([proposalKeypair])
            .rpc();

        showToast("✅ Proposal Published!");
        (window as any).closeProposalModal();
        await (window as any).renderProposals();

    } catch (e: any) {
        console.error("Blockchain Error:", e);
        showToast("Transaction Failed");
    }
};
/**
 * Filter proposals by Active vs History
 */
(window as any).filterProposals = (tab: 'active' | 'history') => {
    console.log("Filtering proposals by:", tab);
    
    // Update Button UI
    const buttons = document.querySelectorAll('[onclick^="window.filterProposals"]');
    buttons.forEach(btn => {
        btn.classList.remove('text-green-400', 'border-b-2', 'border-green-500');
        btn.classList.add('text-gray-500');
    });

    const activeBtn = event?.currentTarget as HTMLElement;
    if (activeBtn) {
        activeBtn.classList.add('text-green-400', 'border-b-2', 'border-green-500');
        activeBtn.classList.remove('text-gray-500');
    }

    // Call the original render function (which now handles the filters)
    (window as any).renderProposals(tab);
};

/**
 * Opens the Create Proposal Modal
 */
(window as any).openProposalModal = () => {
    const modal = document.getElementById('proposal-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

(window as any).closeProposalModal = () => {
    const modal = document.getElementById('proposal-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};
// Define a default state so the app doesn't crash on load
const currentEnv = {
    time: 'NIGHT',
    season: 'WINTER',
    isHeatwave: false
};


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

    container.innerHTML = `<div class="text-center py-20 animate-pulse text-[10px] font-black uppercase text-gray-500">Syncing Ledger...</div>`;

    (window as any).currentTab = 'active'; // global filter state

    try {
        const program = getProgram();
        const now = Math.floor(Date.now() / 1000);

        const allProposals = await program.account.proposal.all();

        const filteredProposals = allProposals.filter((p: any) => {
            const isExpired = (p.account.endTs?.toNumber() ?? 0) < now;
            return (window as any).currentTab === 'active' ? !isExpired : isExpired;
        });

        let html = "";

        for (const p of filteredProposals) {
            const data = p.account;

            const endTs = data.endTs?.toNumber() ?? 0;
            const yesVotesRaw = data.yesVotes?.toNumber() ?? 0;
            const noVotesRaw = data.noVotes?.toNumber() ?? 0;

            const yesVotes = yesVotesRaw / 1e9;
            const noVotes = noVotesRaw / 1e9;
            const totalVotes = yesVotes + noVotes;

            const yesWidth = totalVotes > 0 ? (yesVotes / totalVotes) * 100 : 0;
            const noWidth = totalVotes > 0 ? (noVotes / totalVotes) * 100 : 0;

            const timeLeft = getTimeLeft(endTs);
            const isExpired = endTs < now;
            const programId = program.programId;  // <-- FIX missing reference

            // Check if already voted
            let hasVoted = false;
            let userVoteWeight = 0;

            if (user) {
                const [vRec] = PublicKey.findProgramAddressSync(
                    [Buffer.from("vote_record"), p.publicKey.toBuffer(), user.toBuffer()],
                    programId
                );

                const voteAcc = await program.account.voteRecord.fetchNullable(vRec);

                if (voteAcc) {
                    hasVoted = true;
                    userVoteWeight = (voteAcc.amount?.toNumber() ?? 0) / 1e9;
                }
            }

            // Action Button Logic
            let actionHtml = "";

            if (!user) {
                actionHtml = `<button disabled class="w-full py-4 bg-white/5 text-gray-600 rounded-xl text-[10px] font-black uppercase cursor-not-allowed">Connect Wallet to Participate</button>`;
            } else if (hasVoted) {
                actionHtml = `<div class="w-full py-4 bg-green-500/10 border border-green-500/20 text-green-500 rounded-xl text-center text-[10px] font-black uppercase italic">✓ Voted (${userVoteWeight.toFixed(2)} OLV)</div>`;
            } else if (!isExpired) {
                actionHtml = `
                    <div class="flex gap-3">
                        <button onclick="window.vote('${p.publicKey.toBase58()}', true)" class="flex-1 py-4 bg-green-500 text-black font-black rounded-xl text-xs uppercase hover:scale-[1.02] transition-transform">Support</button>
                        <button onclick="window.vote('${p.publicKey.toBase58()}', false)" class="flex-1 py-4 border border-white/10 text-white font-bold rounded-xl text-xs uppercase hover:bg-white/5 transition-all">Against</button>
                    </div>`;
            } else {
                actionHtml = `<div class="w-full py-4 bg-white/5 text-gray-500 rounded-xl text-center text-[10px] font-black uppercase italic">Voting Closed</div>`;
            }

            html += `
                <div class="prop-card mb-4 p-6 glass rounded-[2.5rem] border border-white/5 animate-fade-in-up">
                    <span class="text-[9px] text-gray-500 uppercase block mb-1">Ends: ${timeLeft}</span>
                    <h4 class="text-xl font-black uppercase text-white mb-4">${data.description}</h4>

                    <div class="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mb-2 flex">
                        <div class="h-full bg-green-500" style="width:${yesWidth}%"></div>
                        <div class="h-full bg-red-500" style="width:${noWidth}%"></div>
                    </div>

                    <div class="flex justify-between text-[9px] font-bold uppercase mb-6">
                        <span class="text-green-500">Support: ${yesVotes.toFixed(1)}</span>
                        <span class="text-red-500">Against: ${noVotes.toFixed(1)}</span>
                    </div>

                    ${actionHtml}
                </div>`;
        }

        container.innerHTML = html || `<p class="text-center py-20 text-gray-600 uppercase text-[10px] font-black">No proposals found</p>`;
    } 
    catch (e) {
        console.error("Render Error:", e);
        container.innerHTML = `<div class="text-center py-10 text-red-500 font-black text-[10px] uppercase">RPC Error - Try Refresh</div>`;
    }
};


// --- MARKETPLACE CONFIG ---
const TOTAL_TREES = 250;
const PRICE_SOL = 0.1;
const PRICE_OLV = 100;

(window as any).renderMarketplace = async () => {
    console.log("[Market] Starting render sequence...");
    const container = document.getElementById('market-listings');
    if (!container) return;

    // Clear and show loader
    container.innerHTML = `<div class="col-span-full py-20 text-center text-xs font-mono text-gray-500 animate-pulse">FETCHING MARKET DATA...</div>`;

    try {
        let html = "";
        // In a real app, you would fetch actual listing accounts from your IDL
        for (let i = 1; i <= TOTAL_TREES; i++) {
            const mockROI = (8 + Math.random() * 7).toFixed(1); // 8-15% ROI
            
            html += `
                <div class="glass p-6 rounded-[2.5rem] border border-white/5 hover:border-green-500/30 transition-all duration-500 group">
                    <div class="relative aspect-square mb-6 overflow-hidden rounded-[2rem] bg-gradient-to-b from-white/5 to-transparent flex items-center justify-center">
                        <span class="text-5xl group-hover:scale-110 transition-transform duration-500">🌳</span>
                        <div class="absolute top-4 right-4 bg-black/80 backdrop-blur-md px-3 py-1 rounded-full text-[9px] font-bold border border-white/10">
                            UNIT #${i.toString().padStart(3, '0')}
                        </div>
                    </div>

                    <div class="flex justify-between items-start mb-6">
                        <div>
                            <h4 class="font-black uppercase text-sm tracking-tight">Fractional Olive Tree</h4>
                            <p class="text-[10px] text-gray-500 font-bold uppercase mt-1">Status: <span class="text-green-500">Productive</span></p>
                        </div>
                        <div class="text-right">
                            <p class="text-[10px] text-gray-500 font-bold uppercase">ROI</p>
                            <p class="text-sm font-black text-white">${mockROI}%</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <button onclick="window.buyTree(${i}, 'SOL')" class="py-4 bg-white text-black rounded-2xl text-[10px] font-black uppercase hover:bg-green-400 transition-all">
                            ${PRICE_SOL} SOL
                        </button>
                        <button onclick="window.buyTree(${i}, 'OLV')" class="py-4 bg-white/5 text-white border border-white/10 rounded-2xl text-[10px] font-black uppercase hover:bg-white/10 transition-all">
                            ${PRICE_OLV} OLV
                        </button>
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
        console.log(`[Market] Successfully rendered ${TOTAL_TREES} listings.`);
    } catch (e) {
        console.error("[Market] Render error:", e);
        showToast("Failed to load market");
    }
};

(window as any).buyTree = async (id: number, currency: string) => {
    console.log(`[Transaction] Initiating purchase for Tree #${id} using ${currency}`);
    const wallet = (window as any).solana;
    
    if (!wallet.isConnected) {
        console.warn("[Transaction] Blocked: Wallet not connected");
        return showToast("Connect Wallet First");
    }

    try {
        showToast(`Confirming ${currency} Purchase...`);
        
        // This is where you would call your Anchor method from the IDL
        // Example: await program.methods.purchaseTree(new BN(id)).accounts({...}).rpc();
        
        console.log(`[Transaction] Success! Tree #${id} assigned to ${wallet.publicKey.toString()}`);
        showToast(`Purchased Tree #${id}!`, "success");
        
        // Refresh balances after purchase
        await (window as any).syncUI(); 
    } catch (e) {
        console.error("[Transaction] Error during purchase:", e);
        showToast("Transaction Denied");
    }
};


///// -----------FANTGAME---------
// --- THE OLIVE GROWER ENGINE ---

// --- 1. CONSOLIDATED GLOBAL STATS ENGINE ---


const updateGlobalFieldStats = () => {
    const statsBar = document.getElementById('field-stats-bar');
    if (!myGrove || myGrove.length === 0) {
        if (statsBar) statsBar.classList.add('hidden'); // Hide if no trees
        return;
    }
    
    if (statsBar) statsBar.classList.remove('hidden'); // Show if trees exist
    // CO2: Bigger level = more sequestration
    const totalCO2 = myGrove.reduce((acc, tree) => {
        const baseRate = tree.level === 1 ? 0.1 : tree.level === 2 ? 0.5 : 1.2;
        return acc + baseRate;
    }, 0);

    const avgHealth = myGrove.reduce((acc, t) => acc + t.health, 0) / myGrove.length;
    
    // Harvest Difficulty logic based on overgrown trees
    const overgrownCount = myGrove.filter(t => t.isOvergrown).length;

    // Update the UI Elements
    const co2El = document.getElementById('co2-total');
    const healthEl = document.getElementById('field-health');
    const diffEl = document.getElementById('harvest-diff');


    if (statsBar) statsBar.classList.remove('hidden');
    if (co2El) co2El.innerText = `${totalCO2.toFixed(2)} kg/hr`;
    
    if (healthEl) {
        healthEl.innerText = `${Math.round(avgHealth)}%`;
        healthEl.className = `text-xl font-black ${avgHealth < 40 ? 'text-red-500' : 'text-white'}`;
    }

    if (diffEl) {
        diffEl.innerText = overgrownCount > 0 ? `HARD (${overgrownCount} BLOCKED)` : 'NORMAL';
        diffEl.className = `text-xl font-black ${overgrownCount > 0 ? 'text-red-500' : 'text-green-400'}`;
    }
};


// --- SHOP LOGIC ---
// --- SHOP INTERFACE ---
(window as any).openShop = () => {
    console.log("🛒 Opening Shop...");

    // 1. Get values from main labels
    const walletOlv = document.getElementById('display-olv')?.innerText || "0.00";
    const stakedOlv = document.getElementById('gov-user-staked')?.innerText || "0.00";
    
    // 2. Update Shop IDs
    const shopOlvEl = document.getElementById('shop-olv');
    const shopStakedEl = document.getElementById('shop-staked');
    
    if (shopOlvEl) shopOlvEl.innerText = walletOlv;
    if (shopStakedEl) shopStakedEl.innerText = stakedOlv;

    // 3. Toggle Visibility
    const modal = document.getElementById('modal-shop');
    if (modal) {
        modal.classList.remove('hidden');
        // Play click sound if defined
        if (typeof (window as any).playClick === 'function') {
            (window as any).playClick();
        }
    } else {
        console.error("❌ Modal 'modal-shop' not found");
    }
};
const syncEnvironment = (env: any) => {
    // 🛑 THE FIX: If env is missing, default to a safe object so it doesn't crash
    if (!env) {
        console.warn("🌍 Env Sync: No data provided, using defaults.");
        env = { time: 'DAY', season: 'SUMMER', isHeatwave: false };
    }

    const gameView = document.getElementById('view-game');
    if (!gameView) return;

    // 1. Remove old classes
    const envClasses = ['time-night', 'time-day', 'time-dawn', 'time-dusk', 'season-winter', 'season-autumn', 'heatwave-active'];
    gameView.classList.remove(...envClasses);

    // 2. Apply new classes safely
    if (env.time) gameView.classList.add(`time-${env.time.toLowerCase()}`);
    if (env.season) gameView.classList.add(`season-${env.season.toLowerCase()}`);

    console.log(`🌍 Game View Sync: ${env.season} | ${env.time}`);
    
    // 3. Weather Banner
    const banner = document.getElementById('weather-banner');
    if (env.isHeatwave) {
        banner?.classList.remove('hidden');
        gameView.classList.add('heatwave-active');
    } else {
        banner?.classList.add('hidden');
    }
};

// --- INITIAL SYNC ---
// Pass the object into the function!
syncEnvironment(currentEnv); 

// Update every minute
setInterval(() => syncEnvironment(currentEnv), 60000);

(window as any).closeShop = () => {
    document.getElementById('modal-shop')?.classList.add('hidden');
};
(window as any).closeShop = () => {
    document.getElementById('modal-shop')?.classList.add('hidden');
};
(window as any).buyItem = async (item: string, price: number) => {
    const currentOlv = parseFloat(document.getElementById('display-olv')?.innerText || "0");

    if (currentOlv < price) {
        playSound(150, 'sawtooth', 0.2); // Low buzz for error
        showToast("❌ Not enough OLV");
        markInvalid('shop-bal-container');
        return;
    }

    // Success!
    (window as any).playSuccess(); 
    showToast(`Purchased ${item}!`);
    
    // ... logic to update inventory ...
    await syncUI();
};

// Initial Sync
syncEnvironment();
setInterval(syncEnvironment, 60000); // Re-sync every minute



async function updateLiveWeather() {
    // NYC Coords for testing
    const LAT = 43.1027715; 
    const LON = 10.5408628;

    try {
        console.log("📡 Requesting Open-Meteo...");
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m&timezone=auto`;
        
        const response = await fetch(url);
        const data = await response.json();

        if (!data.current) throw new Error("API response missing 'current' data");

        const c = data.current;

        // 1. Update the Central State
        gameState.weather.temp = Math.round(c.temperature_2m);
        gameState.weather.humidity = c.relative_humidity_2m;
        gameState.weather.wind = Math.round(c.wind_speed_10m);
        gameState.weather.timeStr = c.is_day === 1 ? 'DAY' : 'NIGHT';
        
        // Map WMO Codes (Snow: 71, 73, 75)
        const isSnowy = [71, 73, 75, 77, 85, 86].includes(c.weather_code);
        gameState.weather.seasonStr = (gameState.weather.temp < 10 || isSnowy) ? 'WINTER' : 'SUMMER';

        // 2. IMMEDIATE UI UPDATE (Fill the placeholders)
        const tempEl = document.getElementById('stat-temp');
        const humEl = document.getElementById('stat-humidity');
        const windEl = document.getElementById('stat-wind');
        const locEl = document.getElementById('stat-location');

        if (tempEl) tempEl.innerText = `${gameState.weather.temp}°C`;
        if (humEl) humEl.innerText = `${gameState.weather.humidity}%`;
        if (windEl) windEl.innerText = `${gameState.weather.wind} m/s`;
        if (locEl) locEl.innerText = `${gameState.weather.locale}`;

        console.log("✅ Weather state updated:", gameState.weather);
        
    } catch (e) {
        console.error("❌ Weather Fetch Failed:", e);
        if (document.getElementById('stat-location')) {
            document.getElementById('stat-location')!.innerText = "Offline";
        }
    }
}
function syncGameUI() {
    const gameView = document.getElementById('view-game');
    const badge = document.getElementById('weather-badge'); // Defined once here
    const icon = document.getElementById('weather-icon') as HTMLImageElement;
    // Add this inside syncGameUI after the season logic
if (gameState.weather.conditionCode >= 51) {
    gameView.classList.add('is-raining');
}
    if (!gameView) return;

    // 🛑 SAFETY CHECK
    if (!gameState.weather.timeStr || !gameState.weather.seasonStr) {
        console.warn("⏳ syncGameUI: Weather strings not ready yet...");
        return;
    }

    // 1. Update data text
    const tempEl = document.getElementById('stat-temp');
    const humEl = document.getElementById('stat-humidity');
    const windEl = document.getElementById('stat-wind');

    if (tempEl) tempEl.innerText = `${gameState.weather.temp}°C`;
    if (humEl) humEl.innerText = `${gameState.weather.humidity}%`;
    if (windEl) windEl.innerText = `${gameState.weather.wind} m/s`;

    // 2. Environmental Visuals
    // Reset classes to base, then add dynamic ones
    gameView.className = 'view-section py-20 min-h-screen relative overflow-hidden'; 
    gameView.classList.add(`time-${gameState.weather.timeStr.toLowerCase()}`);
    gameView.classList.add(`season-${gameState.weather.seasonStr.toLowerCase()}`);

    // 3. Heatwave Logic
    if (gameState.weather.temp > 35) {
        gameView.classList.add('heatwave-active');
        badge?.classList.remove('hidden');
    } else {
        badge?.classList.add('hidden');
    }

    // 4. Update Icon based on Day/Night
    const suffix = gameState.weather.isDay ? 'd' : 'n';
    let iconCode = '01'; 
    if (gameState.weather.conditionCode >= 1 && gameState.weather.conditionCode <= 3) iconCode = '02';
    if (gameState.weather.conditionCode >= 51) iconCode = '09'; // Rain
    
    if (icon) {
        icon.src = `https://openweathermap.org/img/wn/${iconCode}${suffix}.png`;
    }
}
// --- START THE ENGINE ---
const initGameEngine = async () => {
    // 1. First fetch
    await updateLiveWeather();

    // 2. The single Master Interval
    setInterval(async () => {
        // A. Weather Refresh (Every 15 mins)
        if (Date.now() - gameState.lastFetch > 900000) {
            await updateLiveWeather();
            gameState.lastFetch = Date.now();
        }

        // B. Tree Decay Logic
        const isRaining = gameState.weather.condition.includes("RAIN");
        
        myGrove.forEach(tree => {
            let decay = gameState.weather.isHeatwave ? 7 : 2;
            if (isRaining) decay = -4; // Rain replenishes water
            
            tree.water = Math.max(0, Math.min(100, (tree.water || 0) - decay));
            if (tree.water === 0) tree.health = Math.max(0, (tree.health || 100) - 2);
        });

        // C. UI Updates
        syncGameUI();
        saveAndRender(); 
        
    }, 5000); 
};

initGameEngine();
// --- THE MASTER ENGINE ---
setInterval(async () => {
    const now = new Date();

    // 1. Clock Update
    const timeDisplay = document.getElementById('display-time');
    if (timeDisplay) {
        timeDisplay.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    // 2. Fetch Weather (Every 10 Minutes)
    // We use your lat/lon (example: 40.7128, -74.0060 for NYC)
    if (!gameState.lastFetch || (Date.now() - gameState.lastFetch > 600000)) {
        await updateLiveWeather(43.1027715,10.5408628);
        gameState.lastFetch = Date.now();
    }

    // 3. Process Tree Dynamics
    const isRaining = gameState.weather.condition.includes("RAIN") || gameState.weather.condition.includes("SHOWERS");
    
    myGrove.forEach(tree => {
        let decayRate = gameState.weather.isHeatwave ? 7 : 2;
        if (isRaining) decayRate = -3; // Rain replenishes water!

        tree.water = Math.max(0, Math.min(100, tree.water - decayRate));
        if (tree.water === 0) tree.health = Math.max(0, tree.health - 3);
        if (Math.random() > 0.99) tree.isOvergrown = true;
    });

    // 4. Final UI Sync
    syncGameUI();
    saveAndRender(); 
}, 5000);
// Fetch weather every 10 minutes
updateLiveWeather();
setInterval(updateLiveWeather, 600000);


// --- 2. THE MASTER GAME LOOP ---
setInterval(() => {
    // A. Check Oracle for Heatwave
    const oracleRaw = localStorage.getItem('olive_oracle_data');
const oracle = getOracleData(); // Get fresh data every 5s
    const isHeatwave = oracle.temp > 35;
	const weather = getCurrentWeather();
       const activeHeatwave = weather.temp > 35;  
    
    
    // B. Control HUD Visibility & Visual Effects
    const banner = document.getElementById('weather-banner');
    if (banner) {
        if (isHeatwave) {
            banner.classList.remove('hidden');
            document.body.style.boxShadow = "inset 0 0 100px rgba(255, 100, 0, 0.2)";
        } else {
            banner.classList.add('hidden');
            document.body.style.boxShadow = "none";
        }
    }

    // 3. Process Tree Decay
    myGrove.forEach(tree => {
        const decayRate = activeHeatwave ? 7 : 2;
        tree.water = Math.max(0, tree.water - decayRate);
        if (tree.water === 0) tree.health = Math.max(0, tree.health - 3);
        
        // Random chance to become overgrown
        if (Math.random() > 0.99) tree.isOvergrown = true;
    });

    updateGlobalFieldStats(); // Updates the HUD
    saveAndRender();         // Updates the Trees
}, 5000);


(window as any).renderGrove = () => {
    const container = document.getElementById('grove-grid');
    if (!container) return;

    container.innerHTML = myGrove.map(tree => {
        // Determine the tree stage emoji based on level
        const stage = tree.level === 1 ? '🌱' : tree.level === 2 ? '🌿' : '🌳';
        const difficultyColor = tree.isOvergrown ? 'text-red-500' : 'text-gray-500';
// Inside your renderGrove .map function:
const overgrownLabel = tree.isOvergrown 
    ? `<p class="text-[10px] font-black text-red-500 animate-pulse">⚠️ OVERGROWN</p>` 
    : `<p class="text-[10px] font-black text-gray-500 uppercase tracking-widest">✓ PRUNED</p>`;
        
        // Calculate health-based border colors for the card
        const cardBorder = tree.health < 40 ? 'border-red-500/50' : 'border-white/5';
        
        return `
        <div class="glass p-6 rounded-[2.5rem] border ${cardBorder} relative group transition-all" data-tree-id="${tree.id}">
            <div class="absolute top-4 right-4 text-[8px] font-black text-white/20">LVL ${tree.level}</div>
            
            <div class="text-center py-8 cursor-pointer hover:scale-110 transition-transform" onclick="window.tendTree(${tree.id}, 'water', event)">
                <span class="text-7xl block mb-2">${stage}</span>
                
                <div class="mt-4 w-20 h-1 bg-white/5 mx-auto rounded-full overflow-hidden">
                    <div class="h-full bg-green-500 transition-all duration-500" 
                         style="width: ${tree.xp % 100}%"></div>
                </div>
                <p class="text-[7px] text-center mt-1 uppercase text-gray-500">Progress to LVL ${tree.level + 1}</p>
            </div>

            <div class="space-y-4">
                <div class="flex justify-between items-end">
                    <p class="text-[10px] font-black uppercase ${difficultyColor}">
                        ${tree.isOvergrown ? '⚠️ OVERGROWN' : '✓ Pruned'}
                    </p>
                    <p class="text-[10px] font-black text-blue-400">${tree.water}% H2O</p>
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <button onclick="window.tendTree(${tree.id}, 'water', event)" 
                            class="py-3 bg-blue-500/10 text-blue-400 rounded-xl text-[9px] font-black uppercase hover:bg-blue-500 hover:text-white transition-all">
                        Water
                    </button>
                    <button onclick="window.tendTree(${tree.id}, 'prune', event)" 
                            class="py-3 bg-yellow-500/10 text-yellow-500 rounded-xl text-[9px] font-black uppercase hover:bg-yellow-500 hover:text-black transition-all">
                        Prune
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join('');
    
    // Call the correct global stats function
    updateGlobalFieldStats();
};

const saveAndRender = () => {
    localStorage.setItem('my_grove', JSON.stringify(myGrove));
    (window as any).renderGrove();
};


(window as any).plantSeedling = () => {
    myGrove.push({ id: Date.now(), health: 100, water: 100, xp: 0, level: 1, isOvergrown: false });
    saveAndRender();
};
(window as any).tendTree = (id: number, action: string, event: MouseEvent) => {
    const tree = myGrove.find(t => t.id === id);
    if (!tree) return;

    // FIX: Get fresh weather data here to prevent ReferenceError
    const weather = getOracleData();
    const isHeatwave = weather.temp > 35;

    if (action === 'water') {
        tree.water = Math.min(100, tree.water + (isHeatwave ? 12 : 25));
        tree.health = Math.min(100, tree.health + 5);
        showXP(event.clientX, event.clientY, "+H2O");
    } else if (action === 'prune') {
        tree.xp += 20;
        if (tree.xp >= 100) { tree.level += 1; tree.xp = 0; showToast("Level Up!"); }
        showXP(event.clientX, event.clientY, "+20 XP");
    }
// --- CRITICAL: Save and Update UI ---
    localStorage.setItem('my_grove', JSON.stringify(myGrove)); // Persist the change
    (window as any).renderGrove(); // Force the HTML to redraw without "OVERGROWN"
    
    saveAndRender();
};



// Visual Feedback Helper
const showXP = (x: number, y: number, text: string) => {
    const el = document.createElement('div');
    el.className = 'fixed font-black text-green-400 pointer-events-none z-[100] animate-float-up text-xs';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerText = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
};
(window as any).connectWallet = async () => {
    try {
        const resp = await (window as any).solana.connect();
        console.log("Connected:", resp.publicKey.toString());
        await syncUI();
        showToast("Wallet Connected");
    } catch (err) {
        console.error("Connection failed", err);
    }
};



///--- SHAKE NO EMPTY FIELDS ------


// Helper to visually alert the user
const flashError = (elId: string) => {
    const el = document.getElementById(elId);
    if (el) {
        el.classList.add('border-red-500', 'animate-shake'); // Add CSS shake
        setTimeout(() => el.classList.remove('border-red-500', 'animate-shake'), 1000);
    }
};
/////-----STAKE OLV ---UNSTAKE OLV -------

// --- STAKING LOGIC ---
// --- STAKING GATEKEEPER ---

const triggerGatekeeper = (el: HTMLInputElement) => {
    // 1. Add shake and red border
    el.classList.add('animate-shake');
    
    // 2. Play a subtle haptic/audio cue (optional)
    console.warn("🚫 Action blocked: Field validation failed.");

    // 3. Remove the class after animation finishes (0.3s) 
    // so it can be triggered again on next click
    setTimeout(() => {
        el.classList.remove('animate-shake');
    }, 400);
};
(window as any).processStake = async () => {
    const input = document.getElementById('stake-amount') as HTMLInputElement;
    const amountStr = input?.value || "0";
    const amount = parseFloat(amountStr);

    // 1. UX GATEKEEPER
    if (!amountStr || amount <= 0) {
        console.log("🚫 Stake blocked: Empty Input");
        showToast("⚠️ Please enter a stake amount");
        // Ensure this function exists in your main.ts to apply the .input-error class
        (window as any).markInvalid('stake-amount'); 
        return; 
    }

    console.log("Initiating Staking Logic...");
    
    try {
        const program = getProgram();
        const userPubKey = (window as any).solana.publicKey; // Get the user's wallet address

        if (!userPubKey) {
            showToast("❌ Please connect wallet first");
            return;
        }

        // 2. DERIVE NECESSARY ACCOUNTS
        const { stakeAccount, stakeVault } = getStakePDAs(userPubKey);
        
        // Sync version is faster/cleaner here
        const userATA = getAssociatedTokenAddressSync(OLV_MINT, userPubKey);

        showToast(`Staking ${amount} OLV...`);

        // 3. SEND TRANSACTION
        // Note: Check your Rust/Anchor code. Most use .accounts({ userToken: ... }) 
        // I have included both common names below; remove the one your IDL doesn't use.
        await program.methods
            .stake(new anchor.BN(amount * 10**9)) 
            .accounts({
                user: userPubKey,               // The signer
                userToken: userATA,             // The user's OLV wallet
                dao: daoPDA,                    // Your Global State/DAO account
                stakeAccount: stakeAccount,     // The PDA storing user stake info
                stakeVault: stakeVault,         // The PDA holding the actual tokens
                stakeMint: OLV_MINT,            
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                // rent: anchor.web3.SYSVAR_RENT_PUBKEY, // Add if your program requires it
            })
            .rpc();

        showToast("✅ Staking Successful!");
        input.value = ""; // Clear input
        await syncUI();   // Update balances globally
        
    } catch (e: any) {
        console.error("Stake Error Details:", e);
        // Better error reporting for the user
        const errorMsg = e.message || "Staking Failed";
        showToast(`❌ ${errorMsg.slice(0, 30)}...`);
    }
};
(window as any).processUnstake = async () => {
    const input = document.getElementById('unstake-amount') as HTMLInputElement;
    const amount = parseFloat(input?.value || "0");

    // UX GATEKEEPER
    if (!input?.value || amount <= 0) {
        console.log("🚫 Unstake blocked: Empty Input");
        showToast("⚠️ Enter amount to unstake");
        markInvalid('unstake-amount'); // <--- Triggers the Red Box & Shake
        return;
    }


    console.log("Initiating Unstake Logic...");
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const { stakeAccount, stakeVault } = getStakePDAs(user);
        const userATA = getAssociatedTokenAddressSync(OLV_MINT, user);

        showToast(`Unstaking ${amount} OLV...`);

        await program.methods
            .unstake(new anchor.BN(amount * 1e9))
            .accounts({
                dao: daoPDA,
                stakeAccount: stakeAccount,
                stakeVault: stakeVault,
                user: user,
                userToken: userATA,     // MATCHES YOUR ERROR: 'userToken'
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        showToast("✅ Unstaked Successfully!");
        input.value = "";
        await syncUI();
    } catch (e: any) {
        console.error("Unstake Error Details:", e);
        showToast("Unstake Failed");
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
// --- WALLET CONNECT & DISCONNECT ---
(window as any).connectWallet = async () => {
    const { solana } = window as any;
    if (!solana) return alert("Please install Phantom Wallet");

    // If already connected, clicking the button disconnects
    if (solana.isConnected) {
        await solana.disconnect();
        return;
    }

    try {
        const response = await solana.connect();
        const publicKey = response.publicKey.toString();

        showToast("Wallet Connected");
        updateActionState(true);

        const connectBtn = document.getElementById('connect-btn');
        if (connectBtn) {
            connectBtn.innerText = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
            connectBtn.classList.add('bg-green-500/10', 'text-green-500', 'border', 'border-green-500/20');
        }

        await syncUI();
        await (window as any).renderProposals(); 
    } catch (err) {
        console.error("Connection Error:", err);
        showToast("Connection Failed");
        updateActionState(false);
    }
};

// Listen for the actual event from Phantom
(window as any).solana.on('disconnect', () => {
    showToast("Session Ended");
    
    // Clear all balances in the UI
    ['display-sol', 'display-olv', 'user-staked', 'total-staked'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = "0.00";
    });

    updateActionState(false);
    (window as any).renderProposals(); // Re-render in "Read Only" mode
});
/**
 * Global UI Gatekeeper
 * Disables all interaction except the Nav when wallet is disconnected.
 */
const updateActionState = (isConnected: boolean) => {
    // 1. Toggle the body class to trigger your CSS grayscale/pointer-events filter
    if (isConnected) {
        document.body.classList.remove('wallet-disconnected');
    } else {
        document.body.classList.add('wallet-disconnected');
    }

    // 2. Explicitly disable buttons that require a wallet
    const actionButtons = document.querySelectorAll('.requires-wallet') as NodeListOf<HTMLButtonElement>;
    
    actionButtons.forEach(btn => {
        btn.disabled = !isConnected;
        
        if (!isConnected) {
            // Save original text if not already saved
            if (!btn.dataset.originalText) btn.dataset.originalText = btn.innerText;
            btn.innerText = "Connect Wallet";
        } else if (btn.dataset.originalText) {
            // Restore original text
            btn.innerText = btn.dataset.originalText;
        }
    });
};


(window as any).showView = (viewId: string) => {
// 1. Hide every single section
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.add('hidden');
    });

    // 2. Show only the one you want
    const activeView = document.getElementById(viewId);
    if (activeView) activeView.classList.remove('hidden');
    const sections = document.querySelectorAll('.view-section');
    sections.forEach(s => {
        s.classList.add('hidden', 'opacity-0');
        s.style.transform = "translateY(10px)";
    });

  //  const active = document.getElementById(`view-${viewId}`);
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