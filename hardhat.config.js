require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
 
// ─────────────────────────────────────────────────────────────
// Validate env before anything runs
// ─────────────────────────────────────────────────────────────
 
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error(
    "[hardhat.config] PRIVATE_KEY is not set in .env\n" +
    "Create a .env file in the project root with:\n" +
    "  PRIVATE_KEY=0x<your_private_key>"
  );
}
 
// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
 
/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
  compilers: [
    {
      version: "0.8.20",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
    {
      version: "0.8.30",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        viaIR: true
      },
    },
  ],
},

  networks: {
    // ── Somnia Testnet (Shannon) ─────────────────────────────
    somnia_testnet: {
      url:      "https://dream-rpc.somnia.network",
      chainId:  50312,
      accounts: [PRIVATE_KEY],
      // Somnia has sub-second blocks — generous timeout
      timeout:  120_000,
      gasPrice: "auto",
    },
 
    // ── Local for unit tests ─────────────────────────────────
    hardhat: {
      chainId: 31337,
    },
  },
 
  // ── Source verification ────────────────────────────────────
  // Shannon explorer is Blockscout — no real API key required.
  // The string "empty" satisfies hardhat-verify's key requirement.
  etherscan: {
    apiKey: {
      somnia_testnet: "empty",
    },
    customChains: [
      {
        network:  "somnia_testnet",
        chainId:  50312,
        urls: {
          // Blockscout REST API — confirmed from Somnia docs
          apiURL:     "https://shannon-explorer.somnia.network/api",
          browserURL: "https://shannon-explorer.somnia.network",
        },
      },
    ],
  },
 
  // ── Gas reporter (optional, remove if not needed) ──────────
  gasReporter: {
    enabled:  process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
 
  // ── Paths ──────────────────────────────────────────────────
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};