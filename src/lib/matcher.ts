/**
 * matcher.ts
 * Reconciles PDF commission entries against the Excel customer database.
 *
 * Matching priority:
 *   1. Exact Vertragsnummer  (+ leading-zero fallback)
 *   2. Kundennummer          (allows same customer to appear multiple times in PDF)
 *
 * Control flags per row:
 *   ok         – matched, amount within ±5% of Soll
 *   overpaid   – Ist > Soll + €0.50
 *   underpaid  – 0 < Ist < Soll - €0.50  (installment or partial)
 *   unexpected – Soll = 0, Ist > 0        (no expectation, payment received)
 *   missing    – Soll > 0, Ist = 0        (expected but nothing paid)
 */

import type { CommissionEntry } from "./claudeParser";
import type { CustomerRecord }  from "./excelHandler";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchStatus =
  | "exact"             // Vertragsnummer matched
  | "partial"           // Kundennummer matched (no Vertragsnummer)
  | "unmatched_pdf"     // In PDF but not in Excel → unknown contract
  | "unmatched_excel";  // In Excel but not in PDF → no payment

export type ControlFlag =
  | "ok"
  | "overpaid"
  | "underpaid"
  | "unexpected"
  | "missing";

export interface MatchResult {
  status:        MatchStatus;
  controlFlag:   ControlFlag;
  pdfEntry?:     CommissionEntry;
  customer?:     CustomerRecord;
  sollProvision: number;
  istProvision:  number;
  delta:         number;          // ist - soll
  positionCount: number;          // how many PDF lines were summed into this row
}

export interface Summary {
  totalPdf:             number;   // Sum of ALL PDF entries (insurer's total)
  matchedAmount:        number;   // Sum of PDF entries matched to a customer
  unknownAmount:        number;   // Sum of PDF entries with no customer found
  totalSoll:            number;   // Sum of Soll for all matched customers (unique)
  missingSoll:          number;   // Sum of Soll for customers with no payment
  matchRateByAmount:    number;   // matchedAmount / totalPdf  (0..1)
  exactCount:           number;
  partialCount:         number;
  unmatchedPdfCount:    number;
  unmatchedExcelCount:  number;
  overpaidCount:        number;
  underpaidCount:       number;
  unexpectedCount:      number;
}

// ─── Key normalisation ────────────────────────────────────────────────────────

/** Strip common separators and lowercase */
function key(s: string): string {
  return s.replace(/[\s\-_./:\\]/g, "").toLowerCase();
}

/** Key without leading zeros (numeric-only strings) */
function keyNoLeadingZeros(s: string): string {
  const k = key(s);
  return /^\d+$/.test(k) ? k.replace(/^0+/, "") || k : k;
}

function keysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ka = key(a), kb = key(b);
  if (ka === kb) return true;
  // Leading-zero fallback for purely numeric IDs
  return keyNoLeadingZeros(a) === keyNoLeadingZeros(b);
}

// ─── Flag ─────────────────────────────────────────────────────────────────────

function computeFlag(soll: number, ist: number): ControlFlag {
  if (soll === 0 && ist > 0)   return "unexpected";
  if (soll > 0  && ist === 0)  return "missing";
  if (ist > soll + 0.50)       return "overpaid";
  if (ist < soll - 0.50)       return "underpaid";
  return "ok";
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Multiple PDF lines for the same Vertragsnummer (or Kundennummer as fallback)
 * are summed into one entry before matching.
 * This handles corrections, partial payments and multi-position invoices.
 */
function groupEntries(entries: CommissionEntry[]): CommissionEntry[] {
  const map = new Map<string, CommissionEntry & { _count: number }>();

  for (const e of entries) {
    const vk = key(e.vertragsnummer);
    const kk = key(e.kundennummer);
    // Primary key: Vertragsnummer; fallback: Kundennummer; last resort: unique entry
    const groupKey = vk || kk || `__${map.size}`;

    const existing = map.get(groupKey);
    if (existing) {
      existing.betrag += e.betrag;
      existing._count += 1;
      // Keep first entry's periode/produkt/name unless empty
      if (!existing.periode && e.periode) existing.periode = e.periode;
      if (!existing.produkt && e.produkt) existing.produkt = e.produkt;
      if (!existing.kundenname && e.kundenname) existing.kundenname = e.kundenname;
    } else {
      map.set(groupKey, { ...e, _count: 1 });
    }
  }

  return [...map.values()];
}

// ─── Reconcile ────────────────────────────────────────────────────────────────

export function reconcile(
  pdf:       CommissionEntry[],
  customers: CustomerRecord[]
): MatchResult[] {
  const results: MatchResult[] = [];
  // Tracks customers that received ≥1 payment (for unmatched_excel detection)
  const claimed = new Set<number>();

  // Group multi-position entries first
  const grouped = groupEntries(pdf) as (CommissionEntry & { _count: number })[];

  for (const entry of grouped) {
    const posCount = entry._count ?? 1;
    // ── 1. Vertragsnummer
    if (entry.vertragsnummer) {
      const match = customers.find((c) => keysMatch(c.vertragsnummer, entry.vertragsnummer));
      if (match) {
        claimed.add(match._idx);
        results.push(buildRow("exact", entry, match, posCount));
        continue;
      }
    }

    // ── 2. Kundennummer fallback (not exclusive — multiple payments per customer allowed)
    if (entry.kundennummer) {
      const match = customers.find((c) => keysMatch(c.kundennummer, entry.kundennummer));
      if (match) {
        claimed.add(match._idx);
        results.push(buildRow("partial", entry, match, posCount));
        continue;
      }
    }

    // ── 3. No match
    results.push({
      status:        "unmatched_pdf",
      controlFlag:   "unexpected",
      pdfEntry:      entry,
      sollProvision: 0,
      istProvision:  entry.betrag,
      delta:         entry.betrag,
      positionCount: posCount,
    });
  }

  // ── 4. Customers with no payment at all
  for (const c of customers) {
    if (!claimed.has(c._idx)) {
      results.push({
        status:        "unmatched_excel",
        controlFlag:   "missing",
        customer:      c,
        sollProvision: c.sollprovision,
        istProvision:  0,
        delta:         -c.sollprovision,
        positionCount: 0,
      });
    }
  }

  return results;
}

export function summarise(results: MatchResult[]): Summary {
  const exactCount         = results.filter((r) => r.status === "exact").length;
  const partialCount       = results.filter((r) => r.status === "partial").length;
  const unmatchedPdfCount  = results.filter((r) => r.status === "unmatched_pdf").length;
  const unmatchedExcelCount = results.filter((r) => r.status === "unmatched_excel").length;

  // Amount totals
  const totalPdf      = results
    .filter((r) => r.pdfEntry)
    .reduce((s, r) => s + r.istProvision, 0);

  const matchedAmount = results
    .filter((r) => r.status === "exact" || r.status === "partial")
    .reduce((s, r) => s + r.istProvision, 0);

  const unknownAmount = results
    .filter((r) => r.status === "unmatched_pdf")
    .reduce((s, r) => s + r.istProvision, 0);

  // Soll: deduplicated by unique customer (avoid double-counting multi-payment customers)
  const matchedCustomerIdxs = new Set(
    results
      .filter((r) => (r.status === "exact" || r.status === "partial") && r.customer)
      .map((r) => r.customer!._idx)
  );
  const customerMap = new Map(
    results
      .filter((r) => r.customer)
      .map((r) => [r.customer!._idx, r.customer!])
  );
  const totalSoll   = [...matchedCustomerIdxs].reduce((s, idx) => s + (customerMap.get(idx)?.sollprovision ?? 0), 0);
  const missingSoll = results
    .filter((r) => r.status === "unmatched_excel")
    .reduce((s, r) => s + r.sollProvision, 0);

  return {
    totalPdf,
    matchedAmount,
    unknownAmount,
    totalSoll,
    missingSoll,
    matchRateByAmount:   totalPdf > 0 ? matchedAmount / totalPdf : 0,
    exactCount,
    partialCount,
    unmatchedPdfCount,
    unmatchedExcelCount,
    overpaidCount:   results.filter((r) => r.controlFlag === "overpaid").length,
    underpaidCount:  results.filter((r) => r.controlFlag === "underpaid").length,
    unexpectedCount: results.filter((r) => r.controlFlag === "unexpected").length,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function buildRow(
  status:       "exact" | "partial",
  entry:        CommissionEntry,
  customer:     CustomerRecord,
  positionCount = 1
): MatchResult {
  const soll = customer.sollprovision;
  const ist  = entry.betrag;
  return {
    status,
    controlFlag:   computeFlag(soll, ist),
    pdfEntry:      entry,
    customer,
    sollProvision: soll,
    istProvision:  ist,
    delta:         ist - soll,
    positionCount,
  };
}
