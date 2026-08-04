import * as cheerio from "cheerio";
import { errorMessage } from "./errors.js";

export function collectComponentData(html: string, componentNames: Set<string>, warnings: string[]): unknown[] {
  const $ = cheerio.load(html);
  const componentData: unknown[] = [];

  $("smartfire-component").each((_, element) => {
    const name = $(element).attr("name");
    if (!name || !componentNames.has(name)) {
      return;
    }

    const attributes = $(element).attr("attributes");
    if (!attributes) {
      warnings.push(`Component ${name} did not include attributes.`);
      return;
    }

    const parsed = parseComponentAttributes(attributes, name, warnings);
    if (parsed) {
      componentData.push(parsed);
    }
  });

  return componentData;
}

export function parseComponentAttributes(
  attributes: string,
  componentName: string,
  warnings: string[],
): unknown | null {
  try {
    return JSON.parse(attributes);
  } catch (error) {
    warnings.push(`Unable to parse ${componentName} attributes: ${errorMessage(error)}`);
    return null;
  }
}
