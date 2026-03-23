// src/discord.js
// Posts messages to a Discord channel via webhook.

import "dotenv/config";
import { getWebhookUrl } from "./api.js";
const EXPLORER = "https://shannon-explorer.somnia.network";
const FRONTEND = process.env.FRONTEND_URL || "https://your-frontend.com";

// ─────────────────────────────────────────────────────────────
// Core poster
// ─────────────────────────────────────────────────────────────

async function post(payload) {
  const WEBHOOK = getWebhookUrl();
  if (!WEBHOOK) {
    console.log("[discord] No webhook configured — skipping post");
    console.log("[discord] Message:", JSON.stringify(payload).slice(0, 200));
    return;
  }
  try {
    const res = await fetch(WEBHOOK, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[discord] Webhook failed: ${res.status} ${await res.text()}`);
    } else {
      console.log("[discord] Message posted successfully");
    }
  } catch (err) {
    console.error(`[discord] Post error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function timeStr(unixSecs) {
  return new Date(Number(unixSecs) * 1000).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function openDesc(openTimeSecs) {
  const openMs   = Number(openTimeSecs) * 1000;
  const diffMs   = openMs - Date.now();
  const diffMins = diffMs / 60000;
  const diffHrs  = diffMs / 3600000;

  if (diffMs <= 0)       return "Opening now!";
  if (diffMins < 60)     return `in **${Math.round(diffMins)} minutes**`;
  if (diffHrs  < 24)     return `today at **${new Date(openMs).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}**`;
  return `on **${new Date(openMs).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}**`;
}

// ─────────────────────────────────────────────────────────────
// Message 1 — Campaign created (fires on createCampaign tx)
// Shows exact open time — never says "shortly"
// ─────────────────────────────────────────────────────────────

export async function postCampaignCreated({
  campaignId, numWinners, prizeEth, totalPoolEth,
  entryWindowMins, scheduleLabel, openTime, contractAddress,
}) {
  await post({
    username:   "ReactRaffle",
    avatar_url: "https://somnia.network/favicon.ico",
    embeds: [{
      title:       `📢  New Raffle — Campaign #${campaignId}`,
      description: `A new raffle has been set up. First round opens ${openDesc(openTime)}`,
      color:       0x534AB7,
      fields: [
        { name: "Prize per winner", value: `**${prizeEth} STT**`,       inline: true  },
        { name: "Winners / round",  value: `**${numWinners}**`,          inline: true  },
        { name: "Total pool",       value: `**${totalPoolEth} STT**`,    inline: true  },
        { name: "Entry window",     value: `${entryWindowMins} minutes`, inline: true  },
        { name: "Schedule",         value: scheduleLabel,                inline: true  },
        { name: "First open time",  value: timeStr(openTime),            inline: false },
        { name: "Verify on-chain",  value: `${EXPLORER}/address/${contractAddress}`, inline: false },
      ],
      footer:    { text: `Campaign ${campaignId} · Powered by Somnia Reactivity` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────────────────────
// Message 2 — 30-minute reminder (scheduled via setTimeout)
// ─────────────────────────────────────────────────────────────

export async function postReminder({ campaignId, roundNumber, prizeEth, openTime }) {
  const entryLink = `${FRONTEND}?campaign=${campaignId}`;
  await post({
    username:   "ReactRaffle",
    avatar_url: "https://somnia.network/favicon.ico",
    embeds: [{
      title:       `⏰  Reminder — Raffle opens in 30 minutes!`,
      description: `Campaign #${campaignId} Round #${roundNumber} starts soon. Get ready to enter!`,
      color:       0xEF9F27,
      fields: [
        { name: "Opens at",   value: `**${timeStr(openTime)}**`, inline: true  },
        { name: "Prize",      value: `**${prizeEth} STT**`,      inline: true  },
        { name: "Entry link", value: entryLink,                  inline: false },
      ],
      footer:    { text: `Campaign ${campaignId} · Round ${roundNumber}` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────────────────────
// Message 3 — Raffle is LIVE (fires on RaffleOpened event)
// ─────────────────────────────────────────────────────────────

export async function postRaffleOpened({ campaignId, roundId, roundNumber, poolEth, drawTime, contractAddress }) {
  const entryLink = `${FRONTEND}?campaign=${campaignId}`;
  await post({
    username:   "ReactRaffle",
    avatar_url: "https://somnia.network/favicon.ico",
    embeds: [{
      title:       `🎟️  Raffle is LIVE — Campaign #${campaignId}, Round #${roundNumber}`,
      description: `The entry window is open. Enter now for a chance to win!`,
      color:       0x1D9E75,
      fields: [
        { name: "Prize pool",  value: `**${poolEth} STT**`,   inline: true  },
        { name: "Draw time",   value: `**${timeStr(drawTime)}**`, inline: true },
        { name: "Round",       value: `#${roundNumber}`,      inline: true  },
        { name: "Enter here",  value: entryLink,              inline: false },
      ],
      footer:    { text: `Campaign ${campaignId} · Round ${roundId} · Powered by Somnia Reactivity` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────────────────────
// Message 4 — Winners announced (fires on WinnersSelected)
// ─────────────────────────────────────────────────────────────

export async function postWinnersSelected({ campaignId, roundId, winners, prizesEth, blockHash, contractAddress }) {
  const verifyLink  = `${EXPLORER}/address/${contractAddress}?tab=logs`;
  const winnerLines = winners.map((w, i) =>
    `**${["🥇","🥈","🥉"][i] || "🏅"}  ${w}**  →  ${prizesEth[i]} STT`
  ).join("\n");

  await post({
    username:   "ReactRaffle",
    avatar_url: "https://somnia.network/favicon.ico",
    embeds: [{
      title:       `🏆  Winners Announced — Campaign #${campaignId}, Round #${roundId}`,
      description: winnerLines,
      color:       0xEF9F27,
      fields: [
        { name: "Verify on-chain", value: `Prizes sent **in the same block** as the draw.\n[View transaction logs](${verifyLink})`, inline: false },
        { name: "Block hash used", value: `\`${blockHash.slice(0, 18)}...\`  (tamper-proof randomness)`, inline: false },
      ],
      footer:    { text: `Campaign ${campaignId} · Round ${roundId} · No trust required` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────────────────────
// Message 5 — Next round scheduled (fires on NextRoundScheduled)
// ─────────────────────────────────────────────────────────────

export async function postNextRound({ campaignId, nextRoundId, openTime, drawTime }) {
  await post({
    username:   "ReactRaffle",
    avatar_url: "https://somnia.network/favicon.ico",
    embeds: [{
      title:       `🗓️  Next Round Scheduled — Campaign #${campaignId}`,
      description: `Round #${nextRoundId} is coming up. ${openDesc(openTime)}`,
      color:       0x378ADD,
      fields: [
        { name: "Opens at", value: `**${timeStr(openTime)}**`, inline: true },
        { name: "Draw at",  value: `**${timeStr(drawTime)}**`, inline: true },
      ],
      footer:    { text: `Campaign ${campaignId} · Round ${nextRoundId}` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────────────────────
// Message 6 — Rollover
// ─────────────────────────────────────────────────────────────

export async function postRollover({ campaignId, roundId, nextRoundId, poolEth }) {
  await post({
    username: "ReactRaffle",
    embeds: [{
      title:       `↩️  Round #${roundId} Rolled Over — Campaign #${campaignId}`,
      description: `No entries this round. Prize pool carries forward to round #${nextRoundId}.`,
      color:       0x888780,
      fields: [{ name: "Next round pool", value: `**${poolEth} STT** (growing!)`, inline: true }],
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────────────────────
// Message 7 — Pool depleted / campaign complete
// ─────────────────────────────────────────────────────────────

export async function postPoolDepleted({ campaignId }) {
  await post({
    username: "ReactRaffle",
    embeds: [{
      title:       `🏁  Campaign #${campaignId} Complete`,
      description: `The prize pool has been fully distributed. All rounds finished.`,
      color:       0x534AB7,
      timestamp:   new Date().toISOString(),
    }],
  });
}