/**
 * pdfExtractor.ts
 * Extracts plain text from a PDF file using pdfjs-dist (runs entirely in the browser).
 */

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

// new URL() lässt Vite die Worker-Datei korrekt auflösen
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;

  let result = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    let prevY: number | null = null;
    let line = "";

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const it = item as { str: string; transform: number[] };
      const y = Math.round(it.transform[5]);

      if (prevY !== null && Math.abs(y - prevY) > 3) {
        result += line.trimEnd() + "\n";
        line = "";
      }
      line += it.str + " ";
      prevY = y;
    }

    result += line.trimEnd() + "\n\n";
  }

  return result.trim();
}
