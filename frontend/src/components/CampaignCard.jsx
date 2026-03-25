import React        from "react";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import StatusBadge  from "./StatusBadge.jsx";
import { useCountdown } from "../hooks/useCountdown.js";
import { CONTRACT_ADDRESS } from "../config/wagmi.js";
import { RAFFLE_ABI, ROUND_STATUS } from "../abi.js";

function Tag({ label, accent }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-lg font-medium"
      style={{
        background: accent ? "var(--purple-dim)" : "var(--surface2)",
        color:      accent ? "var(--purple)"     : "var(--muted2)",
        border:     `1px solid ${accent ? "var(--purple)" : "var(--border)"}`,
      }}>
      {label}
    </span>
  );
}

function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

function CardInner({ campaign, round, onClick }) {
  const poolDepleted = !campaign.remainingPool || campaign.remainingPool === 0n ||
    BigInt(campaign.remainingPool.toString()) === 0n;

  const rawStatus = round ? (ROUND_STATUS[Number(round.status)] || "UPCOMING") : "UPCOMING";
  
  const statusName = campaign.cancelled
    ? "CANCELLED"
    : poolDepleted
      ? "COMPLETE"
      : rawStatus;

  const isOpen     = statusName === "OPEN";
  const isUpcoming = statusName === "UPCOMING";
  const isEnded    = campaign.cancelled || poolDepleted || ["COMPLETE","CANCELLED"].includes(statusName);

  const target = isOpen ? Number(round?.drawTime) : Number(round?.openTime);
  const { timeLeft, parts } = useCountdown(isEnded ? null : target);

  // Fetch last winner (most recent completed round)
  const currentRoundId = round ? Number(round.id) : 0;
  const lastCompletedId = isEnded ? currentRoundId : currentRoundId - 1;
  const { data: lastWinners } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getWinners",
    args: lastCompletedId > 0 ? [BigInt(lastCompletedId)] : undefined,
    query: { enabled: lastCompletedId > 0 },
  });

  const lastWinner = lastWinners?.[0];

  return (
    <div onClick={onClick}
      className="card-hover cursor-pointer rounded-2xl flex flex-col"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>

      {/* ── Top section ───────────────────────────────── */}
      <div className="p-5 sm:p-6 space-y-4">

        <div className="flex items-start justify-between gap-2">
          <StatusBadge statusName={statusName} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Campaign #{campaign.id?.toString()}
          </span>
        </div>

        {/* Prize */}
        <div>
          <div className="text-3xl font-bold font-num gradient-text">
            {formatEther(campaign.prizePerWinner)} STT
          </div>
          <div className="text-sm mt-0.5" style={{ color: "var(--muted2)" }}>
            {campaign.numWinners} winner{campaign.numWinners > 1 ? "s" : ""} per round
          </div>
        </div>

        {/* Countdown — only for non-ended campaigns */}
        {!isEnded && target > 0 && (
          <div className="rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {isOpen ? "Draw closes in" : "Next round opens in"}
            </span>
            <span className="font-mono font-bold text-lg font-num"
              style={{ color: isOpen ? "var(--teal)" : "var(--purple)" }}>
              {String(parts.h).padStart(2,"0")}:{String(parts.m).padStart(2,"0")}:{String(parts.s).padStart(2,"0")}
            </span>
          </div>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          <Tag label={`${Math.round(Number(campaign.entryWindowSecs) / 60)}m window`} />
          <Tag label={campaign.prizeMode === 0 ? "Equal split" : "Tiered"} />
          {campaign.entryFee > 0n && <Tag label={`${formatEther(campaign.entryFee)} STT entry`} accent />}
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────── */}
      <div className="px-5 sm:px-6 py-3 grid grid-cols-3 gap-2 text-center"
        style={{ borderTop: "1px solid var(--border)", background: "var(--surface2)" }}>
        <div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Rounds</p>
          <p className="text-sm font-bold font-num">{campaign.totalRoundsRun?.toString() || "0"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Winners</p>
          <p className="text-sm font-bold font-num">{campaign.totalWinnersPaid?.toString() || "0"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Paid out</p>
          <p className="text-sm font-bold font-num" style={{ color: "var(--amber)" }}>
            {parseFloat(formatEther(campaign.totalDistributed || 0n)).toFixed(1)} STT
          </p>
        </div>
      </div>

      {/* ── Last winner ───────────────────────────────── */}
      {lastWinner && (
        <div className="px-5 sm:px-6 py-3 flex items-center justify-between"
          style={{ borderTop: "1px solid var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--muted)" }}>Last winner</span>
          <span className="text-xs font-mono font-semibold" style={{ color: "var(--amber)" }}>
            🏆 {short(lastWinner)}
          </span>
        </div>
      )}

    </div>
  );
}

export default function CampaignCard({ campaign, onClick }) {
  const { data: round } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCurrentRound",
    args: [BigInt(campaign.id)],
    query: { refetchInterval: 5_000 },
  });
  return <CardInner campaign={campaign} round={round} onClick={onClick} />;
}