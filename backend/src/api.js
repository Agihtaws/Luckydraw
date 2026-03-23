import express   from "express";
import cors      from "cors";
import fs        from "fs";
import path      from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "..", "webhook-config.json");

// Webhook config — persisted to a JSON file so it survives restarts

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch { /* ignore */ }
  return { webhookUrl: process.env.DISCORD_WEBHOOK_URL || "" };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// In-memory config (also persisted to disk)
let config = loadConfig();

// Exported getter — used by discord.js to get current webhook URL
export function getWebhookUrl() {
  return config.webhookUrl || "";
}

// Allowed origins — frontend dev + production URL

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  process.env.FRONTEND_URL,
].filter(Boolean);

// Auth — simple secret key check

const BACKEND_SECRET = process.env.BACKEND_SECRET || "";

function requireAuth(req, res, next) {
  // If no secret configured, allow all (dev mode)
  if (!BACKEND_SECRET) return next();

  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "").trim();

  if (token !== BACKEND_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Mask webhook URL for display (hide the token part)
function maskUrl(url) {
  if (!url) return "";
  try {
    const parts = url.split("/");
    const token = parts[parts.length - 1];
    return url.replace(token, token.slice(0, 8) + "…");
  } catch {
    return url.slice(0, 40) + "…";
  }
}

// Create Express app

export function createApiServer() {
  const app = express();

  app.use(cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman) or matching origins
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    methods:     ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  app.use(express.json());

  // ── Health check ────────────────────────────────────────

  app.get("/api/health", (req, res) => {
    res.json({
      status:        "ok",
      webhookSet:    !!config.webhookUrl,
      contract:      process.env.CONTRACT_ADDRESS,
      network:       "Somnia Testnet",
      timestamp:     new Date().toISOString(),
    });
  });

  // Returns masked URL so frontend can show it without exposing the token

  app.get("/api/webhook", requireAuth, (req, res) => {
    res.json({
      set:      !!config.webhookUrl,
      maskedUrl: maskUrl(config.webhookUrl),
    });
  });

  // Save a new webhook URL

  app.post("/api/webhook", requireAuth, (req, res) => {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    if (!url.startsWith("https://discord.com/api/webhooks/")) {
      return res.status(400).json({ error: "Invalid Discord webhook URL" });
    }

    config.webhookUrl = url.trim();
    saveConfig(config);

    console.log(`[api] Webhook URL updated: ${maskUrl(config.webhookUrl)}`);
    res.json({ ok: true, maskedUrl: maskUrl(config.webhookUrl) });
  });

  // Clear the webhook URL

  app.delete("/api/webhook", requireAuth, (req, res) => {
    config.webhookUrl = "";
    saveConfig(config);
    console.log("[api] Webhook URL cleared");
    res.json({ ok: true });
  });

  // Send a test Discord message to verify the URL works

  app.post("/api/webhook/test", requireAuth, async (req, res) => {
    const url = config.webhookUrl;
    if (!url) {
      return res.status(400).json({ error: "No webhook URL configured" });
    }

    try {
      const response = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "ReactRaffle",
          embeds: [{
            title:       "✅ Webhook test — working!",
            description: "Your ReactRaffle backend is connected and ready.",
            color:       0x10b981,
            footer:      { text: "ReactRaffle · Somnia Testnet" },
            timestamp:   new Date().toISOString(),
          }],
        }),
      });

      if (response.ok) {
        console.log("[api] Webhook test sent successfully");
        res.json({ ok: true });
      } else {
        const text = await response.text();
        res.status(400).json({ error: `Discord returned ${response.status}: ${text}` });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}