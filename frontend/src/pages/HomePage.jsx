// src/pages/HomePage.jsx
import React, { useState, useMemo } from "react";
import { useReadContracts }          from "wagmi";
import { formatEther }               from "viem";
import { CONTRACT_ADDRESS }          from "../config/wagmi.js";
import { RAFFLE_ABI, ROUND_STATUS }  from "../abi.js";
import CampaignCard                  from "../components/CampaignCard.jsx";
import { useCampaignCount }          from "../hooks/useRaffle.js";

const TABS = ["All", "Active", "Upcoming", "Ended"];

function StatBox({ label, value }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[80px]">
      <span className="text-2xl sm:text-3xl font-bold font-num gradient-text">{value}</span>
      <span className="text-xs sm:text-sm" style={{ color: "var(--muted2)" }}>{label}</span>
    </div>
  );
}

export default function HomePage({ onSelect }) {
  const [tab, setTab] = useState("All");
  const { data: count } = useCampaignCount();
  const total = count ? Number(count) : 0;

  // Fetch all campaigns
  const campaignContracts = useMemo(() =>
    Array.from({ length: total }, (_, i) => ({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "getCampaign", args: [BigInt(i + 1)],
    })), [total]
  );

  const { data: rawCampaigns, isLoading: loadingCampaigns } = useReadContracts({
    contracts: campaignContracts,
    query: { enabled: total > 0, refetchInterval: 10_000 },
  });

  const campaigns = useMemo(() =>
    (rawCampaigns || []).map(r => r.result).filter(Boolean).filter(c => !c.cancelled),
    [rawCampaigns]
  );

  // Fetch all current rounds in same batch
  const roundContracts = useMemo(() =>
    campaigns.map(c => ({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "getCurrentRound", args: [BigInt(c.id)],
    })), [campaigns]
  );

  const { data: rawRounds } = useReadContracts({
    contracts: roundContracts,
    query: { enabled: campaigns.length > 0, refetchInterval: 5_000 },
  });

  // Enrich with round status
  const enriched = useMemo(() =>
    campaigns.map((c, i) => {
      const round      = rawRounds?.[i]?.result;
      const statusNum  = round ? Number(round.status) : -1; // -1 = not loaded yet
      const statusName = statusNum >= 0 ? (ROUND_STATUS[statusNum] || "UPCOMING") : null;
      return {
        ...c,
        _statusName: statusName,
        _openTime:   round ? Number(round.openTime) : 0,
        _drawTime:   round ? Number(round.drawTime) : 0,
      };
    }),
    [campaigns, rawRounds]
  );

  // Filter + sort per tab — only run when rounds have loaded
  const displayed = useMemo(() => {
    // If rounds not loaded yet, return empty to avoid flicker/duplicates
    if (enriched.some(c => c._statusName === null)) return [];

    const active   = enriched.filter(c => c._statusName === "OPEN")
      .sort((a, b) => a._drawTime - b._drawTime);          // ending soonest first

    const upcoming = enriched.filter(c => c._statusName === "UPCOMING")
      .sort((a, b) => a._openTime - b._openTime);          // opening soonest first

    const ended    = enriched.filter(c =>
      ["COMPLETE","ROLLEDOVER","CANCELLED"].includes(c._statusName)
    ).sort((a, b) => Number(b.id) - Number(a.id));         // newest id first

    if (tab === "All")      return [...active, ...upcoming, ...ended];
    if (tab === "Active")   return active;
    if (tab === "Upcoming") return upcoming;
    if (tab === "Ended")    return ended;
    return enriched;
  }, [enriched, tab]);

  // Stats
  const activeCount  = enriched.filter(c => c._statusName === "OPEN").length;
  const totalDistrib = campaigns.reduce((s, c) => s + (c.totalDistributed || 0n), 0n);
  const paidOut      = totalDistrib > 0n ? parseFloat(formatEther(totalDistrib)).toFixed(1) : "0";

  const isLoading = loadingCampaigns || (campaigns.length > 0 && enriched.some(c => c._statusName === null));

  const emptyMsg = {
    All:      { icon: "🎟️", text: "No raffles yet", sub: "Create the first one from Admin." },
    Active:   { icon: "⚡", text: "No active raffles",   sub: "Check back soon." },
    Upcoming: { icon: "⏳", text: "No upcoming raffles", sub: "Check back soon." },
    Ended:    { icon: "📜", text: "No completed raffles", sub: "Completed raffles appear here." },
  };

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #09090b 0%, #130d2e 55%, #09090b 100%)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, #7C3AED15 0%, transparent 65%)" }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-5"
            style={{ background: "var(--purple-dim)", color: "var(--purple)", border: "1px solid #7C3AED44" }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: "var(--purple)" }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--purple)" }} />
            </span>
            Powered by Somnia Reactivity
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <div className="max-w-xl">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-3"
                style={{ fontFamily: "'Syne', sans-serif" }}>
                Instant Raffles.<br />
                <span className="gradient-text">Same-block prizes.</span>
              </h1>
              <p className="text-sm sm:text-base" style={{ color: "var(--muted2)" }}>
                Enter. Win. Done — in the same block as the draw.
                Every prize is provably fair and verifiable on-chain.
              </p>
            </div>

            <div className="flex items-center gap-6 sm:gap-10 flex-wrap">
              <StatBox label="Campaigns"    value={total} />
              <div style={{ width:1, height:32, background:"var(--border)" }} className="hidden sm:block" />
              <StatBox label="Active now"   value={activeCount} />
              <div style={{ width:1, height:32, background:"var(--border)" }} className="hidden sm:block" />
              <StatBox label="STT paid out" value={paidOut} />
            </div>
          </div>
        </div>
      </div>

      {/* Campaign list */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 p-1 rounded-xl w-fit overflow-x-auto"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap"
              style={{
                background: tab === t ? "var(--purple)" : "transparent",
                color:      tab === t ? "#fff"           : "var(--muted2)",
              }}>
              {t}
            </button>
          ))}
        </div>

        {/* Skeleton */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-52 rounded-2xl animate-pulse"
                style={{ background: "var(--surface)" }} />
            ))}
          </div>

        /* Empty state */
        ) : displayed.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">{emptyMsg[tab].icon}</div>
            <p className="text-lg font-semibold">{emptyMsg[tab].text}</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>{emptyMsg[tab].sub}</p>
          </div>

        /* Grid */
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map(c => (
              <CampaignCard key={c.id.toString()} campaign={c}
                onClick={() => onSelect(c.id.toString())} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}