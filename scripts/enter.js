// scripts/enter.js
const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const CAMPAIGN_ID   = 4n;       // ← update to your campaign ID
const POLL_INTERVAL = 3_000;
const POLL_TIMEOUT  = 600_000;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const DEPLOYED_JSON  = path.join(__dirname, "..", "deployed.json");
const CONFIRM_BLOCKS = 1;
const STATUS_LABELS  = ["UPCOMING","OPEN","DRAWING","COMPLETE","ROLLEDOVER","CANCELLED"];

function log(msg)  { console.log(`\n[enter] ${msg}`); }
function ok(msg)   { console.log(`    ✅  ${msg}`); }
function warn(msg) { console.log(`    ⚠️   ${msg}`); }
function fail(msg) { console.error(`\n    ❌  ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadDeployed() {
  if (!fs.existsSync(DEPLOYED_JSON)) { fail("deployed.json not found."); process.exit(1); }
  const data  = JSON.parse(fs.readFileSync(DEPLOYED_JSON, "utf8"));
  const entry = data[network.name];
  if (!entry?.address) { fail(`No deployment for "${network.name}".`); process.exit(1); }
  return entry;
}

function loadWallets() {
  // Supports up to 6 wallets — add PRIVATE_KEY_4/5/6 to .env for more entries
  const keys = [
    process.env.PRIVATE_KEY,    // wallet 1 — deployer (will be blocked if admin)
    process.env.PRIVATE_KEY_2,
    process.env.PRIVATE_KEY_3,
    process.env.PRIVATE_KEY_4,
    process.env.PRIVATE_KEY_5,
    process.env.PRIVATE_KEY_6,
  ].filter(Boolean);

  if (keys.length === 0) { fail("No private keys found in .env."); process.exit(1); }
  return keys.map(pk => new ethers.Wallet(pk, ethers.provider));
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  log("Loading deployment…");
  const deployed = loadDeployed();
  ok(`Contract: ${deployed.address}`);

  const RaffleEngine = await ethers.getContractFactory("RaffleEngine");
  const contract     = RaffleEngine.attach(deployed.address);

  // Validate campaign
  const campaign = await contract.getCampaign(CAMPAIGN_ID);
  if (campaign.id === 0n)  { fail(`Campaign ${CAMPAIGN_ID} does not exist.`); process.exit(1); }
  if (campaign.cancelled)  { fail(`Campaign ${CAMPAIGN_ID} is cancelled.`);   process.exit(1); }

  const prizeMode = Number(campaign.prizeMode);
  const numWinners = Number(campaign.numWinners);
  console.log(`\n    Prize mode : ${prizeMode === 0 ? "Equal" : "Tiered"}`);
  console.log(`    Winners    : ${numWinners}`);
  console.log(`    Prize/win  : ${ethers.formatEther(campaign.prizePerWinner)} STT`);

  // Wait for OPEN
  log(`Waiting for round to open…`);
  const pollStart = Date.now();
  let round;

  while (true) {
    round = await contract.getCurrentRound(CAMPAIGN_ID);
    const now        = Math.floor(Date.now() / 1000);
    const statusName = STATUS_LABELS[Number(round.status)] ?? "UNKNOWN";
    const waited     = Math.floor((Date.now() - pollStart) / 1000);

    process.stdout.write(
      `\r    ${statusName.padEnd(10)}  Round #${round.id}  ` +
      `Opens: ${new Date(Number(round.openTime) * 1000).toLocaleTimeString()}  ` +
      `Draw: ${new Date(Number(round.drawTime) * 1000).toLocaleTimeString()}  ` +
      `Waited: ${waited}s   `
    );

    if (round.status === 1n && now < Number(round.drawTime)) {
      process.stdout.write("\n");
      ok(`Round is OPEN! ${Number(round.drawTime) - now}s left to enter`);
      break;
    }

    if (Date.now() - pollStart > POLL_TIMEOUT) {
      process.stdout.write("\n");
      fail("Timed out waiting for round to open.");
      process.exit(1);
    }

    await sleep(POLL_INTERVAL);
  }

  // Load wallets
  log("Loading wallets…");
  const wallets = loadWallets();
  const balancesBefore = {};

  for (let i = 0; i < wallets.length; i++) {
    const w   = wallets[i];
    const bal = await ethers.provider.getBalance(w.address);
    balancesBefore[w.address] = bal;
    console.log(`    Wallet ${i + 1}: ${w.address}  →  ${ethers.formatEther(bal)} STT`);
  }

  // Enter each wallet
  log(`Entering ${wallets.length} wallet(s) into round ${round.id}…`);

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const label  = `Wallet ${i + 1} (${wallet.address})`;

    const already = await contract.hasEntered(round.id, wallet.address);
    if (already) { warn(`${label} already entered — skipping.`); continue; }

    const nowCheck = Math.floor(Date.now() / 1000);
    if (nowCheck >= Number(round.drawTime)) { warn("Entry window closed."); break; }

    try {
      console.log(`\n    Entering ${label}…`);
      const tx = await contract.connect(wallet).enter(CAMPAIGN_ID, { value: campaign.entryFee });
      console.log(`    Tx: ${tx.hash}`);
      const receipt = await tx.wait(CONFIRM_BLOCKS);

      let entryNumber = null;
      for (const l of receipt.logs) {
        try {
          const p = RaffleEngine.interface.parseLog(l);
          if (p?.name === "EntrySubmitted") entryNumber = p.args.entryNumber.toString();
        } catch { /* skip */ }
      }
      ok(`${label} entered! Entry #${entryNumber ?? "?"}`);
    } catch (err) {
      warn(`${label} failed: ${err.message.slice(0, 120)}`);
    }
  }

  // Confirm entries
  const confirmedRound = await contract.getCurrentRound(CAMPAIGN_ID);
  const entrants       = await contract.getEntrants(confirmedRound.id);
  console.log(`\n    Total entries : ${confirmedRound.entryCount}`);
  for (let i = 0; i < entrants.length; i++) {
    console.log(`      [${i + 1}] ${entrants[i]}`);
  }

  // Wait for draw
  log("Waiting for Somnia Reactivity to fire the draw…");
  console.log(`    Draw at : ${new Date(Number(confirmedRound.drawTime) * 1000).toLocaleString()}\n`);

  const drawPollStart = Date.now();
  while (true) {
    const r        = await contract.getCurrentRound(CAMPAIGN_ID);
    const status   = STATUS_LABELS[Number(r.status)] ?? "UNKNOWN";
    const waited   = Math.floor((Date.now() - drawPollStart) / 1000);
    const secsLeft = Math.max(0, Number(r.drawTime) - Math.floor(Date.now() / 1000));

    process.stdout.write(
      `\r    ${status.padEnd(10)}  Draw in: ${secsLeft > 0 ? secsLeft + "s" : "any moment..."}  Waited: ${waited}s   `
    );

    if (r.status === 3n) { process.stdout.write("\n"); ok("Draw fired! Round is COMPLETE."); break; }
    if (r.status === 4n) { process.stdout.write("\n"); warn("Round rolled over."); break; }
    if (Date.now() - drawPollStart > POLL_TIMEOUT) {
      process.stdout.write("\n");
      warn(`Timed out. Check: https://shannon-explorer.somnia.network/address/${deployed.address}`);
      break;
    }
    await sleep(POLL_INTERVAL);
  }

  // Show winners
  log("Fetching winners from contract…");
  const winners = await contract.getWinners(confirmedRound.id);

  if (!winners || winners.length === 0) {
    warn("No winners found yet — check explorer.");
    return;
  }

  // Calculate tiered prizes for display
  const pool = confirmedRound.pool;
  let prizes = [];
  if (prizeMode === 1 && winners.length === 2) {
    prizes[0] = (pool * 60n) / 100n;
    prizes[1] = pool - prizes[0];
  } else if (prizeMode === 1 && winners.length === 3) {
    prizes[0] = (pool * 50n) / 100n;
    prizes[1] = (pool * 30n) / 100n;
    prizes[2] = pool - prizes[0] - prizes[1];
  } else {
    const each = pool / BigInt(winners.length);
    prizes = winners.map(() => each);
  }

  const medals = ["🥇", "🥈", "🥉", "🏅"];

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  WINNERS");
  console.log("════════════════════════════════════════════════════════");

  for (let i = 0; i < winners.length; i++) {
    const w         = winners[i];
    const prize     = prizes[i] || 0n;
    const balAfter  = await ethers.provider.getBalance(w);
    const balBefore = balancesBefore[w];
    const gained    = balBefore !== undefined
      ? `~${ethers.formatEther(balAfter - balBefore)} STT gained`
      : `${ethers.formatEther(prize)} STT sent`;
    const walletIdx = wallets.findIndex(wl => wl.address.toLowerCase() === w.toLowerCase());
    const label     = walletIdx >= 0 ? `Wallet ${walletIdx + 1}` : "External";

    console.log(`  ${medals[i] || "🏅"}  ${label} : ${w}`);
    console.log(`      Prize   : ${ethers.formatEther(prize)} STT  (${gained})`);
  }

  console.log(`\n  Round   : ${confirmedRound.id}`);
  console.log(`  Verify  : https://shannon-explorer.somnia.network/address/${deployed.address}`);
  console.log("════════════════════════════════════════════════════════\n");
}

main().catch(err => {
  fail(`Script crashed: ${err.message}`);
  process.exit(1);
});