/** Mic NFTs: Metaplex Core assets in the ShoutYourBet Mics collection. */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, generateSigner, keypairIdentity, publicKey, type Umi } from "@metaplex-foundation/umi";
import { create, fetchAsset, fetchAssetsByOwner, fetchCollection, mplCore, type CollectionV1 } from "@metaplex-foundation/mpl-core";
import { MIC_TYPES, QUALITIES, type MicType, type Quality } from "@syb/shared";
import { env } from "../env.js";
import { loadTreasury } from "./solana.js";

let umi: Umi | null = null;
let collection: CollectionV1 | null = null;
function core() {
  if (!umi) {
    umi = createUmi(env.solanaRpc, "confirmed").use(mplCore());
    const kp = umi.eddsa.createKeypairFromSecretKey(loadTreasury().secretKey);
    umi.use(keypairIdentity(createSignerFromKeypair(umi, kp)));
  }
  return umi;
}
async function micCollection() {
  collection ??= await fetchCollection(core(), publicKey(env.micCollection));
  return collection;
}

/** Fresh address for a new mic (so the DB row can be written before minting). */
export const newMicSigner = () => generateSigner(core());

export const micName = (serial: number, type: MicType) => `Mic #${serial} · ${MIC_TYPES[type].label}`;
export const micUri = (serial: number) => `${env.publicApiUrl}/nft/mic/${serial}.json`;
export const micImage = (type: MicType, quality: Quality) => `${env.publicWebUrl}/mics/${type}-${quality}.png`;

/** Mint a mic NFT straight into the owner's wallet (treasury pays). */
export async function mintMicNft(signer: ReturnType<typeof newMicSigner>, owner: string, serial: number, type: MicType, quality: Quality) {
  const u = core();
  const res = await create(u, {
    asset: signer,
    collection: await micCollection(),
    name: micName(serial, type),
    uri: micUri(serial),
    owner: publicKey(owner),
    plugins: [
      {
        type: "Attributes",
        attributeList: [
          { key: "type", value: MIC_TYPES[type].label },
          { key: "quality", value: QUALITIES[quality].label },
        ],
      },
    ],
  }).sendAndConfirm(u, { confirm: { commitment: "confirmed" } });
  return Buffer.from(res.signature).toString("base64");
}

/** Current on-chain owner of a mic, or null if it doesn't exist / isn't ours. */
export async function micOwner(asset: string): Promise<string | null> {
  try {
    const a = await fetchAsset(core(), publicKey(asset));
    const inCollection = a.updateAuthority.type === "Collection" && a.updateAuthority.address?.toString() === env.micCollection;
    return inCollection ? a.owner.toString() : null;
  } catch {
    return null;
  }
}

/** All mic assets (in our collection) a wallet owns on-chain. */
export async function micsOwnedBy(wallet: string): Promise<string[]> {
  const assets = await fetchAssetsByOwner(core(), publicKey(wallet), { skipDerivePlugins: true });
  return assets
    .filter((a) => a.updateAuthority.type === "Collection" && a.updateAuthority.address?.toString() === env.micCollection)
    .map((a) => a.publicKey.toString());
}
