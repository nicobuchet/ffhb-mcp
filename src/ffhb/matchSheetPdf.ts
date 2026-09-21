import { PDFParse } from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { MatchPlayerStats } from "../domain/extraction.js";

export interface MatchSheetSource {
  text: string;
  // Used only to join the two extraction passes; never included in public output.
  playerStatsByLicence?: ReadonlyMap<string, MatchPlayerStats>;
}

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
}

const statHeaders: Record<string, keyof MatchPlayerStats> = {
  buts: "goals", "7m": "sevenMeterGoals", tirs: "shots", arrets: "saves",
  "av.": "warnings", "2'": "twoMinuteSuspensions", dis: "disqualifications",
};

export async function extractMatchSheetPdf(data: Uint8Array): Promise<MatchSheetSource> {
  // PDF.js transfers its input buffer to its worker. Each pass owns a copy.
  const parser = new PDFParse({ data: data.slice() });
  let text: string;
  try {
    text = (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }

  const task = getDocument({ data: data.slice(), verbosity: 0 });
  const playerStatsByLicence = new Map<string, MatchPlayerStats>();
  try {
    const document = await task.promise;
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items: PositionedText[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim() || item.transform[1] !== 0 || item.transform[2] !== 0) continue;
        items.push({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width });
      }
      collectPlayerStats(items, playerStatsByLicence);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { text, playerStatsByLicence };
}

function collectPlayerStats(items: PositionedText[], result: Map<string, MatchPlayerStats>): void {
  const rows: PositionedText[][] = [];
  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y - item.y) < 1) row.push(item);
    else rows.push([item]);
  }

  let header: PositionedText[] | undefined;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // Some PDFs emit the "7m" header as adjacent "7" and "m" fragments.
    const cells: PositionedText[] = [];
    for (const item of row) {
      const previous = cells.at(-1);
      if (previous && item.x - (previous.x + previous.width) < 1) {
        previous.text += item.text;
        previous.width = item.x + item.width - previous.x;
      } else cells.push({ ...item });
    }
    if (cells.some((cell) => cell.text === "Licence") && cells.some((cell) => cell.text === "Buts")) {
      // Reject incomplete headers rather than guessing where the missing columns lie.
      header = Object.keys(statHeaders).every((key) => cells.some((cell) => normalizeHeader(cell.text) === key))
        ? cells : undefined;
      continue;
    }
    if (!header) continue;

    const columns = header;
    const values = columns.map((column, index) => {
      const center = column.x + column.width / 2;
      const before = columns[index - 1];
      const after = columns[index + 1];
      const left = before ? (before.x + before.width / 2 + center) / 2 : -Infinity;
      const right = after ? (after.x + after.width / 2 + center) / 2 : Infinity;
      const identifier = /^N[°º]$/i.test(column.text) ? /^\d{1,3}$/
        : column.text === "Licence" ? /^\d{6,}$/ : undefined;
      return row.filter((item) => {
        const x = item.x + item.width / 2;
        return x >= left && x < right && (!identifier || identifier.test(item.text));
      }).map((item) => item.text).join("").trim();
    });
    const licence = values[header.findIndex((cell) => cell.text === "Licence")];
    const shirt = values[header.findIndex((cell) => /^N[°º]$/i.test(cell.text))];
    if (!/^\d{6,}$/.test(licence ?? "") || !/^\d{1,3}$/.test(shirt ?? "")) continue;

    const stats: MatchPlayerStats = {
      goals: 0, sevenMeterGoals: 0, shots: 0, saves: 0,
      warnings: 0, twoMinuteSuspensions: 0, disqualifications: 0,
    };
    let valid = true;
    for (let index = 0; index < header.length; index += 1) {
      const key = statHeaders[normalizeHeader(header[index].text)];
      if (!key) continue;
      const value = values[index];
      const discipline = key === "warnings" || key === "twoMinuteSuspensions" || key === "disqualifications";
      if (value === "") continue;
      if (/^\d+$/.test(value)) stats[key] = Number.parseInt(value, 10);
      else if (discipline && /^[XD]$/i.test(value)) stats[key] = 1;
      else valid = false;
    }
    if (valid) result.set(licence, stats);
  }
}

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
