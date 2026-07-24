import test from "node:test";
import assert from "node:assert/strict";
import { createUrlPolicy, isAllowedUrl, resolveAllowedUrl } from "../src/domain/urlPolicy.js";

test("resolves relative URLs against the FFHandball base URL", () => {
  const policy = createUrlPolicy("https://www.ffhandball.fr", []);

  assert.equal(resolveAllowedUrl("/actualite", policy).href, "https://www.ffhandball.fr/actualite");
});

test("rejects hosts outside the configured allowlist", () => {
  const policy = createUrlPolicy("https://www.ffhandball.fr", []);

  assert.equal(isAllowedUrl("https://example.com", policy), false);
});
