import type { ExtractionTeam, StandingsExtraction, StandingsRow } from "../domain/extraction.js";
import { collectComponentData } from "./smartfireComponents.js";

const STANDINGS_COMPONENT_NAME = "competitions---classement";
const STANDINGS_COMPONENT_NAMES = new Set([STANDINGS_COMPONENT_NAME]);

interface NumericField {
  outputKey: keyof NumericStandingsFields;
  sourceKeys: string[];
  label: string;
}

type NumericStandingsFields = Pick<
  StandingsRow,
  "played" | "points" | "wins" | "draws" | "losses" | "goalsFor" | "goalsAgainst" | "goalDifference" | "penalties"
>;

const NUMERIC_FIELDS: NumericField[] = [
  { outputKey: "played", sourceKeys: ["joue"], label: "played" },
  { outputKey: "points", sourceKeys: ["point", "points"], label: "points" },
  { outputKey: "wins", sourceKeys: ["gagne"], label: "wins" },
  { outputKey: "draws", sourceKeys: ["nul"], label: "draws" },
  { outputKey: "losses", sourceKeys: ["perdu"], label: "losses" },
  { outputKey: "goalsFor", sourceKeys: ["butPlus"], label: "goals for" },
  { outputKey: "goalsAgainst", sourceKeys: ["butMoins"], label: "goals against" },
  { outputKey: "goalDifference", sourceKeys: ["diff"], label: "goal difference" },
  { outputKey: "penalties", sourceKeys: ["penalite", "penalites", "pointsPenalite"], label: "penalties" },
];

export function parseStandingsExtraction(html: string): StandingsExtraction {
  const warnings: string[] = [];
  const componentData = collectComponentData(html, STANDINGS_COMPONENT_NAMES, warnings);

  if (componentData.length === 0) {
    if (!warnings.some((warning) => warning.includes(STANDINGS_COMPONENT_NAME))) {
      warnings.push(`No ${STANDINGS_COMPONENT_NAME} standings component was embedded.`);
    }

    return {
      standings: [],
      warnings,
    };
  }

  const standings: StandingsRow[] = [];
  for (const component of componentData) {
    if (!isRecord(component)) {
      warnings.push(`${STANDINGS_COMPONENT_NAME} attributes did not contain an object.`);
      continue;
    }

    if (!Array.isArray(component.classements)) {
      warnings.push(`${STANDINGS_COMPONENT_NAME} attributes did not include a classements array.`);
      continue;
    }

    component.classements.forEach((rawRow, index) => {
      if (!isRecord(rawRow)) {
        warnings.push(`Standings row ${index + 1} was not an object.`);
        return;
      }

      const row = buildStandingsRow(rawRow, index, warnings);
      if (row) {
        standings.push(row);
      }
    });
  }

  return {
    standings,
    warnings,
  };
}

function buildStandingsRow(
  rawRow: Record<string, unknown>,
  index: number,
  warnings: string[],
): StandingsRow | null {
  const id = stringValue(rawRow.ext_classementId) || stringValue(rawRow.id);
  const rowReference = id || `#${index + 1}`;
  const rawRank = firstValue(rawRow, ["place"]);
  const rank = nullableIntegerValue(rawRank);
  const teamLabel = stringValue(rawRow.equipe_libelle) || stringValue(rawRow.equipeLibelle);
  const missingFields: string[] = [];

  if (rank === undefined) {
    warnings.push(`Standings row ${rowReference} has a non-numeric rank value.`);
    return null;
  }

  if (!id) {
    missingFields.push("identifier");
  }

  if (rank === null) {
    missingFields.push("rank");
  }

  if (!teamLabel) {
    missingFields.push("team label");
  }

  if (missingFields.length > 0) {
    warnings.push(`Standings row ${rowReference} was missing ${formatList(missingFields)}.`);
    return null;
  }

  if (rank === null) {
    return null;
  }

  const numericValues = parseNumericFields(rawRow, rowReference, warnings);
  if (!numericValues) {
    return null;
  }

  return {
    id,
    internalId: stringValue(rawRow.id) || undefined,
    pouleId: stringValue(rawRow.pouleId) || undefined,
    rank,
    team: buildTeam(rawRow, teamLabel),
    played: numericValues.played,
    points: numericValues.points,
    wins: numericValues.wins,
    draws: numericValues.draws,
    losses: numericValues.losses,
    goalsFor: numericValues.goalsFor,
    goalsAgainst: numericValues.goalsAgainst,
    goalDifference: numericValues.goalDifference,
    penalties: numericValues.penalties,
  };
}

function parseNumericFields(
  rawRow: Record<string, unknown>,
  rowId: string,
  warnings: string[],
): NumericStandingsFields | null {
  const values: Partial<NumericStandingsFields> = {};

  for (const field of NUMERIC_FIELDS) {
    const value = firstValue(rawRow, field.sourceKeys);
    const parsed = nullableIntegerValue(value);
    if (parsed === undefined) {
      warnings.push(`Standings row ${rowId} has a non-numeric ${field.label} value.`);
      return null;
    }

    values[field.outputKey] = parsed;
  }

  return values as NumericStandingsFields;
}

function buildTeam(rawRow: Record<string, unknown>, label: string): ExtractionTeam {
  return {
    ...(stringValue(rawRow.equipeId) ? { id: stringValue(rawRow.equipeId) } : {}),
    ...(stringValue(rawRow.ext_equipeId) ? { externalId: stringValue(rawRow.ext_equipeId) } : {}),
    ...(stringValue(rawRow.structureId) ? { structureId: stringValue(rawRow.structureId) } : {}),
    ...(stringValue(rawRow.ext_structureId) ? { externalStructureId: stringValue(rawRow.ext_structureId) } : {}),
    label,
  };
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableIntegerValue(value: unknown): number | null | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : undefined;
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return undefined;
  }

  return Number.parseInt(trimmed, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatList(values: string[]): string {
  if (values.length === 1) {
    return values[0] ?? "";
  }

  return `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`;
}
