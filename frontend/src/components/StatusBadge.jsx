// src/components/StatusBadge.jsx
import React from "react";

const STATUS_MAP = {
  UPCOMING:   { label: "Upcoming",  color: "#3b82f6", bg: "#3b82f622" },
  OPEN:       { label: "Active",    color: "#10b981", bg: "#10b98122" },
  DRAWING:    { label: "Drawing",   color: "#f59e0b", bg: "#f59e0b22" },
  COMPLETE:   { label: "Ended",     color: "#71717a", bg: "#71717a22" },
  ROLLEDOVER: { label: "Rolled",    color: "#f59e0b", bg: "#f59e0b22" },
  CANCELLED:  { label: "Cancelled", color: "#ef4444", bg: "#ef444422" },
};

// Live pulse dot for OPEN status
function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2 mr-1.5">
      <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
        style={{ background: "#10b981" }} />
      <span className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: "#10b981" }} />
    </span>
  );
}

export default function StatusBadge({ statusName, size = "sm" }) {
  const s = STATUS_MAP[statusName] || STATUS_MAP.UPCOMING;
  const px = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";

  return (
    <span className={`inline-flex items-center ${px} rounded-full font-semibold`}
      style={{ background: s.bg, color: s.color }}>
      {statusName === "OPEN" && <LiveDot />}
      {s.label}
    </span>
  );
}