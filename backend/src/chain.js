// src/chain.js
// Viem clients for Somnia testnet — HTTP for reads/writes, WS for reactivity

import { createPublicClient, createWalletClient, http, webSocket, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

// ─────────────────────────────────────────────────────────────
// Somnia Testnet chain definition
// ─────────────────────────────────────────────────────────────

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  network: "somnia-testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http:      [process.env.RPC_URL],
      webSocket: [process.env.WS_URL],
    },
    public: {
      http:      [process.env.RPC_URL],
      webSocket: [process.env.WS_URL],
    },
  },
});

// ─────────────────────────────────────────────────────────────
// HTTP client — reads, Data Streams writes
// ─────────────────────────────────────────────────────────────

export const publicHttpClient = createPublicClient({
  chain:     somniaTestnet,
  transport: http(process.env.RPC_URL),
});

// ─────────────────────────────────────────────────────────────
// WebSocket client — reactivity subscriptions only
// ─────────────────────────────────────────────────────────────

// Primary WS — falls back to WS_URL_2 if set
const wsUrl = process.env.WS_URL || "ws://api.infra.testnet.somnia.network/ws";

export const publicWsClient = createPublicClient({
  chain:     somniaTestnet,
  transport: webSocket(wsUrl, {
    reconnect: {
      delay:    1_000,
      attempts: 10,
    },
    timeout: 20_000,
  }),
});

// ─────────────────────────────────────────────────────────────
// Wallet client — Data Streams publishing
// ─────────────────────────────────────────────────────────────

export function getWalletClient() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY not set in .env");
  return createWalletClient({
    account:   privateKeyToAccount(pk),
    chain:     somniaTestnet,
    transport: http(process.env.RPC_URL),
  });
}