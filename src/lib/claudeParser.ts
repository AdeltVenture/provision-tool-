/**
 * claudeParser.ts
 * Extracts commission entries from PDF text via the Anthropic API.
 *
 * Performance:
 *  - CSV output format (60% fewer tokens than JSON)
 *  - Parallel chunk processing for large PDFs
 *  - 70k chars per chunk → covers ~15 pages each
 */

import Anthropic from "@anthropic-ai/sdk";

export const API_KEY_STORAGE = "provision_anthropic_key";
export const MODEL_STORAGE   = "provision_model";
export const DEFAULT_MODEL   = "claude-haiku-4-5-20251001"; // fastest for structured extraction

export function getApiKey(): string  { return localStorage.getItem(API_KEY_STORAGE) ?? ""; }
export function saveApiKey(k: string){ localStorage.setItem(API_KEY_STORAGE, k.trim()); }
export function getModel(): string   { return localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL; }
export function saveModel(m: string) { localStorage.setItem(MODEL_STORAGE, m); }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommissionEntry {
  vertragsnummer: string;
  kundennummer:   string;
  kundenname:     string;
  betrag:         number;
  periode:        string;   // "YYYY-MM"
  produkt:        string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

// CSV format: ~60% fewer output tokens than JSON → ~3× faster generation
const SYSTEM = `Du bist Spezialist für Versicherungs-Provisionsabrechnungen.
Extrahiere ALLE Provisionseinträge und gib sie als CSV aus (Trennzeichen: Semikolon).
Erste Zeile ist immer der Header:
vertragsnummer;kundennummer;kundenname;betrag;periode;produkt

Regeln:
- Eine Zeile pro Eintrag, kein Leerzeichen um die Semikolons
- betrag: Dezimalzahl mit Punkt (z.B. 45.50), auch negativ erlaubt
- periode: YYYY-MM (z.B. 2024-01), falls unbekannt leer lassen
- Keine Anführungszeichen, keine Erklärungen, nur CSV`;

const CHUNK_SIZE = 70_000;

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(raw: string): CommissionEntry[] {
  const lines = raw.trim().split(/\r?\n/);
  const results: CommissionEntry[] = [];

  for (const line of lines) {
    // Skip header and empty lines
    if (!line.trim() || line.startsWith("vertragsnummer")) continue;
    const parts = line.split(";");
    if (parts.length < 4) continue;

    const betrag = parseFloat(parts[3]?.replace(",", ".") ?? "0");
    // Skip lines that look like non-data (betrag must be a number)
    if (isNaN(betrag)) continue;

    results.push({
      vertragsnummer: (parts[0] ?? "").trim(),
      kundennummer:   (parts[1] ?? "").trim(),
      kundenname:     (parts[2] ?? "").trim(),
      betrag,
      periode:        (parts[4] ?? "").trim(),
      produkt:        (parts[5] ?? "").trim(),
    });
  }

  return results;
}

// ─── JSON fallback (in case model outputs JSON despite instructions) ──────────

function tryJsonFallback(raw: string): CommissionEntry[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as CommissionEntry[];
    return arr.map((e) => ({
      vertragsnummer: String(e.vertragsnummer ?? "").trim(),
      kundennummer:   String(e.kundennummer   ?? "").trim(),
      kundenname:     String(e.kundenname     ?? "").trim(),
      betrag:         Number(e.betrag)  || 0,
      periode:        String(e.periode  ?? "").trim(),
      produkt:        String(e.produkt  ?? "").trim(),
    }));
  } catch { return []; }
}

// ─── Single chunk ─────────────────────────────────────────────────────────────

async function parseChunk(
  text: string,
  client: Anthropic,
  onToken: (delta: string) => void
): Promise<CommissionEntry[]> {
  let raw = "";

  const stream = await client.messages.stream({
    model:      getModel(),
    max_tokens: 16000,   // CSV is compact: 16k tokens ≈ 1500+ entries
    system:     SYSTEM,
    messages:   [{ role: "user", content: `Provisionsabrechnung:\n\n${text}` }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      raw += event.delta.text;
      onToken(event.delta.text);
    }
  }

  const csv = parseCsv(raw);
  if (csv.length > 0) return csv;

  // Fallback: model may have returned JSON
  return tryJsonFallback(raw);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function parseCommissionPdf(
  pdfText: string,
  onToken: (delta: string) => void
): Promise<CommissionEntry[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein Anthropic API-Key konfiguriert.");

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // ── Small PDF: single call ─────────────────────────────────────────────────
  if (pdfText.length <= CHUNK_SIZE) {
    return parseChunk(pdfText, client, onToken);
  }

  // ── Large PDF: split at line boundaries, process ALL chunks in parallel ────
  const chunks: string[] = [];
  let pos = 0;
  while (pos < pdfText.length) {
    const end      = Math.min(pos + CHUNK_SIZE, pdfText.length);
    const boundary = pdfText.lastIndexOf("\n", end);
    const chunkEnd = boundary > pos ? boundary : end;
    chunks.push(pdfText.slice(pos, chunkEnd));
    pos = chunkEnd + 1;
  }

  onToken(`[${chunks.length} Abschnitte werden parallel verarbeitet…]\n`);

  // Parallel — all chunks are sent to the API simultaneously
  const results = await Promise.all(
    chunks.map((chunk) => parseChunk(chunk, client, onToken))
  );

  return results.flat();
}
