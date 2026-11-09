import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { TOKEN } from "@syb/shared";
import { env, chainEnabled } from "../env.js";

export const connection = new Connection(env.solanaRpc, "confirmed");

function loadKeypair(secret: string) {
  const s = secret.trim();
  return Keypair.fromSecretKey(s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s));
}

let cached: { treasury: Keypair; mint: PublicKey; treasuryAta: PublicKey } | null = null;
export function chain() {
  if (!chainEnabled()) throw new Error("Solana not configured (SOLANA_TREASURY_SECRET, SHOUT_MINT)");
  if (!cached) {
    const treasury = loadKeypair(env.treasurySecret);
    const mint = new PublicKey(env.shoutMint);
    cached = { treasury, mint, treasuryAta: ata(mint, treasury.publicKey) };
  }
  return cached;
}

export const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

const clusterQs = () =>
  env.solanaCluster === "devnet" ? "?cluster=devnet" : env.solanaCluster === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(env.solanaRpc)}` : "";
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${clusterQs()}`;
export const explorerAccount = (a: string) => `https://explorer.solana.com/address/${a}${clusterQs()}`;

export function tokenInfo() {
  if (!chainEnabled()) return null;
  const { mint, treasury, treasuryAta } = chain();
  return {
    mint: mint.toBase58(),
    treasury: treasury.publicKey.toBase58(),
    treasuryAta: treasuryAta.toBase58(),
    decimals: TOKEN.decimals,
    symbol: TOKEN.symbol,
    cluster: env.solanaCluster,
    rpc: env.solanaRpc,
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    explorer: explorerAccount(mint.toBase58()),
  };
}

/** Treasury -> user transfer (creates the user's token account if needed; treasury pays fees). */
export async function sendFromTreasury(to: string, amountBase: bigint) {
  const { treasury, mint, treasuryAta } = chain();
  const owner = new PublicKey(to);
  const dest = ata(mint, owner);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, dest, owner, mint, TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(treasuryAta, mint, dest, treasury.publicKey, amountBase, TOKEN.decimals, [], TOKEN_2022_PROGRAM_ID),
  );
  return sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
}

/**
 * Verify that `sig` is a confirmed, successful transaction in which `wallet`
 * transferred exactly `amountBase` $SHOUT to the treasury token account.
 */
export async function verifyPaymentToTreasury(sig: string, wallet: string, amountBase: bigint) {
  const { mint, treasuryAta } = chain();
  let txn = null;
  for (let i = 0; i < 6 && !txn; i++) {
    txn = await connection.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!txn) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!txn) throw new Error("işlem bulunamadı (henüz onaylanmamış olabilir)");
  if (txn.meta?.err) throw new Error("işlem zincirde başarısız olmuş");
  const all: (ParsedInstruction | PartiallyDecodedInstruction)[] = [
    ...txn.transaction.message.instructions,
    ...(txn.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  const ok = all.some((ix) => {
    if (!("parsed" in ix) || ix.programId.toBase58() !== TOKEN_2022_PROGRAM_ID.toBase58()) return false;
    const { type, info } = ix.parsed as { type: string; info: any };
    if (type !== "transferChecked") return false;
    return (
      info.mint === mint.toBase58() &&
      info.destination === treasuryAta.toBase58() &&
      info.authority === wallet &&
      BigInt(info.tokenAmount?.amount ?? -1) === amountBase
    );
  });
  if (!ok) throw new Error("işlemde beklenen $SHOUT ödemesi yok");
}

export async function onchainBalance(wallet: string) {
  const { mint } = chain();
  try {
    const b = await connection.getTokenAccountBalance(ata(mint, new PublicKey(wallet)));
    return b.value.amount;
  } catch {
    return "0";
  }
}
