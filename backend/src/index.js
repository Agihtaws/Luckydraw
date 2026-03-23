// src/index.js
// ReactRaffle backend entry point.
// Starts:
//   1. Express API server (webhook config, health check)
//   2. Data Streams SDK (schema registration)
//   3. Reactivity WebSocket subscription (event listener → Discord)

import "dotenv/config";
import { createApiServer, getWebhookUrl } from "./api.js";
import { initStreams, schemaIds }          from "./streams.js";
import { startReactivity }                from "./reactivity.js";

// ─────────────────────────────────────────────────────────────
// Validate required env vars
// ─────────────────────────────────────────────────────────────

const REQUIRED = ["RPC_URL", "WS_URL", "PRIVATE_KEY", "CONTRACT_ADDRESS"];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌  Missing required env var: ${key}`);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════════════");
  console.log("  ReactRaffle Backend");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  Contract : ${process.env.CONTRACT_ADDRESS}`);
  console.log(`  Network  : Somnia Testnet (chainId 50312)`);
  console.log(`  API port : ${PORT}`);
  console.log("════════════════════════════════════════════════════════\n");

  // Step 1 — Start API server
  console.log("[main] Starting API server…");
  const app = createApiServer();
  app.listen(PORT, () => {
    console.log(`[main] API server running on http://localhost:${PORT}`);
    console.log(`[main]   GET  /api/health`);
    console.log(`[main]   GET  /api/webhook`);
    console.log(`[main]   POST /api/webhook`);
    console.log(`[main]   POST /api/webhook/test`);
  });

  // Step 2 — Initialise Data Streams
  console.log("\n[main] Initialising Data Streams…");
  await initStreams();
  console.log("[main] Data Streams ready ✅");
  for (const [name, id] of Object.entries(schemaIds)) {
    console.log(`         ${name}: ${id}`);
  }

  // Step 3 — Start reactivity WebSocket subscription
  console.log("\n[main] Starting reactivity subscription…");
  await startReactivity();
  console.log("[main] Backend fully running ✅\n");
  console.log("Listening for contract events. Press Ctrl+C to stop.\n");

  // Heartbeat
  setInterval(() => {
    const webhookSet = !!getWebhookUrl();
    console.log(`[main] Heartbeat — ${new Date().toLocaleString()} — webhook: ${webhookSet ? "✅" : "⚠️ not set"}`);
  }, 5 * 60 * 1000);
}

main().catch((err) => {
  console.error(`\n❌  Backend crashed: ${err.message}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n[main] Shutting down…");
  process.exit(0);
});