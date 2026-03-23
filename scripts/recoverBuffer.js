const { ethers } = require("hardhat");

const TARGETS = [
  "0x77016349a27A8f862740E1559BEd66e407AeC5D7",
  "0x357BD1d5001FBF816735E401c3D7e229ef1cccEf",
];

const ABI = [
  "function getActiveCampaignCount() view returns (uint64)",
  "function withdrawBuffer() external",
  "function owner() view returns (address)",
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

    const contract = new ethers.Contract(addr, ABI, signer);

    try {
      const tx = await contract.withdrawBuffer({ gasLimit: 300_000 });
      await tx.wait(2);
      console.log(`✅ withdrawBuffer succeeded: ${ethers.formatEther(actual)} STT`);
      continue;
    } catch (e) {
      console.log(`withdrawBuffer failed — trying direct transfer...`);
    }

    const EXTENDED_ABI = [
      ...ABI,
      "function getFailedPrizeBalance(address) view returns (uint256)",
      "function claimFailedPrize() external",
      "function topUpPool(uint64) external payable",
    ];

    const ext = new ethers.Contract(addr, EXTENDED_ABI, signer);

    try {
      const failed = await ext.getFailedPrizeBalance(signer.address);
      if (failed > 0n) {
        console.log(`Found failed prize: ${ethers.formatEther(failed)} STT — claiming...`);
        const tx = await ext.claimFailedPrize();
        await tx.wait(2);
        console.log(`✅ Claimed ${ethers.formatEther(failed)} STT`);
      }
    } catch { }

    const buffer      = 32n * 10n**18n;
    const difference  = buffer - actual;

    if (difference > 0n && difference < ethers.parseEther("1")) {
      console.log(`Gap: ${ethers.formatEther(difference)} STT — topping up to make withdrawBuffer work...`);
      try {
        const topupTx = await signer.sendTransaction({
          to:    addr,
          value: difference,
        });
        await topupTx.wait(2);
        console.log(`Topped up by ${ethers.formatEther(difference)} STT`);

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