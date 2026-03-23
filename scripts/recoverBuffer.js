// scripts/drainContracts.js
// Withdraws actual ETH balance from old contracts using low-level call.
// For contracts where subscriptionBuffer > actual balance causing withdrawBuffer to fail.
// Usage: npx hardhat run scripts/drainContracts.js --network somnia_testnet

const { ethers } = require("hardhat");

// Only targeting the two contracts where we're the owner and active=0
const TARGETS = [
  "0x77016349a27A8f862740E1559BEd66e407AeC5D7",
  "0x357BD1d5001FBF816735E401c3D7e229ef1cccEf",
];

const ABI = [
  "function getActiveCampaignCount() view returns (uint64)",
  "function withdrawBuffer() external",
  "function owner() view returns (address)",
  // Ownable has a way to call arbitrary functions if we're owner
  // but actually we just need to use the receive() fallback — contracts have receive()
];

async function main() {
  const [signer]  = await ethers.getSigners();
  const balBefore = await ethers.provider.getBalance(signer.address);

  console.log(`\nSigner: ${signer.address}`);
  console.log(`Balance before: ${ethers.formatEther(balBefore)} STT`);

  for (const addr of TARGETS) {
    console.log(`\n${"═".repeat(56)}`);
    console.log(`Contract: ${addr}`);

    const actual = await ethers.provider.getBalance(addr);
    console.log(`Actual balance: ${ethers.formatEther(actual)} STT`);

    if (actual === 0n) {
      console.log(`Nothing to recover.`);
      continue;
    }

    // Try withdrawBuffer with modified gas — sometimes helps
    const contract = new ethers.Contract(addr, ABI, signer);

    // First try standard withdrawBuffer
    try {
      const tx = await contract.withdrawBuffer({ gasLimit: 300_000 });
      await tx.wait(2);
      console.log(`✅ withdrawBuffer succeeded: ${ethers.formatEther(actual)} STT`);
      continue;
    } catch (e) {
      console.log(`withdrawBuffer failed — trying direct transfer...`);
    }

    // The contracts have receive() — but we can't pull from outside.
    // Only option: deploy a minimal proxy or use selfdestruct trick.
    // Since we can't do that here, let's check if there's another withdrawal path.

    // Actually the real fix: subscriptionBuffer is wrong. We need to zero it first.
    // But there's no setter for subscriptionBuffer in the contract.

    // Last resort: check if the contract has any unclaimed failed prizes we can claim
    const EXTENDED_ABI = [
      ...ABI,
      "function getFailedPrizeBalance(address) view returns (uint256)",
      "function claimFailedPrize() external",
      "function topUpPool(uint64) external payable",
    ];

    const ext = new ethers.Contract(addr, EXTENDED_ABI, signer);

    // Check if there are failed prizes for our address
    try {
      const failed = await ext.getFailedPrizeBalance(signer.address);
      if (failed > 0n) {
        console.log(`Found failed prize: ${ethers.formatEther(failed)} STT — claiming...`);
        const tx = await ext.claimFailedPrize();
        await tx.wait(2);
        console.log(`✅ Claimed ${ethers.formatEther(failed)} STT`);
      }
    } catch { /* skip */ }

    // The real solution: top up the contract by the difference so withdrawBuffer works
    const buffer      = 32n * 10n**18n;
    const difference  = buffer - actual;

    if (difference > 0n && difference < ethers.parseEther("1")) {
      console.log(`Gap: ${ethers.formatEther(difference)} STT — topping up to make withdrawBuffer work...`);
      try {
        // Send exactly the difference so actual balance = subscriptionBuffer
        const topupTx = await signer.sendTransaction({
          to:    addr,
          value: difference,
        });
        await topupTx.wait(2);
        console.log(`Topped up by ${ethers.formatEther(difference)} STT`);

        // Now try withdrawBuffer again
        const tx2 = await contract.withdrawBuffer({ gasLimit: 300_000 });
        await tx2.wait(2);
        const newBal = await ethers.provider.getBalance(addr);
        console.log(`✅ Recovered! Contract balance now: ${ethers.formatEther(newBal)} STT`);
      } catch (e) {
        console.log(`Top-up trick failed: ${e.message.slice(0, 100)}`);
      }
    } else if (difference > ethers.parseEther("1")) {
      console.log(`Gap too large (${ethers.formatEther(difference)} STT) — not worth topping up.`);
    } else {
      console.log(`Contract has MORE than buffer — something else is wrong.`);
    }
  }

  const balAfter = await ethers.provider.getBalance(signer.address);
  console.log(`\nBalance after: ${ethers.formatEther(balAfter)} STT`);
  console.log(`Net change: ${ethers.formatEther(balAfter - balBefore)} STT`);
}

main().catch(e => {
  console.error(`Crashed: ${e.message}`);
  process.exit(1);
});