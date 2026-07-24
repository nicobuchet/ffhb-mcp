export type PageSource = "ffhb-website";

export interface PageLink {
  href: string;
  text: string;
}

export interface IndexedPage {
  url: string;
  title: string;
  text: string;
  links: PageLink[];
  fetchedAt: string;
  source: PageSource;
}

export interface SearchHit {
  page: IndexedPage;
  score: number;
  snippets: string[];
}

export interface IndexStats {
  pageCount: number;
  lastUpdatedAt: string | null;
}
