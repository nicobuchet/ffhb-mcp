import test from "node:test";
import assert from "node:assert/strict";
import type { IndexedPage } from "../src/domain/page.js";
import { createUrlPolicy } from "../src/domain/urlPolicy.js";
import type { FfhbClient } from "../src/ffhb/client.js";
import { PageIndexer } from "../src/indexing/pageIndexer.js";
import type { PageStore } from "../src/storage/pageStore.js";

class MemoryPageStore implements PageStore {
  private readonly pages = new Map<string, IndexedPage>();

  async all(): Promise<IndexedPage[]> {
    return [...this.pages.values()];
  }

  async get(url: string): Promise<IndexedPage | null> {
    return this.pages.get(url) ?? null;
  }

  async put(page: IndexedPage): Promise<void> {
    this.pages.set(page.url, page);
  }

  async putMany(pages: IndexedPage[]): Promise<void> {
    for (const page of pages) {
      await this.put(page);
    }
  }

  async stats(): Promise<{ pageCount: number; lastUpdatedAt: string | null }> {
    return {
      pageCount: this.pages.size,
      lastUpdatedAt: null,
    };
  }
}

test("search ranks indexed pages using title and text matches", async () => {
  const store = new MemoryPageStore();
  const policy = createUrlPolicy("https://www.ffhandball.fr", []);
  const client = {} as FfhbClient;
  const indexer = new PageIndexer(client, store, policy);

  await store.putMany([
    page("https://www.ffhandball.fr/a", "Calendrier national", "Les prochains matchs de handball."),
    page("https://www.ffhandball.fr/b", "Contact", "Adresse de la federation."),
  ]);

  const hits = await indexer.search("calendrier handball", 5);

  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.page.url, "https://www.ffhandball.fr/a");
  assert.ok(hits[0]?.score > hits[1]!.score);
});

function page(url: string, title: string, text: string): IndexedPage {
  return {
    url,
    title,
    text,
    links: [],
    fetchedAt: "2026-07-24T00:00:00.000Z",
    source: "ffhb-website",
  };
}
