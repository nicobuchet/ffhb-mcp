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

export type TeamSide = "home" | "away";

export type MatchTimelineEventType =
  | "goal"
  | "seven_meter_goal"
  | "shot"
  | "save"
  | "warning"
  | "two_minute_suspension"
  | "disqualification"
  | "team_timeout"
  | "unknown";

export interface MatchDetailTeam {
  side: TeamSide;
  label: string;
  id?: string;
  originalSide?: string;
}

export interface MatchScorePeriod {
  label: string;
  homeScore: number;
  awayScore: number;
}

export interface MatchScore {
  homeScore: number;
  awayScore: number;
  periods: MatchScorePeriod[];
}

export interface MatchVenue {
  id?: string;
  name: string;
  address?: string;
}

export interface MatchOfficial {
  role: string;
  name: string;
  id?: string;
  teamSide?: TeamSide;
  originalSide?: string;
}

export interface MatchPlayerStats {
  goals: number;
  sevenMeterGoals: number;
  shots: number;
  saves: number;
  warnings: number;
  twoMinuteSuspensions: number;
  disqualifications: number;
}

export interface MatchPlayer {
  id: string;
  teamSide: TeamSide;
  originalSide?: string;
  number: string;
  firstName: string;
  lastName: string;
  stats: MatchPlayerStats;
  disqualified: boolean;
}

export interface MatchTimelineEvent {
  period: number | null;
  time: string | null;
  score: string | null;
  teamSide: TeamSide | null;
  sourceSide: string | null;
  type: MatchTimelineEventType;
  actionText: string;
  playerNumber: string | null;
  playerName: string | null;
  playerId: string | null;
  raw: string;
}

export interface MatchPdfStatus {
  available: boolean;
  parsed: boolean;
  url?: string;
  error?: string;
}

export interface MatchMetadata {
  matchUrl: string;
  competitionUrl?: string;
  pouleUrl?: string;
  journeeUrl?: string;
  matchCode?: string;
  fdmCode?: string;
  organizer?: string;
  competition?: string;
  poule?: string;
  group?: string;
  status?: string;
  scheduledAt?: string | null;
}

export interface MatchDetails {
  metadata: MatchMetadata;
  teams: {
    home: MatchDetailTeam;
    away: MatchDetailTeam;
  };
  score: MatchScore | null;
  venue: MatchVenue | null;
  officials: MatchOfficial[];
  tableOfficials: MatchOfficial[];
  staff: Record<TeamSide, MatchOfficial[]>;
  players: Record<TeamSide, MatchPlayer[]>;
  timeline: MatchTimelineEvent[];
  pdf: MatchPdfStatus;
  sourceUrls: {
    matchUrl: string;
    pdfUrl?: string;
  };
  warnings: string[];
}
