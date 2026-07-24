import type { UrlPolicy } from "../domain/urlPolicy.js";
import { resolveAllowedUrl } from "../domain/urlPolicy.js";
import { parseHtmlPage, toIndexedPage } from "./htmlParser.js";
import type { IndexedPage } from "../domain/page.js";

export interface FfhbClientOptions {
  userAgent: string;
  requestTimeoutMs: number;
  urlPolicy: UrlPolicy;
}

export class FfhbClient {
  constructor(private readonly options: FfhbClientOptions) {}

  async fetchPage(inputUrl: string): Promise<IndexedPage> {
    const url = resolveAllowedUrl(inputUrl, this.options.urlPolicy);
    const response = await this.fetch(url);
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
      throw new Error(`Expected HTML from ${url.href}, received ${contentType || "unknown content type"}`);
    }

    const html = await response.text();
    return toIndexedPage(parseHtmlPage(html, url), url);
  }

  private async fetch(url: URL): Promise<Response> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.options.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": this.options.userAgent,
          accept: "text/html,application/xhtml+xml",
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`FFHandball request failed for ${url.href}: ${response.status} ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
