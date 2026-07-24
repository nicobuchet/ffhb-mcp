import type { IndexedPage, SearchHit } from "../domain/page.js";
import { isAllowedUrl, resolveAllowedUrl, type UrlPolicy } from "../domain/urlPolicy.js";
import type { FfhbClient } from "../ffhb/client.js";
import type { PageStore } from "../storage/pageStore.js";

export interface IndexUrlOptions {
  maxLinkedPages?: number;
}

export class PageIndexer {
  constructor(
    private readonly client: FfhbClient,
    private readonly store: PageStore,
    private readonly urlPolicy: UrlPolicy,
  ) {}

  async indexUrl(inputUrl: string, options: IndexUrlOptions = {}): Promise<IndexedPage[]> {
    const rootUrl = resolveAllowedUrl(inputUrl, this.urlPolicy);
    const rootPage = await this.client.fetchPage(rootUrl.href);
    const pages = [rootPage];

    const maxLinkedPages = options.maxLinkedPages ?? 0;
    if (maxLinkedPages > 0) {
      const linkedUrls = rootPage.links
        .map((link) => link.href)
        .filter((href) => isAllowedUrl(href, this.urlPolicy))
        .slice(0, maxLinkedPages);

      const linkedPages = await Promise.allSettled(linkedUrls.map((href) => this.client.fetchPage(href)));
      for (const result of linkedPages) {
        if (result.status === "fulfilled") {
          pages.push(result.value);
        }
      }
    }

    await this.store.putMany(pages);
    return pages;
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return [];
    }

    const pages = await this.store.all();

    return pages
      .map((page) => scorePage(page, tokens))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function scorePage(page: IndexedPage, tokens: string[]): SearchHit {
  const haystacks = {
    title: page.title.toLowerCase(),
    text: page.text.toLowerCase(),
    url: page.url.toLowerCase(),
  };

  const score = tokens.reduce((total, token) => {
    const titleScore = countOccurrences(haystacks.title, token) * 5;
    const urlScore = countOccurrences(haystacks.url, token) * 2;
    const textScore = countOccurrences(haystacks.text, token);
    return total + titleScore + urlScore + textScore;
  }, 0);

  return {
    page,
    score,
    snippets: buildSnippets(page.text, tokens),
  };
}

function tokenize(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[\s,;:!?()"'[\]{}]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  ];
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let index = text.indexOf(token);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }

  return count;
}

function buildSnippets(text: string, tokens: string[]): string[] {
  const lowerText = text.toLowerCase();
  const snippets: string[] = [];

  for (const token of tokens) {
    const index = lowerText.indexOf(token);
    if (index === -1) {
      continue;
    }

    const start = Math.max(0, index - 120);
    const end = Math.min(text.length, index + token.length + 120);
    snippets.push(text.slice(start, end).trim());

    if (snippets.length >= 3) {
      break;
    }
  }

  return snippets;
}
