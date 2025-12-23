import './polyfill'; 
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import idl from "./idl.json";

const OLV_MINT = new PublicKey("6nab5Rttp45AfjaYrdwGxKuH9vK9RKCJdeaBvQJt8pLA");
const DAO_STAKE_VAULT = new PublicKey("FrNP32Hxhuu4pS8yguHhtTEdU9QpU7odRYi5zKNps15N");
const programId = new PublicKey("B3EdVG6FJndxAemD9fXqVSYmoqhmY11TZShuTHGjV5Wz");

// Fix: Use a single stable connection instance
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// --- FIXED ANCHOR PROGRAM GETTER ---
const getProgram = () => {
    const provider = (window as any).solana;
    if (!provider) throw new Error("Wallet not found");

    // We MUST pass the 'connection' explicitly to the AnchorProvider
    const anchorProvider = new anchor.AnchorProvider(
        connection, 
        provider, 
        { preflightCommitment: "confirmed" }
    );
    return new anchor.Program(idl as any, anchorProvider);
};

const updateAll = (className: string, value: string) => {
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) (elements[i] as HTMLElement).innerText = value;
};

// --- GLOBAL FUNCTIONS ---

(window as any).updateUIBalances = async () => {
    console.log("DEBUG: Refreshing UI Balances...");
    const provider = (window as any).solana;
    if (!provider?.isConnected) return;

    const wallet = provider.publicKey;
    updateAll("val-addr", wallet.toBase58().slice(0, 5));
    
    const connectBtn = document.getElementById('connect');
    if (connectBtn) connectBtn.innerText = "CONNECTED";

    try {
        const solBal = await connection.getBalance(wallet);
        updateAll("val-sol", (solBal / LAMPORTS_PER_SOL).toFixed(3));

        const ata = getAssociatedTokenAddressSync(OLV_MINT, wallet);
        const tokenBal = await connection.getTokenAccountBalance(ata);
        updateAll("val-olv", (tokenBal.value.uiAmount ?? 0).toFixed(2));

        const vaultSol = await connection.getBalance(DAO_STAKE_VAULT);
        updateAll("val-tvl", (vaultSol / LAMPORTS_PER_SOL).toFixed(2) + " SOL");
    } catch (err) {
        console.warn("DEBUG: Balance sync issue", err);
    }
};

(window as any).renderProposals = async () => {
    console.log("DEBUG: Fetching Proposals from Chain...");
    const list = document.getElementById("proposal-list");
    if (!list) return;

    try {
        const program = getProgram();
        // This is where the getProgramAccounts error was occurring
        const proposals = await program.account.proposal.all();
        console.log(`DEBUG: Found ${proposals.length} live proposals`);
        
        list.innerHTML = ""; 
        proposals.forEach((p: any) => {
            const card = document.createElement("div");
            card.className = "p-6 glass border border-white/10 rounded-[32px] space-y-4 hover:border-green-400/50 transition-all";
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <h4 class="text-lg font-black italic uppercase">${p.account.title}</h4>
                    <span class="text-[8px] bg-white/10 px-2 py-1 rounded-md font-mono text-gray-400">${p.publicKey.toBase58().slice(0,6)}</span>
                </div>
                <p class="text-gray-500 text-xs leading-relaxed">${p.account.description}</p>
                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button onclick="window.castVote('${p.publicKey.toBase58()}', true)" class="bg-green-500/20 text-green-400 py-3 rounded-2xl text-[10px] font-black uppercase hover:bg-green-400 hover:text-black transition-all">Yes: ${p.account.votesFor}</button>
                    <button onclick="window.castVote('${p.publicKey.toBase58()}', false)" class="bg-red-500/20 text-red-400 py-3 rounded-2xl text-[10px] font-black uppercase hover:bg-red-400 hover:text-black transition-all">No: ${p.account.votesAgainst}</button>
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        console.error("DEBUG: Proposal Render Error", err);
        list.innerHTML = `<p class="text-red-500 text-xs italic">RPC Error: Unable to fetch accounts.</p>`;
    }
};

(window as any).stakeOLV = async () => {
    const amountStr = (document.getElementById('stake-input') as HTMLInputElement).value;
    if (!amountStr) return alert("Enter amount");
    
    try {
        console.log(`DEBUG: Staking ${amountStr} OLV...`);
        const program = getProgram();
        const amount = new anchor.BN(parseFloat(amountStr) * 1e9); // Adjust for 9 decimals
        
        // Replace 'stake' with your actual instruction name from IDL
        const tx = await program.methods.stake(amount).rpc();
        console.log("DEBUG: Stake TX Success:", tx);
        alert("Stake Confirmed!");
        (window as any).updateUIBalances();
    } catch (err) {
        console.error("DEBUG: Stake Error", err);
    }
};

(window as any).createProposal = async () => {
    const title = (document.getElementById('prop-title') as HTMLInputElement).value;
    const desc = (document.getElementById('prop-desc') as HTMLInputElement).value;
    if (!title || !desc) return alert("Missing fields");

    try {
        console.log(`DEBUG: Creating Proposal: ${title}`);
        const program = getProgram();
        const tx = await program.methods.createProposal(title, desc).rpc();
        console.log("DEBUG: Proposal TX Success:", tx);
        alert("Proposal Live on Chain!");
        (window as any).renderProposals();
    } catch (err) {
        console.error("DEBUG: Creation Error", err);
    }
};

(window as any).castVote = async (id: string, side: boolean) => {
    try {
        console.log(`DEBUG: Voting ${side} on ${id}`);
        const program = getProgram();
        const tx = await program.methods.vote(side).accounts({
            proposal: new PublicKey(id)
        }).rpc();
        console.log("DEBUG: Vote TX Success:", tx);
        (window as any).renderProposals();
    } catch (err) {
        console.error("DEBUG: Vote Error", err);
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

window.addEventListener('load', async () => {
    const provider = (window as any).solana;
    if (provider) {
        provider.on("connect", () => (window as any).showView('voting'));
        try { await provider.connect({ onlyIfTrusted: true }); } catch (e) {}
    }
    document.getElementById('connect')?.addEventListener('click', async () => {
        provider?.isConnected ? await provider.disconnect() : await provider.connect();
    });
    (window as any).showView('home');
});