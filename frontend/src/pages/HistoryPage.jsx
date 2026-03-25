import React, { useMemo } from "react";
import { useReadContracts, useReadContract } from "wagmi";
import { formatEther }    from "viem";
import { CONTRACT_ADDRESS, EXPLORER } from "../config/wagmi.js";
import { RAFFLE_ABI }                 from "../abi.js";
import { useCampaignCount }           from "../hooks/useRaffle.js";

function short(addr) {
  return addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : "";
}

function RoundCard({ roundId, campaignId }) {
  const { data: round }   = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getRound", args: [BigInt(roundId)],
  });
  const { data: winners } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getWinners", args: [BigInt(roundId)],
    query: { enabled: !!round && Number(round.status) === 3 },
  });
  const { data: campaign } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCampaign", args: [BigInt(campaignId)],
  });

  if (!round) return null;
  if (Number(round.campaignId) !== Number(campaignId)) return null;
  if (Number(round.status) !== 3 && Number(round.status) !== 4) return null;

  const drawDate  = new Date(Number(round.drawTime) * 1000);
  const rolledOver = Number(round.status) === 4;
  const medals    = ["🥇","🥈","🥉","🏅"];

  // Calculate tiered prizes
  function getPrize(i) {
    if (!campaign || !round.pool) return campaign?.prizePerWinner || 0n;
    if (Number(campaign.prizeMode) === 1 && winners?.length === 2) {
      return i === 0 ? (round.pool * 60n) / 100n : round.pool - (round.pool * 60n) / 100n;
    }
    if (Number(campaign.prizeMode) === 1 && winners?.length === 3) {
      const f = (round.pool * 50n) / 100n, s = (round.pool * 30n) / 100n;
      return i === 0 ? f : i === 1 ? s : round.pool - f - s;
    }
    return campaign.prizePerWinner;
  }

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>

      {/* Card header */}
      <div className="px-5 py-3 flex items-center justify-between"
        style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(113,113,122,0.25)", color: "var(--muted2)" }}>
            Campaign #{campaignId}
          </span>
          <span className="font-semibold text-sm">
            Round #{round.roundNumber?.toString()}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {drawDate.toLocaleDateString()} {drawDate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
          </span>
          <a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}?tab=logs`}
            target="_blank" rel="noreferrer"
            className="text-xs underline" style={{ color: "var(--muted2)" }}>
            Verify →
          </a>
        </div>
      </div>

      {/* Winners */}
      <div className="p-5">
        {rolledOver || !winners || winners.length === 0 ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <span>↩️</span>
            <span>No entries — pool rolled over</span>
          </div>
        ) : (
          <div className="space-y-3">
            {winners.map((w, i) => (
              <div key={w} className="flex items-center gap-4">
                <span className="text-2xl w-8 shrink-0">{medals[i]}</span>
                <div className="flex-1 min-w-0">
                  <a href={`${EXPLORER}/address/${w}`} target="_blank" rel="noreferrer"
                    className="font-mono text-sm hover:underline block truncate"
                    style={{ color: "var(--text)" }}>
                    {w}
                  </a>
                </div>
                <span className="font-bold font-num text-sm shrink-0"
                  style={{ color: "var(--amber)" }}>
                  {parseFloat(formatEther(getPrize(i))).toFixed(2)} STT
                </span>
              </div>
            ))}
          </div>
        )}

        {round.blockHashUsed && round.blockHashUsed !== "0x" + "0".repeat(64) && (
          <p className="text-xs mt-4 font-mono truncate"
            style={{ color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 12 }}>
            🔒 {round.blockHashUsed.slice(0, 26)}…
          </p>
        )}
      </div>
    </div>
  );
}

function CampaignSection({ campaign, currentRoundId, totalCampaigns }) {
  const roundCount = Number(campaign.totalRoundsRun || 0);
  if (roundCount === 0) return null;

  // FIX 3 + 4: Round IDs are GLOBAL — with N campaigns running in parallel, rounds
  // are interleaved across campaigns. If there are 3 campaigns and this one has
  // 5 completed rounds, the IDs might be spread across 15 global slots.
  // We need to look back far enough to find all rounds belonging to this campaign.
  // Formula: (roundCount + 1) * max(totalCampaigns, 3) gives enough headroom.
  // Also guard against currentRoundId=0 (can happen if getCurrentRound reverts
  // for a cancelled campaign) — in that case we can't enumerate rounds.
  if (currentRoundId === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">Campaign #{campaign.id.toString()}</h2>
            {campaign.cancelled && (
              <span className="text-xs px-2 py-1 rounded-full font-semibold"
                style={{ background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
                Cancelled
              </span>
            )}
          </div>
        </div>
        <div className="rounded-2xl p-6 text-center"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {roundCount} completed round{roundCount !== 1 ? "s" : ""} — round data unavailable.
          </p>
        </div>
      </div>
    );
  }

  const lookback = Math.min(
    currentRoundId,
    (roundCount + 1) * Math.max(totalCampaigns, 3),
    150  // hard cap to avoid too many RPC calls
  );

  const roundIds = Array.from({ length: lookback }, (_, i) =>
    currentRoundId - i
  ).filter(id => id > 0);

  return (
    <div className="space-y-4">
      {/* Campaign header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">Campaign #{campaign.id.toString()}</h2>
          <span className="text-xs px-2 py-1 rounded-full"
            style={{ background: "var(--surface2)", color: "var(--muted2)" }}>
            {roundCount} round{roundCount !== 1 ? "s" : ""} completed
          </span>
          {campaign.cancelled && (
            <span className="text-xs px-2 py-1 rounded-full font-semibold"
              style={{ background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
              Cancelled
            </span>
          )}
        </div>
        <a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer"
          className="text-xs underline hidden sm:block" style={{ color: "var(--muted)" }}>
          View contract →
        </a>
      </div>

      {/* Rounds — full width for 1 round, 2-col grid for multiple */}
      <div className={roundCount > 1 ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
        {roundIds.map(rid => (
          <RoundCard key={rid} roundId={rid} campaignId={campaign.id.toString()} />
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { data: count } = useCampaignCount();
  const total = count ? Number(count) : 0;

  const campaignContracts = useMemo(() =>
    Array.from({ length: total }, (_, i) => ({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "getCampaign", args: [BigInt(i + 1)],
    })), [total]
  );

  const roundContracts = useMemo(() =>
    Array.from({ length: total }, (_, i) => ({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "getCurrentRound", args: [BigInt(i + 1)],
    })), [total]
  );

  const { data: rawCampaigns, isLoading } = useReadContracts({
    contracts: campaignContracts,
    query: { enabled: total > 0, refetchInterval: 10_000 },
  });

  const { data: rawRounds } = useReadContracts({
    contracts: roundContracts,
    query: { enabled: total > 0, refetchInterval: 10_000 },
  });

  const campaigns = useMemo(() =>
    (rawCampaigns || []).map((r, i) => {
      const c = r.result;
      if (!c) return null;
      const round = rawRounds?.[i]?.result;
      // FIX 4: round may be undefined/null if getCurrentRound reverted (cancelled campaign)
      // _currentRoundId=0 is handled gracefully in CampaignSection
      return { ...c, _currentRoundId: round ? Number(round.id) : 0 };
    }).filter(Boolean).filter(c => Number(c.totalRoundsRun) > 0),
    [rawCampaigns, rawRounds]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-12">

      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>
          History
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>
          All completed rounds — fully verifiable on-chain.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-32 rounded-2xl animate-pulse"
              style={{ background: "var(--surface)" }} />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-5xl mb-4">⏳</div>
          <p className="text-lg font-semibold">No completed rounds yet</p>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Rounds appear here after the draw fires.
          </p>
        </div>
      ) : (
        [...campaigns].reverse().map(c => (
          <CampaignSection
            key={c.id.toString()}
            campaign={c}
            currentRoundId={c._currentRoundId}
            totalCampaigns={total}
          />
        ))
      )}
    </div>
  );
}