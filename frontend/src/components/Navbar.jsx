// src/components/Navbar.jsx
import React, { useState } from "react";
import { ConnectButton }    from "@rainbow-me/rainbowkit";
import { useAccount, useBalance } from "wagmi";
import { formatEther }      from "viem";
import { DEPLOYER_ADDRESS } from "../config/wagmi.js";

export default function Navbar({ page, navigate }) {
  const { address } = useAccount();
  const { data: bal } = useBalance({ address, query: { enabled: !!address } });
  const [open, setOpen] = useState(false);

  const isAdmin = address && DEPLOYER_ADDRESS &&
    address.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase();

  const go = (target) => { navigate(target); setOpen(false); };

  const NavLink = ({ target, label }) => (
    <button onClick={() => go(target)}
      className="text-sm font-medium transition-colors"
      style={{ color: page === target ? "var(--purple)" : "var(--muted2)" }}>
      {label}
    </button>
  );

  return (
    <>
      <nav className="sticky top-0 z-50 w-full"
        style={{ background: "rgba(9,9,11,0.92)", backdropFilter: "blur(16px)",
                 borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

          {/* Logo */}
          <button onClick={() => go("home")} className="shrink-0 select-none">
            <span className="text-xl sm:text-2xl font-black tracking-tight"
              style={{ fontFamily: "'Syne', sans-serif" }}>
              React<span className="gradient-text">Raffle</span>
            </span>
          </button>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6">
            <NavLink target="home"    label="Raffles" />
            <NavLink target="history" label="History" />
            {isAdmin && <NavLink target="admin" label="Admin" />}
          </div>

          {/* Right */}
          <div className="flex items-center gap-3">
            {address && (
              <div className="hidden sm:flex items-center gap-2">
                {isAdmin && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: "var(--purple-dim)", color: "var(--purple)" }}>
                    Admin
                  </span>
                )}
                {bal && (
                  <span className="text-sm font-medium font-num"
                    style={{ color: "var(--muted2)" }}>
                    {parseFloat(formatEther(bal.value)).toFixed(2)} STT
                  </span>
                )}
              </div>
            )}
            <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />

            {/* Hamburger — mobile only */}
            <button onClick={() => setOpen(true)}
              className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-1.5 rounded-lg transition-colors"
              style={{ background: open ? "var(--surface2)" : "transparent" }}
              aria-label="Menu">
              <span className="block w-5 h-0.5 rounded-full" style={{ background: "var(--muted2)" }} />
              <span className="block w-5 h-0.5 rounded-full" style={{ background: "var(--muted2)" }} />
              <span className="block w-3.5 h-0.5 rounded-full self-start ml-0.5" style={{ background: "var(--muted2)" }} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile sidebar overlay */}
      {open && (
        <div className="fixed inset-0 z-[100] md:hidden flex">
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={() => setOpen(false)} />

          {/* Drawer */}
          <div className="relative ml-auto h-full w-64 flex flex-col py-6 px-5"
            style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>

            {/* Close button */}
            <div className="flex items-center justify-between mb-8">
              <span className="text-lg font-black" style={{ fontFamily: "'Syne', sans-serif" }}>
                React<span className="gradient-text">Raffle</span>
              </span>
              <button onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg"
                style={{ background: "var(--surface2)", color: "var(--muted2)" }}>
                ✕
              </button>
            </div>

            {/* Links */}
            <nav className="flex flex-col gap-1">
              {[
                ["home",    "🎟️  Raffles"],
                ["history", "📜  History"],
                ...(isAdmin ? [["admin", "⚙️  Admin"]] : []),
              ].map(([target, label]) => (
                <button key={target} onClick={() => go(target)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-left transition-colors"
                  style={{
                    background: page === target ? "var(--purple-dim)" : "transparent",
                    color:      page === target ? "var(--purple)"     : "var(--muted2)",
                  }}>
                  {label}
                </button>
              ))}
            </nav>

            {/* Balance at bottom */}
            {address && bal && (
              <div className="mt-auto pt-6 border-t" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>Balance</p>
                <p className="font-semibold font-num">
                  {parseFloat(formatEther(bal.value)).toFixed(4)} STT
                </p>
                {isAdmin && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold mt-2 inline-block"
                    style={{ background: "var(--purple-dim)", color: "var(--purple)" }}>
                    Admin
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}