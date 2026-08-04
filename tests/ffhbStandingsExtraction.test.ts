import test from "node:test";
import assert from "node:assert/strict";
import { parseStandingsExtraction } from "../src/ffhb/extractionParser.js";
import { smartfireComponentHtml } from "./helpers.js";

test("parses standings rows with normalized table-shaped fields", () => {
  const result = parseStandingsExtraction(
    smartfireComponentHtml("competitions---classement", {
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
        {
          id: "10543926",
          ext_classementId: "59710898",
          pouleId: "238789",
          equipeId: "1764844",
          place: "7",
          point: "12",
          joue: "22",
          gagne: "5",
          nul: "2",
          perdu: "15",
          butPlus: "520",
          butMoins: "590",
          diff: "-70",
          equipe_libelle: "TOULON METROPOLE VAR HANDBALL",
        },
      ],
    }),
  );

  assert.deepEqual(result, {
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
      {
        id: "59710898",
        internalId: "10543926",
        pouleId: "238789",
        rank: 7,
        team: {
          id: "1764844",
          label: "TOULON METROPOLE VAR HANDBALL",
        },
        played: 22,
        points: 12,
        wins: 5,
        draws: 2,
        losses: 15,
        goalsFor: 520,
        goalsAgainst: 590,
        goalDifference: -70,
        penalties: null,
      },
    ],
    warnings: [],
  });
});

test("returns an empty standings list with a warning when the component is absent", () => {
  const result = parseStandingsExtraction("<html><body>No standings component</body></html>");

  assert.deepEqual(result.standings, []);
  assert.match(result.warnings.join("\n"), /No competitions---classement standings component was embedded/);
});

test("warns when standings component attributes are malformed", () => {
  const result = parseStandingsExtraction(
    `<smartfire-component name='competitions---classement' attributes="{not-json"></smartfire-component>`,
  );

  assert.deepEqual(result.standings, []);
  assert.match(result.warnings.join("\n"), /Unable to parse competitions---classement attributes/);
});

test("warns and skips malformed standings rows without discarding usable rows", () => {
  const result = parseStandingsExtraction(
    smartfireComponentHtml("competitions---classement", {
      classements: [
        {
          id: "10543916",
          ext_classementId: "59710893",
          place: "1",
          point: "abc",
          joue: "22",
          gagne: "18",
          nul: "2",
          perdu: "2",
          butPlus: "650",
          butMoins: "540",
          diff: "110",
          equipe_libelle: "BREST BRETAGNE HANDBALL",
        },
        {
          id: "10543926",
          ext_classementId: "59710898",
          place: "2",
          point: "12",
          joue: "22",
          gagne: "5",
          nul: "2",
          perdu: "15",
          butPlus: "520",
          butMoins: "590",
          diff: "-70",
          equipe_libelle: "",
        },
        {
          id: "10543927",
          ext_classementId: "59710899",
          place: "abc",
          point: "8",
          joue: "17",
          gagne: "2",
          nul: "4",
          perdu: "5",
          butPlus: "480",
          butMoins: "499",
          diff: "-19",
          equipe_libelle: "OGC NICE COTE D'AZUR HANDBALL",
        },
        {
          id: "10543918",
          ext_classementId: "59710894",
          place: "3",
          point: "8",
          joue: "",
          gagne: "2",
          nul: "4",
          perdu: "5",
          butPlus: "480",
          butMoins: "499",
          diff: "-19",
          equipe_libelle: "JDA BOURGOGNE DIJON HANDBALL",
        },
      ],
    }),
  );

  assert.deepEqual(
    result.standings.map((row) => ({
      id: row.id,
      team: row.team.label,
      played: row.played,
    })),
    [{ id: "59710894", team: "JDA BOURGOGNE DIJON HANDBALL", played: null }],
  );
  assert.match(result.warnings.join("\n"), /Standings row 59710893 has a non-numeric points value/);
  assert.match(result.warnings.join("\n"), /Standings row 59710898 was missing team label/);
  assert.match(result.warnings.join("\n"), /Standings row 59710899 has a non-numeric rank value/);
});

test("does not include raw smartfire component JSON in extracted output", () => {
  const result = parseStandingsExtraction(
    smartfireComponentHtml("competitions---classement", {
      ext_saison_id: "22",
      classements: [
        {
          id: "10543916",
          ext_classementId: "59710893",
          place: "1",
          point: "38",
          joue: "22",
          gagne: "18",
          nul: "2",
          perdu: "2",
          butPlus: "650",
          butMoins: "540",
          diff: "110",
          equipe_libelle: "BREST BRETAGNE HANDBALL",
        },
      ],
    }),
  );

  assert.equal(JSON.stringify(result).includes("classements"), false);
  assert.equal(JSON.stringify(result).includes("ext_saison_id"), false);
});
