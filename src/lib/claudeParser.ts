/**
 * claudeParser.ts
 * Calls the Anthropic API directly from the browser to parse raw PDF text
 * into structured commission entries. Requires an API key stored in localStorage.
 * Large PDFs are processed in chunks to handle 1000+ entries.
 */

import Anthropic from "@anthropic-ai/sdk";

export const API_KEY_STORAGE = "provision_anthropic_key";
export const MODEL_STORAGE   = "provision_model";
export const DEFAULT_MODEL   = "claude-sonnet-4-6";

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? "";
}

export function saveApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
}

export function saveModel(model: string) {
  localStorage.setItem(MODEL_STORAGE, model);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommissionEntry {
  vertragsnummer: string;
  kundennummer:   string;
  kundenname:     string;
  betrag:         number;   // Provisionsbetrag in EUR
  periode:        string;   // "YYYY-MM"
  produkt:        string;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const SYSTEM = `Du bist Spezialist für Versicherungs-Provisionsabrechnungen.
Analysiere den Text und extrahiere ALLE Provisionseinträge.
Antworte ausschließlich mit einem validen JSON-Array, ohne Erklärung oder Codeblock.
Jedes Objekt hat genau diese Felder:
{
  "vertragsnummer": "string",
  "kundennummer":   "string",
  "kundenname":     "string",
  "betrag":         number,
  "periode":        "YYYY-MM",
  "produkt":        "string"
}
Fehlende Werte: "" oder 0. "betrag" ist immer eine Zahl, nie ein String.`;

// Chunk-Größe: ~70.000 Zeichen ≈ 12–15 PDF-Seiten pro API-Aufruf
const CHUNK_SIZE = 70_000;

function normalizeEntry(e: CommissionEntry): CommissionEntry {
  return {
    vertragsnummer: String(e.vertragsnummer ?? "").trim(),
    kundennummer:   String(e.kundennummer   ?? "").trim(),
    kundenname:     String(e.kundenname     ?? "").trim(),
    betrag:         Number(e.betrag)  || 0,
    periode:        String(e.periode  ?? "").trim(),
    produkt:        String(e.produkt  ?? "").trim(),
  };
}

/**
 * Rettet vollständige JSON-Objekte aus einer abgeschnittenen Array-Antwort.
 */
function recoverPartialJson(raw: string): CommissionEntry[] {
  const results: CommissionEntry[] = [];
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const obj = JSON.parse(m[0]) as CommissionEntry;
      if (obj.vertragsnummer !== undefined || obj.betrag !== undefined) {
        results.push(normalizeEntry(obj));
      }
    } catch { /* unvollständiges Objekt überspringen */ }
  }
  return results;
}

/**
 * Einen einzelnen Text-Abschnitt an Claude schicken und Einträge extrahieren.
 */
async function parseChunk(
  text: string,
  client: Anthropic,
  onToken: (delta: string) => void
): Promise<CommissionEntry[]> {
  let raw = "";

  const stream = await client.messages.stream({
    model:      getModel(),
    max_tokens: 64000,
    system:     SYSTEM,
    messages:   [{ role: "user", content: `Provisionsabrechnung:\n\n${text}` }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      raw += event.delta.text;
      onToken(event.delta.text);
    }
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    const recovered = recoverPartialJson(raw);
    return recovered;
  }

  const entries = JSON.parse(match[0]) as CommissionEntry[];
  return entries.map(normalizeEntry);
}

/**
 * Haupt-Einstiegspunkt: verarbeitet auch sehr große PDFs durch Aufteilung in Abschnitte.
 */
export async function parseCommissionPdf(
  pdfText: string,
  onToken: (delta: string) => void
): Promise<CommissionEntry[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein Anthropic API-Key konfiguriert.");

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // Kleines PDF → ein einziger API-Aufruf
  if (pdfText.length <= CHUNK_SIZE) {
    return parseChunk(pdfText, client, onToken);
  }

  // Großes PDF → in Abschnitte aufteilen, an Zeilenumbrüchen trennen
  const chunks: string[] = [];
  let pos = 0;
  while (pos < pdfText.length) {
    const end = Math.min(pos + CHUNK_SIZE, pdfText.length);
    // Am letzten Zeilenumbruch vor dem Limit trennen → keine Zeile wird zerrissen
    const boundary = pdfText.lastIndexOf("\n", end);
    const chunkEnd  = boundary > pos ? boundary : end;
    chunks.push(pdfText.slice(pos, chunkEnd));
    pos = chunkEnd + 1;
  }

  const allEntries: CommissionEntry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onToken(`\n[Abschnitt ${i + 1} / ${chunks.length} wird analysiert…]\n`);
    const entries = await parseChunk(chunks[i], client, onToken);
    allEntries.push(...entries);
  }

  return allEntries;
}
