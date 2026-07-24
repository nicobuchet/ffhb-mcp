import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IndexedPage, IndexStats } from "../domain/page.js";
import type { PageStore } from "./pageStore.js";

interface PageStoreFile {
  pages: IndexedPage[];
}

export class JsonPageStore implements PageStore {
  constructor(private readonly filePath: string) {}

  async all(): Promise<IndexedPage[]> {
    return (await this.read()).pages;
  }

  async get(url: string): Promise<IndexedPage | null> {
    return (await this.all()).find((page) => page.url === url) ?? null;
  }

  async put(page: IndexedPage): Promise<void> {
    await this.putMany([page]);
  }

  async putMany(pages: IndexedPage[]): Promise<void> {
    const file = await this.read();
    const byUrl = new Map(file.pages.map((page) => [page.url, page]));

    for (const page of pages) {
      byUrl.set(page.url, page);
    }

    await this.write({ pages: [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url)) });
  }

  async stats(): Promise<IndexStats> {
    const pages = await this.all();
    const lastUpdatedAt =
      pages
        .map((page) => page.fetchedAt)
        .sort()
        .at(-1) ?? null;

    return {
      pageCount: pages.length,
      lastUpdatedAt,
    };
  }

  private async read(): Promise<PageStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PageStoreFile;

      return {
        pages: Array.isArray(parsed.pages) ? parsed.pages : [],
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { pages: [] };
      }

      throw error;
    }
  }

  private async write(file: PageStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
