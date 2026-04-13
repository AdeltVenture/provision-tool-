import { useState, useCallback, useRef, useEffect } from "react";
import {
  Settings, TrendingUp, TrendingDown, Minus,
  CheckCircle2, AlertTriangle, XCircle, Info, Download, ChevronDown,
  ChevronLeft, ChevronRight, BarChart3,
} from "lucide-react";

import SettingsModal from "./components/SettingsModal";
import DropZone, { type DropStatus } from "./components/DropZone";
import { extractPdfText } from "./lib/pdfExtractor";
import { parseCommissionPdf, getApiKey, type CommissionEntry } from "./lib/claudeParser";
import { parseExcel, exportWithPayments, type ExcelData } from "./lib/excelHandler";
import { reconcile, summarise, type MatchResult, type MatchStatus } from "./lib/matcher";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const pct = (n: number) => `${(n * 100).toFixed(0)} %`;

const PAGE_SIZE = 100;

// ─── Status ───────────────────────────────────────────────────────────────────

const STATUS: Record<MatchStatus, { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  exact:           { label: "Abgeglichen", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", Icon: CheckCircle2 },
  partial:         { label: "Kundennr.",   color: "#b45309", bg: "#fffbeb", border: "#fde68a", Icon: AlertTriangle },
  unmatched_pdf:   { label: "Unbekannt",   color: "#1d4ed8", bg: "#dbeafe", border: "#bfdbfe", Icon: Info },
  unmatched_excel: { label: "Ausstehend",  color: "#dc2626", bg: "#fef2f2", border: "#fecaca", Icon: XCircle },
};

type Filter = "all" | MatchStatus;

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

  // ── Auto-reconcile whenever both datasets are ready ──────────────────────
  useEffect(() => {
    if (pdfEntries && excelData) {
      const r = reconcile(pdfEntries, excelData.records);
      setResults(r);
      setFilter("all");
      setPage(0);
    }
  }, [pdfEntries, excelData]);

  const handlePdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setError("Bitte eine .pdf-Datei auswählen."); return; }
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
    if (!file.name.match(/\.(xlsx|xls|ods|csv)$/i)) { setError("Bitte eine Excel-Datei auswählen."); return; }
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
      if (r.customer && r.istProvision > 0) map.set(r.customer._idx, r.istProvision);
    }
    exportWithPayments(excelData, period, map);
  }

  const sum      = results ? summarise(results) : null;
  const filtered = results
    ? (filter === "all" ? results : results.filter(r => r.status === filter))
    : [];

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function changeFilter(f: Filter) {
    setFilter(f);
    setPage(0);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", fontFamily: "'Segoe UI', -apple-system, sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{ background: "#cbdafb", borderBottom: "1px solid #b8ccf8" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>

          {/* Wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: "'Arial Black', 'Impact', sans-serif", fontWeight: 900, fontSize: 24, color: "#1e1e1e", letterSpacing: "-0.5px", lineHeight: 1 }}>
              LOYAGO
            </span>
            <div style={{ width: 1, height: 22, background: "#a0b8f0" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#4a5568", letterSpacing: "0.3px" }}>
              Provisionscontrolling BGV-Bestand
            </span>
          </div>

          {/* Rechts */}
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
              background: "rgba(0,0,0,0.08)", display: "flex", alignItems: "center",
            }} title="Einstellungen">
              <Settings size={17} color="#4a5568" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 13, display: "flex", gap: 8 }}>
            <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{error}</pre>
          </div>
        )}

        {/* ── Upload section ── */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1e1e1e", margin: "0 0 4px 0" }}>
            Dateien importieren
          </h2>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px 0" }}>
            Lade die PDF-Abrechnung und deine Excel-Kundendatenbank hoch – der Abgleich startet automatisch.
          </p>

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
                    excelData.columnMap.kundennummer   && `Kundennr. → "${excelData.columnMap.kundennummer}"`,
                    excelData.columnMap.vertragsnummer && `Vertragsnr. → "${excelData.columnMap.vertragsnummer}"`,
                    excelData.columnMap.sollprovision  && `Soll → "${excelData.columnMap.sollprovision}"`,
                  ].filter(Boolean).join("  ·  ")}
                </p>
              )}
            </DropZone>
          </div>
        </div>

        {/* Rohtext */}
        {showRaw && pdfText && (
          <pre style={{ marginBottom: 24, padding: 16, borderRadius: 12, background: "white", color: "#475569", fontFamily: "monospace", fontSize: 11, maxHeight: 200, overflow: "auto", border: "1px solid #e2e8f0" }}>
            {pdfText}
          </pre>
        )}

        {/* ── Empty state (nichts geladen) ── */}
        {pdfStatus === "idle" && xlsxStatus === "idle" && (
          <div style={{ textAlign: "center", padding: "56px 0 40px" }}>
            <div style={{
              width: 72, height: 72, borderRadius: 22,
              background: "#cbdafb",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 20,
            }}>
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

        {/* ── Hinweis wenn nur eine Datei geladen ── */}
        {!results && (pdfStatus === "done" || xlsxStatus === "done") && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 14 }}>
            {pdfStatus === "done" && xlsxStatus !== "done" && "Jetzt noch die Excel-Kundendatenbank hochladen, um den Abgleich zu starten."}
            {xlsxStatus === "done" && pdfStatus !== "done" && "Jetzt noch die PDF-Abrechnung hochladen, um den Abgleich zu starten."}
          </div>
        )}

        {/* ── Ergebnisse ── */}
        {results && sum && (
          <>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
              <StatCard label="Soll-Provision"  value={eur(sum.totalSoll)} />
              <StatCard label="Ist-Provision"   value={eur(sum.totalIst)} />
              <StatCard label="Differenz"       value={(sum.delta >= 0 ? "+" : "") + eur(sum.delta)}
                        accent={sum.delta >= 0 ? "#16a34a" : "#dc2626"}
                        sub={sum.delta >= 0 ? "Überzahlung" : "Fehlbetrag"} />
              <StatCard label="Match-Rate"      value={pct(sum.matchRate)}
                        accent={sum.matchRate >= 0.9 ? "#16a34a" : sum.matchRate >= 0.7 ? "#d97706" : "#dc2626"}
                        sub={`${sum.exactCount} exakt · ${sum.partialCount} teilw.`} />
              <StatCard label="Ausstehend"      value={String(sum.unmatchedExcelCount)}
                        accent={sum.unmatchedExcelCount > 0 ? "#dc2626" : "#16a34a"}
                        sub="Einträge ohne Zahlung" />
            </div>

            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {([
                { key: "all",             label: "Alle",        count: results.length },
                { key: "exact",           label: "Abgeglichen", count: sum.exactCount },
                { key: "partial",         label: "Kundennr.",   count: sum.partialCount },
                { key: "unmatched_excel", label: "Ausstehend",  count: sum.unmatchedExcelCount },
                { key: "unmatched_pdf",   label: "Unbekannt",   count: sum.unmatchedPdfCount },
              ] as { key: Filter; label: string; count: number }[]).map(({ key, label, count }) => (
                <button key={key} onClick={() => changeFilter(key)} style={{
                  padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: filter === key ? "#1e1e1e" : "white",
                  color:      filter === key ? "#cbdafb" : "#6b7280",
                  boxShadow:  "0 1px 3px rgba(0,0,0,0.07)",
                }}>
                  {label} <span style={{ marginLeft: 4, opacity: 0.7, fontWeight: 400 }}>{count}</span>
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ borderRadius: 16, overflow: "hidden", background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e5e7eb" }}>
              {/* Table head */}
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 100px 100px 100px", gap: 8, padding: "10px 20px", borderBottom: "1px solid #f3f4f6", background: "#fafafa" }}>
                {["Status", "Kundennr. / Name", "Vertragsnr. / Produkt", "Soll", "Ist", "Delta"].map((h, i) => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: i > 2 ? "right" : "left" }}>{h}</span>
                ))}
              </div>

              {pageSlice.length === 0
                ? <p style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 14 }}>Keine Einträge</p>
                : pageSlice.map((r, i) => <ResultRow key={page * PAGE_SIZE + i} result={r} />)
              }
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.4 : 1 }}
                >
                  <ChevronLeft size={16} color="#6b7280" />
                </button>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>
                  Seite {page + 1} von {totalPages}
                  <span style={{ marginLeft: 8, opacity: 0.6, fontWeight: 400 }}>
                    ({filtered.length} Einträge gesamt)
                  </span>
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", cursor: page >= totalPages - 1 ? "default" : "pointer", opacity: page >= totalPages - 1 ? 0.4 : 1 }}
                >
                  <ChevronRight size={16} color="#6b7280" />
                </button>
              </div>
            )}

            <p style={{ marginTop: 10, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
              „Excel exportieren" fügt eine neue Spalte für den Abrechnungsmonat ein und lädt die Datei herunter.
            </p>
          </>
        )}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ─── Hilfkomponenten ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: "white", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}>
      <p style={{ margin: "0 0 4px 0", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: accent ?? "#1e1e1e", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ margin: "2px 0 0 0", fontSize: 11, color: "#9ca3af" }}>{sub}</p>}
    </div>
  );
}

function ResultRow({ result }: { result: MatchResult }) {
  const cfg = STATUS[result.status];
  const kundennr   = result.customer?.kundennummer   || result.pdfEntry?.kundennummer   || "–";
  const name       = result.customer?.kundenname     || result.pdfEntry?.kundenname     || "–";
  const vertragsnr = result.customer?.vertragsnummer || result.pdfEntry?.vertragsnummer || "–";
  const produkt    = result.pdfEntry?.produkt || result.pdfEntry?.periode || "–";
  const delta      = result.delta;
  const dc = delta > 0.005 ? "#16a34a" : delta < -0.005 ? "#dc2626" : "#9ca3af";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 100px 100px 100px", gap: 8, padding: "12px 20px", borderBottom: "1px solid #f9fafb", alignItems: "center" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#fafafa")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>

      {/* Badge */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, width: "fit-content" }}>
        <cfg.Icon size={10} /> {cfg.label}
      </span>

      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1e1e1e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kundennr}</p>
        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</p>
      </div>

      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1e1e1e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vertragsnr}</p>
        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{produkt}</p>
      </div>

      <p style={{ margin: 0, textAlign: "right", fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
        {result.sollProvision > 0 ? eur(result.sollProvision) : "–"}
      </p>
      <p style={{ margin: 0, textAlign: "right", fontSize: 12, fontWeight: 600, color: "#1e1e1e", fontVariantNumeric: "tabular-nums" }}>
        {result.istProvision > 0 ? eur(result.istProvision) : "–"}
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, color: dc, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {delta > 0.005 ? <TrendingUp size={11} /> : delta < -0.005 ? <TrendingDown size={11} /> : <Minus size={11} />}
        {(result.sollProvision > 0 || result.istProvision > 0) ? eur(Math.abs(delta)) : "–"}
      </div>
    </div>
  );
}
