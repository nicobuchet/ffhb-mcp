import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUrlPolicy } from "../src/domain/urlPolicy.js";
import type { IndexedPage } from "../src/domain/page.js";
import { FfhbClient } from "../src/ffhb/client.js";
import { parseMatchSheetText } from "../src/ffhb/matchSheetParser.js";
import { PageIndexer } from "../src/indexing/pageIndexer.js";
import type { PageStore } from "../src/storage/pageStore.js";

const matchUrl =
  "https://www.ffhandball.fr/competitions/saison-2025-2026-21/regional/16-ans-m-excellence-28342/poule-169110/rencontre-2382620/";
const pdfUrl = "https://fdm.fdme.ffhandball.fr/V/A/G/M/VAGMWKK.pdf";

test("parses public match sheet text with normalized teams, stats, timeline, and no licence numbers", async () => {
  const parsed = parseMatchSheetText(await fixture("ffhb-match-sheet.txt"), { matchUrl, pdfUrl });

  assert.equal(parsed.metadata.matchCode, "2382620");
  assert.equal(parsed.metadata.fdmCode, "VAGMWKK");
  assert.equal(parsed.teams.home.label, "PDF HOME CLUB");
  assert.equal(parsed.teams.home.originalSide, "JR / Recevant");
  assert.equal(parsed.teams.away.label, "PDF AWAY CLUB");
  assert.equal(parsed.score?.homeScore, 29);
  assert.equal(parsed.score?.awayScore, 26);
  assert.deepEqual(parsed.score?.periods, [
    { label: "first_half", homeScore: 14, awayScore: 12 },
    { label: "period_1", homeScore: 14, awayScore: 12 },
    { label: "period_2", homeScore: 15, awayScore: 14 },
  ]);
  assert.deepEqual(parsed.tableOfficials.map((official) => official.role), ["chronometreur", "secretaire"]);
  assert.deepEqual(parsed.staff.map((official) => `${official.teamSide}:${official.name}`), [
    "home:Coach Home",
    "away:Coach Away",
  ]);
  assert.deepEqual(parsed.players[0], {
    id: "home:7",
    teamSide: "home",
    originalSide: "JR / Recevant",
    number: "7",
    name: "Louise Pivot",
    stats: {
      goals: 5,
      sevenMeterGoals: 1,
      shots: 8,
      saves: 0,
      warnings: 1,
      twoMinuteSuspensions: 0,
      disqualifications: 0,
    },
    disqualified: false,
  });
  assert.equal(parsed.players[1]?.stats.goals, 0);
  assert.equal(parsed.players[1]?.stats.saves, 6);
  assert.equal(parsed.players[1]?.disqualified, true);
  assert.deepEqual(
    parsed.timeline.map((event) => ({
      period: event.period,
      time: event.time,
      score: event.score,
      teamSide: event.teamSide,
      sourceSide: event.sourceSide,
      type: event.type,
      playerId: event.playerId,
    })),
    [
      { period: 1, time: "00:31", score: "1-0", teamSide: "home", sourceSide: "JR", type: "goal", playerId: "home:7" },
      { period: 1, time: "01:12", score: "1-1", teamSide: "away", sourceSide: "JV", type: "goal", playerId: "away:15" },
      {
        period: 1,
        time: "02:00",
        score: "1-1",
        teamSide: "home",
        sourceSide: "JR",
        type: "warning",
        playerId: "home:7",
      },
      {
        period: 2,
        time: "45:18",
        score: "20-19",
        teamSide: "away",
        sourceSide: "JV",
        type: "two_minute_suspension",
        playerId: "away:15",
      },
      { period: 2, time: "49:10", score: "22-20", teamSide: "home", sourceSide: "JR", type: "save", playerId: "home:14" },
      {
        period: 2,
        time: "55:00",
        score: "25-24",
        teamSide: "home",
        sourceSide: "JR",
        type: "team_timeout",
        playerId: null,
      },
    ],
  );

  assert.equal(JSON.stringify(parsed).includes("1234567"), false);
  assert.deepEqual(parsed.warnings, []);
});

test("client gets a match by URL, prefers the embedded PDF URL, and keeps PDF data authoritative", async () => {
  const fetchedUrls: string[] = [];
  const restoreFetch = stubFetch(
    new Map([
      [matchUrl, htmlResponse(await fixture("ffhb-match.html"))],
      [pdfUrl, pdfResponse("fake pdf bytes")],
    ]),
    fetchedUrls,
  );
  const client = testClient(async () => fixture("ffhb-match-sheet.txt"));

  try {
    const result = await client.getMatch(matchUrl);

    assert.deepEqual(fetchedUrls, [matchUrl, pdfUrl]);
    assert.equal(result.pdf.parsed, true);
    assert.equal(result.pdf.url, pdfUrl);
    assert.equal(result.sourceUrls.matchUrl, matchUrl);
    assert.equal(result.sourceUrls.pdfUrl, pdfUrl);
    assert.equal(result.teams.home.label, "PDF HOME CLUB");
    assert.equal(result.score?.homeScore, 29);
    assert.equal(result.venue?.name, "GYMNASE OFFICIEL - Terrain 1");
    assert.equal(JSON.stringify(result).includes("HTML HOME SHOULD NOT WIN"), false);
    assert.equal(JSON.stringify(result).includes("1234567"), false);
  } finally {
    restoreFetch();
  }
});

test("client returns partial HTML match data with warnings when no PDF can be discovered", async () => {
  const restoreFetch = stubFetch(new Map([[matchUrl, htmlResponse(await fixture("ffhb-match-no-pdf.html"))]]));
  const client = testClient(async () => {
    throw new Error("should not parse a missing PDF");
  });

  try {
    const result = await client.getMatch(matchUrl);

    assert.equal(result.pdf.available, false);
    assert.equal(result.pdf.parsed, false);
    assert.equal(result.metadata.journeeUrl, `${result.metadata.pouleUrl}journee-6/`);
    assert.equal(result.teams.home.label, "HTML HOME FALLBACK");
    assert.equal(result.score?.homeScore, 21);
    assert.deepEqual(
      result.players.map((player) => ({
        id: player.id,
        teamSide: player.teamSide,
        number: player.number,
        name: player.name,
        goals: player.stats.goals,
        shots: player.stats.shots,
        warnings: player.stats.warnings,
      })),
      [
        { id: "home:9", teamSide: "home", number: "9", name: "Fallback Home", goals: 3, shots: 5, warnings: 0 },
        { id: "away:4", teamSide: "away", number: "4", name: "Fallback Away", goals: 0, shots: 0, warnings: 1 },
      ],
    );
    assert.equal(JSON.stringify(result).includes("9999999"), false);
    assert.match(result.warnings.join("\n"), /No match sheet PDF URL could be discovered/);
  } finally {
    restoreFetch();
  }
});

test("client refuses to fetch a discovered PDF outside the configured FDM host", async () => {
  const html = (await fixture("ffhb-match.html")).replace(pdfUrl, "https://example.com/V/A/G/M/VAGMWKK.pdf");
  const fetchedUrls: string[] = [];
  const restoreFetch = stubFetch(new Map([[matchUrl, htmlResponse(html)]]), fetchedUrls);
  const client = testClient(async () => {
    throw new Error("external PDF should not be fetched");
  });

  try {
    const result = await client.getMatch(matchUrl);

    assert.deepEqual(fetchedUrls, [matchUrl]);
    assert.equal(result.pdf.available, false);
    assert.match(result.warnings.join("\n"), /not allowed/);
  } finally {
    restoreFetch();
  }
});

test("listMatches remains lightweight and does not fetch match sheet PDFs", async () => {
  const pouleUrl =
    "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/";
  const journeeUrl = `${pouleUrl}journee-1/`;
  const fetchedUrls: string[] = [];
  const restoreFetch = stubFetch(
    new Map([
      [pouleUrl, htmlResponse(await fixture("ffhb-poule.html"))],
      [journeeUrl, htmlResponse(await fixture("ffhb-journee.html"))],
    ]),
    fetchedUrls,
  );
  const client = testClient(async () => {
    throw new Error("listMatches should not parse PDFs");
  });

  try {
    const result = await client.listMatches({ pouleUrl, journeeUrl });

    assert.equal(result.matches[0]?.fdmCode, "WAGQTMC");
    assert.deepEqual(fetchedUrls, [pouleUrl, journeeUrl]);
  } finally {
    restoreFetch();
  }
});

test("indexing a match URL stores a searchable synthetic public page without licence numbers", async () => {
  const store = new MemoryPageStore();
  const indexer = new PageIndexer(
    {
      getMatch: async () => parseMatchSheetText(await fixture("ffhb-match-sheet.txt"), { matchUrl, pdfUrl }),
      fetchPage: async () => {
        throw new Error("match indexing should use structured extraction");
      },
    } as unknown as FfhbClient,
    store,
    createUrlPolicy("https://www.ffhandball.fr", []),
  );

  const pages = await indexer.indexUrl(matchUrl);
  const hits = await indexer.search("Louise Pivot team_timeout", 5);

  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.url, matchUrl);
  assert.equal(pages[0]?.title, "PDF HOME CLUB 29-26 PDF AWAY CLUB");
  assert.equal(pages[0]?.source, "ffhb-website");
  assert.equal(pages[0]?.text.includes("Louise Pivot"), true);
  assert.equal(pages[0]?.text.includes("team_timeout"), true);
  assert.equal(pages[0]?.text.includes("1234567"), false);
  assert.equal(hits[0]?.page.url, matchUrl);
});

test(
  "live smoke: FFHandball match page exposes a PDF-backed match sheet",
  { skip: !process.env.FFHB_LIVE_SMOKE },
  async () => {
    const client = new FfhbClient({
      userAgent: "ffhb-mcp-live-smoke",
      requestTimeoutMs: 10000,
      urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
      fdmBaseUrl: "https://fdm.fdme.ffhandball.fr",
    });

    const result = await client.getMatch(matchUrl);

    assert.equal(result.metadata.fdmCode, "VAGMWKK");
    assert.equal(result.metadata.matchCode, "2382620");
    assert.equal(result.tableOfficials.some((official) => official.name === "Juge"), false);
    assert.equal(result.pdf.parsed, true);
    assert.ok(result.teams.home.label.length > 0);
    assert.ok(result.teams.away.label.length > 0);
    assert.ok(result.score?.homeScore !== undefined);
    assert.ok(result.players.length > 0);
    assert.ok(result.timeline.length > 0);
  },
);

class MemoryPageStore implements PageStore {
  private readonly pages = new Map<string, IndexedPage>();

  async all(): Promise<IndexedPage[]> {
    return [...this.pages.values()];
  }

  async get(url: string): Promise<IndexedPage | null> {
    return this.pages.get(url) ?? null;
  }

  async put(page: IndexedPage): Promise<void> {
    this.pages.set(page.url, page);
  }

  async putMany(pages: IndexedPage[]): Promise<void> {
    for (const page of pages) {
      await this.put(page);
    }
  }

  async stats(): Promise<{ pageCount: number; lastUpdatedAt: string | null }> {
    return { pageCount: this.pages.size, lastUpdatedAt: null };
  }
}

async function fixture(name: string): Promise<string> {
  return readFile(join(process.cwd(), "tests", "fixtures", name), "utf8");
}

function testClient(pdfTextExtractor: (data: Uint8Array) => Promise<string>): FfhbClient {
  return new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
    fdmBaseUrl: "https://fdm.fdme.ffhandball.fr",
    pdfTextExtractor,
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}

function pdfResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

function stubFetch(responses: Map<string, Response>, fetchedUrls: string[] = []): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    fetchedUrls.push(url);
    const response = responses.get(url);

    if (!response) {
      return new Response("not found", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html" },
      });
    }

    return response.clone();
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
