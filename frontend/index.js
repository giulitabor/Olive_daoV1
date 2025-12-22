// --- CONSTANTS (Must match lib.rs) ---
const STATE_SEED = "state";
const VAULT_SEED = "vault";
const programId = new solanaWeb3.PublicKey("6BU1fyoGLqvRUyeWGJhYcLB9hp5rAEYkVivA6Ppvwc72");

// --- HELPER TO FIX PDA ERRORS ---
async function getPDAs() {
    // This fixes: "ReferenceError: anchor is not defined" 
    // and "ReferenceError: buffer is not defined"
    const [statePDA] = await solanaWeb3.PublicKey.findProgramAddress(
        [window.Buffer.from(STATE_SEED)],
        programId
    );
    const [vaultPDA] = await solanaWeb3.PublicKey.findProgramAddress(
        [window.Buffer.from(VAULT_SEED)],
        programId
    );
    return { statePDA, vaultPDA };
}

// --- INITIALIZE FUNCTION ---
async function initialize() {
    try {
        const { statePDA, vaultPDA } = await getPDAs();
        console.log("State PDA:", statePDA.toBase58());
        
        // Your Anchor code here...
        // const tx = await program.methods.initialize(...).accounts({...}).rpc();
    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

// --- FIX: buyWithSol ---
async function buyWithSol() {
    const { statePDA, vaultPDA } = await getPDAs();
    // Your transaction logic...
}

// --- FIX: buyWithUsdc (This was missing from your error log) ---
async function buyWithUsdc() {
    const { statePDA, vaultPDA } = await getPDAs();
    console.log("Buying with USDC...");
    // Your transaction logic...
}

// --- CRITICAL: Make functions available to HTML buttons ---
window.initialize = initialize;
window.buyWithSol = buyWithSol;
window.buyWithUsdc = buyWithUsdc;
