/**
 * excelHandler.ts
 * Reads the customer Excel database and writes payment columns back.
 */

import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColumnMap {
  kundennummer:  string;
  vertragsnummer: string;
  kundenname:    string;
  sollprovision: string;
  zahlungspalten: string[];
}

export interface CustomerRecord {
  _idx:          number;
  kundennummer:  string;
  vertragsnummer: string;
  kundenname:    string;
  sollprovision: number;
  zahlungen:     Record<string, number>;
  _original:     Record<string, unknown>;
}

export interface ExcelData {
  records:    CustomerRecord[];
  columnMap:  ColumnMap;
  headers:    string[];
  workbook:   XLSX.WorkBook;
  sheetName:  string;
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
  // Try keyword matching first; fall back to positional (column V = index 21)
  const sollCol =
    find(headers, ["sollprovision", "soll", "provision", "erwartet", "umsatz", "expected", "plan"])
    || (headers.length > 21 ? headers[21] : "");

  // Payment columns: keyword match OR everything from column W (index 22) onwards, excluding the soll column
  const byKeyword = headers.filter(isPaymentCol);
  const zahlungspalten = byKeyword.length > 0
    ? byKeyword
    : headers.slice(22).filter(h => h !== sollCol);

  return {
    kundennummer:   find(headers, ["kundennummer", "kundennr", "kunden-nr", "kundenid", "customer"]),
    vertragsnummer: find(headers, ["vertragsnummer", "vertragsnr", "vertrags-nr", "policennr", "policennummer", "contract"]),
    kundenname:     find(headers, ["name", "kundenname", "kunde", "nachname"]),
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

        const records: CustomerRecord[] = raw.map((row, idx) => ({
          _idx:          idx,
          kundennummer:  String(row[columnMap.kundennummer]  ?? "").trim(),
          vertragsnummer: String(row[columnMap.vertragsnummer] ?? "").trim(),
          kundenname:    String(row[columnMap.kundenname]    ?? "").trim(),
          sollprovision: Number(row[columnMap.sollprovision]) || 0,
          zahlungen:     Object.fromEntries(
            columnMap.zahlungspalten
              .map((k) => [k, Number(row[k]) || 0] as [string, number])
              .filter(([, v]) => v > 0)
          ),
          _original: row,
        }));

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

/**
 * Adds a new column `period` to the workbook, fills in matched payments,
 * and triggers a browser download.
 */
export function exportWithPayments(
  data: ExcelData,
  period: string,
  payments: Map<number, number>
): void {
  const sheet = data.workbook.Sheets[data.sheetName];
  const raw   = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const updated = raw.map((row, i) => ({
    ...row,
    [period]: payments.has(i) ? payments.get(i) : "",
  }));

  data.workbook.Sheets[data.sheetName] = XLSX.utils.json_to_sheet(updated);

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(data.workbook, `Provisionen_${period}_${date}.xlsx`);
}
