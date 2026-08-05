import * as cheerio from "cheerio";
import type { MatchDetails, MatchOfficial, MatchPlayer, MatchPlayerStats, MatchVenue, TeamSide } from "../domain/extraction.js";
import { inferMatchUrlContext } from "./matchUrl.js";
import { parseComponentAttributes } from "./smartfireComponents.js";

export interface ParsedMatchPage {
  fallback: MatchDetails;
  fdmCode: string | null;
  directPdfUrl: string | null;
}

export function parseMatchPage(html: string, pageUrl: URL, fdmBaseUrl: string): ParsedMatchPage {
  const warnings: string[] = [];
  const componentData = collectAllComponentData(html, warnings);
  const records = componentData.filter(isRecord);
  const rencontre = findRencontreRecord(records);
  const fdmCode = findStringByKey(records, "fdmCode") ?? findStringByKey(records, "codeFdm");
  const directPdfUrl = findPdfUrl(records);
  const homeLabel = stringValue(rencontre?.equipe1Libelle) || "Home team";
  const awayLabel = stringValue(rencontre?.equipe2Libelle) || "Away team";
  const matchUrl = pageUrl.href;
  const inferred = inferMatchUrlContext(pageUrl);
  const journeeNumero = numberValue(rencontre?.journeeNumero);
  const homeTeam = {
    side: "home" as const,
    label: homeLabel,
    ...(stringValue(rencontre?.equipe1Id) ? { id: stringValue(rencontre?.equipe1Id) } : {}),
  };
  const awayTeam = {
    side: "away" as const,
    label: awayLabel,
    ...(stringValue(rencontre?.equipe2Id) ? { id: stringValue(rencontre?.equipe2Id) } : {}),
  };

  return {
    fdmCode,
    directPdfUrl: directPdfUrl ?? (fdmCode ? deriveFdmPdfUrl(fdmCode, fdmBaseUrl) : null),
    fallback: {
      metadata: {
        matchUrl,
        ...inferred,
        matchCode: stringValue(rencontre?.ext_rencontreId) || inferred.matchCode,
        ...(journeeNumero !== null && inferred.pouleUrl
          ? { journeeUrl: new URL(`journee-${journeeNumero}/`, inferred.pouleUrl).href }
          : {}),
        ...(fdmCode ? { fdmCode } : {}),
        competition: findStringByKey(records, "title") ?? undefined,
        status: stringValue(rencontre?.statut) || undefined,
        scheduledAt: stringValue(rencontre?.date) || null,
      },
      teams: {
        home: homeTeam,
        away: awayTeam,
      },
      score: buildHtmlScore(rencontre),
      venue: buildVenue(records, rencontre),
      officials: buildOfficials(records),
      tableOfficials: [],
      staff: [],
      players: buildHtmlPlayers(records, rencontre, { home: homeTeam, away: awayTeam }),
      timeline: [],
      pdf: {
        available: false,
        parsed: false,
        ...(directPdfUrl || fdmCode ? { url: directPdfUrl ?? deriveFdmPdfUrl(fdmCode ?? "", fdmBaseUrl) } : {}),
      },
      sourceUrls: {
        matchUrl,
        ...(directPdfUrl || fdmCode ? { pdfUrl: directPdfUrl ?? deriveFdmPdfUrl(fdmCode ?? "", fdmBaseUrl) } : {}),
      },
      warnings,
    },
  };
}

export function deriveFdmPdfUrl(fdmCode: string, fdmBaseUrl: string): string {
  const normalized = fdmCode.trim().toUpperCase();
  const path = normalized.slice(0, 4).split("").join("/");
  return new URL(`${path}/${normalized}.pdf`, ensureTrailingSlash(fdmBaseUrl)).href;
}

export function isMatchUrl(url: string): boolean {
  try {
    return /\/rencontre-\d+\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function collectAllComponentData(html: string, warnings: string[]): unknown[] {
  const $ = cheerio.load(html);
  const componentData: unknown[] = [];

  $("smartfire-component").each((_, element) => {
    const name = $(element).attr("name") || "smartfire-component";
    const attributes = $(element).attr("attributes");
    if (!attributes) {
      return;
    }

    const parsed = parseComponentAttributes(attributes, name, warnings);
    if (parsed) {
      componentData.push(parsed);
    }
  });

  return componentData;
}

function findRencontreRecord(records: Record<string, unknown>[]): Record<string, unknown> | null {
  for (const record of records) {
    if (isRecord(record.rencontre)) {
      return record.rencontre;
    }

    if (stringValue(record.ext_rencontreId) || stringValue(record.equipe1Libelle) || stringValue(record.equipe2Libelle)) {
      return record;
    }
  }

  return null;
}

function buildHtmlScore(record: Record<string, unknown> | null): MatchDetails["score"] {
  const homeScore = numberValue(record?.equipe1Score);
  const awayScore = numberValue(record?.equipe2Score);
  if (homeScore === null || awayScore === null) {
    return null;
  }

  const periods = [];
  const homeHalfTimeScore = numberValue(record?.equipe1ScoreMT);
  const awayHalfTimeScore = numberValue(record?.equipe2ScoreMT);
  if (homeHalfTimeScore !== null && awayHalfTimeScore !== null) {
    periods.push({ label: "first_half", homeScore: homeHalfTimeScore, awayScore: awayHalfTimeScore });
  }

  return { homeScore, awayScore, periods };
}

function buildVenue(records: Record<string, unknown>[], rencontre: Record<string, unknown> | null): MatchVenue | null {
  const venue = findRecordByKey(records, "equipement");
  const name =
    stringValue(venue?.libelle) ||
    stringValue(venue?.nom) ||
    stringValue(rencontre?.equipementLibelle) ||
    stringValue(rencontre?.salleLibelle);
  const id = stringValue(venue?.id) || stringValue(rencontre?.equipementId);

  if (!name && !id) {
    return null;
  }

  return {
    ...(id ? { id } : {}),
    name: name || id,
    ...(stringValue(venue?.adresse) ? { address: stringValue(venue?.adresse) } : {}),
  };
}

function buildOfficials(records: Record<string, unknown>[]): MatchOfficial[] {
  const officials: MatchOfficial[] = [];

  for (const rawOfficial of findArraysByKey(records, "arbitres").flat().filter(isRecord)) {
    const name = stringValue(rawOfficial.nom) || stringValue(rawOfficial.libelle) || stringValue(rawOfficial.name);
    if (!name) {
      continue;
    }

    officials.push({
      role: "referee",
      name,
      ...(stringValue(rawOfficial.id) ? { id: stringValue(rawOfficial.id) } : {}),
    });
  }

  return officials;
}

function buildHtmlPlayers(
  records: Record<string, unknown>[],
  rencontre: Record<string, unknown> | null,
  teams: MatchDetails["teams"],
): MatchPlayer[] {
  const rawPlayers = [
    ...findArraysByKey(records, "joueurs").flat(),
    ...findArraysByKey(records, "players").flat(),
    ...findArraysByKey(records, "playerList").flat(),
  ].filter(isRecord);
  const players: MatchPlayer[] = [];
  const seen = new Set<string>();

  for (const rawPlayer of rawPlayers) {
    const teamSide = htmlPlayerSide(rawPlayer, rencontre, teams);
    const number = stringValue(rawPlayer.numero) || stringValue(rawPlayer.num) || stringValue(rawPlayer.numeroMaillot);
    const name = htmlPlayerName(rawPlayer);
    if (!teamSide || !number || !name) {
      continue;
    }

    const id = `${teamSide}:${number}`;
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    const stats = htmlPlayerStats(rawPlayer);
    players.push({
      id,
      teamSide,
      number,
      name,
      stats,
      disqualified: stats.disqualifications > 0,
    });
  }

  return players;
}

function htmlPlayerSide(
  rawPlayer: Record<string, unknown>,
  rencontre: Record<string, unknown> | null,
  teams: MatchDetails["teams"],
): TeamSide | null {
  const side = normalizeSide(
    stringValue(rawPlayer.teamSide) ||
      stringValue(rawPlayer.side) ||
      stringValue(rawPlayer.cote) ||
      stringValue(rawPlayer.typeEquipe),
  );
  if (side) {
    return side;
  }

  const teamId = stringValue(rawPlayer.equipeId) || stringValue(rawPlayer.teamId);
  if (teamId && (teamId === teams.home.id || teamId === stringValue(rencontre?.equipe1Id))) {
    return "home";
  }

  if (teamId && (teamId === teams.away.id || teamId === stringValue(rencontre?.equipe2Id))) {
    return "away";
  }

  return null;
}

function htmlPlayerName(rawPlayer: Record<string, unknown>): string {
  const fullName =
    stringValue(rawPlayer.nomComplet) ||
    stringValue(rawPlayer.libelle) ||
    stringValue(rawPlayer.name) ||
    [stringValue(rawPlayer.nom), stringValue(rawPlayer.prenom)].filter(Boolean).join(" ");

  return fullName.replace(/\s+/g, " ").trim();
}

function htmlPlayerStats(rawPlayer: Record<string, unknown>): MatchPlayerStats {
  return {
    goals: numberValue(rawPlayer.buts) ?? numberValue(rawPlayer.goals) ?? 0,
    sevenMeterGoals: numberValue(rawPlayer.buts7m) ?? numberValue(rawPlayer.sevenMeterGoals) ?? 0,
    shots: numberValue(rawPlayer.tirs) ?? numberValue(rawPlayer.shots) ?? 0,
    saves: numberValue(rawPlayer.arrets) ?? numberValue(rawPlayer.saves) ?? 0,
    warnings: numberValue(rawPlayer.avertissements) ?? numberValue(rawPlayer.warnings) ?? 0,
    twoMinuteSuspensions: numberValue(rawPlayer.exclusions) ?? numberValue(rawPlayer.twoMinuteSuspensions) ?? 0,
    disqualifications: numberValue(rawPlayer.disqualifications) ?? (booleanValue(rawPlayer.disqualifie) ? 1 : 0),
  };
}

function findPdfUrl(records: Record<string, unknown>[]): string | null {
  for (const value of walkValues(records)) {
    if (typeof value !== "string") {
      continue;
    }

    const match = value.match(/https?:\/\/[^\s"'<>]+\.pdf\b/i);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function findStringByKey(records: Record<string, unknown>[], key: string): string | null {
  for (const record of records) {
    for (const [candidateKey, value] of walkEntries(record)) {
      if (candidateKey === key && stringValue(value)) {
        return stringValue(value);
      }
    }
  }

  return null;
}

function findRecordByKey(records: Record<string, unknown>[], key: string): Record<string, unknown> | null {
  for (const record of records) {
    for (const [candidateKey, value] of walkEntries(record)) {
      if (candidateKey === key && isRecord(value)) {
        return value;
      }
    }
  }

  return null;
}

function findArraysByKey(records: Record<string, unknown>[], key: string): unknown[][] {
  const arrays: unknown[][] = [];
  for (const record of records) {
    for (const [candidateKey, value] of walkEntries(record)) {
      if (candidateKey === key && Array.isArray(value)) {
        arrays.push(value);
      }
    }
  }

  return arrays;
}

function* walkEntries(value: unknown): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walkEntries(item);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const entry of Object.entries(value)) {
    yield entry;
    yield* walkEntries(entry[1]);
  }
}

function* walkValues(value: unknown): Generator<unknown> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walkValues(item);
    }
    return;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      yield* walkValues(item);
    }
    return;
  }

  yield value;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value !== "string") {
    return false;
  }

  return /^(1|true|oui|yes|x|d)$/i.test(value.trim());
}

function normalizeSide(value: string): TeamSide | null {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (/\b(home|jr|rec|recevant|equipe1|club recevant)\b/.test(normalized)) {
    return "home";
  }

  if (/\b(away|jv|vis|visiteur|equipe2|club visiteur)\b/.test(normalized)) {
    return "away";
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
