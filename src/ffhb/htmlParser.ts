import * as cheerio from "cheerio";
import type { IndexedPage, PageLink } from "../domain/page.js";

export interface ParsedPage {
  title: string;
  text: string;
  links: PageLink[];
}

export function parseHtmlPage(html: string, pageUrl: URL): ParsedPage {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg").remove();

  const title =
    cleanText($("meta[property='og:title']").attr("content") ?? "") ||
    cleanText($("title").first().text()) ||
    pageUrl.href;

  const text = cleanText($("body").text());
  const links = extractLinks($, pageUrl);

  return { title, text, links };
}

export function toIndexedPage(parsedPage: ParsedPage, url: URL, fetchedAt = new Date()): IndexedPage {
  return {
    url: url.href,
    title: parsedPage.title,
    text: parsedPage.text,
    links: parsedPage.links,
    fetchedAt: fetchedAt.toISOString(),
    source: "ffhb-website",
  };
}

function extractLinks($: cheerio.CheerioAPI, pageUrl: URL): PageLink[] {
  const seen = new Set<string>();
  const links: PageLink[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    try {
      const url = new URL(href, pageUrl);
      url.hash = "";

      if (!["http:", "https:"].includes(url.protocol) || seen.has(url.href)) {
        return;
      }

      seen.add(url.href);
      links.push({
        href: url.href,
        text: cleanText($(element).text()),
      });
    } catch {
      // Ignore malformed links from the source page.
    }
  });

  return links;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
