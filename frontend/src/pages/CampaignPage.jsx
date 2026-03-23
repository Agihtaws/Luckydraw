import React, { useState, useRef, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts, useReadContract } from "wagmi";
import { formatEther }           from "viem";
import { useCampaign, useEntrants, useHasEntered, useWinners } from "../hooks/useRaffle.js";
import { useCountdown }          from "../hooks/useCountdown.js";
import StatusBadge               from "../components/StatusBadge.jsx";
import { CONTRACT_ADDRESS, EXPLORER } from "../config/wagmi.js";
import { RAFFLE_ABI }            from "../abi.js";

function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

function CountBlock({ value, label }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-3xl sm:text-4xl font-mono font-bold font-num">{value}</span>
      <span className="text-xs mt-1 uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <span className="text-3xl sm:text-4xl font-mono font-bold"
      style={{ color: "var(--border2)" }}>:</span>
  );
}



// ─────────────────────────────────────────────────────────────
// PastRounds — shows all completed rounds for this campaign
// ─────────────────────────────────────────────────────────────
function PastRounds({ campaign, currentRoundId }) {
  const roundsRun = Number(campaign?.totalRoundsRun || 0);
  if (roundsRun === 0) return null;

  // Include currentRoundId — it may itself be complete (last round, pool depleted)
  // Go back roundsRun + 1 steps to ensure we catch all completed rounds
  const roundIds = Array.from({ length: Math.min(roundsRun + 1, 20) }, (_, i) =>
    currentRoundId - i
  ).filter(id => id > 0);

  // Fetch all rounds in batch
  const { data: rounds } = useReadContracts({
    contracts: roundIds.map(id => ({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "getRound", args: [BigInt(id)],
    })),
    query: { enabled: roundIds.length > 0, refetchInterval: 5_000 },
  });

  const completedRounds = (rounds || [])
    .map((r, i) => ({ ...r.result, _id: roundIds[i] }))
    .filter(r =>
      r &&
      Number(r.campaignId) === Number(campaign?.id) &&  // same campaign only
      (Number(r.status) === 3 || Number(r.status) === 4)
    );

  // Only show past rounds section if this campaign has had more than 1 round
  // (single one-time campaigns don't need a "past rounds" section)
  if (completedRounds.length === 0) return null;
  if (completedRounds.length === 1 && Number(campaign?.repeatIntervalSecs) === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <h3 className="font-semibold">Past Rounds</h3>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {completedRounds.map(r => (
          <RoundResult key={r._id} roundId={r._id} round={r} campaign={campaign} />
        ))}
      </div>
    </div>
  );
}

function RoundResult({ roundId, round, campaign }) {
  const { data: winners } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getWinners", args: [BigInt(roundId)],
  });

  const drawDate = new Date(Number(round.drawTime) * 1000);

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Round #{round.roundNumber?.toString()}</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {drawDate.toLocaleDateString()} {drawDate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
        </span>
      </div>
      {winners && winners.length > 0 ? (
        <div className="space-y-2">
          {winners.map((w, i) => {
            // Calculate tiered prize amounts
            const pool = round.pool || 0n;
            let prize;
            if (Number(campaign?.prizeMode) === 1 && winners.length === 2) {
              prize = i === 0 ? (pool * 60n) / 100n : pool - (pool * 60n) / 100n;
            } else if (Number(campaign?.prizeMode) === 1 && winners.length === 3) {
              const first  = (pool * 50n) / 100n;
              const second = (pool * 30n) / 100n;
              prize = i === 0 ? first : i === 1 ? second : pool - first - second;
            } else {
              prize = campaign?.prizePerWinner || 0n;
            }
            return (
            <div key={w} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span>{["🥇","🥈","🥉"][i] || "🏅"}</span>
                <a href={`${EXPLORER}/address/${w}`} target="_blank" rel="noreferrer"
                  className="font-mono hover:underline" style={{ color: "var(--text)" }}>
                  {w.slice(0,10)}…{w.slice(-6)}
                </a>
              </div>
              <span className="font-semibold font-num" style={{ color: "var(--amber)" }}>
                {parseFloat(formatEther(prize)).toFixed(2)} STT
              </span>
            </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>No entries — rolled over.</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EntrantsList — scrollable, newest on top, auto-scrolls to you
// ─────────────────────────────────────────────────────────────
function EntrantsList({ entrants, address, isSuccess }) {
  const myRef   = useRef(null);
  const listRef = useRef(null);

  // Reverse so newest entry is at top
  const reversed = [...entrants].reverse();
  const myIndex  = reversed.findIndex(a => a.toLowerCase() === address?.toLowerCase());
  const myRank   = entrants.findIndex(a => a.toLowerCase() === address?.toLowerCase()); // original rank (1-based display)

  // Scroll to my entry when I enter or on load
  useEffect(() => {
    if (myRef.current && listRef.current) {
      myRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isSuccess, entrants.length]);

  return (
    <div className="rounded-2xl"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <h3 className="font-semibold">Entrants</h3>
        <div className="flex items-center gap-3">
          {myIndex !== -1 && (
            <span className="text-xs px-2 py-1 rounded-full font-semibold"
              style={{ background: "var(--teal-dim)", color: "var(--teal)" }}>
              You #{myRank + 1}
            </span>
          )}
          <span className="text-sm font-num" style={{ color: "var(--muted)" }}>
            {entrants.length} total
          </span>
        </div>
      </div>

      {/* Scrollable list — max 8 rows visible */}
      <div ref={listRef} style={{ maxHeight: 340, overflowY: "auto" }}
        className="px-2 py-2">
        {reversed.map((addr, i) => {
          const isMe    = addr.toLowerCase() === address?.toLowerCase();
          const rank    = entrants.length - i; // original entry number (newest = highest)
          return (
            <div
              key={`${addr}-${i}`}
              ref={isMe ? myRef : null}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors"
              style={{
                background: isMe ? "rgba(16,185,129,0.1)" : "transparent",
                border:     isMe ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent",
                marginBottom: 2,
              }}>
              {/* Rank number */}
              <span className="w-6 text-xs text-right shrink-0 font-num"
                style={{ color: "var(--muted)" }}>
                #{rank}
              </span>
              {/* Address */}
              <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer"
                className="font-mono text-sm hover:underline flex-1 truncate"
                style={{ color: isMe ? "var(--teal)" : "var(--text)" }}>
                {addr.slice(0, 10)}…{addr.slice(-6)}
              </a>
              {/* You badge */}
              {isMe && (
                <span className="text-xs font-semibold shrink-0"
                  style={{ color: "var(--teal)" }}>
                  you ✓
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignPage({ campaignId, navigate }) {
  const { campaign, round, loading, refetch } = useCampaign(campaignId);
  const { address }   = useAccount();
  const { data: entrants }  = useEntrants(round?.id);
  const { data: hasEntered, refetch: refetchEntered } = useHasEntered(round?.id, address);
  const { data: winners }   = useWinners(round?.statusName === "COMPLETE" ? round?.id : null);

  const isOpen     = round?.statusName === "OPEN";
  const isUpcoming = round?.statusName === "UPCOMING";
  const isEnded    = ["COMPLETE","CANCELLED"].includes(round?.statusName || "");

  const target = isOpen ? round?.drawTime : round?.openTime;
  const { timeLeft, parts, expired } = useCountdown(isEnded ? null : target);

  // Wagmi write
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [writeError, setWriteError] = useState(null);


  const handleEnter = async () => {
    setWriteError(null);
    try {
      writeContract({
        address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
        functionName: "enter",
        args:  [BigInt(campaignId)],
        value: campaign?.entryFee || 0n,
      });
    } catch (e) {
      setWriteError(e.shortMessage || e.message);
    }
  };

  // Refetch after confirmed
  React.useEffect(() => {
    if (isSuccess) { refetch(); refetchEntered(); }
  }, [isSuccess]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg animate-pulse" style={{ color: "var(--muted)" }}>Loading…</div>
    </div>
  );

  if (!campaign) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <div className="text-5xl">🎟️</div>
      <p className="text-lg">Campaign #{campaignId} not found</p>
      <button onClick={() => navigate("home")} className="text-sm underline"
        style={{ color: "var(--purple)" }}>← Back to raffles</button>
    </div>
  );

  const entryCount = entrants?.length || 0;
  const isAdmin = address && campaign?.admin &&
    address.toLowerCase() === campaign.admin.toLowerCase();
  const iWon = address && winners && winners.some(w => w.toLowerCase() === address.toLowerCase());
  const iEntered = (entrants || []).some(e => e.toLowerCase() === address?.toLowerCase());

  function getPrize(i) {
    const pool = round?.pool || 0n;
    if (Number(campaign?.prizeMode) === 1 && winners?.length === 2)
      return i === 0 ? (pool * 60n) / 100n : pool - (pool * 60n) / 100n;
    if (Number(campaign?.prizeMode) === 1 && winners?.length === 3) {
      const f = (pool * 50n)/100n, s = (pool * 30n)/100n;
      return i === 0 ? f : i === 1 ? s : pool - f - s;
    }
    return campaign?.prizePerWinner || 0n;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-6" style={{ color: "var(--muted)" }}>
        <button onClick={() => navigate("home")} className="hover:underline">Raffles</button>
        <span>/</span>
        <span style={{ color: "var(--text)" }}>Campaign #{campaignId}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>
          Campaign #{campaignId}
          <span className="text-base font-normal ml-2" style={{ color: "var(--muted)" }}>
            Round #{round?.roundNumber?.toString() || "—"}
          </span>
        </h1>
        <StatusBadge statusName={round?.statusName || "UPCOMING"} size="lg" />
      </div>

      {/* Two-column grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%,440px),1fr))", gap:"1.5rem", alignItems:"start" }}>

      {/* ── LEFT ── */}
      <div className="space-y-4">

      {/* Prize + countdown card */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>

        {/* Prize */}
        <div className="px-6 pt-5 pb-4 text-center"
          style={{ background: "linear-gradient(180deg, #130d2e 0%, var(--surface) 100%)" }}>
          <p className="text-sm mb-2" style={{ color: "var(--muted2)" }}>Prize pool</p>
          <p className="text-4xl sm:text-5xl font-bold font-num gradient-text">
            {campaign.prizeEth} STT
          </p>
          <p className="text-sm mt-2" style={{ color: "var(--muted2)" }}>
            {campaign.numWinners} winner{campaign.numWinners > 1 ? "s" : ""} · {entryCount} entr{entryCount === 1 ? "y" : "ies"}
          </p>
        </div>

        {/* Countdown */}
        {!isEnded && (
          <div className="px-6 pb-5">
            <p className="text-xs text-center mb-3 uppercase tracking-widest"
              style={{ color: "var(--muted)" }}>
              {isOpen ? "Draw closes in" : "Round opens in"}
            </p>
            <div className="flex items-center justify-center gap-3 sm:gap-5">
              <CountBlock value={String(parts.h).padStart(2,"0")} label="hours" />
              <Divider />
              <CountBlock value={String(parts.m).padStart(2,"0")} label="min" />
              <Divider />
              <CountBlock value={String(parts.s).padStart(2,"0")} label="sec" />
            </div>
            {round?.drawTime > 0 && (
              <p className="text-xs text-center mt-4" style={{ color: "var(--muted)" }}>
                {isOpen ? "Draw" : "Opens"} at{" "}
                {new Date((isOpen ? round.drawTime : round.openTime) * 1000).toLocaleString()}
              </p>
            )}
          </div>
        )}
        {isEnded && (
          <div className="px-6 pb-6 text-center">
            <p style={{ color: "var(--muted2)" }}>This round has ended.</p>
          </div>
        )}
      </div>

      {/* Enter button */}
      {isOpen && (
        <div className="space-y-3">
          {isAdmin ? (
            <div className="w-full py-3 rounded-xl text-center font-semibold text-sm"
              style={{ background: "rgba(239,68,68,0.08)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
              ⛔ Admins cannot participate in their own raffle
            </div>
          ) : isSuccess || hasEntered ? (
            <div className="w-full py-3 rounded-xl text-center font-semibold"
              style={{ background: "var(--teal-dim)", color: "var(--teal)", border: "1px solid var(--teal)" }}>
              ✓ You are entered! Good luck 🎉
            </div>
          ) : (
            <button onClick={handleEnter} disabled={!address || isPending || isConfirming}
              className="w-full py-3 rounded-xl font-bold text-base transition-all"
              style={{
                background: !address ? "var(--surface2)" : (isPending||isConfirming) ? "var(--border)" : "var(--purple)",
                color: "#fff", border: !address ? "1px solid var(--border)" : "none",
                opacity: (isPending||isConfirming) ? 0.7 : 1,
              }}>
              {!address ? "Connect wallet to enter" : isPending ? "Confirm in wallet…" : isConfirming ? "Confirming…" :
               campaign.entryFee > 0n ? `Enter — ${formatEther(campaign.entryFee)} STT` : "Enter Free"}
            </button>
          )}
          {txHash && !isSuccess && (
            <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
              Tx: <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer"
                className="underline" style={{ color: "var(--purple)" }}>{short(txHash)}</a>
            </p>
          )}
          {writeError && <p className="text-sm text-center" style={{ color: "var(--red)" }}>{writeError}</p>}
        </div>
      )}

      {/* Personal result banner */}
      {round?.statusName === "COMPLETE" && address && iEntered && (
        <div className="rounded-2xl p-5 text-center"
          style={{ background: iWon ? "rgba(16,185,129,0.1)" : "rgba(113,113,122,0.1)", border: `2px solid ${iWon ? "var(--teal)" : "var(--border2)"}` }}>
          {iWon ? (
            <><div className="text-4xl mb-2">🎉</div>
            <p className="text-xl font-bold" style={{ color: "var(--teal)" }}>You won!</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>Your prize was sent in the same block as the draw.</p></>
          ) : (
            <><div className="text-4xl mb-2">🤞</div>
            <p className="text-xl font-bold" style={{ color: "var(--muted2)" }}>Better luck next time!</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>You entered but didn't win this round.</p></>
          )}
        </div>
      )}

      {/* Winners */}
      {round?.statusName === "COMPLETE" && winners && winners.length > 0 && (
        <div className="rounded-2xl p-5 space-y-4"
          style={{ background: "var(--surface)", border: "1px solid var(--amber)" }}>
          <h3 className="font-bold text-lg" style={{ color: "var(--amber)" }}>🏆 Winners</h3>
          <div className="space-y-3">
            {winners.map((w, i) => {
              const isMe = w.toLowerCase() === address?.toLowerCase();
              return (
                <div key={w} className="flex items-center justify-between gap-4 p-3 rounded-xl"
                  style={{ background: isMe ? "rgba(16,185,129,0.1)" : "var(--surface2)", border: isMe ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{["🥇","🥈","🥉"][i]||"🏅"}</span>
                    <div>
                      <a href={`${EXPLORER}/address/${w}`} target="_blank" rel="noreferrer"
                        className="font-mono text-sm hover:underline" style={{ color: isMe ? "var(--teal)" : "var(--text)" }}>
                        {short(w)}
                      </a>
                      {isMe && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>That's you! 🎉</p>}
                    </div>
                  </div>
                  <span className="font-bold font-num" style={{ color: "var(--amber)" }}>
                    {parseFloat(formatEther(getPrize(i))).toFixed(2)} STT
                  </span>
                </div>
              );
            })}
          </div>
          <a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}?tab=logs`} target="_blank" rel="noreferrer"
            className="text-xs" style={{ color: "var(--muted2)" }}>Verify on-chain →</a>
        </div>
      )}

      {/* Past rounds */}
      <PastRounds campaign={campaign} currentRoundId={Number(round?.id || 0)} />

      </div>{/* end left */}

      {/* ── RIGHT — Entrants ── */}
      <div>
        {entryCount > 0 ? (
          <EntrantsList entrants={entrants || []} address={address} isSuccess={isSuccess} />
        ) : (
          <div className="rounded-2xl p-8 text-center"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="text-4xl mb-3">🎟️</div>
            <p className="font-semibold">No entries yet</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              {isOpen ? "Be the first to enter!" : "Entries open when the round starts."}
            </p>
          </div>
        )}
      </div>{/* end right */}

      </div>{/* end grid */}
    </div>
  );
}