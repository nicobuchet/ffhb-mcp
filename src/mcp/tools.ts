import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AppConfig } from "../config/config.js";
import { COMPETITION_SEARCH_LIMIT_MAX, COMPETITION_SEARCH_LIMIT_MIN } from "../domain/navigation.js";
import type { FfhbClient } from "../ffhb/client.js";
import type { PageIndexer } from "../indexing/pageIndexer.js";
import { compactPage, compactSearchHit, jsonText } from "./format.js";

export interface ToolDependencies {
  config: AppConfig;
  client: FfhbClient;
  indexer: PageIndexer;
}

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    "ffhb_list_seasons",
    {
      title: "List FFHandball seasons",
      description: "List FFHandball seasons and their available competition types using live FFHandball navigation data.",
      inputSchema: {},
    },
    async () => {
      const output = await dependencies.client.listSeasons();

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_search_competitions",
    {
      title: "Search FFHandball competitions",
      description: "Search live FFHandball competitions with optional query, season URL, competition type, and limit filters.",
      inputSchema: {
        query: z.string().min(1).optional(),
        seasonUrl: z.string().min(1).optional(),
        competitionType: z.string().min(1).optional(),
        limit: z.number().int().min(COMPETITION_SEARCH_LIMIT_MIN).max(COMPETITION_SEARCH_LIMIT_MAX).default(10),
      },
    },
    async ({ query, seasonUrl, competitionType, limit }) => {
      const output = await dependencies.client.searchCompetitions({
        query,
        seasonUrl,
        competitionType,
        limit,
      });

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_get_competition",
    {
      title: "Get FFHandball competition",
      description: "Inspect one FFHandball competition and list its metadata plus available phases.",
      inputSchema: {
        competitionUrl: z.string().min(1).describe("Canonical FFHandball competition URL."),
      },
    },
    async ({ competitionUrl }) => {
      const details = await dependencies.client.getCompetition(competitionUrl);
      const output: Record<string, unknown> = { ...details };

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_list_poules",
    {
      title: "List FFHandball poules",
      description: "List poules for a competition, optionally restricted to one phase URL from ffhb_get_competition.",
      inputSchema: {
        competitionUrl: z.string().min(1).describe("Canonical FFHandball competition URL."),
        phaseUrl: z.string().min(1).optional().describe("Optional phase URL returned by ffhb_get_competition."),
      },
    },
    async ({ competitionUrl, phaseUrl }) => {
      const result = await dependencies.client.listPoules({ competitionUrl, phaseUrl });
      const output: Record<string, unknown> = { ...result };

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_list_journees",
    {
      title: "List FFHandball journees",
      description: "List journees for a canonical FFHandball poule URL.",
      inputSchema: {
        pouleUrl: z.string().min(1).describe("Canonical FFHandball poule URL."),
      },
    },
    async ({ pouleUrl }) => {
      const result = await dependencies.client.listJournees(pouleUrl);
      const output: Record<string, unknown> = { ...result };

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_list_matches",
    {
      title: "List FFHandball matches",
      description: "List matches for a poule, optionally restricted to one journee URL from ffhb_list_journees.",
      inputSchema: {
        pouleUrl: z.string().min(1).describe("Canonical FFHandball poule URL."),
        journeeUrl: z.string().min(1).optional().describe("Optional journee URL returned by ffhb_list_journees."),
      },
    },
    async ({ pouleUrl, journeeUrl }) => {
      const result = await dependencies.client.listMatches({ pouleUrl, journeeUrl });
      const output: Record<string, unknown> = { ...result };

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_fetch_page",
    {
      title: "Fetch FFHandball page",
      description: "Fetch and parse a single allowed page from the FFHandball website without storing it.",
      inputSchema: {
        url: z.string().min(1).describe("Absolute or relative FFHandball URL to fetch."),
      },
    },
    async ({ url }) => {
      const page = await dependencies.client.fetchPage(url);
      const output = compactPage(page);

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_index_url",
    {
      title: "Index FFHandball URL",
      description: "Fetch a page, optionally shallow-fetch same-site links found on it, and persist them in the local index.",
      inputSchema: {
        url: z.string().min(1).default(dependencies.config.baseUrl),
        maxLinkedPages: z.number().int().min(0).max(25).default(0),
      },
    },
    async ({ url, maxLinkedPages }) => {
      const pages = await dependencies.indexer.indexUrl(url, { maxLinkedPages });
      const output = {
        indexedCount: pages.length,
        pages: pages.map(compactPage),
      };

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "ffhb_search_index",
    {
      title: "Search FFHandball index",
      description: "Search pages that have already been indexed locally.",
      inputSchema: {
        query: z.string().min(2),
        limit: z.number().int().min(1).max(20).default(5),
      },
    },
    async ({ query, limit }) => {
      const hits = await dependencies.indexer.search(query, limit);
      const output = {
        query,
        hits: hits.map(compactSearchHit),
      };

      return {
        content: [{ type: "text", text: jsonText(output) }],
        structuredContent: output,
      };
    },
  );
}
