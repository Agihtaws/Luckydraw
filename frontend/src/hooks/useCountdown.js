import { useState, useEffect } from "react";

export function useCountdown(targetUnixSecs) {
  const [diff, setDiff] = useState(0);

  useEffect(() => {
    if (!targetUnixSecs) return;
    const tick = () => setDiff(Math.max(0, targetUnixSecs - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetUnixSecs]);

  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const pad = (n) => String(n).padStart(2, "0");

  return {
    timeLeft: `${pad(h)}:${pad(m)}:${pad(s)}`,
    expired:  diff === 0,
    diff,
    parts: { h, m, s },
  };
}