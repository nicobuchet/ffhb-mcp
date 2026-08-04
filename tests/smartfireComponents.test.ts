import test from "node:test";
import assert from "node:assert/strict";
import { collectComponentData } from "../src/ffhb/smartfireComponents.js";

test("collects requested smartfire component attributes as parsed data", () => {
  const warnings: string[] = [];
  const data = collectComponentData(
    `<smartfire-component name='wanted' attributes="{&quot;label&quot;:&quot;OK&quot;}"></smartfire-component>
    <smartfire-component name='ignored' attributes="{&quot;label&quot;:&quot;NO&quot;}"></smartfire-component>`,
    new Set(["wanted"]),
    warnings,
  );

  assert.deepEqual(data, [{ label: "OK" }]);
  assert.deepEqual(warnings, []);
});

test("warns and skips malformed smartfire component attributes", () => {
  const warnings: string[] = [];
  const data = collectComponentData(
    `<smartfire-component name='wanted' attributes="{not-json"></smartfire-component>`,
    new Set(["wanted"]),
    warnings,
  );

  assert.deepEqual(data, []);
  assert.match(warnings.join("\n"), /Unable to parse wanted attributes/);
});
