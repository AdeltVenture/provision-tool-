import { useState, useCallback, useRef, useEffect } from "react";
import {
  Settings, TrendingUp, TrendingDown, Minus,
  CheckCircle2, AlertTriangle, XCircle, Info, Download, ChevronDown,
  ChevronLeft, ChevronRight, BarChart3, AlertCircle, CircleDollarSign,
} from "lucide-react";

import SettingsModal from "./components/SettingsModal";
import DropZone, { type DropStatus } from "./components/DropZone";
import { extractPdfText } from "./lib/pdfExtractor";
import { parseCommissionPdf, getApiKey, type CommissionEntry } from "./lib/claudeParser";
import { parseExcel, exportWithPayments, type ExcelData } from "./lib/excelHandler";
import {
  reconcile, summarise,
  type MatchResult, type MatchStatus, type ControlFlag,
} from "./lib/matcher";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const eur = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const pct = (n: number) => `${(n * 100).toFixed(1)} %`;

const PAGE_SIZE = 100;

// ─── Status config ────────────────────────────────────────────────────────────

const MATCH_STATUS: Record<MatchStatus, { label: string; color: string; bg: string; border: string }> = {
  exact:           { label: "Abgeglichen",  color: "#15803d", bg: "#f0fdf4", border: "#86efac" },
  partial:         { label: "Kundennr.",    color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  unmatched_pdf:   { label: "Unbekannt",    color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  unmatched_excel: { label: "Ausstehend",   color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
};

const FLAG_CONFIG: Record<ControlFlag, { label: string; color: string; bg: string; icon: string } | null> = {
  ok:         null,
  overpaid:   { label: "Überzahlung",        color: "#b45309", bg: "#fff7ed", icon: "↑" },
  underpaid:  { label: "Teilzahlung",         color: "#7c3aed", bg: "#f5f3ff", icon: "↓" },
  unexpected: { label: "Ungeplant",           color: "#0369a1", bg: "#f0f9ff", icon: "?" },
  missing:    { label: "Keine Zahlung",       color: "#dc2626", bg: "#fef2f2", icon: "✕" },
};

type Filter = "all" | MatchStatus | ControlFlag;

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [showSettings, setShowSettings] = useState(!getApiKey());

  const [pdfStatus,    setPdfStatus]    = useState<DropStatus>("idle");
  const [pdfText,      setPdfText]      = useState("");
  const [pdfStatusTxt, setPdfStatusTxt] = useState("PDF ablegen oder klicken");
  const [pdfEntries,   setPdfEntries]   = useState<CommissionEntry[] | null>(null);
  const [showRaw,      setShowRaw]      = useState(false);

  const [xlsxStatus,    setXlsxStatus]    = useState<DropStatus>("idle");
  const [xlsxStatusTxt, setXlsxStatusTxt] = useState("Excel ablegen oder klicken");
  const [excelData,     setExcelData]     = useState<ExcelData | null>(null);

  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [filter,  setFilter]  = useState<Filter>("all");
  const [page,    setPage]    = useState(0);
  const [error,   setError]   = useState("");

  const pdfRef  = useRef<HTMLInputElement | null>(null);
  const xlsxRef = useRef<HTMLInputElement | null>(null);

  // Auto-reconcile when both datasets are ready
  useEffect(() => {
    if (pdfEntries && excelData) {
      setResults(reconcile(pdfEntries, excelData.records));
      setFilter("all");
      setPage(0);
    }
  }, [pdfEntries, excelData]);

  const handlePdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Bitte eine .pdf-Datei auswählen."); return;
    }
    if (!getApiKey()) { setShowSettings(true); return; }
    setError(""); setPdfStatus("loading"); setPdfStatusTxt("Text wird extrahiert…");
    setPdfEntries(null); setResults(null);
    try {
      const text = await extractPdfText(file);
      setPdfText(text); setPdfStatusTxt("KI analysiert Abrechnung…");
      const entries = await parseCommissionPdf(text, () => {});
      setPdfEntries(entries);
      setPdfStatus("done");
      setPdfStatusTxt(`${entries.length} Einträge erkannt`);
    } catch (err) {
      setPdfStatus("error"); setPdfStatusTxt("Analyse fehlgeschlagen");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleExcel = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|ods|csv)$/i)) {
      setError("Bitte eine Excel-Datei auswählen."); return;
    }
    setError(""); setXlsxStatus("loading"); setXlsxStatusTxt("Wird gelesen…");
    setExcelData(null); setResults(null);
    try {
      const data = await parseExcel(file);
      setExcelData(data);
      setXlsxStatus("done");
      setXlsxStatusTxt(`${data.records.length} Kunden geladen`);
    } catch (err) {
      setXlsxStatus("error"); setXlsxStatusTxt("Datei konnte nicht gelesen werden");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  function handleExport() {
    if (!excelData || !results) return;
    const period = pdfEntries?.[0]?.periode ?? new Date().toISOString().slice(0, 7);
    const map = new Map<number, number>();
    for (const r of results) {
      if (r.customer && r.istProvision > 0) {
        const prev = map.get(r.customer._idx) ?? 0;
        map.set(r.customer._idx, prev + r.istProvision);
      }
    }
    exportWithPayments(excelData, period, map);
  }

  const sum = results ? summarise(results) : null;

  const filtered = results
    ? results.filter((r) => {
        if (filter === "all") return true;
        if (filter === r.status) return true;
        if (filter === r.controlFlag && r.controlFlag !== "ok") return true;
        return false;
      })
    : [];

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function changeFilter(f: Filter) { setFilter(f); setPage(0); }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", fontFamily: "'Segoe UI', -apple-system, sans-serif" }}>

      {/* Header */}
      <header style={{ background: "#cbdafb", borderBottom: "1px solid #b8ccf8" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 24, color: "#1e1e1e", letterSpacing: "-0.5px" }}>
              LOYAGO
            </span>
            <div style={{ width: 1, height: 22, background: "#a0b8f0" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#4a5568" }}>
              Provisionscontrolling BGV-Bestand
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {results && (
              <button onClick={handleExport} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 10, border: "none", cursor: "pointer",
                background: "#1e1e1e", color: "#cbdafb", fontWeight: 700, fontSize: 13,
              }}>
                <Download size={14} /> Excel exportieren
              </button>
            )}
            <button onClick={() => setShowSettings(true)} style={{
              padding: 8, borderRadius: 10, border: "none", cursor: "pointer",
              background: "rgba(0,0,0,0.08)", display: "flex",
            }}>
              <Settings size={17} color="#4a5568" />
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 13, display: "flex", gap: 8 }}>
            <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{error}</pre>
          </div>
        )}

        {/* Upload cards */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <DropZone
              label="Provisionsabrechnung (PDF)"
              hint="Monatliche Abrechnung vom Versicherer"
              accept=".pdf" status={pdfStatus} statusText={pdfStatusTxt}
              onFile={handlePdf} inputRef={pdfRef}
            >
              {pdfText && (
                <button onClick={(e) => { e.stopPropagation(); setShowRaw(v => !v); }}
                  style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  <ChevronDown size={11} style={{ transform: showRaw ? "rotate(180deg)" : "", transition: "transform 0.2s" }} />
                  Rohtext {showRaw ? "ausblenden" : "anzeigen"}
                </button>
              )}
            </DropZone>

            <DropZone
              label="Kundendatenbank (Excel)"
              hint=".xlsx / .xls / .ods / .csv"
              accept=".xlsx,.xls,.ods,.csv" status={xlsxStatus} statusText={xlsxStatusTxt}
              onFile={handleExcel} inputRef={xlsxRef}
            >
              {excelData && (
                <p style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
                  Spalten: {[
                    excelData.columnMap.vertragsnummer && `Vertragsnr. → "${excelData.columnMap.vertragsnummer}"`,
                    excelData.columnMap.sollprovision  && `Soll → "${excelData.columnMap.sollprovision}"`,
                    excelData.columnMap.zahlweise      && `Zahlweise → "${excelData.columnMap.zahlweise}"`,
                  ].filter(Boolean).join("  ·  ")}
                </p>
              )}
            </DropZone>
          </div>
        </div>

        {showRaw && pdfText && (
          <pre style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: "white", color: "#475569", fontFamily: "monospace", fontSize: 11, maxHeight: 180, overflow: "auto", border: "1px solid #e2e8f0" }}>
            {pdfText}
          </pre>
        )}

        {/* Empty state */}
        {pdfStatus === "idle" && xlsxStatus === "idle" && (
          <div style={{ textAlign: "center", padding: "56px 0 40px" }}>
            <div style={{ width: 72, height: 72, borderRadius: 22, background: "#cbdafb", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
              <BarChart3 size={34} color="#2d2d2d" strokeWidth={2} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#1e1e1e" }}>
              Provisionsabgleich starten
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: "#9ca3af", maxWidth: 360, marginInline: "auto" }}>
              Lade die monatliche PDF-Abrechnung und deine Excel-Kundendatenbank hoch. Der Abgleich startet automatisch.
            </p>
          </div>
        )}

        {/* Hint when only one file loaded */}
        {!results && (pdfStatus === "done" || xlsxStatus === "done") && (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#9ca3af", fontSize: 14 }}>
            {pdfStatus === "done" && xlsxStatus !== "done" && "Jetzt noch die Excel-Kundendatenbank hochladen."}
            {xlsxStatus === "done" && pdfStatus !== "done" && "Jetzt noch die PDF-Abrechnung hochladen."}
          </div>
        )}

        {/* Results */}
        {results && sum && (
          <>
            {/* ── KPI Summary ─────────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>

              {/* PDF Gesamt */}
              <KpiCard
                Icon={CircleDollarSign}
                iconBg="#cbdafb"
                label="PDF Gesamt"
                value={eur(sum.totalPdf)}
                sub={`${results.filter(r => r.pdfEntry).length} Einträge`}
              />

              {/* Abgeglichen */}
              <KpiCard
                Icon={CheckCircle2}
                iconBg="#dcfce7"
                iconColor="#16a34a"
                label="Abgeglichen"
                value={eur(sum.matchedAmount)}
                sub={pct(sum.matchRateByAmount) + " der Summe"}
                accent={sum.matchRateByAmount >= 0.95 ? "#16a34a" : sum.matchRateByAmount >= 0.80 ? "#d97706" : "#dc2626"}
              />

              {/* Unbekannte Zahlungen */}
              <KpiCard
                Icon={Info}
                iconBg="#dbeafe"
                iconColor="#1d4ed8"
                label="Unbekannte Zahlungen"
                value={eur(sum.unknownAmount)}
                sub={`${sum.unmatchedPdfCount} Einträge ohne Zuordnung`}
                accent={sum.unknownAmount > 0 ? "#1d4ed8" : "#9ca3af"}
              />

              {/* Ausstehende Soll */}
              <KpiCard
                Icon={AlertCircle}
                iconBg="#fef2f2"
                iconColor="#dc2626"
                label="Ausstehend (Soll)"
                value={eur(sum.missingSoll)}
                sub={`${sum.unmatchedExcelCount} Kunden ohne Zahlung`}
                accent={sum.missingSoll > 0 ? "#dc2626" : "#16a34a"}
              />

              {/* Abweichungen */}
              <KpiCard
                Icon={AlertTriangle}
                iconBg="#fff7ed"
                iconColor="#b45309"
                label="Abweichungen"
                value={`${sum.overpaidCount + sum.underpaidCount}`}
                sub={`${sum.overpaidCount} Über · ${sum.underpaidCount} Unter`}
                accent={sum.overpaidCount + sum.underpaidCount > 0 ? "#b45309" : "#16a34a"}
              />
            </div>

            {/* ── Filter bar ──────────────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#9ca3af", marginRight: 4 }}>Filter:</span>

              {([
                { key: "all",             label: "Alle",             count: results.length },
                { key: "exact",           label: "Abgeglichen",      count: sum.exactCount },
                { key: "partial",         label: "Kundennr.",        count: sum.partialCount },
                { key: "unmatched_excel", label: "Ausstehend",       count: sum.unmatchedExcelCount },
                { key: "unmatched_pdf",   label: "Unbekannt",        count: sum.unmatchedPdfCount },
              ] as { key: Filter; label: string; count: number }[]).map(({ key: k, label, count }) => (
                <FilterBtn key={k} active={filter === k} label={label} count={count} onClick={() => changeFilter(k)} />
              ))}

              <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 4px" }} />

              {([
                { key: "overpaid",   label: "Überzahlung",  count: sum.overpaidCount,   color: "#b45309" },
                { key: "underpaid",  label: "Teilzahlung",  count: sum.underpaidCount,  color: "#7c3aed" },
                { key: "unexpected", label: "Ungeplant",    count: sum.unexpectedCount, color: "#0369a1" },
              ] as { key: Filter; label: string; count: number; color: string }[])
                .filter(f => f.count > 0)
                .map(({ key: k, label, count, color }) => (
                  <FilterBtn key={k} active={filter === k} label={label} count={count} onClick={() => changeFilter(k)} activeColor={color} />
                ))
              }
            </div>

            {/* ── Table ───────────────────────────────────────────────────── */}
            <div style={{ borderRadius: 14, overflow: "hidden", background: "white", boxShadow: "0 1px 6px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
              {/* Head */}
              <div style={{ display: "grid", gridTemplateColumns: "140px 180px 1fr 120px 100px 100px 110px", gap: 8, padding: "10px 20px", borderBottom: "1px solid #f3f4f6", background: "#fafafa" }}>
                {["Status", "Kundennr. / Name", "Vertragsnr. / Produkt", "Zahlweise", "Soll", "Ist", "Delta"].map((h, i) => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: i >= 4 ? "right" : "left" }}>{h}</span>
                ))}
              </div>

              {pageSlice.length === 0
                ? <p style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 14 }}>Keine Einträge für diesen Filter</p>
                : pageSlice.map((r, i) => <ResultRow key={page * PAGE_SIZE + i} result={r} />)
              }
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 14 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
                  <ChevronLeft size={16} color="#6b7280" />
                </button>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>
                  Seite {page + 1} / {totalPages}
                  <span style={{ marginLeft: 8, opacity: 0.6, fontWeight: 400 }}>({filtered.length} Einträge)</span>
                </span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", cursor: page >= totalPages - 1 ? "default" : "pointer", opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
                  <ChevronRight size={16} color="#6b7280" />
                </button>
              </div>
            )}

            <p style={{ marginTop: 10, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
              „Excel exportieren" schreibt die Ist-Beträge ab Spalte U in deine Kundendatenbank.
            </p>
          </>
        )}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  Icon, iconBg, iconColor = "#2d2d2d", label, value, sub, accent,
}: {
  Icon: typeof BarChart3; iconBg: string; iconColor?: string;
  label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div style={{ background: "white", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={16} color={iconColor} />
        </div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
      </div>
      <p style={{ margin: "0 0 2px", fontSize: 19, fontWeight: 800, color: accent ?? "#1e1e1e", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px" }}>{value}</p>
      {sub && <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{sub}</p>}
    </div>
  );
}

function FilterBtn({
  active, label, count, onClick, activeColor = "#1e1e1e",
}: {
  active: boolean; label: string; count: number; onClick: () => void; activeColor?: string;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
      background: active ? activeColor : "white",
      color:      active ? "white" : "#6b7280",
      boxShadow:  "0 1px 3px rgba(0,0,0,0.07)",
    }}>
      {label} <span style={{ marginLeft: 3, opacity: 0.75, fontWeight: 400 }}>{count}</span>
    </button>
  );
}

function ResultRow({ result }: { result: MatchResult }) {
  const ms  = MATCH_STATUS[result.status];
  const flg = result.controlFlag !== "ok" ? FLAG_CONFIG[result.controlFlag] : null;

  const kundennr   = result.customer?.kundennummer   || result.pdfEntry?.kundennummer   || "–";
  const name       = result.customer?.kundenname     || result.pdfEntry?.kundenname     || "–";
  const vertragsnr = result.customer?.vertragsnummer || result.pdfEntry?.vertragsnummer || "–";
  const produkt    = result.pdfEntry?.produkt || result.pdfEntry?.periode || "–";
  const zahlweise  = result.customer?.zahlweise || "–";
  const delta      = result.delta;
  const dc = delta > 0.005 ? "#16a34a" : delta < -0.005 ? "#dc2626" : "#9ca3af";

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "140px 180px 1fr 120px 100px 100px 110px", gap: 8, padding: "11px 20px", borderBottom: "1px solid #f9fafb", alignItems: "center" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#fafafa")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {/* Status + flag */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: ms.bg, color: ms.color, border: `1px solid ${ms.border}`, width: "fit-content" }}>
          {ms.label}
        </span>
        {flg && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: flg.bg, color: flg.color, width: "fit-content" }}>
            {flg.icon} {flg.label}
          </span>
        )}
      </div>

      {/* Kundennr / Name */}
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#1e1e1e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kundennr}</p>
        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</p>
      </div>

      {/* Vertragsnr / Produkt */}
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#1e1e1e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vertragsnr}</p>
        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{produkt}</p>
      </div>

      {/* Zahlweise */}
      <p style={{ margin: 0, fontSize: 11, color: "#64748b", textAlign: "left" }}>{zahlweise}</p>

      {/* Soll */}
      <p style={{ margin: 0, textAlign: "right", fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
        {result.sollProvision > 0 ? eur(result.sollProvision) : "–"}
      </p>

      {/* Ist */}
      <p style={{ margin: 0, textAlign: "right", fontSize: 12, fontWeight: 600, color: "#1e1e1e", fontVariantNumeric: "tabular-nums" }}>
        {result.istProvision > 0 ? eur(result.istProvision) : "–"}
      </p>

      {/* Delta */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, color: dc, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {delta > 0.005 ? <TrendingUp size={11} /> : delta < -0.005 ? <TrendingDown size={11} /> : <Minus size={11} />}
        {(result.sollProvision > 0 || result.istProvision > 0) ? (delta > 0 ? "+" : "") + eur(delta) : "–"}
      </div>
    </div>
  );
}
