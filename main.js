import { Buffer } from 'buffer';
window.Buffer = Buffer; // Define it on window
globalThis.Buffer = Buffer; // Define it on globalThis
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import idl from "./idl.json"; // Drop your idl.json in the src folder

const programId = new PublicKey("6BU1fyoGLqvRUyeWGJhYcLB9hp5rAEYkVivA6Ppvwc72");

export async function connectAndInit() {
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    
    // Setup Anchor Provider using Phantom
    const provider = new anchor.AnchorProvider(
        connection, 
        window.solana, 
        { preflightCommitment: "confirmed" }
    );
    
    const program = new anchor.Program(idl, programId, provider);
    
    // Derive your PDA
    const [statePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")], 
        programId
    );
    
    console.log("State PDA:", statePda.toBase58());
    return { program, statePda };
}
