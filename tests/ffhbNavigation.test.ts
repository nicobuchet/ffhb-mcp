import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUrlPolicy } from "../src/domain/urlPolicy.js";
import { FfhbClient } from "../src/ffhb/client.js";
import { parseCompetitionDetails, parseCompetitionNavigation } from "../src/ffhb/navigationParser.js";
import { smartfireComponentHtml } from "./helpers.js";

const baseUrl = new URL("https://www.ffhandball.fr");
const seasonUrl = new URL("https://www.ffhandball.fr/competitions/saison-2026-2027-22/");
const nationalUrl = new URL("https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/");
const competitionUrl = new URL(
  "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
);
const pouleUrl = new URL(`${competitionUrl.href}poule-190313/`);
const standingsUrl = new URL("classements/", pouleUrl);
const journeeUrl = new URL(`${pouleUrl.href}journee-1/`);

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

test("parses competition metadata and exposes phases as navigation items", async () => {
  const html = await fixture("ffhb-competition.html");

  const details = parseCompetitionDetails(html, competitionUrl);

  assert.deepEqual(details.competition, {
    id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
    label: "LIGUE BUTAGAZ ENERGIE 2026-2027",
    url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
    parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/",
    seasonUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/",
    competitionType: "NATIONAL",
    externalId: "30618",
  });
  assert.deepEqual(details.phases, [
    {
      id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109535/",
      label: "LIGUE BUTAGAZ ENERGIE",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109535/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
      externalId: "109535",
      internalId: "85807",
    },
    {
      id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109536/",
      label: "PLAYOFFS",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109536/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/",
      externalId: "109536",
      internalId: "85808",
    },
  ]);
});

test("parses poules with stable canonical IDs and parent phase relationships", async () => {
  const html = await fixture("ffhb-competition.html");

  const details = parseCompetitionDetails(html, competitionUrl);

  assert.deepEqual(details.poules, [
    {
      id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
      label: "PHASE REGULIERE",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109535/",
      phaseUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109535/",
      externalId: "190313",
      internalId: "238789",
    },
    {
      id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190314/",
      label: "PLAYOFFS",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190314/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109536/",
      phaseUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109536/",
      externalId: "190314",
      internalId: "238790",
    },
  ]);
});

test("does not invent phase URLs when a poule references an unknown phase", async () => {
  const html = (await fixture("ffhb-competition.html")).replace(
    `&quot;phaseId&quot;:&quot;85808&quot;,&quot;libelle&quot;:&quot;PLAYOFFS&quot;`,
    `&quot;phaseId&quot;:&quot;99999&quot;,&quot;libelle&quot;:&quot;PLAYOFFS&quot;`,
  );

  const details = parseCompetitionDetails(html, competitionUrl);
  const playoffs = details.poules.find((poule) => poule.label === "PLAYOFFS");

  assert.equal(playoffs?.parentUrl, competitionUrl.href);
  assert.equal(playoffs?.phaseUrl, undefined);
  assert.match(details.warnings.join("\n"), /PLAYOFFS referenced an unknown phase: 99999/);
});

test("parses partial competition details with usable metadata and warnings", async () => {
  const html = await fixture("ffhb-competition-partial.html");

  const details = parseCompetitionDetails(html, competitionUrl);

  assert.equal(details.competition.label, "LIGUE BUTAGAZ ENERGIE 2026-2027");
  assert.deepEqual(details.phases, []);
  assert.deepEqual(details.poules, []);
  assert.match(details.warnings.join("\n"), /Unable to parse competitions---poule-selector attributes/);
  assert.match(details.warnings.join("\n"), /No phases/);
  assert.match(details.warnings.join("\n"), /No poules/);
});

test("client gets competition metadata from a canonical competition URL", async () => {
  const responses = new Map([
    [competitionUrl.href, await fixture("ffhb-competition.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const result = await client.getCompetition(competitionUrl.href);

    assert.equal(result.competition.label, "LIGUE BUTAGAZ ENERGIE 2026-2027");
    assert.deepEqual(result.phases.map((phase) => phase.label), ["LIGUE BUTAGAZ ENERGIE", "PLAYOFFS"]);
    assert.equal(Object.hasOwn(result, "poules"), false);
  } finally {
    restoreFetch();
  }
});

test("client lists all poules or filters them by selected phase URL", async () => {
  const phaseUrl =
    "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/phase-109536/";
  const responses = new Map([
    [competitionUrl.href, await fixture("ffhb-competition.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const allPoules = await client.listPoules({ competitionUrl: competitionUrl.href });
    const filteredPoules = await client.listPoules({ competitionUrl: competitionUrl.href, phaseUrl });

    assert.deepEqual(allPoules.poules.map((poule) => poule.label), ["PHASE REGULIERE", "PLAYOFFS"]);
    assert.deepEqual(filteredPoules.poules.map((poule) => poule.label), ["PLAYOFFS"]);
    assert.equal(filteredPoules.filters.phaseUrl, phaseUrl);
  } finally {
    restoreFetch();
  }
});

test("parses poule journees with stable canonical IDs and parent relationships", async () => {
  const html = await fixture("ffhb-poule.html");

  const details = parseCompetitionDetails(html, pouleUrl);

  assert.deepEqual(details.journees, [
    {
      id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/journee-1/",
      label: "Journee 1",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/journee-1/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
      pouleUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
      numero: 1,
      startsOn: "2026-08-29",
      endsOn: "2026-08-30",
    },
    {
      id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/journee-2/",
      label: "Journee 2",
      url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/journee-2/",
      parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
      pouleUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
      numero: 2,
      startsOn: "2026-09-02",
      endsOn: "2026-09-04",
    },
  ]);
});

test("parses matches with schedule, participants, result metadata, and canonical relationships", async () => {
  const html = await fixture("ffhb-journee.html");

  const details = parseCompetitionDetails(html, journeeUrl);

  assert.deepEqual(details.matches[0], {
    id: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/rencontre-2625116/",
    label: "BREST BRETAGNE HANDBALL vs ES BESANCON FEMININ",
    url: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/rencontre-2625116/",
    parentUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/journee-1/",
    pouleUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/",
    journeeUrl: "https://www.ffhandball.fr/competitions/saison-2026-2027-22/national/ligue-butagaz-energie-2026-2027-30618/poule-190313/journee-1/",
    externalId: "2625116",
    internalId: "2847929",
    journeeNumero: 1,
    scheduledAt: "2026-08-29T20:00:00+02:00",
    homeTeam: {
      id: "1764834",
      label: "BREST BRETAGNE HANDBALL",
    },
    awayTeam: {
      id: "1764833",
      label: "ES BESANCON FEMININ",
    },
    result: {
      homeScore: 27,
      awayScore: 24,
      homeHalfTimeScore: 12,
      awayHalfTimeScore: 10,
    },
    fdmCode: "WAGQTMC",
    venueId: "2348",
    referees: [
      { id: "9001", label: "A. Referee" },
      { id: "9002", label: "B. Referee" },
    ],
  });
  assert.deepEqual(details.matches[1]?.result, null);
  assert.deepEqual(details.matches[1]?.scheduledAt, null);
});

test("parses partial poule pages with usable navigation and warnings", async () => {
  const html = await fixture("ffhb-poule-partial.html");

  const details = parseCompetitionDetails(html, pouleUrl);

  assert.equal(details.competition.label, "LIGUE BUTAGAZ ENERGIE 2026-2027");
  assert.deepEqual(details.poules.map((poule) => poule.label), ["PHASE REGULIERE"]);
  assert.deepEqual(details.journees, []);
  assert.deepEqual(details.matches, []);
  assert.match(details.warnings.join("\n"), /Unable to parse PHASE REGULIERE journees/);
  assert.match(details.warnings.join("\n"), /Unable to parse competitions---rencontre-list attributes/);
});

test("warns when an embedded match row is too incomplete to expose", async () => {
  const html = (await fixture("ffhb-journee.html")).replace(
    `&quot;equipe1Libelle&quot;:&quot;BREST BRETAGNE HANDBALL&quot;`,
    `&quot;equipe1Libelle&quot;:&quot;&quot;`,
  );

  const details = parseCompetitionDetails(html, journeeUrl);

  assert.deepEqual(details.matches.map((match) => match.externalId), ["2625117"]);
  assert.match(details.warnings.join("\n"), /A match row was missing its identifier or participant labels/);
});

test("uses journee numero as the match parent relationship when journee parsing is partial", async () => {
  const html = (await fixture("ffhb-journee.html")).replace(/&quot;journees&quot;:&quot;.*?]&quot;/g, `&quot;journees&quot;:&quot;not-json&quot;`);

  const details = parseCompetitionDetails(html, journeeUrl);

  assert.equal(details.journees.length, 0);
  assert.equal(details.matches[0]?.parentUrl, journeeUrl.href);
  assert.equal(details.matches[0]?.journeeUrl, journeeUrl.href);
});

test("client lists poule journees and filters matches by selected journee URL", async () => {
  const responses = new Map([
    [pouleUrl.href, await fixture("ffhb-poule.html")],
    [journeeUrl.href, await fixture("ffhb-journee.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const journees = await client.listJournees(pouleUrl.href);
    const matches = await client.listMatches({ pouleUrl: pouleUrl.href, journeeUrl: journeeUrl.href });

    assert.deepEqual(journees.journees.map((journee) => journee.label), ["Journee 1", "Journee 2"]);
    assert.equal(journees.filters.pouleUrl, pouleUrl.href);
    assert.deepEqual(matches.matches.map((match) => match.externalId), ["2625116", "2625117"]);
    assert.equal(matches.filters.journeeUrl, journeeUrl.href);
  } finally {
    restoreFetch();
  }
});

test("client gets standings for a canonical poule URL with competition and poule context", async () => {
  const responses = new Map([
    [pouleUrl.href, await fixture("ffhb-poule.html")],
    [
      standingsUrl.href,
      (await fixture("ffhb-poule.html")).replace(
        "</body>",
        `${smartfireComponentHtml("competitions---classement", {
          classements: [
            {
              id: "10543916",
              ext_classementId: "59710893",
              pouleId: "238789",
              equipeId: "1764834",
              ext_equipeId: "2118500",
              structureId: "532",
              ext_structureId: "1791",
              place: "2",
              point: "38",
              joue: "22",
              gagne: "18",
              nul: "2",
              perdu: "2",
              butPlus: "650",
              butMoins: "540",
              diff: "110",
              penalite: "1",
              equipe_libelle: "BREST BRETAGNE HANDBALL",
            },
          ],
        })}</body>`,
      ),
    ],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const result = await client.getStandings(pouleUrl.href);

    assert.equal(result.competition.label, "LIGUE BUTAGAZ ENERGIE 2026-2027");
    assert.equal(result.poule.label, "PHASE REGULIERE");
    assert.deepEqual(result.filters, { pouleUrl: pouleUrl.href });
    assert.deepEqual(result.standings, [
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
    ]);
    assert.deepEqual(result.warnings, []);
  } finally {
    restoreFetch();
  }
});

test("client returns empty standings with a warning when a valid poule page has no standings component", async () => {
  const responses = new Map([
    [pouleUrl.href, await fixture("ffhb-poule.html")],
    [standingsUrl.href, await fixture("ffhb-poule.html")],
  ]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const result = await client.getStandings(pouleUrl.href);

    assert.equal(result.poule.url, pouleUrl.href);
    assert.deepEqual(result.standings, []);
    assert.match(result.warnings.join("\n"), /No competitions---classement standings component was embedded/);
  } finally {
    restoreFetch();
  }
});

test("client lists only journees that belong to the requested poule", async () => {
  const otherPouleUrl = new URL(`${competitionUrl.href}poule-190314/`).href;
  const html = (await fixture("ffhb-poule.html")).replace(
    `]}"></smartfire-component>
    <smartfire-component name='competitions---journee-selector'`,
    `,{&quot;id&quot;:&quot;238790&quot;,&quot;ext_pouleId&quot;:&quot;190314&quot;,&quot;phaseId&quot;:&quot;85807&quot;,&quot;libelle&quot;:&quot;OTHER POULE&quot;,&quot;journees&quot;:&quot;[{\\&quot;journee_numero\\&quot;:99,\\&quot;date_debut\\&quot;:\\&quot;2027-05-01\\&quot;,\\&quot;date_fin\\&quot;:\\&quot;2027-05-01\\&quot;}]&quot;}]}"></smartfire-component>
    <smartfire-component name='competitions---journee-selector'`,
  );
  const responses = new Map([[pouleUrl.href, html]]);
  const restoreFetch = stubFetch(responses);
  const client = new FfhbClient({
    userAgent: "ffhb-mcp-test",
    requestTimeoutMs: 1000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });

  try {
    const journees = await client.listJournees(pouleUrl.href);

    assert.equal(otherPouleUrl.endsWith("/poule-190314/"), true);
    assert.deepEqual(journees.journees.map((journee) => journee.numero), [1, 2]);
  } finally {
    restoreFetch();
  }
});

test(
  "live smoke: FFHandball poule exposes journees and matches",
  { skip: !process.env.FFHB_LIVE_SMOKE },
  async () => {
    const client = createLiveSmokeClient();

    const journees = await client.listJournees(pouleUrl.href);
    const matches = await client.listMatches({ pouleUrl: pouleUrl.href, journeeUrl: journeeUrl.href });

    assert.ok(journees.journees.length > 0);
    assert.ok(matches.matches.length > 0);
  },
);

test(
  "live smoke: FFHandball poule standings payload matches extractor assumptions",
  { skip: !process.env.FFHB_LIVE_SMOKE },
  async () => {
    const client = createLiveSmokeClient();

    const result = await client.getStandings(pouleUrl.href);

    assert.equal(result.filters.pouleUrl, pouleUrl.href);
    assert.equal(result.poule.url, pouleUrl.href);

    assert.deepEqual(result.warnings, []);
    assert.ok(result.standings.length > 0);
    for (const standing of result.standings) {
      assert.ok(standing.id.length > 0);
      assert.ok(standing.team.label.length > 0);
      assert.equal(Number.isInteger(standing.rank), true);
      assert.equal(isNullableInteger(standing.played), true);
      assert.equal(isNullableInteger(standing.points), true);
      assert.equal(isNullableInteger(standing.wins), true);
      assert.equal(isNullableInteger(standing.draws), true);
      assert.equal(isNullableInteger(standing.losses), true);
      assert.equal(isNullableInteger(standing.goalsFor), true);
      assert.equal(isNullableInteger(standing.goalsAgainst), true);
      assert.equal(isNullableInteger(standing.goalDifference), true);
      assert.equal(isNullableInteger(standing.penalties), true);
    }
  },
);

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

function createLiveSmokeClient(): FfhbClient {
  return new FfhbClient({
    userAgent: "ffhb-mcp-live-smoke",
    requestTimeoutMs: 10000,
    urlPolicy: createUrlPolicy("https://www.ffhandball.fr", []),
  });
}

function isNullableInteger(value: number | null): boolean {
  return value === null || Number.isInteger(value);
}
