export interface NavigationItem {
  id: string;
  label: string;
  url: string;
  parentUrl?: string;
}

export const COMPETITION_SEARCH_LIMIT_MIN = 1;
export const COMPETITION_SEARCH_LIMIT_MAX = 50;

export interface SeasonNavigationItem extends NavigationItem {
  competitionTypes: NavigationItem[];
}

export interface CompetitionSearchFilters {
  query?: string;
  seasonUrl?: string;
  competitionType?: string;
  limit?: number;
}

export interface CompetitionSearchResult extends NavigationItem {
  competitionType: string;
}

export interface CompetitionNavigation {
  seasons: SeasonNavigationItem[];
  currentSeasonUrl: string | null;
  competitionTypes: NavigationItem[];
  competitions: CompetitionSearchResult[];
  warnings: string[];
}

export interface CompetitionMetadata extends NavigationItem {
  seasonUrl: string;
  competitionType: string;
  externalId: string;
}

export interface CompetitionPhase extends NavigationItem {
  externalId: string;
  internalId?: string;
}

export interface PouleNavigationItem extends NavigationItem {
  phaseUrl?: string;
  externalId: string;
  internalId?: string;
}

export interface JourneeNavigationItem extends NavigationItem {
  pouleUrl: string;
  numero: number;
  startsOn?: string;
  endsOn?: string;
}

export interface MatchTeam {
  id?: string;
  label: string;
}

export interface MatchResult {
  homeScore: number;
  awayScore: number;
  homeHalfTimeScore?: number | null;
  awayHalfTimeScore?: number | null;
}

export interface MatchNavigationItem extends NavigationItem {
  pouleUrl: string;
  journeeUrl?: string;
  externalId: string;
  internalId?: string;
  journeeNumero?: number;
  scheduledAt: string | null;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  result: MatchResult | null;
  fdmCode?: string;
  venueId?: string;
  referees: MatchTeam[];
}

export interface CompetitionOverview {
  competition: CompetitionMetadata;
  phases: CompetitionPhase[];
  warnings: string[];
}

export interface CompetitionDetails {
  competition: CompetitionMetadata;
  phases: CompetitionPhase[];
  poules: PouleNavigationItem[];
  journees: JourneeNavigationItem[];
  matches: MatchNavigationItem[];
  warnings: string[];
}

export interface PouleListFilters {
  competitionUrl: string;
  phaseUrl?: string;
}

export interface MatchListFilters {
  pouleUrl: string;
  journeeUrl?: string;
}
