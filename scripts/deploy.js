// scripts/deploy.js
// Production deploy script for RaffleEngine — Somnia Testnet
// Usage: npx hardhat run scripts/deploy.js --network somnia_testnet
//
// Requires ethers v6 (default in Hardhat 3+).
// If you see ".utils is not a function" errors you are on ethers v5 —
// run: npm install --save-dev ethers@6

const { ethers, network, run } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

const BUFFER_STT      = "32";          // exact minimum required by Somnia Reactivity
const DEPLOYED_JSON   = path.join(__dirname, "..", "deployed.json");
const VERIFY_DELAY_MS = 30_000;        // wait 30s for explorer to index before verify
const CONFIRM_BLOCKS  = 2;             // block confirmations to wait after each tx

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function log(msg)  { console.log(`\n[deploy] ${msg}`); }
function ok(msg)   { console.log(`    ✅  ${msg}`); }
function warn(msg) { console.log(`    ⚠️   ${msg}`); }
function fail(msg) { console.error(`\n    ❌  ${msg}`); }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveDeployed(record) {
  let existing = {};

  if (fs.existsSync(DEPLOYED_JSON)) {
    try {
      existing = JSON.parse(fs.readFileSync(DEPLOYED_JSON, "utf8"));
    } catch {
      warn("deployed.json exists but could not be parsed — overwriting.");
    }
  }

  existing[record.network] = {
    ...record,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(DEPLOYED_JSON, JSON.stringify(existing, null, 2));
  ok(`deployed.json saved  →  ${DEPLOYED_JSON}`);
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {

  // ── Preflight ──────────────────────────────────────────────

  log("Starting preflight checks…");

  const [deployer] = await ethers.getSigners();
  const netInfo    = await ethers.provider.getNetwork();

  // FIX: ethers v6 — chainId is a BigInt, not a number
  const chainId = netInfo.chainId;

  console.log(`    Network   : ${network.name}  (chainId ${chainId})`);
  console.log(`    Deployer  : ${deployer.address}`);

  const balanceBefore = await ethers.provider.getBalance(deployer.address);
  // FIX: ethers v6 — ethers.formatEther(), not ethers.utils.formatEther()
  console.log(`    Balance   : ${ethers.formatEther(balanceBefore)} STT`);

  // FIX: ethers v6 — ethers.parseEther(), not ethers.utils.parseEther()
  const bufferWei = ethers.parseEther(BUFFER_STT);

  // FIX: ethers v6 — chainId is BigInt, native comparison works
  if (balanceBefore < bufferWei) {
    fail(
      `Deployer balance (${ethers.formatEther(balanceBefore)} STT) ` +
      `is less than the required buffer (${BUFFER_STT} STT). ` +
      `Top up at https://testnet.somnia.network/ and retry.`
    );
    process.exit(1);
  }

  ok("Preflight passed.");

  // ── Deploy ─────────────────────────────────────────────────

  log("Deploying RaffleEngine…");

  const Factory  = await ethers.getContractFactory("RaffleEngine");
  const contract = await Factory.deploy();

  log(`Waiting for ${CONFIRM_BLOCKS} confirmation(s)…`);
  // FIX: ethers v6 — deploymentTransaction() is a method, not a property
  await contract.deploymentTransaction().wait(CONFIRM_BLOCKS);

  // FIX: ethers v6 — contract address is contract.target, not contract.address
  const address = contract.target;
  const txHash  = contract.deploymentTransaction().hash;

  ok(`RaffleEngine deployed`);
  console.log(`    Address   : ${address}`);
  console.log(`    Tx hash   : ${txHash}`);
  console.log(`    Explorer  : https://shannon-explorer.somnia.network/address/${address}`);

  // ── Fund Buffer ────────────────────────────────────────────

  log(`Funding subscription buffer with ${BUFFER_STT} STT…`);

  const fundTx = await contract.fundBuffer({ value: bufferWei });

  log(`Waiting for ${CONFIRM_BLOCKS} confirmation(s)…`);
  await fundTx.wait(CONFIRM_BLOCKS);

  ok(`Buffer funded with ${BUFFER_STT} STT`);
  console.log(`    Fund tx   : ${fundTx.hash}`);

  // Sanity-check: read buffer back from contract
  const bufferOnChain = await contract.getSubscriptionBuffer();
  // FIX: ethers v6 — native BigInt comparison
  if (bufferOnChain < bufferWei) {
    warn(
      `On-chain buffer (${ethers.formatEther(bufferOnChain)} STT) ` +
      `is less than expected (${BUFFER_STT} STT). ` +
      `Check the fundBuffer transaction and top up if needed.`
    );
  } else {
    ok(`On-chain buffer confirmed: ${ethers.formatEther(bufferOnChain)} STT`);
  }

  // ── Save deployed.json ─────────────────────────────────────

  log("Saving deployment record…");

  saveDeployed({
    network:      network.name,
    chainId:      chainId.toString(),   // BigInt → string for JSON serialisation
    contract:     "RaffleEngine",
    address,
    deployTxHash: txHash,
    fundTxHash:   fundTx.hash,
    bufferFunded: BUFFER_STT + " STT",
    deployer:     deployer.address,
    explorerUrl:  `https://shannon-explorer.somnia.network/address/${address}`,
  });

  // ── Verify ─────────────────────────────────────────────────
  //
  // Shannon explorer is Blockscout — verification uses its REST API.
  // The customChains config in hardhat.config.js points to:
  //   https://shannon-explorer.somnia.network/api
  //
  // No real API key is required for Blockscout.

  log(`Waiting ${VERIFY_DELAY_MS / 1000}s for explorer to index the contract…`);
  await sleep(VERIFY_DELAY_MS);

  log("Verifying contract source on Shannon explorer (Blockscout)…");

  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],   // RaffleEngine has no constructor args
    });
    ok("Contract verified on Shannon explorer.");
    console.log(
      `    Verified  : https://shannon-explorer.somnia.network/address/${address}?tab=contract`
    );

    saveDeployed({
      network:      network.name,
      chainId:      chainId.toString(),
      contract:     "RaffleEngine",
      address,
      deployTxHash: txHash,
      fundTxHash:   fundTx.hash,
      bufferFunded: BUFFER_STT + " STT",
      deployer:     deployer.address,
      explorerUrl:  `https://shannon-explorer.somnia.network/address/${address}`,
      verified:     true,
    });

  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("already verified")) {
      ok("Contract already verified.");
    } else {
      warn(`Verification failed (contract is still live): ${err.message}`);
      warn(
        "Retry manually:\n" +
        `    npx hardhat verify --network somnia_testnet ${address}`
      );
    }
  }

  // ── Final summary ──────────────────────────────────────────

  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  // FIX: ethers v6 — native BigInt subtraction
  const gasCost = ethers.formatEther(balanceBefore - balanceAfter);

  console.log("\n────────────────────────────────────────────────────────");
  console.log("  DEPLOY COMPLETE");
  console.log("────────────────────────────────────────────────────────");
  console.log(`  Contract  : ${address}`);
  console.log(`  Network   : ${network.name}  (chainId ${chainId})`);
  console.log(`  Buffer    : ${BUFFER_STT} STT funded`);
  console.log(`  Gas used  : ~${gasCost} STT`);
  console.log(`  Saved to  : deployed.json`);
  console.log("────────────────────────────────────────────────────────\n");

  log("Next step: call createCampaign() to start your first raffle.");
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

main().catch((err) => {
  fail(`Deploy script crashed: ${err.message}`);
  console.error(err);
  process.exit(1);
});