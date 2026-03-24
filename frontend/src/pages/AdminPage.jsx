import React, { useState }      from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseEther, formatEther, decodeEventLog } from "viem";
import { CONTRACT_ADDRESS, DEPLOYER_ADDRESS, EXPLORER } from "../config/wagmi.js";
import { RAFFLE_ABI }            from "../abi.js";

// ─────────────────────────────────────────────────────────────
// Schedule options (label → seconds)
// ─────────────────────────────────────────────────────────────

const SCHEDULES = [
  { label: "One-time",      secs: 0       },
  { label: "Every 10 min",  secs: 600     },
  { label: "Every 30 min",  secs: 1800    },
  { label: "Hourly",        secs: 3600    },
  { label: "Every 6 hours", secs: 21600   },
  { label: "Daily",         secs: 86400   },
  { label: "Every 3 days",  secs: 259200  },
  { label: "Weekly",        secs: 604800  },
];

const OPEN_IN = [
  { label: "In 1 minute",   ms: 60_000       },
  { label: "In 5 minutes",  ms: 300_000      },
  { label: "In 30 minutes", ms: 1_800_000    },
  { label: "In 1 hour",     ms: 3_600_000    },
  { label: "In 6 hours",    ms: 21_600_000   },
  { label: "Tomorrow",      ms: 86_400_000   },
  { label: "In 2 days",     ms: 172_800_000  },
  { label: "In 1 week",     ms: 604_800_000  },
];

// ─────────────────────────────────────────────────────────────
// Shared UI primitives — styled to match CampaignPage/HistoryPage
// ─────────────────────────────────────────────────────────────

/**
 * Section card — header row with border-bottom (mirrors CampaignPage card pattern)
 */
function Section({ title, icon, children }) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>

      {/* Card header — same px-5 py-4 + borderBottom as CampaignPage */}
      <div className="px-5 py-4 flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
        {icon && <span className="text-base">{icon}</span>}
        <h2 className="font-semibold text-sm" style={{ color: "var(--muted2)" }}>{title}</h2>
      </div>

      {/* Card body */}
      <div className="px-5 py-5 space-y-5">
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs" style={{ color: "var(--muted)" }}>{hint}</p>}
    </div>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors focus:ring-2";
const inputStyle = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

function Input({ value, onChange, type = "text", min, max, step, placeholder }) {
  return (
    <input type={type} value={value} onChange={onChange}
      min={min} max={max} step={step} placeholder={placeholder}
      className={inputCls} style={inputStyle} />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={onChange} className={inputCls} style={inputStyle}>
      {options.map((o, i) => (
        <option key={i} value={i}>{o.label}</option>
      ))}
    </select>
  );
}

/** Inline summary row — matches the "flex justify-between" pattern from CampaignPage winners card */
function SummaryRow({ label, value, valueStyle }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span style={{ color: "var(--muted2)" }}>{label}</span>
      <span className="font-semibold font-num" style={valueStyle}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Webhook settings
// ─────────────────────────────────────────────────────────────

const API    = import.meta.env.VITE_BACKEND_URL    || "https://luckydraw-yi25.onrender.com";
const SECRET = import.meta.env.VITE_BACKEND_SECRET || "";

function apiHeaders() {
  const h = { "Content-Type": "application/json" };
  if (SECRET) h["Authorization"] = `Bearer ${SECRET}`;
  return h;
}

function WebhookSettings() {
  const [url,     setUrl]     = useState("");
  const [current, setCurrent] = useState("");
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [result,  setResult]  = useState(null);

  React.useEffect(() => {
    fetch(`${API}/api/webhook`, { headers: apiHeaders() })
      .then(r => r.json())
      .then(d => { if (d.maskedUrl) setCurrent(d.maskedUrl); })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!url.trim()) return;
    setSaving(true); setResult(null);
    try {
      const res  = await fetch(`${API}/api/webhook`, {
        method: "POST", headers: apiHeaders(),
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (res.ok) { setCurrent(data.maskedUrl); setUrl(""); setResult({ ok: true,  message: "Webhook saved ✓" }); }
      else        { setResult({ ok: false, message: data.error || "Failed to save" }); }
    } catch { setResult({ ok: false, message: "Cannot reach backend — is it running?" }); }
    finally { setSaving(false); setTimeout(() => setResult(null), 4000); }
  };

  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const res  = await fetch(`${API}/api/webhook/test`, { method: "POST", headers: apiHeaders() });
      const data = await res.json();
      setResult(res.ok ? { ok: true, message: "Test message sent ✓" } : { ok: false, message: data.error });
    } catch { setResult({ ok: false, message: "Cannot reach backend" }); }
    finally { setTesting(false); setTimeout(() => setResult(null), 4000); }
  };

  const clear = async () => {
    try {
      await fetch(`${API}/api/webhook`, { method: "DELETE", headers: apiHeaders() });
      setCurrent(""); setResult({ ok: true, message: "Webhook cleared" });
      setTimeout(() => setResult(null), 3000);
    } catch {}
  };

  return (
    <Section title="Discord Announcements" icon="🔔">

      {/* Current webhook status row — mirrors EntrantsList header row style */}
      <div className="rounded-xl p-4 flex items-center justify-between gap-3"
        style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
        <div className="min-w-0">
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>
            Current webhook (backend)
          </p>
          <p className="text-sm font-mono truncate">
            {current
              ? <span style={{ color: "var(--text)" }}>{current}</span>
              : <span style={{ color: "var(--muted)" }}>Not configured</span>}
          </p>
        </div>
        {current && (
          <button onClick={clear}
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
            style={{ color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)" }}>
            Clear
          </button>
        )}
      </div>

      <Field label="New Webhook URL"
        hint="Discord channel → Edit Channel → Integrations → Webhooks → Copy URL">
        <Input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..." />
      </Field>

      <div className="flex gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !url.trim()}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: "var(--purple)", color: "#fff", opacity: saving || !url.trim() ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save to backend"}
        </button>
        <button onClick={test} disabled={testing || !current}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: "var(--surface2)", color: "var(--muted2)", border: "1px solid var(--border)", opacity: testing || !current ? 0.6 : 1 }}>
          {testing ? "Testing…" : "Test webhook"}
        </button>
      </div>

      {result && (
        <p className="text-sm font-medium" style={{ color: result.ok ? "var(--teal)" : "var(--red)" }}>
          {result.message}
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Stored in the backend server — persists across restarts. Discord messages post 24/7.
      </p>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// Helper: extract campaignId from receipt logs
// ─────────────────────────────────────────────────────────────

function extractCampaignId(receipt, abi) {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi, eventName: "CampaignCreated", topics: log.topics, data: log.data, strict: false });
      if (decoded?.args?.campaignId !== undefined) return decoded.args.campaignId.toString();
    } catch { /* not this log */ }
  }
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: false });
      if (decoded?.eventName === "CampaignCreated" && decoded?.args?.campaignId !== undefined)
        return decoded.args.campaignId.toString();
    } catch { /* skip */ }
  }
  for (const log of receipt.logs) {
    if (log.address?.toLowerCase() !== CONTRACT_ADDRESS?.toLowerCase()) continue;
    if (log.topics?.length >= 2) {
      try { return BigInt(log.topics[1]).toString(); } catch { /* skip */ }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Create Campaign
// ─────────────────────────────────────────────────────────────

function CreateCampaignForm({ navigate }) {
  const [form, setForm] = useState({
    prize: "5", numWinners: "1", entryFee: "0",
    windowMins: "5", scheduleIdx: "5", openIdx: "0",
    prizeMode: "0", cooldown: false,
    rounds: "1",
  });

  const [resolvedId, setResolvedId] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { writeContract, data: txHash, isPending, error: writeErr } = useWriteContract();
  const { isLoading: confirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  React.useEffect(() => {
    if (!isSuccess || !receipt) return;
    const campaignId = extractCampaignId(receipt, RAFFLE_ABI);
    if (campaignId) {
      setResolvedId(campaignId);
      setTimeout(() => {
        if (typeof navigate === "function") {
          navigate(`/campaign/${campaignId}`);
        } else {
          window.history.pushState({}, "", `/campaign/${campaignId}`);
          window.dispatchEvent(new Event("popstate"));
        }
      }, 100);
    }
  }, [isSuccess, receipt]);

  const totalPool = () => {
    try {
      return (parseFloat(form.prize || 0) * parseInt(form.numWinners || 1) * parseInt(form.rounds || 1)).toFixed(4);
    } catch { return "0"; }
  };

  const submit = () => {
    const prizeWei   = parseEther(form.prize);
    const feeWei     = parseEther(form.entryFee || "0");
    const windowSecs = Number(form.windowMins) * 60;
    const sched      = SCHEDULES[Number(form.scheduleIdx)];
    const openMs     = OPEN_IN[Number(form.openIdx)].ms;
    const repeatSecs = sched.secs === 0 ? windowSecs + 60 : Math.max(sched.secs, windowSecs + 60);
    const rounds     = Math.max(1, parseInt(form.rounds || 1));
    writeContract({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "createCampaign",
      args: [Number(form.numWinners), prizeWei, feeWei, BigInt(windowSecs), BigInt(repeatSecs), Number(form.prizeMode), form.cooldown, BigInt(openMs)],
      value: prizeWei * BigInt(form.numWinners) * BigInt(rounds),
    });
  };

  const errMsg = writeErr?.shortMessage || writeErr?.message;

  return (
    <Section title="Create Campaign" icon="🎟️">

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Prize per winner (STT)">
          <Input type="number" min="0" step="0.1" value={form.prize}
            onChange={e => set("prize", e.target.value)} />
        </Field>
        <Field label="Winners per round" hint="Max 10">
          <Input type="number" min="1" max="10" value={form.numWinners}
            onChange={e => set("numWinners", e.target.value)} />
        </Field>
        <Field label="Entry window" hint="How long entries are open">
          <Input type="number" min="1" value={form.windowMins}
            onChange={e => set("windowMins", e.target.value)} placeholder="minutes" />
        </Field>
        <Field label="Entry fee (STT)" hint="0 = free entry">
          <Input type="number" min="0" step="0.01" value={form.entryFee}
            onChange={e => set("entryFee", e.target.value)} />
        </Field>
        <Field label="First round opens">
          <Select value={form.openIdx} onChange={e => set("openIdx", e.target.value)} options={OPEN_IN} />
        </Field>
        <Field label="Schedule (repeats)">
          <Select value={form.scheduleIdx} onChange={e => set("scheduleIdx", e.target.value)} options={SCHEDULES} />
        </Field>
        <Field label="Number of rounds to fund"
          hint={`Funds ${form.rounds || 1} round${form.rounds > 1 ? "s" : ""} upfront. Add more anytime via Top Up.`}>
          <Input type="number" min="1" max="100" value={form.rounds}
            onChange={e => set("rounds", e.target.value)} placeholder="e.g. 10" />
        </Field>
      </div>

      <Field label="Prize distribution">
        <div className="flex gap-6 flex-wrap">
          {[["0","Equal split"],["1","Tiered (1st gets more)"]].map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="radio" name="pm" value={val}
                checked={form.prizeMode === val} onChange={() => set("prizeMode", val)} />
              {label}
            </label>
          ))}
        </div>
      </Field>

      <label className="flex items-center gap-3 cursor-pointer text-sm">
        <input type="checkbox" checked={form.cooldown}
          onChange={e => set("cooldown", e.target.checked)} />
        Previous winner cannot win again next round
      </label>

      {/* Summary — mirrors the prize/stats card from CampaignPage */}
      <div className="rounded-xl overflow-hidden"
        style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Summary
          </p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <SummaryRow label="Total STT to lock" value={`${totalPool()} STT`} valueStyle={{ color: "var(--amber)" }} />
          <SummaryRow label="Rounds funded" value={`${form.rounds || 1} round${form.rounds > 1 ? "s" : ""}`} />
          <SummaryRow label="Schedule" value={SCHEDULES[Number(form.scheduleIdx)]?.label} />
          <SummaryRow label="Opens" value={OPEN_IN[Number(form.openIdx)]?.label} />
        </div>
      </div>

      <button onClick={submit} disabled={isPending || confirming}
        className="w-full py-4 rounded-2xl font-bold text-lg transition-all"
        style={{
          background: isPending || confirming ? "var(--border)" : "var(--purple)",
          color: "#fff", opacity: isPending || confirming ? 0.7 : 1,
        }}>
        {isPending ? "Confirm in wallet…" : confirming ? "Creating…" : `Create & fund ${totalPool()} STT`}
      </button>

      {errMsg && <p className="text-sm text-center" style={{ color: "var(--red)" }}>{errMsg}</p>}

      {isSuccess && txHash && (
        <div className="text-center">
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer"
            className="text-xs underline" style={{ color: "var(--muted2)" }}>
            View transaction →
          </a>
        </div>
      )}

      {/* Success banner — mirrors the "You won!" banner from CampaignPage */}
      {resolvedId && (
        <div className="rounded-2xl p-5 text-center"
          style={{ background: "rgba(16,185,129,0.1)", border: "2px solid var(--teal)" }}>
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-lg font-bold" style={{ color: "var(--teal)" }}>
            Campaign #{resolvedId} created!
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--muted2)" }}>
            Redirecting… if nothing happens,{" "}
            <button
              onClick={() => {
                if (typeof navigate === "function") {
                  navigate(`/campaign/${resolvedId}`);
                } else {
                  window.history.pushState({}, "", `/campaign/${resolvedId}`);
                  window.dispatchEvent(new Event("popstate"));
                }
              }}
              className="underline font-semibold"
              style={{ color: "var(--purple)", background: "none", border: "none", cursor: "pointer" }}>
              click here
            </button>
            {" "}to go to Campaign #{resolvedId}.
          </p>
        </div>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// Top Up Pool
// ─────────────────────────────────────────────────────────────

function TopUpPool() {
  const [topUpId,     setTopUpId]     = useState("");
  const [extraRounds, setExtraRounds] = useState("5");

  const { writeContract, data: txHash, isPending, error: writeErr } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const validId = topUpId && !isNaN(Number(topUpId)) && Number(topUpId) > 0;
  const { data: campaign, refetch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCampaign",
    args: validId ? [BigInt(topUpId)] : [1n],
    query: { enabled: validId },
  });

  React.useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess]);

  const topUpAmount = () => {
    if (!campaign || !extraRounds) return "0";
    try {
      const perRound = campaign.prizePerWinner * BigInt(campaign.numWinners);
      return formatEther(perRound * BigInt(parseInt(extraRounds) || 1));
    } catch { return "0"; }
  };

  const handleTopUp = () => {
    if (!campaign || !validId) return;
    const perRound = campaign.prizePerWinner * BigInt(campaign.numWinners);
    const value    = perRound * BigInt(parseInt(extraRounds) || 1);
    writeContract({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "topUpPool",
      args:  [BigInt(topUpId)],
      value,
    });
  };

  const errMsg  = writeErr?.shortMessage || writeErr?.message;
  const canTopUp = campaign && !campaign.cancelled && validId;

  const poolStatus = campaign
    ? campaign.cancelled ? { label: "Cancelled", color: "var(--red)" }
    : campaign.remainingPool > 0n ? { label: "Active", color: "var(--teal)" }
    : { label: "Depleted", color: "var(--muted)" }
    : null;

  return (
    <Section title="Top Up Pool" icon="⛽">
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Add more rounds to a running campaign. The raffle continues automatically after the current pool runs out.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Campaign ID" hint="Find it in the URL — /campaign/13">
          <Input type="number" min="1" value={topUpId}
            onChange={e => setTopUpId(e.target.value)} placeholder="e.g. 13" />
        </Field>
        <Field label="Extra rounds to fund" hint="How many more rounds to add">
          <Input type="number" min="1" max="100" value={extraRounds}
            onChange={e => setExtraRounds(e.target.value)} placeholder="e.g. 5" />
        </Field>
      </div>

      {campaign && validId && (
        <div className="rounded-xl overflow-hidden"
          style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
          <div className="px-4 py-2.5 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Campaign #{topUpId}
            </span>
            {poolStatus && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  color: poolStatus.color,
                  background: poolStatus.color === "var(--teal)"
                    ? "var(--teal-dim)"
                    : "rgba(113,113,122,0.15)",
                }}>
                {poolStatus.label}
              </span>
            )}
          </div>
          <div className="px-4 py-3 space-y-2">
            <SummaryRow label="Current pool" value={`${formatEther(campaign.remainingPool)} STT`} />
            <SummaryRow label="Prize per round" value={`${formatEther(campaign.prizePerWinner * BigInt(campaign.numWinners))} STT`} />
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
              <SummaryRow label="Top-up amount" value={`${topUpAmount()} STT`} valueStyle={{ color: "var(--amber)" }} />
            </div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              After top-up: ~{(parseFloat(formatEther(campaign.remainingPool)) + parseFloat(topUpAmount())).toFixed(4)} STT total
            </p>
          </div>
        </div>
      )}

      {canTopUp && (
        <button onClick={handleTopUp} disabled={isPending || confirming}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all"
          style={{ background: isPending || confirming ? "var(--border)" : "var(--teal)", color: "#fff", opacity: isPending || confirming ? 0.7 : 1 }}>
          {isPending ? "Confirm in wallet…" : confirming ? "Processing…" : `Top up ${topUpAmount()} STT (${extraRounds} rounds)`}
        </button>
      )}

      {errMsg && <p className="text-sm" style={{ color: "var(--red)" }}>{errMsg}</p>}
      {isSuccess && (
        <p className="text-sm font-semibold" style={{ color: "var(--teal)" }}>
          ✓ Pool topped up! Campaign will continue for {extraRounds} more round{extraRounds > 1 ? "s" : ""}.
        </p>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// Cancel Campaign
// ─────────────────────────────────────────────────────────────

function CancelCampaigns() {
  const [cancelId,      setCancelId]      = useState("");
  const [confirmingUI,  setConfirmingUI]  = useState(false);

  const { writeContract, data: cancelTxHash, isPending: isCancelling, error: cancelErr } = useWriteContract();
  const { isLoading: waitingCancel, isSuccess: cancelSuccess } = useWaitForTransactionReceipt({ hash: cancelTxHash });

  const validId = cancelId && !isNaN(Number(cancelId)) && Number(cancelId) > 0;
  const { data: campaign, refetch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
    functionName: "getCampaign",
    args: validId ? [BigInt(cancelId)] : [1n],
    query: { enabled: validId },
  });

  React.useEffect(() => {
    if (cancelSuccess) { setConfirmingUI(false); refetch(); }
  }, [cancelSuccess]);

  const handleCancel = () => {
    if (!cancelId) return;
    writeContract({
      address: CONTRACT_ADDRESS, abi: RAFFLE_ABI,
      functionName: "emergencyCancel",
      args: [BigInt(cancelId)],
    });
  };

  const isActive = campaign && !campaign.cancelled && campaign.remainingPool > 0n;

  return (
    <Section title="Stop a Campaign" icon="🛑">
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Emergency cancel stops all future rounds and refunds the remaining pool to your wallet.
      </p>

      <Field label="Campaign ID" hint="Find it in the URL — /campaign/13">
        <Input type="number" min="1" value={cancelId}
          onChange={e => { setCancelId(e.target.value); setConfirmingUI(false); }}
          placeholder="e.g. 13" />
      </Field>

      {campaign && validId && (
        <div className="rounded-xl overflow-hidden"
          style={{ background: "var(--surface2)", border: `1px solid ${campaign.cancelled ? "var(--border)" : "rgba(239,68,68,0.3)"}` }}>
          <div className="px-4 py-2.5 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Campaign #{cancelId}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={campaign.cancelled
                ? { background: "var(--teal-dim)", color: "var(--teal)" }
                : isActive
                  ? { background: "rgba(239,68,68,0.12)", color: "var(--red)" }
                  : { background: "rgba(113,113,122,0.15)", color: "var(--muted)" }
              }>
              {campaign.cancelled ? "✓ Cancelled" : isActive ? "Active" : "Ended"}
            </span>
          </div>
          {!campaign.cancelled && (
            <div className="px-4 py-3 space-y-2">
              <SummaryRow label="Will refund" value={`${formatEther(campaign.remainingPool)} STT`} valueStyle={{ color: "var(--amber)" }} />
              <SummaryRow label="Rounds run" value={campaign.totalRoundsRun.toString()} />
            </div>
          )}
        </div>
      )}

      {campaign && !campaign.cancelled && isActive && !confirmingUI && (
        <button onClick={() => setConfirmingUI(true)}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-all"
          style={{ background: "rgba(239,68,68,0.08)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.4)" }}>
          Stop Campaign #{cancelId}
        </button>
      )}

      {/* Confirm prompt — mirrors the "Are you sure?" pattern */}
      {confirmingUI && (
        <div className="space-y-3">
          <div className="rounded-2xl p-5 text-center"
            style={{ background: "rgba(239,68,68,0.08)", border: "2px solid var(--red)" }}>
            <div className="text-3xl mb-2">⚠️</div>
            <p className="font-semibold mb-1" style={{ color: "var(--red)" }}>Are you sure?</p>
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              This refunds <strong>{campaign ? formatEther(campaign.remainingPool) : "?"} STT</strong> to your wallet and cannot be undone.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setConfirmingUI(false)}
              className="flex-1 py-3 rounded-xl font-semibold text-sm"
              style={{ background: "var(--surface2)", color: "var(--muted2)", border: "1px solid var(--border)" }}>
              Keep running
            </button>
            <button onClick={handleCancel} disabled={isCancelling || waitingCancel}
              className="flex-1 py-3 rounded-xl font-bold text-sm"
              style={{ background: "var(--red)", color: "#fff", opacity: isCancelling || waitingCancel ? 0.7 : 1 }}>
              {isCancelling ? "Confirm in wallet…" : waitingCancel ? "Cancelling…" : "Yes, stop it"}
            </button>
          </div>
        </div>
      )}

      {cancelErr && (
        <p className="text-sm" style={{ color: "var(--red)" }}>
          {cancelErr?.shortMessage || cancelErr?.message}
        </p>
      )}
      {cancelSuccess && (
        <p className="text-sm font-semibold" style={{ color: "var(--teal)" }}>
          ✓ Campaign #{cancelId} cancelled. Pool refunded to your wallet.
        </p>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// Main admin page (deployer-gated)
// ─────────────────────────────────────────────────────────────

export default function AdminPage({ navigate }) {
  const { address, isConnected } = useAccount();

  const isAdmin = isConnected && DEPLOYER_ADDRESS &&
    address?.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase();

  /* ── Not connected ── */
  if (!isConnected) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <div className="text-5xl">🔐</div>
      <h2 className="text-2xl font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>
        Connect your wallet
      </h2>
      <p style={{ color: "var(--muted2)" }}>Admin access requires wallet connection.</p>
    </div>
  );

  /* ── Wrong wallet ── */
  if (!isAdmin) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <div className="text-5xl">⛔</div>
      <h2 className="text-2xl font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>
        Access denied
      </h2>
      <p style={{ color: "var(--muted2)" }}>Only the contract deployer can access this page.</p>
      <p className="text-xs font-mono px-3 py-1.5 rounded-lg mt-2"
        style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)" }}>
        Connected: {address}
      </p>
    </div>
  );

  /* ── Admin panel ── */
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">

      {/* Page header — matches HistoryPage header pattern */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>
            Admin
          </h1>
          {/* Deployer badge — mirrors StatusBadge / campaign chip pattern */}
          <span className="text-xs px-2 py-1 rounded-full font-semibold"
            style={{ background: "var(--purple-dim)", color: "var(--purple)" }}>
            Deployer
          </span>
        </div>
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Manage campaigns, top up pools, and configure announcements.
        </p>
      </div>

      <WebhookSettings />
      <CreateCampaignForm navigate={navigate} />
      <TopUpPool />
      <CancelCampaigns />

    </div>
  );
}