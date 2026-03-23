// src/streams.js
// Publishes raffle events to Somnia Data Streams.
// Three schemas: round state, entries, winners.
// Frontend subscribes to these for the live dashboard.

import { SDK, SchemaEncoder, zeroBytes32 } from "@somnia-chain/streams";
import { toHex } from "viem";
import { publicHttpClient, getWalletClient } from "./chain.js";
import "dotenv/config";
// ─────────────────────────────────────────────────────────────
// Deduplication — prevent same event writing to streams multiple times
// ─────────────────────────────────────────────────────────────
const seenStreamEvents = new Map();

function isStreamDuplicate(key) {
  const now = Date.now();
  // Clean up entries older than 10 minutes
  for (const [k, ts] of seenStreamEvents) {
    if (now - ts > 10 * 60 * 1000) seenStreamEvents.delete(k);
  }
  if (seenStreamEvents.has(key)) return true;
  seenStreamEvents.set(key, now);
  return false;
}


// ─────────────────────────────────────────────────────────────
// Schema definitions — exact string determines schemaId
// ─────────────────────────────────────────────────────────────

export const SCHEMAS = {
  // Round lifecycle — open, drawing, complete, rollover
  roundState: "uint64 campaignId, uint64 roundId, uint64 roundNumber, uint8 status, uint256 pool, uint64 drawTime, uint32 entryCount",

  // Each wallet that enters
  entry: "uint64 campaignId, uint64 roundId, address entrant, uint32 entryNumber, uint64 timestamp",

  // Draw result — one record per completed round
  winner: "uint64 campaignId, uint64 roundId, address winner, uint256 prize, bytes32 blockHashUsed, uint64 timestamp",
};

// Status codes matching the schema uint8 field
export const STATUS = { UPCOMING: 0, OPEN: 1, DRAWING: 2, COMPLETE: 3, ROLLEDOVER: 4, CANCELLED: 5 };

let sdk;
let schemaIds = {};
let encoders  = {};
let initialised = false;

// ─────────────────────────────────────────────────────────────
// Initialise SDK and register schemas (run once at startup)
// ─────────────────────────────────────────────────────────────

export async function initStreams() {
  if (initialised) return;

  sdk = new SDK({
    public: publicHttpClient,
    wallet: getWalletClient(),
  });

  console.log("[streams] Computing schema IDs…");

  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const id = await sdk.streams.computeSchemaId(schema);
    schemaIds[name] = id;
    encoders[name]  = new SchemaEncoder(schema);
    console.log(`[streams]   ${name}: ${id}`);
  }

  // Register schemas — safe to call even if already registered (ignoreExisting = true)
  console.log("[streams] Registering schemas on-chain…");
  try {
    await sdk.streams.registerDataSchemas([
      { schemaName: "reactraffle_roundState", schema: SCHEMAS.roundState, parentSchemaId: zeroBytes32 },
      { schemaName: "reactraffle_entry",      schema: SCHEMAS.entry,      parentSchemaId: zeroBytes32 },
      { schemaName: "reactraffle_winner",     schema: SCHEMAS.winner,     parentSchemaId: zeroBytes32 },
    ], true);
    console.log("[streams] Schemas registered ✅");
  } catch (err) {
    // Non-fatal — schemas may already be registered
    console.warn(`[streams] Schema registration warning: ${err.message}`);
  }

  initialised = true;
}

// ─────────────────────────────────────────────────────────────
// Publish helpers
// ─────────────────────────────────────────────────────────────

/**
 * Writes a round state record — called when round opens, draws, or completes.
 */
export async function publishRoundState({ campaignId, roundId, roundNumber, status, poolWei, drawTime, entryCount }) {
  if (!initialised) return;

  // Dedup: same campaign+round+status combo — only write once
  const dedupKey = `rs-${campaignId}-${roundId}-${status}`;
  if (isStreamDuplicate(dedupKey)) {
    console.log(`[streams] roundState skipped (duplicate) — campaign ${campaignId}, round ${roundId}, status ${status}`);
    return;
  }

  try {
    const enc = encoders.roundState;
    const data = enc.encodeData([
      { name: "campaignId",  value: campaignId.toString(),  type: "uint64"  },
      { name: "roundId",     value: roundId.toString(),     type: "uint64"  },
      { name: "roundNumber", value: roundNumber.toString(), type: "uint64"  },
      { name: "status",      value: status.toString(),      type: "uint8"   },
      { name: "pool",        value: poolWei.toString(),     type: "uint256" },
      { name: "drawTime",    value: drawTime.toString(),    type: "uint64"  },
      { name: "entryCount",  value: entryCount.toString(),  type: "uint32"  },
    ]);

    // Key: campaign-round — overwrites previous state for this round (UPDATE semantics)
    const dataId = toHex(`rs-${campaignId}-${roundId}`, { size: 32 });

    await sdk.streams.set([{
      id:       dataId,
      schemaId: schemaIds.roundState,
      data,
    }]);

    console.log(`[streams] roundState published — campaign ${campaignId}, round ${roundId}, status ${status}`);
  } catch (err) {
    console.error(`[streams] publishRoundState error: ${err.message}`);
  }
}

/**
 * Writes an entry record — called for every EntrySubmitted event.
 */
export async function publishEntry({ campaignId, roundId, entrant, entryNumber }) {
  if (!initialised) return;

  // Dedup: same entry number for same round — only write once
  const dedupKey = `e-${campaignId}-${roundId}-${entryNumber}`;
  if (isStreamDuplicate(dedupKey)) {
    console.log(`[streams] entry skipped (duplicate) — #${entryNumber}`);
    return;
  }

  try {
    const enc  = encoders.entry;
    const ts   = Math.floor(Date.now() / 1000);
    const data = enc.encodeData([
      { name: "campaignId",  value: campaignId.toString(),  type: "uint64"  },
      { name: "roundId",     value: roundId.toString(),     type: "uint64"  },
      { name: "entrant",     value: entrant,                type: "address" },
      { name: "entryNumber", value: entryNumber.toString(), type: "uint32"  },
      { name: "timestamp",   value: ts.toString(),          type: "uint64"  },
    ]);

    // Key: campaign-round-entry — unique per entry (INSERT semantics)
    const dataId = toHex(`e-${campaignId}-${roundId}-${entryNumber}`, { size: 32 });

    await sdk.streams.set([{
      id:       dataId,
      schemaId: schemaIds.entry,
      data,
    }]);

    console.log(`[streams] entry published — campaign ${campaignId}, round ${roundId}, #${entryNumber} ${entrant}`);
  } catch (err) {
    console.error(`[streams] publishEntry error: ${err.message}`);
  }
}

/**
 * Writes a winner record — called when WinnersSelected fires.
 */
export async function publishWinner({ campaignId, roundId, winner, prizeWei, blockHashUsed }) {
  if (!initialised) return;

  // Dedup: one winner per round
  const dedupKey = `w-${campaignId}-${roundId}`;
  if (isStreamDuplicate(dedupKey)) {
    console.log(`[streams] winner skipped (duplicate) — campaign ${campaignId}, round ${roundId}`);
    return;
  }

  try {
    const enc  = encoders.winner;
    const ts   = Math.floor(Date.now() / 1000);
    const data = enc.encodeData([
      { name: "campaignId",    value: campaignId.toString(), type: "uint64"  },
      { name: "roundId",       value: roundId.toString(),    type: "uint64"  },
      { name: "winner",        value: winner,                type: "address" },
      { name: "prize",         value: prizeWei.toString(),   type: "uint256" },
      { name: "blockHashUsed", value: blockHashUsed,         type: "bytes32" },
      { name: "timestamp",     value: ts.toString(),         type: "uint64"  },
    ]);

    // Key: campaign-round — one winner record per round
    const dataId = toHex(`w-${campaignId}-${roundId}`, { size: 32 });

    await sdk.streams.set([{
      id:       dataId,
      schemaId: schemaIds.winner,
      data,
    }]);

    console.log(`[streams] winner published — campaign ${campaignId}, round ${roundId}, winner ${winner}`);
  } catch (err) {
    console.error(`[streams] publishWinner error: ${err.message}`);
  }
}

export { schemaIds, sdk };