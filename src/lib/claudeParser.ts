/**
 * claudeParser.ts
 * Calls the Anthropic API directly from the browser to parse raw PDF text
 * into structured commission entries. Requires an API key stored in localStorage.
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

/**
 * Rettet vollständige JSON-Objekte aus einer abgeschnittenen Array-Antwort.
 * Nützlich wenn max_tokens die Antwort mittendrin abbricht.
 */
function recoverPartialJson(raw: string): CommissionEntry[] {
  const results: CommissionEntry[] = [];
  // Alle vollständigen {...} Objekte extrahieren
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const obj = JSON.parse(m[0]) as CommissionEntry;
      if (obj.vertragsnummer !== undefined || obj.betrag !== undefined) {
        results.push({
          vertragsnummer: String(obj.vertragsnummer ?? "").trim(),
          kundennummer:   String(obj.kundennummer   ?? "").trim(),
          kundenname:     String(obj.kundenname     ?? "").trim(),
          betrag:         Number(obj.betrag)  || 0,
          periode:        String(obj.periode  ?? "").trim(),
          produkt:        String(obj.produkt  ?? "").trim(),
        });
      }
    } catch {
      // unvollständiges Objekt überspringen
    }
  }
  return results;
}

export async function parseCommissionPdf(
  pdfText: string,
  onToken: (delta: string) => void
): Promise<CommissionEntry[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein Anthropic API-Key konfiguriert.");

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // 21-seitige PDFs können 80.000+ Zeichen haben – großzügiges Limit setzen
  const truncated =
    pdfText.length > 90_000
      ? pdfText.slice(0, 90_000) + "\n[… Text gekürzt]"
      : pdfText;

  let raw = "";

  const stream = await client.messages.stream({
    model:      getModel(),
    max_tokens: 32000,   // für PDFs mit mehreren hundert Einträgen
    system:     SYSTEM,
    messages:   [{ role: "user", content: `Provisionsabrechnung:\n\n${truncated}` }],
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

  // Vollständiges JSON-Array suchen
  let match = raw.match(/\[[\s\S]*\]/);

  // Fallback: Antwort wurde abgeschnitten → alle vollständigen Objekte retten
  if (!match) {
    const recovered = recoverPartialJson(raw);
    if (recovered.length > 0) {
      return recovered;
    }
    throw new Error("Keine strukturierten Einträge erkannt.\nRohausgabe:\n" + raw.slice(0, 400));
  }

  const entries = JSON.parse(match[0]) as CommissionEntry[];

  return entries.map((e) => ({
    vertragsnummer: String(e.vertragsnummer ?? "").trim(),
    kundennummer:   String(e.kundennummer   ?? "").trim(),
    kundenname:     String(e.kundenname     ?? "").trim(),
    betrag:         Number(e.betrag)  || 0,
    periode:        String(e.periode  ?? "").trim(),
    produkt:        String(e.produkt  ?? "").trim(),
  }));
}
