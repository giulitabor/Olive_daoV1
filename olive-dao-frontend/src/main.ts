import './polyfill'; 
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import idl from "./idl.json";


const SystemProgram = anchor.web3.SystemProgram;

// --- CONFIG ---
const OLV_MINT = new PublicKey("6nab5Rttp45AfjaYrdwGxKuH9vK9RKCJdeaBvQJt8pLA");
const programId = new PublicKey("8MdiqqhZj1badeLArqCmZWeiWGK8tXQWiydRLcqzDn45");
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const ADMIN_WALLET = "8xkNHk2VpWBM6Nk3enitFCs7vwh2inCveTNintcXHc54";

const getProgram = () => {
  const provider = new anchor.AnchorProvider(connection, (window as any).solana, { preflightCommitment: "confirmed" });
  return new anchor.Program(idl as any, provider);
};

// --- ADDRESS FORMATTING ---
function formatAddress(addr: string) {
    return `${addr.slice(0, 6)}...${addr.slice(-5)}`;
}

// --- VIEW MANAGEMENT ---
(window as any).showView = (viewId: string) => {
    // List of all view elements
    const views = ['view-home', 'view-voting', 'view-whitepaper', 'view-game'];
    
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.classList.add('hidden');
    });

    const activeView = document.getElementById(`view-` + viewId);
    if (activeView) activeView.classList.remove('hidden');

    if (viewId === 'voting') renderProposals();
};
async function updateDAOMetrics() {
    console.log("--- DEBUG: Updating Metrics ---");
    try {
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        console.log("User Wallet:", user?.toBase58());

        const [daoPDA] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
        const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
        
        console.log("Derived DAO PDA:", daoPDA.toBase58());
        console.log("Derived Vault PDA:", vaultPDA.toBase58());

        // 1. Vault Balance
        const vaultBalance = await connection.getBalance(vaultPDA);
        console.log("Raw Vault Balance (lamports):", vaultBalance);
        
        // 2. DAO Account Data
        console.log("Fetching DAO account data...");
        const daoData = await program.account.dao.fetch(daoPDA);
        console.log("Raw DAO Data Object:", daoData);
        
        const totalStaked = daoData.totalStaked.toNumber() / 1e9;
        console.log("Calculated Total Staked:", totalStaked);


	// 3. Fetch Personal Stake (for Active Governance Stake display)
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
                	// User might not have a stake account yet
                	if (document.getElementById("user-staked-display")) {
                    	document.getElementById("user-staked-display")!.innerText = "0";
                	}
            	}
        	}


        // Update UI
        document.getElementById('vault-balance')!.innerText = (vaultBalance / 1e9).toFixed(4);
        document.getElementById('total-staked')!.innerText = totalStaked.toLocaleString();

    } catch (err) {
        console.error("DEBUG ERROR in updateDAOMetrics:", err);
    }
}
// Call this every time a transaction finishes

// --- UI UPDATES ---

// 1. Derive the Vault PDA
const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    programId
);

// 2. Display the address on your UI
const vaultAddressElement = document.getElementById('vault-address');
if (vaultAddressElement) {
    vaultAddressElement.innerText = vaultPDA.toBase58();
}

// 3. Donation Function
(window as any).donateToDao = async () => {
    const amountInput = document.getElementById('donate-amount') as HTMLInputElement;
    const solAmount = parseFloat(amountInput.value);
    
    if (isNaN(solAmount) || solAmount <= 0) return alert("Enter a valid SOL amount");

    try {
        const transaction = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.transfer({
                fromPubkey: (window as any).solana.publicKey,
                toPubkey: vaultPDA,
                lamports: solAmount * anchor.web3.LAMPORTS_PER_SOL,
            })
        );

        const signature = await (window as any).solana.signAndSendTransaction(transaction);
        await connection.confirmTransaction(signature);
        
        alert(`Donated ${solAmount} SOL to Treasury!`);
        updateUIBalances(); // Refresh the vault balance display
    } catch (err) {
        console.error("Donation failed", err);
    }
};

const updateVaultBalance = async () => {
    const balance = await connection.getBalance(vaultPDA);
    const vaultDisplay = document.getElementById('vault-balance');
    if (vaultDisplay) {
        vaultDisplay.innerText = (balance / anchor.web3.LAMPORTS_PER_SOL).toFixed(4) + " SOL";
    }
};

async function updateUIBalances() {
  try {
    const program = getProgram();
    const wallet = program.provider.publicKey;
    if (!wallet) return;
// Show Mini-Wallet UX
    const mini = document.getElementById('wallet-mini');
    const addrDisp = document.getElementById('addr-display');
   if (mini && addrDisp) {
        mini.classList.remove('hidden');
        // Truncate: first 6 characters ... last 5 characters
        const base58 = wallet.toBase58();
        addrDisp.innerText = `${base58.slice(0, 6)}...${base58.slice(-5)}`;
    }

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
// --- PROPOSAL RENDER (FIXED) ---
async function renderProposals() {
    const program = getProgram();
    const voter = (window as any).solana.publicKey;
    const container = document.querySelector('#proposal-list')!;
    container.innerHTML = "";
    const now = Math.floor(Date.now() / 1000);

    let userStakeBalance = 0;

    // 1. Check user's staking balance first
    if (voter) {
        try {
            const [stakeAccountPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("stake"), voter.toBuffer()],
                programId
            );
            const stakeData = await program.account.stakeAccount.fetch(stakeAccountPDA);
            userStakeBalance = stakeData.amount.toNumber(); 
        } catch (e) {
            userStakeBalance = 0; // No stake account found
        }
    }

    try {
        const proposals = await program.account.proposal.all();
        
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
                } catch { hasVoted = false; }
            }

            const isExpired = now > p.account.endTs.toNumber();
            const didPass = p.account.yesVotes.toNumber() > p.account.noVotes.toNumber();
            const canExecute = isExpired && !p.account.executed && didPass;
            const canVote = !isExpired && !hasVoted && userStakeBalance > 0;

            const card = document.createElement('div');
            card.className = "glass p-6 rounded-2xl border border-white/5 space-y-4 hover:border-green-400/20 transition-all";
            
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-black text-lg italic tracking-tighter uppercase">${p.account.description}</h3>
                    <span class="text-[9px] px-2 py-1 rounded-md bg-white/5 ${isExpired ? 'text-red-400' : 'text-green-400'}">
                        ${isExpired ? 'FINALIZED' : 'ACTIVE'}
                    </span>
                </div>

                <div class="flex gap-2">
                    <div class="flex-1 bg-black/40 p-3 rounded-xl border border-white/5 text-center">
                        <p class="text-[9px] text-gray-500 uppercase">Yes Votes</p>
                        <p class="font-bold text-green-400">${(p.account.yesVotes.toNumber() / 1e9).toFixed(0)}</p>
                    </div>
                    <div class="flex-1 bg-black/40 p-3 rounded-xl border border-white/5 text-center">
                        <p class="text-[9px] text-gray-500 uppercase">No Votes</p>
                        <p class="font-bold text-red-400">${(p.account.noVotes.toNumber() / 1e9).toFixed(0)}</p>
                    </div>
                </div>

                ${hasVoted ? 
                    `<div class="w-full py-2 bg-green-500/10 text-green-400 text-center rounded-xl text-[10px] font-bold uppercase italic">Voted ✓</div>` :
                    (canVote ? `
                        <div class="flex gap-2">
                            <button onclick="window.vote('${p.publicKey.toBase58()}', true)" class="flex-1 py-2 bg-white text-black rounded-xl font-bold hover:bg-green-400 transition text-xs">YES</button>
                            <button onclick="window.vote('${p.publicKey.toBase58()}', false)" class="flex-1 py-2 border border-white/10 rounded-xl font-bold hover:bg-red-500/20 transition text-xs">NO</button>
                        </div>` : 
                        (!isExpired ? `<div class="w-full py-2 bg-white/5 text-gray-500 text-center rounded-xl text-[10px] uppercase italic">Stake OLV to Vote</div>` : '')
                    )
                }

                ${canExecute ? 
                    `<button onclick="window.executeProposal('${p.publicKey.toBase58()}')" class="w-full py-2 bg-green-400 text-black font-bold rounded-xl text-xs uppercase">Execute Payout</button>` : 
                    (isExpired && !didPass ? `<div class="text-center text-red-400 text-[10px] font-bold uppercase py-2 bg-red-500/5 rounded-xl">Rejected</div>` : '')
                }
            `;
            container.appendChild(card);
        }
    } catch (err) { console.error("Proposal render failed:", err); }
}



// --- GLOBAL HANDLERS ---

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
    
    const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from("stake"), voter.toBuffer()], programId);
    const [voteRecord] = PublicKey.findProgramAddressSync([Buffer.from("vote_record"), propKey.toBuffer(), voter.toBuffer()], programId);

    try {
        await program.methods.vote(side).accounts({
            proposal: propKey,
            stakeAccount,
            voteRecord,
            voter,
            systemProgram: SystemProgram.programId,
        }).rpc();
        renderProposals();
    } catch (e) {
        console.error("Vote failed:", e);
        alert("Vote failed. Do you have tokens staked?");
    }
};

(window as any).executeProposal = async (proposalId: string) => {
    const program = getProgram();
    const propKey = new PublicKey(proposalId);
    const user = (window as any).solana.publicKey;

    try {
        const propData = await program.account.proposal.fetch(propKey);
        const [dao] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
        const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);

        await program.methods.execute().accounts({
            dao,
            proposal: propKey,
            authority: user,
            vault,
            recipient: propData.creator, // Pays out to whoever created it
            systemProgram: SystemProgram.programId,
        }).rpc();

        alert("Proposal Executed! SOL Sent.");
        renderProposals();
        updateDAOMetrics();
    } catch (e) {
        console.error("Execution failed:", e);
    }
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
            updateDAOMetrics();
        } else {
            (window as any).showView('home');
        }
    };

    if (provider) {
        provider.on("connect", refreshWalletUI);
        provider.on("disconnect", refreshWalletUI);
        if (provider.isConnected) refreshWalletUI();
    }

    
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

// Apply to your fields
watchInputs('stake-amount', 'stake-btn');
watchInputs('amount-input', 'create-btn');
document.querySelector('#create-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    
    // Prevent double-clicks immediately
    if (btn.disabled) return;
    
    const titleInput = document.querySelector('#title-input') as HTMLInputElement;
    const amountInput = document.querySelector('#amount-input') as HTMLInputElement;
    
    const description = titleInput.value.trim();
    const payoutAmount = parseFloat(amountInput.value);
    const PROPOSAL_FEE = 0.0132 * LAMPORTS_PER_SOL;

    // Validation
    if (!description || isNaN(payoutAmount) || payoutAmount <= 0) {
        return alert("Please fill in a valid description and payout amount.");
    }

    try {
        btn.disabled = true;
        btn.innerText = "PROCESSING...";
        
        const program = getProgram();
        const user = (window as any).solana.publicKey;
        const proposalKeypair = anchor.web3.Keypair.generate();

        // Build the transaction
        const tx = await program.methods.createProposal(
            description, 
            new anchor.BN(3600), // 1 hour
            new anchor.BN(payoutAmount * 1e9)
        )
        .accounts({
            dao: daoPDA,
            proposal: proposalKeypair.publicKey,
            creator: user,
            systemProgram: SystemProgram.programId,
        })
        .instruction();

        // Add the Fee Transfer (0.0132 SOL to the Vault)
        const feeIx = SystemProgram.transfer({
            fromPubkey: user,
            toPubkey: vaultPDA,
            lamports: PROPOSAL_FEE,
        });

        const transaction = new anchor.web3.Transaction().add(feeIx).add(tx);
        
        // Send and confirm
        const signature = await (window as any).solana.signAndSendTransaction(transaction);
        await connection.confirmTransaction(signature, "confirmed");

        alert(`Proposal Live! Fee of 0.0132 SOL sent to Treasury.`);
        
        // Reset Form
        titleInput.value = "";
        amountInput.value = "";
        renderProposals();
        updateDAOMetrics();

    } catch (err) {
        console.error("Creation failed:", err);
        alert("Transaction failed. Make sure you have enough SOL for the fee.");
    } finally {
        btn.disabled = false;
        btn.innerText = "CREATE PROPOSAL";
    }
});
// --- LIVE LISTENER ---
// This watches the program's Proposal accounts and refreshes the UI automatically
connection.onProgramAccountChange(
    programId,
    () => {
        console.log("--- ON-CHAIN CHANGE DETECTED: Refreshing ---");
        renderProposals();
        updateDAOMetrics();
    },
    'confirmed',
    [
        { dataSize: 1000 } // Only listen for accounts roughly the size of a Proposal
    ]
);

// Fallback: Refresh every 10 seconds just in case
setInterval(() => {
    renderProposals();
    updateDAOMetrics();
}, 10000);    
// CREATE PROPOSAL LISTENER
document.querySelector('#create-btn')?.addEventListener('click', async () => {
    const titleInput = document.querySelector('#title-input') as HTMLInputElement;
    const amountInput = document.querySelector('#amount-input') as HTMLInputElement;
    
    const description = titleInput.value.trim();
    const amount = parseFloat(amountInput.value);

    // --- GATEKEEPER ---
    if (!description) {
        titleInput.focus();
        return alert("Proposal description cannot be empty.");
    }
    if (!amountInput.value || isNaN(amount) || amount <= 0) {
        amountInput.focus();
        return alert("Please specify a valid SOL amount for the payout.");
    }        
	try {
            const program = getProgram();
            const user = (window as any).solana.publicKey;
            const description = (document.querySelector('#title-input') as HTMLInputElement).value;
            const amount = parseFloat((document.querySelector('#amount-input') as HTMLInputElement).value);
            
            const [dao] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
            const proposalKeypair = anchor.web3.Keypair.generate();

            await program.methods.createProposal(
                description, 
                new anchor.BN(3600), // 1 hour duration for testing
                new anchor.BN(amount * 1e9)
            ).accounts({
                dao,
                proposal: proposalKeypair.publicKey,
                creator: user,
                systemProgram: SystemProgram.programId,
            })
            .signers([proposalKeypair])
            .rpc();

            alert("Proposal Created!");
            renderProposals();
        } catch (err) {
            console.error("Proposal creation failed:", err);
        }
    });

    // Find the Admin Init listener inside your init() function and change it to this:
document.getElementById("admin-init-btn")?.addEventListener("click", async () => {
    console.log("--- DEBUG: Admin Init Button Clicked ---");
    // Directly call the logic here to ensure it works
    try {
        const program = getProgram();
        const [dao] = PublicKey.findProgramAddressSync([Buffer.from("dao")], programId);
        const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);

        console.log("Initializing DAO at:", dao.toBase58());

        await program.methods
            .initDao()
            .accounts({
                dao,
                stakeMint: OLV_MINT,
                authority: (window as any).solana.publicKey,
                vault,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        alert("SUCCESS! DAO is now live on-chain.");
        updateDAOMetrics(); // This should now work without the 'Account not found' error
    } catch (err) {
        console.error("Initialization failed:", err);
        alert("Init failed. Check console for details.");
    }
});
};

if (document.readyState === 'complete' || document.readyState === 'interactive') { init(); } 
else { window.addEventListener('load', init); }