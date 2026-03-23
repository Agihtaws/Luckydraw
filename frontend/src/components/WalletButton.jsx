// src/components/WalletButton.jsx

import React from "react";
import { useWallet } from "../hooks/useWallet.js";

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

export default function WalletButton() {
  const { address, connecting, error, connect, disconnect } = useWallet();

  return (
    <div className="flex flex-col items-end gap-1">
      {address ? (
        <button
          onClick={disconnect}
          className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          {shortAddr(address)}
        </button>
      ) : (
        <button
          onClick={connect}
          disabled={connecting}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ background: "var(--purple)", color: "#fff", opacity: connecting ? 0.7 : 1 }}
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </button>
      )}
      {error && (
        <p className="text-xs" style={{ color: "#e24b4a" }}>{error}</p>
      )}
    </div>
  );
}