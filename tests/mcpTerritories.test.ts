import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createUrlPolicy } from "../src/domain/urlPolicy.js";
import { FfhbClient } from "../src/ffhb/client.js";
import type { PageIndexer } from "../src/indexing/pageIndexer.js";
import { registerTools } from "../src/mcp/tools.js";
import { smartfireComponentHtml } from "./helpers.js";

const origin = "https://www.ffhandball.fr";
const currentSeason = `${origin}/competitions/saison-2026-2027-22/`;
const previousSeason = `${origin}/competitions/saison-2025-2026-21/`;
const aura = { id: "4", ext_structureId: "4", libelle: "LIGUE AUVERGNE-RHONE-ALPES", type: "LIG" };
const bretagne = { id: "6", ext_structureId: "7", libelle: "LIGUE BRETAGNE", type: "LIG" };
const ain = { id: "23", ext_structureId: "34", libelle: "COMITE DE L'AIN", type: "COM" };
const rhone = { id: "75", ext_structureId: "89", libelle: "COMITE DU RHONE", type: "COM" };

function menu(seasonUrl: string, attributes: Record<string, unknown> = {}): string {
  const current = seasonUrl === currentSeason;
  const saison = { ext_saisonId: current ? "22" : "21", libelle: current ? "2026 - 2027" : "2025 - 2026" };
  return smartfireComponentHtml("competitions---competition-main-menu", {
    saison, saisons: [saison], ext_saison_id: saison.ext_saisonId,
    available_types: ["REGIONAL", "DEPARTEMENTAL", "NATIONAL", "COUPE_DE_FRANCE"],
    structures: [], structure: null, url_structures: "", competitions: [], ...attributes,
  });
}

function pages(): Map<string, string | Error> {
  return new Map([
    [`${origin}/competitions/`, menu(currentSeason)],
    [currentSeason, menu(currentSeason)],
    [previousSeason, menu(previousSeason)],
    [`${currentSeason}regional/`, menu(currentSeason, { structures: [aura, bretagne] })],
    [`${previousSeason}regional/`, menu(previousSeason, { structures: [aura] })],
    [`${currentSeason}departemental/`, menu(currentSeason, { structures: [ain, rhone] })],
    [`${previousSeason}departemental/`, menu(previousSeason, { structures: [ain] })],
  ]);
}

async function mcp(t: TestContext, responses = pages()) {
  t.mock.method(globalThis, "fetch", async (input: URL | string | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = responses.get(url);
    if (body instanceof Error) throw body;
    return new Response(body ?? "Not found", {
      status: body === undefined ? 404 : 200,
      headers: { "content-type": "text/html" },
    });
  });
  const config = {
    baseUrl: origin, userAgent: "ffhb-mcp-test", requestTimeoutMs: 1000,
    indexPath: "data/index/test-pages.json", urlPolicy: createUrlPolicy(origin, []),
    fdmBaseUrl: "https://fdm.fdme.ffhandball.fr",
  };
  const server = new McpServer({ name: "territories-test", version: "1.0.0" });
  const client = new Client({ name: "territories-test-client", version: "1.0.0" });
  registerTools(server, { config, client: new FfhbClient(config), indexer: {} as PageIndexer });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  return {
    client,
    async error(name: string, args: Record<string, unknown>, expected: RegExp) {
      const result = await client.callTool({ name, arguments: args }, CallToolResultSchema) as CallToolResult;
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.match(JSON.stringify(result.content), expected);
    },
    async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = await client.callTool({ name, arguments: args }, CallToolResultSchema) as CallToolResult;
      assert.ok(!result.isError, JSON.stringify(result.content));
      assert.equal(result.content[0]?.type, "text");
      if (result.content[0]?.type !== "text") throw new Error("Expected JSON text");
      // In-memory transport retains undefined properties that JSON transports omit.
      const structured = JSON.parse(JSON.stringify(result.structuredContent));
      assert.deepEqual(JSON.parse(result.content[0].text), structured);
      return structured as T;
    },
  };
}

test("MCP lists regions and departments from their own season, defaulting to the live current season", async (t) => {
  const { client, call } = await mcp(t);
  const tools = await client.listTools();
  for (const name of ["ffhb_list_regions", "ffhb_list_departments"]) {
    assert.ok(tools.tools.some((tool) => tool.name === name));
  }

  const historical = await call("ffhb_list_regions", { seasonUrl: previousSeason });
  assert.equal(historical.seasonUrl, previousSeason);
  assert.deepEqual(historical.regions, [{
    id: `${previousSeason}regional/o-ligue-auvergne-rhone-alpes-4/`,
    label: "LIGUE AUVERGNE-RHONE-ALPES", externalId: "4",
    url: `${previousSeason}regional/o-ligue-auvergne-rhone-alpes-4/`,
    parentUrl: `${previousSeason}regional/`, seasonUrl: previousSeason,
    competitionType: "REGIONAL",
  }]);
  const current = await call("ffhb_list_regions");
  assert.equal(current.seasonUrl, currentSeason);
  assert.equal((current.regions as unknown[]).length, 2);
  const departments = await call("ffhb_list_departments", { seasonUrl: previousSeason });
  assert.equal(departments.seasonUrl, previousSeason);
  assert.deepEqual(departments.departments, [{
    id: `${previousSeason}departemental/o-comite-de-l-ain-34/`,
    label: "COMITE DE L'AIN", externalId: "34",
    url: `${previousSeason}departemental/o-comite-de-l-ain-34/`,
    parentUrl: `${previousSeason}departemental/`, seasonUrl: previousSeason,
    competitionType: "DEPARTEMENTAL",
  }]);
  const currentDepartments = await call("ffhb_list_departments");
  assert.equal(currentDepartments.seasonUrl, currentSeason);
  assert.equal((currentDepartments.departments as unknown[]).length, 2);
});

type SearchOutput = Awaited<ReturnType<FfhbClient["searchCompetitions"]>>;

test("MCP searches every territory and preserves competition URLs, ownership, query and limit filters", async (t) => {
  const responses = pages();
  const entries = [
    { type: "regional", structure: aura, slug: "ligue-auvergne-rhone-alpes-4", id: "101" },
    { type: "regional", structure: bretagne, slug: "ligue-bretagne-7", id: "102" },
    { type: "departemental", structure: ain, slug: "comite-de-l-ain-34", id: "103" },
    { type: "departemental", structure: rhone, slug: "comite-du-rhone-89", id: "104" },
  ];
  for (const entry of entries) {
    responses.set(`${currentSeason}${entry.type}/o-${entry.slug}/`, menu(currentSeason, {
      structures: [entry.structure], structure: entry.structure, url_structures: entry.slug,
      competitions: [{ libelle: "EXCELLENCE", ext_competitionId: entry.id, type: entry.type, structureId: entry.structure.id }],
    }));
  }
  responses.set(`${currentSeason}national/`, menu(currentSeason, {
    competitions: [{ libelle: "NATIONALE", ext_competitionId: "105", type: "NATIONAL" }],
  }));
  responses.set(`${currentSeason}coupe-de-france/`, menu(currentSeason, {
    competitions: [{ libelle: "COUPE", ext_competitionId: "106", type: "COUPE_DE_FRANCE" }],
  }));
  const { call } = await mcp(t, responses);
  const result = await call<SearchOutput>("ffhb_search_competitions", { query: "excellence", limit: 50 });
  assert.equal(result.filters.seasonUrl, currentSeason);
  assert.deepEqual(result.results.map((competition) => competition.url), [
    `${currentSeason}regional/excellence-101/`, `${currentSeason}regional/excellence-102/`,
    `${currentSeason}departemental/excellence-103/`, `${currentSeason}departemental/excellence-104/`,
  ]);
  assert.deepEqual(result.results[0], {
    id: `${currentSeason}regional/excellence-101/`, label: "EXCELLENCE",
    url: `${currentSeason}regional/excellence-101/`, parentUrl: `${currentSeason}regional/`, competitionType: "REGIONAL",
    region: {
      id: `${currentSeason}regional/o-ligue-auvergne-rhone-alpes-4/`, label: "LIGUE AUVERGNE-RHONE-ALPES",
      url: `${currentSeason}regional/o-ligue-auvergne-rhone-alpes-4/`, parentUrl: `${currentSeason}regional/`,
      seasonUrl: currentSeason, competitionType: "REGIONAL", externalId: "4",
    },
  });
  const departments = await call<SearchOutput>("ffhb_search_competitions", { competitionType: "departemental", limit: 1 });
  assert.equal(departments.results.length, 1);
  assert.deepEqual(departments.results[0], {
    id: `${currentSeason}departemental/excellence-103/`, label: "EXCELLENCE",
    url: `${currentSeason}departemental/excellence-103/`, parentUrl: `${currentSeason}departemental/`, competitionType: "DEPARTEMENTAL",
    department: {
      id: `${currentSeason}departemental/o-comite-de-l-ain-34/`, label: "COMITE DE L'AIN",
      url: `${currentSeason}departemental/o-comite-de-l-ain-34/`, parentUrl: `${currentSeason}departemental/`,
      seasonUrl: currentSeason, competitionType: "DEPARTEMENTAL", externalId: "34",
    },
  });
  const all = await call<SearchOutput>("ffhb_search_competitions", { limit: 50 });
  assert.equal(all.results.length, 6);
  assert.equal("region" in all.results[4], false);
  assert.equal("department" in all.results[5], false);
});

test("MCP territory filters inherit their season, restrict results and reject conflicting or unavailable inputs", async (t) => {
  const responses = pages();
  const regionUrl = `${previousSeason}regional/o-ligue-auvergne-rhone-alpes-4/`;
  const departmentUrl = `${previousSeason}departemental/o-comite-de-l-ain-34/`;
  responses.set(regionUrl, menu(previousSeason, {
    structures: [aura], structure: aura, url_structures: "ligue-auvergne-rhone-alpes-4",
    competitions: [{ libelle: "HISTORICAL", ext_competitionId: "201", type: "REGIONAL", structureId: "4" }],
  }));
  responses.set(departmentUrl, menu(previousSeason, {
    structures: [ain], structure: ain, url_structures: "comite-de-l-ain-34",
    competitions: [{ libelle: "HISTORICAL", ext_competitionId: "202", type: "DEPARTEMENTAL", structureId: "23" }],
  }));
  const { call, error } = await mcp(t, responses);
  const region = await call<SearchOutput>("ffhb_search_competitions", { territoryUrl: regionUrl });
  assert.equal(region.filters.seasonUrl, previousSeason);
  assert.equal(region.filters.competitionType, "REGIONAL");
  assert.deepEqual(region.results.map((item) => item.url), [`${previousSeason}regional/historical-201/`]);
  const department = await call<SearchOutput>("ffhb_search_competitions", {
    territoryUrl: departmentUrl, seasonUrl: previousSeason, competitionType: "départemental",
  });
  assert.deepEqual(department.results.map((item) => item.url), [`${previousSeason}departemental/historical-202/`]);
  await error("ffhb_search_competitions", { territoryUrl: regionUrl, seasonUrl: currentSeason }, /season.*conflict/i);
  await error("ffhb_search_competitions", { territoryUrl: regionUrl, competitionType: "national" }, /type.*conflict/i);
  await error("ffhb_search_competitions", { territoryUrl: `${previousSeason}regional/o-ligue-bretagne-7/` }, /territory.*not available/i);
  await error("ffhb_search_competitions", { territoryUrl: `${previousSeason}regional/historical-201/` }, /territory URL/i);
  await error("ffhb_search_competitions", { territoryUrl: "https://example.com/competitions/saison-2025-2026-21/regional/o-ligue-aura-4/" }, /host is not allowed/);
});

test("MCP returns partial search results and identifies failed territories even after reaching the limit", async (t) => {
  const responses = pages();
  const auraUrl = `${currentSeason}regional/o-ligue-auvergne-rhone-alpes-4/`;
  const bretagneUrl = `${currentSeason}regional/o-ligue-bretagne-7/`;
  responses.set(auraUrl, menu(currentSeason, {
    structures: [aura], structure: aura,
    competitions: [{ libelle: "EXCELLENCE", ext_competitionId: "101", type: "REGIONAL", structureId: "4" }],
  }));
  responses.set(bretagneUrl, new Error("Temporary upstream failure"));
  const { call } = await mcp(t, responses);
  const partial = await call("ffhb_search_competitions", { competitionType: "regional", limit: 1 });
  assert.equal(partial.complete, false);
  assert.equal((partial.results as unknown[]).length, 1);
  assert.match(JSON.stringify(partial.warnings), /LIGUE BRETAGNE/);
  assert.ok(JSON.stringify(partial.warnings).includes(bretagneUrl));
  responses.set(auraUrl, new Error("Temporary upstream failure"));
  const failed = await call("ffhb_search_competitions", { competitionType: "regional" });
  assert.equal(failed.complete, false);
  assert.deepEqual(failed.results, []);
  for (const [url, structure] of [[auraUrl, aura], [bretagneUrl, bretagne]] as const) {
    responses.set(url, menu(currentSeason, { structures: [structure], structure }));
  }
  const empty = await call("ffhb_search_competitions", { competitionType: "regional" });
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.results, []);
});

function competitionPage(competitionUrl: string, territoryUrl: string, label: string): string {
  const poule = { id: "10", ext_pouleId: "100", phaseId: "20", libelle: "POULE A", journees: '[{"journee_numero":1}]' };
  return smartfireComponentHtml("page-header", {
    title: "EXCELLENCE", breadcrumb: [
      { label, url: new URL(territoryUrl).pathname },
      { label: "EXCELLENCE", url: new URL(competitionUrl).pathname },
    ],
  }) + smartfireComponentHtml("competitions---poule-selector", {
    ext_saison_id: "21", phases: [{ id: "20", ext_phaseId: "200", libelle: "PHASE 1" }],
    poules: [poule], selected_poule: poule,
  }) + smartfireComponentHtml("competitions---rencontre-list", { rencontres: [{
    ext_rencontreId: "300", ext_pouleId: "100", journeeNumero: "1", equipe1Libelle: "HOME", equipe2Libelle: "AWAY",
  }] });
}

for (const [type, slug, label, field] of [
  ["regional", "ligue-auvergne-rhone-alpes-4", "LIGUE AUVERGNE-RHONE-ALPES", "region"],
  ["departemental", "comite-de-l-ain-34", "COMITE DE L'AIN", "department"],
] as const) {
  test(`MCP direct ${type} competition details retain territory ownership through phases, poules and results`, async (t) => {
    const competitionUrl = `${previousSeason}${type}/excellence-201/`;
    const territoryUrl = `${previousSeason}${type}/o-${slug}/`;
    const pouleUrl = `${competitionUrl}poule-100/`;
    const html = competitionPage(competitionUrl, territoryUrl, label);
    const responses = new Map<string, string | Error>([
      [competitionUrl, html], [pouleUrl, html], [`${pouleUrl}journee-1/`, html],
      [`${pouleUrl}classements/`, smartfireComponentHtml("competitions---classement", { classements: [{
        id: "1", place: "1", equipe_libelle: "HOME", joue: "1", point: "3", gagne: "1", nul: "0", perdu: "0",
        butPlus: "20", butMoins: "10", diff: "10", penalite: "0",
      }] })],
      [`${pouleUrl}rencontre-300/`, smartfireComponentHtml("competitions---rencontre-score", { rencontre: {
        ext_rencontreId: "300", equipe1Libelle: "HOME", equipe2Libelle: "AWAY", equipe1Score: "20", equipe2Score: "10",
      } })],
    ]);
    const { call } = await mcp(t, responses);
    const details = await call<Awaited<ReturnType<FfhbClient["getCompetition"]>>>("ffhb_get_competition", { competitionUrl });
    assert.deepEqual(details.competition[field], {
      id: territoryUrl, url: territoryUrl, label, parentUrl: `${previousSeason}${type}/`,
      seasonUrl: previousSeason, externalId: field === "region" ? "4" : "34",
      competitionType: field === "region" ? "REGIONAL" : "DEPARTEMENTAL",
    });
    assert.equal(details.competition.url, competitionUrl);
    assert.equal(details.competition.seasonUrl, previousSeason);
    assert.equal(field === "department" && "region" in details.competition, false);
    assert.equal(details.phases[0].url, `${competitionUrl}phase-200/`);
    const poules = await call<Awaited<ReturnType<FfhbClient["listPoules"]>>>("ffhb_list_poules", {
      competitionUrl, phaseUrl: details.phases[0].url,
    });
    assert.equal(poules.poules[0].url, pouleUrl);
    assert.deepEqual(poules.competition[field], details.competition[field]);
    const journees = await call<Awaited<ReturnType<FfhbClient["listJournees"]>>>("ffhb_list_journees", { pouleUrl });
    assert.equal(journees.journees[0].url, `${pouleUrl}journee-1/`);
    const matches = await call<Awaited<ReturnType<FfhbClient["listMatches"]>>>("ffhb_list_matches", {
      pouleUrl, journeeUrl: journees.journees[0].url,
    });
    assert.equal(matches.matches[0].url, `${pouleUrl}rencontre-300/`);
    const standings = await call<Awaited<ReturnType<FfhbClient["getStandings"]>>>("ffhb_get_standings", { pouleUrl });
    assert.equal(standings.standings[0].team.label, "HOME");
    assert.deepEqual(standings.competition[field], details.competition[field]);
    const match = await call<Awaited<ReturnType<FfhbClient["getMatch"]>>>("ffhb_get_match", { matchUrl: matches.matches[0].url });
    assert.equal(match.teams.home.label, "HOME");
  });
}

test("MCP rejects wrong-season upstream data and never substitutes the current season", async (t) => {
  const responses = pages();
  const { call, error } = await mcp(t, responses);
  responses.set(previousSeason, menu(currentSeason));
  await error("ffhb_list_regions", { seasonUrl: previousSeason }, /season.*mismatch/i);
  responses.set(previousSeason, menu(previousSeason));
  responses.set(`${previousSeason}departemental/`, menu(currentSeason, { structures: [ain, rhone] }));
  await error("ffhb_list_departments", { seasonUrl: previousSeason }, /season.*mismatch/i);
  responses.delete(`${previousSeason}departemental/`);
  await error("ffhb_list_departments", { seasonUrl: previousSeason }, /404/);
  responses.set(`${previousSeason}regional/o-ligue-auvergne-rhone-alpes-4/`, menu(currentSeason, {
    structures: [aura], structure: aura,
    competitions: [{ libelle: "WRONG SEASON", ext_competitionId: "999", type: "REGIONAL" }],
  }));
  const search = await call<SearchOutput>("ffhb_search_competitions", { seasonUrl: previousSeason, competitionType: "regional" });
  assert.equal(search.complete, false);
  assert.deepEqual(search.results, []);
  assert.match(search.warnings.join(" "), /season.*mismatch/i);
  const historicalCompetition = `${previousSeason}regional/excellence-201/`;
  responses.set(historicalCompetition, competitionPage(
    `${currentSeason}regional/excellence-201/`, `${currentSeason}regional/o-ligue-auvergne-rhone-alpes-4/`, aura.libelle,
  ));
  await error("ffhb_get_competition", { competitionUrl: historicalCompetition }, /season.*mismatch/i);
  await error("ffhb_list_regions", { seasonUrl: `${previousSeason}regional/` }, /season URL/i);
  await error("ffhb_search_competitions", { seasonUrl: `${previousSeason}regional/` }, /season URL/i);
  responses.set(previousSeason, menu(previousSeason, { available_types: ["NATIONAL"] }));
  await error("ffhb_list_regions", { seasonUrl: previousSeason }, /not available/i);
});

test("MCP distinguishes malformed territory data from a genuinely empty list or competition search", async (t) => {
  const responses = pages();
  const typeUrl = `${previousSeason}regional/`;
  const territoryUrl = `${previousSeason}regional/o-ligue-auvergne-rhone-alpes-4/`;
  const { call, error } = await mcp(t, responses);
  responses.set(typeUrl, menu(previousSeason, { structures: null }));
  await error("ffhb_list_regions", { seasonUrl: previousSeason }, /territor.*list/i);
  responses.set(typeUrl, menu(previousSeason, { structures: [aura, { libelle: "MISSING IDENTIFIER" }] }));
  await error("ffhb_list_regions", { seasonUrl: previousSeason }, /territor/i);
  responses.set(typeUrl, menu(previousSeason, { structures: [] }));
  const empty = await call("ffhb_list_regions", { seasonUrl: previousSeason });
  assert.deepEqual(empty.regions, []);
  responses.set(typeUrl, menu(previousSeason, { structures: [aura] }));
  for (const attributes of [
    { structures: [aura], structure: aura, competitions: null },
    { structures: [aura], structure: aura, competitions: [null, "broken"] },
    { structures: [aura], structure: aura, competitions: [{ libelle: "BAD", ext_competitionId: "abc", structureId: "4", type: "REGIONAL" }] },
    { structures: [aura, bretagne], structure: bretagne, competitions: [] },
    { structures: [aura], structure: aura, competitions: [{ libelle: "BAD", ext_competitionId: "201", structureId: "999", type: "REGIONAL" }] },
    { structures: [aura], structure: aura, competitions: [{ libelle: "BAD", ext_competitionId: "201", structureId: "4", type: "DEPARTEMENTAL" }] },
  ]) {
    responses.set(territoryUrl, menu(previousSeason, attributes));
    const search = await call<SearchOutput>("ffhb_search_competitions", { territoryUrl });
    assert.equal(search.complete, false);
    assert.deepEqual(search.results, []);
    assert.ok(search.warnings.some((warning) => warning.includes(territoryUrl)));
  }
});

test("MCP distinguishes territory links from competition links and warns when ownership cannot be established", async (t) => {
  const responses = pages();
  const territoryUrl = `${previousSeason}regional/o-ligue-auvergne-rhone-alpes-4/`;
  responses.set(territoryUrl, smartfireComponentHtml("page-header", {
    title: aura.libelle, breadcrumb: [{ label: aura.libelle, url: territoryUrl }],
  }));
  const competitionUrl = `${previousSeason}regional/excellence-201/`;
  responses.set(competitionUrl, competitionPage(competitionUrl, `${previousSeason}regional/`, "Regional"));
  const { call, error } = await mcp(t, responses);
  await error("ffhb_get_competition", { competitionUrl: territoryUrl }, /competition/i);
  const details = await call<Awaited<ReturnType<FfhbClient["getCompetition"]>>>("ffhb_get_competition", { competitionUrl });
  assert.equal(details.competition.region, undefined);
  assert.match(details.warnings.join(" "), /territory/i);
});
