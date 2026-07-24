import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../storage/pageStore.js";
import { formatStats, jsonText } from "./format.js";

export interface ResourceDependencies {
  store: PageStore;
}

export function registerResources(server: McpServer, dependencies: ResourceDependencies): void {
  server.registerResource(
    "ffhb-index-stats",
    "ffhb://index/stats",
    {
      title: "FFHandball index stats",
      description: "Counts and freshness information for the local FFHandball page index.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: formatStats(await dependencies.store.stats()),
        },
      ],
    }),
  );

  server.registerResource(
    "ffhb-indexed-page",
    new ResourceTemplate("ffhb://page/{encodedUrl}", { list: undefined }),
    {
      title: "Indexed FFHandball page",
      description: "Full text and links for a page already present in the local index.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const encodedUrl = Array.isArray(variables.encodedUrl) ? variables.encodedUrl[0] : variables.encodedUrl;
      const url = decodeURIComponent(encodedUrl);
      const page = await dependencies.store.get(url);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(page ?? { error: "Page is not indexed", url }),
          },
        ],
      };
    },
  );
}
