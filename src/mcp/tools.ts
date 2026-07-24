import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AppConfig } from "../config/config.js";
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
