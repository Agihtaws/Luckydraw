const { ethers, network, run } = require("hardhat");
const fs   = require("fs");
const path = require("path");
const BUFFER_STT      = "32";          
const DEPLOYED_JSON   = path.join(__dirname, "..", "deployed.json");
const VERIFY_DELAY_MS = 30_000;        
const CONFIRM_BLOCKS  = 2;            

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

async function main() {

  log("Starting preflight checks…");

  const [deployer] = await ethers.getSigners();
  const netInfo    = await ethers.provider.getNetwork();
  const chainId = netInfo.chainId;

  console.log(`    Network   : ${network.name}  (chainId ${chainId})`);
  console.log(`    Deployer  : ${deployer.address}`);

  const balanceBefore = await ethers.provider.getBalance(deployer.address);

  console.log(`    Balance   : ${ethers.formatEther(balanceBefore)} STT`);

  const bufferWei = ethers.parseEther(BUFFER_STT);

  if (balanceBefore < bufferWei) {
    fail(
      `Deployer balance (${ethers.formatEther(balanceBefore)} STT) ` +
      `is less than the required buffer (${BUFFER_STT} STT). ` +
      `Top up at https://testnet.somnia.network/ and retry.`
    );
    process.exit(1);
  }

  ok("Preflight passed.");

  log("Deploying RaffleEngine…");

  const Factory  = await ethers.getContractFactory("RaffleEngine");
  const contract = await Factory.deploy();

  log(`Waiting for ${CONFIRM_BLOCKS} confirmation(s)…`);
  await contract.deploymentTransaction().wait(CONFIRM_BLOCKS);

  const address = contract.target;
  const txHash  = contract.deploymentTransaction().hash;

  ok(`RaffleEngine deployed`);
  console.log(`    Address   : ${address}`);
  console.log(`    Tx hash   : ${txHash}`);
  console.log(`    Explorer  : https://shannon-explorer.somnia.network/address/${address}`);


  log(`Funding subscription buffer with ${BUFFER_STT} STT…`);

  const fundTx = await contract.fundBuffer({ value: bufferWei });

  log(`Waiting for ${CONFIRM_BLOCKS} confirmation(s)…`);
  await fundTx.wait(CONFIRM_BLOCKS);

  ok(`Buffer funded with ${BUFFER_STT} STT`);
  console.log(`    Fund tx   : ${fundTx.hash}`);

  const bufferOnChain = await contract.getSubscriptionBuffer();

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
    chainId:      chainId.toString(),   
    contract:     "RaffleEngine",
    address,
    deployTxHash: txHash,
    fundTxHash:   fundTx.hash,
    bufferFunded: BUFFER_STT + " STT",
    deployer:     deployer.address,
    explorerUrl:  `https://shannon-explorer.somnia.network/address/${address}`,
  });

  // ── Verify ─────────────────────────────────────────────────

  log(`Waiting ${VERIFY_DELAY_MS / 1000}s for explorer to index the contract…`);
  await sleep(VERIFY_DELAY_MS);

  log("Verifying contract source on Shannon explorer (Blockscout)…");

  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],   
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

main().catch((err) => {
  fail(`Deploy script crashed: ${err.message}`);
  console.error(err);
  process.exit(1);
});