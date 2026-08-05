import type {
  MatchDetails,
  MatchOfficial,
  MatchPlayer,
  MatchPlayerStats,
  MatchScorePeriod,
  MatchTimelineEvent,
  MatchTimelineEventType,
  TeamSide,
} from "../domain/extraction.js";
import { inferMatchUrlContext } from "./matchUrl.js";

export interface MatchSheetParseContext {
  matchUrl: string;
  pdfUrl?: string;
}

interface TeamSection {
  side: TeamSide;
  originalSide: string;
  label: string;
  players: MatchPlayer[];
}

export function parseMatchSheetText(text: string, context: MatchSheetParseContext): MatchDetails {
  const warnings: string[] = [];
  const lines = normalizeLines(text);
  const header = parseHeader(lines);
  const teams = parseTeams(lines, header);
  const periods = parseScorePeriods(lines);
  const sections = parseTeamSections(lines, teams, warnings);
  const players = sections.flatMap((section) => section.players);
  const timeline = linkTimelineEvents(parseTimeline(lines, warnings), players);
  const urlContext = inferMatchUrlContext(context.matchUrl);
  const matchCode = (header.matchCode && !looksLikeFdmCode(header.matchCode) ? header.matchCode : undefined) ?? urlContext.matchCode;
  const fdmCode = header.fdmCode ?? (header.matchCode && looksLikeFdmCode(header.matchCode) ? header.matchCode : undefined);

  if (!matchCode || !teams.home || !teams.away || !header.score || sections.length === 0) {
    throw new Error("Unable to parse core match identity from match sheet PDF text.");
  }

  return {
    metadata: {
      matchUrl: context.matchUrl,
      ...urlContext,
      matchCode,
      ...(fdmCode ? { fdmCode } : {}),
      ...(header.organizer ? { organizer: stripTrailingLicence(header.organizer) } : {}),
      ...(header.competition ? { competition: header.competition } : {}),
      ...(header.poule ? { poule: header.poule } : {}),
      ...(header.group ? { group: header.group } : {}),
      ...(header.status ? { status: header.status } : {}),
      ...(header.scheduledAt ? { scheduledAt: header.scheduledAt } : {}),
    },
    teams: {
      home: {
        side: "home",
        label: teams.home,
        originalSide: sections.find((section) => section.side === "home")?.originalSide,
      },
      away: {
        side: "away",
        label: teams.away,
        originalSide: sections.find((section) => section.side === "away")?.originalSide,
      },
    },
    score: {
      homeScore: header.score.homeScore,
      awayScore: header.score.awayScore,
      periods,
    },
    venue: header.venue ? { name: header.venue } : null,
    officials: parseOfficials(lines),
    tableOfficials: parseTableOfficials(lines, warnings),
    staff: parseStaff(lines, sections),
    players,
    timeline,
    pdf: {
      available: true,
      parsed: true,
      ...(context.pdfUrl ? { url: context.pdfUrl } : {}),
    },
    sourceUrls: {
      matchUrl: context.matchUrl,
      ...(context.pdfUrl ? { pdfUrl: context.pdfUrl } : {}),
    },
    warnings,
  };
}

export function matchDetailsToIndexedText(details: MatchDetails): string {
  const parts = [
    details.metadata.organizer,
    details.metadata.competition,
    details.metadata.poule,
    details.metadata.group,
    details.metadata.matchCode,
    details.metadata.fdmCode,
    details.metadata.status,
    details.teams.home.label,
    details.teams.away.label,
    details.score ? `${details.score.homeScore}-${details.score.awayScore}` : undefined,
    ...details.score?.periods.map((period) => `${period.label} ${period.homeScore}-${period.awayScore}`) ?? [],
    details.venue?.name,
    details.venue?.address,
    ...details.officials.map((official) => `${official.role} ${official.name}`),
    ...details.tableOfficials.map((official) => `${official.role} ${official.name}`),
    ...details.staff.map((official) => `${official.role} ${official.teamSide ?? ""} ${official.name}`),
    ...details.players.map((player) =>
      [
        player.teamSide,
        player.number,
        player.name,
        `goals ${player.stats.goals}`,
        `seven_meter_goals ${player.stats.sevenMeterGoals}`,
        `shots ${player.stats.shots}`,
        `saves ${player.stats.saves}`,
        `warnings ${player.stats.warnings}`,
        `two_minute_suspensions ${player.stats.twoMinuteSuspensions}`,
        `disqualifications ${player.stats.disqualifications}`,
      ].join(" "),
    ),
    ...details.timeline.map((event) =>
      [
        event.period === null ? "" : `period ${event.period}`,
        event.time ?? "",
        event.score ?? "",
        event.teamSide ?? "",
        event.type,
        event.actionText,
        event.playerNumber ?? "",
        event.playerName ?? "",
      ].join(" "),
    ),
  ];

  return sanitizePublicText(parts.filter((part): part is string => Boolean(part)).join("\n"));
}

export function matchDetailsTitle(details: MatchDetails): string {
  const score = details.score ? ` ${details.score.homeScore}-${details.score.awayScore} ` : " vs ";
  return `${details.teams.home.label}${score}${details.teams.away.label}`;
}

function parseHeader(lines: string[]): {
  organizer?: string;
  competition?: string;
  poule?: string;
  group?: string;
  matchCode?: string;
  fdmCode?: string;
  status?: string;
  scheduledAt?: string;
  venue?: string;
  score?: { homeScore: number; awayScore: number };
} {
  const header: ReturnType<typeof parseHeader> = {};

  for (const line of lines) {
    header.organizer ??= capture(line, /^Organisateur:?\s+(.+?)(?:\s+Code\s+Renc\b.*)?$/i);
    header.competition ??= capture(line, /^Comp[ée]tition:?\s+(.+)$/i);
    header.poule ??= capture(line, /^Poule:?\s+(.+?)(?:\s+Groupe\s+(.+))?$/i);
    header.group ??= capture(line, /^Poule:?\s+.+?\s+Groupe\s+(.+)$/i) ?? capture(line, /^Groupe:?\s+(.+)$/i);
    header.matchCode ??= capture(line, /^Code rencontre:?\s+([A-Z0-9-]+)$/i);
    header.fdmCode ??= capture(line, /^Code FDM:?\s+([A-Z0-9-]+)$/i) ?? capture(line, /\bCode Renc\s+([A-Z0-9-]+)\b/i);
    header.status ??= capture(line, /^Statut(?: Match)?\s*:?\s*(.+)$/i);
    header.scheduledAt ??= capture(line, /^Date:?\s+(.+)$/i) ?? capture(line, /^DATE:\s+(.+?)(?:\s+Journ[ée]e\b.*)?$/i);
    header.venue ??= capture(line, /^Lieu:?\s+(.+)$/i) ?? capture(line, /\bSALLE:\s+(.+)$/i);

    const fixtureScore = line.match(/^Score final:\s+.+?\s+(\d+)\s*-\s*(\d+)\s+.+$/i);
    if (fixtureScore) {
      header.score ??= {
        homeScore: Number.parseInt(fixtureScore[1], 10),
        awayScore: Number.parseInt(fixtureScore[2], 10),
      };
    }

    const liveScore = line.match(/^(.+?)\s+\/\s+(.+?)\s+(\d+)\s+(\d+)$/);
    if (liveScore) {
      header.score ??= {
        homeScore: Number.parseInt(liveScore[3], 10),
        awayScore: Number.parseInt(liveScore[4], 10),
      };
    }
  }

  return header;
}

function parseTeams(
  lines: string[],
  header: ReturnType<typeof parseHeader>,
): { home: string | null; away: string | null } {
  let home: string | null = null;
  let away: string | null = null;

  for (const line of lines) {
    const fixtureTeam = line.match(/^Equipe\s+(.+?):\s+(.+)$/i);
    if (fixtureTeam) {
      const side = normalizeSide(fixtureTeam[1]);
      if (side === "home") {
        home ??= fixtureTeam[2].trim();
      } else if (side === "away") {
        away ??= fixtureTeam[2].trim();
      }
    }

    const liveTeam = line.match(/^(.+?)\s+\/\s+(.+?)\s+\d+\s+\d+$/);
    if (liveTeam) {
      home ??= liveTeam[1].trim();
      away ??= liveTeam[2].trim();
    }
  }

  const scoreLine = lines.find((line) => /^Score final:/i.test(line));
  const score = header.score;
  if (scoreLine && score) {
    const escapedHomeScore = escapeRegExp(String(score.homeScore));
    const escapedAwayScore = escapeRegExp(String(score.awayScore));
    const match = scoreLine.match(new RegExp(`^Score final:\\s+(.+?)\\s+${escapedHomeScore}\\s*-\\s*${escapedAwayScore}\\s+(.+)$`, "i"));
    if (match) {
      home ??= match[1].trim();
      away ??= match[2].trim();
    }
  }

  return { home, away };
}

function parseScorePeriods(lines: string[]): MatchScorePeriod[] {
  const periods: MatchScorePeriod[] = [];

  for (const line of lines) {
    const half = line.match(/^Mi-temps:\s+.+?\s+(\d+)\s*-\s*(\d+)\s+.+$/i);
    if (half) {
      periods.push({
        label: "first_half",
        homeScore: Number.parseInt(half[1], 10),
        awayScore: Number.parseInt(half[2], 10),
      });
      continue;
    }

    const period = line.match(/^P[ée]riode\s+(\d+):\s+(\d+)\s*-\s*(\d+)$/i);
    if (period) {
      periods.push({
        label: `period_${period[1]}`,
        homeScore: Number.parseInt(period[2], 10),
        awayScore: Number.parseInt(period[3], 10),
      });
    }
  }

  const detailIndex = lines.findIndex((line) => /^REC\s+VIS\b/i.test(line));
  if (detailIndex !== -1) {
    const scores = lines[detailIndex + 1]?.match(/\b(\d+)\s+(\d+)(?:\s+\d+\s+\d+)?$/);
    if (scores) {
      periods.push({
        label: "period_1",
        homeScore: Number.parseInt(scores[1], 10),
        awayScore: Number.parseInt(scores[2], 10),
      });
    }
  }

  return periods;
}

function parseTeamSections(
  lines: string[],
  teams: { home: string | null; away: string | null },
  warnings: string[],
): TeamSection[] {
  const sections: TeamSection[] = [];
  let current: TeamSection | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fixtureStart = line.match(/^Equipe\s+(.+?):\s+(.+)$/i);
    const liveSide = line.match(/^Club\s+(Recevant|Visiteur)$/i);

    if (fixtureStart) {
      const side = normalizeSide(fixtureStart[1]);
      if (!side) {
        current = null;
        continue;
      }

      current = { side, originalSide: fixtureStart[1].trim(), label: fixtureStart[2].trim(), players: [] };
      sections.push(current);
      continue;
    }

    if (liveSide) {
      const side = normalizeSide(liveSide[1]);
      const label = previousNonCodeLine(lines, index) ?? (side === "home" ? teams.home : teams.away);
      if (!side || !label) {
        current = null;
        continue;
      }

      current = { side, originalSide: liveSide[1], label, players: [] };
      sections.push(current);
      continue;
    }

    if (!current || isRosterHeader(line) || isEmptyRoleLine(line)) {
      continue;
    }

    if (/^(DETAIL|Historique|Déroulé|Deroule)\b/i.test(line)) {
      current = null;
      continue;
    }

    if (/^(Officiel|Kin[ée]|Médecin|Medecin)\b/i.test(line)) {
      continue;
    }

    const player = parsePlayerLine(line, current);
    if (player) {
      current.players.push(player);
    } else if (/^\d+\s+/.test(line) || /^X\s+\d+\s+/.test(line)) {
      warnings.push(`Unable to parse player row: ${sanitizePublicText(line)}`);
    }
  }

  return sections.filter((section) => section.players.length > 0);
}

function parsePlayerLine(line: string, section: TeamSection): MatchPlayer | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  let cursor = 0;
  if (tokens[cursor] === "X") {
    cursor += 1;
  }

  const number = tokens[cursor];
  if (!number || !/^\d{1,3}$/.test(number)) {
    return null;
  }

  const licenceIndex = tokens.findIndex((token, index) => index > cursor && /^\d{6,}$/.test(token));
  if (licenceIndex === -1) {
    return null;
  }

  const fixtureLayout = licenceIndex === cursor + 1;
  const nameStart = fixtureLayout ? licenceIndex + 1 : cursor + 1;
  const statSearchStart = fixtureLayout ? nameStart : licenceIndex + 1;
  const statStart = tokens.findIndex(
    (token, index) => index >= statSearchStart && (/^\d+$/.test(token) || /^X$|^D$/i.test(token)),
  );
  const nameEnd = fixtureLayout ? (statStart === -1 ? tokens.length : statStart) : licenceIndex;
  const nameTokens = tokens.slice(nameStart, nameEnd);
  if (/^[A-Z]{1,3}$/.test(nameTokens.at(-1) ?? "")) {
    nameTokens.pop();
  }

  const name = toName(nameTokens.join(" "));
  if (!name) {
    return null;
  }

  const statTokens = statStart === -1 ? [] : tokens.slice(statStart);
  const stats = parsePlayerStats(statTokens);

  return {
    id: `${section.side}:${number}`,
    teamSide: section.side,
    originalSide: section.originalSide,
    number,
    name,
    stats,
    disqualified: stats.disqualifications > 0,
  };
}

function parsePlayerStats(tokens: string[]): MatchPlayerStats {
  const stats = tokens.filter((token) => /^\d+$|^X$|^D$/i.test(token));
  const numeric = stats.map((token) => (/^X$|^D$/i.test(token) ? 1 : Number.parseInt(token, 10)));
  const disqualified = stats.some((token) => /^X$|^D$/i.test(token)) ? 1 : (numeric[6] ?? 0);

  if (stats.length === 5 && /^X$|^D$/i.test(stats[4] ?? "")) {
    return {
      goals: numeric[0] ?? 0,
      sevenMeterGoals: numeric[1] ?? 0,
      shots: 0,
      saves: numeric[2] ?? 0,
      warnings: numeric[3] ?? 0,
      twoMinuteSuspensions: 0,
      disqualifications: disqualified,
    };
  }

  return {
    goals: numeric[0] ?? 0,
    sevenMeterGoals: numeric[1] ?? 0,
    shots: numeric[2] ?? 0,
    saves: numeric[3] ?? 0,
    warnings: numeric[4] ?? 0,
    twoMinuteSuspensions: numeric[5] ?? 0,
    disqualifications: disqualified,
  };
}

function parseOfficials(lines: string[]): MatchOfficial[] {
  return parseNamedRoles(lines, [
    [/Juge Arbitre 1:?\s+(.+?)(?:\s+Juge Arbitre 2\b.*)?$/i, "referee_1"],
    [/Juge Arbitre 2:?\s+(.+)$/i, "referee_2"],
  ]);
}

function parseTableOfficials(lines: string[], warnings: string[]): MatchOfficial[] {
  return parseNamedRoles(lines, [
    [/Chronom[ée]treur:?\s+(.+?)(?:\s+Juge Arbitre\b.*)?$/i, "chronometreur"],
    [/Secr[ée]taire:?\s+(.+?)(?:\s+Juge Arbitre\b.*)?$/i, "secretaire"],
    [/Tuteur de Table:?\s+(.+)$/i, "tuteur_de_table"],
    [/Accompagnateur:?\s+(.+)$/i, "accompagnateur"],
    [/Responsable de Salle:?\s+(.+)$/i, "responsable_de_salle"],
    [/Juge D[ée]l[ée]gu[ée]:?\s+(.+)$/i, "juge_delegue"],
    [/Speaker:?\s+(.+?)(?:\s+D[ée]l[ée]gu[ée] Officiel\b.*)?$/i, "speaker"],
    [/D[ée]l[ée]gu[ée] Officiel:?\s+(.+)$/i, "delegue_officiel"],
  ], warnings);
}

function parseNamedRoles(lines: string[], patterns: [RegExp, string][], warnings?: string[]): MatchOfficial[] {
  const officials: MatchOfficial[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const [pattern, role] of patterns) {
      const name = stripTrailingLicence(line.match(pattern)?.[1]?.trim() ?? "");
      if (!name) {
        continue;
      }

      if (isPlaceholderRoleName(name)) {
        warnings?.push(`Ignored ${role} row without a public name: ${sanitizePublicText(line)}`);
        continue;
      }

      pushUniqueOfficial(officials, { role, name });
    }

    if (/^Responsable de$/i.test(line) && /^Salle\b/i.test(lines[index + 1] ?? "")) {
      const name = stripTrailingLicence((lines[index + 1] ?? "").replace(/^Salle\b/i, "").trim());
      if (!name || isPlaceholderRoleName(name)) {
        warnings?.push(`Ignored responsable_de_salle row without a public name: ${sanitizePublicText(line)} ${sanitizePublicText(lines[index + 1] ?? "")}`);
        continue;
      }

      pushUniqueOfficial(officials, { role: "responsable_de_salle", name });
    }
  }

  return officials;
}

function pushUniqueOfficial(officials: MatchOfficial[], official: MatchOfficial): void {
  if (!officials.some((candidate) => candidate.role === official.role && candidate.name === official.name)) {
    officials.push(official);
  }
}

function parseStaff(lines: string[], sections: TeamSection[]): MatchOfficial[] {
  const staff: MatchOfficial[] = [];
  let current: TeamSection | null = null;

  for (const line of lines) {
    const fixtureSection = line.match(/^Equipe\s+(.+?):\s+(.+)$/i);
    if (fixtureSection) {
      const side = normalizeSide(fixtureSection[1]);
      current =
        sections.find((candidate) => candidate.side === side && candidate.label === fixtureSection[2].trim()) ??
        sections.find((candidate) => candidate.side === side) ??
        null;
      continue;
    }

    const section = sections.find((candidate) => line === `Equipe ${candidate.originalSide}: ${candidate.label}`);
    if (section) {
      current = section;
      continue;
    }

    const liveSection = line.match(/^Club\s+(Recevant|Visiteur)$/i);
    if (liveSection) {
      const side = normalizeSide(liveSection[1]);
      current = sections.find((candidate) => candidate.side === side) ?? null;
      continue;
    }

    if (!current) {
      continue;
    }

    const match = line.match(/^Officiel(?:\s+Resp)?\s*([A-D])?:?\s+(.+)$/i);
    if (!match) {
      continue;
    }

    const name = stripTrailingLicence(match[2].replace(/\s+[A-Z]$/, "").trim());
    if (!name || isPlaceholderRoleName(name)) {
      continue;
    }

    staff.push({
      role: match[1] ? `officiel_${match[1].toLowerCase()}` : "officiel_responsable",
      name,
      teamSide: current.side,
      originalSide: current.originalSide,
    });
  }

  return staff;
}

function parseTimeline(lines: string[], warnings: string[]): MatchTimelineEvent[] {
  const events: MatchTimelineEvent[] = [];
  let period: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const periodMatch = line.match(/^PERIODE\s+(\d+)$/i);
    if (periodMatch) {
      period = Number.parseInt(periodMatch[1], 10);
      continue;
    }

    const fixture = line.match(/^(\d+)\s+(\d{2}:\d{2})\s+(\d+\s*-\s*\d+)\s+([A-Z]+)\s+(.+)$/i);
    if (fixture) {
      events.push(buildTimelineEvent(Number.parseInt(fixture[1], 10), fixture[2], fixture[3], fixture[4], fixture[5], line));
      continue;
    }

    const live = line.match(/^(\d{2}:\d{2})\s+(\d{2}\s*-\s*\d{2})$/);
    if (live) {
      const action = lines[index + 1] ?? "";
      if (!action || /^-- \d+ of \d+ --$/.test(action)) {
        warnings.push(`Unable to parse timeline row: ${line}`);
        continue;
      }

      events.push(buildTimelineEvent(period, live[1], live[2], null, action, `${line} ${action}`));
      index += 1;
    }
  }

  return events;
}

function buildTimelineEvent(
  period: number | null,
  time: string | null,
  score: string | null,
  sourceSide: string | null,
  actionText: string,
  raw: string,
): MatchTimelineEvent {
  const actionSide = sourceSide ?? actionText.match(/\b(JR|JV|REC|VIS|Recevant|Visiteur)\b/i)?.[1] ?? null;
  const teamSide = normalizeSide(actionSide);
  const player =
    actionText.match(/N[°o]?\s*(\d{1,3})\s+(.+)$/i) ??
    actionText.match(/^(?:But 7m|But|Tir|Arr[êe]t|Avertissement|2MN|Disqualification)\s+(\d{1,3})\s+(.+)$/i);

  return {
    period,
    time,
    score: score?.replace(/\s+/g, "") ?? null,
    teamSide,
    sourceSide: actionSide,
    type: normalizeEventType(actionText),
    actionText,
    playerNumber: player?.[1] ?? null,
    playerName: player ? toName(player[2]) : null,
    playerId: null,
    raw,
  };
}

function linkTimelineEvents(events: MatchTimelineEvent[], players: MatchPlayer[]): MatchTimelineEvent[] {
  const playerIds = new Set(players.map((player) => player.id));

  return events.map((event) => {
    if (!event.teamSide || !event.playerNumber) {
      return event;
    }

    const playerId = `${event.teamSide}:${event.playerNumber}`;
    return {
      ...event,
      playerId: playerIds.has(playerId) ? playerId : null,
    };
  });
}

function normalizeEventType(actionText: string): MatchTimelineEventType {
  const normalized = stripAccents(actionText).toLowerCase();

  if (normalized.includes("temps mort")) {
    return "team_timeout";
  }
  if (normalized.includes("2mn") || normalized.includes("2 min")) {
    return "two_minute_suspension";
  }
  if (normalized.includes("disqualification") || normalized.includes("carton rouge")) {
    return "disqualification";
  }
  if (normalized.includes("avertissement")) {
    return "warning";
  }
  if (normalized.includes("arret")) {
    return "save";
  }
  if (normalized.includes("tir")) {
    return "shot";
  }
  if (normalized.includes("but 7m")) {
    return "seven_meter_goal";
  }
  if (normalized.includes("but")) {
    return "goal";
  }

  return "unknown";
}

function normalizeSide(value: string | null | undefined): TeamSide | null {
  const normalized = stripAccents(value ?? "").toLowerCase();
  if (/\b(jr|rec|recevant|club recevant)\b/.test(normalized)) {
    return "home";
  }

  if (/\b(jv|vis|visiteur|club visiteur)\b/.test(normalized)) {
    return "away";
  }

  return null;
}

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^-- \d+ of \d+ --$/.test(line));
}

function previousNonCodeLine(lines: string[], index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];
    if (/^\d{5,}$/.test(line) || isRosterHeader(line)) {
      continue;
    }

    return line;
  }

  return null;
}

function isRosterHeader(line: string): boolean {
  return /\bLicence\b/i.test(line) && /\bButs\b|\bB\b/i.test(line);
}

function isEmptyRoleLine(line: string): boolean {
  return /^(Officiel [BCD]|Kin[ée]|Médecin|Medecin)$/i.test(line);
}

function stripTrailingLicence(value: string): string {
  return value.replace(/\s+\d{6,}\b.*$/, "").trim();
}

function sanitizePublicText(value: string): string {
  return value.replace(/\b\d{6,}\b/g, "").replace(/\s+/g, " ").trim();
}

function toName(value: string): string {
  return stripTrailingLicence(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\p{L}+/gu, (part) => part.charAt(0).toUpperCase() + part.slice(1));
}

function capture(line: string, pattern: RegExp): string | undefined {
  return line.match(pattern)?.[1]?.trim() || undefined;
}

function looksLikeFdmCode(value: string | undefined): value is string {
  return Boolean(value && /^[A-Z]{4,}[A-Z0-9]*$/.test(value));
}

function isPlaceholderRoleName(value: string): boolean {
  return /^(Juge|Resp|A|B|C|D|Officiel|D[ée]l[ée]gu[ée](?: Officiel)?|Speaker)$/i.test(stripAccents(value).trim());
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
