import type { CompetitionMetadata, PouleNavigationItem } from "./navigation.js";

export interface ExtractionTeam {
  id?: string;
  externalId?: string;
  structureId?: string;
  externalStructureId?: string;
  label: string;
}

export interface StandingsRow {
  id: string;
  internalId?: string;
  pouleId?: string;
  rank: number;
  team: ExtractionTeam;
  played: number | null;
  points: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  penalties: number | null;
}

export interface StandingsExtraction {
  standings: StandingsRow[];
  warnings: string[];
}

export interface StandingsDetails {
  competition: CompetitionMetadata;
  poule: PouleNavigationItem;
  filters: {
    pouleUrl: string;
  };
  standings: StandingsRow[];
  warnings: string[];
}
