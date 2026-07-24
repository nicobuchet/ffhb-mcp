import type { IndexedPage, IndexStats } from "../domain/page.js";

export interface PageStore {
  all(): Promise<IndexedPage[]>;
  get(url: string): Promise<IndexedPage | null>;
  put(page: IndexedPage): Promise<void>;
  putMany(pages: IndexedPage[]): Promise<void>;
  stats(): Promise<IndexStats>;
}
