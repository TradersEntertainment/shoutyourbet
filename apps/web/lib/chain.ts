"use client";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { TOKEN, toBase } from "@syb/shared";

/**
 * Send $SHOUT from the connected wallet to `toOwner` (a wallet address).
 * Creates the recipient's token account if missing (sender pays the small rent).
 */
export async function sendShout(
  connection: Connection,
  wallet: WalletContextState,
  mintAddr: string,
  toOwner: string,
  amount: number,
) {
  if (!wallet.publicKey || !wallet.sendTransaction) throw new Error("Cüzdan bağlı değil");
  const mint = new PublicKey(mintAddr);
  const owner = new PublicKey(toOwner);
  const from = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const to = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, to, owner, mint, TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(from, mint, to, wallet.publicKey, toBase(amount), TOKEN.decimals, [], TOKEN_2022_PROGRAM_ID),
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const sig = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

export const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");

export function explorer(kind: "tx" | "address", id: string, cluster?: string, rpc?: string) {
  const qs = cluster === "devnet" ? "?cluster=devnet" : cluster === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(rpc ?? "")}` : "";
  return `https://explorer.solana.com/${kind}/${id}${qs}`;
}

export const walletErr = (e: unknown) => {
  const m = (e as Error)?.message ?? String(e);
  if (/reject|denied|cancel/i.test(m)) return "İşlem cüzdanda iptal edildi";
  if (/insufficient|0x1\b/i.test(m)) return "Cüzdanda yeterli $SHOUT veya SOL yok";
  return m.slice(0, 160);
};
