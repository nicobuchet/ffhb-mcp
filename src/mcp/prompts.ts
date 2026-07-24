import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "ffhb-research-plan",
    {
      title: "FFHandball research plan",
      description: "Guide an agent through indexing and answering a question from FFHandball website data.",
      argsSchema: {
        topic: z.string().min(2),
      },
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Research "${topic}" using the FFHandball MCP server.`,
              "Start by searching the local index.",
              "If results are missing or stale, index the most relevant FFHandball URL before answering.",
              "Cite page URLs from the indexed data in the final answer.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
