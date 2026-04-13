/**
 * App.tsx — LOYAGO Provisionscontrolling
 */

import { useState, useCallback, useRef } from "react";
import {
  Settings, TrendingUp, TrendingDown, Minus,
  CheckCircle2, AlertTriangle, XCircle, Info,
  Download, ChevronDown,
} from "lucide-react";

import SettingsModal from "./components/SettingsModal";
import DropZone, { type DropStatus } from "./components/DropZone";

import { extractPdfText }                                         from "./lib/pdfExtractor";
import { parseCommissionPdf, getApiKey, type CommissionEntry }    from "./lib/claudeParser";
import { parseExcel, exportWithPayments, type ExcelData }         from "./lib/excelHandler";
import { reconcile, summarise, type MatchResult, type MatchStatus } from "./lib/matcher";

// ─── LOYAGO CI ────────────────────────────────────────────────────────────────

const C = {
  bg:          "#f4f8fe",
  dark:        "#1a1f3a",
  accent:      "#4a6da8",
  accentLight: "#eaeff8",
  accentBorder:"#c7d9f0",
  muted:       "#94a3b8",
  card:        "white",
  border:      "#e2e8f0",
};

// LOYAGO-Logo (verkleinertes SVG aus public/favicon.svg)
function LoyagoLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 46 / 48} viewBox="0 0 48 46" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="#863bff" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/>
    </svg>
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const eur = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const pct = (n: number) => `${(n * 100).toFixed(0)} %`;

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS: Record<
  MatchStatus,
  { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }
> = {
  exact: {
    label: "Abgeglichen", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0",
    Icon: CheckCircle2,
  },
  partial: {
    label: "Kundennr.",   color: "#d97706", bg: "#fffbeb", border: "#fde68a",
    Icon: AlertTriangle,
  },
  unmatched_pdf: {
    label: "Unbekannt",   color: C.accent,  bg: C.accentLight, border: C.accentBorder,
    Icon: Info,
  },
  unmatched_excel: {
    label: "Ausstehend",  color: "#dc2626", bg: "#fef2f2", border: "#fecaca",
    Icon: XCircle,
  },
};

type Filter = "all" | MatchStatus;

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [showSettings, setShowSettings] = useState(!getApiKey());

  const [pdfStatus,    setPdfStatus]    = useState<DropStatus>("idle");
  const [pdfText,      setPdfText]      = useState<string>("");
  const [pdfStatusTxt, setPdfStatusTxt] = useState("PDF hier ablegen oder klicken");
  const [pdfEntries,   setPdfEntries]   = useState<CommissionEntry[] | null>(null);
  const [showRaw,      setShowRaw]      = useState(false);

  const [xlsxStatus,    setXlsxStatus]    = useState<DropStatus>("idle");
  const [xlsxStatusTxt, setXlsxStatusTxt] = useState("Excel hier ablegen oder klicken");
  const [excelData,     setExcelData]     = useState<ExcelData | null>(null);

  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [filter,  setFilter]  = useState<Filter>("all");
  const [error,   setError]   = useState("");

  const pdfRef  = useRef<HTMLInputElement | null>(null);
  const xlsxRef = useRef<HTMLInputElement | null>(null);

  const handlePdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setError("Bitte eine .pdf-Datei auswählen."); return; }
    if (!getApiKey()) { setShowSettings(true); return; }
    setError(""); setPdfStatus("loading"); setPdfStatusTxt("Text wird extrahiert…");
    setPdfEntries(null); setResults(null);
    try {
      const text = await extractPdfText(file);
      setPdfText(text); setPdfStatusTxt("KI analysiert Abrechnung…");
      const entries = await parseCommissionPdf(text, () => {});
      setPdfEntries(entries); setPdfStatus("done"); setPdfStatusTxt(`${entries.length} Einträge erkannt`);
      if (excelData) setResults(reconcile(entries, excelData.records));
    } catch (err) {
      setPdfStatus("error"); setPdfStatusTxt("Analyse fehlgeschlagen");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [excelData]);

  const handleExcel = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|ods|csv)$/i)) { setError("Bitte eine Excel-Datei auswählen."); return; }
    setError(""); setXlsxStatus("loading"); setXlsxStatusTxt("Wird gelesen…");
    setExcelData(null); setResults(null);
    try {
      const data = await parseExcel(file);
      setExcelData(data); setXlsxStatus("done"); setXlsxStatusTxt(`${data.records.length} Kunden geladen`);
      if (pdfEntries) setResults(reconcile(pdfEntries, data.records));
    } catch (err) {
      setXlsxStatus("error"); setXlsxStatusTxt("Datei konnte nicht gelesen werden");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pdfEntries]);

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
    ? filter === "all" ? results : results.filter((r) => r.status === filter)
    : [];

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>

      {/* ── Header ── */}
      <header style={{
        background: C.dark,
        boxShadow: "0 2px 12px rgba(26,31,58,0.18)",
        position: "sticky", top: 0, zIndex: 30,
      }}>
        <div className="flex items-center justify-between px-6 py-3 mx-auto" style={{ maxWidth: 1100 }}>
          {/* Wordmark */}
          <div className="flex items-center gap-3">
            <LoyagoLogo size={30} />
            <div>
              <span className="font-black tracking-tight" style={{ fontSize: 20, color: "white", letterSpacing: "-0.5px" }}>
                LOYAGO
              </span>
              <span className="ml-2 text-xs font-semibold uppercase tracking-widest" style={{ color: C.accent }}>
                Provisionscontrolling
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {results && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
                style={{ background: C.accent, color: "white" }}
              >
                <Download size={14} />
                Excel exportieren
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.1)" }}
              title="Einstellungen"
            >
              <Settings size={18} color="rgba(255,255,255,0.7)" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="px-6 py-6 mx-auto" style={{ maxWidth: 1100 }}>

        {/* Error */}
        {error && (
          <div className="mb-5 flex items-start gap-2 px-4 py-3 rounded-2xl text-sm"
            style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}>
            <XCircle size={15} className="flex-shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}

        {/* ── Import cards ── */}
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <DropZone
            label="Provisionsabrechnung (PDF)"
            hint="Monatliche Abrechnung vom Versicherer"
            accept=".pdf"
            status={pdfStatus}
            statusText={pdfStatusTxt}
            onFile={handlePdf}
            inputRef={pdfRef}
          >
            {pdfText && (
              <button className="mt-2 flex items-center gap-1 text-xs" style={{ color: C.muted }}
                onClick={(e) => { e.stopPropagation(); setShowRaw((v) => !v); }}>
                <ChevronDown size={11} style={{ transform: showRaw ? "rotate(180deg)" : "", transition: "transform 0.2s" }} />
                Rohtext {showRaw ? "ausblenden" : "anzeigen"}
              </button>
            )}
          </DropZone>

          <DropZone
            label="Kundendatenbank (Excel)"
            hint=".xlsx / .xls / .ods / .csv"
            accept=".xlsx,.xls,.ods,.csv"
            status={xlsxStatus}
            statusText={xlsxStatusTxt}
            onFile={handleExcel}
            inputRef={xlsxRef}
          >
            {excelData && (
              <p className="mt-1.5 text-xs" style={{ color: C.muted }}>
                Spalten:{" "}
                <span style={{ color: "#64748b" }}>
                  {[
                    excelData.columnMap.kundennummer   && `Kundennr.: "${excelData.columnMap.kundennummer}"`,
                    excelData.columnMap.vertragsnummer && `Vertragsnr.: "${excelData.columnMap.vertragsnummer}"`,
                    excelData.columnMap.sollprovision  && `Soll: "${excelData.columnMap.sollprovision}"`,
                  ].filter(Boolean).join(" · ")}
                </span>
              </p>
            )}
          </DropZone>
        </div>

        {/* Raw PDF text */}
        {showRaw && pdfText && (
          <pre className="mb-5 p-4 rounded-2xl text-xs overflow-auto"
            style={{ background: C.card, color: "#475569", fontFamily: "monospace", maxHeight: 220, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            {pdfText}
          </pre>
        )}

        {/* ── Summary cards ── */}
        {sum && (
          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <SummaryCard label="Soll-Provision"  value={eur(sum.totalSoll)} />
            <SummaryCard label="Ist-Provision"   value={eur(sum.totalIst)} />
            <SummaryCard
              label="Differenz"
              value={(sum.delta >= 0 ? "+" : "") + eur(sum.delta)}
              accent={sum.delta >= 0 ? "#16a34a" : "#dc2626"}
              sub={sum.delta >= 0 ? "Überzahlung" : "Fehlbetrag"}
            />
            <SummaryCard
              label="Match-Rate"
              value={pct(sum.matchRate)}
              accent={sum.matchRate >= 0.9 ? "#16a34a" : sum.matchRate >= 0.7 ? "#d97706" : "#dc2626"}
              sub={`${sum.exactCount} exakt · ${sum.partialCount} teilw.`}
            />
            <SummaryCard
              label="Ausstehend"
              value={String(sum.unmatchedExcelCount)}
              accent={sum.unmatchedExcelCount > 0 ? "#dc2626" : "#16a34a"}
              sub="Einträge ohne Zahlung"
            />
          </div>
        )}

        {/* ── Results table ── */}
        {results && (
          <>
            <div className="flex gap-2 mb-3 flex-wrap">
              {([
                { key: "all",             label: "Alle",        count: results.length },
                { key: "exact",           label: "Abgeglichen", count: sum!.exactCount },
                { key: "partial",         label: "Kundennr.",   count: sum!.partialCount },
                { key: "unmatched_excel", label: "Ausstehend",  count: sum!.unmatchedExcelCount },
                { key: "unmatched_pdf",   label: "Unbekannt",   count: sum!.unmatchedPdfCount },
              ] as { key: Filter; label: string; count: number }[]).map(({ key, label, count }) => (
                <button key={key} onClick={() => setFilter(key)}
                  className="px-3 py-1.5 rounded-xl text-sm font-medium"
                  style={{
                    background: filter === key ? C.dark : C.card,
                    color:      filter === key ? "white" : "#64748b",
                    boxShadow:  "0 1px 3px rgba(0,0,0,0.06)",
                  }}>
                  {label}
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-lg text-xs"
                    style={{ background: filter === key ? "rgba(255,255,255,0.15)" : "#f1f5f9" }}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: C.card, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
              <div className="grid px-4 py-2.5 text-xs font-semibold border-b"
                style={{ gridTemplateColumns: "160px 1fr 1fr 100px 100px 100px", gap: "8px", color: C.muted, borderColor: C.border }}>
                <span>Status</span>
                <span>Kundennr. / Name</span>
                <span>Vertragsnr. / Produkt</span>
                <span className="text-right">Soll</span>
                <span className="text-right">Ist</span>
                <span className="text-right">Delta</span>
              </div>
              {filtered.length === 0
                ? <p className="text-center py-10 text-sm" style={{ color: C.muted }}>Keine Einträge</p>
                : filtered.map((r, i) => <ResultRow key={i} result={r} />)
              }
            </div>

            <p className="mt-2 text-xs text-center" style={{ color: C.muted }}>
              "Excel exportieren" fügt eine neue Spalte für den Abrechnungsmonat ein.
            </p>
          </>
        )}

        {/* Empty state */}
        {!results && pdfStatus === "idle" && xlsxStatus === "idle" && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center rounded-2xl mb-5"
              style={{ width: 72, height: 72, background: C.accentLight }}>
              <LoyagoLogo size={36} />
            </div>
            <p className="text-lg font-bold mb-2" style={{ color: C.dark }}>
              Provisionsabgleich starten
            </p>
            <p className="text-sm max-w-sm mx-auto" style={{ color: C.muted, lineHeight: 1.7 }}>
              Lade die monatliche PDF-Abrechnung und deine Excel-Kundendatenbank hoch.
              Der Abgleich startet automatisch.
            </p>
            {!getApiKey() && (
              <button onClick={() => setShowSettings(true)}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: C.accent, color: "white" }}>
                <Settings size={15} />
                API-Key einrichten
              </button>
            )}
          </div>
        )}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <p className="text-xs font-medium mb-1" style={{ color: "#94a3b8" }}>{label}</p>
      <p className="font-bold text-lg leading-tight tabular" style={{ color: accent ?? "#1a1f3a" }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>{sub}</p>}
    </div>
  );
}

function ResultRow({ result }: { result: MatchResult }) {
  const cfg = STATUS[result.status];
  const { Icon } = cfg;
  const kundennr   = result.customer?.kundennummer   || result.pdfEntry?.kundennummer   || "–";
  const name       = result.customer?.kundenname     || result.pdfEntry?.kundenname     || "–";
  const vertragsnr = result.customer?.vertragsnummer || result.pdfEntry?.vertragsnummer || "–";
  const produkt    = result.pdfEntry?.produkt || "";
  const periode    = result.pdfEntry?.periode ?? "";
  const deltaColor = result.delta > 0.005 ? "#16a34a" : result.delta < -0.005 ? "#dc2626" : "#64748b";

  return (
    <div className="grid items-center px-4 py-3 border-b text-sm hover:bg-slate-50"
      style={{ gridTemplateColumns: "160px 1fr 1fr 100px 100px 100px", gap: "8px", borderColor: "#f1f5f9" }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold w-fit"
        style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
        <Icon size={11} />{cfg.label}
      </span>
      <div className="min-w-0">
        <p className="font-medium truncate" style={{ color: "#1a1f3a" }}>{kundennr}</p>
        <p className="text-xs truncate"     style={{ color: "#94a3b8" }}>{name}</p>
      </div>
      <div className="min-w-0">
        <p className="font-medium truncate" style={{ color: "#1a1f3a" }}>{vertragsnr}</p>
        <p className="text-xs truncate"     style={{ color: "#94a3b8" }}>{produkt || periode || "–"}</p>
      </div>
      <p className="text-right tabular text-xs" style={{ color: "#64748b" }}>
        {result.sollProvision > 0 ? eur(result.sollProvision) : "–"}
      </p>
      <p className="text-right tabular text-xs font-medium" style={{ color: "#1a1f3a" }}>
        {result.istProvision > 0 ? eur(result.istProvision) : "–"}
      </p>
      <div className="flex items-center justify-end gap-0.5 tabular text-xs font-semibold" style={{ color: deltaColor }}>
        {result.delta > 0.005 ? <TrendingUp size={11} /> : result.delta < -0.005 ? <TrendingDown size={11} /> : <Minus size={11} />}
        {(result.sollProvision > 0 || result.istProvision > 0) ? eur(Math.abs(result.delta)) : "–"}
      </div>
    </div>
  );
}
