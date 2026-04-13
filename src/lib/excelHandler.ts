/**
 * excelHandler.ts
 * Reads the customer Excel database and writes payment columns back.
 * Column layout (0-indexed):
 *   M = index 12  → Zahlweise
 *   T = index 19  → Soll-Provision
 *   U = index 20+ → Payment history / matching results
 */

import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColumnMap {
  kundennummer:   string;
  vertragsnummer: string;
  kundenname:     string;
  vorname:        string;
  zahlweise:      string;
  sollprovision:  string;
  zahlungspalten: string[];
}

export interface CustomerRecord {
  _idx:           number;
  kundennummer:   string;
  vertragsnummer: string;
  kundenname:     string;
  zahlweise:      string;
  sollprovision:  number;
  zahlungen:      Record<string, number>;
  _original:      Record<string, unknown>;
}

export interface ExcelData {
  records:   CustomerRecord[];
  columnMap: ColumnMap;
  headers:   string[];
  workbook:  XLSX.WorkBook;
  sheetName: string;
}

// ─── Column detection ─────────────────────────────────────────────────────────

function norm(s: string) {
  return s.toLowerCase().replace(/[\s\-_.()]/g, "");
}

function find(headers: string[], keywords: string[]): string {
  return headers.find((h) => keywords.some((k) => norm(h).includes(norm(k)))) ?? "";
}

const MONTH_DE = ["jan", "feb", "mär", "mar", "apr", "mai", "may", "jun",
                  "jul", "aug", "sep", "okt", "oct", "nov", "dez", "dec"];

function isPaymentCol(h: string) {
  return /20\d\d/.test(h) || MONTH_DE.some((m) => h.toLowerCase().startsWith(m));
}

function detectColumns(headers: string[]): ColumnMap {
  // Soll-Provision: keyword → positional fallback column T (index 19)
  const sollCol =
    find(headers, ["sollprovision", "soll", "umsatz in eur", "umsatz", "provision", "erwartet", "expected", "plan"])
    || (headers.length > 19 ? headers[19] : "");

  // Zahlweise: keyword → positional fallback column M (index 12)
  const zahlweiseCol =
    find(headers, ["zahlweise", "zahlungsweise", "zahlungsart", "zahlperiode", "payment freq", "frequenz"])
    || (headers.length > 12 ? headers[12] : "");

  // Payment history columns: keyword → from column U (index 20) onwards
  const byKeyword = headers.filter(isPaymentCol);
  const zahlungspalten = byKeyword.length > 0
    ? byKeyword
    : headers.slice(20).filter(h => h !== sollCol && h !== zahlweiseCol);

  // Name detection: avoid matching "Vorname" as the nachname column
  const vornameCol   = find(headers, ["vorname", "firstname", "rufname"]);
  const nachnameKeys = ["kundenname", "nachname", "familienname", "lastname", "surname"];
  // Only use generic "name" keyword if nothing more specific was found
  let nachnameCol = find(headers, nachnameKeys);
  if (!nachnameCol) {
    nachnameCol = headers.find(
      (h) => norm(h).includes("name") && h !== vornameCol
    ) ?? "";
  }

  return {
    kundennummer:   find(headers, ["kundennummer", "kundennr", "kunden-nr", "kundenid", "customer"]),
    vertragsnummer: find(headers, ["vertragsnummer", "vertragsnr", "vertrags-nr", "policennr", "policennummer", "contract"]),
    kundenname:     nachnameCol,
    vorname:        vornameCol,
    zahlweise:      zahlweiseCol,
    sollprovision:  sollCol,
    zahlungspalten,
  };
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseExcel(file: File): Promise<ExcelData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buf  = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(buf, { type: "array", cellDates: true });
        const name = wb.SheetNames[0];
        const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          wb.Sheets[name], { defval: "" }
        );

        if (!raw.length) throw new Error("Excel-Datei enthält keine Daten.");

        const headers   = Object.keys(raw[0]);
        const columnMap = detectColumns(headers);

        const records: CustomerRecord[] = raw.map((row, idx) => {
          const nachnameVal = String(row[columnMap.kundenname] ?? "").trim();
          // Combine vorname + nachname only if they are different columns
          const vornameVal = (columnMap.vorname && columnMap.vorname !== columnMap.kundenname)
            ? String(row[columnMap.vorname] ?? "").trim()
            : "";
          const fullName = vornameVal && nachnameVal
            ? `${vornameVal} ${nachnameVal}`
            : nachnameVal || vornameVal;

          return {
            _idx:           idx,
            kundennummer:   String(row[columnMap.kundennummer]   ?? "").trim(),
            vertragsnummer: String(row[columnMap.vertragsnummer] ?? "").trim(),
            kundenname:     fullName,
            zahlweise:      String(row[columnMap.zahlweise]      ?? "").trim(),
            sollprovision:  Number(row[columnMap.sollprovision])  || 0,
            zahlungen:      Object.fromEntries(
              columnMap.zahlungspalten
                .map((k) => [k, Number(row[k]) || 0] as [string, number])
                .filter(([, v]) => v > 0)
            ),
            _original: row,
          };
        });

        resolve({ records, columnMap, headers, workbook: wb, sheetName: name });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportWithPayments(
  data: ExcelData,
  period: string,
  payments: Map<number, number>
): void {
  const sheet  = data.workbook.Sheets[data.sheetName];
  const raw    = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const updated = raw.map((row, i) => ({
    ...row,
    [period]: payments.has(i) ? payments.get(i) : "",
  }));

  data.workbook.Sheets[data.sheetName] = XLSX.utils.json_to_sheet(updated);

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(data.workbook, `Provisionen_${period}_${date}.xlsx`);
}
