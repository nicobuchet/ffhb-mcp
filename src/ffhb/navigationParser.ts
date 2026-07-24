import * as cheerio from "cheerio";
import type {
  CompetitionDetails,
  CompetitionMetadata,
  CompetitionNavigation,
  CompetitionPhase,
  CompetitionSearchResult,
  NavigationItem,
  PouleNavigationItem,
  SeasonNavigationItem,
} from "../domain/navigation.js";

const COMPETITION_COMPONENT_NAMES = new Set([
  "competitions---search-bar",
  "competitions---saison-selector",
  "competitions---competition-main-menu",
]);

const COMPETITION_DETAILS_COMPONENT_NAMES = new Set([
  "page-header",
  "competitions---poule-selector",
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

function collectComponentData(html: string, componentNames: Set<string>, warnings: string[]): unknown[] {
  const $ = cheerio.load(html);
  const componentData: unknown[] = [];

  $("smartfire-component").each((_, element) => {
    const name = $(element).attr("name");
    if (!name || !componentNames.has(name)) {
      return;
    }

    const attributes = $(element).attr("attributes");
    if (!attributes) {
      warnings.push(`Component ${name} did not include attributes.`);
      return;
    }

    const parsed = parseComponentAttributes(attributes, name, warnings);
    if (parsed) {
      componentData.push(parsed);
    }
  });

  return componentData;
}

function parseComponentAttributes(attributes: string, componentName: string, warnings: string[]): unknown | null {
  try {
    return JSON.parse(attributes);
  } catch (error) {
    warnings.push(`Unable to parse ${componentName} attributes: ${errorMessage(error)}`);
    return null;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
