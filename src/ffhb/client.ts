import { PDFParse } from "pdf-parse";
import type { UrlPolicy } from "../domain/urlPolicy.js";
import { createUrlPolicy, resolveAllowedUrl } from "../domain/urlPolicy.js";
import { parseHtmlPage, toIndexedPage } from "./htmlParser.js";
import type { IndexedPage } from "../domain/page.js";
import type { MatchDetails, StandingsDetails } from "../domain/extraction.js";
import {
  COMPETITION_SEARCH_LIMIT_MAX,
  COMPETITION_SEARCH_LIMIT_MIN,
  type CompetitionDetails,
  type CompetitionOverview,
  type CompetitionSearchFilters,
  type CompetitionSearchResult,
  type JourneeNavigationItem,
  type MatchListFilters,
  type MatchNavigationItem,
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
import { parseStandingsExtraction } from "./extractionParser.js";
import { errorMessage } from "./errors.js";
import { isMatchUrl, parseMatchPage } from "./matchPageParser.js";
import { parseMatchSheetText } from "./matchSheetParser.js";

export interface FfhbClientOptions {
  userAgent: string;
  requestTimeoutMs: number;
  urlPolicy: UrlPolicy;
  fdmBaseUrl?: string;
  pdfTextExtractor?: (data: Uint8Array) => Promise<string>;
}

export class FfhbClient {
  constructor(private readonly options: FfhbClientOptions) {}

  async fetchPage(inputUrl: string): Promise<IndexedPage> {
    const { html, url } = await this.fetchHtml(inputUrl);
    return toIndexedPage(parseHtmlPage(html, url), url);
  }

  async getMatch(matchUrl: string): Promise<MatchDetails> {
    const { html, url } = await this.fetchHtml(matchUrl);
    if (!isMatchUrl(url.href)) {
      throw new Error(`Expected a canonical FFHandball match URL: ${url.href}`);
    }

    const fdmBaseUrl = this.options.fdmBaseUrl ?? "https://fdm.fdme.ffhandball.fr";
    const parsedPage = parseMatchPage(html, url, fdmBaseUrl);
    const warnings = [...parsedPage.fallback.warnings];
    const pdfUrl = parsedPage.directPdfUrl ?? parsedPage.fallback.sourceUrls.pdfUrl ?? null;
    const partialMatch = (
      pdf: MatchDetails["pdf"],
      sourceUrls: MatchDetails["sourceUrls"] = { matchUrl: url.href },
    ): MatchDetails => ({
      ...parsedPage.fallback,
      pdf,
      sourceUrls,
      warnings,
    });

    if (!pdfUrl) {
      warnings.push("No match sheet PDF URL could be discovered from the match page.");
      return partialMatch({ available: false, parsed: false });
    }

    let allowedPdfUrl: URL;
    try {
      allowedPdfUrl = resolveAllowedUrl(pdfUrl, createUrlPolicy(fdmBaseUrl, []));
    } catch (error) {
      warnings.push(`Match sheet PDF URL is not allowed: ${errorMessage(error)}`);
      return partialMatch({ available: false, parsed: false, url: pdfUrl, error: errorMessage(error) });
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await this.fetchPdf(allowedPdfUrl);
    } catch (error) {
      warnings.push(`Unable to fetch match sheet PDF: ${errorMessage(error)}`);
      return partialMatch(
        { available: true, parsed: false, url: allowedPdfUrl.href, error: errorMessage(error) },
        { matchUrl: url.href, pdfUrl: allowedPdfUrl.href },
      );
    }

    try {
      const text = await this.extractPdfText(pdfBytes);
      const parsedPdf = parseMatchSheetText(text, { matchUrl: url.href, pdfUrl: allowedPdfUrl.href });
      return mergePdfMatchDetails(parsedPdf, parsedPage.fallback, warnings);
    } catch (error) {
      warnings.push(`Unable to parse match sheet PDF: ${errorMessage(error)}`);
      return partialMatch(
        { available: true, parsed: false, url: allowedPdfUrl.href, error: errorMessage(error) },
        { matchUrl: url.href, pdfUrl: allowedPdfUrl.href },
      );
    }
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

  async listJournees(pouleUrl: string): Promise<{
    competition: CompetitionDetails["competition"];
    poule: PouleNavigationItem;
    filters: {
      pouleUrl: string;
    };
    journees: JourneeNavigationItem[];
    warnings: string[];
  }> {
    const { resolvedPouleUrl, details, poule } = await this.fetchPoulePageDetails(pouleUrl);
    const journees = details.journees.filter((journee) => journee.pouleUrl === resolvedPouleUrl);

    const warnings = [...details.warnings];
    if (journees.length === 0) {
      warnings.push(`No journees were embedded at ${resolvedPouleUrl}`);
    }

    return {
      competition: details.competition,
      poule,
      filters: {
        pouleUrl: resolvedPouleUrl,
      },
      journees,
      warnings,
    };
  }

  async getStandings(pouleUrl: string): Promise<StandingsDetails> {
    const { resolvedPouleUrl, details, poule } = await this.fetchPoulePageDetails(pouleUrl);
    const { html } = await this.fetchHtml(standingsPageUrl(resolvedPouleUrl));
    const extraction = parseStandingsExtraction(html);

    return {
      competition: details.competition,
      poule,
      filters: {
        pouleUrl: resolvedPouleUrl,
      },
      standings: extraction.standings,
      warnings: [...details.warnings, ...extraction.warnings],
    };
  }

  async listMatches(filters: MatchListFilters): Promise<{
    competition: CompetitionDetails["competition"];
    poule: PouleNavigationItem;
    filters: {
      pouleUrl: string;
      journeeUrl: string | null;
    };
    matches: MatchNavigationItem[];
    warnings: string[];
  }> {
    const { resolvedPouleUrl, details: pouleDetails, poule } = await this.fetchPoulePageDetails(filters.pouleUrl);
    const journees = pouleDetails.journees.filter((journee) => journee.pouleUrl === resolvedPouleUrl);

    const journeeUrl = filters.journeeUrl ? resolveAllowedUrl(filters.journeeUrl, this.options.urlPolicy).href : null;
    if (journeeUrl !== null && !journees.some((journee) => journee.url === journeeUrl)) {
      throw new Error(`Journee is not available for ${resolvedPouleUrl}: ${journeeUrl}`);
    }

    const warnings = [...pouleDetails.warnings];
    const detailsToSearch =
      journeeUrl !== null
        ? [await this.fetchCompetitionDetails(journeeUrl)]
        : await Promise.all(journees.map((journee) => this.fetchCompetitionDetails(journee.url)));
    const matches = detailsToSearch.flatMap((details) => {
      warnings.push(...details.warnings);
      return details.matches;
    });

    if (matches.length === 0) {
      warnings.push(`No matches were embedded for ${journeeUrl ?? resolvedPouleUrl}`);
    }

    return {
      competition: pouleDetails.competition,
      poule,
      filters: {
        pouleUrl: resolvedPouleUrl,
        journeeUrl,
      },
      matches,
      warnings,
    };
  }

  private async fetchPoulePageDetails(inputUrl: string): Promise<{
    resolvedPouleUrl: string;
    html: string;
    details: CompetitionDetails;
    poule: PouleNavigationItem;
  }> {
    const { html, url } = await this.fetchHtml(inputUrl);
    const resolvedPouleUrl = url.href;
    const details = parseCompetitionDetails(html, url);
    const poule = details.poules.find((candidate) => candidate.url === resolvedPouleUrl);

    if (!poule) {
      throw new Error(`Poule is not available for ${details.competition.url}: ${resolvedPouleUrl}`);
    }

    return {
      resolvedPouleUrl,
      html,
      details,
      poule,
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

  private async fetchPdf(url: URL): Promise<Uint8Array> {
    const response = await this.fetch(url);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("application/pdf") && !contentType.includes("octet-stream")) {
      throw new Error(`Expected PDF from ${url.href}, received ${contentType}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  private async extractPdfText(data: Uint8Array): Promise<string> {
    if (this.options.pdfTextExtractor) {
      return this.options.pdfTextExtractor(data);
    }

    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
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

function mergePdfMatchDetails(
  parsedPdf: MatchDetails,
  fallback: MatchDetails,
  priorWarnings: string[],
): MatchDetails {
  return {
    ...parsedPdf,
    metadata: {
      ...fallback.metadata,
      ...parsedPdf.metadata,
      fdmCode: parsedPdf.metadata.fdmCode ?? fallback.metadata.fdmCode,
      scheduledAt: parsedPdf.metadata.scheduledAt ?? fallback.metadata.scheduledAt,
    },
    venue: parsedPdf.venue ?? fallback.venue,
    officials: parsedPdf.officials.length > 0 ? parsedPdf.officials : fallback.officials,
    warnings: [...priorWarnings, ...parsedPdf.warnings],
  };
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

function standingsPageUrl(pouleUrl: string): string {
  return new URL("classements/", pouleUrl).href;
}
