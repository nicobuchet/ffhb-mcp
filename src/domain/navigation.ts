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
