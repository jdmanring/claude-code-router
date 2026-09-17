import assert from "node:assert/strict";
import test from "node:test";
import {
  presetTemplateIssues,
  presetTemplateKeys,
  resolveTemplate,
  templateIsUnresolved,
  templateMatchesResolvedUrl,
  templateVariableKeys,
  variableValueIssue
} from "@ccr/core/providers/presets/template.ts";
import { findProviderPreset, findProviderPresetByBaseUrl, providerPresets } from "@ccr/core/providers/presets/index.ts";

const cloudflareTemplate = "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1";
const accountId = "fa9d10dab585af725e670dae5a5a2bbe";
const cloudflareResolved = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;

test("placeholders are read in order and without repeats", () => {
  assert.deepEqual(templateVariableKeys("https://x/{project}/{region}/{project}"), ["project", "region"]);
  assert.deepEqual(templateVariableKeys("https://api.mistral.ai/v1"), []);
  assert.deepEqual(templateVariableKeys(undefined), []);
  // A brace that is not a well-formed key is left alone.
  assert.deepEqual(templateVariableKeys("https://x/{9bad}/{}"), []);
});

test("a value is substituted and a missing one leaves the placeholder", () => {
  assert.equal(resolveTemplate(cloudflareTemplate, { accountId }), cloudflareResolved);
  assert.equal(resolveTemplate(cloudflareTemplate, {}), cloudflareTemplate);
  // Blank must not resolve, or a half-built URL would be stored.
  assert.equal(resolveTemplate(cloudflareTemplate, { accountId: "   " }), cloudflareTemplate);
  assert.equal(templateIsUnresolved(resolveTemplate(cloudflareTemplate, {})), true);
  assert.equal(templateIsUnresolved(resolveTemplate(cloudflareTemplate, { accountId })), false);
});

test("a resolved url is recognised as coming from its template", () => {
  assert.equal(templateMatchesResolvedUrl(cloudflareTemplate, cloudflareResolved), true);
  // A placeholder fills one segment, so a value carrying a slash cannot satisfy it.
  assert.equal(
    templateMatchesResolvedUrl(cloudflareTemplate, "https://api.cloudflare.com/client/v4/accounts/a/b/ai/v1"),
    false
  );
  assert.equal(templateMatchesResolvedUrl(cloudflareTemplate, "https://api.cloudflare.com/client/v4/accounts//ai/v1"), false);
  assert.equal(templateMatchesResolvedUrl("https://api.mistral.ai/v1", "https://api.mistral.ai/v1"), true);
  assert.equal(templateMatchesResolvedUrl("https://api.mistral.ai/v1", "https://api.other.ai/v1"), false);
});

test("a supplied value is rejected when it would reshape the url", () => {
  const variable = { key: "accountId", label: "Account ID", pattern: "[0-9a-fA-F]{32}" };
  assert.equal(variableValueIssue(variable, accountId), undefined);
  assert.match(variableValueIssue(variable, ""), /required/);
  assert.match(variableValueIssue(variable, "a/b"), /slashes/);
  assert.match(variableValueIssue(variable, "not-hex"), /expected format/);
  // A preset carrying an unusable pattern must not block anyone.
  assert.equal(variableValueIssue({ key: "k", label: "K", pattern: "([" }, "anything"), undefined);
});

test("the Cloudflare preset declares what its endpoint needs", () => {
  const preset = findProviderPreset("cloudflare-workers-ai");
  assert.ok(preset);
  assert.deepEqual(presetTemplateKeys(preset), ["accountId"]);
  assert.deepEqual(presetTemplateIssues(preset), []);
  // A provider configured from it still resolves back to it.
  assert.equal(findProviderPresetByBaseUrl(cloudflareResolved)?.id, "cloudflare-workers-ai");
});

test("no registered preset declares a variable it never uses, or uses one it never declares", () => {
  const issues = providerPresets.flatMap((preset) => presetTemplateIssues(preset));
  assert.deepEqual(issues, []);
});
