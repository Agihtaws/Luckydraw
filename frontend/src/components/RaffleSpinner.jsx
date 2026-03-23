// src/components/RaffleSpinner.jsx
// Slot machine style — starts FAST, decelerates, locks on winner.

import React, { useEffect, useRef, useState, useCallback } from "react";

function short(addr) {
  return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : "";
}

const VISIBLE = 5;
const ITEM_H  = 56;
const FULL_SPEED = ITEM_H * 0.9; // fast starting speed

export default function RaffleSpinner({ entrants = [], winner = null, isSpinning = false }) {
  const rafRef    = useRef(null);
  const stateRef  = useRef({ speed: FULL_SPEED, pos: ITEM_H * 5, decelerating: false, locked: false });
  const [displayPos, setDisplayPos] = useState(ITEM_H * 5);
  const [locked,     setLocked]     = useState(false);
  const [flash,      setFlash]      = useState(false);

  const items = entrants.length > 0
    ? Array.from({ length: 80 }, (_, i) => entrants[i % entrants.length])
    : [];

  const getWinnerIndex = useCallback(() => {
    if (!winner || entrants.length === 0) return 40;
    const baseIdx = entrants.findIndex(a => a.toLowerCase() === winner.toLowerCase());
    if (baseIdx === -1) return 40;
    const repeat = Math.floor(50 / entrants.length);
    return repeat * entrants.length + baseIdx;
  }, [winner, entrants]);

  useEffect(() => {
    if (!isSpinning || items.length === 0) return;

    const s = stateRef.current;
    s.speed       = FULL_SPEED; // start at full speed immediately
    s.pos         = ITEM_H * 5;
    s.decelerating = false;
    s.locked      = false;
    setLocked(false);
    setFlash(false);

    const loop = () => {
      const s = stateRef.current;
      if (s.locked) return;

      if (!s.decelerating) {
        // Spinning fast — keep going, wrap around
        s.pos += s.speed;
        const maxPos = (items.length - VISIBLE) * ITEM_H;
        if (s.pos > maxPos * 0.7) s.pos = ITEM_H * 8;

      } else {
        // Decelerating toward winner position
        const winnerPos = getWinnerIndex() * ITEM_H - Math.floor(VISIBLE / 2) * ITEM_H;
        const remaining = winnerPos - s.pos;

        // Slow down gradually
        s.speed = Math.max(s.speed * 0.96, 0.5);

        if (Math.abs(remaining) < 3 || (s.speed < 1 && Math.abs(remaining) < ITEM_H)) {
          // Snap to winner
          s.pos    = winnerPos;
          s.speed  = 0;
          s.locked = true;
          setLocked(true);
          setDisplayPos(winnerPos);
          setFlash(true);
          setTimeout(() => setFlash(false), 700);
          return;
        }

        // Move toward winner — ease in
        if (Math.abs(remaining) > ITEM_H * 3) {
          s.pos += remaining * 0.04; // big jumps when far
        } else {
          s.pos += remaining * 0.08; // fine control when close
        }
      }

      setDisplayPos(s.pos);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isSpinning, items.length]);

  // Trigger deceleration the moment winner is known
  useEffect(() => {
    if (winner && isSpinning && !stateRef.current.locked) {
      stateRef.current.decelerating = true;
    }
  }, [winner, isSpinning]);

  if (items.length === 0) return null;

  return (
    <div className="w-full rounded-2xl overflow-hidden"
      style={{
        background:  "var(--surface2)",
        border:      `2px solid ${flash ? "var(--amber)" : locked && winner ? "var(--teal)" : "var(--border)"}`,
        transition:  "border-color 0.4s",
        boxShadow:   flash
          ? "0 0 40px var(--amber), 0 0 80px #f59e0b33"
          : locked && winner
          ? "0 0 24px #10b98133"
          : "none",
      }}>

      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ background: locked ? "var(--teal)" : "var(--amber)" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: locked ? "var(--teal)" : "var(--amber)" }} />
          </span>
          <span className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: locked ? "var(--teal)" : "var(--amber)" }}>
            {locked ? "Winner selected!" : "Drawing…"}
          </span>
        </div>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {entrants.length} entrant{entrants.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Track */}
      <div className="relative overflow-hidden" style={{ height: VISIBLE * ITEM_H }}>

        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
          style={{ height: ITEM_H * 1.8,
                   background: "linear-gradient(to bottom, var(--surface2), transparent)" }} />

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
          style={{ height: ITEM_H * 1.8,
                   background: "linear-gradient(to top, var(--surface2), transparent)" }} />

        {/* Center highlight */}
        <div className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{
            top:          ITEM_H * Math.floor(VISIBLE / 2),
            height:       ITEM_H,
            background:   flash
              ? "rgba(245,158,11,0.18)"
              : locked && winner
              ? "rgba(16,185,129,0.12)"
              : "rgba(124,58,237,0.07)",
            borderTop:    `1px solid ${flash ? "var(--amber)" : locked && winner ? "var(--teal)" : "var(--purple)"}`,
            borderBottom: `1px solid ${flash ? "var(--amber)" : locked && winner ? "var(--teal)" : "var(--purple)"}`,
            transition:   "background 0.4s, border-color 0.4s",
          }} />

        {/* Scrolling items */}
        <div style={{ transform: `translateY(-${displayPos}px)`, willChange: "transform" }}>
          {items.map((addr, i) => {
            const isWinner = locked && winner &&
              addr.toLowerCase() === winner.toLowerCase() &&
              i === getWinnerIndex();
            return (
              <div key={i}
                className="flex items-center justify-center font-mono select-none"
                style={{
                  height:     ITEM_H,
                  color:      isWinner ? "var(--teal)" : "var(--muted2)",
                  fontWeight: isWinner ? 700 : 400,
                  fontSize:   isWinner ? "0.95rem" : "0.8rem",
                  transition: "color 0.3s, font-size 0.3s",
                }}>
                {isWinner ? `🏆  ${short(addr)}` : short(addr)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}