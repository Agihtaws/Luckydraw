import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain }       from "viem";

export const somniaTestnet = defineChain({
  id:   50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_RPC_URL || "https://dream-rpc.somnia.network"] },
    public:  { http: [import.meta.env.VITE_RPC_URL || "https://dream-rpc.somnia.network"] },
  },
  blockExplorers: {
    default: { name: "Shannon", url: "https://shannon-explorer.somnia.network" },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName:     "ReactRaffle",
  projectId:   import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "placeholder",
  chains:      [somniaTestnet],
  ssr:         false,
});

export const CONTRACT_ADDRESS  = import.meta.env.VITE_CONTRACT_ADDRESS;
export const DEPLOYER_ADDRESS  = import.meta.env.VITE_DEPLOYER_ADDRESS;
export const EXPLORER          = "https://shannon-explorer.somnia.network";