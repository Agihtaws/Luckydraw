// src/hooks/useRaffle.js
// All contract reads using wagmi hooks (auto-refetch, caching built in)

import { useReadContract, useReadContracts } from "wagmi";
import { formatEther }                       from "viem";
import { CONTRACT_ADDRESS }                  from "../config/wagmi.js";
import { RAFFLE_ABI, ROUND_STATUS }          from "../abi.js";

// ── Campaign count ────────────────────────────────────────────
export function useCampaignCount() {
  return useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCampaignCount",
    query: { refetchInterval: 3_000 },
  });
}

// ── Single campaign + current round ──────────────────────────
export function useCampaign(campaignId) {
  const id = campaignId ? BigInt(campaignId) : undefined;

  const campaign = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCampaign",
    args: id ? [id] : undefined,
    query: { enabled: !!id, refetchInterval: 5_000 },
  });

  const round = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCurrentRound",
    args: id ? [id] : undefined,
    query: { enabled: !!id, refetchInterval: 3_000 },
  });

  const campaignData = campaign.data
    ? { ...campaign.data,
        prizeEth:     formatEther(campaign.data.prizePerWinner),
        totalPoolEth: formatEther(campaign.data.totalPool),
        remainingEth: formatEther(campaign.data.remainingPool),
      }
    : null;

  const roundData = round.data
    ? { ...round.data,
        poolEth:    formatEther(round.data.pool),
        statusName: ROUND_STATUS[Number(round.data.status)] || "UNKNOWN",
        openTime:   Number(round.data.openTime),
        drawTime:   Number(round.data.drawTime),
      }
    : null;

  return {
    campaign:  campaignData,
    round:     roundData,
    loading:   campaign.isLoading || round.isLoading,
    error:     campaign.error || round.error,
    refetch:   () => { campaign.refetch(); round.refetch(); },
  };
}

// ── Entrants for a round ──────────────────────────────────────
export function useEntrants(roundId) {
  return useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getEntrants",
    args: roundId ? [BigInt(roundId)] : undefined,
    query: { enabled: !!roundId, refetchInterval: 4_000 },
  });
}

// ── hasEntered for connected wallet ──────────────────────────
export function useHasEntered(roundId, address) {
  return useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "hasEntered",
    args: roundId && address ? [BigInt(roundId), address] : undefined,
    query: { enabled: !!(roundId && address), refetchInterval: 5_000 },
  });
}

// ── Winners for a round ───────────────────────────────────────
export function useWinners(roundId) {
  return useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getWinners",
    args: roundId ? [BigInt(roundId)] : undefined,
    query: { enabled: !!roundId },
  });
}