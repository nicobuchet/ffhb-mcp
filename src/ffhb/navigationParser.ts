import type {
  CompetitionDetails,
  CompetitionMetadata,
  CompetitionNavigation,
  CompetitionPhase,
  CompetitionSearchResult,
  JourneeNavigationItem,
  MatchNavigationItem,
  MatchResult,
  MatchTeam,
  NavigationItem,
  PouleNavigationItem,
  SeasonNavigationItem,
} from "../domain/navigation.js";
import { errorMessage } from "./errors.js";
import { collectComponentData } from "./smartfireComponents.js";

const COMPETITION_COMPONENT_NAMES = new Set([
  "competitions---search-bar",
  "competitions---saison-selector",
  "competitions---competition-main-menu",
]);

const COMPETITION_DETAILS_COMPONENT_NAMES = new Set([
  "page-header",
  "competitions---poule-selector",
  "competitions---journee-selector",
  "competitions---rencontre-list",
]);

const COMPETITION_TYPE_LABELS = new Map<string, string>([
  ["NATIONAL", "National"],
  ["REGIONAL", "Regional"],
  ["DEPARTEMENTAL", "Departemental"],
  ["COUPE_DE_FRANCE", "Coupe de France"],
]);

export function parseCompetitionNavigation(html: string, pageUrl: URL): CompetitionNavigation {
  const warnings: string[] = [];
  const componentData = collectComponentData(html, COMPETITION_COMPONENT_NAMES, warnings);

  if (componentData.length === 0) {
    throw new Error(`Unable to interpret FFHandball competition navigation from ${pageUrl.href}`);
  }

  const rawSeasons = findFirstRecordArray(componentData, "saisons");
  const rawCurrentSeason = findFirstObject(componentData, "saison");
  const currentSeasonUrl = rawCurrentSeason ? seasonUrl(rawCurrentSeason, pageUrl) : inferSeasonUrl(pageUrl);
  const availableTypes = collectAvailableCompetitionTypes(componentData);
  const competitions = collectCompetitions(componentData, pageUrl);
  const competitionTypes = currentSeasonUrl ? buildCompetitionTypeItems(availableTypes, currentSeasonUrl) : [];
  const seasons = buildSeasonItems(rawSeasons, availableTypes, pageUrl);

  if (rawSeasons.length === 0 && availableTypes.length === 0 && competitions.length === 0) {
    throw new Error(`Unable to interpret FFHandball competition navigation from ${pageUrl.href}`);
  }

  if (rawSeasons.length === 0) {
    warnings.push("No seasons were embedded in the FFHandball competition components.");
  }

  if (availableTypes.length === 0) {
    warnings.push("No competition types were embedded in the FFHandball competition components.");
  }

  return {
    seasons,
    currentSeasonUrl,
    competitionTypes,
    competitions,
    warnings,
  };
}

export function parseCompetitionDetails(html: string, pageUrl: URL): CompetitionDetails {
  const warnings: string[] = [];
  const componentData = collectComponentData(html, COMPETITION_DETAILS_COMPONENT_NAMES, warnings);

  if (componentData.length === 0) {
    throw new Error(`Unable to interpret FFHandball competition details from ${pageUrl.href}`);
  }

  const competition = buildCompetitionMetadata(componentData, pageUrl);
  if (!competition) {
    throw new Error(`Unable to interpret FFHandball competition details from ${pageUrl.href}`);
  }

  const phases = buildPhaseItems(findFirstRecordArray(componentData, "phases"), competition.url);
  const poules = buildPouleItems(findFirstRecordArray(componentData, "poules"), phases, competition.url, warnings);
  const journees = buildJourneeItems(componentData, poules, pageUrl, warnings);
  const matches = buildMatchItems(componentData, poules, journees, pageUrl, warnings);

  if (phases.length === 0) {
    warnings.push("No phases were embedded in the FFHandball competition components.");
  }

  if (poules.length === 0) {
    warnings.push("No poules were embedded in the FFHandball competition components.");
  }

  return {
    competition,
    phases,
    poules,
    journees,
    matches,
    warnings,
  };
}

export function competitionTypeSlug(competitionType: string): string {
  const normalized = normalizeCompetitionType(competitionType);
  if (normalized === "COUPE_DE_FRANCE") {
    return "coupe-de-france";
  }

  return normalized.toLowerCase();
}

export function normalizeCompetitionType(competitionType: string): string {
  return competitionType
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[-\s]+/g, "_")
    .toUpperCase();
}

function buildSeasonItems(
  rawSeasons: Record<string, unknown>[],
  availableTypes: string[],
  pageUrl: URL,
): SeasonNavigationItem[] {
  const seen = new Set<string>();
  const seasons: SeasonNavigationItem[] = [];

  for (const rawSeason of rawSeasons) {
    if (stringValue(rawSeason.displayResults) === "0") {
      continue;
    }

    const label = stringValue(rawSeason.libelle);
    const url = seasonUrl(rawSeason, pageUrl);
    if (!label || !url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    seasons.push({
      id: url,
      label,
      url,
      competitionTypes: buildCompetitionTypeItems(availableTypes, url),
    });
  }

  return seasons.sort((left, right) => seasonStartYear(right.label) - seasonStartYear(left.label));
}

function buildCompetitionTypeItems(availableTypes: string[], parentUrl: string): NavigationItem[] {
  return availableTypes.map((competitionType) => {
    const slug = competitionTypeSlug(competitionType);
    const url = competitionTypeUrl(parentUrl, slug);

    return {
      id: url,
      label: COMPETITION_TYPE_LABELS.get(competitionType) ?? toTitle(competitionType),
      url,
      parentUrl,
    };
  });
}

function collectAvailableCompetitionTypes(componentData: unknown[]): string[] {
  const seen = new Set<string>();
  const availableTypes: string[] = [];

  for (const rawType of findFirstArray(componentData, "available_types")) {
    const normalized = normalizeCompetitionType(stringValue(rawType));
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    availableTypes.push(normalized);
  }

  return availableTypes;
}

function collectCompetitions(componentData: unknown[], pageUrl: URL): CompetitionSearchResult[] {
  const competitions: CompetitionSearchResult[] = [];
  const seen = new Set<string>();
  const selectedType = inferCompetitionType(pageUrl);

  for (const rawCompetition of findFirstRecordArray(componentData, "competitions")) {
    const label = stringValue(rawCompetition.libelle);
    const externalId = stringValue(rawCompetition.ext_competitionId);
    const competitionType = normalizeCompetitionType(stringValue(rawCompetition.type) || selectedType);
    if (!label || !externalId || !competitionType) {
      continue;
    }

    const parentUrl = competitionTypeUrl(inferSeasonUrl(pageUrl) ?? pageUrl.href, competitionTypeSlug(competitionType));
    const url = `${parentUrl}${slugify(label)}-${externalId}/`;
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    competitions.push({
      id: url,
      label,
      url,
      parentUrl,
      competitionType,
    });
  }

  return competitions;
}

function buildCompetitionMetadata(componentData: unknown[], pageUrl: URL): CompetitionMetadata | null {
  const header = componentData.find(isRecord);
  const breadcrumb = findCompetitionBreadcrumb(header, pageUrl);
  const url = breadcrumb?.url ?? inferCompetitionUrl(pageUrl);
  const label = stringValue(header?.title) || breadcrumb?.label || titleFromCompetitionUrl(url);

  if (!url || !label) {
    return null;
  }

  const metadata = competitionUrlMetadata(url);
  if (!metadata) {
    return null;
  }

  return {
    id: url,
    label,
    url,
    parentUrl: metadata.parentUrl,
    seasonUrl: metadata.seasonUrl,
    competitionType: metadata.competitionType,
    externalId: metadata.externalId,
  };
}

function buildPhaseItems(rawPhases: Record<string, unknown>[], competitionUrl: string): CompetitionPhase[] {
  const phases: CompetitionPhase[] = [];
  const seen = new Set<string>();

  for (const rawPhase of rawPhases) {
    const label = stringValue(rawPhase.libelle);
    const externalId = stringValue(rawPhase.ext_phaseId) || stringValue(rawPhase.id);
    if (!label || !externalId) {
      continue;
    }

    const url = phaseUrl(competitionUrl, externalId);
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    phases.push({
      id: url,
      label,
      url,
      parentUrl: competitionUrl,
      externalId,
      internalId: stringValue(rawPhase.id) || undefined,
    });
  }

  return phases;
}

function buildPouleItems(
  rawPoules: Record<string, unknown>[],
  phases: CompetitionPhase[],
  competitionUrl: string,
  warnings: string[],
): PouleNavigationItem[] {
  const poules: PouleNavigationItem[] = [];
  const seen = new Set<string>();

  for (const rawPoule of rawPoules) {
    const label = stringValue(rawPoule.libelle);
    const externalId = stringValue(rawPoule.ext_pouleId) || stringValue(rawPoule.id);
    if (!label || !externalId) {
      continue;
    }

    const rawPhaseId = stringValue(rawPoule.phaseId);
    const phase = phases.find((candidate) => candidate.internalId === rawPhaseId);
    const parentUrl = phase?.url ?? competitionUrl;
    const url = pouleUrl(competitionUrl, externalId);
    if (seen.has(url)) {
      continue;
    }

    if (!phase && rawPhaseId) {
      warnings.push(`Poule ${label} referenced an unknown phase: ${rawPhaseId}.`);
    }

    seen.add(url);
    poules.push({
      id: url,
      label,
      url,
      parentUrl,
      ...(phase ? { phaseUrl: phase.url } : {}),
      externalId,
      internalId: stringValue(rawPoule.id) || undefined,
    });
  }

  return poules;
}

function buildJourneeItems(
  componentData: unknown[],
  poules: PouleNavigationItem[],
  pageUrl: URL,
  warnings: string[],
): JourneeNavigationItem[] {
  const journees: JourneeNavigationItem[] = [];
  const seen = new Set<string>();
  const inferredPouleUrl = inferPouleUrl(pageUrl);

  for (const rawPoule of collectRawPouleCandidates(componentData)) {
    const poule = findPouleForEmbeddedRecord(poules, rawPoule, inferredPouleUrl);
    if (!poule) {
      continue;
    }

    for (const rawJournee of parseJourneeRows(rawPoule, poule.label, warnings)) {
      const numero = numberValue(rawJournee.journee_numero);
      if (numero === null) {
        continue;
      }

      const url = journeeUrl(poule.url, numero);
      if (seen.has(url)) {
        continue;
      }

      seen.add(url);
      journees.push({
        id: url,
        label: `Journee ${numero}`,
        url,
        parentUrl: poule.url,
        pouleUrl: poule.url,
        numero,
        ...(stringValue(rawJournee.date_debut) ? { startsOn: stringValue(rawJournee.date_debut) } : {}),
        ...(stringValue(rawJournee.date_fin) ? { endsOn: stringValue(rawJournee.date_fin) } : {}),
      });
    }
  }

  return journees.sort((left, right) => left.numero - right.numero);
}

function buildMatchItems(
  componentData: unknown[],
  poules: PouleNavigationItem[],
  journees: JourneeNavigationItem[],
  pageUrl: URL,
  warnings: string[],
): MatchNavigationItem[] {
  const matches: MatchNavigationItem[] = [];
  const seen = new Set<string>();
  const inferredPouleUrl = inferPouleUrl(pageUrl);

  for (const rawMatch of findFirstRecordArray(componentData, "rencontres")) {
    const externalId = stringValue(rawMatch.ext_rencontreId) || stringValue(rawMatch.id);
    const homeLabel = stringValue(rawMatch.equipe1Libelle);
    const awayLabel = stringValue(rawMatch.equipe2Libelle);
    if (!externalId || !homeLabel || !awayLabel) {
      warnings.push("A match row was missing its identifier or participant labels.");
      continue;
    }

    const poule = findPouleForEmbeddedRecord(poules, rawMatch, inferredPouleUrl);
    if (!poule) {
      warnings.push(`Match ${externalId} referenced a poule that could not be resolved.`);
      continue;
    }

    const journeeNumero = numberValue(rawMatch.journeeNumero);
    const canonicalJourneeUrl = journeeNumero ? journeeUrl(poule.url, journeeNumero) : null;
    const matchJournee = journeeNumero
      ? journees.find((candidate) => candidate.pouleUrl === poule.url && candidate.numero === journeeNumero)
      : undefined;
    const parentUrl = matchJournee?.url ?? canonicalJourneeUrl ?? poule.url;
    const url = rencontreUrl(poule.url, externalId);
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    matches.push({
      id: url,
      label: `${homeLabel} vs ${awayLabel}`,
      url,
      parentUrl,
      pouleUrl: poule.url,
      ...(canonicalJourneeUrl ? { journeeUrl: canonicalJourneeUrl } : {}),
      externalId,
      internalId: stringValue(rawMatch.id) || undefined,
      ...(journeeNumero !== null ? { journeeNumero } : {}),
      scheduledAt: stringValue(rawMatch.date) || null,
      homeTeam: buildTeam(stringValue(rawMatch.equipe1Id), homeLabel),
      awayTeam: buildTeam(stringValue(rawMatch.equipe2Id), awayLabel),
      result: buildMatchResult(rawMatch),
      fdmCode: stringValue(rawMatch.fdmCode) || undefined,
      venueId: stringValue(rawMatch.equipementId) || undefined,
      referees: buildReferees(rawMatch),
    });
  }

  return matches;
}

function collectRawPouleCandidates(componentData: unknown[]): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];

  for (const component of componentData) {
    if (!isRecord(component)) {
      continue;
    }

    if (isRecord(component.poule)) {
      candidates.push(component.poule);
    }

    if (isRecord(component.selected_poule)) {
      candidates.push(component.selected_poule);
    }
  }

  candidates.push(...findFirstRecordArray(componentData, "poules"));
  return candidates;
}

function findPouleForEmbeddedRecord(
  poules: PouleNavigationItem[],
  record: Record<string, unknown>,
  inferredPouleUrl: string | null,
): PouleNavigationItem | null {
  const externalId = stringValue(record.ext_pouleId) || stringValue(record.extPouleId);
  const internalId = stringValue(record.id) || stringValue(record.pouleId);

  if (externalId || internalId) {
    return (
      poules.find(
        (candidate) =>
          (externalId && candidate.externalId === externalId) || (internalId && candidate.internalId === internalId),
      ) ?? null
    );
  }

  return (
    poules.find((candidate) => inferredPouleUrl !== null && candidate.url === inferredPouleUrl) ?? null
  );
}

function parseJourneeRows(
  rawPoule: Record<string, unknown>,
  pouleLabel: string,
  warnings: string[],
): Record<string, unknown>[] {
  const rawJournees = stringValue(rawPoule.journees);
  if (!rawJournees) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawJournees);
    if (!Array.isArray(parsed)) {
      warnings.push(`Unable to parse ${pouleLabel} journees: expected an array.`);
      return [];
    }

    return parsed.filter(isRecord);
  } catch (error) {
    warnings.push(`Unable to parse ${pouleLabel} journees: ${errorMessage(error)}`);
    return [];
  }
}

function buildTeam(id: string, label: string): MatchTeam {
  return {
    ...(id ? { id } : {}),
    label,
  };
}

function buildReferees(rawMatch: Record<string, unknown>): MatchTeam[] {
  const referees: MatchTeam[] = [];
  const referee1 = stringValue(rawMatch.arbitre1);
  const referee2 = stringValue(rawMatch.arbitre2);

  if (referee1) {
    referees.push(buildTeam(stringValue(rawMatch.arbitre1Id), referee1));
  }

  if (referee2) {
    referees.push(buildTeam(stringValue(rawMatch.arbitre2Id), referee2));
  }

  return referees;
}

function buildMatchResult(rawMatch: Record<string, unknown>): MatchResult | null {
  const homeScore = numberValue(rawMatch.equipe1Score);
  const awayScore = numberValue(rawMatch.equipe2Score);
  if (homeScore === null || awayScore === null) {
    return null;
  }

  return {
    homeScore,
    awayScore,
    homeHalfTimeScore: numberValue(rawMatch.equipe1ScoreMT),
    awayHalfTimeScore: numberValue(rawMatch.equipe2ScoreMT),
  };
}

function findCompetitionBreadcrumb(
  component: Record<string, unknown> | undefined,
  pageUrl: URL,
): { label: string; url: string } | null {
  if (!component || !Array.isArray(component.breadcrumb)) {
    return null;
  }

  const candidates = component.breadcrumb.filter(isRecord);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const label = stringValue(candidates[index].label);
    const rawUrl = stringValue(candidates[index].url);
    if (!label || !rawUrl) {
      continue;
    }

    const url = new URL(rawUrl, pageUrl).href;
    if (competitionUrlMetadata(url)) {
      return { label, url };
    }
  }

  return null;
}

function inferCompetitionUrl(pageUrl: URL): string | null {
  const match = pageUrl.pathname.match(/^(\/competitions\/saison-\d{4}-\d{4}-\d+\/[^/]+\/[^/]+-\d+\/)/);
  if (!match) {
    return null;
  }

  return new URL(match[1], pageUrl).href;
}

function inferPouleUrl(pageUrl: URL): string | null {
  const competitionUrl = inferCompetitionUrl(pageUrl);
  if (!competitionUrl) {
    return null;
  }

  const match = pageUrl.pathname.match(/^(\/competitions\/saison-\d{4}-\d{4}-\d+\/[^/]+\/[^/]+-\d+\/poule-\d+\/)/);
  if (!match) {
    return null;
  }

  return new URL(match[1], pageUrl).href;
}

function competitionUrlMetadata(url: string): {
  seasonUrl: string;
  parentUrl: string;
  competitionType: string;
  externalId: string;
} | null {
  const parsed = new URL(url);
  const match = parsed.pathname.match(
    /^(\/competitions\/saison-\d{4}-\d{4}-\d+\/)([^/]+)\/([^/]+)-(\d+)\/$/,
  );
  if (!match) {
    return null;
  }

  const seasonUrl = new URL(match[1], parsed).href;
  const parentUrl = new URL(`${match[2]}/`, seasonUrl).href;

  return {
    seasonUrl,
    parentUrl,
    competitionType: normalizeCompetitionType(match[2]),
    externalId: match[4],
  };
}

function phaseUrl(competitionUrl: string, externalId: string): string {
  return new URL(`phase-${externalId}/`, competitionUrl).href;
}

function pouleUrl(competitionUrl: string, externalId: string): string {
  return new URL(`poule-${externalId}/`, competitionUrl).href;
}

function journeeUrl(pouleUrl: string, numero: number): string {
  return new URL(`journee-${numero}/`, pouleUrl).href;
}

function rencontreUrl(pouleUrl: string, externalId: string): string {
  return new URL(`rencontre-${externalId}/`, pouleUrl).href;
}

function titleFromCompetitionUrl(url: string | null): string {
  if (!url) {
    return "";
  }

  const match = new URL(url).pathname.match(/\/([^/]+)-\d+\/$/);
  return match ? toTitle(match[1].replace(/-/g, "_")) : "";
}

function findFirstArray(componentData: unknown[], key: string): unknown[] {
  for (const component of componentData) {
    if (!isRecord(component) || !Array.isArray(component[key])) {
      continue;
    }

    return component[key];
  }

  return [];
}

function findFirstRecordArray(componentData: unknown[], key: string): Record<string, unknown>[] {
  return findFirstArray(componentData, key).filter(isRecord);
}

function findFirstObject(componentData: unknown[], key: string): Record<string, unknown> | null {
  for (const component of componentData) {
    if (!isRecord(component) || !isRecord(component[key])) {
      continue;
    }

    return component[key];
  }

  return null;
}

function seasonUrl(rawSeason: Record<string, unknown>, pageUrl: URL): string | null {
  const label = stringValue(rawSeason.libelle);
  const externalId = stringValue(rawSeason.ext_saisonId) || stringValue(rawSeason.id);
  if (!label || !externalId) {
    return null;
  }

  const seasonSlug = label.replace(/\s+/g, "").replace(/\s*-\s*/g, "-");
  return new URL(`/competitions/saison-${seasonSlug}-${externalId}/`, pageUrl).href;
}

function inferSeasonUrl(pageUrl: URL): string | null {
  const match = pageUrl.pathname.match(/^(\/competitions\/saison-\d{4}-\d{4}-\d+\/)/);
  if (!match) {
    return null;
  }

  return new URL(match[1], pageUrl).href;
}

function inferCompetitionType(pageUrl: URL): string {
  const match = pageUrl.pathname.match(/^\/competitions\/saison-\d{4}-\d{4}-\d+\/([^/]+)\//);
  return match ? normalizeCompetitionType(match[1]) : "";
}

function competitionTypeUrl(parentUrl: string, slug: string): string {
  return new URL(`${slug.replace(/^\/+|\/+$/g, "")}/`, parentUrl).href;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toTitle(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function seasonStartYear(label: string): number {
  const match = label.match(/\d{4}/);
  return match ? Number.parseInt(match[0], 10) : 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
