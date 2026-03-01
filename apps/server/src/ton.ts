import { TonClient, WalletContractV4, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "ton-crypto";
import { toNano } from "ton-core";
import { env } from "./env.js";

let client: TonClient | null = null;
let wallet: WalletContractV4 | null = null;
let keyPair: { publicKey: Buffer; secretKey: Buffer } | null = null;

function resolveRpcEndpoint(): string {
  if (env.TON_RPC_ENDPOINT && env.TON_RPC_ENDPOINT.trim().length > 0) return env.TON_RPC_ENDPOINT;
  const base = env.TON_ENDPOINT.replace(/\/$/, "");
  return `${base}/v2/jsonRPC`;
}

async function getClient(): Promise<TonClient> {
  if (!client) {
    client = new TonClient({ endpoint: resolveRpcEndpoint(), apiKey: env.TON_API_KEY || undefined });
  }
  return client;
}

async function getWallet(): Promise<WalletContractV4> {
  if (!wallet || !keyPair) {
    const words = env.WITHDRAWAL_MNEMONIC.trim().split(/\s+/g);
    const keys = await mnemonicToPrivateKey(words);
    keyPair = { publicKey: Buffer.from(keys.publicKey), secretKey: Buffer.from(keys.secretKey) };
    wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  }
  return wallet;
}

async function getKeyPair(): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
  if (!keyPair) {
    const words = env.WITHDRAWAL_MNEMONIC.trim().split(/\s+/g);
    const keys = await mnemonicToPrivateKey(words);
    keyPair = { publicKey: Buffer.from(keys.publicKey), secretKey: Buffer.from(keys.secretKey) };
  }
  return keyPair;
}

export async function sendTonWithdrawal(params: {
  toAddress: string;
  amountTon: string;
  memo: string;
}): Promise<string> {
  const client = await getClient();
  const wallet = await getWallet();
  const keyPair = await getKeyPair();
  const sender = client.open(wallet);
  const seqno = await sender.getSeqno();
  await sender.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: params.toAddress,
        value: toNano(params.amountTon),
        bounce: false,
        body: params.memo,
      }),
    ],
  });
  return `${wallet.address.toString()}#${seqno}`;
}
