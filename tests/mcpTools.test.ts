import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createUrlPolicy } from "../src/domain/urlPolicy.js";
import type { AppConfig } from "../src/config/config.js";
import type { FfhbClient } from "../src/ffhb/client.js";
import type { PageIndexer } from "../src/indexing/pageIndexer.js";
import { registerTools } from "../src/mcp/tools.js";

const pouleUrl =
  "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/";

test("MCP users can get standings by canonical poule URL", async () => {
  const output = {
    competition: {
      id: "competition-id",
      label: "LIGUE BUTAGAZ ENERGIE 2026-2027",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/",
      seasonUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/",
      competitionType: "NATIONAL",
      externalId: "30618",
    },
    poule: {
      id: pouleUrl,
      label: "PHASE REGULIERE",
      url: pouleUrl,
      parentUrl:
        "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109535/",
      phaseUrl:
        "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109535/",
      externalId: "190313",
      internalId: "238789",
    },
    filters: {
      pouleUrl,
    },
    standings: [
      {
        id: "59710893",
        internalId: "10543916",
        pouleId: "238789",
        rank: 2,
        team: {
          id: "1764834",
          externalId: "2118500",
          structureId: "532",
          externalStructureId: "1791",
          label: "BREST BRETAGNE HANDBALL",
        },
        played: 22,
        points: 38,
        wins: 18,
        draws: 2,
        losses: 2,
        goalsFor: 650,
        goalsAgainst: 540,
        goalDifference: 110,
        penalties: 1,
      },
    ],
    warnings: ["Standings row 59710893 came from normalized extractor output"],
  };
  const server = new McpServer({ name: "ffhb-mcp-test-server", version: "0.1.0" });
  const client = new Client({ name: "ffhb-mcp-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  registerTools(server, {
    config: testConfig(),
    client: {
      getStandings: async (inputPouleUrl: string) => {
        assert.equal(inputPouleUrl, pouleUrl);
        return output;
      },
    } as FfhbClient,
    indexer: {} as PageIndexer,
  });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const tools = await client.listTools();
    const standingsTool = tools.tools.find((tool) => tool.name === "ffhb_get_standings");

    assert.ok(standingsTool);
    assert.deepEqual(standingsTool.inputSchema.required, ["pouleUrl"]);

    const result = (await client.callTool(
      {
        name: "ffhb_get_standings",
        arguments: { pouleUrl },
      },
      CallToolResultSchema,
    )) as CallToolResult;

    assert.equal("structuredContent" in result, true);
    assert.deepEqual(result.structuredContent, output);
    assert.equal("content" in result, true);
    assert.equal(result.content[0]?.type, "text");

    if (result.content[0]?.type !== "text") {
      assert.fail("Expected text content");
    }

    assert.deepEqual(JSON.parse(result.content[0].text), output);
    assert.equal(result.content[0].text.includes("classements"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP users can get match details by canonical match URL", async () => {
  const matchUrl =
    "https://www.ffhandball.fr/competitions/saison-2025-2026-21/regional/16-ans-m-excellence-28342/poule-169110/rencontre-2382620/";
  const output = {
    metadata: {
      matchUrl,
      matchCode: "2382620",
      fdmCode: "VAGMWKK",
      status: "Terminé",
    },
    teams: {
      home: { side: "home", label: "PDF HOME CLUB" },
      away: { side: "away", label: "PDF AWAY CLUB" },
    },
    score: { homeScore: 29, awayScore: 26, periods: [] },
    venue: null,
    officials: [],
    tableOfficials: [],
    staff: { home: [], away: [] },
    players: { home: [], away: [] },
    timeline: [],
    pdf: { available: true, parsed: true, url: "https://fdm.fdme.ffhandball.fr/V/A/G/M/VAGMWKK.pdf" },
    sourceUrls: { matchUrl, pdfUrl: "https://fdm.fdme.ffhandball.fr/V/A/G/M/VAGMWKK.pdf" },
    warnings: [],
  };
  const server = new McpServer({ name: "ffhb-mcp-test-server", version: "0.1.0" });
  const client = new Client({ name: "ffhb-mcp-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  registerTools(server, {
    config: testConfig(),
    client: {
      getMatch: async (inputMatchUrl: string) => {
        assert.equal(inputMatchUrl, matchUrl);
        return output;
      },
    } as unknown as FfhbClient,
    indexer: {} as PageIndexer,
  });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const tools = await client.listTools();
    const matchTool = tools.tools.find((tool) => tool.name === "ffhb_get_match");

    assert.ok(matchTool);
    assert.deepEqual(matchTool.inputSchema.required, ["matchUrl"]);

    const result = (await client.callTool(
      {
        name: "ffhb_get_match",
        arguments: { matchUrl },
      },
      CallToolResultSchema,
    )) as CallToolResult;

    assert.deepEqual(result.structuredContent, output);
    assert.equal(result.content[0]?.type, "text");
    if (result.content[0]?.type !== "text") {
      assert.fail("Expected text content");
    }
    assert.deepEqual(JSON.parse(result.content[0].text), output);
  } finally {
    await client.close();
    await server.close();
  }
});

function testConfig(): AppConfig {
  return {
    baseUrl: "https://www.ffhandball.fr",
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    indexPath: "data/index/test-pages.json",
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
    fdmBaseUrl: "https://fdm.fdme.ffhandball.fr",
  };
}
