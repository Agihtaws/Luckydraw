// src/reactivity.js
// Subscribes to RaffleEngine contract events via Somnia off-chain reactivity.
// Uses WebSocket — fires callback the moment an event is emitted, no polling.

import { SDK }            from "@somnia-chain/reactivity";
import { decodeEventLog, parseAbi, formatEther } from "viem";
import { publicWsClient } from "./chain.js";
import {
  postCampaignCreated,
  postReminder,
  postRaffleOpened,
  postWinnersSelected,
  postRollover,
  postPoolDepleted,
  postNextRound,
} from "./discord.js";
import {
  publishRoundState,
  publishEntry,
  publishWinner,
  STATUS,
} from "./streams.js";
import "dotenv/config";

// ─────────────────────────────────────────────────────────────
// Contract ABI — only the events we care about
// ─────────────────────────────────────────────────────────────

const RAFFLE_ABI = parseAbi([
  "event CampaignCreated(uint64 indexed campaignId, address indexed admin, uint8 numWinners, uint256 prizePerWinner, uint256 entryFee, uint64 entryWindowSecs, uint64 repeatIntervalSecs, uint8 prizeMode, bool cooldownEnabled, uint256 totalPool)",
  "event RaffleOpened(uint64 indexed campaignId, uint64 indexed roundId, uint64 roundNumber, uint256 pool, uint64 drawTime)",
  "event EntrySubmitted(uint64 indexed campaignId, uint64 indexed roundId, address indexed entrant, uint32 entryNumber)",
  "event WinnersSelected(uint64 indexed campaignId, uint64 indexed roundId, address[] winners, uint256[] prizes, bytes32 blockHashUsed)",
  "event RoundRolledOver(uint64 indexed campaignId, uint64 indexed roundId, uint64 nextRoundId, uint256 rolledPool)",
  "event PoolDepleted(uint64 indexed campaignId)",
  "event NextRoundScheduled(uint64 indexed campaignId, uint64 indexed nextRoundId, uint64 openTime, uint64 drawTime)",
]);

// ─────────────────────────────────────────────────────────────
// Deduplication — prevent same event firing multiple times on reconnect
// Key: txHash-logIndex, TTL: 5 minutes
// ─────────────────────────────────────────────────────────────
const seenEvents = new Map(); // key → timestamp

function isDuplicate(txHash, logIndex) {
  const key = `${txHash}-${logIndex}`;
  const now = Date.now();
  // Clean up old entries
  for (const [k, ts] of seenEvents) {
    if (now - ts > 5 * 60 * 1000) seenEvents.delete(k);
  }
  if (seenEvents.has(key)) return true;
  seenEvents.set(key, now);
  return false;
}

// ─────────────────────────────────────────────────────────────
// Start subscription
// ─────────────────────────────────────────────────────────────

// Retry config
const RETRY_DELAYS = [5_000, 10_000, 30_000, 60_000]; // escalating backoff
let retryCount = 0;

export async function startReactivity() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("CONTRACT_ADDRESS not set in .env");

  // First verify RPC is reachable before attempting WS
  try {
    console.log(`[reactivity] Checking RPC connectivity…`);
    const res = await fetch(process.env.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    });
    const data = await res.json();
    if (data.result) {
      console.log(`[reactivity] RPC OK — block ${parseInt(data.result, 16)}`);
    } else {
      throw new Error("RPC returned no block number");
    }
  } catch (err) {
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    console.error(`[reactivity] ❌ RPC unreachable: ${err.message}`);
    console.log(`[reactivity] Retrying in ${delay / 1000}s… (attempt ${++retryCount})`);
    setTimeout(() => startReactivity(), delay);
    return;
  }

  console.log(`[reactivity] Starting WebSocket subscription to ${contractAddress}…`);

  const reactivitSDK = new SDK({ public: publicWsClient });

  try {
    const subscription = await reactivitSDK.subscribe({
      eventContractSources: [contractAddress],
      ethCalls:             [],
      onlyPushChanges:      false,

      onData: async (data) => {
        retryCount = 0; // reset on successful data
        const { topics, data: logData } = data.result;
        if (!topics || topics.length === 0) return;

        // Deduplicate using txHash + logIndex to prevent replay on reconnect
        const txHash   = data.result.transactionHash || topics[0];
        const logIndex = data.result.logIndex ?? 0;
        if (isDuplicate(txHash, logIndex)) {
          console.log(`[reactivity] Duplicate event skipped (${txHash?.slice(0,10)})`);
          return;
        }

        for (const abiItem of RAFFLE_ABI) {
          try {
            const decoded = decodeEventLog({ abi: [abiItem], topics, data: logData });
            await handleEvent(decoded, contractAddress);
            break;
          } catch { /* not this event type */ }
        }
      },

      onError: (err) => {
        const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
        console.error(`[reactivity] Subscription error: ${err.message || "WebSocket failed"}`);
        console.log(`[reactivity] Reconnecting in ${delay / 1000}s… (attempt ${++retryCount})`);
        setTimeout(() => startReactivity(), delay);
      },
    });

    retryCount = 0;
    console.log(`[reactivity] ✅ Subscribed — listening for events`);
    return subscription;

  } catch (err) {
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    console.error(`[reactivity] Failed to subscribe: ${err.message}`);
    console.log(`[reactivity] Retrying in ${delay / 1000}s… (attempt ${++retryCount})`);
    setTimeout(() => startReactivity(), delay);
  }
}

// ─────────────────────────────────────────────────────────────
// Event handler
// ─────────────────────────────────────────────────────────────

async function handleEvent(decoded, contractAddress) {
  const { eventName, args } = decoded;

  console.log(`\n[reactivity] 📣 Event: ${eventName}`);
  console.log(`[reactivity]    args:  ${JSON.stringify(args, bigIntReplacer)}`);

  switch (eventName) {

    case "CampaignCreated": {
      const { campaignId, numWinners, prizePerWinner, entryWindowSecs, repeatIntervalSecs, totalPool } = args;

      // Work out the schedule label
      const repeatSecs = Number(repeatIntervalSecs);
      let scheduleLabel;
      if      (repeatSecs === 0)       scheduleLabel = "One-time";
      else if (repeatSecs < 3600)      scheduleLabel = `Every ${Math.round(repeatSecs / 60)} minutes`;
      else if (repeatSecs < 86400)     scheduleLabel = `Every ${Math.round(repeatSecs / 3600)} hours`;
      else if (repeatSecs === 86400)   scheduleLabel = "Daily";
      else if (repeatSecs === 604800)  scheduleLabel = "Weekly";
      else                             scheduleLabel = `Every ${Math.round(repeatSecs / 86400)} days`;

      // Calculate first open time from block.timestamp + firstOpenDelayMs
      // We don't have block.timestamp here directly, but we know the round's openTime
      // is stored in the contract. Use Date.now() + entryWindowSecs as a conservative estimate.
      // The exact value comes from NextRoundScheduled — for CampaignCreated we read it
      // from the createCampaign tx timestamp + firstOpenDelayMs.
      // Best approximation: now + 60s (default firstOpenDelayMs) — frontend will show exact.
      // We'll use the openTime from the upcoming round via a short RPC call.
      let openTimeSecs = BigInt(Math.floor(Date.now() / 1000) + 60); // fallback
      try {
        const { publicHttpClient } = await import("./chain.js");
        const RaffleABI = [{
          name: "getCurrentRound",
          type: "function",
          stateMutability: "view",
          inputs:  [{ name: "campaignId", type: "uint64" }],
          outputs: [{ name: "", type: "tuple", components: [
            { name: "id",            type: "uint64"  },
            { name: "campaignId",    type: "uint64"  },
            { name: "roundNumber",   type: "uint64"  },
            { name: "status",        type: "uint8"   },
            { name: "openTime",      type: "uint64"  },
            { name: "drawTime",      type: "uint64"  },
            { name: "entryCount",    type: "uint32"  },
            { name: "pool",          type: "uint256" },
            { name: "blockHashUsed", type: "bytes32" },
            { name: "rolloverIncluded", type: "bool" },
          ]}],
        }];
        const round = await publicHttpClient.readContract({
          address:      contractAddress,
          abi:          RaffleABI,
          functionName: "getCurrentRound",
          args:         [campaignId],
        });
        openTimeSecs = round.openTime;
      } catch { /* use fallback */ }

      // Post campaign created message with exact open time
      await postCampaignCreated({
        campaignId:      campaignId.toString(),
        numWinners:      numWinners.toString(),
        prizeEth:        formatEther(prizePerWinner),
        totalPoolEth:    formatEther(totalPool),
        entryWindowMins: Math.round(Number(entryWindowSecs) / 60),
        scheduleLabel,
        openTime:        openTimeSecs,
        contractAddress,
      });

      // Schedule 30-minute reminder before the round opens
      const openMs      = Number(openTimeSecs) * 1000;
      const reminderMs  = openMs - 30 * 60 * 1000;  // 30 mins before
      const delayMs     = reminderMs - Date.now();

      if (delayMs > 0) {
        console.log(`[reactivity] 30-min reminder scheduled in ${Math.round(delayMs / 60000)} minutes`);
        setTimeout(async () => {
          await postReminder({
            campaignId:  campaignId.toString(),
            roundNumber: "1",
            prizeEth:    formatEther(prizePerWinner),
            openTime:    openTimeSecs,
          });
        }, delayMs);
      } else {
        console.log(`[reactivity] Open time < 30 mins away — skipping reminder`);
      }

      break;
    }

    case "RaffleOpened": {
      const { campaignId, roundId, roundNumber, pool, drawTime } = args;
      const poolEth = formatEther(pool);

      // 1. Discord announcement
      await postRaffleOpened({
        campaignId:      campaignId.toString(),
        roundId:         roundId.toString(),
        roundNumber:     roundNumber.toString(),
        poolEth,
        drawTime,
        contractAddress,
      });

      // 2. Data Streams — round state = OPEN
      await publishRoundState({
        campaignId,
        roundId,
        roundNumber,
        status:     STATUS.OPEN,
        poolWei:    pool,
        drawTime,
        entryCount: 0,
      });

      break;
    }

    case "EntrySubmitted": {
      const { campaignId, roundId, entrant, entryNumber } = args;

      // Data Streams — write entry record (frontend reads for live counter)
      await publishEntry({ campaignId, roundId, entrant, entryNumber });

      // Also update round state entry count
      // (We don't have the full round data here, so just log — frontend
      //  can derive count from total entry records)
      console.log(`[reactivity]    Entry #${entryNumber} from ${entrant}`);

      break;
    }

    case "WinnersSelected": {
      const { campaignId, roundId, winners, prizes, blockHashUsed } = args;

      const prizesEth = prizes.map((p) => formatEther(p));

      // 1. Discord winner announcement
      await postWinnersSelected({
        campaignId:    campaignId.toString(),
        roundId:       roundId.toString(),
        winners,
        prizesEth,
        blockHash:     blockHashUsed,
        contractAddress,
      });

      // 2. Data Streams — write winner record(s)
      for (let i = 0; i < winners.length; i++) {
        await publishWinner({
          campaignId,
          roundId,
          winner:        winners[i],
          prizeWei:      prizes[i],
          blockHashUsed,
        });
      }

      // 3. Update round state = COMPLETE
      await publishRoundState({
        campaignId,
        roundId,
        roundNumber:   0n,  // not available here; frontend can look it up
        status:        STATUS.COMPLETE,
        poolWei:       0n,
        drawTime:      0n,
        entryCount:    0,
      });

      break;
    }

    case "RoundRolledOver": {
      const { campaignId, roundId, nextRoundId, rolledPool } = args;

      // Discord rollover notice
      await postRollover({
        campaignId: campaignId.toString(),
        roundId:    roundId.toString(),
        nextRoundId: nextRoundId.toString(),
        poolEth:    formatEther(rolledPool),
      });

      // Data Streams — round state = ROLLEDOVER
      await publishRoundState({
        campaignId,
        roundId,
        roundNumber: 0n,
        status:      STATUS.ROLLEDOVER,
        poolWei:     rolledPool,
        drawTime:    0n,
        entryCount:  0,
      });

      break;
    }

    case "PoolDepleted": {
      const { campaignId } = args;
      await postPoolDepleted({ campaignId: campaignId.toString() });
      break;
    }

    case "NextRoundScheduled": {
      const { campaignId, nextRoundId, openTime, drawTime } = args;
      console.log(`[reactivity]    Next round: campaign ${campaignId}, round ${nextRoundId}`);
      console.log(`[reactivity]    Opens: ${new Date(Number(openTime) * 1000).toLocaleString()}`);
      console.log(`[reactivity]    Draws: ${new Date(Number(drawTime) * 1000).toLocaleString()}`);

      // Discord — "next round coming" notice
      await postNextRound({
        campaignId:  campaignId.toString(),
        nextRoundId: nextRoundId.toString(),
        openTime,
        drawTime,
      });

      // Data Streams — upcoming round state
      await publishRoundState({
        campaignId,
        roundId:     nextRoundId,
        roundNumber: 0n,
        status:      STATUS.UPCOMING,
        poolWei:     0n,
        drawTime,
        entryCount:  0,
      });

      break;
    }

    default:
      console.log(`[reactivity]    Unhandled event: ${eventName}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Utility — JSON.stringify safe for BigInt
// ─────────────────────────────────────────────────────────────

function bigIntReplacer(_, v) {
  return typeof v === "bigint" ? v.toString() : v;
}