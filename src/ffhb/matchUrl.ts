export interface MatchUrlContext {
  competitionUrl?: string;
  pouleUrl?: string;
  journeeUrl?: string;
  matchCode?: string;
}

export function inferMatchUrlContext(inputUrl: string | URL): MatchUrlContext {
  const url = typeof inputUrl === "string" ? new URL(inputUrl) : inputUrl;
  const competitionMatch = url.pathname.match(/^(\/competitions\/saison-\d{4}-\d{4}-\d+\/[^/]+\/[^/]+-\d+\/)/);
  const pouleMatch = url.pathname.match(
    /^(\/competitions\/saison-\d{4}-\d{4}-\d+\/[^/]+\/[^/]+-\d+\/poule-\d+\/)/,
  );
  const matchCode = url.pathname.match(/\/rencontre-(\d+)\/?$/)?.[1];

  return {
    ...(competitionMatch ? { competitionUrl: new URL(competitionMatch[1], url).href } : {}),
    ...(pouleMatch ? { pouleUrl: new URL(pouleMatch[1], url).href } : {}),
    ...(matchCode ? { matchCode } : {}),
  };
}
