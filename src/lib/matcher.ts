/**
 * matcher.ts
 * Reconciles PDF commission entries against the Excel customer database.
 */

import type { CommissionEntry } from "./claudeParser";
import type { CustomerRecord }  from "./excelHandler";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchStatus =
  | "exact"             // Vertragsnummer matched
  | "partial"           // Kundennummer matched (no Vertragsnummer)
  | "unmatched_pdf"     // In PDF but not in Excel → new / unknown contract
  | "unmatched_excel";  // In Excel but not in PDF → payment missing!

export interface MatchResult {
  status:       MatchStatus;
  pdfEntry?:    CommissionEntry;
  customer?:    CustomerRecord;
  sollProvision: number;
  istProvision:  number;
  delta:         number; // ist - soll
}

export interface Summary {
  totalSoll:           number;
  totalIst:            number;
  delta:               number;
  matchRate:           number; // 0..1
  exactCount:          number;
  partialCount:        number;
  unmatchedPdfCount:   number;
  unmatchedExcelCount: number;
}

// ─── Key normalisation ────────────────────────────────────────────────────────

function key(s: string) {
  return s.replace(/[\s\-_.]/g, "").toLowerCase();
}

// ─── Reconcile ────────────────────────────────────────────────────────────────

export function reconcile(
  pdf:       CommissionEntry[],
  customers: CustomerRecord[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const claimed = new Set<number>();

  for (const entry of pdf) {
    const vKey = key(entry.vertragsnummer);
    const kKey = key(entry.kundennummer);

    // 1. Exact Vertragsnummer match
    if (vKey) {
      const match = customers.find((c) => key(c.vertragsnummer) === vKey);
      if (match) {
        claimed.add(match._idx);
        results.push(row("exact", entry, match));
        continue;
      }
    }

    // 2. Kundennummer fallback
    if (kKey) {
      const match = customers.find(
        (c) => key(c.kundennummer) === kKey && !claimed.has(c._idx)
      );
      if (match) {
        claimed.add(match._idx);
        results.push(row("partial", entry, match));
        continue;
      }
    }

    // 3. No match
    results.push({
      status:        "unmatched_pdf",
      pdfEntry:      entry,
      sollProvision: 0,
      istProvision:  entry.betrag,
      delta:         entry.betrag,
    });
  }

  // Excel rows with no payment found
  for (const c of customers) {
    if (!claimed.has(c._idx)) {
      results.push({
        status:        "unmatched_excel",
        customer:      c,
        sollProvision: c.sollprovision,
        istProvision:  0,
        delta:         -c.sollprovision,
      });
    }
  }

  return results;
}

export function summarise(results: MatchResult[]): Summary {
  const exactCount          = results.filter((r) => r.status === "exact").length;
  const partialCount        = results.filter((r) => r.status === "partial").length;
  const unmatchedPdfCount   = results.filter((r) => r.status === "unmatched_pdf").length;
  const unmatchedExcelCount = results.filter((r) => r.status === "unmatched_excel").length;

  const totalSoll = results.reduce((s, r) => s + r.sollProvision, 0);
  const totalIst  = results.reduce((s, r) => s + r.istProvision,  0);
  const matched   = exactCount + partialCount;

  return {
    totalSoll,
    totalIst,
    delta:               totalIst - totalSoll,
    matchRate:           results.length > 0 ? matched / results.length : 0,
    exactCount,
    partialCount,
    unmatchedPdfCount,
    unmatchedExcelCount,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function row(
  status:   "exact" | "partial",
  entry:    CommissionEntry,
  customer: CustomerRecord
): MatchResult {
  return {
    status,
    pdfEntry:      entry,
    customer,
    sollProvision: customer.sollprovision,
    istProvision:  entry.betrag,
    delta:         entry.betrag - customer.sollprovision,
  };
}
