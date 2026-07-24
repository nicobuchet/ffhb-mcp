import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config/config.js";
import { FfhbClient } from "../ffhb/client.js";
import { PageIndexer } from "../indexing/pageIndexer.js";
import { JsonPageStore } from "../storage/jsonPageStore.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer(
    {
      name: "ffhb-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  const store = new JsonPageStore(config.indexPath);
  const client = new FfhbClient({
    userAgent: config.userAgent,
    requestTimeoutMs: config.requestTimeoutMs,
    urlPolicy: config.urlPolicy,
  });
  const indexer = new PageIndexer(client, store, config.urlPolicy);

  registerTools(server, { config, client, indexer });
  registerResources(server, { store });
  registerPrompts(server);

  return server;
}
