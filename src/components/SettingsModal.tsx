/**
 * SettingsModal.tsx
 * API-Key und Modell konfigurieren. Einstellungen werden im localStorage gespeichert.
 */

import { useState } from "react";
import { X, Key, Cpu, Eye, EyeOff, ExternalLink } from "lucide-react";
import {
  getApiKey, saveApiKey,
  getModel,  saveModel,
  DEFAULT_MODEL,
} from "../lib/claudeParser";

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5  ⚡ schnellste / günstigste (empfohlen)" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6  — höhere Genauigkeit, langsamer" },
  { id: "claude-opus-4-6",           label: "Claude Opus 4.6    — maximale Genauigkeit, sehr langsam" },
];

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [key,     setKey]     = useState(getApiKey());
  const [model,   setModel]   = useState(getModel() || DEFAULT_MODEL);
  const [showKey, setShowKey] = useState(false);
  const [saved,   setSaved]   = useState(false);

  function handleSave() {
    saveApiKey(key);
    saveModel(model);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: "white" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold" style={{ color: "#1e293b" }}>
            Einstellungen
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100">
            <X size={18} color="#64748b" />
          </button>
        </div>

        {/* API Key */}
        <div className="mb-5">
          <label className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: "#374151" }}>
            <Key size={14} />
            Anthropic API-Key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full rounded-xl px-3 py-2.5 pr-10 text-sm border focus:outline-none focus:ring-2"
              style={{
                borderColor: "#e2e8f0",
                background: "#f8fafc",
                fontFamily: "monospace",
              }}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              {showKey
                ? <EyeOff size={15} color="#94a3b8" />
                : <Eye    size={15} color="#94a3b8" />}
            </button>
          </div>
          <a
            href="https://console.anthropic.com/account/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs"
            style={{ color: "#3b82f6" }}
          >
            <ExternalLink size={11} />
            API-Key bei Anthropic erstellen
          </a>
          <p className="mt-1 text-xs" style={{ color: "#94a3b8" }}>
            Der Key wird nur lokal im Browser gespeichert und nirgends übermittelt.
          </p>
        </div>

        {/* Model */}
        <div className="mb-6">
          <label className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: "#374151" }}>
            <Cpu size={14} />
            KI-Modell
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none focus:ring-2"
            style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!key.startsWith("sk-")}
          className="w-full py-2.5 rounded-xl font-semibold text-sm transition-colors"
          style={{
            background: saved ? "#16a34a" : key.startsWith("sk-") ? "#2d2d2d" : "#e2e8f0",
            color:      saved || key.startsWith("sk-") ? "white" : "#94a3b8",
          }}
        >
          {saved ? "✓ Gespeichert" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
