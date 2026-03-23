// src/hooks/useCampaign.js
// Reads campaign + round data from the contract. Polls every 5 seconds
// to stay fresh — round status changes when _onEvent fires.

import { useState, useEffect, useCallback } from "react";
import { publicClient, CONTRACT_ADDRESS }  from "../chain.js";
import { RAFFLE_ABI, ROUND_STATUS }        from "../abi.js";
import { formatEther }                     from "viem";

export function useCampaign(campaignId) {
  const [campaign,  setCampaign]  = useState(null);
  const [round,     setRound]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetch = useCallback(async () => {
    if (!campaignId) return;
    try {
      const [c, r] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
          functionName: "getCampaign",
          args: [BigInt(campaignId)],
        }),
        publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
          functionName: "getCurrentRound",
          args: [BigInt(campaignId)],
        }),
      ]);

      setCampaign({
        ...c,
        prizeEth:     formatEther(c.prizePerWinner),
        totalPoolEth: formatEther(c.totalPool),
        remainingEth: formatEther(c.remainingPool),
      });

      setRound({
        ...r,
        poolEth:    formatEther(r.pool),
        statusName: ROUND_STATUS[Number(r.status)] || "UNKNOWN",
        openTime:   Number(r.openTime),
        drawTime:   Number(r.drawTime),
      });

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 5_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { campaign, round, loading, error, refetch: fetch };
}


export function useAllCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const count = await publicClient.readContract({
          address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
          functionName: "getCampaignCount",
        });

        const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

        const results = await Promise.all(
          ids.map((id) =>
            publicClient.readContract({
              address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
              functionName: "getCampaign", args: [id],
            })
          )
        );

        setCampaigns(
          results
            .filter((c) => !c.cancelled)
            .map((c) => ({
              ...c,
              prizeEth:     formatEther(c.prizePerWinner),
              remainingEth: formatEther(c.remainingPool),
            }))
        );
      } catch (err) {
        console.error("useAllCampaigns:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { campaigns, loading };
}