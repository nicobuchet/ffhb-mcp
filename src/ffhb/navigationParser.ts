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
  TerritoryNavigationItem,
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
  assertPageSeason(componentData, pageUrl);

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
    territories: collectTerritories(componentData, pageUrl),
    warnings,
  };
}

function collectTerritories(componentData: unknown[], pageUrl: URL): TerritoryNavigationItem[] {
  const type = inferCompetitionType(pageUrl);
  if (type !== "REGIONAL" && type !== "DEPARTEMENTAL") return [];
  const source = componentData.find((item) => isRecord(item) && Array.isArray(item.structures));
  if (!isRecord(source) || !Array.isArray(source.structures)) {
    throw new Error(`Unable to interpret territory list at ${pageUrl.href}`);
  }
  const territories = new Map<string, TerritoryNavigationItem>();
  for (const structure of source.structures) {
    const territory = isRecord(structure) ? buildTerritory(structure, pageUrl) : null;
    if (!territory) throw new Error(`Malformed territory in list at ${pageUrl.href}`);
    territories.set(territory.url, territory);
  }
  return [...territories.values()];
}

function buildTerritory(structure: Record<string, unknown>, pageUrl: URL): TerritoryNavigationItem | null {
  const type = inferCompetitionType(pageUrl);
  const season = inferSeasonUrl(pageUrl);
  if (!season || (type !== "REGIONAL" && type !== "DEPARTEMENTAL")) return null;
  const parentUrl = competitionTypeUrl(season, competitionTypeSlug(type));
  const label = stringValue(structure.libelle);
  const externalId = stringValue(structure.ext_structureId);
  const structureType = stringValue(structure.type);
  if (!label || !/^\d+$/.test(externalId) || (structureType && structureType !== (type === "REGIONAL" ? "LIG" : "COM"))) return null;
  const url = new URL(`o-${slugify(label)}-${externalId}/`, parentUrl).href;
  return { id: url, label, url, parentUrl, seasonUrl: season, competitionType: type, externalId };
}

function territoryOwnership(territory: TerritoryNavigationItem | null) {
  if (!territory) return {};
  return territory.competitionType === "REGIONAL" ? { region: territory } : { department: territory };
}

export function parseCompetitionDetails(html: string, pageUrl: URL): CompetitionDetails {
  const warnings: string[] = [];
  const componentData = collectComponentData(html, COMPETITION_DETAILS_COMPONENT_NAMES, warnings);
  assertPageSeason(componentData, pageUrl);

  if (componentData.length === 0) {
    throw new Error(`Unable to interpret FFHandball competition details from ${pageUrl.href}`);
  }

  const competition = buildCompetitionMetadata(componentData, pageUrl);
  if (!competition) {
    throw new Error(`Unable to interpret FFHandball competition details from ${pageUrl.href}`);
  }

  if ((competition.competitionType === "REGIONAL" || competition.competitionType === "DEPARTEMENTAL")
    && !competition.region && !competition.department) {
    warnings.push(`Unable to establish the owning territory for ${competition.url}`);
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

export function territoryUrlMetadata(url: URL): Pick<TerritoryNavigationItem, "seasonUrl" | "competitionType" | "externalId"> | null {
  const match = url.pathname.match(/^(\/competitions\/saison-\d{4}-\d{4}-\d+\/)(regional|departemental)\/o-[^/]+-(\d+)\/$/);
  if (!match || url.search) return null;
  return {
    seasonUrl: new URL(match[1], url).href,
    competitionType: match[2] === "regional" ? "REGIONAL" : "DEPARTEMENTAL",
    externalId: match[3],
  };
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
  const requestedTerritory = territoryUrlMetadata(pageUrl);
  const selectedStructure = findFirstObject(componentData, "structure");
  const selectedTerritory = selectedStructure ? buildTerritory(selectedStructure, pageUrl) : null;
  if (requestedTerritory) {
    if (selectedTerritory?.url !== pageUrl.href) {
      throw new Error(`Selected territory does not match ${pageUrl.href}`);
    }
    if (!componentData.some((item) => isRecord(item) && Array.isArray(item.competitions))) {
      throw new Error(`Unable to interpret territory competitions at ${pageUrl.href}`);
    }
  }

  for (const rawCompetition of findFirstArray(componentData, "competitions")) {
    if (!isRecord(rawCompetition)) {
      if (requestedTerritory) throw new Error(`Malformed competition at ${pageUrl.href}`);
      continue;
    }
    const label = stringValue(rawCompetition.libelle);
    const externalId = stringValue(rawCompetition.ext_competitionId);
    const competitionType = normalizeCompetitionType(stringValue(rawCompetition.type) || selectedType);
    if (!label || !externalId || !competitionType || (requestedTerritory && !/^\d+$/.test(externalId))) {
      if (requestedTerritory) throw new Error(`Malformed competition at ${pageUrl.href}`);
      continue;
    }

    const parentUrl = competitionTypeUrl(inferSeasonUrl(pageUrl) ?? pageUrl.href, competitionTypeSlug(competitionType));
    const url = `${parentUrl}${slugify(label)}-${externalId}/`;
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    const structureId = stringValue(rawCompetition.structureId);
    const structure = structureId
      ? findFirstRecordArray(componentData, "structures").find((item) => item.id === structureId)
        ?? (selectedStructure?.id === structureId ? selectedStructure : null)
      : selectedStructure;
    const owner = structure ? buildTerritory(structure, pageUrl) : null;
    if (requestedTerritory && (competitionType !== selectedType || owner?.url !== pageUrl.href)) {
      throw new Error(`Competition ${externalId} does not belong to territory ${pageUrl.href}`);
    }
    competitions.push({
      id: url,
      label,
      url,
      parentUrl,
      competitionType,
      ...territoryOwnership(owner),
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
    ...territoryOwnership(findTerritoryBreadcrumb(header, new URL(url))),
  };
}

function findTerritoryBreadcrumb(header: Record<string, unknown> | undefined, competitionUrl: URL): TerritoryNavigationItem | null {
  if (!Array.isArray(header?.breadcrumb)) return null;
  for (const crumb of header.breadcrumb.filter(isRecord)) {
    const label = stringValue(crumb.label);
    const rawUrl = stringValue(crumb.url);
    if (!label || !rawUrl) continue;
    const url = new URL(rawUrl, competitionUrl);
    const metadata = territoryUrlMetadata(url);
    if (!metadata || metadata.seasonUrl !== inferSeasonUrl(competitionUrl)
      || metadata.competitionType !== inferCompetitionType(competitionUrl)) continue;
    return {
      id: url.href, label, url: url.href,
      parentUrl: competitionTypeUrl(metadata.seasonUrl, competitionTypeSlug(metadata.competitionType)),
      ...metadata,
    };
  }
  return null;
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
  if (territoryUrlMetadata(parsed)) return null;
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

export function inferSeasonUrl(pageUrl: URL): string | null {
  const match = pageUrl.pathname.match(/^(\/competitions\/saison-\d{4}-\d{4}-\d+\/)/);
  if (!match) {
    return null;
  }

  return new URL(match[1], pageUrl).href;
}

function assertPageSeason(componentData: unknown[], pageUrl: URL): void {
  const expected = inferSeasonUrl(pageUrl);
  if (!expected) return;
  const expectedId = expected.match(/-(\d+)\/$/)?.[1];
  for (const component of componentData.filter(isRecord)) {
    const selectedSeason = isRecord(component.saison) ? seasonUrl(component.saison, pageUrl) : null;
    const selectedId = stringValue(component.ext_saison_id);
    if ((selectedSeason && selectedSeason !== expected) || (selectedId && selectedId !== expectedId)) {
      throw new Error(`Season mismatch in FFHandball data at ${pageUrl.href}`);
    }
    if (!Array.isArray(component.breadcrumb)) continue;
    for (const crumb of component.breadcrumb.filter(isRecord)) {
      const rawUrl = stringValue(crumb.url);
      if (!rawUrl) continue;
      const crumbSeason = inferSeasonUrl(new URL(rawUrl, pageUrl));
      if (crumbSeason && crumbSeason !== expected) {
        throw new Error(`Season mismatch in FFHandball breadcrumb at ${pageUrl.href}`);
      }
    }
  }
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
