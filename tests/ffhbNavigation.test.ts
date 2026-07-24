import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUrlPolicy } from "../src/domain/urlPolicy.js";
import { FfhbClient } from "../src/ffhb/client.js";
import { parseCompetitionNavigation } from "../src/ffhb/navigationParser.js";

const baseUrl = new URL("https://www.ffhandball.fr");
const seasonUrl = new URL("https://www.ffhandball.fr/competitions/saison-2026-2027-22/");
const nationalUrl = new URL("https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/");

test("parses seasons with canonical URLs and available competition types", async () => {
  const html = await fixture("ffhb-season.html");

  const navigation = parseCompetitionNavigation(html, seasonUrl);

  assert.equal(navigation.currentSeasonUrl, "https://www.ffhandball.fr/competitions/saison-2026-2027-22/");
  assert.deepEqual(
    navigation.seasons.map((season) => ({
      id: season.id,
      label: season.label,
      url: season.url,
      typeLabels: season.competitionTypes.map((competitionType) => competitionType.label),
    })),
    [
      {
        id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/",
        label: "2026 - 2027",
        url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/",
        typeLabels: ["Departemental", "Regional", "Coupe de France", "National"],
      },
      {
        id: "https://www.ffhandball.fr/competitions/saison-2025-2026-21/",
        label: "2025 - 2026",
        url: "https://www.ffhandball.fr/competitions/saison-2025-2026-21/",
        typeLabels: ["Departemental", "Regional", "Coupe de France", "National"],
      },
    ],
  );
});

test("parses competition results with stable item shape and resolvable URLs", async () => {
  const html = await fixture("ffhb-national.html");

  const navigation = parseCompetitionNavigation(html, nationalUrl);

  assert.deepEqual(navigation.competitions[0], {
    id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
    label: "LIGUE BUTAGAZ ENERGIE 2026-2027",
    url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
    parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/",
    competitionType: "NATIONAL",
  });
});

test("returns usable parsed data with warnings when one component is malformed", async () => {
  const html = await fixture("ffhb-partial.html");

  const navigation = parseCompetitionNavigation(html, seasonUrl);

  assert.equal(navigation.seasons.length, 1);
  assert.match(navigation.warnings.join("\n"), /Unable to parse competitions---search-bar attributes/);
  assert.match(navigation.warnings.join("\n"), /No competition types/);
});

test("rejects pages without interpretable competition navigation", () => {
  assert.throws(
    () => parseCompetitionNavigation("<html><body>No competition data</body></html>", baseUrl),
    /Unable to interpret FFHandball competition navigation/,
  );
});

test("rejects competition components that contain no usable navigation data", () => {
  assert.throws(
    () =>
      parseCompetitionNavigation(
        `<smartfire-component name='competitions---competition-main-menu' attributes="{&quot;available_types&quot;:[],&quot;competitions&quot;:[]}"></smartfire-component>`,
        seasonUrl,
      ),
    /Unable to interpret FFHandball competition navigation/,
  );
});

test("client searches live competition pages using optional filters", async () => {
  const responses = new Map([
    ["https://www.ffhandball.fr/competitions/", await fixture("ffhb-season.html")],
    ["https://www.ffhandball.fr/competitions/saison-2026-2027-22/", await fixture("ffhb-season.html")],
    ["https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/", await fixture("ffhb-national.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const result = await client.searchCompetitions({
      query: "butagaz",
      seasonUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/",
      competitionType: "national",
      limit: 5,
    });

    assert.deepEqual(result.results.map((item) => item.label), ["LIGUE BUTAGAZ ENERGIE 2026-2027"]);
    assert.equal(result.results[0]?.parentUrl, "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/");
  } finally {
    restoreFetch();
  }
});

test("client lists seasons with competition types fetched from each season page", async () => {
  const responses = new Map([
    ["https://www.ffhandball.fr/competitions/", await fixture("ffhb-season.html")],
    ["https://www.ffhandball.fr/competitions/saison-2026-2027-22/", await fixture("ffhb-season.html")],
    ["https://www.ffhandball.fr/competitions/saison-2025-2026-21/", await fixture("ffhb-season-2025.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const result = await client.listSeasons();

    assert.deepEqual(
      result.seasons.map((season) => ({
        label: season.label,
        typeLabels: season.competitionTypes.map((competitionType) => competitionType.label),
      })),
      [
        {
          label: "2026 - 2027",
          typeLabels: ["Departemental", "Regional", "Coupe de France", "National"],
        },
        {
          label: "2025 - 2026",
          typeLabels: ["National"],
        },
      ],
    );
  } finally {
    restoreFetch();
  }
});

test("client rejects competition types not exposed by the season page", async () => {
  const responses = new Map([
    ["https://www.ffhandball.fr/competitions/saison-2026-2027-22/", await fixture("ffhb-season.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    await assert.rejects(
      () =>
        client.searchCompetitions({
          seasonUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/",
          competitionType: "unknown",
        }),
      /Competition type is not available/,
    );
  } finally {
    restoreFetch();
  }
});

async function fixture(name: string): Promise<string> {
  return readFile(join(process.cwd(), "tests", "fixtures", name), "utf8");
}

function stubFetch(responses: Map<string, string>): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = responses.get(url);

    if (body === undefined) {
      return new Response("not found", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html" },
      });
    }

    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
