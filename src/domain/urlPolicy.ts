export interface UrlPolicy {
  baseUrl: URL;
  allowedHosts: Set<string>;
}

export function createUrlPolicy(baseUrl: string, allowedHosts: string[]): UrlPolicy {
  const parsedBaseUrl = new URL(baseUrl);
  const hosts = new Set(
    [parsedBaseUrl.hostname, ...allowedHosts]
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    baseUrl: parsedBaseUrl,
    allowedHosts: hosts,
  };
}

export function resolveAllowedUrl(input: string, policy: UrlPolicy): URL {
  const url = new URL(input, policy.baseUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  if (!policy.allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`URL host is not allowed: ${url.hostname}`);
  }

  url.hash = "";
  return url;
}

export function isAllowedUrl(input: string, policy: UrlPolicy): boolean {
  try {
    resolveAllowedUrl(input, policy);
    return true;
  } catch {
    return false;
  }
}
