import type { IndexedPage, IndexStats, SearchHit } from "../domain/page.js";

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function compactPage(page: IndexedPage): Pick<IndexedPage, "url" | "title" | "fetchedAt" | "source"> & {
  textPreview: string;
  linkCount: number;
} {
  return {
    url: page.url,
    title: page.title,
    fetchedAt: page.fetchedAt,
    source: page.source,
    textPreview: page.text.slice(0, 1200),
    linkCount: page.links.length,
  };
}

export function compactSearchHit(hit: SearchHit): {
  url: string;
  title: string;
  score: number;
  snippets: string[];
} {
  return {
    url: hit.page.url,
    title: hit.page.title,
    score: hit.score,
    snippets: hit.snippets,
  };
}

export function formatStats(stats: IndexStats): string {
  return jsonText(stats);
}
