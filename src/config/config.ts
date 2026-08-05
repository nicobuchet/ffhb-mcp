import { createUrlPolicy, type UrlPolicy } from "../domain/urlPolicy.js";

export interface AppConfig {
  baseUrl: string;
  fdmBaseUrl: string;
  userAgent: string;
  requestTimeoutMs: number;
  indexPath: string;
  urlPolicy: UrlPolicy;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = env.FFHB_BASE_URL ?? "https://www.ffhandball.fr";
  const fdmBaseUrl = env.FFHB_FDM_BASE_URL ?? "https://fdm.fdme.ffhandball.fr";
  const allowedHosts = (env.FFHB_ALLOWED_HOSTS ?? "ffhandball.fr,www.ffhandball.fr")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  const requestTimeoutMs = Number.parseInt(env.FFHB_REQUEST_TIMEOUT_MS ?? "15000", 10);

  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("FFHB_REQUEST_TIMEOUT_MS must be a positive integer");
  }

  return {
    baseUrl,
    fdmBaseUrl,
    userAgent: env.FFHB_USER_AGENT ?? "ffhb-mcp/0.1.0",
    requestTimeoutMs,
    indexPath: env.FFHB_INDEX_PATH ?? "data/index/pages.json",
    urlPolicy: createUrlPolicy(baseUrl, allowedHosts),
  };
}
