import * as cheerio from "cheerio";
import type {
  CompetitionNavigation,
  CompetitionSearchResult,
  NavigationItem,
  SeasonNavigationItem,
} from "../domain/navigation.js";

const COMPETITION_COMPONENT_NAMES = new Set([
  "competitions---search-bar",
  "competitions---saison-selector",
  "competitions---competition-main-menu",
]);

const COMPETITION_TYPE_LABELS = new Map<string, string>([
  ["NATIONAL", "National"],
  ["REGIONAL", "Regional"],
  ["DEPARTEMENTAL", "Departemental"],
  ["COUPE_DE_FRANCE", "Coupe de France"],
]);

export function parseCompetitionNavigation(html: string, pageUrl: URL): CompetitionNavigation {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const componentData: unknown[] = [];

  $("smartfire-component").each((_, element) => {
    const name = $(element).attr("name");
    if (!name || !COMPETITION_COMPONENT_NAMES.has(name)) {
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
