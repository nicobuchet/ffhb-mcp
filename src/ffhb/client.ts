import type { UrlPolicy } from "../domain/urlPolicy.js";
import { resolveAllowedUrl } from "../domain/urlPolicy.js";
import { parseHtmlPage, toIndexedPage } from "./htmlParser.js";
import type { IndexedPage } from "../domain/page.js";
import {
  COMPETITION_SEARCH_LIMIT_MAX,
  COMPETITION_SEARCH_LIMIT_MIN,
  type CompetitionDetails,
  type CompetitionOverview,
  type CompetitionSearchFilters,
  type CompetitionSearchResult,
  type PouleListFilters,
  type PouleNavigationItem,
  type SeasonNavigationItem,
} from "../domain/navigation.js";
import {
  competitionTypeSlug,
  normalizeCompetitionType,
  parseCompetitionDetails,
  parseCompetitionNavigation,
} from "./navigationParser.js";

export interface FfhbClientOptions {
  userAgent: string;
  requestTimeoutMs: number;
  urlPolicy: UrlPolicy;
}

export class FfhbClient {
  constructor(private readonly options: FfhbClientOptions) {}

  async fetchPage(inputUrl: string): Promise<IndexedPage> {
    const { html, url } = await this.fetchHtml(inputUrl);
    return toIndexedPage(parseHtmlPage(html, url), url);
  }

  async listSeasons(): Promise<{ seasons: SeasonNavigationItem[]; warnings: string[] }> {
    const { html, url } = await this.fetchHtml("/competitions/");
    const navigation = parseCompetitionNavigation(html, url);

    if (navigation.seasons.length === 0) {
      throw new Error(`Unable to find FFHandball seasons at ${url.href}`);
    }

    const seasonNavigations = await Promise.all(
      navigation.seasons.map(async (season) => ({
        season,
        navigation: await this.fetchCompetitionNavigation(season.url),
      })),
    );
    const warnings = [...navigation.warnings];
    const seasons = seasonNavigations.map(({ season, navigation: seasonNavigation }) => {
      warnings.push(...seasonNavigation.warnings);

      return {
        ...season,
        competitionTypes: seasonNavigation.competitionTypes,
      };
    });

    return {
      seasons,
      warnings,
    };
  }

  async searchCompetitions(filters: CompetitionSearchFilters = {}): Promise<{
    query: string | null;
    filters: Required<Pick<CompetitionSearchFilters, "limit">> & {
      seasonUrl: string | null;
      competitionType: string | null;
    };
    results: CompetitionSearchResult[];
    warnings: string[];
  }> {
    const limit = filters.limit ?? 10;
    if (!Number.isInteger(limit) || limit < COMPETITION_SEARCH_LIMIT_MIN || limit > COMPETITION_SEARCH_LIMIT_MAX) {
      throw new Error(
        `limit must be an integer between ${COMPETITION_SEARCH_LIMIT_MIN} and ${COMPETITION_SEARCH_LIMIT_MAX}`,
      );
    }

    const entryNavigation = await this.fetchCompetitionNavigation(filters.seasonUrl ?? "/competitions/");
    const seasonUrl = filters.seasonUrl
      ? resolveAllowedUrl(filters.seasonUrl, this.options.urlPolicy).href
      : entryNavigation.currentSeasonUrl;

    if (!seasonUrl) {
      throw new Error("Unable to determine the FFHandball season URL to search.");
    }

    const typeFilters =
      filters.competitionType !== undefined
        ? [normalizeCompetitionType(filters.competitionType)]
        : entryNavigation.competitionTypes.map((competitionType) => normalizeCompetitionType(competitionType.label));

    if (typeFilters.length === 0) {
      throw new Error(`Unable to find FFHandball competition types at ${seasonUrl}`);
    }

    if (typeFilters.some((competitionType) => competitionType.length === 0)) {
      throw new Error("competitionType must not be empty when provided");
    }

    const availableTypes = new Set(
      entryNavigation.competitionTypes.map((competitionType) => normalizeCompetitionType(competitionType.label)),
    );
    for (const competitionType of typeFilters) {
      if (availableTypes.size > 0 && !availableTypes.has(competitionType)) {
        throw new Error(`Competition type is not available for ${seasonUrl}: ${competitionType}`);
      }
    }

    const warnings = [...entryNavigation.warnings];
    const competitions: CompetitionSearchResult[] = [];

    for (const competitionType of typeFilters) {
      const typeUrl = new URL(`${competitionTypeSlug(competitionType)}/`, seasonUrl).href;
      const navigation = await this.fetchCompetitionNavigation(typeUrl);
      warnings.push(...navigation.warnings);

      if (navigation.competitions.length === 0) {
        warnings.push(`No competitions were embedded at ${typeUrl}`);
      }

      competitions.push(...navigation.competitions);
    }

    const query = filters.query?.trim() ?? "";
    const results = competitions
      .filter((competition) => matchesQuery(competition, query))
      .slice(0, limit);

    return {
      query: query || null,
      filters: {
        seasonUrl,
        competitionType: filters.competitionType ? normalizeCompetitionType(filters.competitionType) : null,
        limit,
      },
      results,
      warnings,
    };
  }

  async getCompetition(competitionUrl: string): Promise<CompetitionOverview> {
    const details = await this.fetchCompetitionDetails(competitionUrl);

    return {
      competition: details.competition,
      phases: details.phases,
      warnings: details.warnings,
    };
  }

  async listPoules(filters: PouleListFilters): Promise<{
    competition: CompetitionDetails["competition"];
    filters: {
      competitionUrl: string;
      phaseUrl: string | null;
    };
    poules: PouleNavigationItem[];
    warnings: string[];
  }> {
    const details = await this.fetchCompetitionDetails(filters.competitionUrl);
    const phaseUrl = filters.phaseUrl ? resolveAllowedUrl(filters.phaseUrl, this.options.urlPolicy).href : null;

    if (phaseUrl !== null && !details.phases.some((phase) => phase.url === phaseUrl)) {
      throw new Error(`Phase is not available for ${details.competition.url}: ${phaseUrl}`);
    }

    return {
      competition: details.competition,
      filters: {
        competitionUrl: details.competition.url,
        phaseUrl,
      },
      poules: phaseUrl === null ? details.poules : details.poules.filter((poule) => poule.phaseUrl === phaseUrl),
      warnings: details.warnings,
    };
  }

  private async fetch(url: URL): Promise<Response> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.options.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": this.options.userAgent,
          accept: "text/html,application/xhtml+xml",
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`FFHandball request failed for ${url.href}: ${response.status} ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchHtml(inputUrl: string): Promise<{ html: string; url: URL }> {
    const url = resolveAllowedUrl(inputUrl, this.options.urlPolicy);
    const response = await this.fetch(url);
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
      throw new Error(`Expected HTML from ${url.href}, received ${contentType || "unknown content type"}`);
    }

    return {
      html: await response.text(),
      url,
    };
  }

  private async fetchCompetitionNavigation(inputUrl: string) {
    const { html, url } = await this.fetchHtml(inputUrl);
    return parseCompetitionNavigation(html, url);
  }

  private async fetchCompetitionDetails(inputUrl: string): Promise<CompetitionDetails> {
    const { html, url } = await this.fetchHtml(inputUrl);
    return parseCompetitionDetails(html, url);
  }
}

function matchesQuery(competition: CompetitionSearchResult, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = normalizeSearchText(`${competition.label} ${competition.url} ${competition.competitionType}`);
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);

  return tokens.every((token) => haystack.includes(token));
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
